-- Atomic Contact Primary Intent — CROSS-COMMAND concurrency fixture
-- (local/disposable only; never against Production).
--
-- Creates the office user used by the workers plus, per ROUND, an independent
-- pair of customers so repeated races never depend on the residue of the
-- previous round:
--
--   C1  primary P1, non-primary P2, non-primary M (the contact that is moved)
--   C2  primary Q1, non-primary Q2
--
-- Call once per round with -v round=<n>. Ids land in public.cpi_x_ctx, results
-- in public.cpi_x_results; both are dropped by
-- contact_primary_cross_command_verify.sql.

\set ON_ERROR_STOP on

do $$
declare
    v_user uuid := 'c0000000-0000-4000-8000-0000000000c1';
    v_admin uuid := 'c0000000-0000-4000-8000-0000000000c0';
    v_sale bigint;
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

set client_min_messages = warning;

create table if not exists public.cpi_x_ctx (
    round int, key text, id bigint, primary key (round, key)
);
create table if not exists public.cpi_x_results (
    id bigint generated always as identity primary key,
    scenario text, round int, role text, outcome text, sqlstate text, detail text,
    operation_id uuid, recorded_at timestamptz default clock_timestamp()
);
revoke all on public.cpi_x_ctx from anon, authenticated, service_role;
revoke all on public.cpi_x_results from anon, authenticated, service_role;

reset client_min_messages;

select set_config('cpix.round', :'round', false);

do $$
declare
    v_round int := current_setting('cpix.round', true)::int;
    v_c1 bigint; v_c2 bigint; v_p1 bigint; v_p2 bigint; v_m bigint; v_q1 bigint; v_q2 bigint;
begin
    insert into public.companies (name, customer_kind) values ('X C1 R' || v_round, 'business') returning id into v_c1;
    insert into public.companies (name, customer_kind) values ('X C2 R' || v_round, 'business') returning id into v_c2;

    insert into public.contacts (first_name, last_name, company_id, is_primary) values ('X', 'P1 R' || v_round, v_c1, true)  returning id into v_p1;
    insert into public.contacts (first_name, last_name, company_id, is_primary) values ('X', 'P2 R' || v_round, v_c1, false) returning id into v_p2;
    insert into public.contacts (first_name, last_name, company_id, is_primary) values ('X', 'M R'  || v_round, v_c1, false) returning id into v_m;
    insert into public.contacts (first_name, last_name, company_id, is_primary) values ('X', 'Q1 R' || v_round, v_c2, true)  returning id into v_q1;
    insert into public.contacts (first_name, last_name, company_id, is_primary) values ('X', 'Q2 R' || v_round, v_c2, false) returning id into v_q2;

    insert into public.cpi_x_ctx (round, key, id) values
        (v_round, 'c1', v_c1), (v_round, 'c2', v_c2),
        (v_round, 'p1', v_p1), (v_round, 'p2', v_p2), (v_round, 'm', v_m),
        (v_round, 'q1', v_q1), (v_round, 'q2', v_q2);
end;
$$;
