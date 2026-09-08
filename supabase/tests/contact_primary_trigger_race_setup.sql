-- Atomic Contact Primary Intent — TRIGGER-RACE fixture (local/disposable only).
--
-- The X-matrix (contact_primary_cross_command_*) races the new primary
-- commands against the other COMMANDS. This matrix races them against a RAW,
-- intent-free contact-name write — the path that fires
-- nora_private.sync_individual_company_name, which updates public.companies
-- from inside a contact UPDATE and is therefore contact-row-first by
-- construction. That edge produced the second release-blocking deadlock
-- (2026-09-08) and is reachable in the product through Contact Merge
-- (ContactMergeButton -> dataProvider.mergeContacts -> raw contacts PATCH of
-- first_name/last_name).
--
-- Per ROUND it creates:
--   C  Privatkundenakte (customer_kind = individual), self contact S which is
--      also its Hauptansprechpartner, plus a second contact T
--   D  ordinary business customer with primary D1 and non-primary D2
--
-- Call once per round with -v round=<n>. Cleaned up by
-- contact_primary_trigger_race_verify.sql.

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

create table if not exists public.cpi_t_ctx (
    round int, key text, id bigint, primary key (round, key)
);
create table if not exists public.cpi_t_results (
    id bigint generated always as identity primary key,
    scenario text, round int, role text, outcome text, sqlstate text, detail text,
    started_at timestamptz, finished_at timestamptz
);
revoke all on public.cpi_t_ctx from anon, authenticated, service_role;
revoke all on public.cpi_t_results from anon, authenticated, service_role;

reset client_min_messages;

select set_config('cpit.round', :'round', false);

do $$
declare
    v_round int := current_setting('cpit.round', true)::int;
    v_c bigint; v_s bigint; v_t bigint; v_d bigint; v_d1 bigint; v_d2 bigint;
begin
    -- Privatkundenakte: self contact is also the Hauptansprechpartner
    insert into public.companies (name, customer_kind) values ('T Privat R' || v_round, 'business') returning id into v_c;
    insert into public.contacts (first_name, last_name, company_id, is_primary) values ('TSelbst', 'R' || v_round, v_c, true)  returning id into v_s;
    insert into public.contacts (first_name, last_name, company_id, is_primary) values ('TZweit',  'R' || v_round, v_c, false) returning id into v_t;
    update public.companies
       set self_contact_id = v_s, customer_kind = 'individual', name = 'TSelbst R' || v_round
     where id = v_c;

    -- ordinary business customer, used for the "different customer" and the
    -- "non-self contact" scenarios
    insert into public.companies (name, customer_kind) values ('T Firma R' || v_round, 'business') returning id into v_d;
    insert into public.contacts (first_name, last_name, company_id, is_primary) values ('TFirmaHaupt', 'R' || v_round, v_d, true)  returning id into v_d1;
    insert into public.contacts (first_name, last_name, company_id, is_primary) values ('TFirmaNeben', 'R' || v_round, v_d, false) returning id into v_d2;

    insert into public.cpi_t_ctx (round, key, id) values
        (v_round, 'c', v_c), (v_round, 's', v_s), (v_round, 't', v_t),
        (v_round, 'd', v_d), (v_round, 'd1', v_d1), (v_round, 'd2', v_d2);
end;
$$;
