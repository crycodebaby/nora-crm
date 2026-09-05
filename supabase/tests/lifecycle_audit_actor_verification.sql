-- Nora User Lifecycle W3 — audit actor correctness & stable employee history
--
-- Self-contained: seeds its own throwaway identities inside one DO block and
-- rolls everything back at the end (the block raises ROLLBACK_W3_TEST and
-- catches it). Safe to run on a fresh `npx supabase db reset --local` with or
-- without rbac_rls_setup.sql.
--
-- Usage (local only):
--   docker exec -i supabase_db_atomic-crm-demo psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/lifecycle_audit_actor_verification.sql
--
-- What it proves:
--   1. privilege contract: record_employee_admin_event and the 5-parameter
--      executor are service_role-only; pin_audit_context is postgres-internal;
--      the old 4-parameter executor signature is gone
--   2. anon / viewer / office / admin browser JWTs cannot write employee audit
--      events through either RPC
--   3. role change / disable / enable through the executor are attributed to
--      the real admin (actor_id, actor_sales_id, name, role) and target the
--      stable employee entity id
--   4. invitation resend / password setup request / invited via the record
--      RPC are attributed the same way, share the same entity id, and keep
--      the pre-W3 metadata keys — derived, never caller-supplied
--   5. forged / invalid / non-admin / disabled actors are refused; an
--      unpinned service_role write is still "System"
--   6. no duplicate business audit on an idempotent re-sync
--   7. operation id becomes request_id; a missing one stays NULL
--   8. metadata hygiene: unknown keys are refused, event types are validated
--   9. the audit context never leaks past the RPC call

\set ON_ERROR_STOP on

\echo '=== W3: lifecycle audit actor verification ==='

-- ---------------------------------------------------------------------------
-- 1. Declarative privilege contract
-- ---------------------------------------------------------------------------
do $$
declare
    v_sig_exec text := 'public.set_sales_access_by_executor(uuid, bigint, text, boolean, uuid)';
    v_sig_rec  text := 'public.record_employee_admin_event(uuid, bigint, text, uuid, jsonb)';
    v_sig_pin  text := 'nora_private.pin_audit_context(uuid, uuid)';
begin
    if to_regprocedure('public.set_sales_access_by_executor(uuid, bigint, text, boolean)') is not null then
        raise exception 'FAIL: old 4-parameter executor signature must be dropped (PostgREST overload)';
    end if;
    if to_regprocedure(v_sig_exec) is null then
        raise exception 'FAIL: 5-parameter executor missing';
    end if;
    if to_regprocedure(v_sig_rec) is null then
        raise exception 'FAIL: record_employee_admin_event missing';
    end if;

    if has_function_privilege('anon', v_sig_exec, 'EXECUTE')
       or has_function_privilege('authenticated', v_sig_exec, 'EXECUTE') then
        raise exception 'FAIL: browser roles may EXECUTE the executor';
    end if;
    if not has_function_privilege('service_role', v_sig_exec, 'EXECUTE') then
        raise exception 'FAIL: service_role must EXECUTE the executor';
    end if;

    if has_function_privilege('anon', v_sig_rec, 'EXECUTE')
       or has_function_privilege('authenticated', v_sig_rec, 'EXECUTE') then
        raise exception 'FAIL: browser roles may EXECUTE record_employee_admin_event';
    end if;
    if not has_function_privilege('service_role', v_sig_rec, 'EXECUTE') then
        raise exception 'FAIL: service_role must EXECUTE record_employee_admin_event';
    end if;

    if has_function_privilege('anon', v_sig_pin, 'EXECUTE')
       or has_function_privilege('authenticated', v_sig_pin, 'EXECUTE')
       or has_function_privilege('service_role', v_sig_pin, 'EXECUTE') then
        raise exception 'FAIL: pin_audit_context must be postgres-internal';
    end if;
    if has_function_privilege('anon', 'nora_private.resolve_audit_actor()', 'EXECUTE')
       or has_function_privilege('authenticated', 'nora_private.resolve_audit_actor()', 'EXECUTE')
       or has_function_privilege('service_role', 'nora_private.resolve_audit_actor()', 'EXECUTE') then
        raise exception 'FAIL: resolve_audit_actor must not be API-executable';
    end if;

    if not exists (
        select 1 from pg_proc p join pg_roles r on r.oid = p.proowner
        where p.oid = v_sig_rec::regprocedure
          and p.prosecdef and r.rolname = 'postgres'
          and p.proconfig::text like '%search_path=%'
    ) then
        raise exception 'FAIL: record_employee_admin_event must be postgres-owned SECURITY DEFINER with pinned search_path';
    end if;
    if not exists (
        select 1 from pg_proc p join pg_roles r on r.oid = p.proowner
        where p.oid = v_sig_exec::regprocedure
          and p.prosecdef and r.rolname = 'postgres'
          and p.proconfig::text like '%search_path=%'
    ) then
        raise exception 'FAIL: executor must be postgres-owned SECURITY DEFINER with pinned search_path';
    end if;

    raise notice 'OK  1. privilege contract';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Behaviour (single subtransaction, rolled back)
