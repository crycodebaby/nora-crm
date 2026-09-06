-- Nora User Lifecycle W5 — controlled offboarding, session revocation,
-- dependency preview, session-bound RLS
--
-- Self-contained: seeds its own throwaway identities inside one DO block and
-- rolls everything back at the end (the block raises ROLLBACK_W5_TEST and
-- catches it). Safe to run on a fresh `npx supabase db reset --local` with or
-- without rbac_rls_setup.sql.
--
-- Usage (local only):
--   docker exec -i supabase_db_atomic-crm-demo psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/lifecycle_offboarding_verification.sql
--
-- What it proves:
--   1. privilege contract: executor + preview service_role-only, internals
--      postgres-internal, postgres can read/delete auth.sessions, the two
--      RLS helpers carry the session binding
--   2. browser JWTs cannot call the RPCs
--   3. session binding: a JWT naming a live session passes, a JWT naming a
--      deleted session is denied (is_active_user, current_role, an RLS read),
--      a JWT without session claim behaves as before
--   4. dependency preview counts current responsibility and notes separately
--   5. refusals: non-admin / disabled / forged actor, self, unknown target —
--      nothing changes, no audit row
--   6. active employee with assignments and two sessions: one call disables,
--      deletes both sessions and their refresh tokens, keeps every reference,
--      removes the employee from sales_directory but not sales_identities,
--      writes user.disabled AND exactly one user.offboarded (actor, stable
--      entity, request_id, bounded metadata), clears the audit context
--   7. retry is a replay: no state change, no second audit row
--   8. employee without assignments offboards normally
--   9. already-disabled employee with live sessions: executed, sessions gone,
--      no second user.disabled
--  10. last active admin cannot be offboarded (trigger), other admin can
--  11. W1 reactivation still works afterwards and does not resurrect sessions
--  12. no audit context leak

\set ON_ERROR_STOP on

\echo '=== W5: lifecycle offboarding verification ==='

-- ---------------------------------------------------------------------------
-- 1. Declarative privilege contract
-- ---------------------------------------------------------------------------
do $$
declare
    v_off text := 'public.offboard_employee_by_executor(uuid, bigint, uuid)';
    v_prev text := 'public.get_employee_dependency_preview(bigint)';
    v_revoke text := 'nora_private.revoke_auth_sessions(uuid)';
    v_live text := 'nora_private.jwt_session_is_live()';
    v_sid text := 'nora_private.safe_auth_session_id()';
    r record;
begin
    for r in select unnest(array[v_off, v_prev, v_revoke, v_live, v_sid]) as sig loop
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
    end loop;

    for r in select unnest(array[v_off, v_prev]) as sig loop
        if has_function_privilege('anon', r.sig, 'EXECUTE')
           or has_function_privilege('authenticated', r.sig, 'EXECUTE') then
            raise exception 'FAIL: browser roles may EXECUTE %', r.sig;
        end if;
        if not has_function_privilege('service_role', r.sig, 'EXECUTE') then
            raise exception 'FAIL: service_role must EXECUTE %', r.sig;
        end if;
    end loop;

    for r in select unnest(array[v_revoke, v_live, v_sid]) as sig loop
        if has_function_privilege('anon', r.sig, 'EXECUTE')
           or has_function_privilege('authenticated', r.sig, 'EXECUTE')
           or has_function_privilege('service_role', r.sig, 'EXECUTE') then
            raise exception 'FAIL: % must not be API-executable', r.sig;
        end if;
    end loop;

    if not has_table_privilege('postgres', 'auth.sessions', 'SELECT')
       or not has_table_privilege('postgres', 'auth.sessions', 'DELETE')
       or not has_table_privilege('postgres', 'auth.refresh_tokens', 'DELETE') then
        raise exception 'FAIL: postgres needs SELECT/DELETE on auth.sessions and DELETE on auth.refresh_tokens';
    end if;

    if pg_get_functiondef('nora_private.is_active_user()'::regprocedure) not ilike '%jwt_session_is_live%'
       or pg_get_functiondef('nora_private.current_role()'::regprocedure) not ilike '%jwt_session_is_live%' then
        raise exception 'FAIL: is_active_user / current_role must carry the session binding';
    end if;

    -- refresh tokens cascade from sessions (GoTrue schema fact the revoke relies on)
    if not exists (
        select 1 from pg_constraint
        where conrelid = 'auth.refresh_tokens'::regclass and contype = 'f'
          and pg_get_constraintdef(oid) ilike '%references auth.sessions(id) on delete cascade%'
    ) then
        raise exception 'FAIL: auth.refresh_tokens.session_id must cascade from auth.sessions';
    end if;

    raise notice 'OK  1. privilege contract';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Browser roles cannot execute the RPCs
