-- Nora User Lifecycle W2 — reference integrity & historical identity
--
-- Self-contained: seeds its own throwaway identities and business rows inside
-- one DO block and rolls everything back at the end (raises ROLLBACK_W2_TEST
-- and catches it). Safe to run on a fresh `npx supabase db reset --local`
-- with or without rbac_rls_setup.sql.
--
-- Usage (local only):
--   docker exec -i supabase_db_atomic-crm-demo psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/lifecycle_reference_integrity_verification.sql
--
-- What it proves:
--   1. declarative contract: every FK to sales is NO ACTION (no CASCADE, no
--      SET NULL), tasks has an FK, browser roles hold no DELETE on sales and
--      no DELETE policy exists, sales_identities exists with the expected
--      projection/grants, the legacy RPC is gone, W1 objects are untouched
--   2. an employee with a contact note cannot be deleted (postgres and
--      service_role); the note survives byte-for-byte. Since W6-B the direct
--      DELETE is refused by nora_private.guard_sales_delete
--      (NORA_SALES_DELETE_NOT_AUTHORIZED) before the FK is even checked; the
--      six NO ACTION FKs remain the final barrier behind it (proven with the
--      guard capability satisfied in lifecycle_account_deletion_verification.sql)
--   3. an employee with a task cannot be deleted; the task keeps a valid owner
--   4. a task cannot point at a nonexistent employee (insert and update)
--   5. every reference blocks on its own: companies, contacts, deals,
--      deal_notes, contact_notes, tasks
--   6. an authenticated admin cannot delete employee rows at all
--   7. a disabled employee still resolves by name on existing records
--      (sales_identities) and is absent from the assignment source
--      (sales_directory); a disabled caller sees nothing
--   8. an employee with zero references is NOT deletable by a direct DELETE
--      either (W6-B: only the controlled account-deletion path — ticket +
--      GoTrue Admin hard delete + auth.users guard — may remove a sales row)
--   9. W1 regression: executor matrix, self guard, last-admin guard
--  10. history is untouched after all of the above (notes/deals/tasks compare
--      equal to their snapshots)
--  11. active assignment is authoritative (hardening): INSERT / UPDATE OF
--      sales_id to a disabled employee is refused on companies, contacts,
--      deals, tasks (DETAIL NORA_EMPLOYEE_NOT_ASSIGNABLE); unrelated updates
--      of a disabled-owned record and moving away stay allowed; historical
--      authorship (contact_notes, deal_notes) is not guarded

\set ON_ERROR_STOP on

\echo '=== W2: reference integrity & historical identity verification ==='

-- ---------------------------------------------------------------------------
-- 1. Declarative contract
-- ---------------------------------------------------------------------------
do $$
declare
    v_bad text;
    v_count int;
