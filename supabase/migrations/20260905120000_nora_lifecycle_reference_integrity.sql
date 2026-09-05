-- Nora User Lifecycle W2 (2026-09-05): reference integrity & historical identity.
--
-- Business data must survive employee lifecycle changes. Proven locally against
-- origin/main = 2988829a (rolled-back probes) and read-only against
-- nora-crm-prod (identical catalog), see docs/nora/06-decision-log.md
-- "2026-09-05 – User Lifecycle W2":
--   F1  contact_notes.sales_id -> sales.id was ON DELETE CASCADE: deleting an
--       employee row silently deleted every contact note they wrote.
--   F2  tasks.sales_id had no foreign key at all: deleting an employee left
--       tasks pointing at a nonexistent id, and a task could be inserted with
--       any sales_id (e.g. 999999999).
--   F3  the only employee name lookup (public.sales_directory) filters
--       disabled = false, so old notes/deals/contacts of a disabled employee
--       rendered an empty author/owner name.
--   F4  public.set_sales_role_by_admin (service_role-only since W1) has no
--       remaining caller: users Edge Function v5 uses set_sales_access_by_executor.
--
-- What this migration does (forward-only, replay-safe, no data rewrite):
--   1. contact_notes: CASCADE -> NO ACTION (same constraint name, verified)
--   2. tasks: explicit FK to sales (NO ACTION); fails safely on orphans
--   3. sales: DELETE privilege withdrawn from browser roles (defense in depth
--      next to the missing DELETE policy)
--   4. public.sales_identities: historical employee lookup incl. disabled rows
--      (public.sales_directory stays the ACTIVE directory for new assignments)
--   5. drop the legacy RPC set_sales_role_by_admin
--   6. self-check of the resulting contract
--
-- Deletion model after W2 (see docs/nora/03-data-model-guardrails.md):
--   REFERENCED employee   -> DELETE denied by the database (23503), on every path
--   UNREFERENCED employee -> DELETE stays technically possible for postgres /
--                            service_role (the future controlled hard-delete
--                            executor); browser roles never (no privilege, no policy)
-- Compatible with Postgres 15 (local) and 17 (Production).

-- ---------------------------------------------------------------------------
-- 1. contact_notes.sales_id: authorship must survive employee deletion
-- ---------------------------------------------------------------------------
-- Catalog inspected on local and Production: exactly one FK from
-- contact_notes.sales_id to sales, named "contactNotes_sales_id_fkey" (name
-- from the 2024 init migration), ON UPDATE CASCADE ON DELETE CASCADE.
-- sales.id is immutable (prevent_sales_privilege_escalation), so the UPDATE
-- rule is moot; both become NO ACTION like every sibling reference.

do $$
declare
    v_other text;
begin
    select string_agg(c.conname, ', ') into v_other
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'public.contact_notes'::regclass
      and c.contype = 'f'
      and c.confrelid = 'public.sales'::regclass
      and a.attname = 'sales_id'
      and c.conname <> 'contactNotes_sales_id_fkey';
    if v_other is not null then
        raise exception 'W2: unexpected FK(s) on contact_notes.sales_id -> sales: %; inspect before migrating', v_other;
    end if;
end;
$$;

alter table public.contact_notes
    drop constraint if exists "contactNotes_sales_id_fkey";

alter table public.contact_notes
    add constraint "contactNotes_sales_id_fkey"
        foreign key (sales_id) references public.sales(id)
        on update no action on delete no action;

comment on constraint "contactNotes_sales_id_fkey" on public.contact_notes is
    'W2: historical authorship. Blocks deletion of the referenced employee (NO ACTION); never CASCADE, never SET NULL.';

-- ---------------------------------------------------------------------------
-- 2. tasks.sales_id: explicit reference, no orphans
-- ---------------------------------------------------------------------------
-- Nullable stays nullable (a task may have no owner; the insert trigger
-- set_task_sales_id_trigger fills it from the caller when possible).
-- Production and local were verified read-only to hold zero orphan values;
-- if any exist at apply time the migration stops here without rewriting data.

do $$
declare
    v_orphans bigint;
begin
    select count(*) into v_orphans
    from public.tasks t
    where t.sales_id is not null
      and not exists (select 1 from public.sales s where s.id = t.sales_id);
    if v_orphans > 0 then
        raise exception 'W2: % task row(s) reference a nonexistent employee; resolve manually before adding tasks_sales_id_fkey (no automatic rewrite)', v_orphans
            using errcode = '23503';
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.tasks'::regclass
          and conname = 'tasks_sales_id_fkey'
    ) then
        alter table public.tasks
            add constraint tasks_sales_id_fkey
                foreign key (sales_id) references public.sales(id)
                on update no action on delete no action;
    end if;
end;
$$;

