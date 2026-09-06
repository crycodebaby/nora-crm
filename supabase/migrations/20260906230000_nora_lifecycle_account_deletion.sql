-- Nora User Lifecycle W6-B (2026-09-06): controlled, irreversible hard delete
-- of a Nora employee account that never became business history.
--
-- Product rule: a real employee with business or authorship history is
-- OFFBOARDED (W5), never deleted. Hard Delete exists for the accidental, fake,
-- duplicate, test or never-used identity that should not remain in Nora. It
-- removes the Nora employee row (public.sales) and the Auth identity
-- (auth.users + GoTrue's own CASCADE children). It is NOT a GDPR erasure:
-- audit_events (Nora) and auth.audit_log_entries (GoTrue) stay.
--
-- Facts this design rests on, re-proven locally against GoTrue 2.196 before
-- and after this migration (see docs/nora/releases/2026-09.md, W6-B):
--   * GoTrue's Admin hard delete (DELETE /auth/v1/admin/users/:id) runs its
--     auth audit insert and the DELETE FROM auth.users in ONE Postgres
--     transaction. While a public.sales row references the user, the W2
--     sales_user_id_fkey (NO ACTION) makes that transaction fail -> HTTP 500,
--     nothing changes, no provider audit row.
--   * A BEFORE DELETE trigger on auth.users fires inside that transaction.
--     An exception in it rolls back the whole GoTrue transaction; a
--     successful DELETE FROM public.sales issued by the trigger commits
--     together with the auth.users deletion and the CASCADE children.
--   * The six W2 NO ACTION FKs (companies, contacts, deals, tasks,
--     contact_notes, deal_notes -> sales.id) are checked at the end of that
--     DELETE statement: any reference aborts the entire GoTrue transaction.
--     They remain the final database barrier and are not touched here.
--
-- Architecture (Option C of the W6 discovery; W4 pattern):
--   Admin UI -> users Edge Function (verified admin caller)
--     -> public.prepare_employee_account_deletion(...)   guards + 2-minute ticket
--     -> GoTrue Admin hard delete
--     -> nora_private.guard_auth_user_delete()           BEFORE DELETE ON auth.users:
--          ticket or refusal; with a ticket: revalidate target + eligibility,
--          restore the verified actor/operation, remove Nora technical state,
--          DELETE public.sales (guarded), write user.account_deleted — all in
--          GoTrue's transaction
--     -> Postgres deletes auth.users, GoTrue's CASCADE children follow
--     -> Edge verifies absence + audit evidence, answers a disposition.
--   A direct DELETE FROM public.sales (any role, incl. service_role) is
--   refused by nora_private.guard_sales_delete() unless it happens inside the
--   authorized auth.users deletion (matching live ticket in a transaction-
--   local GUC AND nested trigger depth). A direct DELETE FROM auth.users
--   (Dashboard, SQL, other Admin-API callers) without a Nora ticket is
--   refused by the auth.users guard, so an Auth deletion can no longer
--   orphan Nora state.
--
-- Eligibility (public.get_employee_deletion_preview, separate from the W5
-- "what is still open" preview): the identity must never have become durable
-- business/history state. All-time counts in the six business tables block
-- (archived deals, completed tasks and historical notes included); authored
-- checklist templates / text snippets, connected calendars and audit rows in
-- which the employee ACTED block as durable provenance. Audit rows in which
-- the employee is merely the TARGET of an admin action never block (every
-- invited account has them). The target must already be disabled and banned
-- (offboarded / disabled through W1/W5) with a consistent, resolvable
-- identity; the caller must be an active admin and not the target.
--
-- Technical account state removed with the account: the employee's Auth
-- sessions / refresh tokens (GoTrue CASCADE would do it too; removed and
-- counted explicitly), outstanding W4 email-change tickets, and
-- email_delivery_events rows attributable to exactly this identity
-- (employee_sale_id = sale AND recipient address = a login address this
-- employee ever had). Delivery rows with a foreign address are kept and
-- counted. operation_errors / idempotency_records (uuid-only technical
-- records) and Nora/GoTrue audit history are preserved.
--
-- Forward-only and replay-safe: CREATE OR REPLACE, IF NOT EXISTS, revoke ->
-- explicit grant. No existing grant, policy, column or FK is changed. The
-- deployed users Edge Function v8 keeps working (it calls none of the new
-- functions; nothing it uses is altered). Compatible with Postgres 15 (local)
-- and 17 (Production).

-- ---------------------------------------------------------------------------
-- 0. Hard gate: the barrier this wave relies on must exist unchanged
-- ---------------------------------------------------------------------------
do $$
declare
    v_count integer;
    v_bad integer;
begin
    if current_user <> 'postgres' then
        raise exception 'W6-B: migration must run as postgres (current_user = %)', current_user;
    end if;

    -- Exactly the six W2 references, all NO ACTION on delete.
    select count(*), count(*) filter (where confdeltype <> 'a')
      into v_count, v_bad
      from pg_constraint
     where contype = 'f' and confrelid = 'public.sales'::regclass;
    if v_count <> 6 or v_bad <> 0 then
        raise exception 'W6-B gate: expected exactly 6 NO ACTION foreign keys on public.sales(id), found % (% not NO ACTION) — re-verify the reference graph before installing Hard Delete', v_count, v_bad;
    end if;

    -- sales.user_id -> auth.users must stay NO ACTION (GoTrue must not be able
    -- to cascade a Nora row away).
    if not exists (
        select 1 from pg_constraint
         where conname = 'sales_user_id_fkey' and conrelid = 'public.sales'::regclass
           and confrelid = 'auth.users'::regclass and confdeltype = 'a'
    ) then
        raise exception 'W6-B gate: sales_user_id_fkey must reference auth.users ON DELETE NO ACTION';
    end if;

    if not has_table_privilege('postgres', 'auth.users', 'SELECT')
       or not has_table_privilege('postgres', 'auth.sessions', 'DELETE')
       or not has_table_privilege('postgres', 'auth.refresh_tokens', 'DELETE') then
        raise exception 'W6-B gate: postgres needs SELECT on auth.users and DELETE on auth.sessions / auth.refresh_tokens';
    end if;

    -- The W3/W4 audit plumbing the guard reuses.
    if to_regprocedure('nora_private.pin_audit_context(uuid, uuid)') is null
       or to_regprocedure('nora_private.revoke_auth_sessions(uuid)') is null
       or to_regprocedure('public.nora_entity_uuid(text, bigint)') is null then
        raise exception 'W6-B gate: W3/W5 helpers missing (pin_audit_context / revoke_auth_sessions / nora_entity_uuid)';
    end if;

    raise notice 'W6-B gate: reference graph and privileges as expected — proceeding';
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Deletion ticket (internal, never API-exposed)
-- ---------------------------------------------------------------------------
-- "The verified administrator <actor_user_id> has asked, in request
-- <operation_id>, to delete employee <sale_id> = Auth user <user_id> =
-- entity <entity_id>, who at that moment was <email/name/role snapshot>,
-- disabled, and eligible (<eligibility_snapshot>)." Consumed by the auth.users
-- guard; expires after two minutes (W4 TTL). Because public.sales.id is
-- GENERATED BY DEFAULT, the ticket never authorizes by sale id alone: the
-- guard requires sale id + Auth user id + email + name + role to still match.

create table if not exists nora_private.sales_account_deletion_tickets (
    id uuid primary key default gen_random_uuid(),
    -- No FK on purpose (W2 rule: every FK on sales.id is NO ACTION and
    -- counted by the reference-integrity suite; a ticket is a two-minute
    -- intent validated against the live rows when it is consumed).
    sale_id bigint not null unique,
    user_id uuid not null unique,
    entity_id uuid not null,
    email_snapshot extensions.citext not null,
    first_name_snapshot text not null,
    last_name_snapshot text not null,
    role_snapshot text not null,
    actor_user_id uuid not null,
    operation_id uuid,
    eligibility_snapshot jsonb not null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null
);

alter table nora_private.sales_account_deletion_tickets enable row level security;

revoke all on table nora_private.sales_account_deletion_tickets from public;
revoke all on table nora_private.sales_account_deletion_tickets from anon;
revoke all on table nora_private.sales_account_deletion_tickets from authenticated;
revoke all on table nora_private.sales_account_deletion_tickets from service_role;

comment on table nora_private.sales_account_deletion_tickets is
    'W6-B: short-lived intent records for controlled account deletion. Written only by prepare_employee_account_deletion (service_role RPC, verified admin actor), consumed by guard_auth_user_delete inside GoTrue''s DELETE transaction. Binds sale id + Auth user id + identity snapshot so a ticket can never delete another identity. Not API-exposed. No secrets.';

-- ---------------------------------------------------------------------------
-- 2. Eligibility — internal evaluation (no role check; reused by the guard)
-- ---------------------------------------------------------------------------
-- Answers: "has this identity ever become durable business/history state, and
-- is it in the required target state?" Counts only, no row payload.

create or replace function nora_private.employee_deletion_preview(
    p_sale_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_sale public.sales%rowtype;
    v_auth_present boolean := false;
    v_auth_email text;
    v_auth_confirmed boolean := false;
    v_auth_banned boolean := false;
    v_identity_consistent boolean := false;
    v_entity uuid;
    v_known_emails text[];
    v_business jsonb;
    v_provenance jsonb;
    v_technical jsonb;
    v_reasons text[] := '{}';
    v_history_total bigint;
    v_provenance_total bigint;
begin
    select * into v_sale from public.sales where id = p_sale_id;
    if not found then
        raise exception 'sales profile not found: %', coalesce(p_sale_id::text, '<null>')
            using errcode = 'P0002';
    end if;

    v_entity := public.nora_entity_uuid('sales', v_sale.id);

    select true,
           u.email,
           (u.email_confirmed_at is not null),
           (u.banned_until is not null and u.banned_until > now())
      into v_auth_present, v_auth_email, v_auth_confirmed, v_auth_banned
      from auth.users u
     where u.id = v_sale.user_id;
    if not found then
        v_auth_present := false;
    end if;
    v_identity_consistent := v_auth_present
        and lower(btrim(coalesce(v_auth_email, ''))) = lower(btrim(v_sale.email::text));

    -- Every login address this employee ever had (current + W4 history).
    select array_agg(distinct e) into v_known_emails
      from (
          select lower(btrim(v_sale.email::text)) as e
          union all
          select lower(btrim(a.metadata -> 'changes' -> 'email' ->> 'old'))
            from public.audit_events a
           where a.entity_id = v_entity and a.event_type = 'user.email_changed'
             and a.metadata -> 'changes' -> 'email' ->> 'old' is not null
          union all
          select lower(btrim(a.metadata -> 'changes' -> 'email' ->> 'new'))
            from public.audit_events a
           where a.entity_id = v_entity and a.event_type = 'user.email_changed'
             and a.metadata -> 'changes' -> 'email' ->> 'new' is not null
      ) k
     where e is not null and e <> '';

    -- All-time business references (the six W2 tables). Archived deals,
    -- completed tasks and historical notes count.
    v_business := jsonb_build_object(
        'companies',     (select count(*) from public.companies c     where c.sales_id = v_sale.id),
        'contacts',      (select count(*) from public.contacts c      where c.sales_id = v_sale.id),
        'deals',         (select count(*) from public.deals d         where d.sales_id = v_sale.id),
        'tasks',         (select count(*) from public.tasks t         where t.sales_id = v_sale.id),
        'contact_notes', (select count(*) from public.contact_notes n where n.sales_id = v_sale.id),
        'deal_notes',    (select count(*) from public.deal_notes n    where n.sales_id = v_sale.id)
    );

    -- Durable provenance: authored content, integration ownership, and audit
    -- rows in which this employee ACTED (target-only rows never count).
    v_provenance := jsonb_build_object(
        'checklist_templates',        (select count(*) from public.checklist_templates x where x.created_by = v_sale.user_id),
        'saved_text_snippets',        (select count(*) from public.saved_text_snippets x  where x.created_by = v_sale.user_id),
        'google_calendar_connections',(select count(*) from public.google_calendar_connections x where x.connected_by = v_sale.user_id),
        'audit_events_as_actor',      (select count(*) from public.audit_events a where a.actor_sales_id = v_sale.id or a.actor_id = v_sale.user_id)
    );

    -- Technical account state: informational; removed or preserved per class.
    v_technical := jsonb_build_object(
        'live_sessions',                       (select count(*) from auth.sessions s where s.user_id = v_sale.user_id),
        'audit_events_as_target',              (select count(*) from public.audit_events a where a.entity_id = v_entity),
        'email_delivery_events_attributable',  (select count(*) from public.email_delivery_events e
                                                  where e.employee_sale_id = v_sale.id
                                                    and lower(e.recipient_email_snapshot) = any (coalesce(v_known_emails, '{}'))),
        'email_delivery_events_foreign',       (select count(*) from public.email_delivery_events e
                                                  where e.employee_sale_id = v_sale.id
                                                    and not (lower(e.recipient_email_snapshot) = any (coalesce(v_known_emails, '{}')))),
        'email_change_tickets',                (select count(*) from nora_private.sales_email_change_tickets t where t.sale_id = v_sale.id),
        'operation_errors',                    (select count(*) from public.operation_errors o
                                                  where o.actor_user_id = v_sale.user_id or o.reported_by_user_id = v_sale.user_id or o.resolved_by = v_sale.user_id),
        'idempotency_records',                 (select count(*) from nora_private.idempotency_records i where i.actor_id = v_sale.user_id)
    );

    select coalesce(sum(value::bigint), 0) into v_history_total from jsonb_each_text(v_business);
    select coalesce(sum(value::bigint), 0) into v_provenance_total from jsonb_each_text(v_provenance);

    -- Reasons, most fundamental first. Identity problems before state, state
    -- before history, so the administrator sees the next required step.
    if not v_auth_present then
        v_reasons := array_append(v_reasons, 'NORA_EMPLOYEE_AUTH_NOT_FOUND');
    elsif not v_identity_consistent then
        v_reasons := array_append(v_reasons, 'NORA_EMPLOYEE_IDENTITY_INCONSISTENT');
    end if;
    if not v_sale.disabled then
        v_reasons := array_append(v_reasons, 'NORA_EMPLOYEE_STILL_ACTIVE');
    elsif v_auth_present and not v_auth_banned then
        -- Nora says disabled, Auth is not banned: the W1 pair is inconsistent.
        v_reasons := array_append(v_reasons, 'NORA_EMPLOYEE_ACCESS_INCONSISTENT');
    end if;
    if v_history_total > 0 then
        v_reasons := array_append(v_reasons, 'NORA_EMPLOYEE_HAS_BUSINESS_HISTORY');
    end if;
    if v_provenance_total > 0 then
        v_reasons := array_append(v_reasons, 'NORA_EMPLOYEE_HAS_DURABLE_PROVENANCE');
    end if;

    return jsonb_build_object(
        'eligible', cardinality(v_reasons) = 0,
        'reasons', to_jsonb(v_reasons),
        'target', jsonb_build_object(
            'sale_id', v_sale.id,
            'role', v_sale.role,
            'disabled', v_sale.disabled,
            'auth_present', v_auth_present,
            'auth_confirmed', v_auth_confirmed,
            'auth_banned', v_auth_banned,
            'identity_consistent', v_identity_consistent
        ),
        'business_history', v_business,
        'provenance', v_provenance,
        'technical', v_technical
    );
end;
$$;

alter function nora_private.employee_deletion_preview(bigint) owner to postgres;

revoke all on function nora_private.employee_deletion_preview(bigint) from public;
revoke all on function nora_private.employee_deletion_preview(bigint) from anon;
revoke all on function nora_private.employee_deletion_preview(bigint) from authenticated;
revoke all on function nora_private.employee_deletion_preview(bigint) from service_role;
grant execute on function nora_private.employee_deletion_preview(bigint) to postgres;

comment on function nora_private.employee_deletion_preview(bigint) is
    'W6-B internal: deletion eligibility of one employee — all-time business references (six W2 tables), durable provenance (authored templates/snippets, connected calendars, audit rows as ACTOR), required target state (disabled + banned, consistent identity) and technical counts. Reasons are NORA_* codes. Counts only. Called by the public preview RPC and re-evaluated by the auth.users delete guard.';

-- ---------------------------------------------------------------------------
-- 3. Eligibility — service_role RPC (the Edge Function's read)
-- ---------------------------------------------------------------------------

create or replace function public.get_employee_deletion_preview(
    p_sale_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if coalesce(nora_private.safe_auth_role(), '') <> 'service_role' then
        raise exception 'forbidden'
            using errcode = '42501', detail = 'NORA_PERMISSION_DENIED';
    end if;
    if p_sale_id is null then
        raise exception 'target required' using errcode = '22023';
    end if;
    return nora_private.employee_deletion_preview(p_sale_id);
end;
$$;

alter function public.get_employee_deletion_preview(bigint) owner to postgres;

comment on function public.get_employee_deletion_preview(bigint) is
    'W6-B: "may this employee account be hard-deleted?" — eligible flag, NORA_* reasons, all-time business-history counts, provenance counts, target state and technical counts. Distinct from get_employee_dependency_preview (W5: what is still open). service_role only; reached through the users Edge Function.';

revoke all on function public.get_employee_deletion_preview(bigint) from public;
revoke all on function public.get_employee_deletion_preview(bigint) from anon;
revoke all on function public.get_employee_deletion_preview(bigint) from authenticated;
grant execute on function public.get_employee_deletion_preview(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Confirmation normalisation (deliberate, narrow)
-- ---------------------------------------------------------------------------
-- Surrounding whitespace trimmed, internal whitespace runs collapsed to one
-- space, case preserved. Nothing fuzzier: a different name must not pass.

create or replace function nora_private.normalize_confirmation_name(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
    select regexp_replace(btrim(coalesce(p_value, '')), '\s+', ' ', 'g');
$$;

alter function nora_private.normalize_confirmation_name(text) owner to postgres;

revoke all on function nora_private.normalize_confirmation_name(text) from public;
revoke all on function nora_private.normalize_confirmation_name(text) from anon;
revoke all on function nora_private.normalize_confirmation_name(text) from authenticated;
revoke all on function nora_private.normalize_confirmation_name(text) from service_role;
grant execute on function nora_private.normalize_confirmation_name(text) to postgres;

comment on function nora_private.normalize_confirmation_name(text) is
    'W6-B: typed-confirmation normalisation = btrim + collapse internal whitespace; case-sensitive. Used to compare the typed full name against the current employee identity.';

-- ---------------------------------------------------------------------------
-- 5. Prepare RPC: every guard, then the ticket (service_role only)
-- ---------------------------------------------------------------------------
-- Nothing about the employee changes here. The RPC decides whether the
-- deletion is allowed right now and records the intent for the auth.users
-- guard, which re-validates everything again at delete time.

create or replace function public.prepare_employee_account_deletion(
    p_actor_user_id uuid,
    p_sale_id bigint,
    p_confirmation_name text,
    p_admin_target_confirmed boolean default false,
    p_operation_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_actor public.sales%rowtype;
    v_target public.sales%rowtype;
    v_preview jsonb;
    v_reason text;
    v_ticket_id uuid;
    v_expected_name text;
begin
    -- Trust boundary: only the privileged server executor may call this.
    if coalesce(nora_private.safe_auth_role(), '') <> 'service_role' then
        raise exception 'forbidden'
            using errcode = '42501', detail = 'NORA_PERMISSION_DENIED';
    end if;

    if p_actor_user_id is null then
        raise exception 'actor required' using errcode = '22023';
    end if;
    if p_sale_id is null then
        raise exception 'target required' using errcode = '22023';
    end if;

    -- The actor parameter never creates privilege: an existing, active admin.
    select * into v_actor from public.sales where user_id = p_actor_user_id;
    if not found or v_actor.role <> 'admin' or v_actor.disabled then
        raise exception 'forbidden'
            using errcode = '42501', detail = 'NORA_PERMISSION_DENIED';
    end if;

    select * into v_target from public.sales where id = p_sale_id for update;
    if not found then
        raise exception 'sales profile not found: %', p_sale_id
            using errcode = 'P0002';
    end if;

    -- Self guard: nobody deletes their own account through the lifecycle path.
    if v_target.user_id = p_actor_user_id then
        raise exception 'administrators cannot delete their own account'
            using errcode = '42501', detail = 'NORA_SELF_DELETE_FORBIDDEN';
    end if;

    -- Typed confirmation against the CURRENT identity (never the client's copy).
    v_expected_name := nora_private.normalize_confirmation_name(
        coalesce(v_target.first_name, '') || ' ' || coalesce(v_target.last_name, ''));
    if v_expected_name = '' or nora_private.normalize_confirmation_name(p_confirmation_name) <> v_expected_name then
        raise exception 'confirmation does not match the employee name'
            using errcode = '22023', detail = 'NORA_DELETE_CONFIRMATION_MISMATCH';
    end if;

    -- Defense in depth for administrator targets (even disabled ones).
    if v_target.role = 'admin' and coalesce(p_admin_target_confirmed, false) is not true then
        raise exception 'deleting an administrator account requires the explicit extra confirmation'
            using errcode = '22023', detail = 'NORA_ADMIN_TARGET_CONFIRMATION_REQUIRED';
    end if;

    -- Authoritative eligibility, evaluated now (and again inside the delete).
    v_preview := nora_private.employee_deletion_preview(v_target.id);
    if (v_preview ->> 'eligible')::boolean is not true then
        v_reason := v_preview -> 'reasons' ->> 0;
        raise exception 'employee account is not eligible for deletion (%)', v_reason
            using errcode = '23514', detail = v_reason;
    end if;

    -- Housekeeping, then exactly one live ticket for this employee.
    delete from nora_private.sales_account_deletion_tickets where expires_at <= now();
    delete from nora_private.sales_account_deletion_tickets where sale_id = v_target.id or user_id = v_target.user_id;

    insert into nora_private.sales_account_deletion_tickets
        (sale_id, user_id, entity_id, email_snapshot, first_name_snapshot, last_name_snapshot,
         role_snapshot, actor_user_id, operation_id, eligibility_snapshot, expires_at)
    values
        (v_target.id, v_target.user_id, public.nora_entity_uuid('sales', v_target.id), v_target.email,
         coalesce(v_target.first_name, ''), coalesce(v_target.last_name, ''), v_target.role,
         p_actor_user_id, p_operation_id,
         jsonb_build_object('business_history', v_preview -> 'business_history', 'provenance', v_preview -> 'provenance'),
         now() + interval '2 minutes')
    returning id into v_ticket_id;

    return jsonb_build_object(
        'ticket_id', v_ticket_id,
        'sale_id', v_target.id,
        'user_id', v_target.user_id,
        'entity_id', public.nora_entity_uuid('sales', v_target.id),
        'role', v_target.role,
        'preview', v_preview
    );
end;
$$;

alter function public.prepare_employee_account_deletion(uuid, bigint, text, boolean, uuid) owner to postgres;

comment on function public.prepare_employee_account_deletion(uuid, bigint, text, boolean, uuid) is
    'W6-B executor step 1: service_role only. p_actor_user_id must be an active admin (verified by the users Edge Function from the caller JWT). Refuses self (NORA_SELF_DELETE_FORBIDDEN), a typed confirmation that does not equal the current full name (NORA_DELETE_CONFIRMATION_MISMATCH), an admin target without the extra confirmation (NORA_ADMIN_TARGET_CONFIRMATION_REQUIRED) and every ineligible target (first NORA_* reason of the preview in DETAIL), then writes the two-minute ticket guard_auth_user_delete consumes. Changes nothing about the employee.';

revoke all on function public.prepare_employee_account_deletion(uuid, bigint, text, boolean, uuid) from public;
revoke all on function public.prepare_employee_account_deletion(uuid, bigint, text, boolean, uuid) from anon;
revoke all on function public.prepare_employee_account_deletion(uuid, bigint, text, boolean, uuid) from authenticated;
grant execute on function public.prepare_employee_account_deletion(uuid, bigint, text, boolean, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Ticket removal after a refused / failed provider call (service_role only)
-- ---------------------------------------------------------------------------

create or replace function public.cancel_employee_account_deletion(p_ticket_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_deleted integer;
begin
    if coalesce(nora_private.safe_auth_role(), '') <> 'service_role' then
        raise exception 'forbidden'
            using errcode = '42501', detail = 'NORA_PERMISSION_DENIED';
    end if;
    if p_ticket_id is null then
        raise exception 'ticket required' using errcode = '22023';
    end if;

    delete from nora_private.sales_account_deletion_tickets where id = p_ticket_id;
    get diagnostics v_deleted = row_count;
    return v_deleted > 0;
end;
$$;

alter function public.cancel_employee_account_deletion(uuid) owner to postgres;

comment on function public.cancel_employee_account_deletion(uuid) is
    'W6-B executor: service_role only. Removes an unconsumed deletion ticket after the provider refused or failed. Returns false when the ticket no longer exists (consumed or expired).';

revoke all on function public.cancel_employee_account_deletion(uuid) from public;
revoke all on function public.cancel_employee_account_deletion(uuid) from anon;
revoke all on function public.cancel_employee_account_deletion(uuid) from authenticated;
grant execute on function public.cancel_employee_account_deletion(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Deletion evidence (service_role only) — for verification and replays
-- ---------------------------------------------------------------------------
-- "Does the sales row still exist, and did a committed user.account_deleted
-- event for this entity happen?" The Edge Function uses it to verify a green
-- result and to answer a retry after the response was lost. It never fabricates
-- success: sale gone without the event is `not_found`, never `already_deleted`.

create or replace function public.get_employee_deletion_evidence(
    p_sale_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_entity uuid;
    v_count bigint;
    v_last_request text;
    v_last_at timestamptz;
begin
    if coalesce(nora_private.safe_auth_role(), '') <> 'service_role' then
        raise exception 'forbidden'
            using errcode = '42501', detail = 'NORA_PERMISSION_DENIED';
    end if;
    if p_sale_id is null then
        raise exception 'target required' using errcode = '22023';
    end if;

    v_entity := public.nora_entity_uuid('sales', p_sale_id);

    select count(*) into v_count
      from public.audit_events a
     where a.entity_id = v_entity and a.event_type = 'user.account_deleted';

    select a.request_id, a.created_at into v_last_request, v_last_at
      from public.audit_events a
     where a.entity_id = v_entity and a.event_type = 'user.account_deleted'
     order by a.created_at desc
     limit 1;

    return jsonb_build_object(
        'sale_id', p_sale_id,
        'sale_exists', exists (select 1 from public.sales s where s.id = p_sale_id),
        'deleted_event_count', v_count,
        'last_deleted_request_id', v_last_request,
        'last_deleted_at', v_last_at
    );
end;
$$;

alter function public.get_employee_deletion_evidence(bigint) owner to postgres;

comment on function public.get_employee_deletion_evidence(bigint) is
    'W6-B: service_role only. Whether the sales row still exists and how many committed user.account_deleted events exist for the stable entity of this sales id (plus the last request id). Used by the users Edge Function for verification and replay-safe retries.';

revoke all on function public.get_employee_deletion_evidence(bigint) from public;
revoke all on function public.get_employee_deletion_evidence(bigint) from anon;
revoke all on function public.get_employee_deletion_evidence(bigint) from authenticated;
grant execute on function public.get_employee_deletion_evidence(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 8. Guard on public.sales: no second hard-delete mechanism
-- ---------------------------------------------------------------------------
-- A sales row may only disappear while the authorized auth.users deletion is
-- executing: the transaction-local GUC nora.account_deletion_ticket must name
-- a live ticket for exactly this row (sale id AND Auth user id), and the
-- statement must run nested inside another trigger (the auth.users guard),
-- never as a top-level DELETE. Everything else — psql, Dashboard, Data API as
-- service_role, a future RPC — is refused.

create or replace function nora_private.guard_sales_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_raw text;
    v_ticket_id uuid;
begin
    begin
        v_raw := nullif(btrim(current_setting('nora.account_deletion_ticket', true)), '');
    exception when others then
        v_raw := null;
    end;

    if v_raw is null then
        raise exception 'employee accounts are only deleted through the Nora account-deletion executor'
            using errcode = '42501', detail = 'NORA_SALES_DELETE_NOT_AUTHORIZED';
    end if;

    begin
        v_ticket_id := v_raw::uuid;
    exception when others then
        raise exception 'employee accounts are only deleted through the Nora account-deletion executor'
            using errcode = '42501', detail = 'NORA_SALES_DELETE_NOT_AUTHORIZED';
    end;

    -- Nested inside the auth.users guard (depth >= 2), never a direct DELETE.
    if pg_trigger_depth() < 2 then
        raise exception 'employee accounts are only deleted inside the authorized Auth deletion'
            using errcode = '42501', detail = 'NORA_SALES_DELETE_NOT_AUTHORIZED';
    end if;

    if not exists (
        select 1 from nora_private.sales_account_deletion_tickets t
         where t.id = v_ticket_id
           and t.sale_id = old.id
           and t.user_id = old.user_id
           and t.expires_at > now()
    ) then
        raise exception 'no live deletion ticket for this employee'
            using errcode = '42501', detail = 'NORA_SALES_DELETE_NOT_AUTHORIZED';
    end if;

    if old.disabled is not true then
        raise exception 'an active employee is never deleted'
            using errcode = '23514', detail = 'NORA_EMPLOYEE_STILL_ACTIVE';
    end if;

    return old;
end;
$$;

alter function nora_private.guard_sales_delete() owner to postgres;

revoke all on function nora_private.guard_sales_delete() from public;
revoke all on function nora_private.guard_sales_delete() from anon;
revoke all on function nora_private.guard_sales_delete() from authenticated;
revoke all on function nora_private.guard_sales_delete() from service_role;

comment on function nora_private.guard_sales_delete() is
    'W6-B: BEFORE DELETE ON public.sales. Refuses every DELETE (NORA_SALES_DELETE_NOT_AUTHORIZED) unless the transaction-local GUC nora.account_deletion_ticket names a live ticket for exactly this sale id + Auth user id AND the statement runs nested inside the auth.users delete guard (pg_trigger_depth() >= 2). An active row is never deleted (NORA_EMPLOYEE_STILL_ACTIVE).';

drop trigger if exists guard_sales_delete_trigger on public.sales;

create trigger guard_sales_delete_trigger
    before delete on public.sales
    for each row
    execute function nora_private.guard_sales_delete();

-- ---------------------------------------------------------------------------
-- 9. Guard on auth.users: ticket or refusal; with a ticket everything at once
-- ---------------------------------------------------------------------------
-- Runs inside GoTrue's own DELETE transaction (current_user = postgres via
-- SECURITY DEFINER, session_user = supabase_auth_admin, no JWT claims). Also
-- fires for a Dashboard / SQL deletion — which is the point: without a Nora
-- ticket no Auth identity that Nora knows can vanish and orphan its sales row.
-- An Auth user Nora does not know (no sales row) is not Nora's to protect:
-- the guard lets GoTrue delete it (there is nothing to orphan).

create or replace function nora_private.guard_auth_user_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_ticket nora_private.sales_account_deletion_tickets%rowtype;
    v_sale public.sales%rowtype;
    v_actor public.sales%rowtype;
    v_preview jsonb;
    v_reason text;
    v_known_emails text[];
    v_sessions integer;
    v_email_tickets integer;
    v_purged integer;
    v_retained integer;
    v_deleted integer;
    v_audit_as_target bigint;
begin
    -- Nora state exists for this identity?
    select * into v_sale from public.sales where user_id = old.id for update;
    if not found then
        -- Not a Nora employee: nothing to orphan, nothing to guard.
        return old;
    end if;

    select * into v_ticket
      from nora_private.sales_account_deletion_tickets t
     where t.user_id = old.id
       and t.sale_id = v_sale.id
       and t.expires_at > now()
     for update;

    if not found then
        raise exception 'Nora employee accounts are only deleted through the Nora account-deletion executor'
            using errcode = '42501', detail = 'NORA_ACCOUNT_DELETE_NOT_AUTHORIZED';
    end if;

    -- The current target must still be the identity the ticket was written for.
    if v_sale.user_id <> old.id
       or v_ticket.entity_id <> public.nora_entity_uuid('sales', v_sale.id)
       or v_sale.email <> v_ticket.email_snapshot
       or lower(btrim(coalesce(old.email, ''))) <> lower(btrim(v_ticket.email_snapshot::text))
       or coalesce(v_sale.first_name, '') <> v_ticket.first_name_snapshot
       or coalesce(v_sale.last_name, '') <> v_ticket.last_name_snapshot
       or v_sale.role <> v_ticket.role_snapshot then
        raise exception 'identity changed since the deletion ticket was written'
            using errcode = '23514', detail = 'NORA_EMPLOYEE_IDENTITY_INCONSISTENT';
    end if;

    -- The actor is re-checked at delete time: still an existing, active admin,
    -- still not the target.
    select * into v_actor from public.sales where user_id = v_ticket.actor_user_id;
    if not found or v_actor.role <> 'admin' or v_actor.disabled then
        raise exception 'deletion actor is no longer an active administrator'
            using errcode = '42501', detail = 'NORA_PERMISSION_DENIED';
    end if;
    if v_actor.id = v_sale.id then
        raise exception 'administrators cannot delete their own account'
            using errcode = '42501', detail = 'NORA_SELF_DELETE_FORBIDDEN';
    end if;

    -- Eligibility again, authoritatively, now. No stale preview is trusted.
    v_preview := nora_private.employee_deletion_preview(v_sale.id);
    if (v_preview ->> 'eligible')::boolean is not true then
        v_reason := v_preview -> 'reasons' ->> 0;
        raise exception 'employee account is not eligible for deletion (%)', v_reason
            using errcode = '23514', detail = v_reason;
    end if;

    v_audit_as_target := (v_preview -> 'technical' ->> 'audit_events_as_target')::bigint;

    -- W3: every audit row of this transaction names the verified actor and
    -- carries the request correlation (the prepare RPC ran in another
    -- transaction; its context did not survive — the ticket carried it).
    perform nora_private.pin_audit_context(v_ticket.actor_user_id, v_ticket.operation_id);

    -- Transaction-local capability for the sales guard.
    perform set_config('nora.account_deletion_ticket', v_ticket.id::text, true);

    -- (a) Auth sessions / refresh tokens — GoTrue's CASCADE would remove them
    --     too; removed explicitly so the count is known and reported.
    v_sessions := nora_private.revoke_auth_sessions(old.id);

    -- (b) Nora technical state owned by this identity.
    delete from nora_private.sales_email_change_tickets where sale_id = v_sale.id or user_id = old.id;
    get diagnostics v_email_tickets = row_count;

    --     Delivery rows attributable to exactly this identity: same employee
    --     AND an address this employee ever had. Foreign addresses stay.
    select array_agg(distinct e) into v_known_emails
      from (
          select lower(btrim(v_sale.email::text)) as e
          union all
          select lower(btrim(a.metadata -> 'changes' -> 'email' ->> 'old'))
            from public.audit_events a
           where a.entity_id = v_ticket.entity_id and a.event_type = 'user.email_changed'
             and a.metadata -> 'changes' -> 'email' ->> 'old' is not null
          union all
          select lower(btrim(a.metadata -> 'changes' -> 'email' ->> 'new'))
            from public.audit_events a
           where a.entity_id = v_ticket.entity_id and a.event_type = 'user.email_changed'
             and a.metadata -> 'changes' -> 'email' ->> 'new' is not null
      ) k
     where e is not null and e <> '';

    delete from public.email_delivery_events e
     where e.employee_sale_id = v_sale.id
       and lower(e.recipient_email_snapshot) = any (coalesce(v_known_emails, '{}'));
    get diagnostics v_purged = row_count;

    select count(*) into v_retained
      from public.email_delivery_events e
     where e.employee_sale_id = v_sale.id;

    -- (c) The Nora identity. The sales guard checks the capability; the six
    --     W2 NO ACTION FKs are checked at the end of this statement — any
    --     reference raises 23503 and rolls back the whole GoTrue transaction.
    delete from public.sales where id = v_sale.id and user_id = old.id;
    get diagnostics v_deleted = row_count;
    if v_deleted <> 1 then
        raise exception 'sales row could not be deleted'
            using errcode = 'P0002', detail = 'NORA_EMPLOYEE_IDENTITY_INCONSISTENT';
    end if;

    -- (d) Durable record — same transaction: it exists only if the deletion
    --     commits. Minimal metadata: ids and counts, no address, no name.
    perform nora_private.write_audit_event(
        p_event_type := 'user.account_deleted',
        p_entity_type := 'sales',
        p_entity_id := v_ticket.entity_id,
        p_changes := jsonb_build_object(
            'account', jsonb_build_object('old', 'exists', 'new', 'deleted')
        ),
        p_metadata := jsonb_build_object(
            'sale_id', v_sale.id,
            'employee_sale_id', v_sale.id,
            'actor_sale_id', v_actor.id,
            'role', v_sale.role,
            'disabled', v_sale.disabled,
            'eligibility', v_ticket.eligibility_snapshot,
            'sessions_removed', v_sessions,
            'email_change_tickets_removed', v_email_tickets,
            'email_delivery_events_purged', v_purged,
            'email_delivery_events_retained', v_retained,
            'audit_events_as_target_retained', v_audit_as_target,
            'provider_audit_record', true
        ),
        p_retention_class := 'user_management',
        p_source := 'user'
    );

    -- (e) The ticket is single-use; the capability and the actor context end here.
    delete from nora_private.sales_account_deletion_tickets where id = v_ticket.id;
    perform set_config('nora.account_deletion_ticket', '', true);
    perform nora_private.pin_audit_context(null, null);

    return old;
end;
$$;

alter function nora_private.guard_auth_user_delete() owner to postgres;

revoke all on function nora_private.guard_auth_user_delete() from public;
revoke all on function nora_private.guard_auth_user_delete() from anon;
revoke all on function nora_private.guard_auth_user_delete() from authenticated;
revoke all on function nora_private.guard_auth_user_delete() from service_role;

comment on function nora_private.guard_auth_user_delete() is
    'W6-B: BEFORE DELETE ON auth.users. For an Auth user with a Nora sales row: refuses without a live matching ticket (NORA_ACCOUNT_DELETE_NOT_AUTHORIZED); with one, re-validates the identity snapshot (NORA_EMPLOYEE_IDENTITY_INCONSISTENT), the actor and the eligibility, restores the verified actor/operation (pin_audit_context), removes sessions, W4 tickets and attributable delivery rows, deletes public.sales (guarded; the six W2 FKs abort the whole transaction on any reference), writes user.account_deleted and consumes the ticket — all inside GoTrue''s DELETE transaction. Auth users without a sales row pass through untouched.';

drop trigger if exists guard_auth_user_delete_trigger on auth.users;

create trigger guard_auth_user_delete_trigger
    before delete on auth.users
    for each row
    execute function nora_private.guard_auth_user_delete();

-- ---------------------------------------------------------------------------
-- 10. Self-check before commit
-- ---------------------------------------------------------------------------
do $$
declare
    v_count integer;
begin
    if not exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'guard_auth_user_delete_trigger' and not tgisinternal) then
        raise exception 'W6-B self-check: auth.users guard trigger missing';
    end if;
    if not exists (select 1 from pg_trigger where tgrelid = 'public.sales'::regclass and tgname = 'guard_sales_delete_trigger' and not tgisinternal) then
        raise exception 'W6-B self-check: sales guard trigger missing';
    end if;

    select count(*) into v_count from pg_constraint where contype = 'f' and confrelid = 'public.sales'::regclass and confdeltype <> 'a';
    if v_count <> 0 then
        raise exception 'W6-B self-check: a non-NO ACTION reference on sales.id appeared';
    end if;

    if has_function_privilege('authenticated', 'public.prepare_employee_account_deletion(uuid, bigint, text, boolean, uuid)', 'EXECUTE')
       or has_function_privilege('anon', 'public.get_employee_deletion_preview(bigint)', 'EXECUTE')
       or has_function_privilege('service_role', 'nora_private.employee_deletion_preview(bigint)', 'EXECUTE')
       or has_table_privilege('service_role', 'nora_private.sales_account_deletion_tickets', 'SELECT') then
        raise exception 'W6-B self-check: privilege contract violated';
    end if;

    raise notice 'W6-B self-check passed';
end;
$$;
