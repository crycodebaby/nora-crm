-- Nora CRM v0.4b.1 RBAC/RLS matrix — run after rbac_rls_setup.sql as postgres
-- Uses SET LOCAL ROLE nora_rls_test (NOBYPASSRLS, NOLOGIN) — no test password in Git.
-- Usage:
--   Get-Content supabase/tests/rbac_rls_matrix.sql -Raw | docker exec -i supabase_db_atomic-crm-demo psql -U postgres -d postgres

\set ON_ERROR_STOP on

do $$
declare
    v_admin uuid := 'b1000000-0000-4000-8000-000000000001';
    v_office uuid := 'b1000000-0000-4000-8000-000000000002';
    v_viewer uuid := 'b1000000-0000-4000-8000-000000000003';
    v_disabled uuid := 'b1000000-0000-4000-8000-000000000004';
    v_disabled_admin uuid := 'b1000000-0000-4000-8000-000000000005';
    v_company_id bigint;
    v_deal_id bigint;
    v_contact_id bigint;
    v_task_id bigint;
    v_row_count int;
begin
    set local role nora_rls_test;

    -- anon: no CRM access
    set local role anon;
    begin
        perform count(*) from public.companies;
        raise exception 'anon must not read companies';
    exception
        when insufficient_privilege then
            null;
        when others then
            if sqlerrm not like '%permission denied%'
                and sqlerrm not like '%row-level security%' then
                raise;
            end if;
    end;

    begin
        perform nora_private.has_role(array['admin']);
        raise exception 'anon must not execute nora_private.has_role';
    exception
        when insufficient_privilege then
            null;
    end;

    set local role nora_rls_test;
    set local role authenticated;

    -- disabled user
    perform set_config('request.jwt.claim.sub', v_disabled::text, true);
    if nora_private.is_active_user() then
        raise exception 'disabled user must not be active';
    end if;
    if nora_private.current_role() is not null then
        raise exception 'disabled user must not have a role';
    end if;

    -- disabled admin cannot use role RPC
    perform set_config('request.jwt.claim.sub', v_disabled_admin::text, true);
    begin
        perform public.set_sales_role_by_admin(
            (select id from public.sales where user_id = v_viewer),
            'office'
        );
        raise exception 'disabled admin must not call set_sales_role_by_admin';
    exception
        when others then
            if sqlerrm not like '%forbidden%' then
                raise;
            end if;
    end;

    -- missing sales profile
    perform set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000009999', true);
    if nora_private.is_active_user() then
        raise exception 'user without sales profile must not be active';
    end if;

    -- invalid JWT sub (non-UUID) must not grant access
    perform set_config('request.jwt.claim.sub', 'not-a-valid-uuid', true);
    if nora_private.is_active_user() then
        raise exception 'invalid jwt sub must not be active';
    end if;
    if nora_private.current_role() is not null then
        raise exception 'invalid jwt sub must not resolve role';
    end if;

    -- viewer
    perform set_config('request.jwt.claim.sub', v_viewer::text, true);
    if nora_private.current_role() <> 'viewer' then
        raise exception 'viewer JWT must resolve to viewer role';
    end if;
    perform count(*) from public.companies;

    begin
        insert into public.companies (name) values ('Viewer Fail Co');
        raise exception 'viewer must not insert companies';
    exception
        when others then
            if sqlerrm not like '%row-level security%'
                and sqlerrm not like '%permission denied%' then
                raise;
            end if;
    end;

    if nora_private.has_role(array['admin', 'office']) then
        raise exception 'viewer must not pass audit read role check';
    end if;

    -- office
    perform set_config('request.jwt.claim.sub', v_office::text, true);

    insert into public.companies (name, sales_id)
    values (
        'Office Test Co',
        (select id from public.sales where user_id = v_office)
    )
    returning id into v_company_id;

    insert into public.contacts (first_name, last_name, company_id)
    values ('Office', 'Kontakt', v_company_id)
    returning id into v_contact_id;

    insert into public.deals (name, company_id, stage, category)
    values ('Office Test Deal', v_company_id, 'neue-anfrage', 'fensterservice')
    returning id into v_deal_id;

    update public.deals set archived_at = now() where id = v_deal_id;

    insert into public.tasks (contact_id, type, text)
    values (v_contact_id, 'call', 'RBAC office task')
    returning id into v_task_id;

    -- v0.3l: RLS filters rows without error; office must see zero global audit rows
    select count(*)::int into v_row_count from public.audit_events;
    if v_row_count > 0 then
        raise exception 'office must not see audit_events globally (got % rows)', v_row_count;
    end if;

    perform public.get_entity_audit_events('company', v_company_id, 5, null);

    delete from public.companies where id = v_company_id;
    get diagnostics v_row_count = row_count;
    if v_row_count > 0 then
        raise exception 'office must not delete companies';
    end if;

    begin
        update public.sales set role = 'admin' where user_id = v_office;
        get diagnostics v_row_count = row_count;
        if v_row_count > 0 then
            raise exception 'office must not update own role directly';
        end if;
    exception
        when others then
            if sqlerrm not like '%immutable%' then
                raise;
            end if;
    end;

    -- GUC backdoor removed (v0.4b.2): privilege changes only via nora_role_manager
    perform set_config('nora.allow_sales_privilege_change', 'on', true);
    perform set_config('nora.privilege_rpc_token', gen_random_uuid()::text, true);
    begin
        update public.sales set role = 'admin' where user_id = v_office;
        get diagnostics v_row_count = row_count;
        if v_row_count > 0 then
            raise exception 'GUC must not allow privilege escalation';
        end if;
    exception
        when others then
            if sqlerrm not like '%immutable%' then
                raise;
            end if;
    end;

    begin
        perform public.set_sales_role_by_admin(
            (select id from public.sales where user_id = v_office),
            'admin'
        );
        raise exception 'office must not call set_sales_role_by_admin';
    exception
        when others then
            if sqlerrm not like '%forbidden%' then
                raise;
            end if;
    end;

    begin
        update public.companies set customer_number = 'KD-999999' where id = v_company_id;
        raise exception 'office must not change customer_number';
    exception
        when others then
            if sqlerrm not like '%immutable%' then
                raise;
            end if;
    end;

    begin
        update public.deals set case_number = 'VG-2099-000099' where id = v_deal_id;
        raise exception 'office must not change case_number';
    exception
        when others then
            if sqlerrm not like '%immutable%' then
                raise;
            end if;
    end;

    -- admin
    perform set_config('request.jwt.claim.sub', v_admin::text, true);

    perform count(*) from public.audit_events;
    perform public.get_audit_storage_stats();

    delete from public.tasks where id = v_task_id;
    delete from public.deals where id = v_deal_id;
    delete from public.contacts where id = v_contact_id;
    delete from public.companies where id = v_company_id;

    perform public.set_sales_role_by_admin(
        (select id from public.sales where user_id = v_viewer),
        'office'
    );

    perform public.set_sales_role_by_admin(
        (select id from public.sales where user_id = v_viewer),
        'viewer'
    );

    -- role/administrator mirror invariant
    if exists (
        select 1 from public.sales
        where (role = 'admin') <> administrator
    ) then
        raise exception 'role and administrator must never diverge';
    end if;

    begin
        update public.audit_events set event_type = 'hack' where false;
        raise exception 'audit_events must be append-only';
    exception
        when others then
            if sqlerrm not like '%append-only%'
                and sqlerrm not like '%permission denied%' then
                raise;
            end if;
    end;

    raise exception 'ROLLBACK_RBAC_TEST' using errcode = 'P0001';
exception
    when others then
        if sqlerrm not like '%ROLLBACK_RBAC_TEST%' then
            raise;
        end if;
end;
$$;

select 'rbac_rls_matrix: OK' as result;
