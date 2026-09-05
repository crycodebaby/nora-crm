-- Nora User Lifecycle W1 — single executor + access invariants
--
-- Self-contained: seeds its own throwaway identities inside one DO block and
-- rolls everything back at the end (the block raises ROLLBACK_W1_TEST and
-- catches it, so the subtransaction is discarded). Safe to run on a fresh
-- `npx supabase db reset --local` with or without rbac_rls_setup.sql.
--
-- Usage (local only):
--   docker exec -i supabase_db_atomic-crm-demo psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/lifecycle_single_executor_verification.sql
--
-- What it proves:
--   1. privilege contract: no browser role can execute the access RPC;
--      service_role can; internals are postgres-only; the guard trigger exists;
--      the legacy RPC set_sales_role_by_admin is gone (W2)
--   2. a Nora admin JWT (authenticated) is refused on the executor; anon too
--   3. the executor refuses a forged / non-admin / disabled actor
--   4. role change, disable, re-enable through the executor work
--   5. self guard: an admin cannot disable or demote themselves; re-applying
--      unchanged values (re-sync) is allowed
--   6. last active admin cannot be disabled or demoted — through the
--      capability function and a direct owner UPDATE
--   7. two active admins may change each other
--   8. no duplicate audit event on an idempotent re-sync
--   9. the legacy RPC does not exist any more (W2 retired it)

\set ON_ERROR_STOP on

\echo '=== W1: lifecycle single executor verification ==='

-- ---------------------------------------------------------------------------
-- 1. Declarative privilege contract
-- ---------------------------------------------------------------------------
do $$
begin
    -- W2: the legacy RPC is dropped; the executor is the only access RPC.
    if to_regprocedure('public.set_sales_role_by_admin(bigint, text, boolean)') is not null then
        raise exception 'FAIL: legacy RPC set_sales_role_by_admin must not exist (W2)';
    end if;

    if has_function_privilege('authenticated', 'public.set_sales_access_by_executor(uuid, bigint, text, boolean)', 'EXECUTE') then
        raise exception 'FAIL: authenticated may EXECUTE set_sales_access_by_executor';
    end if;
    if has_function_privilege('anon', 'public.set_sales_access_by_executor(uuid, bigint, text, boolean)', 'EXECUTE') then
        raise exception 'FAIL: anon may EXECUTE set_sales_access_by_executor';
    end if;
    if not has_function_privilege('service_role', 'public.set_sales_access_by_executor(uuid, bigint, text, boolean)', 'EXECUTE') then
        raise exception 'FAIL: service_role must EXECUTE set_sales_access_by_executor';
    end if;

    if has_function_privilege('authenticated', 'nora_private.active_admin_count(bigint)', 'EXECUTE')
       or has_function_privilege('service_role', 'nora_private.active_admin_count(bigint)', 'EXECUTE') then
        raise exception 'FAIL: active_admin_count must be postgres-internal';
    end if;
    if has_function_privilege('authenticated', 'nora_private.apply_sales_role_change(bigint, text, boolean)', 'EXECUTE')
       or has_function_privilege('service_role', 'nora_private.apply_sales_role_change(bigint, text, boolean)', 'EXECUTE') then
        raise exception 'FAIL: apply_sales_role_change must stay postgres-only';
    end if;

    if not exists (
        select 1 from pg_trigger
        where tgrelid = 'public.sales'::regclass
          and tgname = 'guard_last_active_admin_trigger'
          and tgenabled <> 'D'
    ) then
        raise exception 'FAIL: guard_last_active_admin_trigger missing or disabled';
    end if;

    if not exists (
        select 1
        from pg_proc p
        join pg_roles r on r.oid = p.proowner
        where p.oid = 'public.set_sales_access_by_executor(uuid, bigint, text, boolean)'::regprocedure
          and p.prosecdef
          and r.rolname = 'postgres'
          and p.proconfig::text like '%search_path=%'
    ) then
        raise exception 'FAIL: executor must be postgres-owned SECURITY DEFINER with a pinned search_path';
    end if;

    raise notice 'OK  1. privilege contract';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Behaviour (single subtransaction, rolled back)
-- ---------------------------------------------------------------------------
do $$
declare
    v_admin_a uuid := 'c1000000-0000-4000-8000-00000000000a';
    v_admin_b uuid := 'c1000000-0000-4000-8000-00000000000b';
    v_office  uuid := 'c1000000-0000-4000-8000-00000000000c';
    v_viewer  uuid := 'c1000000-0000-4000-8000-00000000000d';
    v_a bigint;
    v_b bigint;
    v_o bigint;
    v_v bigint;
    v_json jsonb;
    v_detail text;
    v_count int;
    v_before int;
