-- Nora CRM — W7-R1B Deal.company_id Contract Parity verification (2026-09-13)
-- Run after: npx supabase db reset --local
-- Usage: docker exec -i supabase_db_atomic-crm-demo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/deal_company_required_verification.sql
--
-- Self-contained: everything runs inside one transaction that is rolled back
-- at the end. Safe at any position after a reset, on an empty database or
-- with fixtures.
--
-- Contract: every Nora deal belongs to exactly one company.
--
--   1. schema: public.deals.company_id is NOT NULL, no default, FK to
--      companies(id) still present and validated (its ON UPDATE / ON DELETE
--      behaviour is deliberately NOT pinned here — W7-R1B does not own it)
--   2. T-SQL-1 insert with an existing company succeeds
--   3. T-SQL-2 insert without company_id is rejected (23502)
--   4. T-SQL-3 insert with company_id = NULL is rejected (23502)
--   5. T-SQL-4 update SET company_id = NULL is rejected (23502), row unchanged
--   6. T-SQL-5 update to another existing company succeeds
--   7. T-SQL-6 Quick Capture assigns the server-determined company and
--      p_deal.company_id cannot bend it to NULL or to another company
--   8. T-SQL-7 a non-existent company is still rejected by the FK (23503)

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- 1. Schema shape
-- ---------------------------------------------------------------------------
do $$
begin
    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'deals'
          and column_name = 'company_id' and is_nullable = 'NO'
    ) then
        raise exception '1: public.deals.company_id must be NOT NULL';
    end if;

    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'deals'
          and column_name = 'company_id' and column_default is not null
    ) then
        raise exception '1: public.deals.company_id must not have a default (no artificial company)';
    end if;

    if not exists (
        select 1 from pg_constraint c
        where c.conrelid = 'public.deals'::regclass
          and c.conname = 'deals_company_id_fkey'
          and c.contype = 'f'
          and c.confrelid = 'public.companies'::regclass
          and c.convalidated
    ) then
        raise exception '1: deals_company_id_fkey → public.companies must exist and be validated';
    end if;

    raise notice 'OK 1. schema: deals.company_id NOT NULL, no default, FK present';
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
create temp table r1b_ctx (
    key text primary key,
    id bigint
) on commit drop;

do $$
declare
    v_admin_user uuid := 'd0000000-0000-4000-8000-000000000010';
    v_office_user uuid := 'd0000000-0000-4000-8000-000000000011';
    v_admin_sale_id bigint;
    v_office_sale_id bigint;
    v_k1 bigint;
    v_k2 bigint;