-- ---------------------------------------------------------------------------
do $$
declare
    v_admin_a uuid := 'c3000000-0000-4000-8000-00000000000a';
    v_admin_b uuid := 'c3000000-0000-4000-8000-00000000000b';
    v_office  uuid := 'c3000000-0000-4000-8000-00000000000c';
    v_viewer  uuid := 'c3000000-0000-4000-8000-00000000000d';
    v_target  uuid := 'c3000000-0000-4000-8000-00000000000e';
    v_op      uuid := 'd3000000-0000-4000-8000-000000000001';
    v_a bigint;
    v_b bigint;
    v_o bigint;
    v_v bigint;
    v_t bigint;
    v_entity uuid;
    v_json jsonb;
    v_detail text;
    v_count int;
    v_before int;
    v_id uuid;
    r record;
begin
    insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    )
    values
        ('00000000-0000-0000-0000-000000000000', v_admin_a, 'authenticated', 'authenticated', 'w3-admin-a@nora.test', 'x', now(), '{"provider":"email"}', '{"first_name":"Wanda","last_name":"AdminA"}', now(), now()),
        ('00000000-0000-0000-0000-000000000000', v_admin_b, 'authenticated', 'authenticated', 'w3-admin-b@nora.test', 'x', now(), '{"provider":"email"}', '{"first_name":"Wolf","last_name":"AdminB"}', now(), now()),
        ('00000000-0000-0000-0000-000000000000', v_office,  'authenticated', 'authenticated', 'w3-office@nora.test',  'x', now(), '{"provider":"email"}', '{"first_name":"Olga","last_name":"Office"}', now(), now()),
        ('00000000-0000-0000-0000-000000000000', v_viewer,  'authenticated', 'authenticated', 'w3-viewer@nora.test',  'x', now(), '{"provider":"email"}', '{"first_name":"Vera","last_name":"Viewer"}', now(), now()),
        ('00000000-0000-0000-0000-000000000000', v_target,  'authenticated', 'authenticated', 'w3-target@nora.test',  'x', null,  '{"provider":"email"}', '{"first_name":"Peter","last_name":"Target"}', now(), now());

    select id into v_a from public.sales where user_id = v_admin_a;
    select id into v_b from public.sales where user_id = v_admin_b;
    select id into v_o from public.sales where user_id = v_office;
    select id into v_v from public.sales where user_id = v_viewer;
    select id into v_t from public.sales where user_id = v_target;

    perform nora_private.apply_sales_role_change(v_a, 'admin', false);
    perform nora_private.apply_sales_role_change(v_b, 'admin', false);
    perform nora_private.apply_sales_role_change(v_o, 'office', false);
    perform nora_private.apply_sales_role_change(v_v, 'viewer', false);
    perform nora_private.apply_sales_role_change(v_t, 'viewer', false);

    v_entity := public.nora_entity_uuid('sales', v_t);

    -- -----------------------------------------------------------------------
    -- 2. Browser JWTs (admin / office / viewer / anon) cannot write employee
    --    audit events through either RPC
    -- -----------------------------------------------------------------------
    for r in
        select * from (values
            ('authenticated', v_admin_a),
            ('authenticated', v_office),
            ('authenticated', v_viewer),
            ('anon', null::uuid)
        ) as t(jwt_role, uid)
    loop
        perform set_config('request.jwt.claim.role', r.jwt_role, true);
        perform set_config('request.jwt.claim.sub', coalesce(r.uid::text, ''), true);
        perform set_config('request.jwt.claims',
            json_build_object('role', r.jwt_role, 'sub', r.uid)::text, true);
        execute format('set local role %I', r.jwt_role);

        begin
            perform public.record_employee_admin_event(v_admin_a, v_t, 'user.invitation_resent', null, null);
            raise exception 'FAIL: % (%) could call record_employee_admin_event', r.jwt_role, r.uid;
        exception
            when insufficient_privilege then null;
        end;
        begin
            perform public.set_sales_access_by_executor(v_admin_a, v_t, 'office', null, null);
            raise exception 'FAIL: % (%) could call the executor', r.jwt_role, r.uid;
        exception
            when insufficient_privilege then null;
        end;
        reset role;
    end loop;

    if exists (select 1 from public.audit_events where event_type like 'user.%' and metadata->>'sale_id' = v_t::text) then
        raise exception 'FAIL: a refused browser call must not write an audit row';
    end if;
    raise notice 'OK  2. browser roles cannot write employee audit events';

    -- -----------------------------------------------------------------------
    -- 3. Executor events carry the real human actor and the stable target
    -- -----------------------------------------------------------------------
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', 'service_role', true);
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    set local role service_role;

    v_json := public.set_sales_access_by_executor(v_admin_a, v_t, 'office', null, v_op);   -- role change
    v_json := public.set_sales_access_by_executor(v_admin_a, v_t, null, true, null);       -- disable
    v_json := public.set_sales_access_by_executor(v_admin_b, v_t, null, false, null);      -- enable, by B
    reset role;

    select count(*) into v_count from public.audit_events
    where event_type in ('user.role_changed', 'user.disabled', 'user.enabled')
      and metadata->>'sale_id' = v_t::text;
    if v_count <> 3 then
        raise exception 'FAIL: expected 3 executor audit rows, got %', v_count;
    end if;

    for r in
        select * from public.audit_events
        where event_type in ('user.role_changed', 'user.disabled', 'user.enabled')
          and metadata->>'sale_id' = v_t::text
    loop
        if r.entity_type <> 'sales' or r.entity_id <> v_entity then
            raise exception 'FAIL: % entity_id must be nora_entity_uuid(sales, target)', r.event_type;
        end if;
        if r.retention_class <> 'user_management' then
            raise exception 'FAIL: % retention_class', r.event_type;
        end if;
        if r.event_type = 'user.enabled' then
            if r.actor_id is distinct from v_admin_b or r.actor_sales_id is distinct from v_b
               or r.actor_name_snapshot <> 'Wolf AdminB' or r.actor_role_snapshot <> 'admin' then
                raise exception 'FAIL: user.enabled must be attributed to admin B (got %, %, %)', r.actor_id, r.actor_name_snapshot, r.actor_role_snapshot;
            end if;
        else
            if r.actor_id is distinct from v_admin_a or r.actor_sales_id is distinct from v_a
               or r.actor_name_snapshot <> 'Wanda AdminA' or r.actor_role_snapshot <> 'admin' then
                raise exception 'FAIL: % must be attributed to admin A (got %, %, %)', r.event_type, r.actor_id, r.actor_name_snapshot, r.actor_role_snapshot;
            end if;
        end if;
        -- actor and target are different concepts: the target is never the actor here
        if r.actor_sales_id = v_t then
            raise exception 'FAIL: actor_sales_id must not be the target';
        end if;
    end loop;

    -- operation id: given → request_id; absent → NULL
    if (select request_id from public.audit_events where event_type = 'user.role_changed' and metadata->>'sale_id' = v_t::text) is distinct from v_op::text then
        raise exception 'FAIL: request_id must equal the supplied operation id';
    end if;
    if (select request_id from public.audit_events where event_type = 'user.disabled' and metadata->>'sale_id' = v_t::text) is not null then
        raise exception 'FAIL: request_id must be NULL without an operation id';
    end if;
    raise notice 'OK  3. executor events: actor = admin, target = stable employee entity, operation correlated';

    -- -----------------------------------------------------------------------
    -- 4. Edge-originated events through record_employee_admin_event
    -- -----------------------------------------------------------------------
    set local role service_role;
    v_id := public.record_employee_admin_event(v_admin_a, v_t, 'user.invited', v_op, '{"role":"office"}'::jsonb);
    v_id := public.record_employee_admin_event(v_admin_a, v_t, 'user.invitation_resent', null, null);
    v_id := public.record_employee_admin_event(v_admin_b, v_t, 'user.password_setup_requested', v_op, '{}'::jsonb);
    reset role;

    for r in
        select * from public.audit_events
        where event_type in ('user.invited', 'user.invitation_resent', 'user.password_setup_requested')
          and metadata->>'sale_id' = v_t::text
    loop
        if r.entity_type <> 'sales' or r.entity_id <> v_entity then
            raise exception 'FAIL: % entity_id must be the stable employee entity', r.event_type;
        end if;
        if r.retention_class <> 'user_management' or r.source <> 'user' then
            raise exception 'FAIL: % retention/source', r.event_type;
        end if;
        if r.event_type = 'user.password_setup_requested' then
            if r.actor_id is distinct from v_admin_b or r.actor_sales_id is distinct from v_b
               or r.actor_name_snapshot <> 'Wolf AdminB' or r.actor_role_snapshot <> 'admin' then
                raise exception 'FAIL: password setup must be attributed to admin B';
            end if;
            if (r.metadata->>'actor_sale_id')::bigint <> v_b
               or (r.metadata->>'employee_sale_id')::bigint <> v_t
               or r.metadata->>'employee_email' <> 'w3-target@nora.test' then
                raise exception 'FAIL: password setup metadata facts (%)', r.metadata;
            end if;
        elsif r.event_type = 'user.invitation_resent' then
            if r.actor_id is distinct from v_admin_a or r.actor_name_snapshot <> 'Wanda AdminA' then
                raise exception 'FAIL: resend must be attributed to admin A';
            end if;
            if (r.metadata->>'actor_sale_id')::bigint <> v_a
               or (r.metadata->>'employee_sale_id')::bigint <> v_t
               or r.metadata->>'employee_email' <> 'w3-target@nora.test' then
                raise exception 'FAIL: resend metadata facts (%)', r.metadata;
            end if;
            if r.request_id is not null then
                raise exception 'FAIL: resend without operation id must have NULL request_id';
            end if;
        else
            if r.actor_id is distinct from v_admin_a or r.actor_sales_id is distinct from v_a
               or r.actor_name_snapshot <> 'Wanda AdminA' or r.actor_role_snapshot <> 'admin' then
                raise exception 'FAIL: invited must be attributed to admin A';
            end if;
            if (r.metadata->>'invitee_sale_id')::bigint <> v_t
               or r.metadata->>'invitee_email' <> 'w3-target@nora.test'
               or r.metadata->>'role' <> 'office'
               or (r.metadata->>'actor_sale_id')::bigint <> v_a then
                raise exception 'FAIL: invited metadata facts (%)', r.metadata;
            end if;
            if r.request_id is distinct from v_op::text then
                raise exception 'FAIL: invited request_id must be the operation id';
            end if;
        end if;
        -- hygiene: nothing beyond the derived business facts
        if r.metadata ?| array['token', 'access_token', 'refresh_token', 'otp', 'password', 'user', 'raw'] then
            raise exception 'FAIL: forbidden metadata key present';
        end if;
    end loop;

    -- same employee → one entity id across all six user.* events
    select count(distinct entity_id) into v_count from public.audit_events
    where event_type like 'user.%' and metadata->>'sale_id' = v_t::text;
    if v_count <> 1 then
        raise exception 'FAIL: expected one entity_id across all employee events, got %', v_count;
    end if;
    select count(*) into v_count from public.audit_events
    where event_type like 'user.%' and metadata->>'sale_id' = v_t::text;
    if v_count <> 6 then
        raise exception 'FAIL: expected 6 employee events, got %', v_count;
    end if;
    raise notice 'OK  4. edge-originated events: real actor, stable target, derived metadata';

    -- -----------------------------------------------------------------------
    -- 5. Actor rules on the record RPC + unpinned service_role stays System
    -- -----------------------------------------------------------------------
    set local role service_role;
    -- forged / unknown actor
    begin
        perform public.record_employee_admin_event(gen_random_uuid(), v_t, 'user.invitation_resent', null, null);
        raise exception 'FAIL: unknown actor accepted';
    exception
        when others then
            get stacked diagnostics v_detail = pg_exception_detail;
            if v_detail is distinct from 'NORA_PERMISSION_DENIED' then raise; end if;
    end;
    -- office / viewer as actor
    begin
        perform public.record_employee_admin_event(v_office, v_t, 'user.invitation_resent', null, null);
        raise exception 'FAIL: office actor accepted';
    exception
        when others then
            get stacked diagnostics v_detail = pg_exception_detail;
            if v_detail is distinct from 'NORA_PERMISSION_DENIED' then raise; end if;
    end;
    begin
        perform public.record_employee_admin_event(v_viewer, v_t, 'user.invitation_resent', null, null);
        raise exception 'FAIL: viewer actor accepted';
    exception
        when others then
            get stacked diagnostics v_detail = pg_exception_detail;
            if v_detail is distinct from 'NORA_PERMISSION_DENIED' then raise; end if;
    end;
    -- null actor / null target / unknown target
    begin
        perform public.record_employee_admin_event(null, v_t, 'user.invitation_resent', null, null);
        raise exception 'FAIL: null actor accepted';
    exception
        when invalid_parameter_value then null;
    end;
    begin
        perform public.record_employee_admin_event(v_admin_a, null, 'user.invitation_resent', null, null);
        raise exception 'FAIL: null target accepted';
    exception
        when invalid_parameter_value then null;
    end;
    begin
        perform public.record_employee_admin_event(v_admin_a, 999999999, 'user.invitation_resent', null, null);
        raise exception 'FAIL: unknown target accepted';
    exception
        when no_data_found then null;
    end;
    -- disabled admin as actor (A disables B, then B tries to act)
    v_json := public.set_sales_access_by_executor(v_admin_a, v_b, null, true, null);
    begin
        perform public.record_employee_admin_event(v_admin_b, v_t, 'user.invitation_resent', null, null);
        raise exception 'FAIL: disabled admin accepted as actor';
    exception
        when others then
            get stacked diagnostics v_detail = pg_exception_detail;
            if v_detail is distinct from 'NORA_PERMISSION_DENIED' then raise; end if;
    end;
    v_json := public.set_sales_access_by_executor(v_admin_a, v_b, null, false, null);
    reset role;

    -- an unpinned privileged write (genuine automation) is still "System"
    perform nora_private.pin_audit_context(null, null);
    perform set_config('request.jwt.claim.role', 'service_role', true);
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    select * into r from nora_private.resolve_audit_actor() limit 1;
    if r.actor_name <> 'System' or r.actor_auth_id is not null then
        raise exception 'FAIL: unpinned service_role must resolve to System (got %)', r.actor_name;
    end if;

    -- a pinned id that names nobody fails hard (never a silent System row)
    perform nora_private.pin_audit_context(gen_random_uuid(), null);
    begin
        select * into r from nora_private.resolve_audit_actor() limit 1;
        raise exception 'FAIL: nonexistent pinned actor resolved to %', r.actor_name;
    exception
        when others then
            get stacked diagnostics v_detail = pg_exception_detail;
            if v_detail is distinct from 'NORA_AUDIT_ACTOR_INVALID' then raise; end if;
    end;
    perform nora_private.pin_audit_context(null, null);

    -- a pinned id is ignored when a JWT sub is present (browser identity wins)
    perform nora_private.pin_audit_context(v_admin_b, null);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', v_admin_a::text, true);
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_admin_a::text)::text, true);
    select * into r from nora_private.resolve_audit_actor() limit 1;
    if r.actor_auth_id is distinct from v_admin_a then
        raise exception 'FAIL: JWT sub must win over a pinned actor';
    end if;
    -- and under anon (no service_role claim) the pin is ignored as well
    perform set_config('request.jwt.claim.role', 'anon', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    select * into r from nora_private.resolve_audit_actor() limit 1;
    if r.actor_name <> 'System' then
        raise exception 'FAIL: anon must never resolve a pinned actor';
    end if;
    perform nora_private.pin_audit_context(null, null);
    raise notice 'OK  5. forged, invalid, non-admin and disabled actors refused; System only for unpinned automation';

    -- -----------------------------------------------------------------------
    -- 6. No duplicate business audit on an idempotent re-sync
    -- -----------------------------------------------------------------------
    perform set_config('request.jwt.claim.role', 'service_role', true);
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    set local role service_role;
    v_json := public.set_sales_access_by_executor(v_admin_a, v_t, null, true, null);
    reset role;
    select count(*) into v_before from public.audit_events
    where event_type = 'user.disabled' and metadata->>'sale_id' = v_t::text;
    set local role service_role;
    v_json := public.set_sales_access_by_executor(v_admin_a, v_t, null, true, v_op); -- re-sync
    v_json := public.set_sales_access_by_executor(v_admin_a, v_t, 'office', true, v_op); -- unchanged pair
    reset role;
    select count(*) into v_count from public.audit_events
    where event_type = 'user.disabled' and metadata->>'sale_id' = v_t::text;
    if v_count <> v_before then
        raise exception 'FAIL: idempotent re-sync wrote a duplicate user.disabled';
    end if;
    raise notice 'OK  6. no duplicate business audit on re-sync';

    -- -----------------------------------------------------------------------
    -- 7. Metadata hygiene and event-type validation on the record RPC
    -- -----------------------------------------------------------------------
    set local role service_role;
    begin
        perform public.record_employee_admin_event(v_admin_a, v_t, 'user.role_changed', null, null);
        raise exception 'FAIL: trigger-owned event type accepted by the record RPC';
    exception
        when invalid_parameter_value then null;
    end;
    begin
        perform public.record_employee_admin_event(v_admin_a, v_t, 'company.created', null, null);
        raise exception 'FAIL: foreign event type accepted';
    exception
        when invalid_parameter_value then null;
    end;
    begin
        perform public.record_employee_admin_event(v_admin_a, v_t, 'user.invited', null, '{"role":"office","invite_token":"abc"}'::jsonb);
        raise exception 'FAIL: unknown metadata key accepted';
    exception
        when invalid_parameter_value then null;
    end;
    begin
        perform public.record_employee_admin_event(v_admin_a, v_t, 'user.invited', null, '{"actor_sale_id": 1}'::jsonb);
        raise exception 'FAIL: caller-supplied actor_sale_id accepted';
    exception
        when invalid_parameter_value then null;
    end;
    begin
        perform public.record_employee_admin_event(v_admin_a, v_t, 'user.invited', null, '{"role":"superuser"}'::jsonb);
        raise exception 'FAIL: invalid role accepted';
    exception
        when invalid_parameter_value then null;
    end;
    begin
        perform public.record_employee_admin_event(v_admin_a, v_t, 'user.invited', null, '["role"]'::jsonb);
        raise exception 'FAIL: non-object metadata accepted';
    exception
        when invalid_parameter_value then null;
    end;
    reset role;
    select count(*) into v_count from public.audit_events
    where event_type like 'user.%' and metadata->>'sale_id' = v_t::text;
    if v_count <> 7 then
        raise exception 'FAIL: refused calls must not write rows (expected 7, got %)', v_count;
    end if;
    raise notice 'OK  7. metadata hygiene and event-type validation';

    -- -----------------------------------------------------------------------
    -- 8. The audit context never leaks past the RPC
    -- -----------------------------------------------------------------------
    if coalesce(current_setting('nora.audit_actor_user_id', true), '') <> ''
       or coalesce(current_setting('nora.operation_id', true), '') <> '' then
        raise exception 'FAIL: audit context leaked after the RPC returned';
    end if;
    raise notice 'OK  8. audit context cleared after every RPC';

    raise exception 'ROLLBACK_W3_TEST' using errcode = 'P0001';
exception
    when others then
        if sqlerrm not like '%ROLLBACK_W3_TEST%' then
            raise;
        end if;
end;
$$;

do $$
begin
    if exists (select 1 from public.sales where email::text like 'w3-%@nora.test') then
        raise exception 'FAIL: test identities leaked (rollback did not happen)';
    end if;
end;
$$;

select 'lifecycle_audit_actor_verification: OK' as result;
