-- Nora User Lifecycle W6-A — session-authorization finalization
--
-- Self-contained: seeds throwaway identities and sessions inside one DO block
-- and rolls everything back (ROLLBACK_W6A_TEST). Safe on a fresh
-- `npx supabase db reset --local` with or without rbac_rls_setup.sql.
--
-- Usage (local only):
--   docker exec -i supabase_db_atomic-crm-demo psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/lifecycle_session_authorization_verification.sql
--
-- What it proves:
--   1. privilege contract: claim reader, liveness helper, health primitive and
--      safe_auth_session_id are postgres-owned SECURITY DEFINER, pinned
--      search_path, postgres-only EXECUTE; postgres reads auth.sessions; the
--      installed helper is the fail-closed W6-A version; is_active_user /
--      current_role carry the binding; health reports healthy
--   2. claim-state contract without rows: absent (untransported -> compat,
--      transported -> deny), present, malformed (bad string, JSON null,
--      number, boolean, array, object, non-object claims, unparseable claims),
--      legacy GUC precedence
--   3. owner binding: a JWT naming another user's live session is denied —
--      helpers, RLS read, RLS update, RLS insert, admin-only RPC
--   4. role regression with real sessions: viewer / office / admin / disabled
--      across companies, contacts, deals, tasks, sales (own row / all),
--      sales_directory, sales_identities, audit_events, get_global_audit_events,
--      contact_notes insert, companies update
--   5. revoked session -> denied; reactivation -> still denied; new session
--      -> allowed
--   6. service_role: unchanged (RLS bypass, executor without any session)
--   7. fail-closed: the helper's owner loses auth.sessions -> WARNING + deny
--      (restored by the rollback)
--   8. no GUC leak

\set ON_ERROR_STOP on

\echo '=== W6-A: lifecycle session authorization verification ==='

-- ---------------------------------------------------------------------------
-- 1. Declarative privilege contract
-- ---------------------------------------------------------------------------
do $$
declare
    v_claim text := 'nora_private.jwt_session_claim()';
    v_live text := 'nora_private.jwt_session_is_live()';
    v_health text := 'nora_private.session_binding_health()';
    v_sid text := 'nora_private.safe_auth_session_id()';
    v_src text;
    v_h jsonb;
    r record;
begin
    for r in select unnest(array[v_claim, v_live, v_health, v_sid]) as sig loop
        if to_regprocedure(r.sig) is null then
            raise exception 'FAIL: % missing', r.sig;
        end if;
        if not exists (
            select 1 from pg_proc p join pg_roles o on o.oid = p.proowner
            where p.oid = r.sig::regprocedure and p.prosecdef and o.rolname = 'postgres'
              and p.proconfig::text like '%search_path=%'
        ) then
            raise exception 'FAIL: % must be postgres-owned SECURITY DEFINER with pinned search_path', r.sig;
        end if;
        if has_function_privilege('anon', r.sig, 'EXECUTE')
           or has_function_privilege('authenticated', r.sig, 'EXECUTE')
           or has_function_privilege('service_role', r.sig, 'EXECUTE') then
            raise exception 'FAIL: % must not be API-executable', r.sig;
        end if;
    end loop;

    if not has_table_privilege('postgres', 'auth.sessions', 'SELECT') then
        raise exception 'FAIL: postgres must SELECT auth.sessions (fail-closed prerequisite)';
    end if;

    select p.prosrc into v_src from pg_proc p where p.oid = v_live::regprocedure;
    if v_src like '%session binding inactive%' or v_src not like '%W6-A fail-closed%'
       or v_src not like '%s.user_id = v_sub%' then
        raise exception 'FAIL: jwt_session_is_live is not the fail-closed, owner-bound W6-A version';
    end if;

    if pg_get_functiondef('nora_private.is_active_user()'::regprocedure) not ilike '%jwt_session_is_live%'
       or pg_get_functiondef('nora_private.current_role()'::regprocedure) not ilike '%jwt_session_is_live%' then
        raise exception 'FAIL: is_active_user / current_role must carry the session binding';
    end if;

    v_h := nora_private.session_binding_health();
    if (v_h ->> 'healthy')::boolean is not true or v_h ->> 'mode' <> 'fail_closed' or v_h ->> 'lookup_probe' <> 'ok' then
        raise exception 'FAIL: session_binding_health not healthy: %', v_h;
    end if;
    if v_h::text ~* 'session_id|user_id|token' then
        raise exception 'FAIL: health output must not carry session data';
    end if;

    raise notice 'OK  1. privilege contract';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Claim-state contract (no rows needed)