begin
    insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        recovery_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
    )
    values
        ('00000000-0000-0000-0000-000000000000', v_admin_user, 'authenticated', 'authenticated',
         'r1b-admin@nora.test', crypt('password', gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
        ('00000000-0000-0000-0000-000000000000', v_office_user, 'authenticated', 'authenticated',
         'r1b-office@nora.test', crypt('password', gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '')
    on conflict (id) do nothing;

    -- handle_new_user may already have created the sales rows (pattern of the
    -- other suites). The admin fixture keeps the last-active-admin guard
    -- satisfied on an empty database.
    begin
        insert into public.sales (first_name, last_name, email, user_id, role, administrator, disabled)
        values ('R1B', 'Admin', 'r1b-admin@nora.test', v_admin_user, 'admin', true, false)
        returning id into v_admin_sale_id;
    exception when unique_violation then
        select id into v_admin_sale_id from public.sales where user_id = v_admin_user;
        perform nora_private.apply_sales_role_change(v_admin_sale_id, 'admin', false);
    end;
    begin
        insert into public.sales (first_name, last_name, email, user_id, role, administrator, disabled)
        values ('R1B', 'Office', 'r1b-office@nora.test', v_office_user, 'office', false, false)
        returning id into v_office_sale_id;
    exception when unique_violation then
        select id into v_office_sale_id from public.sales where user_id = v_office_user;
        perform nora_private.apply_sales_role_change(v_office_sale_id, 'office', false);
    end;

    insert into public.companies (name, customer_kind) values ('R1B Erstkunde GmbH', 'business') returning id into v_k1;
    insert into public.companies (name, customer_kind) values ('R1B Zweitkunde GmbH', 'business') returning id into v_k2;

    insert into r1b_ctx values
        ('office_sale', v_office_sale_id), ('k1', v_k1), ('k2', v_k2);

    raise notice 'OK fixtures: office=% k1=% k2=%', v_office_sale_id, v_k1, v_k2;
end;
$$;

create or replace function pg_temp.r1b_id(p_key text)
returns bigint language sql as $$ select id from r1b_ctx where key = p_key $$;

-- ---------------------------------------------------------------------------
-- 2.–8. Raw table contract (as postgres: the constraint binds every role)
-- ---------------------------------------------------------------------------
do $$
declare
    v_k1 bigint := pg_temp.r1b_id('k1');
    v_k2 bigint := pg_temp.r1b_id('k2');
    v_missing_company bigint;
    v_deal bigint;
    v_sqlstate text;
    v_column text;
    v_rejected boolean;
begin
    -- T-SQL-1: valid deal with an existing company
    insert into public.deals (name, company_id, stage)
    values ('R1B gültiger Vorgang', v_k1, 'neue-anfrage')
    returning id into v_deal;
    if (select company_id from public.deals where id = v_deal) <> v_k1 then
        raise exception 'T-SQL-1: deal was not stored with its company';
    end if;
    insert into r1b_ctx values ('deal', v_deal);
    raise notice 'OK T-SQL-1 insert with existing company succeeds (deal=%)', v_deal;

    -- T-SQL-2: insert without company_id
    v_rejected := false;
    begin
        insert into public.deals (name, stage) values ('R1B ohne Kunde', 'neue-anfrage');
    exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_column = column_name;
        v_rejected := true;
    end;
    if not v_rejected then
        raise exception 'T-SQL-2: insert without company_id was accepted';
    end if;
    if v_sqlstate <> '23502' or v_column <> 'company_id' then
        raise exception 'T-SQL-2: expected 23502 on company_id, got % on %', v_sqlstate, v_column;
    end if;
    raise notice 'OK T-SQL-2 insert without company_id rejected (23502)';

    -- T-SQL-3: insert with explicit NULL
    v_rejected := false;
    begin
        insert into public.deals (name, company_id, stage) values ('R1B NULL-Kunde', null, 'neue-anfrage');
    exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_column = column_name;
        v_rejected := true;
    end;
    if not v_rejected then
        raise exception 'T-SQL-3: insert with company_id = NULL was accepted';
    end if;
    if v_sqlstate <> '23502' or v_column <> 'company_id' then
        raise exception 'T-SQL-3: expected 23502 on company_id, got % on %', v_sqlstate, v_column;
    end if;
    raise notice 'OK T-SQL-3 insert with company_id = NULL rejected (23502)';

    -- T-SQL-4: update existing deal to NULL
    v_rejected := false;
    begin
        update public.deals set company_id = null where id = v_deal;
    exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_column = column_name;
        v_rejected := true;
    end;
    if not v_rejected then
        raise exception 'T-SQL-4: update SET company_id = NULL was accepted';
    end if;
    if v_sqlstate <> '23502' or v_column <> 'company_id' then
        raise exception 'T-SQL-4: expected 23502 on company_id, got % on %', v_sqlstate, v_column;
    end if;
    if (select company_id from public.deals where id = v_deal) <> v_k1 then
        raise exception 'T-SQL-4: rejected update changed the stored company';
    end if;
    raise notice 'OK T-SQL-4 update SET company_id = NULL rejected (23502), company kept';

    -- T-SQL-5: legitimate move to another existing company
    update public.deals set company_id = v_k2 where id = v_deal;
    if (select company_id from public.deals where id = v_deal) <> v_k2 then
        raise exception 'T-SQL-5: move to another existing company did not persist';
    end if;
    raise notice 'OK T-SQL-5 update to another existing company succeeds';

    -- T-SQL-7: the FK still refuses a company that does not exist (the
    -- NOT NULL change must not replace referential integrity)
    select coalesce(max(id), 0) + 1000000 into v_missing_company from public.companies;
    v_rejected := false;
    begin
        insert into public.deals (name, company_id, stage) values ('R1B Geisterkunde', v_missing_company, 'neue-anfrage');
    exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate;
        v_rejected := true;
    end;
    if not v_rejected or v_sqlstate <> '23503' then
        raise exception 'T-SQL-7: insert with a non-existent company must fail with 23503, got % (rejected=%)', v_sqlstate, v_rejected;
    end if;
    raise notice 'OK T-SQL-7 non-existent company still rejected by FK (23503)';
end;
$$;

-- ---------------------------------------------------------------------------
-- T-SQL-6: Quick Capture keeps assigning the server-determined company
-- ---------------------------------------------------------------------------
do $$
declare
    v_k1 bigint := pg_temp.r1b_id('k1');
    v_k2 bigint := pg_temp.r1b_id('k2');
    v_result jsonb;
    v_company bigint;
    v_deal_company bigint;
begin
    perform set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000011', true);
    execute 'set local role authenticated';

    -- 6a. new customer + deal: the deal gets exactly that new customer, even
    -- when the client payload tries to smuggle in a NULL company_id
    v_result := public.create_quick_capture_case(
        jsonb_build_object('name', 'R1B Schnellerfassung GmbH', 'customer_kind', 'business'),
        null,
        jsonb_build_object('first_name', 'Rita', 'last_name', 'Rechts'),
        null, null,
        jsonb_build_object('name', 'R1B Schnellvorgang neu', 'category', 'fensterservice', 'company_id', null)
    );
    v_company := (v_result->>'company_id')::bigint;
    select company_id into v_deal_company from public.deals where id = (v_result->>'deal_id')::bigint;
    if v_company is null or v_deal_company is distinct from v_company then
        raise exception 'T-SQL-6a: quick capture deal company % does not match new customer % (%)', v_deal_company, v_company, v_result;
    end if;
    if v_company in (v_k1, v_k2) then
        raise exception 'T-SQL-6a: quick capture did not create a new customer';
    end if;

    -- 6b. existing customer + deal: the deal gets that customer, even when
    -- the client payload names a different company
    v_result := public.create_quick_capture_case(
        null, v_k1,
        null, null, null,
        jsonb_build_object('name', 'R1B Schnellvorgang bestehend', 'category', 'fensterservice', 'company_id', v_k2)
    );
    select company_id into v_deal_company from public.deals where id = (v_result->>'deal_id')::bigint;
    if (v_result->>'company_id')::bigint <> v_k1 or v_deal_company <> v_k1 then
        raise exception 'T-SQL-6b: quick capture deal company % must be the existing customer % (%)', v_deal_company, v_k1, v_result;
    end if;

    execute 'reset role';
    raise notice 'OK T-SQL-6 quick capture assigns the server-determined company (new + existing, payload company_id ignored)';
end;
$$;

do $$
begin
    raise notice 'deal_company_required_verification: all checks passed';
end;
$$;

rollback;
