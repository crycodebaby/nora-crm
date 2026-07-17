-- Nora CRM v0.4b.1 — local RLS test setup (NOT part of production migrations)
-- Creates NOLOGIN nobypassrls role; matrix tests run as postgres with SET LOCAL ROLE.
-- Usage:
--   Get-Content supabase/tests/rbac_rls_setup.sql -Raw | docker exec -i supabase_db_atomic-crm-demo psql -U postgres -d postgres

\set ON_ERROR_STOP on

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'nora_rls_test') then
        create role nora_rls_test
            nosuperuser
            nobypassrls
            noinherit
            nologin;
    end if;
end;
$$;

grant authenticated to nora_rls_test;
grant nora_rls_test to postgres;
grant usage on schema public to nora_rls_test;
grant usage on schema nora_private to nora_rls_test;
grant all on all tables in schema public to nora_rls_test;
grant execute on all functions in schema public to nora_rls_test;
grant execute on all functions in schema nora_private to nora_rls_test;

create or replace function pg_temp.nora_test_seed_user(
    p_user_id uuid,
    p_email text,
    p_role text,
    p_disabled boolean default false
)
returns bigint
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
    v_sale_id bigint;
begin
    insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, recovery_sent_at, last_sign_in_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token
    )
    values (
        '00000000-0000-0000-0000-000000000000', p_user_id, 'authenticated', 'authenticated',
        p_email, crypt('password', gen_salt('bf')), now(), now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
        '', '', '', ''
    )
    on conflict (id) do nothing;

    begin
        insert into public.sales (first_name, last_name, email, user_id, role, administrator, disabled)
        values ('Test', p_role, p_email, p_user_id, p_role, (p_role = 'admin'), p_disabled)
        returning id into v_sale_id;
    exception
        when unique_violation then
            select id into v_sale_id from public.sales where user_id = p_user_id;
            perform nora_private.apply_sales_role_change(v_sale_id, p_role, p_disabled);
    end;

    return v_sale_id;
end;
$$;

do $$
declare
    v_admin uuid := 'b1000000-0000-4000-8000-000000000001';
    v_office uuid := 'b1000000-0000-4000-8000-000000000002';
    v_viewer uuid := 'b1000000-0000-4000-8000-000000000003';
    v_disabled uuid := 'b1000000-0000-4000-8000-000000000004';
    v_disabled_admin uuid := 'b1000000-0000-4000-8000-000000000005';
begin
    perform pg_temp.nora_test_seed_user(v_admin, 'rbac-admin@nora.test', 'admin');
    perform pg_temp.nora_test_seed_user(v_office, 'rbac-office@nora.test', 'office');
    perform pg_temp.nora_test_seed_user(v_viewer, 'rbac-viewer@nora.test', 'viewer');
    perform pg_temp.nora_test_seed_user(v_disabled, 'rbac-disabled@nora.test', 'office', true);
    perform pg_temp.nora_test_seed_user(v_disabled_admin, 'rbac-disabled-admin@nora.test', 'admin', true);

    if exists (select 1 from public.sales where user_id = v_admin and administrator = false) then
        raise exception 'admin role must mirror administrator=true';
    end if;
    if exists (select 1 from public.sales where user_id = v_office and administrator = true) then
        raise exception 'office role must mirror administrator=false';
    end if;
end;
$$;

select 'rbac_rls_setup: OK' as result;