-- ---------------------------------------------------------------------------
do $$
declare
    v_sub uuid := gen_random_uuid();
    v_sid uuid := gen_random_uuid();
    c record;
    v_row record;
begin
    -- helper: run one case
    for v_row in select * from (values
        -- label, legacy session_id GUC, request.jwt.claims JSON, expected state, expected transported, expected live
        ('untransported, no claim',      '',            '',                                                                                'absent',    false, true),
        ('untransported, legacy uuid',   v_sid::text,   '',                                                                                'present',   false, false),
        ('untransported, legacy bad',    'not-a-uuid',  '',                                                                                'malformed', false, false),
        ('transported, no key',          '',            json_build_object('role','authenticated','sub',v_sub::text)::text,                 'absent',    true,  false),
        ('transported, uuid',            '',            json_build_object('role','authenticated','sub',v_sub::text,'session_id',v_sid::text)::text, 'present', true, false),
        ('transported, bad string',      '',            json_build_object('role','authenticated','sub',v_sub::text,'session_id','x')::text, 'malformed', true,  false),
        ('transported, empty string',    '',            json_build_object('role','authenticated','sub',v_sub::text,'session_id','')::text,  'malformed', true,  false),
        ('transported, JSON null',       '',            json_build_object('role','authenticated','sub',v_sub::text,'session_id',null)::text, 'malformed', true, false),
        ('transported, number',          '',            json_build_object('role','authenticated','sub',v_sub::text,'session_id',42)::text,  'malformed', true,  false),
        ('transported, boolean',         '',            json_build_object('role','authenticated','sub',v_sub::text,'session_id',true)::text, 'malformed', true, false),
        ('transported, array',           '',            json_build_object('role','authenticated','sub',v_sub::text,'session_id',json_build_array(v_sid::text))::text, 'malformed', true, false),
        ('transported, object',          '',            json_build_object('role','authenticated','sub',v_sub::text,'session_id',json_build_object('id',v_sid::text))::text, 'malformed', true, false),
        ('transported, claims not object','',           json_build_array(1)::text,                                                         'malformed', true,  false),
        ('transported, claims not JSON', '',            '{not-json',                                                                       'malformed', true,  false),
        ('legacy uuid wins over JSON bad', v_sid::text, json_build_object('role','authenticated','sub',v_sub::text,'session_id','x')::text, 'present',   true,  false)
    ) as t(label, legacy, claims, state, transported, live) loop
        perform set_config('request.jwt.claim.role', 'authenticated', true);
        perform set_config('request.jwt.claim.sub', v_sub::text, true);
        perform set_config('request.jwt.claim.session_id', v_row.legacy, true);
        perform set_config('request.jwt.claims', v_row.claims, true);
        c := nora_private.jwt_session_claim();
        if c.claim_state <> v_row.state or c.jwt_transported <> v_row.transported then
            raise exception 'FAIL: % -> state % transported % (expected % / %)', v_row.label, c.claim_state, c.jwt_transported, v_row.state, v_row.transported;
        end if;
        if (c.claim_state = 'present') <> (c.session_id is not null) then
            raise exception 'FAIL: % -> session_id must be set exactly when present', v_row.label;
        end if;
        if nora_private.jwt_session_is_live() <> v_row.live then
            raise exception 'FAIL: % -> jwt_session_is_live must be %', v_row.label, v_row.live;
        end if;
        if (nora_private.safe_auth_session_id() is not null) <> (c.claim_state = 'present') then
            raise exception 'FAIL: % -> safe_auth_session_id must mirror present', v_row.label;
        end if;
    end loop;

    -- present claim but no usable sub -> deny (never "no session to bind")
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.session_id', v_sid::text, true);
    if nora_private.jwt_session_is_live() then
        raise exception 'FAIL: session claim without sub must be denied';
    end if;
    perform set_config('request.jwt.claim.sub', 'not-a-uuid', true);
    if nora_private.jwt_session_is_live() then
        raise exception 'FAIL: session claim with malformed sub must be denied';
    end if;

    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.session_id', '', true);
    perform set_config('request.jwt.claims', '', true);
    raise notice 'OK  2. claim-state contract (15 shapes + sub guards)';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3.–7. Behaviour with seeded identities and sessions (rolled back)
