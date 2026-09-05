-- Nora User Lifecycle W3 (2026-09-05): audit actor correctness and a stable
-- employee target identity for every human-triggered lifecycle action.
--
-- Why (proven locally and read-only against nora-crm-prod, see
-- docs/nora/06-decision-log.md "2026-09-05 – User Lifecycle W3"):
--   * Every user.* audit row written so far carries actor_name_snapshot
--     "System", actor_id NULL and actor_sales_id NULL — although every one of
--     them was triggered by a verified human administrator through the users
--     Edge Function. The Edge Function calls the database with the
--     service_role key; that JWT has no `sub`, so nora_private.safe_auth_uid()
--     is NULL and resolve_audit_actor() answers "System".
--   * The three Edge-written events (user.invited, user.invitation_resent,
--     user.password_setup_requested) used crypto.randomUUID() as entity_id,
--     so the same employee never shared one audit identity across events.
--   * None of these rows carried a request_id: the users Edge Function never
--     forwarded an operation id.
--
-- What this migration does (future rows only; history stays untouched):
--   1. nora_private.resolve_audit_actor()      trusted actor bridge: when the
--                                              database call runs as service_role
--                                              (no JWT sub) and the privileged
--                                              executor has pinned a verified
--                                              actor in the transaction-local GUC
--                                              nora.audit_actor_user_id, the
--                                              actor snapshots are resolved from
--                                              public.sales for that user id.
--                                              Any other service_role write stays
--                                              "System" (genuine automation).
--   2. public.set_sales_access_by_executor     gains p_operation_id and pins the
--                                              verified actor + operation for the
--                                              audit trigger inside its own
--                                              transaction.
--   3. public.record_employee_admin_event      narrow service_role-only writer
--                                              for the Edge-originated employee
--                                              events. Actor UUID comes from the
--                                              Edge-verified JWT, everything else
--                                              (snapshots, entity_id, metadata
--                                              facts) is derived in the database.
--
-- Trust boundary (unchanged in shape, now carried into the audit row):
--   browser (authenticated JWT)
--     -> users Edge Function verifies the JWT (JWKS + auth.getUser)
--     -> supabaseAdmin (service_role) calls the executor / record RPC with
--        ONLY the verified user id
--     -> the RPC refuses non-service_role callers and any actor that is not an
--        existing active administrator, pins the actor for the transaction,
--        and the audit writer resolves name/role/sales_id itself.
--   A browser cannot execute either RPC (no EXECUTE, service_role claim check
--   in the body) and cannot set the GUC: with an authenticated JWT the JWT sub
--   always wins and the GUC is never read; with anon there is no service_role
--   claim. The GUC therefore only ever narrows attribution from "System" to a
--   verified human — it can never produce privilege.
--
-- Forward-only and replay-safe: CREATE OR REPLACE, DROP FUNCTION IF EXISTS on
-- the old executor signature, REVOKE followed by explicit GRANT. Compatible
-- with Postgres 15 (local) and 17 (Production). The deployed users Edge
-- Function v5 keeps working against this migration: it calls the executor
-- with the four named parameters and p_operation_id defaults to NULL.

-- ---------------------------------------------------------------------------
-- 1. Actor bridge in resolve_audit_actor()
-- ---------------------------------------------------------------------------
-- Resolution order:
--   a) JWT sub present (browser session)            -> existing behaviour
--   b) no sub, role = service_role, GUC pinned      -> verified human actor
--   c) otherwise                                    -> System
-- (b) fails hard when the pinned id does not name a sales row: a human
-- action must never be silently downgraded to "System", and an audit row
-- must never claim a person that does not exist. Because the audit write
-- happens inside the state-changing transaction, the state change rolls
-- back with it (fail safely).

