-- Nora CRM v0.4b.2 — capability model, sales_directory, role RPC (after rbac_rls_setup.sql)
-- Usage:
--   Get-Content supabase/tests/rbac_rls_final_hardening.sql -Raw | docker exec -i supabase_db_atomic-crm-demo psql -U postgres -d postgres

\set ON_ERROR_STOP on

do $$
declare
    v_admin uuid := 'b1000000-0000-4000-8000-000000000001';
    v_office uuid := 'b1000000-0000-4000-8000-000000000002';
    v_viewer uuid := 'b1000000-0000-4000-8000-000000000003';
    v_disabled uuid := 'b1000000-0000-4000-8000-000000000004';
    v_viewer_sale_id bigint;
    v_office_sale_id bigint;
    v_row_count int;
    v_cols text;
begin
    set local role nora_rls_test;

    -- A. nora_role_manager capability
    if not exists (select 1 from pg_roles where rolname = 'nora_role_manager') then
        raise exception 'nora_role_manager role missing';
    end if;
    if exists (
        select 1 from pg_roles
        where rolname = 'nora_role_manager' and (rolcanlogin or rolbypassrls)
    ) then
        raise exception 'nora_role_manager must be NOLOGIN and NOBYPASSRLS';
    end if;
    if pg_has_role('authenticated', 'nora_role_manager', 'member') then
        raise exception 'authenticated must not be member of nora_role_manager';
    end if;
    if has_function_privilege('authenticated', 'nora_private.apply_sales_role_change(bigint, text, boolean)', 'EXECUTE') then
        raise exception 'authenticated must not EXECUTE apply_sales_role_change';
    end if;

    -- GUC backdoor removed
    perform set_config('nora.allow_sales_privilege_change', 'on', true);
    perform set_config('nora.privilege_rpc_token', gen_random_uuid()::text, true);
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', v_office::text, true);
    begin
        update public.sales set role = 'admin' where user_id = v_office;
        get diagnostics v_row_count = row_count;
        if v_row_count > 0 then
            raise exception 'GUC token must not allow privilege escalation';
        end if;
    exception
        when others then
            if sqlerrm not like '%immutable%' then
                raise;
            end if;
    end;

    set local role nora_rls_test;
    set local role authenticated;

    -- B. Role RPC matrix
    perform set_config('request.jwt.claim.sub', v_admin::text, true);
    select id into v_viewer_sale_id from public.sales where user_id = v_viewer;

    perform public.set_sales_role_by_admin(v_viewer_sale_id, 'office');
    if (select role from public.sales where id = v_viewer_sale_id) <> 'office' then
        raise exception 'admin RPC must set viewer to office';
    end if;

    perform public.set_sales_role_by_admin(v_viewer_sale_id, 'viewer', true);
    if (select disabled from public.sales where id = v_viewer_sale_id) is distinct from true then
        raise exception 'admin RPC must deactivate user';
    end if;

    perform public.set_sales_role_by_admin(v_viewer_sale_id, 'viewer', false);

    perform set_config('request.jwt.claim.sub', v_office::text, true);
    begin
        perform public.set_sales_role_by_admin(v_viewer_sale_id, 'admin');
        raise exception 'office must not call role RPC';
    exception
        when others then
            if sqlerrm not like '%forbidden%' then
                raise;
            end if;
    end;

    perform set_config('request.jwt.claim.sub', v_viewer::text, true);
    begin
        perform public.set_sales_role_by_admin(v_viewer_sale_id, 'admin');
        raise exception 'viewer must not call role RPC';
    exception
        when others then
            if sqlerrm not like '%forbidden%' then
                raise;
            end if;
    end;

    -- direct disabled change blocked
    begin
        update public.sales set disabled = true where user_id = v_viewer;
        get diagnostics v_row_count = row_count;
        if v_row_count > 0 then
            raise exception 'direct disabled change must be blocked';
        end if;
    exception
        when others then
            if sqlerrm not like '%immutable%' then
                raise;
            end if;
    end;

    -- role/administrator mirror
    if exists (
        select 1 from public.sales where (role = 'admin') <> administrator
    ) then
        raise exception 'role and administrator must stay in sync';
    end if;

    -- C. sales_directory
    perform set_config('request.jwt.claim.sub', v_viewer::text, true);
    perform count(*) from public.sales_directory;

    perform set_config('request.jwt.claim.sub', v_disabled::text, true);
    if (select count(*) from public.sales_directory) > 0 then
        raise exception 'disabled must not read sales_directory';
    end if;

    set local role anon;
    begin
        perform count(*) from public.sales_directory;
        raise exception 'anon must not read sales_directory';
    exception
        when insufficient_privilege then
            null;
        when others then
            if sqlerrm not like '%permission denied%'
                and sqlerrm not like '%row-level security%' then
                raise;
            end if;
    end;

    set local role nora_rls_test;
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', v_viewer::text, true);

    select string_agg(column_name, ',' order by ordinal_position)
    into v_cols
    from information_schema.columns
    where table_schema = 'public' and table_name = 'sales_directory';

    if v_cols like '%user_id%' or v_cols like '%role%' or v_cols like '%administrator%'
        or v_cols like '%disabled%' or v_cols like '%email%' then
        raise exception 'sales_directory exposes sensitive columns: %', v_cols;
    end if;

    -- D. sales SELECT tightened: viewer sees only own row on sales table
    if (select count(*) from public.sales) <> 1 then
        raise exception 'viewer must see only own sales row, got %', (select count(*) from public.sales);
    end if;
    if not exists (select 1 from public.sales where user_id = v_viewer) then
        raise exception 'viewer must see own sales profile';
    end if;

    -- admin sees all
    perform set_config('request.jwt.claim.sub', v_admin::text, true);
    if (select count(*) from public.sales) < 4 then
        raise exception 'admin must see all sales rows';
    end if;

    -- office sees only own on sales
    perform set_config('request.jwt.claim.sub', v_office::text, true);
    select id into v_office_sale_id from public.sales;
    if (select count(*) from public.sales) <> 1 then
        raise exception 'office must see only own sales row on public.sales';
    end if;
    if not exists (select 1 from public.sales where user_id = v_office) then
        raise exception 'office must see own profile on public.sales';
    end if;

    -- E. Current PostgREST sends JWT data through request.jwt.claims JSON.
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config(
        'request.jwt.claims',
        jsonb_build_object(
            'sub', v_viewer::text,
            'role', 'authenticated'
        )::text,
        true
    );

    if nora_private.safe_auth_uid() is distinct from v_viewer then
        raise exception 'safe_auth_uid must resolve sub from request.jwt.claims';
    end if;
    if (select count(*) from public.sales) <> 1 then
        raise exception 'claims JSON viewer must see exactly one own sales row';
    end if;
    if not exists (select 1 from public.sales where user_id = v_viewer) then
        raise exception 'claims JSON viewer must see own sales profile';
    end if;
    if exists (select 1 from public.sales where user_id <> v_viewer) then
        raise exception 'claims JSON viewer must not see foreign sales profiles';
    end if;

    raise exception 'ROLLBACK_FINAL_HARDENING' using errcode = 'P0001';
exception
    when others then
        if sqlerrm not like '%ROLLBACK_FINAL_HARDENING%' then
            raise;
        end if;
end;
$$;

select 'rbac_rls_final_hardening: OK' as result;