begin
    select string_agg(c.conrelid::regclass::text || '.' || c.conname || '=' || c.confdeltype::text, ', ') into v_bad
    from pg_constraint c
    where c.contype = 'f' and c.confrelid = 'public.sales'::regclass and c.confdeltype <> 'a';
    if v_bad is not null then
        raise exception 'FAIL: FK(s) to sales are not NO ACTION: %', v_bad;
    end if;

    select count(*) into v_count from pg_constraint c
    where c.contype = 'f' and c.confrelid = 'public.sales'::regclass;
    if v_count <> 6 then
        raise exception 'FAIL: expected 6 FKs to sales, found %', v_count;
    end if;

    if not exists (
        select 1 from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
        where c.conrelid = 'public.tasks'::regclass and c.contype = 'f'
          and c.confrelid = 'public.sales'::regclass and a.attname = 'sales_id'
          and c.convalidated
    ) then
        raise exception 'FAIL: tasks.sales_id has no validated FK to sales';
    end if;

    if not exists (
        select 1 from pg_constraint c
        where c.conrelid = 'public.contact_notes'::regclass and c.contype = 'f'
          and c.confrelid = 'public.sales'::regclass and c.convalidated
          and c.confdeltype = 'a' and c.confupdtype = 'a'
    ) then
        raise exception 'FAIL: contact_notes.sales_id FK must be NO ACTION on delete and update';
    end if;

    if has_table_privilege('authenticated', 'public.sales', 'DELETE')
       or has_table_privilege('anon', 'public.sales', 'DELETE') then
        raise exception 'FAIL: browser roles hold DELETE on sales';
    end if;
    if not has_table_privilege('service_role', 'public.sales', 'DELETE') then
        raise exception 'FAIL: service_role must keep DELETE on sales (future executor)';
    end if;
    if exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'sales' and cmd = 'DELETE'
    ) then
        raise exception 'FAIL: unexpected DELETE policy on sales';
    end if;
    if not exists (select 1 from pg_class where oid = 'public.sales'::regclass and relrowsecurity) then
        raise exception 'FAIL: RLS disabled on sales';
    end if;

    -- sales_identities: projection, gate, grants
    if to_regclass('public.sales_identities') is null then
        raise exception 'FAIL: sales_identities missing';
    end if;
    select string_agg(a.attname, ',' order by a.attnum) into v_bad
    from pg_attribute a
    where a.attrelid = 'public.sales_identities'::regclass and a.attnum > 0 and not a.attisdropped;
    if v_bad <> 'id,first_name,last_name,avatar,disabled' then
        raise exception 'FAIL: sales_identities projection is %', v_bad;
    end if;
    if pg_get_viewdef('public.sales_identities'::regclass) not like '%is_active_user()%' then
        raise exception 'FAIL: sales_identities must be gated by is_active_user()';
    end if;
    if exists (
        select 1 from pg_class c
        where c.oid = 'public.sales_identities'::regclass
          and coalesce((select option_value from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'), 'false') = 'true'
    ) then
        raise exception 'FAIL: sales_identities must be security_invoker = false like sales_directory';
    end if;
    if has_table_privilege('anon', 'public.sales_identities', 'SELECT') then
        raise exception 'FAIL: anon may read sales_identities';
    end if;
    if not has_table_privilege('authenticated', 'public.sales_identities', 'SELECT') then
        raise exception 'FAIL: authenticated must read sales_identities';
    end if;
    if has_table_privilege('authenticated', 'public.sales_identities', 'INSERT')
       or has_table_privilege('authenticated', 'public.sales_identities', 'UPDATE')
       or has_table_privilege('authenticated', 'public.sales_identities', 'DELETE') then
        raise exception 'FAIL: sales_identities must be read-only for authenticated';
    end if;

    -- sales_directory unchanged: active only, same projection
    if pg_get_viewdef('public.sales_directory'::regclass) not like '%disabled = false%' then
        raise exception 'FAIL: sales_directory must keep filtering disabled = false';
    end if;
    select string_agg(a.attname, ',' order by a.attnum) into v_bad
    from pg_attribute a
    where a.attrelid = 'public.sales_directory'::regclass and a.attnum > 0 and not a.attisdropped;
    if v_bad <> 'id,first_name,last_name,avatar' then
        raise exception 'FAIL: sales_directory projection changed: %', v_bad;
    end if;
    -- both views are SELECT-only: a security_invoker = false view over one
    -- table is auto-updatable and would otherwise write to sales as postgres
    if has_table_privilege('authenticated', 'public.sales_directory', 'INSERT, UPDATE, DELETE')
       or has_table_privilege('service_role', 'public.sales_directory', 'INSERT, UPDATE, DELETE')
       or has_table_privilege('service_role', 'public.sales_identities', 'INSERT, UPDATE, DELETE')
       or has_table_privilege('anon', 'public.sales_directory', 'SELECT') then
        raise exception 'FAIL: sales_directory / sales_identities must be SELECT-only';
    end if;

    -- legacy RPC gone, W1 objects intact
    if to_regprocedure('public.set_sales_role_by_admin(bigint, text, boolean)') is not null then
        raise exception 'FAIL: legacy RPC set_sales_role_by_admin still exists';
    end if;
    if to_regprocedure('public.set_sales_access_by_executor(uuid, bigint, text, boolean, uuid)') is null then
        raise exception 'FAIL: W1 executor missing';
    end if;
    if has_function_privilege('authenticated', 'public.set_sales_access_by_executor(uuid, bigint, text, boolean, uuid)', 'EXECUTE')
       or has_function_privilege('anon', 'public.set_sales_access_by_executor(uuid, bigint, text, boolean, uuid)', 'EXECUTE')
       or not has_function_privilege('service_role', 'public.set_sales_access_by_executor(uuid, bigint, text, boolean, uuid)', 'EXECUTE') then
        raise exception 'FAIL: W1 executor privilege matrix changed';
    end if;
    if not exists (
        select 1 from pg_trigger
        where tgrelid = 'public.sales'::regclass and tgname = 'guard_last_active_admin_trigger' and tgenabled <> 'D'
    ) then
        raise exception 'FAIL: W1 last-admin trigger missing or disabled';
    end if;

    raise notice 'OK  1. declarative contract';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2..10 Behaviour (single subtransaction, rolled back)
-- ---------------------------------------------------------------------------
do $$
declare
    v_admin_uid uuid := 'd2000000-0000-4000-8000-00000000000a';
    v_emp_uid   uuid := 'd2000000-0000-4000-8000-00000000000e';
    v_view_uid  uuid := 'd2000000-0000-4000-8000-00000000000f';
    v_admin bigint;
    v_emp bigint;
    v_view bigint;
    v_company bigint;
    v_contact bigint;
    v_deal bigint;
    v_note bigint;
    v_deal_note bigint;
    v_task bigint;
    v_note_snapshot jsonb;
    v_deal_snapshot jsonb;
    v_task_snapshot jsonb;
    v_rows int;
    v_detail text;
    v_name text;
    v_tmp bigint;
    v_tmp_uid uuid;
    v_tbl text;
    v_json jsonb;
begin
    -- Seed three identities (handle_new_user creates the sales rows).
    insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    )
    values
        ('00000000-0000-0000-0000-000000000000', v_admin_uid, 'authenticated', 'authenticated', 'w2-admin@nora.test', 'x', now(), '{"provider":"email"}', '{"first_name":"W2","last_name":"Admin"}', now(), now()),
        ('00000000-0000-0000-0000-000000000000', v_emp_uid,   'authenticated', 'authenticated', 'w2-erika@nora.test', 'x', now(), '{"provider":"email"}', '{"first_name":"Erika","last_name":"Ehemalig"}', now(), now()),
        ('00000000-0000-0000-0000-000000000000', v_view_uid,  'authenticated', 'authenticated', 'w2-viewer@nora.test', 'x', now(), '{"provider":"email"}', '{"first_name":"W2","last_name":"Viewer"}', now(), now());

    select id into v_admin from public.sales where user_id = v_admin_uid;
    select id into v_emp   from public.sales where user_id = v_emp_uid;
    select id into v_view  from public.sales where user_id = v_view_uid;
    -- W6-A: browser fixtures carry a live session (fixture session id = user id); rolled back
    insert into auth.sessions (id, user_id, created_at, updated_at, aal)
    select u, u, now(), now(), 'aal1' from unnest(array[v_admin_uid, v_emp_uid, v_view_uid]) u;
    perform nora_private.apply_sales_role_change(v_admin, 'admin', false);
    perform nora_private.apply_sales_role_change(v_emp, 'office', false);
    perform nora_private.apply_sales_role_change(v_view, 'viewer', false);

    -- Business history owned/authored by Erika.
    insert into public.companies (name, sales_id) values ('W2 Referenz GmbH', v_emp) returning id into v_company;
    insert into public.contacts (first_name, last_name, company_id, sales_id) values ('Max', 'Muster', v_company, v_emp) returning id into v_contact;
    insert into public.deals (name, company_id, stage, sales_id) values ('Fenster Treppenhaus', v_company, 'opportunity', v_emp) returning id into v_deal;
    insert into public.contact_notes (contact_id, text, sales_id) values (v_contact, 'Rückruf vereinbart – Aufmaß Donnerstag', v_emp) returning id into v_note;
    insert into public.deal_notes (deal_id, text, sales_id) values (v_deal, 'Angebot versendet', v_emp) returning id into v_deal_note;
    insert into public.tasks (contact_id, company_id, type, text, sales_id) values (v_contact, v_company, 'Call', 'Nachfassen', v_emp) returning id into v_task;

    select to_jsonb(n) into v_note_snapshot from public.contact_notes n where n.id = v_note;
    select to_jsonb(d) into v_deal_snapshot from public.deals d where d.id = v_deal;
    select to_jsonb(t) into v_task_snapshot from public.tasks t where t.id = v_task;

    -- -----------------------------------------------------------------------
    -- 2. Employee with a contact note cannot be deleted; note survives
    -- -----------------------------------------------------------------------
    begin
        delete from public.sales where id = v_emp;
        raise exception 'FAIL: postgres deleted a referenced employee';
    exception
        when foreign_key_violation then null;
        when insufficient_privilege then
            get stacked diagnostics v_detail = pg_exception_detail;
            if v_detail is distinct from 'NORA_SALES_DELETE_NOT_AUTHORIZED' then raise; end if;
    end;

    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', 'service_role', true);
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    set local role service_role;
    begin
        delete from public.sales where id = v_emp;
        raise exception 'FAIL: service_role deleted a referenced employee';
    exception
        when foreign_key_violation then null;
        when insufficient_privilege then
            get stacked diagnostics v_detail = pg_exception_detail;
            if v_detail is distinct from 'NORA_SALES_DELETE_NOT_AUTHORIZED' then raise; end if;
    end;
    reset role;

    if not exists (select 1 from public.sales where id = v_emp) then
        raise exception 'FAIL: employee row vanished';
    end if;
    if (select to_jsonb(n) from public.contact_notes n where n.id = v_note) is distinct from v_note_snapshot then
        raise exception 'FAIL: contact note changed or vanished';
    end if;
    raise notice 'OK  2. contact note author cannot be deleted; note intact';

    -- -----------------------------------------------------------------------
    -- 3. Employee with a task cannot be deleted; task keeps a valid owner
    -- -----------------------------------------------------------------------
    -- Isolate the task reference: move every other reference away first.
    update public.companies set sales_id = v_admin where id = v_company;
    update public.contacts set sales_id = v_admin where id = v_contact;
    update public.deals set sales_id = v_admin where id = v_deal;
    update public.deal_notes set sales_id = v_admin where id = v_deal_note;
    update public.contact_notes set sales_id = v_admin where id = v_note;
    begin
        delete from public.sales where id = v_emp;
        raise exception 'FAIL: employee referenced only by a task was deleted';
    exception
        when foreign_key_violation then null;
        when insufficient_privilege then
            get stacked diagnostics v_detail = pg_exception_detail;
            if v_detail is distinct from 'NORA_SALES_DELETE_NOT_AUTHORIZED' then raise; end if;
    end;
    if (select sales_id from public.tasks where id = v_task) <> v_emp
       or not exists (select 1 from public.sales where id = v_emp) then
        raise exception 'FAIL: task lost its owner';
    end if;
    -- restore ownership for the later sections
    update public.companies set sales_id = v_emp where id = v_company;
    update public.contacts set sales_id = v_emp where id = v_contact;
    update public.deals set sales_id = v_emp where id = v_deal;
    update public.deal_notes set sales_id = v_emp where id = v_deal_note;
    update public.contact_notes set sales_id = v_emp where id = v_note;
    raise notice 'OK  3. task owner cannot be deleted; task intact';

    -- -----------------------------------------------------------------------
    -- 4. A task cannot point at a nonexistent employee
    -- -----------------------------------------------------------------------
    begin
        insert into public.tasks (contact_id, company_id, type, text, sales_id)
        values (v_contact, v_company, 'Call', 'orphan', 999999999);
        raise exception 'FAIL: task inserted with nonexistent sales_id';
    exception
        when foreign_key_violation then null;
    end;
    begin
        update public.tasks set sales_id = 999999999 where id = v_task;
        raise exception 'FAIL: task updated to nonexistent sales_id';
    exception
        when foreign_key_violation then null;
    end;
    if (select sales_id from public.tasks where id = v_task) <> v_emp then
        raise exception 'FAIL: refused update must not persist';
    end if;
    -- existing valid tasks are untouched by the FK
    if (select to_jsonb(t) from public.tasks t where t.id = v_task) is distinct from v_task_snapshot then
        raise exception 'FAIL: existing task changed';
    end if;
    raise notice 'OK  4. invalid task.sales_id rejected (insert and update)';

    -- -----------------------------------------------------------------------
    -- 5. Every reference blocks on its own
    -- -----------------------------------------------------------------------
    foreach v_tbl in array array['companies', 'contacts', 'deals', 'deal_notes', 'contact_notes', 'tasks']
    loop
        v_tmp_uid := gen_random_uuid();
        insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
        values ('00000000-0000-0000-0000-000000000000', v_tmp_uid, 'authenticated', 'authenticated', 'w2-ref-' || v_tbl || '@nora.test', 'x', now(), '{"provider":"email"}', '{"first_name":"Ref","last_name":"Only"}', now(), now());
        select id into v_tmp from public.sales where user_id = v_tmp_uid;

        case v_tbl
            when 'companies' then insert into public.companies (name, sales_id) values ('Ref ' || v_tbl, v_tmp);
            when 'contacts' then insert into public.contacts (first_name, last_name, company_id, sales_id) values ('Ref', v_tbl, v_company, v_tmp);
            when 'deals' then insert into public.deals (name, company_id, stage, sales_id) values ('Ref ' || v_tbl, v_company, 'opportunity', v_tmp);
            when 'deal_notes' then insert into public.deal_notes (deal_id, text, sales_id) values (v_deal, 'Ref ' || v_tbl, v_tmp);
            when 'contact_notes' then insert into public.contact_notes (contact_id, text, sales_id) values (v_contact, 'Ref ' || v_tbl, v_tmp);
            when 'tasks' then insert into public.tasks (contact_id, company_id, type, text, sales_id) values (v_contact, v_company, 'Call', 'Ref ' || v_tbl, v_tmp);
        end case;

        begin
            delete from public.sales where id = v_tmp;
            raise exception 'FAIL: employee referenced only by % was deleted', v_tbl;
        exception
            when foreign_key_violation then null;
            when insufficient_privilege then
                get stacked diagnostics v_detail = pg_exception_detail;
                if v_detail is distinct from 'NORA_SALES_DELETE_NOT_AUTHORIZED' then raise; end if;
        end;
    end loop;
    raise notice 'OK  5. each of companies/contacts/deals/deal_notes/contact_notes/tasks blocks deletion';

    -- -----------------------------------------------------------------------
    -- 6. An authenticated admin cannot delete employee rows at all
    -- -----------------------------------------------------------------------
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', v_admin_uid::text, true);
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_admin_uid::text, 'session_id', v_admin_uid::text)::text, true);
    set local role authenticated;
    begin
        delete from public.sales where id = v_view;
        get diagnostics v_rows = row_count;
        if v_rows > 0 then
            raise exception 'FAIL: authenticated admin deleted an employee row';
        end if;
    exception
        when insufficient_privilege then null;
    end;
    -- nor through the identity views (auto-updatable, owner postgres)
    begin
        delete from public.sales_directory where id = v_view;
        raise exception 'FAIL: authenticated deleted an employee through sales_directory';
    exception
        when insufficient_privilege then null;
    end;
    begin
        update public.sales_identities set first_name = 'Hacked' where id = v_view;
        raise exception 'FAIL: authenticated updated an employee through sales_identities';
    exception
        when insufficient_privilege then null;
    end;
    begin
        update public.sales_directory set first_name = 'Hacked' where id = v_view;
        raise exception 'FAIL: authenticated updated an employee through sales_directory';
    exception
        when insufficient_privilege then null;
    end;
    reset role;
    if not exists (select 1 from public.sales where id = v_view and first_name = 'W2') then
        raise exception 'FAIL: viewer row vanished or was changed';
    end if;
    raise notice 'OK  6. authenticated admin cannot delete or rewrite employee rows (table or views)';

    -- -----------------------------------------------------------------------
    -- 7. Disabled employee: historical name resolves, assignment source excludes
    -- -----------------------------------------------------------------------
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', 'service_role', true);
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    set local role service_role;
    v_json := public.set_sales_access_by_executor(v_admin_uid, v_emp, null, true);
    reset role;
    if (select disabled from public.sales where id = v_emp) is not true then
        raise exception 'FAIL: could not disable Erika through the W1 executor';
    end if;

    -- as an active viewer (the weakest active role)
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', v_view_uid::text, true);
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_view_uid::text, 'session_id', v_view_uid::text)::text, true);
    set local role authenticated;

    if (select count(*) from public.contact_notes where id = v_note) <> 1
       or (select count(*) from public.deals where id = v_deal) <> 1
       or (select count(*) from public.tasks where id = v_task) <> 1 then
        raise exception 'FAIL: historical records not visible to an active viewer';
    end if;

    select first_name || ' ' || last_name into v_name from public.sales_identities where id = v_emp;
    if v_name is distinct from 'Erika Ehemalig' then
        raise exception 'FAIL: disabled author must resolve by name via sales_identities, got %', v_name;
    end if;
    if (select disabled from public.sales_identities where id = v_emp) is not true then
        raise exception 'FAIL: sales_identities must expose the disabled flag';
    end if;
    if (select count(*) from public.sales_directory where id = v_emp) <> 0 then
        raise exception 'FAIL: disabled employee offered by the assignment directory';
    end if;
    if (select count(*) from public.sales_directory where id = v_admin) <> 1 then
        raise exception 'FAIL: active employee missing from the assignment directory';
    end if;
    -- a lookup by note author id (useGetSalesName path) works for old and new alike
    if (select count(*) from public.sales_identities i join public.contact_notes n on n.sales_id = i.id where n.id = v_note) <> 1 then
        raise exception 'FAIL: note author join via sales_identities failed';
    end if;
    reset role;

    -- a disabled caller sees nothing through either view
    perform set_config('request.jwt.claim.sub', v_emp_uid::text, true);
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_emp_uid::text, 'session_id', v_emp_uid::text)::text, true);
    set local role authenticated;
    if (select count(*) from public.sales_identities) <> 0 or (select count(*) from public.sales_directory) <> 0 then
        raise exception 'FAIL: disabled caller can read employee identities';
    end if;
    reset role;
    raise notice 'OK  7. disabled employee keeps historical identity, leaves the assignment directory';

    -- -----------------------------------------------------------------------
    -- 8. Zero-reference employee: no direct DELETE either (W6-B guard)
    -- -----------------------------------------------------------------------
    -- Until W6-B this section proved that postgres / service_role could still
    -- delete an unreferenced row (the seam for a future executor). W6-B closed
    -- that seam: only the controlled account-deletion path (ticket + GoTrue
    -- Admin hard delete + nora_private.guard_auth_user_delete) may remove a
    -- sales row. The direct DELETE must now be refused for service_role too.
    v_tmp_uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', v_tmp_uid, 'authenticated', 'authenticated', 'w2-unreferenced@nora.test', 'x', now(), '{"provider":"email"}', '{"first_name":"Test","last_name":"Konto"}', now(), now());
    select id into v_tmp from public.sales where user_id = v_tmp_uid;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', 'service_role', true);
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    set local role service_role;
    begin
        delete from public.sales where id = v_tmp;
        raise exception 'FAIL: W6-B guard must refuse a direct sales DELETE for service_role';
    exception
        when insufficient_privilege then
            get stacked diagnostics v_detail = pg_exception_detail;
            if v_detail is distinct from 'NORA_SALES_DELETE_NOT_AUTHORIZED' then raise; end if;
    end;
    reset role;
    if not exists (select 1 from public.sales where id = v_tmp) or not exists (select 1 from auth.users where id = v_tmp_uid) then
        raise exception 'FAIL: refused direct delete must leave sales row and auth identity untouched';
    end if;
    raise notice 'OK  8. zero-reference employee: direct DELETE refused (W6-B), only the controlled path may remove it';

    -- -----------------------------------------------------------------------
    -- 9. W1 regression through the executor
    -- -----------------------------------------------------------------------
    set local role service_role;
    -- self guard
    begin
        perform public.set_sales_access_by_executor(v_admin_uid, v_admin, null, true);
        raise exception 'FAIL: W1 self guard gone';
    exception
        when others then
            get stacked diagnostics v_detail = pg_exception_detail;
            if v_detail is distinct from 'NORA_SELF_ACCESS_CHANGE_FORBIDDEN' then raise; end if;
    end;
    -- re-enable Erika (round trip)
    v_json := public.set_sales_access_by_executor(v_admin_uid, v_emp, null, false);
    if (select disabled from public.sales where id = v_emp) is not false then
        raise exception 'FAIL: W1 re-enable via executor broken';
    end if;
    reset role;
    -- last-admin guard: isolate W2 admin, then try to demote through the capability function
    for v_tmp in
        select s.id from public.sales s where s.role = 'admin' and s.disabled = false and s.id <> v_admin
    loop
        perform nora_private.apply_sales_role_change(v_tmp, 'admin', true);
    end loop;
    begin
        perform nora_private.apply_sales_role_change(v_admin, 'office', false);
        raise exception 'FAIL: W1 last-admin guard gone';
    exception
        when others then
            get stacked diagnostics v_detail = pg_exception_detail;
            if v_detail is distinct from 'NORA_LAST_ACTIVE_ADMIN_REQUIRED' then raise; end if;
    end;
    raise notice 'OK  9. W1 executor, self guard and last-admin guard intact';

    -- -----------------------------------------------------------------------
    -- 10. History untouched
    -- -----------------------------------------------------------------------
    if (select to_jsonb(n) from public.contact_notes n where n.id = v_note) is distinct from v_note_snapshot then
        raise exception 'FAIL: contact note drifted during the run';
    end if;
    if (select to_jsonb(d) from public.deals d where d.id = v_deal) is distinct from v_deal_snapshot then
        raise exception 'FAIL: deal drifted during the run';
    end if;
    if (select to_jsonb(t) from public.tasks t where t.id = v_task) is distinct from v_task_snapshot then
        raise exception 'FAIL: task drifted during the run';
    end if;
    if (select count(*) from public.deal_notes where id = v_deal_note and sales_id = v_emp) <> 1
       or (select count(*) from public.companies where id = v_company and sales_id = v_emp) <> 1
       or (select count(*) from public.contacts where id = v_contact and sales_id = v_emp) <> 1 then
        raise exception 'FAIL: company/contact/deal note references drifted';
    end if;
    raise notice 'OK 10. business history unchanged';

    -- -----------------------------------------------------------------------
    -- 11. Active assignment is authoritative (W2 hardening)
    -- -----------------------------------------------------------------------
    -- Erika is active again here (section 9 re-enabled her). Disable her via
    -- the executor, then prove the assignment rule on every current-
    -- responsibility table, and that historical authorship is untouched.
    set local role service_role;
    v_json := public.set_sales_access_by_executor(v_admin_uid, v_emp, null, true);
    reset role;
    if (select disabled from public.sales where id = v_emp) is not true then
        raise exception 'FAIL: could not disable Erika for section 11';
    end if;

    -- 11a. INSERT with active employee allowed, with disabled employee denied
    insert into public.deals (name, company_id, stage, sales_id) values ('Neu aktiv', v_company, 'opportunity', v_admin) returning id into v_tmp;
    begin
        insert into public.deals (name, company_id, stage, sales_id) values ('Neu deaktiviert', v_company, 'opportunity', v_emp);
        raise exception 'FAIL: deal inserted with a disabled employee';
    exception
        when others then
            get stacked diagnostics v_detail = pg_exception_detail;
            if v_detail is distinct from 'NORA_EMPLOYEE_NOT_ASSIGNABLE' then raise; end if;
    end;
    foreach v_tbl in array array['companies', 'contacts', 'tasks']
    loop
        begin
            case v_tbl
                when 'companies' then insert into public.companies (name, sales_id) values ('Neu deaktiviert', v_emp);
                when 'contacts' then insert into public.contacts (first_name, last_name, company_id, sales_id) values ('Neu', 'Deaktiviert', v_company, v_emp);
                when 'tasks' then insert into public.tasks (contact_id, company_id, type, text, sales_id) values (v_contact, v_company, 'Call', 'Neu deaktiviert', v_emp);
            end case;
            raise exception 'FAIL: % row inserted with a disabled employee', v_tbl;
        exception
            when others then
                get stacked diagnostics v_detail = pg_exception_detail;
                if v_detail is distinct from 'NORA_EMPLOYEE_NOT_ASSIGNABLE' then raise; end if;
        end;
    end loop;

    -- 11b. UPDATE sales_id active -> disabled denied, on every table
    begin
        update public.deals set sales_id = v_emp where id = v_tmp;
        raise exception 'FAIL: deal re-assigned to a disabled employee';
    exception
        when others then
            get stacked diagnostics v_detail = pg_exception_detail;
            if v_detail is distinct from 'NORA_EMPLOYEE_NOT_ASSIGNABLE' then raise; end if;
    end;
    update public.companies set sales_id = v_admin where id = v_company;
    update public.contacts set sales_id = v_admin where id = v_contact;
    update public.tasks set sales_id = v_admin where id = v_task;
    foreach v_tbl in array array['companies', 'contacts', 'tasks']
    loop
        begin
            case v_tbl
                when 'companies' then update public.companies set sales_id = v_emp where id = v_company;
                when 'contacts' then update public.contacts set sales_id = v_emp where id = v_contact;
                when 'tasks' then update public.tasks set sales_id = v_emp where id = v_task;
            end case;
            raise exception 'FAIL: % re-assigned to a disabled employee', v_tbl;
        exception
            when others then
                get stacked diagnostics v_detail = pg_exception_detail;
                if v_detail is distinct from 'NORA_EMPLOYEE_NOT_ASSIGNABLE' then raise; end if;
        end;
    end loop;

    -- 11c. Unrelated update of a record still owned by the disabled employee
    --      stays allowed (Erika still owns v_deal from the seed)
    if (select sales_id from public.deals where id = v_deal) <> v_emp then
        raise exception 'FAIL: test precondition — Erika must still own the seed deal';
    end if;
    update public.deals set description = 'Beschreibung nachgetragen' where id = v_deal;
    if (select description from public.deals where id = v_deal) <> 'Beschreibung nachgetragen'
       or (select sales_id from public.deals where id = v_deal) <> v_emp then
        raise exception 'FAIL: unrelated update on a disabled-owned deal was refused or altered ownership';
    end if;
    -- an explicit re-write of the unchanged sales_id is not a re-assignment
    update public.deals set sales_id = v_emp, description = 'Nochmal' where id = v_deal;
    -- restore the deal snapshot-relevant fields for section 10 semantics
    update public.deals set description = null where id = v_deal;

    -- 11d. UPDATE sales_id disabled -> active allowed
    update public.deals set sales_id = v_admin where id = v_deal;
    if (select sales_id from public.deals where id = v_deal) <> v_admin then
        raise exception 'FAIL: moving away from a disabled employee must be allowed';
    end if;
    update public.deals set sales_id = v_emp where id = v_deal; -- expect refusal
    raise exception 'FAIL: moving back to the disabled employee must be refused';
