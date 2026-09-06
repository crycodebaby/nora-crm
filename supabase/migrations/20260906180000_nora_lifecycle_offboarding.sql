-- Nora User Lifecycle W5 (2026-09-06): controlled offboarding, session
-- revocation and a dependency preview.
--
-- Why (proven locally against GoTrue 2.196 / PostgREST, see
-- docs/nora/06-decision-log.md "2026-09-06 – User Lifecycle W5"):
--   * Disabling an employee (W1) sets sales.disabled and an Auth ban. The ban
--     stops refresh and new logins; RLS denies every business row at once.
--     But GoTrue offers no server-side way to end another user's sessions
--     (no admin logout endpoint; /logout needs the user's own JWT and answers
--     user_banned for a banned one), so auth.sessions / auth.refresh_tokens
--     of a disabled employee simply stay in the database.
--   * PostgREST validates only the JWT signature and expiry. It never checks
--     whether the session named in the token still exists. An access token
--     issued before a disable therefore regains full data access the moment
--     the employee is re-enabled — for the rest of its lifetime (jwt_expiry),
--     without a new login. The same holds for any token whose session was
--     deleted for other reasons.
--
-- What this migration does:
--   1. nora_private.safe_auth_session_id()        session_id claim, or NULL
--      nora_private.jwt_session_is_live()         a JWT that names a session is
--                                                  only trusted while that
--                                                  session row exists
--      nora_private.is_active_user()              + session binding
--      nora_private.current_role()                + session binding
--   2. public.get_employee_dependency_preview     what still depends
--                                                  operationally on an employee
--                                                  (service_role only)
--   3. nora_private.revoke_auth_sessions          deletes the employee's Auth
--                                                  sessions and refresh tokens
--                                                  (postgres-internal)
--   4. public.offboard_employee_by_executor       ONE transaction: disable
--                                                  (W1 guards + audit trigger),
--                                                  revoke sessions, snapshot
--                                                  dependencies, write
--                                                  user.offboarded with the real
--                                                  admin actor (W3)
--
-- Session binding (section 1) is deliberately narrow: a JWT WITHOUT a
-- session_id claim (test fixtures that set request.jwt.claim.sub only, any
-- non-GoTrue context) behaves exactly as before. Only a token that names a
-- session is denied once that session is gone. Every GoTrue-issued user
-- token carries session_id (proven), so a revoked session cannot be resumed
-- by an unexpired token even after reactivation — a fresh login is required.
-- If the helper cannot read auth.sessions at all (privilege missing on the
-- target platform), it logs a WARNING and answers "live" so the pre-W5
-- behaviour remains instead of locking every employee out; the release
-- runbook verifies the privilege read-only before the migration is applied.
--
-- Forward-only and replay-safe: CREATE OR REPLACE, REVOKE followed by an
-- explicit GRANT to a fixed end state. No table privilege is touched, no
-- column is added. Compatible with Postgres 15 (local) and 17 (Production).
-- The deployed users Edge Function v7 keeps working against this migration:
-- it does not call any of the new functions, and the executor it calls is
-- unchanged.

-- ---------------------------------------------------------------------------
-- 1. Session-bound authorization helpers
-- ---------------------------------------------------------------------------

create or replace function nora_private.safe_auth_session_id()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_sid text;
    v_claims text;
begin
    v_sid := nullif(current_setting('request.jwt.claim.session_id', true), '');

    if v_sid is null then
        v_claims := nullif(current_setting('request.jwt.claims', true), '');

        if v_claims is not null then
            begin
                v_sid := nullif(v_claims::jsonb ->> 'session_id', '');
            exception
                when invalid_text_representation then
                    return null;
            end;
        end if;
    end if;

    if v_sid is null then
        return null;
    end if;

    begin
        return v_sid::uuid;
    exception
        when invalid_text_representation then
            return null;
    end;
end;
$$;

alter function nora_private.safe_auth_session_id() owner to postgres;