create or replace function nora_private.resolve_audit_actor()
returns table (
    actor_auth_id uuid,
    actor_sales_id bigint,
    actor_name text,
    actor_role text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_uid uuid;
    v_sale public.sales%rowtype;
    v_pinned text;
    v_pinned_uid uuid;
begin
    v_uid := nora_private.safe_auth_uid();

    if v_uid is null then
        -- W3: privileged server path with a verified human actor pinned by
        -- the executor. Only honoured under the service_role claim.
        if coalesce(nora_private.safe_auth_role(), '') = 'service_role' then
            begin
                v_pinned := nullif(btrim(current_setting('nora.audit_actor_user_id', true)), '');
            exception
                when others then
                    v_pinned := null;
            end;

            if v_pinned is not null then
                begin
                    v_pinned_uid := v_pinned::uuid;
                exception
                    when others then
                        raise exception 'audit actor context is not a uuid'
                            using errcode = '22023', detail = 'NORA_AUDIT_ACTOR_INVALID';
                end;

                select * into v_sale
                from public.sales s
                where s.user_id = v_pinned_uid
                limit 1;

                if not found then
                    raise exception 'audit actor does not resolve to an employee'
                        using errcode = '42501', detail = 'NORA_AUDIT_ACTOR_INVALID';
                end if;

                return query select
                    v_pinned_uid,
                    v_sale.id,
                    trim(v_sale.first_name || ' ' || v_sale.last_name),
                    v_sale.role;
                return;
            end if;
        end if;

        -- Genuine automation (no verified human): System stays valid.
        return query select null::uuid, null::bigint, 'System'::text, null::text;
        return;
    end if;

    select * into v_sale
    from public.sales s
    where s.user_id = v_uid
      and s.disabled = false
    limit 1;

    if not found then
        return query select v_uid, null::bigint, 'Unbekannter Benutzer'::text, null::text;
        return;
    end if;

    return query select
        v_uid,
        v_sale.id,
        trim(v_sale.first_name || ' ' || v_sale.last_name),
        v_sale.role;
end;
$$;

alter function nora_private.resolve_audit_actor() owner to postgres;

comment on function nora_private.resolve_audit_actor() is
    'Audit actor snapshots: JWT sub (browser) or, under service_role only, the verified human pinned in the transaction-local GUC nora.audit_actor_user_id by the lifecycle executor (W3). Unpinned service_role writes stay "System". A pinned id that names no employee raises NORA_AUDIT_ACTOR_INVALID.';

revoke all on function nora_private.resolve_audit_actor() from public;
revoke all on function nora_private.resolve_audit_actor() from anon;
revoke all on function nora_private.resolve_audit_actor() from authenticated;
revoke all on function nora_private.resolve_audit_actor() from service_role;
grant execute on function nora_private.resolve_audit_actor() to postgres;
grant execute on function nora_private.resolve_audit_actor() to nora_audit_writer;

-- ---------------------------------------------------------------------------
-- 2. Internal helper: pin / clear the audit context for one transaction
-- ---------------------------------------------------------------------------
-- set_config(..., true) is transaction-local. PostgREST runs every RPC in its
-- own transaction, and the executor clears the context again before it
-- returns, so nothing leaks into a later statement of the same session.

create or replace function nora_private.pin_audit_context(
    p_actor_user_id uuid,
    p_operation_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
    perform set_config('nora.audit_actor_user_id', coalesce(p_actor_user_id::text, ''), true);
    perform set_config('nora.operation_id', coalesce(lower(p_operation_id::text), ''), true);
end;
$$;

alter function nora_private.pin_audit_context(uuid, uuid) owner to postgres;

comment on function nora_private.pin_audit_context(uuid, uuid) is
    'W3 internal: pins (or with NULLs clears) the transaction-local audit actor and operation id read by resolve_audit_actor() and current_operation_id(). Not API-exposed.';

revoke all on function nora_private.pin_audit_context(uuid, uuid) from public;
revoke all on function nora_private.pin_audit_context(uuid, uuid) from anon;
revoke all on function nora_private.pin_audit_context(uuid, uuid) from authenticated;
revoke all on function nora_private.pin_audit_context(uuid, uuid) from service_role;
grant execute on function nora_private.pin_audit_context(uuid, uuid) to postgres;

-- ---------------------------------------------------------------------------
-- 3. Executor: verified actor + operation id reach the audit trigger
-- ---------------------------------------------------------------------------
-- The old 4-parameter signature is dropped so PostgREST never sees two
-- overloads. Callers that omit p_operation_id (deployed Edge v5) still match.

drop function if exists public.set_sales_access_by_executor(uuid, bigint, text, boolean);

create or replace function public.set_sales_access_by_executor(
    p_actor_user_id uuid,
    p_sale_id bigint,
    p_role text default null,
    p_disabled boolean default null,
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
    v_next_role text;
    v_next_disabled boolean;
begin
    -- Trust boundary: only the privileged server executor may call this.
    if coalesce(nora_private.safe_auth_role(), '') <> 'service_role' then
        raise exception 'forbidden'
            using errcode = '42501', detail = 'NORA_PERMISSION_DENIED';
    end if;

    if p_actor_user_id is null then
        raise exception 'actor required' using errcode = '22023';
    end if;
    if p_role is not null and p_role not in ('admin', 'office', 'viewer') then
        raise exception 'invalid role: %', p_role using errcode = '22023';
    end if;
    if p_role is null and p_disabled is null then
        raise exception 'nothing to change' using errcode = '22023';
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

    v_next_role := coalesce(p_role, v_target.role);
    v_next_disabled := coalesce(p_disabled, v_target.disabled);

    -- Self guard: an administrator must not demote or disable themselves
    -- through the normal lifecycle path. Re-applying the current values is
    -- not a change and stays allowed (idempotent re-sync).
    if v_target.user_id = p_actor_user_id
       and (
           v_next_role is distinct from v_target.role
           or v_next_disabled is distinct from v_target.disabled
       )
    then
        raise exception 'administrators cannot change their own role or access'
            using errcode = '42501', detail = 'NORA_SELF_ACCESS_CHANGE_FORBIDDEN';
    end if;

    -- W3: the audit trigger on public.sales fires inside apply_sales_role_change
    -- (same transaction). Pin the verified actor and the operation id for it,
    -- then clear both again so nothing outlives this call.
    perform nora_private.pin_audit_context(p_actor_user_id, p_operation_id);
    perform nora_private.apply_sales_role_change(p_sale_id, v_next_role, v_next_disabled);
    perform nora_private.pin_audit_context(null, null);

    select * into v_target from public.sales where id = p_sale_id;

    return jsonb_build_object(
        'id', v_target.id,
        'user_id', v_target.user_id,
        'role', v_target.role,
        'disabled', v_target.disabled
    );
end;
$$;

alter function public.set_sales_access_by_executor(uuid, bigint, text, boolean, uuid) owner to postgres;

comment on function public.set_sales_access_by_executor(uuid, bigint, text, boolean, uuid) is
    'W1/W3 lifecycle executor: service_role only. p_actor_user_id must be an active admin (verified by the users Edge Function from the caller JWT) and becomes the audit actor of the resulting user.role_changed / user.disabled / user.enabled events; p_operation_id (optional) becomes their request_id. Refuses self role/access changes (NORA_SELF_ACCESS_CHANGE_FORBIDDEN); the last-admin trigger refuses removing the last active admin (NORA_LAST_ACTIVE_ADMIN_REQUIRED). Delegates to nora_private.apply_sales_role_change.';

revoke all on function public.set_sales_access_by_executor(uuid, bigint, text, boolean, uuid) from public;
revoke all on function public.set_sales_access_by_executor(uuid, bigint, text, boolean, uuid) from anon;
revoke all on function public.set_sales_access_by_executor(uuid, bigint, text, boolean, uuid) from authenticated;
grant execute on function public.set_sales_access_by_executor(uuid, bigint, text, boolean, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Narrow writer for Edge-originated employee events
-- ---------------------------------------------------------------------------
-- Replaces the users Edge Function's use of public.insert_audit_event with
-- crypto.randomUUID() entity ids and caller-supplied metadata. The caller
-- provides: the verified actor id, the target employee id, the event type, an
-- optional operation id and an optional allowlisted metadata object. The
-- database derives everything else: actor snapshots (via the pinned context),
-- the stable entity_id (nora_entity_uuid('sales', id)), and the target facts
-- in metadata. Unknown metadata keys are refused, not dropped, so a future
-- caller cannot smuggle tokens or provider payloads into the audit history.
--
-- Metadata keys stay compatible with the rows written before W3 (sale_id /
-- invitee_* / employee_* / actor_sale_id) so existing queries keep working;
-- actor_sale_id is now derived from the resolved actor, never from the caller.

create or replace function public.record_employee_admin_event(
    p_actor_user_id uuid,
    p_sale_id bigint,
    p_event_type text,
    p_operation_id uuid default null,
    p_metadata jsonb default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_actor public.sales%rowtype;
    v_target public.sales%rowtype;
    v_meta jsonb;
    v_role text;
    v_key text;
    v_id uuid;
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
    if p_event_type is null or p_event_type not in (
        'user.invited',
        'user.invitation_resent',
        'user.password_setup_requested'
    ) then
        raise exception 'unsupported employee event type: %', coalesce(p_event_type, '<null>')
            using errcode = '22023';
    end if;

    -- Same actor rule as the lifecycle executor: an existing, active admin.
    select * into v_actor from public.sales where user_id = p_actor_user_id;
    if not found or v_actor.role <> 'admin' or v_actor.disabled then
        raise exception 'forbidden'
            using errcode = '42501', detail = 'NORA_PERMISSION_DENIED';
    end if;

    select * into v_target from public.sales where id = p_sale_id;
    if not found then
        raise exception 'sales profile not found: %', p_sale_id
            using errcode = 'P0002';
    end if;

    -- Allowlisted caller metadata: only "role" (for user.invited).
    if p_metadata is not null then
        if jsonb_typeof(p_metadata) <> 'object' then
            raise exception 'metadata must be an object' using errcode = '22023';
        end if;
        for v_key in select jsonb_object_keys(p_metadata) loop
            if v_key <> 'role' then
                raise exception 'metadata key not allowed: %', v_key using errcode = '22023';
            end if;
        end loop;
        v_role := p_metadata ->> 'role';
        if v_role is not null and v_role not in ('admin', 'office', 'viewer') then
            raise exception 'invalid role: %', v_role using errcode = '22023';
        end if;
    end if;

    v_meta := jsonb_build_object(
        'sale_id', v_target.id,
        'actor_sale_id', v_actor.id
    );

    if p_event_type = 'user.invited' then
        v_meta := v_meta || jsonb_build_object(
            'invitee_sale_id', v_target.id,
            'invitee_email', v_target.email,
            'role', coalesce(v_role, v_target.role)
        );
    else
        v_meta := v_meta || jsonb_build_object(
            'employee_sale_id', v_target.id,
            'employee_email', v_target.email
        );
    end if;

    perform nora_private.pin_audit_context(p_actor_user_id, p_operation_id);
    v_id := nora_private.write_audit_event(
        p_event_type := p_event_type,
        p_entity_type := 'sales',
        p_entity_id := public.nora_entity_uuid('sales', v_target.id),
        p_metadata := v_meta,
        p_retention_class := 'user_management',
        p_source := 'user'
    );
    perform nora_private.pin_audit_context(null, null);

    return v_id;
end;
$$;

alter function public.record_employee_admin_event(uuid, bigint, text, uuid, jsonb) owner to postgres;

comment on function public.record_employee_admin_event(uuid, bigint, text, uuid, jsonb) is
    'W3: service_role-only audit writer for user.invited / user.invitation_resent / user.password_setup_requested. p_actor_user_id must be an active admin verified by the users Edge Function; actor snapshots, the stable entity_id (nora_entity_uuid(''sales'', id)) and the target facts are derived in the database. Only the metadata key "role" is accepted from the caller.';

revoke all on function public.record_employee_admin_event(uuid, bigint, text, uuid, jsonb) from public;
revoke all on function public.record_employee_admin_event(uuid, bigint, text, uuid, jsonb) from anon;
revoke all on function public.record_employee_admin_event(uuid, bigint, text, uuid, jsonb) from authenticated;
grant execute on function public.record_employee_admin_event(uuid, bigint, text, uuid, jsonb) to service_role;
