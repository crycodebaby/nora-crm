-- Nora User Lifecycle W1 (2026-09-04): single privileged executor for employee
-- access mutations + database-level access invariants.
--
-- Why (proven locally against the origin/main schema, see docs/nora/06-decision-log.md
-- "2026-09-04 – User Lifecycle W1"):
--   * public.set_sales_role_by_admin was EXECUTE for `authenticated`. Any admin
--     browser session could call it directly and set sales.disabled without the
--     Supabase Auth ban that the users Edge Function applies. The two facts that
--     together mean "Zugang deaktiviert" drifted apart (one live case).
--   * Nothing outside the React form stopped an administrator from disabling or
--     demoting themselves, or from removing the last active administrator.
--
-- What this migration does:
--   1. nora_private.active_admin_count(...)     one definition of "active administrator"
--   2. nora_private.guard_last_active_admin()  BEFORE UPDATE trigger on public.sales
--   3. public.set_sales_access_by_executor(...) service_role-only executor with a
--                                              verified actor context (self guard)
--   4. public.set_sales_role_by_admin           service_role only; EXECUTE revoked
--                                              from authenticated; body hardened
--
-- Forward-only and replay-safe: CREATE OR REPLACE, DROP TRIGGER IF EXISTS, and
-- REVOKE followed by explicit GRANT to a fixed end state. No table privilege
-- is touched. Compatible with Postgres 15 (local) and 17 (Production).
--
-- Trust boundary of the executor (section 3):
--   browser (authenticated JWT)
--     -> users Edge Function verifies the JWT and resolves the caller's user id
--     -> supabaseAdmin (service_role JWT) calls set_sales_access_by_executor(actor, ...)
--     -> the function refuses any non-service_role caller, refuses an actor that
--        is not an existing active administrator, refuses self changes, and
--        delegates the UPDATE to nora_private.apply_sales_role_change (owner
--        nora_role_manager) where the last-admin trigger fires.
--   The actor parameter can only narrow what is allowed, never widen it: a
--   browser cannot execute the function at all, and a forged actor id that is
--   not an active admin is rejected before any write.

-- ---------------------------------------------------------------------------
-- 1. "Active administrator" — encoded once
-- ---------------------------------------------------------------------------
-- role = 'admin' AND disabled = false. The Supabase Auth ban is deliberately
-- NOT part of this definition: the database cannot read GoTrue state inside a
-- transaction, and an invariant that depends on unreadable cross-system state
-- would be wrong under load. The Auth side is reconciled by the Edge executor
-- and reported as accessConsistency (see users/accessState.ts).
--
-- VOLATILE on purpose: a STABLE function inside a row trigger would not see
-- rows already changed by the same statement, so a multi-row UPDATE could
-- demote two administrators in one go and leave zero.

create or replace function nora_private.active_admin_count(
    p_exclude_sale_id bigint default null
)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
    select count(*)::integer
    from public.sales s
    where s.role = 'admin'
      and s.disabled = false
      and (p_exclude_sale_id is null or s.id <> p_exclude_sale_id);
$$;

alter function nora_private.active_admin_count(bigint) owner to postgres;

comment on function nora_private.active_admin_count(bigint) is
    'W1: number of sales rows with role = admin and disabled = false, optionally excluding one row. The single definition of "active administrator" used by the last-admin guard. Internal, not API-exposed.';

revoke all on function nora_private.active_admin_count(bigint) from public;
revoke all on function nora_private.active_admin_count(bigint) from anon;
revoke all on function nora_private.active_admin_count(bigint) from authenticated;
revoke all on function nora_private.active_admin_count(bigint) from service_role;
grant execute on function nora_private.active_admin_count(bigint) to postgres;

-- ---------------------------------------------------------------------------
-- 2. Last-active-admin invariant (database, every write path)
-- ---------------------------------------------------------------------------
-- Fires only when a row LEAVES the active-admin set (demotion or disable of an
-- active admin). Competing removals are serialized with a transaction-scoped
-- advisory lock so two sessions cannot both see "two admins left" and both
-- proceed. Key (89142421, 2); (89142421, 1) is the first-signup lock.
--
-- DELETE is intentionally not guarded here: no supported Nora path deletes a
-- sales row today, and the delete guard belongs to the reference-integrity
-- wave (W2) together with the FK changes.

create or replace function nora_private.guard_last_active_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_remaining integer;
begin
    if not (old.role = 'admin' and old.disabled = false) then
        return new;
    end if;
    if new.role = 'admin' and new.disabled = false then
        return new;
    end if;

    perform pg_catalog.pg_advisory_xact_lock(89142421, 2);

    v_remaining := nora_private.active_admin_count(old.id);
    if v_remaining < 1 then
        raise exception 'at least one active administrator must remain'
            using errcode = '23514',
                  detail = 'NORA_LAST_ACTIVE_ADMIN_REQUIRED';
    end if;

    return new;