comment on function nora_private.safe_auth_session_id() is
    'W5: the session_id claim of the current JWT (request.jwt.claim.session_id or request.jwt.claims), NULL when absent or malformed. Internal, not API-exposed.';

revoke all on function nora_private.safe_auth_session_id() from public;
revoke all on function nora_private.safe_auth_session_id() from anon;
revoke all on function nora_private.safe_auth_session_id() from authenticated;
revoke all on function nora_private.safe_auth_session_id() from service_role;
grant execute on function nora_private.safe_auth_session_id() to postgres;

create or replace function nora_private.jwt_session_is_live()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_sid uuid;
begin
    v_sid := nora_private.safe_auth_session_id();
    if v_sid is null then
        -- No session claim: nothing to bind to. Unchanged pre-W5 behaviour
        -- for fixtures and non-GoTrue contexts. A browser cannot remove the
        -- claim from a signed token.
        return true;
    end if;

    begin
        return exists (select 1 from auth.sessions s where s.id = v_sid);
    exception
        when insufficient_privilege or undefined_table then
            raise warning 'nora_private.jwt_session_is_live: auth.sessions not readable (%), session binding inactive', sqlerrm;
            return true;
    end;
end;
$$;

alter function nora_private.jwt_session_is_live() owner to postgres;

comment on function nora_private.jwt_session_is_live() is
    'W5: true when the current JWT carries no session_id claim, or when the auth.sessions row it names still exists. A revoked session is denied immediately even while its access token is cryptographically valid. Internal, not API-exposed.';

revoke all on function nora_private.jwt_session_is_live() from public;
revoke all on function nora_private.jwt_session_is_live() from anon;
revoke all on function nora_private.jwt_session_is_live() from authenticated;
revoke all on function nora_private.jwt_session_is_live() from service_role;
grant execute on function nora_private.jwt_session_is_live() to postgres;

-- Same bodies as before plus the session binding. Owner and grants of the
-- two helpers are preserved by CREATE OR REPLACE.

create or replace function nora_private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.sales s
        where s.user_id = nora_private.safe_auth_uid()
          and s.disabled = false
    )
    and nora_private.jwt_session_is_live();
$$;

comment on function nora_private.is_active_user() is
    'True when the JWT sub maps to a non-disabled sales row AND (W5) the session named by the JWT still exists. Internal RLS helper.';

create or replace function nora_private."current_role"()
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select s.role
    from public.sales s
    where s.user_id = nora_private.safe_auth_uid()
      and s.disabled = false
      and nora_private.jwt_session_is_live()
    limit 1;
$$;

comment on function nora_private."current_role"() is
    'admin|office|viewer for an active employee whose JWT session (W5) still exists; NULL otherwise. Internal RLS helper.';

-- ---------------------------------------------------------------------------
-- 2. Dependency preview — "what still depends operationally on this employee?"
-- ---------------------------------------------------------------------------
-- Current responsibility (the four tables guarded by W2's active-assignment
-- trigger) is counted separately from historical authorship (notes), which
-- never needs reassignment. Deals are counted while not archived, tasks while
-- not done. Counts only — no row data leaves the database.