exception
    when others then
        if sqlerrm like '%moving back to the disabled employee%' then
            raise;
        end if;
        get stacked diagnostics v_detail = pg_exception_detail;
        if sqlerrm not like '%ROLLBACK_W2_TEST%' and v_detail is distinct from 'NORA_EMPLOYEE_NOT_ASSIGNABLE' then
            raise;
        end if;
        if v_detail = 'NORA_EMPLOYEE_NOT_ASSIGNABLE' then
            raise notice 'OK 11. active assignment authoritative (insert/update denied for disabled, unrelated and away-moves allowed)';
        end if;
end;
$$;

-- 11e. Historical authorship is never guarded: a contact note may keep (and
--      even be re-attributed to) a disabled author — the guard is not on
--      contact_notes / deal_notes at all. Separate rolled-back block.
do $$
declare
    v_anchor_uid uuid := gen_random_uuid();
    v_uid uuid := gen_random_uuid();
    v_anchor bigint;
    v_emp bigint;
    v_company bigint;
    v_contact bigint;
    v_note bigint;
begin
    -- On an empty database the first sign-up becomes the administrator
    -- (handle_new_user). Seed an admin anchor first so the author can be a
    -- plain office user and be disabled without touching the last-admin guard.
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', v_anchor_uid, 'authenticated', 'authenticated', 'w2-anchor@nora.test', 'x', now(), '{"provider":"email"}', '{"first_name":"W2","last_name":"Anchor"}', now(), now());
    select id into v_anchor from public.sales where user_id = v_anchor_uid;
    perform nora_private.apply_sales_role_change(v_anchor, 'admin', false);

    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', 'w2-author@nora.test', 'x', now(), '{"provider":"email"}', '{"first_name":"Alte","last_name":"Autorin"}', now(), now());
    select id into v_emp from public.sales where user_id = v_uid;
    perform nora_private.apply_sales_role_change(v_emp, 'office', false);
    insert into public.companies (name) values ('W2 Referenz Autor') returning id into v_company;
    insert into public.contacts (first_name, last_name, company_id) values ('Max', 'Autor', v_company) returning id into v_contact;
    insert into public.contact_notes (contact_id, text, sales_id) values (v_contact, 'alte Notiz', v_emp) returning id into v_note;
    perform nora_private.apply_sales_role_change(v_emp, 'office', true);
    update public.contact_notes set text = 'alte Notiz, korrigiert' where id = v_note;
    if (select sales_id from public.contact_notes where id = v_note) <> v_emp then
        raise exception 'FAIL: note lost its disabled author';
    end if;
    if exists (
        select 1 from pg_trigger
        where tgrelid in ('public.contact_notes'::regclass, 'public.deal_notes'::regclass)
          and tgname = 'guard_active_assignment_trigger'
    ) then
        raise exception 'FAIL: assignment guard must not exist on historical authorship tables';
    end if;
    raise notice 'OK 11e. historical authorship by a disabled employee stays valid';
    raise exception 'ROLLBACK_W2_TEST' using errcode = 'P0001';
exception
    when others then
        if sqlerrm not like '%ROLLBACK_W2_TEST%' then
            raise;
        end if;
end;
$$;

do $$
begin
    if exists (select 1 from public.sales where email::text like 'w2-%@nora.test')
       or exists (select 1 from auth.users where email like 'w2-%@nora.test')
       or exists (select 1 from public.companies where name like 'W2 Referenz%') then
        raise exception 'FAIL: test rows leaked (rollback did not happen)';
    end if;
end;
$$;

select 'lifecycle_reference_integrity_verification: OK' as result;
