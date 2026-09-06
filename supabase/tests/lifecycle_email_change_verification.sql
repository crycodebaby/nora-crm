-- Nora User Lifecycle W4 — controlled employee login-email change
--
-- Self-contained: seeds its own throwaway identities inside one DO block and
-- rolls everything back at the end (the block raises ROLLBACK_W4_TEST and
-- catches it). Safe to run on a fresh `npx supabase db reset --local` with or
-- without rbac_rls_setup.sql.
--
-- Usage (local only):
--   docker exec -i supabase_db_atomic-crm-demo psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/lifecycle_email_change_verification.sql
--
-- What it proves:
--   1. privilege contract: capability role, executor RPCs service_role-only,
--      internal functions postgres-internal, guard trigger on auth.users,
--      unique login email, ticket table closed to API roles
--   2. browser JWTs cannot call the RPCs and cannot write sales.email directly
--   3. prepare refuses: non-admin / disabled actor, self change, unchanged
--      address (also case variants), invalid address, address used by another
--      employee (sales, case-insensitive) or by another Auth identity,
--      inconsistent identity — and leaves no ticket and no audit row
--   4. active employee: ticket + Auth UPDATE move both emails in one
--      transaction, delete the outstanding one-time tokens, consume the
--      ticket and write user.email_changed with the real admin actor, the
--      stable entity, old/new address and the operation id; access state
--      untouched; audit context cleared afterwards
--   5. disabled employee: same, sales.disabled and banned_until untouched,
--      no token created (no invitation)
--   6. Auth email changes WITHOUT a live ticket are refused: none, expired,
--      other address, actor disabled meanwhile — nothing moves
--   7. cancel removes a live ticket once; a consumed ticket is gone
--   8. retry after success is a typed no-op: no second audit row
--   9. identity manager may change email only; role manager still cannot
--  10. handle_update_user no longer writes email; unique index blocks a
--      second employee with the same address (case-insensitive)

\set ON_ERROR_STOP on

\echo '=== W4: lifecycle email change verification ==='

-- ---------------------------------------------------------------------------
-- 1. Declarative privilege contract
-- ---------------------------------------------------------------------------
do $$
declare
    v_prep text := 'public.prepare_sales_email_change(uuid, bigint, text, uuid)';
    v_cancel text := 'public.cancel_sales_email_change(uuid)';
    v_apply text := 'nora_private.apply_sales_email_change(bigint, extensions.citext)';
    v_norm text := 'nora_private.normalize_login_email(text)';
    v_guard text := 'nora_private.guard_auth_email_change()';
    r record;