create or replace function public.get_employee_dependency_preview(
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

    if p_sale_id is null or not exists (select 1 from public.sales where id = p_sale_id) then
        raise exception 'sales profile not found: %', coalesce(p_sale_id::text, '<null>')
            using errcode = 'P0002';
    end if;

    return jsonb_build_object(
        'companies',      (select count(*) from public.companies c where c.sales_id = p_sale_id),
        'contacts',       (select count(*) from public.contacts c where c.sales_id = p_sale_id),
        'open_deals',     (select count(*) from public.deals d where d.sales_id = p_sale_id and d.archived_at is null),
        'open_tasks',     (select count(*) from public.tasks t where t.sales_id = p_sale_id and t.done_date is null),
        'contact_notes',  (select count(*) from public.contact_notes n where n.sales_id = p_sale_id),
        'deal_notes',     (select count(*) from public.deal_notes n where n.sales_id = p_sale_id)
    );
end;
$$;

alter function public.get_employee_dependency_preview(bigint) owner to postgres;

comment on function public.get_employee_dependency_preview(bigint) is
    'W5: counts of what still depends on an employee — current responsibility (companies, contacts, open_deals, open_tasks) and historical authorship (contact_notes, deal_notes). service_role only; reached through the users Edge Function.';

revoke all on function public.get_employee_dependency_preview(bigint) from public;
revoke all on function public.get_employee_dependency_preview(bigint) from anon;
revoke all on function public.get_employee_dependency_preview(bigint) from authenticated;
grant execute on function public.get_employee_dependency_preview(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Session revocation (postgres-internal)
-- ---------------------------------------------------------------------------
-- GoTrue validates /user, /logout and refresh against auth.sessions and
-- auth.refresh_tokens (session_not_found / refresh_token_not_found once the
-- rows are gone — proven). refresh_tokens cascade from sessions; legacy
-- refresh tokens without a session are removed explicitly. Returns the
-- number of sessions removed.

create or replace function nora_private.revoke_auth_sessions(
    p_user_id uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_sessions integer;
begin
    if p_user_id is null then
        return 0;
    end if;

    delete from auth.sessions s where s.user_id = p_user_id;
    get diagnostics v_sessions = row_count;

    delete from auth.refresh_tokens r where r.user_id = p_user_id::text;

    return v_sessions;
end;
$$;

alter function nora_private.revoke_auth_sessions(uuid) owner to postgres;

comment on function nora_private.revoke_auth_sessions(uuid) is
    'W5 internal: deletes every auth.sessions row (refresh tokens cascade) and any remaining auth.refresh_tokens of one Auth user. Returns the number of sessions removed. Not API-exposed; called only by offboard_employee_by_executor.';

revoke all on function nora_private.revoke_auth_sessions(uuid) from public;
revoke all on function nora_private.revoke_auth_sessions(uuid) from anon;
revoke all on function nora_private.revoke_auth_sessions(uuid) from authenticated;
revoke all on function nora_private.revoke_auth_sessions(uuid) from service_role;
grant execute on function nora_private.revoke_auth_sessions(uuid) to postgres;

-- ---------------------------------------------------------------------------
-- 4. Offboarding executor — service_role only, verified actor, one transaction
-- ---------------------------------------------------------------------------
-- Trust boundary (W1/W3 shape):
--   browser (authenticated JWT)
--     -> users Edge Function verifies the JWT and resolves the caller's user id
--     -> supabaseAdmin (service_role) calls this function with ONLY that id,
--        the target sales.id and the request's operation id
--     -> the function refuses non-service_role callers, refuses an actor that
--        is not an existing active administrator, refuses self offboarding,
--        and the last-admin trigger refuses removing the last active admin.
--
-- Inside one transaction:
--   a) sales.disabled := true via nora_private.apply_sales_role_change
--      (unchanged W1 capability path; the audit trigger writes user.disabled
--      with the pinned actor — W3)
--   b) every Auth session / refresh token of the employee is deleted
--   c) the dependency preview is taken
--   d) user.offboarded is written with the real actor, the stable entity id,
--      the operation id and a bounded metadata snapshot
-- Nothing here can leave sales.disabled = true without the sessions gone, or
-- an audit row without the state change: a failure rolls all of it back.
--
-- Disposition (Nora operation-status convention):
--   executed   the call changed something: access was disabled and/or live
--              sessions were revoked → exactly one user.offboarded row
--   replayed   the employee was already disabled and had no live sessions →
--              no state change, no new audit row, no error
-- The Auth ban lives in GoTrue and is applied by the Edge executor after
-- this function returns (W1 ordering: database guards first, Auth second,
-- verification third). A retry after a failed ban is a `replayed` call here
-- and converges the ban there.

