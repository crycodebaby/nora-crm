-- Nora Security Hardening Wave 0
-- Audit immutability: close the TRUNCATE privilege gap on public.audit_events
--
-- ---------------------------------------------------------------------------
-- Problem
-- ---------------------------------------------------------------------------
-- The `authenticated` role held TRUNCATE (plus REFERENCES / TRIGGER, and
-- MAINTAIN on PG17) on public.audit_events.
--
-- Nora treats audit_events as durable, append-only business/admin history.
-- That contract was enforced by two mechanisms, and TRUNCATE defeats both:
--
--   * RLS ("Audit events read admin only", "Audit events insert audit writer")
--     is a ROW-level filter. TRUNCATE is a table-level DDL-ish operation, so
--     PostgreSQL never evaluates a row policy for it.
--   * The BEFORE UPDATE / BEFORE DELETE `prevent_audit_mutation` triggers are
--     FOR EACH ROW triggers. TRUNCATE does not fire row triggers (only
--     TRUNCATE-level statement triggers, which do not exist here).
--
-- Net effect: any authenticated session could erase the entire audit history
-- in one statement while UPDATE and DELETE of a single row were blocked.
--
-- ---------------------------------------------------------------------------
-- Root cause
-- ---------------------------------------------------------------------------
-- Default table privileges for the public schema (ALTER DEFAULT PRIVILEGES FOR
-- ROLE postgres IN SCHEMA public ... ON TABLES TO anon, authenticated,
-- service_role) grant privileges to the API roles at CREATE TABLE time.
--
-- public.audit_events was created in 20260628150000_checklists_snippets_audit,
-- and both that migration and 20260714140000_nora_rbac_hardening then only
-- ADDED `grant select ... to authenticated` on top of what the default
-- privileges had already handed out. Neither did a preceding `revoke all`,
-- so the default-granted non-DML privileges survived on `authenticated`.
--
-- The same migration DID run `revoke all on table public.audit_events from
-- anon`, which is why anon was already clean.
--
-- public.operation_errors and public.email_delivery_events were never affected
-- because their migrations revoke first and then grant SELECT. This migration
-- brings audit_events onto that same, safer pattern.
--
-- ---------------------------------------------------------------------------
-- Deliberately NOT changed
-- ---------------------------------------------------------------------------
--   * nora_audit_writer INSERT — the append-only write path used by the
--     SECURITY DEFINER function nora_private.write_audit_event().
--   * service_role privileges — trusted server-side role, unchanged here.
--   * RLS policies and the prevent_audit_mutation triggers — untouched.
--   * Schema-wide default privileges — correcting those would re-grant/re-scope
--     privileges on every future table and is out of scope for this wave.
--   * Existing audit rows — no data is read, written or altered.
-- ---------------------------------------------------------------------------

-- Normalise `authenticated` to SELECT only. `revoke all` first so that any
-- default-privilege residue (TRUNCATE / REFERENCES / TRIGGER / MAINTAIN) is
-- removed regardless of which environment this replays against; the explicit
-- grant immediately restores the authorised read path.
revoke all on table public.audit_events from authenticated;
grant select on table public.audit_events to authenticated;

-- Defensive, idempotent: neither PUBLIC nor anon may hold anything here.
revoke all on table public.audit_events from public;
revoke all on table public.audit_events from anon;

-- ---------------------------------------------------------------------------
-- Self-verification: fail the migration if the end state is not the contract.
-- ---------------------------------------------------------------------------
do $$
begin
    -- Destructive privileges must be gone for the app role.
    if has_table_privilege('authenticated', 'public.audit_events', 'TRUNCATE') then
        raise exception 'audit_events hardening: authenticated still holds TRUNCATE';
    end if;
    if has_table_privilege('authenticated', 'public.audit_events', 'UPDATE') then
        raise exception 'audit_events hardening: authenticated still holds UPDATE';
    end if;
    if has_table_privilege('authenticated', 'public.audit_events', 'DELETE') then
        raise exception 'audit_events hardening: authenticated still holds DELETE';
    end if;
    if has_table_privilege('authenticated', 'public.audit_events', 'INSERT') then
        raise exception 'audit_events hardening: authenticated still holds INSERT';
    end if;
    -- TRIGGER would let a client attach its own trigger to audit_events and so
    -- subvert the append-only guarantee; REFERENCES is likewise unnecessary.
    if has_table_privilege('authenticated', 'public.audit_events', 'TRIGGER') then
        raise exception 'audit_events hardening: authenticated still holds TRIGGER';
    end if;
    if has_table_privilege('authenticated', 'public.audit_events', 'REFERENCES') then
        raise exception 'audit_events hardening: authenticated still holds REFERENCES';
    end if;

    -- anon and PUBLIC must hold nothing at all.
    if has_table_privilege('anon', 'public.audit_events', 'SELECT')
        or has_table_privilege('anon', 'public.audit_events', 'TRUNCATE') then
        raise exception 'audit_events hardening: anon unexpectedly holds privileges';
    end if;

    -- Legitimate paths must survive.
    if not has_table_privilege('authenticated', 'public.audit_events', 'SELECT') then
        raise exception 'audit_events hardening: authenticated lost SELECT (admin audit view would break)';
    end if;
    if not has_table_privilege('nora_audit_writer', 'public.audit_events', 'INSERT') then
        raise exception 'audit_events hardening: nora_audit_writer lost INSERT (audit write path would break)';
    end if;

    -- The append-only triggers must still be in place.
    if (select count(*) from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = 'audit_events'
          and not t.tgisinternal
          and t.tgname in ('prevent_audit_events_update', 'prevent_audit_events_delete')) <> 2 then
        raise exception 'audit_events hardening: append-only triggers missing';
    end if;
end;
$$;

comment on table public.audit_events is
    'Append-only Nora audit history. Immutable by contract: authenticated holds SELECT only (RLS restricts to admin), INSERT flows exclusively through nora_private.write_audit_event() as nora_audit_writer, and UPDATE/DELETE are blocked by prevent_audit_mutation triggers. TRUNCATE is withheld from the API roles because it bypasses both RLS and row triggers.';