begin
    if not exists (select 1 from pg_roles where rolname = 'nora_identity_manager' and not rolcanlogin and not rolsuper and not rolbypassrls) then
        raise exception 'FAIL: nora_identity_manager must exist as NOLOGIN, non-super, non-bypassrls';
    end if;

    for r in select unnest(array[v_prep, v_cancel, v_apply, v_norm, v_guard]) as sig loop
        if to_regprocedure(r.sig) is null then
            raise exception 'FAIL: % missing', r.sig;
        end if;
    end loop;

    for r in select unnest(array[v_prep, v_cancel]) as sig loop
        if has_function_privilege('anon', r.sig, 'EXECUTE')
           or has_function_privilege('authenticated', r.sig, 'EXECUTE') then
            raise exception 'FAIL: browser roles may EXECUTE %', r.sig;
        end if;
        if not has_function_privilege('service_role', r.sig, 'EXECUTE') then
            raise exception 'FAIL: service_role must EXECUTE %', r.sig;
        end if;
        if not exists (
            select 1 from pg_proc p join pg_roles o on o.oid = p.proowner
            where p.oid = r.sig::regprocedure and p.prosecdef and o.rolname = 'postgres'
              and p.proconfig::text like '%search_path=%'
        ) then
            raise exception 'FAIL: % must be postgres-owned SECURITY DEFINER with pinned search_path', r.sig;
        end if;
    end loop;

    for r in select unnest(array[v_apply, v_norm, v_guard]) as sig loop
        if has_function_privilege('anon', r.sig, 'EXECUTE')
           or has_function_privilege('authenticated', r.sig, 'EXECUTE')
           or has_function_privilege('service_role', r.sig, 'EXECUTE') then
            raise exception 'FAIL: % must not be API-executable', r.sig;
        end if;
    end loop;

    if not exists (
        select 1 from pg_proc p join pg_roles o on o.oid = p.proowner
        where p.oid = v_apply::regprocedure and p.prosecdef and o.rolname = 'nora_identity_manager'
    ) then
        raise exception 'FAIL: apply_sales_email_change must be owned by nora_identity_manager (SECURITY DEFINER)';
    end if;

    if not exists (
        select 1 from pg_trigger t
        where t.tgrelid = 'auth.users'::regclass and t.tgname = 'guard_auth_email_change_trigger' and not t.tgisinternal
    ) then
        raise exception 'FAIL: guard_auth_email_change_trigger missing on auth.users';
    end if;

    if not exists (
        select 1 from pg_indexes where schemaname = 'public' and tablename = 'sales' and indexname = 'uq__sales__email'
          and indexdef ilike 'create unique index%'
    ) then
        raise exception 'FAIL: uq__sales__email unique index missing';
    end if;

    if not exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'nora_private' and c.relname = 'sales_email_change_tickets' and c.relrowsecurity
    ) then
        raise exception 'FAIL: ticket table missing or without RLS';
    end if;
    if has_table_privilege('anon', 'nora_private.sales_email_change_tickets', 'SELECT')
       or has_table_privilege('authenticated', 'nora_private.sales_email_change_tickets', 'SELECT')
       or has_table_privilege('service_role', 'nora_private.sales_email_change_tickets', 'SELECT') then
        raise exception 'FAIL: ticket table must be closed to API roles';
    end if;

    if not has_column_privilege('nora_identity_manager', 'public.sales', 'email', 'UPDATE') then
        raise exception 'FAIL: identity manager needs UPDATE(email) on sales';
    end if;
    if has_column_privilege('nora_identity_manager', 'public.sales', 'role', 'UPDATE')
       or has_column_privilege('nora_identity_manager', 'public.sales', 'disabled', 'UPDATE') then
        raise exception 'FAIL: identity manager must not hold UPDATE on role/disabled';
    end if;

    if position('email' in (select pg_get_functiondef('public.handle_update_user()'::regprocedure))) > 0
       and (select pg_get_functiondef('public.handle_update_user()'::regprocedure)) ~* 'set[^;]*email\s*=' then
        raise exception 'FAIL: handle_update_user must no longer write sales.email';
    end if;

    raise notice 'OK  1. privilege contract';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Behaviour (single subtransaction, rolled back)
-- ---------------------------------------------------------------------------
do $$
declare
    v_admin_a uuid := 'c4000000-0000-4000-8000-00000000000a';
    v_admin_b uuid := 'c4000000-0000-4000-8000-00000000000b';
    v_office  uuid := 'c4000000-0000-4000-8000-00000000000c';
    v_viewer  uuid := 'c4000000-0000-4000-8000-00000000000d';
    v_active  uuid := 'c4000000-0000-4000-8000-00000000000e';
    v_invited uuid := 'c4000000-0000-4000-8000-00000000000f';
    v_disabled uuid := 'c4000000-0000-4000-8000-000000000010';
    v_ghost   uuid := 'c4000000-0000-4000-8000-000000000011';
    v_op      uuid := 'd4000000-0000-4000-8000-000000000001';
    v_a bigint; v_b bigint; v_o bigint; v_v bigint; v_act bigint; v_inv bigint; v_dis bigint; v_ghost_sale bigint;
    v_json jsonb;
    v_detail text;
    v_sqlstate text;
    v_count int;
    v_audit_before int;
    v_ticket uuid;
    v_before_banned timestamptz;
    r record;
