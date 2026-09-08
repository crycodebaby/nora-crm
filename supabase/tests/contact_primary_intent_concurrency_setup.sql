-- Atomic Contact Primary Intent — concurrency fixture (local/disposable only).
-- Creates (and commits) one office user plus three customers with contacts so
-- that REAL parallel psql sessions can race the atomic commands. Run by
-- contact_primary_intent_concurrency_runner.ps1; never against Production.
-- The fixture rows are removed by contact_primary_intent_concurrency_verify.sql
-- (contacts/companies only — sales rows stay, the W6-B guard forbids DELETE).

\set ON_ERROR_STOP on

do $$
declare
    v_user uuid := 'c0000000-0000-4000-8000-0000000000c1';
    v_sale bigint;
    v_admin uuid := 'c0000000-0000-4000-8000-0000000000c0';
    v_admin_sale bigint;
begin
    insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        recovery_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
    )
    values
        ('00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated',
         'cpi-conc-admin@nora.test', crypt('password', gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
        ('00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated',
         'cpi-conc-office@nora.test', crypt('password', gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '')
    on conflict (id) do nothing;

    begin
        insert into public.sales (first_name, last_name, email, user_id, role, administrator, disabled)
        values ('Conc', 'Admin', 'cpi-conc-admin@nora.test', v_admin, 'admin', true, false)
        returning id into v_admin_sale;
    exception when unique_violation then
        select id into v_admin_sale from public.sales where user_id = v_admin;
        perform nora_private.apply_sales_role_change(v_admin_sale, 'admin', false);
    end;
    begin
        insert into public.sales (first_name, last_name, email, user_id, role, administrator, disabled)
        values ('Conc', 'Office', 'cpi-conc-office@nora.test', v_user, 'office', false, false)
        returning id into v_sale;
    exception when unique_violation then
        select id into v_sale from public.sales where user_id = v_user;
        perform nora_private.apply_sales_role_change(v_sale, 'office', false);
    end;
end;
$$;

-- deterministic fixture ids via a scratch table (dropped by verify)
drop table if exists public.cpi_conc_ctx;
create table public.cpi_conc_ctx (key text primary key, id bigint);
revoke all on public.cpi_conc_ctx from anon, authenticated, service_role;

do $$
declare
    v_k1 bigint; v_k2 bigint; v_k3 bigint;
    v_a bigint; v_b bigint; v_c bigint; v_d bigint; v_e bigint;
begin
    insert into public.companies (name, customer_kind) values ('Conc K1', 'business') returning id into v_k1;
    insert into public.companies (name, customer_kind) values ('Conc K2', 'business') returning id into v_k2;
    insert into public.companies (name, customer_kind) values ('Conc K3', 'business') returning id into v_k3;
    -- K1: A primary, B and C non-primary
    insert into public.contacts (first_name, last_name, company_id, is_primary) values ('Conc', 'A', v_k1, true) returning id into v_a;
    insert into public.contacts (first_name, last_name, company_id, is_primary) values ('Conc', 'B', v_k1, false) returning id into v_b;
    insert into public.contacts (first_name, last_name, company_id, is_primary) values ('Conc', 'C', v_k1, false) returning id into v_c;
    -- K2: D primary; K3: E primary (for the move race)
    insert into public.contacts (first_name, last_name, company_id, is_primary) values ('Conc', 'D', v_k2, true) returning id into v_d;
    insert into public.contacts (first_name, last_name, company_id, is_primary) values ('Conc', 'E', v_k3, true) returning id into v_e;
    insert into public.cpi_conc_ctx values ('k1', v_k1), ('k2', v_k2), ('k3', v_k3), ('a', v_a), ('b', v_b), ('c', v_c), ('d', v_d), ('e', v_e);
    raise notice 'conc fixture: k1=% k2=% k3=% a=% b=% c=% d=% e=%', v_k1, v_k2, v_k3, v_a, v_b, v_c, v_d, v_e;
end;
$$;