-- ---------------------------------------------------------------------------
do $$
declare
    v_admin uuid := gen_random_uuid();
    v_office uuid := gen_random_uuid();
    v_viewer uuid := gen_random_uuid();
    v_disabled uuid := gen_random_uuid();
    v_a bigint; v_o bigint; v_v bigint; v_d bigint;
    s_admin uuid := gen_random_uuid();
    s_office uuid := gen_random_uuid();
    s_viewer uuid := gen_random_uuid();
    s_disabled uuid := gen_random_uuid();
    v_company bigint; v_contact bigint; v_deal bigint; v_task bigint;
    v_n bigint;
    v_ok boolean;
    v_res jsonb;
    v_row record;
    -- Browser identities are simulated with the legacy per-claim GUCs; the
    -- request.jwt.claims transport (what the API really sets) is covered in
    -- §2 and §3 with the same helpers.
begin
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values
      (v_admin,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'w6a-admin@nora.test',    'x', now(), '{"provider":"email","providers":["email"]}', '{"first_name":"Ada","last_name":"Admin"}',    now(), now()),
      (v_office,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'w6a-office@nora.test',   'x', now(), '{"provider":"email","providers":["email"]}', '{"first_name":"Olaf","last_name":"Office"}',  now(), now()),
      (v_viewer,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'w6a-viewer@nora.test',   'x', now(), '{"provider":"email","providers":["email"]}', '{"first_name":"Vera","last_name":"Viewer"}',  now(), now()),
      (v_disabled, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'w6a-disabled@nora.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{"first_name":"Dirk","last_name":"Disabled"}', now(), now());
    select id into v_a from public.sales where user_id = v_admin;
    select id into v_o from public.sales where user_id = v_office;
    select id into v_v from public.sales where user_id = v_viewer;
    select id into v_d from public.sales where user_id = v_disabled;
    perform nora_private.apply_sales_role_change(v_a, 'admin', false);
    perform nora_private.apply_sales_role_change(v_o, 'office', false);
    perform nora_private.apply_sales_role_change(v_v, 'viewer', false);
    perform nora_private.apply_sales_role_change(v_d, 'office', true);

    insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
      (s_admin, v_admin, now(), now(), 'aal1'), (s_office, v_office, now(), now(), 'aal1'),
      (s_viewer, v_viewer, now(), now(), 'aal1'), (s_disabled, v_disabled, now(), now(), 'aal1');

    insert into public.companies (name, sales_id) values ('W6-A Kunde', v_o) returning id into v_company;
    insert into public.contacts (first_name, last_name, company_id, sales_id) values ('Kon', 'Takt', v_company, v_o) returning id into v_contact;
    insert into public.deals (name, company_id, stage, sales_id) values ('W6-A Vorgang', v_company, 'opportunity', v_o) returning id into v_deal;
    insert into public.tasks (contact_id, company_id, type, text, due_date, sales_id) values (v_contact, v_company, 'Call', 't', now(), v_o) returning id into v_task;

    -- ---- 3. owner binding: office sub + viewer's live session
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', v_office::text, true);
    perform set_config('request.jwt.claim.session_id', s_viewer::text, true);
    if nora_private.is_active_user() or nora_private.current_role() is not null or nora_private.can_write() then
        raise exception 'FAIL: another user''s session must not authorize';
    end if;
    set local role authenticated;
    if (select count(*) from public.companies where id = v_company) <> 0 then raise exception 'FAIL: wrong-owner session read companies'; end if;
    update public.companies set name = name where id = v_company;
    get diagnostics v_n = row_count;
    if v_n <> 0 then raise exception 'FAIL: wrong-owner session updated companies'; end if;
    v_ok := false;
    begin
        insert into public.contact_notes (contact_id, text, sales_id, date) values (v_contact, 'x', v_o, now());
    exception when others then
        if sqlstate = '42501' then v_ok := true; else raise; end if;
    end;
    if not v_ok then raise exception 'FAIL: wrong-owner session inserted contact_notes'; end if;
    reset role;
    -- admin sub + office session: admin-only RPC refused
    perform set_config('request.jwt.claim.sub', v_admin::text, true);
    perform set_config('request.jwt.claim.session_id', s_office::text, true);
    v_ok := false;
    begin
        perform public.get_global_audit_events(1, null, null, null, null, null, null, null);
    exception when others then
        if sqlstate = '42501' then v_ok := true; else raise; end if;
    end;
    if not v_ok then raise exception 'FAIL: admin sub with a foreign session could call get_global_audit_events'; end if;
    if nora_private.is_admin() then raise exception 'FAIL: admin sub with a foreign session is_admin'; end if;
    -- same through request.jwt.claims (the API path)
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.session_id', '', true);
    perform set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_admin::text,'session_id',s_office::text)::text, true);
    if nora_private.is_active_user() then raise exception 'FAIL: wrong owner via request.jwt.claims'; end if;
    perform set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_admin::text,'session_id',s_admin::text)::text, true);
    if not nora_private.is_admin() then raise exception 'FAIL: own session via request.jwt.claims must authorize'; end if;
    perform set_config('request.jwt.claims', '', true);
    raise notice 'OK  3. owner binding (helpers, RLS read/update/insert, RPC, both claim transports)';

    -- ---- 4. role regression with real sessions
    for v_row in select * from (values
        ('viewer',   v_viewer,   s_viewer,   'viewer', true,  false, false),
        ('office',   v_office,   s_office,   'office', true,  true,  false),
        ('admin',    v_admin,    s_admin,    'admin',  true,  true,  true),
        ('disabled', v_disabled, s_disabled, null,     false, false, false)
    ) as t(label, uid, sid, role, reads, writes, admin) loop
        perform set_config('request.jwt.claim.role', 'authenticated', true);
        perform set_config('request.jwt.claim.sub', v_row.uid::text, true);
        perform set_config('request.jwt.claim.session_id', v_row.sid::text, true);
        if nora_private.current_role() is distinct from v_row.role
           or nora_private.is_active_user() <> v_row.reads
           or nora_private.can_write() <> v_row.writes
           or nora_private.is_admin() <> v_row.admin then
            raise exception 'FAIL: % helpers: role=% active=% write=% admin=%', v_row.label,
                nora_private.current_role(), nora_private.is_active_user(), nora_private.can_write(), nora_private.is_admin();
        end if;
        set local role authenticated;
        -- reads
        if ((select count(*) from public.companies where id = v_company) = 1) <> v_row.reads then raise exception 'FAIL: % companies read', v_row.label; end if;
        if ((select count(*) from public.contacts where id = v_contact) = 1) <> v_row.reads then raise exception 'FAIL: % contacts read', v_row.label; end if;
        if ((select count(*) from public.deals where id = v_deal) = 1) <> v_row.reads then raise exception 'FAIL: % deals read', v_row.label; end if;
        if ((select count(*) from public.tasks where id = v_task) = 1) <> v_row.reads then raise exception 'FAIL: % tasks read', v_row.label; end if;
        if (exists (select 1 from public.sales_directory where id = v_o)) <> v_row.reads then raise exception 'FAIL: % sales_directory read', v_row.label; end if;
        if (exists (select 1 from public.sales_identities where id = v_d)) <> v_row.reads then raise exception 'FAIL: % sales_identities read (must include disabled)', v_row.label; end if;
        if (exists (select 1 from public.sales_directory where id = v_d)) then raise exception 'FAIL: % sales_directory must not list disabled', v_row.label; end if;
        -- own sales row vs all rows
        if (exists (select 1 from public.sales where user_id = v_row.uid)) <> v_row.reads then raise exception 'FAIL: % own sales row', v_row.label; end if;
        if (exists (select 1 from public.sales where user_id = v_office and v_row.uid <> v_office)) <> (v_row.admin) and v_row.uid <> v_office then
            raise exception 'FAIL: % foreign sales row visibility', v_row.label;
        end if;
        -- audit_events direct select: admin only
        if (exists (select 1 from public.audit_events)) <> v_row.admin then raise exception 'FAIL: % audit_events direct select', v_row.label; end if;
        -- writes
        update public.companies set name = name where id = v_company;
        get diagnostics v_n = row_count;
        if (v_n = 1) <> v_row.writes then raise exception 'FAIL: % companies update (rows=%)', v_row.label, v_n; end if;
        v_ok := true;
        begin
            insert into public.contact_notes (contact_id, text, sales_id, date) values (v_contact, 'n', v_o, now());
        exception when others then
            if sqlstate = '42501' then v_ok := false; else raise; end if;
        end;
        if v_ok <> v_row.writes then raise exception 'FAIL: % contact_notes insert', v_row.label; end if;
        reset role;
        -- admin-only RPC
        v_ok := true;
        begin
            perform public.get_global_audit_events(1, null, null, null, null, null, null, null);
        exception when others then
            if sqlstate = '42501' then v_ok := false; else raise; end if;
        end;
        if v_ok <> v_row.admin then raise exception 'FAIL: % get_global_audit_events', v_row.label; end if;
    end loop;
    raise notice 'OK  4. role regression with real sessions (viewer / office / admin / disabled)';

    -- ---- 5. revoked -> reactivated -> new session
    perform set_config('request.jwt.claim.sub', v_office::text, true);
    perform set_config('request.jwt.claim.session_id', s_office::text, true);
    if not nora_private.can_write() then raise exception 'FAIL: office live session precondition'; end if;
    delete from auth.sessions where id = s_office;
    if nora_private.is_active_user() or nora_private.current_role() is not null then raise exception 'FAIL: revoked session still authorizes'; end if;
    perform nora_private.apply_sales_role_change(v_o, 'office', true);
    if nora_private.is_active_user() then raise exception 'FAIL: disabled + revoked authorizes'; end if;
    perform nora_private.apply_sales_role_change(v_o, 'office', false);
    if nora_private.is_active_user() then raise exception 'FAIL: reactivation resurrected the old session'; end if;
    insert into auth.sessions (id, user_id, created_at, updated_at, aal) values (gen_random_uuid(), v_office, now(), now(), 'aal1') returning id into s_office;
    perform set_config('request.jwt.claim.session_id', s_office::text, true);
    if not nora_private.can_write() or nora_private.current_role() <> 'office' then raise exception 'FAIL: fresh session must authorize'; end if;
    raise notice 'OK  5. revoked / reactivated / fresh session';

    -- ---- 6. service_role unchanged: no session claim, RLS bypass, executor
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.session_id', '', true);
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    set local role service_role;
    if (select count(*) from public.companies where id = v_company) <> 1 then raise exception 'FAIL: service_role must bypass RLS'; end if;
    v_res := public.set_sales_access_by_executor(v_admin, v_v, 'office', null, null);
    if (v_res ->> 'role') <> 'office' then raise exception 'FAIL: service_role executor: %', v_res; end if;
    v_res := public.set_sales_access_by_executor(v_admin, v_v, 'viewer', null, null);
    v_res := public.get_employee_dependency_preview(v_o);
    if (v_res ->> 'companies')::int <> 1 then raise exception 'FAIL: service_role preview: %', v_res; end if;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    raise notice 'OK  6. service_role unchanged';

    -- ---- 7. fail-closed: helper owner without auth.sessions privilege
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', v_admin::text, true);
    perform set_config('request.jwt.claim.session_id', s_admin::text, true);
    if not nora_private.is_admin() then raise exception 'FAIL: admin live session precondition'; end if;
    create role w6a_noprivs nobypassrls nologin;
    grant w6a_noprivs to postgres;
    grant usage, create on schema nora_private to w6a_noprivs;
    grant execute on function nora_private.jwt_session_claim(), nora_private.safe_auth_uid() to w6a_noprivs;
    alter function nora_private.jwt_session_is_live() owner to w6a_noprivs;
    if nora_private.jwt_session_is_live() or nora_private.is_active_user() or nora_private.is_admin() or nora_private.current_role() is not null then
        raise exception 'FAIL: unverifiable session must be denied (fail-closed)';
    end if;
    set local role authenticated;
    if (select count(*) from public.companies where id = v_company) <> 0 then raise exception 'FAIL: fail-open through RLS'; end if;
    reset role;
    alter function nora_private.jwt_session_is_live() owner to postgres;
    if not nora_private.is_admin() then raise exception 'FAIL: restored owner must authorize again'; end if;

    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.session_id', '', true);
    raise notice 'OK  7. fail-closed when auth.sessions is not verifiable';
    raise notice 'W6-A behaviour suite passed (rolled back)';
    raise exception 'ROLLBACK_W6A_TEST';
exception
    when others then
        if sqlerrm = 'ROLLBACK_W6A_TEST' then
            return;
        end if;
        raise;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. No leak
-- ---------------------------------------------------------------------------
do $$
begin
    if coalesce(current_setting('request.jwt.claims', true), '') <> ''
       or coalesce(current_setting('request.jwt.claim.session_id', true), '') <> ''
       or coalesce(current_setting('request.jwt.claim.sub', true), '') <> ''
       or coalesce(current_setting('nora.audit_actor_user_id', true), '') <> '' then
        raise exception 'FAIL: context leaked out of the suite';
    end if;
    if exists (select 1 from pg_roles where rolname = 'w6a_noprivs') then
        raise exception 'FAIL: scratch role survived the rollback';
    end if;
    if (select rolname from pg_roles r join pg_proc p on p.proowner = r.oid where p.oid = 'nora_private.jwt_session_is_live()'::regprocedure) <> 'postgres' then
        raise exception 'FAIL: helper owner not restored';
    end if;
    raise notice 'OK  8. no leak, owner restored';
end;
$$;

\echo '=== W6-A: all checks passed ==='
select 'lifecycle_session_authorization_verification: OK' as result;
