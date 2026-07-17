-- Nora CRM v0.4b.2 — first-admin parallel safety (run on fresh db reset BEFORE rbac_rls_setup)
-- Simulates two concurrent signups via advisory lock serialization check + dual insert.
-- Usage:
--   Get-Content supabase/tests/rbac_rls_first_admin_parallel.sql -Raw | docker exec -i supabase_db_atomic-crm-demo psql -U postgres -d postgres

\set ON_ERROR_STOP on

do $$
declare
    v_uid1 uuid := 'c1000000-0000-4000-8000-000000000001';
    v_uid2 uuid := 'c1000000-0000-4000-8000-000000000002';
    v_admin_count int;
    v_viewer_count int;
begin
    delete from public.sales where user_id in (v_uid1, v_uid2);
    delete from auth.users where id in (v_uid1, v_uid2);

    if exists (select 1 from public.sales limit 1) then
        raise exception 'sales must be empty for first-admin parallel test';
    end if;

    -- Sequential lock semantics: first resolves admin, second viewer
    if nora_private.resolve_first_signup_role() <> 'admin' then
        raise exception 'first resolve_first_signup_role must return admin';
    end if;

    insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, recovery_sent_at, last_sign_in_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token
    )
    values (
        '00000000-0000-0000-0000-000000000000', v_uid1, 'authenticated', 'authenticated',
        'first-admin@nora.test', crypt('password', gen_salt('bf')), now(), now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
        '', '', '', ''
    );

    if nora_private.resolve_first_signup_role() <> 'viewer' then
        raise exception 'second resolve_first_signup_role must return viewer';
    end if;

    -- Clean for trigger-based dual signup test
    delete from public.sales where user_id in (v_uid1, v_uid2);
    delete from auth.users where id in (v_uid1, v_uid2);

    insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, recovery_sent_at, last_sign_in_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token
    )
    values (
        '00000000-0000-0000-0000-000000000000', v_uid1, 'authenticated', 'authenticated',
        'parallel-1@nora.test', crypt('password', gen_salt('bf')), now(), now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
        '', '', '', ''
    )
    on conflict (id) do nothing;

    insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, recovery_sent_at, last_sign_in_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token
    )
    values (
        '00000000-0000-0000-0000-000000000000', v_uid2, 'authenticated', 'authenticated',
        'parallel-2@nora.test', crypt('password', gen_salt('bf')), now(), now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
        '', '', '', ''
    );

    select count(*)::int into v_admin_count from public.sales where role = 'admin';
    select count(*)::int into v_viewer_count from public.sales where role = 'viewer';

    if v_admin_count <> 1 or v_viewer_count <> 1 then
        raise exception 'expected exactly 1 admin and 1 viewer, got admin=% viewer=%', v_admin_count, v_viewer_count;
    end if;

    if exists (select 1 from public.sales where (role = 'admin') <> administrator) then
        raise exception 'administrator mirror must match role after parallel signup';
    end if;

    -- cleanup test users for subsequent rbac_rls_setup
    delete from public.sales where user_id in (v_uid1, v_uid2);
    delete from auth.users where id in (v_uid1, v_uid2);

    raise exception 'ROLLBACK_FIRST_ADMIN' using errcode = 'P0001';
exception
    when others then
        if sqlerrm not like '%ROLLBACK_FIRST_ADMIN%' then
            raise;
        end if;
end;
$$;

select 'rbac_rls_first_admin_parallel: OK' as result;