-- ---------------------------------------------------------------------------
do $$
declare
    v_ok boolean := false;
begin
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
    begin
        perform public.offboard_employee_by_executor(gen_random_uuid(), 1, null);
    exception when others then
        if sqlstate = '42501' then v_ok := true; else raise; end if;
    end;
    if not v_ok then raise exception 'FAIL: authenticated JWT could execute the offboard RPC'; end if;

    v_ok := false;
    begin
        perform public.get_employee_dependency_preview(1);
    exception when others then
        if sqlstate = '42501' then v_ok := true; else raise; end if;
    end;
    if not v_ok then raise exception 'FAIL: authenticated JWT could execute the preview RPC'; end if;

    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    raise notice 'OK  2. browser JWTs refused';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3.–12. Behaviour (single subtransaction, rolled back)
-- ---------------------------------------------------------------------------
do $$
declare
    v_admin_a uuid := gen_random_uuid();
    v_admin_b uuid := gen_random_uuid();
    v_emp uuid := gen_random_uuid();
    v_viewer uuid := gen_random_uuid();
    v_none uuid := gen_random_uuid();
    v_a bigint; v_b bigint; v_e bigint; v_v bigint; v_n bigint;
    v_session1 uuid := gen_random_uuid();
    v_session2 uuid := gen_random_uuid();
    v_session_a uuid := gen_random_uuid();
    v_company bigint; v_contact bigint; v_deal bigint;
    v_res jsonb;
    v_prev jsonb;
    v_ok boolean;
    v_op uuid := '11111111-2222-4333-8444-555555555555';
    v_audit_before bigint;
    v_row record;