begin
    -- clean JWT context: this DO block plays the JWT-less database session
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);

    insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, banned_until, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    )
    values
        ('00000000-0000-0000-0000-000000000000', v_admin_a, 'authenticated', 'authenticated', 'w4-admin-a@nora.test', 'x', now(), null, '{"provider":"email"}', '{"first_name":"Wanda","last_name":"AdminA"}', now(), now()),
        ('00000000-0000-0000-0000-000000000000', v_admin_b, 'authenticated', 'authenticated', 'w4-admin-b@nora.test', 'x', now(), null, '{"provider":"email"}', '{"first_name":"Wolf","last_name":"AdminB"}', now(), now()),
        ('00000000-0000-0000-0000-000000000000', v_office,  'authenticated', 'authenticated', 'w4-office@nora.test',  'x', now(), null, '{"provider":"email"}', '{"first_name":"Olga","last_name":"Office"}', now(), now()),
        ('00000000-0000-0000-0000-000000000000', v_viewer,  'authenticated', 'authenticated', 'w4-viewer@nora.test',  'x', now(), null, '{"provider":"email"}', '{"first_name":"Vera","last_name":"Viewer"}', now(), now()),
        ('00000000-0000-0000-0000-000000000000', v_active,  'authenticated', 'authenticated', 'w4-active@nora.test',  'x', now(), null, '{"provider":"email"}', '{"first_name":"Anna","last_name":"Active"}', now(), now()),
        ('00000000-0000-0000-0000-000000000000', v_invited, 'authenticated', 'authenticated', 'w4-invited@nora.test', 'x', null,  null, '{"provider":"email"}', '{"first_name":"Ingo","last_name":"Invited"}', now(), now()),
        ('00000000-0000-0000-0000-000000000000', v_disabled,'authenticated', 'authenticated', 'w4-disabled@nora.test','x', now(), now() + interval '10 years', '{"provider":"email"}', '{"first_name":"Dora","last_name":"Disabled"}', now(), now()),
        ('00000000-0000-0000-0000-000000000000', v_ghost,   'authenticated', 'authenticated', 'w4-ghost@nora.test',   'x', now(), null, '{"provider":"email"}', '{"first_name":"Gus","last_name":"Ghost"}', now(), now());

    select id into v_a from public.sales where user_id = v_admin_a;
    select id into v_b from public.sales where user_id = v_admin_b;
    select id into v_o from public.sales where user_id = v_office;
    select id into v_v from public.sales where user_id = v_viewer;
    select id into v_act from public.sales where user_id = v_active;
    select id into v_inv from public.sales where user_id = v_invited;
    select id into v_dis from public.sales where user_id = v_disabled;
    select id into v_ghost_sale from public.sales where user_id = v_ghost;

    perform nora_private.apply_sales_role_change(v_a, 'admin', false);
    perform nora_private.apply_sales_role_change(v_b, 'admin', false);
    perform nora_private.apply_sales_role_change(v_o, 'office', false);
    perform nora_private.apply_sales_role_change(v_v, 'viewer', false);
    perform nora_private.apply_sales_role_change(v_act, 'office', false);
    perform nora_private.apply_sales_role_change(v_inv, 'viewer', false);
    perform nora_private.apply_sales_role_change(v_dis, 'office', true);

    -- an Auth identity that is NOT a Nora employee (unreferenced sales row removed as postgres)
    delete from public.sales where id = v_ghost_sale;

    -- outstanding invitation / password links for the invited and the active employee
    insert into auth.one_time_tokens (id, user_id, token_type, token_hash, relates_to, created_at, updated_at)
    values
        (gen_random_uuid(), v_invited, 'confirmation_token', 'hash-invite-old', 'w4-invited@nora.test', now(), now()),
        (gen_random_uuid(), v_active,  'recovery_token',     'hash-recovery-old', 'w4-active@nora.test', now(), now());

    select count(*) into v_audit_before from public.audit_events where event_type = 'user.email_changed';
    -- W6-A: browser fixtures carry a live session (fixture session id = user id); rolled back
    insert into auth.sessions (id, user_id, created_at, updated_at, aal)
    select u, u, now(), now(), 'aal1' from unnest(array[v_admin_a, v_office, v_viewer]) u;

    -- -----------------------------------------------------------------------
    -- 2. Browser JWTs cannot call the RPCs and cannot write sales.email
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
            case when r.uid is null then json_build_object('role', r.jwt_role)::text
                 else json_build_object('role', r.jwt_role, 'sub', r.uid, 'session_id', r.uid)::text end, true);
        execute format('set local role %I', r.jwt_role);

        begin
            perform public.prepare_sales_email_change(v_admin_a, v_act, 'x@nora.test', null);
            raise exception 'FAIL: % (%) could call prepare_sales_email_change', r.jwt_role, r.uid;
        exception
            when insufficient_privilege then null;
        end;
        begin
            perform public.cancel_sales_email_change(gen_random_uuid());
            raise exception 'FAIL: % (%) could call cancel_sales_email_change', r.jwt_role, r.uid;
        exception
            when insufficient_privilege then null;
        end;

        -- direct write on the own row (RLS allows the row, the trigger refuses the column)
        if r.uid is not null then
            begin
                update public.sales set email = 'hijack@nora.test' where user_id = r.uid;
                raise exception 'FAIL: % could update its own sales.email directly', r.uid;
            exception
                when raise_exception then
                    if sqlerrm not ilike '%immutable%' then
                        raise exception 'FAIL: unexpected refusal text: %', sqlerrm;
                    end if;
            end;
        end if;
        -- direct write on another row: RLS hides it (0 rows) or the role has
        -- no UPDATE at all (anon) — either way nothing changes
        begin
            update public.sales set email = 'hijack@nora.test' where id = v_act;
        exception
            when insufficient_privilege then null;
        end;
        reset role;
        perform set_config('request.jwt.claim.role', '', true);
        perform set_config('request.jwt.claim.sub', '', true);
        perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);
    end loop;
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);

    if (select email from public.sales where id = v_act) <> 'w4-active@nora.test' then
        raise exception 'FAIL: a browser role changed sales.email';
    end if;
    raise notice 'OK  2. browser roles: no RPC, no direct sales.email write';

    -- -----------------------------------------------------------------------
    -- 3. prepare guards (service_role)
    -- -----------------------------------------------------------------------
    perform set_config('request.jwt.claim.role', 'service_role', true);
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    perform set_config('request.jwt.claim.role', 'service_role', true);
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    set local role service_role;

    for r in
        select * from (values
            (v_office,   v_act, 'neu@nora.test',              'NORA_PERMISSION_DENIED',               'office actor'),
            (v_viewer,   v_act, 'neu@nora.test',              'NORA_PERMISSION_DENIED',               'viewer actor'),
            (v_disabled, v_act, 'neu@nora.test',              'NORA_PERMISSION_DENIED',               'disabled actor'),
            (v_ghost,    v_act, 'neu@nora.test',              'NORA_PERMISSION_DENIED',               'non-employee actor'),
            (v_admin_a,  v_a,   'neu@nora.test',              'NORA_SELF_EMAIL_CHANGE_FORBIDDEN',     'self'),
            (v_admin_a,  v_act, 'w4-active@nora.test',        'NORA_EMAIL_UNCHANGED',                 'unchanged'),
            (v_admin_a,  v_act, '  W4-Active@Nora.Test ',     'NORA_EMAIL_UNCHANGED',                 'unchanged (case/space variant)'),
            (v_admin_a,  v_act, 'not-an-email',               'NORA_EMAIL_INVALID',                   'invalid'),
            (v_admin_a,  v_act, 'a b@nora.test',              'NORA_EMAIL_INVALID',                   'invalid (space)'),
            (v_admin_a,  v_act, '',                           'NORA_EMAIL_INVALID',                   'empty'),
            (v_admin_a,  v_act, 'W4-Office@Nora.Test',        'NORA_EMAIL_ALREADY_IN_USE',            'used by another employee (case variant)'),
            (v_admin_a,  v_act, 'w4-ghost@nora.test',         'NORA_EMAIL_ALREADY_IN_USE',            'used by another Auth identity')
        ) as t(actor, target, new_email, expected, label)
    loop
        begin
            perform public.prepare_sales_email_change(r.actor, r.target, r.new_email, v_op);
            raise exception 'FAIL: prepare must refuse: %', r.label;
        exception
            when others then
                get stacked diagnostics v_detail = pg_exception_detail, v_sqlstate = returned_sqlstate;
                if v_detail is distinct from r.expected then
                    raise exception 'FAIL: % → expected %, got % (% / %)', r.label, r.expected, v_detail, v_sqlstate, sqlerrm;
                end if;
        end;
    end loop;

    begin
        perform public.prepare_sales_email_change(v_admin_a, 999999999, 'neu@nora.test', v_op);
        raise exception 'FAIL: prepare must refuse an unknown employee';
    exception
        when no_data_found then null;
    end;

    -- inconsistent identity: sales says X, Auth says Y → refused
    reset role;
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);
    perform nora_private.apply_sales_email_change(v_act, 'w4-active-drift@nora.test'::extensions.citext);
    perform set_config('request.jwt.claim.role', 'service_role', true);
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    set local role service_role;
    begin
        perform public.prepare_sales_email_change(v_admin_a, v_act, 'neu@nora.test', v_op);
        raise exception 'FAIL: prepare must refuse an inconsistent identity';
    exception
        when others then
            get stacked diagnostics v_detail = pg_exception_detail;
            if v_detail is distinct from 'NORA_EMPLOYEE_IDENTITY_INCONSISTENT' then
                raise exception 'FAIL: inconsistent identity → got % (%)', v_detail, sqlerrm;
            end if;
    end;
    reset role;
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);
    perform nora_private.apply_sales_email_change(v_act, 'w4-active@nora.test'::extensions.citext);

    if exists (select 1 from nora_private.sales_email_change_tickets) then
        raise exception 'FAIL: a refused prepare must not leave a ticket';
    end if;
    if (select count(*) from public.audit_events where event_type = 'user.email_changed') <> v_audit_before then
        raise exception 'FAIL: a refused prepare must not write an audit row';
    end if;
    if (select email from public.sales where id = v_act) <> 'w4-active@nora.test'
       or (select email from auth.users where id = v_active) <> 'w4-active@nora.test' then
        raise exception 'FAIL: refused prepares must not move anything';
    end if;
    raise notice 'OK  3. prepare guards: actor, self, unchanged, invalid, in use, inconsistent — nothing moves';

    -- -----------------------------------------------------------------------
    -- 4. Active employee: one transaction moves both, audit attributed
    -- -----------------------------------------------------------------------
    perform set_config('request.jwt.claim.role', 'service_role', true);
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    set local role service_role;
    v_json := public.prepare_sales_email_change(v_admin_a, v_act, '  Anna.Neu@Nora.Test ', v_op);
    reset role;
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);

    if v_json->>'new_email' <> 'anna.neu@nora.test' or v_json->>'old_email' <> 'w4-active@nora.test'
       or (v_json->>'sale_id')::bigint <> v_act or (v_json->>'user_id')::uuid <> v_active
       or (v_json->>'disabled')::boolean or v_json->>'role' <> 'office'
       or not (v_json->>'auth_confirmed')::boolean or (v_json->>'auth_banned')::boolean then
        raise exception 'FAIL: prepare facts (%)', v_json;
    end if;
    v_ticket := (v_json->>'ticket_id')::uuid;
    if (select count(*) from nora_private.sales_email_change_tickets where sale_id = v_act) <> 1 then
        raise exception 'FAIL: exactly one ticket per employee';
    end if;
    -- prepare itself changed nothing
    if (select email from public.sales where id = v_act) <> 'w4-active@nora.test' then
        raise exception 'FAIL: prepare must not write sales.email';
    end if;

    -- the JWT-less database session = GoTrue applying the Admin API update
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);
    update auth.users set email = 'anna.neu@nora.test', updated_at = now() where id = v_active;

    if (select email from public.sales where id = v_act) <> 'anna.neu@nora.test' then
        raise exception 'FAIL: sales.email must follow the Auth email in the same statement';
    end if;
    if (select email from auth.users where id = v_active) <> 'anna.neu@nora.test' then
        raise exception 'FAIL: auth.users.email not updated';
    end if;
    if exists (select 1 from nora_private.sales_email_change_tickets where id = v_ticket) then
        raise exception 'FAIL: ticket must be consumed';
    end if;
    if exists (select 1 from auth.one_time_tokens where user_id = v_active) then
        raise exception 'FAIL: outstanding one-time tokens of the employee must be deleted';
    end if;
    if not exists (select 1 from auth.one_time_tokens where user_id = v_invited) then
        raise exception 'FAIL: tokens of OTHER users must stay';
    end if;
    if (select disabled from public.sales where id = v_act) or (select role from public.sales where id = v_act) <> 'office'
       or (select banned_until from auth.users where id = v_active) is not null then
        raise exception 'FAIL: access state must not move with the email';
    end if;

    select * into r from public.audit_events
     where event_type = 'user.email_changed' and metadata->>'sale_id' = v_act::text;
    if not found then
        raise exception 'FAIL: user.email_changed audit row missing';
    end if;
    if r.actor_id is distinct from v_admin_a or r.actor_sales_id is distinct from v_a
       or r.actor_name_snapshot <> 'Wanda AdminA' or r.actor_role_snapshot <> 'admin' then
        raise exception 'FAIL: user.email_changed must name the real admin (got %, %, %)', r.actor_id, r.actor_name_snapshot, r.actor_role_snapshot;
    end if;
    if r.entity_type <> 'sales' or r.entity_id <> public.nora_entity_uuid('sales', v_act) then
        raise exception 'FAIL: user.email_changed entity must be the stable employee entity';
    end if;
    if r.request_id is distinct from v_op::text then
        raise exception 'FAIL: request_id must be the operation id (got %)', r.request_id;
    end if;
    if r.metadata->'changes'->'email'->>'old' <> 'w4-active@nora.test'
       or r.metadata->'changes'->'email'->>'new' <> 'anna.neu@nora.test'
       or (r.metadata->>'employee_sale_id')::bigint <> v_act
       or (r.metadata->>'actor_sale_id')::bigint <> v_a
       or (r.metadata->>'disabled')::boolean then
        raise exception 'FAIL: user.email_changed metadata (%)', r.metadata;
    end if;
    if r.retention_class <> 'user_management' or r.source <> 'user' then
        raise exception 'FAIL: user.email_changed retention/source';
    end if;
    if r.metadata::text ilike '%token%' or r.metadata::text ilike '%jwt%' or r.metadata::text ilike '%secret%' then
        raise exception 'FAIL: audit metadata must not carry secrets';
    end if;
    if nullif(current_setting('nora.audit_actor_user_id', true), '') is not null
       or nullif(current_setting('nora.operation_id', true), '') is not null then
        raise exception 'FAIL: audit context must be cleared after the guard';
    end if;
    raise notice 'OK  4. active employee: Auth + Nora in one transaction, tokens gone, audit attributed, access untouched';

    -- -----------------------------------------------------------------------
    -- 5. Disabled employee: email moves, disabled + ban stay, nothing sent
    -- -----------------------------------------------------------------------
    select banned_until into v_before_banned from auth.users where id = v_disabled;
    perform set_config('request.jwt.claim.role', 'service_role', true);
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    set local role service_role;
    v_json := public.prepare_sales_email_change(v_admin_b, v_dis, 'dora.neu@nora.test', null);
    reset role;
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);
    if not (v_json->>'disabled')::boolean or not (v_json->>'auth_banned')::boolean then
        raise exception 'FAIL: prepare must report the disabled/banned facts';
    end if;
    update auth.users set email = 'dora.neu@nora.test' where id = v_disabled;

    if (select email from public.sales where id = v_dis) <> 'dora.neu@nora.test' then
        raise exception 'FAIL: disabled employee: sales.email not moved';
    end if;
    if not (select disabled from public.sales where id = v_dis) then
        raise exception 'FAIL: disabled employee must stay disabled';
    end if;
    if (select banned_until from auth.users where id = v_disabled) is distinct from v_before_banned then
        raise exception 'FAIL: disabled employee must stay banned';
    end if;
    if exists (select 1 from auth.one_time_tokens where user_id = v_disabled) then
        raise exception 'FAIL: no invitation / password token may appear for a disabled employee';
    end if;
    select * into r from public.audit_events
     where event_type = 'user.email_changed' and metadata->>'sale_id' = v_dis::text;
    if not found or r.actor_id is distinct from v_admin_b or not (r.metadata->>'disabled')::boolean
       or r.request_id is not null then
        raise exception 'FAIL: disabled employee audit row (actor B, disabled=true, request_id NULL)';
    end if;
    raise notice 'OK  5. disabled employee: address moved, still disabled + banned, nothing sent';

    -- -----------------------------------------------------------------------
    -- 6. Auth email changes without a live ticket are refused
    -- -----------------------------------------------------------------------
    -- (a) no ticket at all
    begin
        update auth.users set email = 'hijack@nora.test' where id = v_invited;
        raise exception 'FAIL: unticketed Auth email change must be refused';
    exception
        when insufficient_privilege then
            get stacked diagnostics v_detail = pg_exception_detail;
            if v_detail <> 'NORA_EMAIL_CHANGE_NOT_AUTHORIZED' then
                raise exception 'FAIL: unexpected detail %', v_detail;
            end if;
    end;
    -- (b) ticket for a different address
    perform set_config('request.jwt.claim.role', 'service_role', true);
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    set local role service_role;
    v_json := public.prepare_sales_email_change(v_admin_a, v_inv, 'ingo.neu@nora.test', v_op);
    reset role;
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);
    begin
        update auth.users set email = 'ingo.other@nora.test' where id = v_invited;
        raise exception 'FAIL: ticket for another address must not authorise this one';
    exception
        when insufficient_privilege then null;
    end;
    -- (c) expired ticket
    update nora_private.sales_email_change_tickets set expires_at = now() - interval '1 second' where sale_id = v_inv;
    begin
        update auth.users set email = 'ingo.neu@nora.test' where id = v_invited;
        raise exception 'FAIL: expired ticket must not authorise';
    exception
        when insufficient_privilege then null;
    end;
    -- (d) actor disabled between prepare and apply
    perform set_config('request.jwt.claim.role', 'service_role', true);
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    set local role service_role;
    v_json := public.prepare_sales_email_change(v_admin_b, v_inv, 'ingo.neu@nora.test', v_op);
    reset role;
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);
    perform nora_private.apply_sales_role_change(v_b, 'admin', true);
    begin
        update auth.users set email = 'ingo.neu@nora.test' where id = v_invited;
        raise exception 'FAIL: a ticket of a meanwhile-disabled admin must not apply';
    exception
        when insufficient_privilege then
            get stacked diagnostics v_detail = pg_exception_detail;
            if v_detail <> 'NORA_PERMISSION_DENIED' then
                raise exception 'FAIL: unexpected detail %', v_detail;
            end if;
    end;
    perform nora_private.apply_sales_role_change(v_b, 'admin', false);

    if (select email from public.sales where id = v_inv) <> 'w4-invited@nora.test'
       or (select email from auth.users where id = v_invited) <> 'w4-invited@nora.test' then
        raise exception 'FAIL: refused Auth changes must move nothing';
    end if;
    if not exists (select 1 from auth.one_time_tokens where user_id = v_invited) then
        raise exception 'FAIL: refused Auth changes must not delete tokens';
    end if;
    if (select count(*) from public.audit_events where event_type = 'user.email_changed') <> v_audit_before + 2 then
        raise exception 'FAIL: refused Auth changes must not write audit rows';
    end if;
    raise notice 'OK  6. no ticket / other address / expired / actor disabled → refused, nothing moves';

    -- -----------------------------------------------------------------------
    -- 7. cancel: once, then gone; consumed tickets are gone too
    -- -----------------------------------------------------------------------
    perform set_config('request.jwt.claim.role', 'service_role', true);
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    set local role service_role;
    v_json := public.prepare_sales_email_change(v_admin_a, v_inv, 'ingo.neu@nora.test', v_op);
    if not public.cancel_sales_email_change((v_json->>'ticket_id')::uuid) then
        raise exception 'FAIL: cancel must remove a live ticket';
    end if;
    if public.cancel_sales_email_change((v_json->>'ticket_id')::uuid) then
        raise exception 'FAIL: cancel must report false the second time';
    end if;
    if public.cancel_sales_email_change(v_ticket) then
        raise exception 'FAIL: a consumed ticket must already be gone';
    end if;
    reset role;
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);
    raise notice 'OK  7. cancel semantics';

    -- -----------------------------------------------------------------------
    -- 8. Retry after success is a typed no-op without a second audit row;
    --    the old address is free again for another employee
    -- -----------------------------------------------------------------------
    perform set_config('request.jwt.claim.role', 'service_role', true);
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    set local role service_role;
    begin
        perform public.prepare_sales_email_change(v_admin_a, v_act, 'anna.neu@nora.test', v_op);
        raise exception 'FAIL: retry must be refused as unchanged';
    exception
        when others then
            get stacked diagnostics v_detail = pg_exception_detail;
            if v_detail <> 'NORA_EMAIL_UNCHANGED' then
                raise exception 'FAIL: retry → %', v_detail;
            end if;
    end;
    v_json := public.prepare_sales_email_change(v_admin_a, v_inv, 'w4-active@nora.test', v_op);
    if not public.cancel_sales_email_change((v_json->>'ticket_id')::uuid) then
        raise exception 'FAIL: cleanup';
    end if;
    reset role;
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);
    if (select count(*) from public.audit_events where event_type = 'user.email_changed' and metadata->>'sale_id' = v_act::text) <> 1 then
        raise exception 'FAIL: exactly one user.email_changed row for the active employee';
    end if;
    raise notice 'OK  8. retry is a typed no-op, old address free again';

    -- -----------------------------------------------------------------------
    -- 9. Capability separation
    -- -----------------------------------------------------------------------
    set local role nora_identity_manager;
    begin
        update public.sales set role = 'admin' where id = v_act;
        raise exception 'FAIL: identity manager must not change role';
    exception
        when raise_exception then
            if sqlerrm not ilike '%identity manager may only change email%' then
                raise exception 'FAIL: unexpected: %', sqlerrm;
            end if;
        when insufficient_privilege then null;
    end;
    begin
        update public.sales set disabled = true where id = v_act;
        raise exception 'FAIL: identity manager must not change disabled';
    exception
        when raise_exception then null;
        when insufficient_privilege then null;
    end;
    reset role;
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);
    set local role nora_role_manager;
    begin
        update public.sales set email = 'rm@nora.test' where id = v_act;
        raise exception 'FAIL: role manager must not change email';
    exception
        when raise_exception then
            if sqlerrm not ilike '%immutable for role manager%' then
                raise exception 'FAIL: unexpected: %', sqlerrm;
            end if;
    end;
    reset role;
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);
    -- postgres itself (generic branch) still cannot write sales.email directly
    begin
        update public.sales set email = 'pg@nora.test' where id = v_act;
        raise exception 'FAIL: direct update as postgres must be refused';
    exception
        when raise_exception then null;
    end;
    raise notice 'OK  9. identity manager: email only; role manager: no email; postgres: no direct write';

    -- -----------------------------------------------------------------------
    -- 10. Name sync untouched, unique login email
    -- -----------------------------------------------------------------------
    update auth.users set raw_user_meta_data = '{"first_name":"Anna","last_name":"Renamed"}'::jsonb where id = v_active;
    if (select last_name from public.sales where id = v_act) <> 'Renamed'
       or (select email from public.sales where id = v_act) <> 'anna.neu@nora.test' then
        raise exception 'FAIL: name sync must still work and leave email alone';
    end if;
    begin
        insert into public.sales (first_name, last_name, email, administrator, role, user_id)
        values ('Dup', 'Licate', 'ANNA.NEU@nora.test', false, 'viewer', v_ghost);
        raise exception 'FAIL: unique login email must block a second employee (case-insensitive)';
    exception
        when unique_violation then null;
    end;
    raise notice 'OK 10. name sync unchanged, login email unique (citext)';

    raise exception 'ROLLBACK_W4_TEST';
exception
    when others then
        if sqlerrm = 'ROLLBACK_W4_TEST' then
            raise notice 'W4 behaviour suite passed (rolled back)';
        else
            raise;
        end if;
end;
$$;

-- context must be clean after the block
do $$
begin
    if nullif(current_setting('nora.audit_actor_user_id', true), '') is not null
       or nullif(current_setting('nora.operation_id', true), '') is not null then
        raise exception 'FAIL: audit context leaked past the suite';
    end if;
    raise notice 'OK 11. no audit context leak';
end;
$$;

\echo '=== W4: all checks passed ==='