end;
$$;

alter function nora_private.guard_last_active_admin() owner to postgres;

comment on function nora_private.guard_last_active_admin() is
    'W1: refuses any UPDATE of public.sales that would leave zero rows with role = admin and disabled = false. DETAIL = NORA_LAST_ACTIVE_ADMIN_REQUIRED.';

revoke all on function nora_private.guard_last_active_admin() from public;
revoke all on function nora_private.guard_last_active_admin() from anon;
revoke all on function nora_private.guard_last_active_admin() from authenticated;
revoke all on function nora_private.guard_last_active_admin() from service_role;

drop trigger if exists guard_last_active_admin_trigger on public.sales;

create trigger guard_last_active_admin_trigger
    before update of role, disabled on public.sales
    for each row
    execute function nora_private.guard_last_active_admin();

-- ---------------------------------------------------------------------------
-- 3. Executor RPC — service_role only, verified actor, self guard
-- ---------------------------------------------------------------------------
-- p_role / p_disabled: NULL keeps the current value. At least one must be
-- given. Returns the resulting row facts so the executor can continue with the
-- Auth side without a second read.

create or replace function public.set_sales_access_by_executor(
    p_actor_user_id uuid,
    p_sale_id bigint,
    p_role text default null,
    p_disabled boolean default null
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

    perform nora_private.apply_sales_role_change(p_sale_id, v_next_role, v_next_disabled);

    select * into v_target from public.sales where id = p_sale_id;

    return jsonb_build_object(
        'id', v_target.id,
        'user_id', v_target.user_id,
        'role', v_target.role,
        'disabled', v_target.disabled
    );
end;
$$;

alter function public.set_sales_access_by_executor(uuid, bigint, text, boolean) owner to postgres;

comment on function public.set_sales_access_by_executor(uuid, bigint, text, boolean) is
    'W1 lifecycle executor: service_role only. p_actor_user_id must be an active admin (verified by the users Edge Function from the caller JWT). Refuses self role/access changes (NORA_SELF_ACCESS_CHANGE_FORBIDDEN); the last-admin trigger refuses removing the last active admin (NORA_LAST_ACTIVE_ADMIN_REQUIRED). Delegates to nora_private.apply_sales_role_change.';

revoke all on function public.set_sales_access_by_executor(uuid, bigint, text, boolean) from public;
revoke all on function public.set_sales_access_by_executor(uuid, bigint, text, boolean) from anon;
revoke all on function public.set_sales_access_by_executor(uuid, bigint, text, boolean) from authenticated;
grant execute on function public.set_sales_access_by_executor(uuid, bigint, text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Close the second path: legacy RPC becomes service_role only
-- ---------------------------------------------------------------------------
-- Kept (not dropped) so the currently deployed users Edge Function keeps
-- working between the Production migration and the Edge deployment. Its body
-- no longer accepts a Nora admin JWT even if EXECUTE were ever re-granted.
-- Removal is planned once no deployed executor calls it (W2).

create or replace function public.set_sales_role_by_admin(
    p_sale_id bigint,
    p_role text,
    p_disabled boolean default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if p_role is null or p_role not in ('admin', 'office', 'viewer') then
        raise exception 'invalid role: %', p_role using errcode = '22023';
    end if;

    if coalesce(nora_private.safe_auth_role(), '') <> 'service_role' then
        raise exception 'forbidden'
            using errcode = '42501', detail = 'NORA_PERMISSION_DENIED';
    end if;

    if not exists (select 1 from public.sales where id = p_sale_id) then
        raise exception 'sales profile not found: %', p_sale_id
            using errcode = 'P0002';
    end if;

    perform nora_private.apply_sales_role_change(p_sale_id, p_role, p_disabled);
end;
$$;

comment on function public.set_sales_role_by_admin(bigint, text, boolean) is
    'Deprecated since W1 (2026-09-04): service_role only, no actor context, no self guard. Kept for the release window of the users Edge Function; use set_sales_access_by_executor. PostgREST: yes, but not executable by authenticated.';

revoke all on function public.set_sales_role_by_admin(bigint, text, boolean) from public;
revoke all on function public.set_sales_role_by_admin(bigint, text, boolean) from anon;
revoke all on function public.set_sales_role_by_admin(bigint, text, boolean) from authenticated;
grant execute on function public.set_sales_role_by_admin(bigint, text, boolean) to service_role;