begin
    -- Seed four identities. handle_new_user creates the sales rows; roles are
    -- then set explicitly so the test does not depend on prior DB contents.
    insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    )
    values
        ('00000000-0000-0000-0000-000000000000', v_admin_a, 'authenticated', 'authenticated', 'w1-admin-a@nora.test', 'x', now(), '{"provider":"email"}', '{"first_name":"W1","last_name":"AdminA"}', now(), now()),
        ('00000000-0000-0000-0000-000000000000', v_admin_b, 'authenticated', 'authenticated', 'w1-admin-b@nora.test', 'x', now(), '{"provider":"email"}', '{"first_name":"W1","last_name":"AdminB"}', now(), now()),
        ('00000000-0000-0000-0000-000000000000', v_office,  'authenticated', 'authenticated', 'w1-office@nora.test',  'x', now(), '{"provider":"email"}', '{"first_name":"W1","last_name":"Office"}', now(), now()),
        ('00000000-0000-0000-0000-000000000000', v_viewer,  'authenticated', 'authenticated', 'w1-viewer@nora.test',  'x', now(), '{"provider":"email"}', '{"first_name":"W1","last_name":"Viewer"}', now(), now());

    select id into v_a from public.sales where user_id = v_admin_a;
    select id into v_b from public.sales where user_id = v_admin_b;
    select id into v_o from public.sales where user_id = v_office;
    select id into v_v from public.sales where user_id = v_viewer;

    perform nora_private.apply_sales_role_change(v_a, 'admin', false);
    perform nora_private.apply_sales_role_change(v_b, 'admin', false);
    perform nora_private.apply_sales_role_change(v_o, 'office', false);
    perform nora_private.apply_sales_role_change(v_v, 'viewer', false);

    -- -----------------------------------------------------------------------
    -- 2. Nora admin JWT (authenticated) is refused on the executor; anon too
    -- -----------------------------------------------------------------------
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', v_admin_a::text, true);
    perform set_config('request.jwt.claims',
        json_build_object('role', 'authenticated', 'sub', v_admin_a::text)::text, true);

    set local role authenticated;
    begin
        perform public.set_sales_access_by_executor(v_admin_a, v_o, 'viewer', null);
        raise exception 'FAIL: authenticated admin could call set_sales_access_by_executor directly';
    exception
        when insufficient_privilege then null;
    end;

    set local role anon;
    begin
        perform public.set_sales_access_by_executor(v_admin_a, v_o, 'viewer', null);
        raise exception 'FAIL: anon could call set_sales_access_by_executor';
    exception
        when insufficient_privilege then null;
    end;
    reset role;

    if (select role from public.sales where id = v_o) <> 'office' then
        raise exception 'FAIL: a refused call must not change anything';
    end if;
    raise notice 'OK  2. browser roles cannot reach the access RPC';

    -- -----------------------------------------------------------------------
    -- 3. Executor with service_role claims: actor validation
    -- -----------------------------------------------------------------------
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', 'service_role', true);
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    set local role service_role;

    -- office user as actor
    begin
        perform public.set_sales_access_by_executor(v_office, v_v, 'office', null);
        raise exception 'FAIL: office actor accepted';
    exception
        when others then
            get stacked diagnostics v_detail = pg_exception_detail;
            if v_detail is distinct from 'NORA_PERMISSION_DENIED' then raise; end if;
    end;
    -- forged / unknown actor
    begin
        perform public.set_sales_access_by_executor(gen_random_uuid(), v_v, 'office', null);
        raise exception 'FAIL: unknown actor accepted';
    exception
        when others then
            get stacked diagnostics v_detail = pg_exception_detail;
            if v_detail is distinct from 'NORA_PERMISSION_DENIED' then raise; end if;
    end;
    -- null actor
    begin
        perform public.set_sales_access_by_executor(null, v_v, 'office', null);
        raise exception 'FAIL: null actor accepted';
    exception
        when invalid_parameter_value then null;
    end;
    -- nothing to change
    begin
        perform public.set_sales_access_by_executor(v_admin_a, v_v, null, null);
        raise exception 'FAIL: empty change accepted';
    exception
        when invalid_parameter_value then null;
    end;
    -- unknown target
    begin
        perform public.set_sales_access_by_executor(v_admin_a, 999999999, 'office', null);
        raise exception 'FAIL: unknown target accepted';
    exception
        when no_data_found then null;
    end;
    raise notice 'OK  3. executor refuses forged, non-admin and empty requests';

    -- -----------------------------------------------------------------------
    -- 4. Happy paths through the executor (actor = admin A)
    -- -----------------------------------------------------------------------
    v_json := public.set_sales_access_by_executor(v_admin_a, v_v, 'office', null);
    if v_json->>'role' <> 'office' or (select role from public.sales where id = v_v) <> 'office' then
        raise exception 'FAIL: role change via executor';
    end if;

    v_json := public.set_sales_access_by_executor(v_admin_a, v_v, null, true);
    if (v_json->>'disabled')::boolean is not true or (select disabled from public.sales where id = v_v) is not true then
        raise exception 'FAIL: disable via executor';
    end if;
    if (v_json->>'role') <> 'office' then
        raise exception 'FAIL: disable must keep the role';
    end if;

    v_json := public.set_sales_access_by_executor(v_admin_a, v_v, null, false);
    if (select disabled from public.sales where id = v_v) is not false then
        raise exception 'FAIL: re-enable via executor';
    end if;

    v_json := public.set_sales_access_by_executor(v_admin_a, v_v, 'viewer', null);
    if (select role from public.sales where id = v_v) <> 'viewer' then
        raise exception 'FAIL: role restore via executor';
    end if;
    if exists (select 1 from public.sales where (role = 'admin') <> administrator) then
        raise exception 'FAIL: role/administrator mirror diverged';
    end if;
    raise notice 'OK  4. role change, disable, re-enable through the executor';

    -- -----------------------------------------------------------------------
    -- 5. Self guard
    -- -----------------------------------------------------------------------
    begin
        perform public.set_sales_access_by_executor(v_admin_a, v_a, null, true);
        raise exception 'FAIL: admin disabled themselves';
    exception
        when others then
            get stacked diagnostics v_detail = pg_exception_detail;
            if v_detail is distinct from 'NORA_SELF_ACCESS_CHANGE_FORBIDDEN' then raise; end if;
    end;
    begin
        perform public.set_sales_access_by_executor(v_admin_a, v_a, 'office', null);
        raise exception 'FAIL: admin demoted themselves';
    exception
        when others then
            get stacked diagnostics v_detail = pg_exception_detail;
            if v_detail is distinct from 'NORA_SELF_ACCESS_CHANGE_FORBIDDEN' then raise; end if;
    end;
    if (select role from public.sales where id = v_a) <> 'admin'
       or (select disabled from public.sales where id = v_a) is not false then
        raise exception 'FAIL: refused self change must not persist anything';
    end if;
    -- re-applying the unchanged values (re-sync) is not a change and passes
    v_json := public.set_sales_access_by_executor(v_admin_a, v_a, 'admin', false);
    raise notice 'OK  5. self guard (change refused, unchanged re-sync allowed)';

    -- -----------------------------------------------------------------------
    -- 6. Two active admins may change each other; disabled admin cannot act
    -- -----------------------------------------------------------------------
    v_json := public.set_sales_access_by_executor(v_admin_a, v_b, null, true);
    if (select disabled from public.sales where id = v_b) is not true then
        raise exception 'FAIL: A could not disable B with A remaining';
    end if;
    begin
        perform public.set_sales_access_by_executor(v_admin_b, v_v, 'office', null);
        raise exception 'FAIL: disabled admin accepted as actor';
    exception
        when others then
            get stacked diagnostics v_detail = pg_exception_detail;
            if v_detail is distinct from 'NORA_PERMISSION_DENIED' then raise; end if;
    end;
    v_json := public.set_sales_access_by_executor(v_admin_a, v_b, null, false);
    v_json := public.set_sales_access_by_executor(v_admin_a, v_b, 'office', null);
    if (select role from public.sales where id = v_b) <> 'office' then
        raise exception 'FAIL: A could not demote B with A remaining';
    end if;
    raise notice 'OK  6. two active admins may change each other';

    -- -----------------------------------------------------------------------
    -- 7. Last active admin (A is now the only one) cannot be removed by any path
    -- -----------------------------------------------------------------------
    reset role;
    if nora_private.active_admin_count(null) <> (select count(*) from public.sales where role = 'admin' and disabled = false) then
        raise exception 'FAIL: active_admin_count definition drifted';
    end if;

    -- Make A the only active administrator regardless of what the database
    -- already contains (e.g. rbac_rls_setup fixtures). Everything in this
    -- block is rolled back, so pre-existing admins are restored afterwards.
    for v_count in
        select s.id from public.sales s
        where s.role = 'admin' and s.disabled = false and s.id <> v_a
    loop
        perform nora_private.apply_sales_role_change(v_count, 'admin', true);
    end loop;
    if nora_private.active_admin_count(null) <> 1 then
        raise exception 'FAIL: could not isolate a single active admin for the guard test';
    end if;

    -- 7a. (W2) the legacy service_role RPC no longer exists; the executor's
    --     own self guard already refuses A acting on A (section 5), so the
    --     remaining direct paths are the capability function and owner UPDATE.
    if to_regprocedure('public.set_sales_role_by_admin(bigint, text, boolean)') is not null then
        raise exception 'FAIL: legacy RPC must be gone';
    end if;

    -- 7b. capability function directly (postgres)
    reset role;
    begin
        perform nora_private.apply_sales_role_change(v_a, 'office', false);
        raise exception 'FAIL: apply_sales_role_change demoted the last admin';
    exception
        when others then
            get stacked diagnostics v_detail = pg_exception_detail;
            if v_detail is distinct from 'NORA_LAST_ACTIVE_ADMIN_REQUIRED' then raise; end if;
    end;

    -- 7c. direct owner UPDATE (break-glass shape) is refused by the guard too
    begin
        update public.sales set disabled = true where id = v_a;
        raise exception 'FAIL: direct UPDATE disabled the last admin';
    exception
        when others then
            get stacked diagnostics v_detail = pg_exception_detail;
            if v_detail is distinct from 'NORA_LAST_ACTIVE_ADMIN_REQUIRED'
               and sqlerrm not like '%immutable%' then
                raise;
            end if;
    end;

    if (select role from public.sales where id = v_a) <> 'admin'
       or (select disabled from public.sales where id = v_a) is not false then
        raise exception 'FAIL: last admin must be untouched after refused attempts';
    end if;
    raise notice 'OK  7. last active admin cannot be disabled or demoted';

    -- -----------------------------------------------------------------------
    -- 8. Audit: events written, no duplicate on idempotent re-sync
    -- -----------------------------------------------------------------------
    set local role service_role;
    perform public.set_sales_access_by_executor(v_admin_a, v_b, 'admin', null);
    perform public.set_sales_access_by_executor(v_admin_a, v_v, null, true);
    reset role;
    select count(*) into v_before from public.audit_events
    where event_type = 'user.disabled' and metadata->>'sale_id' = v_v::text;
    if v_before < 1 then
        raise exception 'FAIL: user.disabled audit event missing';
    end if;
    set local role service_role;
    perform public.set_sales_access_by_executor(v_admin_a, v_v, null, true); -- re-sync, no change
    reset role;
    select count(*) into v_count from public.audit_events
    where event_type = 'user.disabled' and metadata->>'sale_id' = v_v::text;
    if v_count <> v_before then
        raise exception 'FAIL: idempotent re-sync wrote a duplicate audit event';
    end if;
    -- Actor attribution of service_role-driven events is "System" today —
    -- documented, addressed by the audit-actor wave (W3), not by W1.
    raise notice 'OK  8. audit events present, none duplicated by re-sync';

    -- -----------------------------------------------------------------------
    -- 9. Legacy RPC retired (W2): the executor covers the release-window use
    -- -----------------------------------------------------------------------
    set local role service_role;
    perform public.set_sales_access_by_executor(v_admin_a, v_v, 'viewer', false);
    reset role;
    if (select disabled from public.sales where id = v_v) is not false
       or (select role from public.sales where id = v_v) <> 'viewer' then
        raise exception 'FAIL: executor could not restore the viewer';
    end if;
    if to_regprocedure('public.set_sales_role_by_admin(bigint, text, boolean)') is not null then
        raise exception 'FAIL: legacy RPC set_sales_role_by_admin still exists';
    end if;
    raise notice 'OK  9. legacy RPC retired; executor covers every lifecycle write';

    raise exception 'ROLLBACK_W1_TEST' using errcode = 'P0001';
exception
    when others then
        if sqlerrm not like '%ROLLBACK_W1_TEST%' then
            raise;
        end if;
end;
$$;

do $$
begin
    if exists (select 1 from public.sales where email::text like 'w1-%@nora.test') then
        raise exception 'FAIL: test identities leaked (rollback did not happen)';
    end if;
end;
$$;

select 'lifecycle_single_executor_verification: OK' as result;