comment on constraint tasks_sales_id_fkey on public.tasks is
    'W2: task owner must be an existing employee. Blocks deletion of the referenced employee (NO ACTION).';

-- ---------------------------------------------------------------------------
-- 3. sales: browser roles cannot DELETE employee rows
-- ---------------------------------------------------------------------------
-- There is no DELETE policy on public.sales (RLS already denies), but the
-- 2024 grants gave ALL privileges to anon/authenticated. Withdrawing DELETE
-- makes the barrier explicit and independent of policy edits. service_role
-- keeps it for the future controlled hard-delete executor.

revoke delete on table public.sales from anon;
revoke delete on table public.sales from authenticated;

-- ---------------------------------------------------------------------------
-- 4. Historical identity lookup: public.sales_identities
-- ---------------------------------------------------------------------------
-- Two questions, two read models:
--   "Who may I assign new work to?"  -> public.sales_directory (active only,
--                                        unchanged: projection, grants, gate)
--   "Who was this employee?"          -> public.sales_identities (all rows)
-- Same trust model as sales_directory: SECURITY DEFINER view, caller must be
-- an active user, projection limited to id/name/avatar plus the `disabled`
-- flag. No role, no email, no user_id.

create or replace view public.sales_identities
with (security_invoker = false)
as
select
    s.id,
    s.first_name,
    s.last_name,
    s.avatar,
    s.disabled
from public.sales s
where nora_private.is_active_user();

comment on view public.sales_identities is
    'W2: historical employee identity (includes disabled rows) for owner/author display on existing records; caller must be active (is_active_user). No role/email/user_id. Use sales_directory for new assignments.';

alter view public.sales_identities set (security_invoker = false);

-- Explicit read-only end state for BOTH identity views. Default privileges in
-- schema public hand API roles more than SELECT at CREATE VIEW time (locally
-- the full set: a security_invoker = false view over one table is
-- auto-updatable, so a viewer JWT could UPDATE or DELETE public.sales through
-- sales_directory on a local reset; Production carried SELECT plus harmless
-- TRUNCATE/REFERENCES/TRIGGER/MAINTAIN bits). Pin SELECT only, regardless of
-- what the defaults handed out.
revoke all on table public.sales_identities from public, anon, authenticated, service_role;
grant select on table public.sales_identities to authenticated;
grant select on table public.sales_identities to service_role;

revoke all on table public.sales_directory from public, anon, authenticated, service_role;
grant select on table public.sales_directory to authenticated;
grant select on table public.sales_directory to service_role;

-- ---------------------------------------------------------------------------
-- 5. Legacy RPC retired
-- ---------------------------------------------------------------------------
-- No frontend, no Edge Function (users v5 deployed 2026-09-05), no trigger and
-- no other function calls it; the SQL suites were updated in the same change.

drop function if exists public.set_sales_role_by_admin(bigint, text, boolean);

-- ---------------------------------------------------------------------------
-- 6. Self-check of the resulting contract
-- ---------------------------------------------------------------------------

do $$
declare
    v_bad text;
begin
    -- every FK to sales is NO ACTION on delete (no CASCADE, no SET NULL)
    select string_agg(c.conrelid::regclass::text || '.' || c.conname || '=' || c.confdeltype::text, ', ') into v_bad
    from pg_constraint c
    where c.contype = 'f'
      and c.confrelid = 'public.sales'::regclass
      and c.confdeltype <> 'a';
    if v_bad is not null then
        raise exception 'W2: FK(s) to sales are not NO ACTION: %', v_bad;
    end if;

    if (select count(*) from pg_constraint c where c.contype = 'f' and c.confrelid = 'public.sales'::regclass) <> 6 then
        raise exception 'W2: expected exactly 6 FKs to sales (companies, contacts, deals, deal_notes, contact_notes, tasks)';
    end if;

    if to_regprocedure('public.set_sales_role_by_admin(bigint, text, boolean)') is not null then
        raise exception 'W2: legacy RPC still present';
    end if;

    if to_regclass('public.sales_identities') is null then
        raise exception 'W2: sales_identities view missing';
    end if;

    if has_table_privilege('authenticated', 'public.sales', 'DELETE')
       or has_table_privilege('anon', 'public.sales', 'DELETE') then
        raise exception 'W2: browser roles must not hold DELETE on sales';
    end if;

    if has_table_privilege('authenticated', 'public.sales_directory', 'INSERT, UPDATE, DELETE')
       or has_table_privilege('authenticated', 'public.sales_identities', 'INSERT, UPDATE, DELETE')
       or has_table_privilege('anon', 'public.sales_directory', 'SELECT')
       or has_table_privilege('anon', 'public.sales_identities', 'SELECT') then
        raise exception 'W2: identity views must be SELECT-only for authenticated and closed for anon';
    end if;
end;
$$;