create or replace function public.offboard_employee_by_executor(
    p_actor_user_id uuid,
    p_sale_id bigint,
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
    v_was_disabled boolean;
    v_revoked integer;
    v_deps jsonb;
    v_disposition text;
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

    -- The actor parameter never creates privilege: it must name an existing,
    -- active administrator or the call is refused before any write.
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

    -- Self guard: an administrator never ends their own access here. Same
    -- error contract as the W1 executor so the UI wording stays one.
    if v_target.user_id = p_actor_user_id then
        raise exception 'administrators cannot offboard themselves'
            using errcode = '42501', detail = 'NORA_SELF_ACCESS_CHANGE_FORBIDDEN';
    end if;

    v_was_disabled := v_target.disabled;

    -- W3: every audit row of this transaction names the verified actor and
    -- carries the request correlation.
    perform nora_private.pin_audit_context(p_actor_user_id, p_operation_id);

    -- a) Access off — through the one W1 capability path. The last-admin
    --    trigger and the audit trigger (user.disabled) fire here.
    if not v_was_disabled then
        perform nora_private.apply_sales_role_change(p_sale_id, v_target.role, true);
    end if;

    -- b) Sessions gone — same transaction.
    v_revoked := nora_private.revoke_auth_sessions(v_target.user_id);

    -- c) What still depends on this person (counts only).
    v_deps := public.get_employee_dependency_preview(p_sale_id);

    -- d) Business event, once per real change.
    if (not v_was_disabled) or v_revoked > 0 then
        v_disposition := 'executed';
        perform nora_private.write_audit_event(
            p_event_type := 'user.offboarded',
            p_entity_type := 'sales',
            p_entity_id := public.nora_entity_uuid('sales', v_target.id),
            p_changes := jsonb_build_object(
                'disabled', jsonb_build_object('old', v_was_disabled, 'new', true)
            ),
            p_metadata := jsonb_build_object(
                'sale_id', v_target.id,
                'employee_sale_id', v_target.id,
                'employee_email', v_target.email,
                'actor_sale_id', v_actor.id,
                'role', v_target.role,
                'access_already_disabled', v_was_disabled,
                'sessions_revoked', v_revoked,
                'dependencies', v_deps
            ),
            p_retention_class := 'user_management',
            p_source := 'user'
        );
    else
        v_disposition := 'replayed';
    end if;

    perform nora_private.pin_audit_context(null, null);

    select * into v_target from public.sales where id = p_sale_id;

    return jsonb_build_object(
        'id', v_target.id,
        'user_id', v_target.user_id,
        'role', v_target.role,
        'disabled', v_target.disabled,
        'disposition', v_disposition,
        'sessions_revoked', v_revoked,
        'dependencies', v_deps
    );
end;
$$;

alter function public.offboard_employee_by_executor(uuid, bigint, uuid) owner to postgres;

comment on function public.offboard_employee_by_executor(uuid, bigint, uuid) is
    'W5 offboarding executor: service_role only. p_actor_user_id must be an active admin (verified by the users Edge Function from the caller JWT). In one transaction: sales.disabled := true through apply_sales_role_change (last-admin trigger, user.disabled audit), all Auth sessions/refresh tokens of the employee deleted, dependency counts taken, user.offboarded written (actor, stable entity, request_id). Refuses self (NORA_SELF_ACCESS_CHANGE_FORBIDDEN). disposition executed|replayed — a replay changes nothing and writes no audit row. The Auth ban is applied by the Edge executor afterwards.';

revoke all on function public.offboard_employee_by_executor(uuid, bigint, uuid) from public;
revoke all on function public.offboard_employee_by_executor(uuid, bigint, uuid) from anon;
revoke all on function public.offboard_employee_by_executor(uuid, bigint, uuid) from authenticated;
grant execute on function public.offboard_employee_by_executor(uuid, bigint, uuid) to service_role;