begin
    -- seed identities (handle_new_user creates sales rows)
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values
      (v_admin_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'w5-a@nora.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{"first_name":"Ada","last_name":"Admin"}', now(), now()),
      (v_admin_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'w5-b@nora.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{"first_name":"Ben","last_name":"Admin"}', now(), now()),
      (v_emp,     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'w5-e@nora.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{"first_name":"Eva","last_name":"Employee"}', now(), now()),
      (v_viewer,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'w5-v@nora.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{"first_name":"Vin","last_name":"Viewer"}', now(), now()),
      (v_none,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'w5-n@nora.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{"first_name":"Nora","last_name":"None"}', now(), now());

    select id into v_a from public.sales where user_id = v_admin_a;
    select id into v_b from public.sales where user_id = v_admin_b;
    select id into v_e from public.sales where user_id = v_emp;
    select id into v_v from public.sales where user_id = v_viewer;
    select id into v_n from public.sales where user_id = v_none;
    perform nora_private.apply_sales_role_change(v_a, 'admin', false);
    perform nora_private.apply_sales_role_change(v_b, 'admin', false);
    perform nora_private.apply_sales_role_change(v_e, 'office', false);
    perform nora_private.apply_sales_role_change(v_v, 'viewer', false);
    perform nora_private.apply_sales_role_change(v_n, 'office', false);

    -- sessions: two for the employee, one for admin A
    insert into auth.sessions (id, user_id, created_at, updated_at, aal)
    values (v_session1, v_emp, now(), now(), 'aal1'), (v_session2, v_emp, now(), now(), 'aal1'), (v_session_a, v_admin_a, now(), now(), 'aal1');
    insert into auth.refresh_tokens (instance_id, token, user_id, revoked, created_at, updated_at, session_id)
    values ('00000000-0000-0000-0000-000000000000', 'w5-rt-1', v_emp::text, false, now(), now(), v_session1),
           ('00000000-0000-0000-0000-000000000000', 'w5-rt-2', v_emp::text, false, now(), now(), v_session2),
           ('00000000-0000-0000-0000-000000000000', 'w5-rt-legacy', v_emp::text, false, now(), now(), null);

    -- assignments: 1 company, 1 contact, 2 deals (1 archived), 3 tasks (1 done), 1 contact note, 1 deal note
    insert into public.companies (name, sales_id) values ('W5 Kunde', v_e) returning id into v_company;
    insert into public.contacts (first_name, last_name, company_id, sales_id) values ('Kon', 'Takt', v_company, v_e) returning id into v_contact;
    insert into public.deals (name, company_id, stage, sales_id) values ('W5 offen', v_company, 'opportunity', v_e) returning id into v_deal;
    insert into public.deals (name, company_id, stage, sales_id, archived_at) values ('W5 archiv', v_company, 'opportunity', v_e, now());
    insert into public.tasks (contact_id, company_id, type, text, due_date, sales_id) values
      (v_contact, v_company, 'Call', 't1', now(), v_e), (v_contact, v_company, 'Call', 't2', now(), v_e);
    insert into public.tasks (contact_id, company_id, type, text, due_date, done_date, sales_id) values (v_contact, v_company, 'Call', 't3', now(), now(), v_e);
    insert into public.contact_notes (contact_id, text, sales_id, date) values (v_contact, 'n', v_e, now());
    insert into public.deal_notes (deal_id, text, sales_id, date) values (v_deal, 'n', v_e, now());

    -- ---- 3. session binding on the RLS helpers
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', v_emp::text, true);
    perform set_config('request.jwt.claim.session_id', v_session1::text, true);
    if not nora_private.is_active_user() or nora_private.current_role() is distinct from 'office' then
        raise exception 'FAIL: live session must be active';
    end if;
    perform set_config('request.jwt.claim.session_id', gen_random_uuid()::text, true);
    if nora_private.is_active_user() or nora_private.current_role() is not null then
        raise exception 'FAIL: JWT naming a non-existent session must be denied';
    end if;
    perform set_config('request.jwt.claim.session_id', '', true);
    if not nora_private.is_active_user() then
        raise exception 'FAIL: fixture without any transported JWT must keep the compatibility path';
    end if;
    -- W6-A: another user's live session, a malformed claim and a transported
    -- JWT without session claim are all denied (full matrix in
    -- lifecycle_session_authorization_verification.sql)
    perform set_config('request.jwt.claim.session_id', v_session_a::text, true);
    if nora_private.is_active_user() or nora_private.current_role() is not null then
        raise exception 'FAIL: W6-A another user''s session must be denied';
    end if;
    perform set_config('request.jwt.claim.session_id', 'not-a-uuid', true);
    if nora_private.is_active_user() then
        raise exception 'FAIL: W6-A malformed session claim must be denied';
    end if;
    perform set_config('request.jwt.claim.session_id', '', true);
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_emp::text)::text, true);
    if nora_private.is_active_user() then
        raise exception 'FAIL: W6-A transported JWT without session claim must be denied';
    end if;
    perform set_config('request.jwt.claims', '', true);
    -- the same through an RLS-guarded read (companies select policy)
    perform set_config('request.jwt.claim.session_id', v_session1::text, true);
    set local role authenticated;
    if (select count(*) from public.companies where id = v_company) <> 1 then
        raise exception 'FAIL: live session must read the company';
    end if;
    reset role;
    perform set_config('request.jwt.claim.session_id', gen_random_uuid()::text, true);
    set local role authenticated;
    if (select count(*) from public.companies where id = v_company) <> 0 then
        raise exception 'FAIL: dead session must not read the company';
    end if;
    reset role;
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.session_id', '', true);
    raise notice 'OK  3. session binding (helpers + RLS read)';

    -- ---- 4. dependency preview
    perform set_config('request.jwt.claim.role', 'service_role', true);
    v_prev := public.get_employee_dependency_preview(v_e);
    if v_prev <> jsonb_build_object('companies', 1, 'contacts', 1, 'open_deals', 1, 'open_tasks', 2, 'contact_notes', 1, 'deal_notes', 1) then
        raise exception 'FAIL: preview counts wrong: %', v_prev;
    end if;
    v_ok := false;
    begin
        perform public.get_employee_dependency_preview(-1);
    exception when others then
        if sqlstate = 'P0002' then v_ok := true; else raise; end if;
    end;
    if not v_ok then raise exception 'FAIL: preview must refuse an unknown employee'; end if;
    raise notice 'OK  4. dependency preview';

    -- ---- 5. refusals
    select count(*) into v_audit_before from public.audit_events where event_type = 'user.offboarded';
    for v_row in select * from (values
        (v_viewer, v_e, 'NORA_PERMISSION_DENIED', 'viewer actor'),
        (gen_random_uuid(), v_e, 'NORA_PERMISSION_DENIED', 'forged actor'),
        (v_admin_a, v_a, 'NORA_SELF_ACCESS_CHANGE_FORBIDDEN', 'self')
    ) as t(actor, target, detail, label) loop
        v_ok := false;
        begin
            perform public.offboard_employee_by_executor(v_row.actor, v_row.target, v_op);
        exception when others then
            declare v_detail text; begin
                get stacked diagnostics v_detail = pg_exception_detail;
                if v_detail = v_row.detail then v_ok := true; else raise exception 'FAIL: % → unexpected % / %', v_row.label, sqlstate, v_detail; end if;
            end;
        end;
        if not v_ok then raise exception 'FAIL: % must be refused', v_row.label; end if;
    end loop;
    -- disabled admin as actor
    perform nora_private.apply_sales_role_change(v_b, 'admin', true);
    v_ok := false;
    begin
        perform public.offboard_employee_by_executor(v_admin_b, v_e, v_op);
    exception when others then
        if sqlstate = '42501' then v_ok := true; else raise; end if;
    end;
    if not v_ok then raise exception 'FAIL: disabled admin actor must be refused'; end if;
    perform nora_private.apply_sales_role_change(v_b, 'admin', false);
    -- unknown target
    v_ok := false;
    begin
        perform public.offboard_employee_by_executor(v_admin_a, -1, v_op);
    exception when others then
        if sqlstate = 'P0002' then v_ok := true; else raise; end if;
    end;
    if not v_ok then raise exception 'FAIL: unknown target must be P0002'; end if;
    if (select disabled from public.sales where id = v_e) or (select count(*) from auth.sessions where user_id = v_emp) <> 2
       or (select count(*) from public.audit_events where event_type = 'user.offboarded') <> v_audit_before then
        raise exception 'FAIL: a refused call changed state or wrote audit';
    end if;
    raise notice 'OK  5. refusals leave no trace';

    -- ---- 6. real offboarding by A
    v_res := public.offboard_employee_by_executor(v_admin_a, v_e, v_op);
    if (v_res ->> 'disposition') <> 'executed' or (v_res ->> 'disabled')::boolean is not true
       or (v_res ->> 'sessions_revoked')::int <> 2 then
        raise exception 'FAIL: unexpected executor result %', v_res;
    end if;
    if (select disabled from public.sales where id = v_e) is not true then raise exception 'FAIL: sales.disabled not set'; end if;
    if (select count(*) from auth.sessions where user_id = v_emp) <> 0 then raise exception 'FAIL: sessions remain'; end if;
    if (select count(*) from auth.refresh_tokens where user_id = v_emp::text) <> 0 then raise exception 'FAIL: refresh tokens remain (incl. legacy)'; end if;
    if (select count(*) from auth.sessions where user_id = v_admin_a) <> 1 then raise exception 'FAIL: other users sessions touched'; end if;
    if (select count(*) from public.companies where sales_id = v_e) <> 1 or (select count(*) from public.contacts where sales_id = v_e) <> 1
       or (select count(*) from public.deals where sales_id = v_e) <> 2 or (select count(*) from public.tasks where sales_id = v_e) <> 3
       or (select count(*) from public.contact_notes where sales_id = v_e) <> 1 or (select count(*) from public.deal_notes where sales_id = v_e) <> 1 then
        raise exception 'FAIL: references changed';
    end if;
    -- read models (as a live admin session, since both views are RLS-gated)
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', v_admin_a::text, true);
    perform set_config('request.jwt.claim.session_id', v_session_a::text, true);
    if exists (select 1 from public.sales_directory where id = v_e) then raise exception 'FAIL: still in sales_directory'; end if;
    if not exists (select 1 from public.sales_identities where id = v_e) then raise exception 'FAIL: missing from sales_identities'; end if;
    perform set_config('request.jwt.claim.role', 'service_role', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.session_id', '', true);
    -- cannot receive new work (guard fires on change of sales_id: move away first)
    update public.companies set sales_id = v_a where id = v_company;
    v_ok := false;
    begin
        update public.companies set sales_id = v_e where id = v_company;
    exception when others then
        declare v_detail text; begin get stacked diagnostics v_detail = pg_exception_detail; if v_detail = 'NORA_EMPLOYEE_NOT_ASSIGNABLE' then v_ok := true; else raise; end if; end;
    end;
    if not v_ok then raise exception 'FAIL: offboarded employee could receive new work'; end if;
    -- (restoring v_e as owner is refused by the same guard; A stays owner for the rest of the suite)
    -- audit
    if (select count(*) from public.audit_events where event_type = 'user.offboarded' and entity_id = public.nora_entity_uuid('sales', v_e)) <> 1 then
        raise exception 'FAIL: expected exactly one user.offboarded';
    end if;
    if (select count(*) from public.audit_events where event_type = 'user.disabled' and entity_id = public.nora_entity_uuid('sales', v_e)) <> 1 then
        raise exception 'FAIL: expected exactly one user.disabled';
    end if;
    select * into v_row from public.audit_events where event_type = 'user.offboarded' and entity_id = public.nora_entity_uuid('sales', v_e);
    if v_row.actor_id is distinct from v_admin_a or v_row.actor_sales_id is distinct from v_a
       or v_row.actor_name_snapshot <> 'Ada Admin' or v_row.actor_role_snapshot <> 'admin'
       or v_row.request_id is distinct from v_op::text or v_row.retention_class <> 'user_management' or v_row.source <> 'user' then
        raise exception 'FAIL: user.offboarded actor/request facts wrong: % % % %', v_row.actor_id, v_row.actor_sales_id, v_row.actor_name_snapshot, v_row.request_id;
    end if;
    if (v_row.metadata ->> 'sessions_revoked')::int <> 2 or (v_row.metadata ->> 'access_already_disabled')::boolean is not false
       or (v_row.metadata -> 'dependencies' ->> 'open_tasks')::int <> 2 or (v_row.metadata ->> 'actor_sale_id')::bigint <> v_a
       or (v_row.metadata -> 'changes' -> 'disabled' ->> 'new')::boolean is not true then
        raise exception 'FAIL: user.offboarded metadata wrong: %', v_row.metadata;
    end if;
    if v_row.metadata::text ~* 'token|jwt|password|banned_until' then
        raise exception 'FAIL: metadata carries secrets-like keys';
    end if;
    if (select count(*) from public.audit_events where event_type = 'user.disabled' and entity_id = public.nora_entity_uuid('sales', v_e) and actor_id = v_admin_a and request_id = v_op::text) <> 1 then
        raise exception 'FAIL: user.disabled must carry the same actor and request id';
    end if;
    if coalesce(current_setting('nora.audit_actor_user_id', true), '') <> '' or coalesce(current_setting('nora.operation_id', true), '') <> '' then
        raise exception 'FAIL: audit context leaked after the executor';
    end if;
    raise notice 'OK  6. offboarding: access off, sessions gone, references kept, audit correct';

    -- ---- 7. retry = replay
    v_res := public.offboard_employee_by_executor(v_admin_a, v_e, gen_random_uuid());
    if (v_res ->> 'disposition') <> 'replayed' or (v_res ->> 'sessions_revoked')::int <> 0 then
        raise exception 'FAIL: retry must replay: %', v_res;
    end if;
    if (select count(*) from public.audit_events where event_type in ('user.offboarded', 'user.disabled') and entity_id = public.nora_entity_uuid('sales', v_e)) <> 2 then
        raise exception 'FAIL: retry wrote audit';
    end if;
    raise notice 'OK  7. retry is a replay without audit';

    -- ---- 8. no assignments
    v_res := public.offboard_employee_by_executor(v_admin_a, v_n, null);
    if (v_res ->> 'disposition') <> 'executed' or (v_res -> 'dependencies' ->> 'companies')::int <> 0 then
        raise exception 'FAIL: no-assignment offboarding: %', v_res;
    end if;
    if (select request_id from public.audit_events where event_type = 'user.offboarded' and entity_id = public.nora_entity_uuid('sales', v_n)) is not null then
        raise exception 'FAIL: request_id must be null without operation id';
    end if;
    raise notice 'OK  8. employee without assignments';

    -- ---- 9. already disabled (W1 path) with live sessions
    perform nora_private.apply_sales_role_change(v_v, 'viewer', true);
    insert into auth.sessions (id, user_id, created_at, updated_at, aal) values (gen_random_uuid(), v_viewer, now(), now(), 'aal1');
    v_res := public.offboard_employee_by_executor(v_admin_a, v_v, null);
    if (v_res ->> 'disposition') <> 'executed' or (v_res ->> 'sessions_revoked')::int <> 1 then
        raise exception 'FAIL: disabled-with-sessions must execute: %', v_res;
    end if;
    if (select count(*) from public.audit_events where event_type = 'user.disabled' and entity_id = public.nora_entity_uuid('sales', v_v)) <> 1 then
        raise exception 'FAIL: second user.disabled written';
    end if;
    if (select metadata ->> 'access_already_disabled' from public.audit_events where event_type = 'user.offboarded' and entity_id = public.nora_entity_uuid('sales', v_v)) <> 'true' then
        raise exception 'FAIL: access_already_disabled must be true';
    end if;
    raise notice 'OK  9. already-disabled employee with sessions';

    -- ---- 10. last active admin
    -- The suite may run on a database with other admins (fixtures, demo).
    -- Everything is rolled back at the end, so park every other active admin
    -- first; A must be the only one left for the invariant to be testable.
    perform nora_private.apply_sales_role_change(v_b, 'admin', true);
    for v_row in select id from public.sales where role = 'admin' and disabled = false and id <> v_a loop
        perform nora_private.apply_sales_role_change(v_row.id, 'admin', true);
    end loop;
    if nora_private.active_admin_count(null) <> 1 then raise exception 'FAIL: could not isolate the last admin'; end if;
    -- only A active: any other actor is refused (disabled/non-admin), A cannot target A; the trigger is the last line
    v_ok := false;
    begin
        perform nora_private.apply_sales_role_change(v_a, 'admin', true);
    exception when others then
        declare v_detail text; begin get stacked diagnostics v_detail = pg_exception_detail; if v_detail = 'NORA_LAST_ACTIVE_ADMIN_REQUIRED' then v_ok := true; else raise; end if; end;
    end;
    if not v_ok then raise exception 'FAIL: last active admin was disabled'; end if;
    perform nora_private.apply_sales_role_change(v_b, 'admin', false);
    v_res := public.offboard_employee_by_executor(v_admin_b, v_a, null);
    if (v_res ->> 'disabled')::boolean is not true or nora_private.active_admin_count(null) <> 1 then
        raise exception 'FAIL: admin B must be able to offboard admin A while B remains';
    end if;
    if (select count(*) from auth.sessions where user_id = v_admin_a) <> 0 then raise exception 'FAIL: admin A sessions remain'; end if;
    raise notice 'OK 10. last active admin protected, other admin offboardable';

    -- ---- 11. W1 reactivation still works, sessions do not come back
    v_res := public.set_sales_access_by_executor(v_admin_b, v_e, null, false, null);
    if (v_res ->> 'disabled')::boolean is not false then raise exception 'FAIL: reactivation failed'; end if;
    if (select count(*) from auth.sessions where user_id = v_emp) <> 0 then raise exception 'FAIL: reactivation resurrected sessions'; end if;
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', v_emp::text, true);
    perform set_config('request.jwt.claim.session_id', v_session1::text, true);
    if nora_private.is_active_user() then raise exception 'FAIL: old session must stay dead after reactivation'; end if;
    perform set_config('request.jwt.claim.session_id', '', true);
    perform set_config('request.jwt.claim.role', 'service_role', true);
    perform set_config('request.jwt.claim.sub', '', true);
    if (select count(*) from public.audit_events where event_type = 'user.enabled' and entity_id = public.nora_entity_uuid('sales', v_e)) <> 1 then
        raise exception 'FAIL: user.enabled missing';
    end if;
    raise notice 'OK 11. W1 reactivation compatible, old sessions stay revoked';

    perform set_config('request.jwt.claim.role', '', true);
    raise notice 'W5 behaviour suite passed (rolled back)';
    raise exception 'ROLLBACK_W5_TEST';
exception
    when others then
        if sqlerrm = 'ROLLBACK_W5_TEST' then
            return;
        end if;
        raise;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. No audit context leak
-- ---------------------------------------------------------------------------
do $$
begin
    if coalesce(current_setting('nora.audit_actor_user_id', true), '') <> ''
       or coalesce(current_setting('nora.operation_id', true), '') <> ''
       or coalesce(current_setting('request.jwt.claim.session_id', true), '') <> '' then
        raise exception 'FAIL: context leaked out of the suite';
    end if;
    raise notice 'OK 12. no audit context leak';
end;
$$;

\echo '=== W5: all checks passed ==='
select 'lifecycle_offboarding_verification: OK' as result;
