-- Nora CRM: safe_auth_role + set_sales_role_by_admin service_role claims
-- Usage (local only):
--   Get-Content supabase/tests/safe_auth_role_verification.sql -Raw | docker exec -i supabase_db_atomic-crm-demo psql -U postgres -d postgres
-- Requires rbac_rls_setup.sql style fixtures OR existing sales rows for admin/viewer.

\set ON_ERROR_STOP on

do $$
declare
    v_admin uuid;
    v_viewer uuid;
    v_viewer_sale_id bigint;
    v_role text;
begin
    -- Pick any active admin / viewer from current DB (prod-safe read-only selection for local clones).
    select user_id into v_admin
    from public.sales
    where role = 'admin' and coalesce(disabled, false) = false
    order by id
    limit 1;

    select user_id, id into v_viewer, v_viewer_sale_id
    from public.sales
    where role = 'viewer' and coalesce(disabled, false) = false
    order by id
    limit 1;

    if v_admin is null or v_viewer is null then
        raise notice 'SKIP safe_auth_role_verification: need at least one admin and one viewer sale';
        return;
    end if;

    -- 1) JSON claims path (current PostgREST / supabase-js service role)
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config(
        'request.jwt.claims',
        json_build_object('role', 'service_role')::text,
        true
    );
    v_role := nora_private.safe_auth_role();
    if v_role is distinct from 'service_role' then
        raise exception 'safe_auth_role must read role from request.jwt.claims, got %', v_role;
    end if;

    -- 2) Legacy GUC path
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.role', 'service_role', true);
    if nora_private.safe_auth_role() is distinct from 'service_role' then
        raise exception 'safe_auth_role must read legacy request.jwt.claim.role';
    end if;

    -- 3) Invalid JSON must not abort
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '{not-json', true);
    if nora_private.safe_auth_role() is not null then
        raise exception 'safe_auth_role must return NULL for invalid claims JSON';
    end if;

    -- 4) service_role may change viewer → admin (no Nora sales profile on JWT)
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config(
        'request.jwt.claims',
        json_build_object('role', 'service_role')::text,
        true
    );
    set local role service_role;
    perform public.set_sales_role_by_admin(v_viewer_sale_id, 'admin');
    if (select role from public.sales where id = v_viewer_sale_id) <> 'admin' then
        raise exception 'service_role RPC must set viewer to admin via claims JSON';
    end if;
    if (select administrator from public.sales where id = v_viewer_sale_id) is not true then
        raise exception 'administrator must sync to true for admin role';
    end if;

    -- restore viewer for further checks
    perform public.set_sales_role_by_admin(v_viewer_sale_id, 'viewer');

    -- 5) Nora admin JWT may change role
    set local role authenticated;
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', v_admin::text, true);
    perform set_config(
        'request.jwt.claims',
        json_build_object('role', 'authenticated', 'sub', v_admin::text)::text,
        true
    );
    perform public.set_sales_role_by_admin(v_viewer_sale_id, 'office');
    if (select role from public.sales where id = v_viewer_sale_id) <> 'office' then
        raise exception 'admin JWT must set viewer to office';
    end if;

    -- 6) viewer forbidden
    perform set_config('request.jwt.claim.sub', v_viewer::text, true);
    perform set_config(
        'request.jwt.claims',
        json_build_object('role', 'authenticated', 'sub', v_viewer::text)::text,
        true
    );
    begin
        perform public.set_sales_role_by_admin(v_viewer_sale_id, 'admin');
        raise exception 'viewer must not call role RPC';
    exception
        when insufficient_privilege then
            null;
        when others then
            if sqlerrm not like '%forbidden%' then
                raise;
            end if;
    end;

    -- restore baseline
    perform set_config('request.jwt.claim.sub', v_admin::text, true);
    perform set_config(
        'request.jwt.claims',
        json_build_object('role', 'authenticated', 'sub', v_admin::text)::text,
        true
    );
    perform public.set_sales_role_by_admin(v_viewer_sale_id, 'viewer');

    raise notice 'safe_auth_role_verification OK';
end;
$$;
