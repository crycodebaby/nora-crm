-- Nora CRM Customer & Contact Workflow Wave verification — run after: npx supabase db reset --local
-- Usage: psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/customer_contact_workflow_verification.sql
-- (or: docker exec supabase_db_atomic-crm-demo psql -U postgres -d postgres -f -  < this file)

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1. Schema shape
-- ---------------------------------------------------------------------------
do $$
begin
    if not exists (
        select 1 from information_schema.columns
        where table_name = 'companies' and column_name = 'customer_kind'
    ) then
        raise exception 'companies.customer_kind missing';
    end if;

    if not exists (
        select 1 from pg_constraint where conname = 'companies_customer_kind_check'
    ) then
        raise exception 'companies_customer_kind_check missing';
    end if;

    if not exists (
        select 1 from pg_indexes where indexname = 'uq_contacts_one_primary_per_company'
    ) then
        raise exception 'uq_contacts_one_primary_per_company missing';
    end if;

    if not exists (
        select 1 from information_schema.columns
        where table_name = 'contacts_summary' and column_name = 'is_primary'
    ) then
        raise exception 'contacts_summary.is_primary missing — view not in sync with base table';
    end if;

    if not exists (
        select 1 from information_schema.columns
        where table_name = 'companies_summary' and column_name = 'customer_kind'
    ) then
        raise exception 'companies_summary.customer_kind missing — view not in sync with base table';
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. RPC grants: anon must not execute either RPC
-- ---------------------------------------------------------------------------
do $$
begin
    if has_function_privilege(
        'anon', 'public.create_customer_with_contact(jsonb, jsonb, bigint)', 'EXECUTE'
    ) then
        raise exception 'anon must not EXECUTE create_customer_with_contact';
    end if;

    if has_function_privilege(
        'anon', 'public.set_primary_contact(bigint)', 'EXECUTE'
    ) then
        raise exception 'anon must not EXECUTE set_primary_contact';
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Behavioral tests as an authenticated office user
-- ---------------------------------------------------------------------------
do $$
declare
    v_office_user uuid := 'a0000000-0000-4000-8000-000000000098';
    v_viewer_user uuid := 'a0000000-0000-4000-8000-000000000097';
    v_office_sale_id bigint;
    v_viewer_sale_id bigint;
    v_result jsonb;
    v_company_id bigint;
    v_contact_id bigint;
    v_second_contact_id bigint;
    v_customer_kind text;
    v_is_primary boolean;
    v_primary_count int;
    v_existing_contact_id bigint;
    v_failed boolean;
begin
    -- Fixture: office + viewer auth users / sales rows (pattern from checklists_audit_verification.sql)
    insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        recovery_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
    )
    values
        ('00000000-0000-0000-0000-000000000000', v_office_user, 'authenticated', 'authenticated',
         'customer-contact-office@nora.test', crypt('password', gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
        ('00000000-0000-0000-0000-000000000000', v_viewer_user, 'authenticated', 'authenticated',
         'customer-contact-viewer@nora.test', crypt('password', gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '')
    on conflict (id) do nothing;

    begin
        insert into public.sales (first_name, last_name, email, user_id, role, administrator, disabled)
        values ('Office', 'Tester', 'customer-contact-office@nora.test', v_office_user, 'office', false, false);
    exception
        when unique_violation then
            select id into v_office_sale_id from public.sales where user_id = v_office_user;
            perform nora_private.apply_sales_role_change(v_office_sale_id, 'office', false);
    end;

    begin
        insert into public.sales (first_name, last_name, email, user_id, role, administrator, disabled)
        values ('Viewer', 'Tester', 'customer-contact-viewer@nora.test', v_viewer_user, 'viewer', false, false);
    exception
        when unique_violation then
            select id into v_viewer_sale_id from public.sales where user_id = v_viewer_user;
            perform nora_private.apply_sales_role_change(v_viewer_sale_id, 'viewer', false);
    end;

    -- 3a. office: business customer + new primary contact, atomic RPC
    perform set_config('request.jwt.claim.sub', v_office_user::text, true);
    execute 'set local role authenticated';

    v_result := public.create_customer_with_contact(
        jsonb_build_object('name', 'Verification GmbH', 'customer_kind', 'business'),
        jsonb_build_object('first_name', 'Max', 'last_name', 'Mustermann'),
        null
    );

    v_company_id := (v_result->>'company_id')::bigint;
    v_contact_id := (v_result->>'contact_id')::bigint;

    if v_company_id is null or v_contact_id is null then
        raise exception 'create_customer_with_contact did not return company_id/contact_id: %', v_result;
    end if;

    select customer_kind into v_customer_kind from public.companies where id = v_company_id;
    if v_customer_kind <> 'business' then
        raise exception 'Expected customer_kind=business, got %', v_customer_kind;
    end if;

    select is_primary into v_is_primary from public.contacts where id = v_contact_id;
    if v_is_primary is not true then
        raise exception 'New contact from create_customer_with_contact must be is_primary=true';
    end if;

    if (select customer_number from public.companies where id = v_company_id) is null then
        raise exception 'customer_number was not server-assigned by the existing trigger';
    end if;

    -- 3b. Adding a second contact directly (not via RPC) must not be primary by default
    insert into public.contacts (first_name, last_name, company_id)
    values ('Erika', 'Musterfrau', v_company_id)
    returning id into v_second_contact_id;

    select count(*) into v_primary_count
    from public.contacts where company_id = v_company_id and is_primary;
    if v_primary_count <> 1 then
        raise exception 'Expected exactly 1 primary contact after adding a second contact, got %', v_primary_count;
    end if;

    -- 3c. set_primary_contact atomically switches the primary contact
    perform public.set_primary_contact(v_second_contact_id);

    select is_primary into v_is_primary from public.contacts where id = v_second_contact_id;
    if v_is_primary is not true then
        raise exception 'set_primary_contact did not mark the target contact primary';
    end if;

    select is_primary into v_is_primary from public.contacts where id = v_contact_id;
    if v_is_primary is not false then
        raise exception 'set_primary_contact did not unset the previous primary contact';
    end if;

    select count(*) into v_primary_count
    from public.contacts where company_id = v_company_id and is_primary;
    if v_primary_count <> 1 then
        raise exception 'Expected exactly 1 primary contact after switch, got %', v_primary_count;
    end if;

    -- 3d. DB-level guarantee: two primaries for the same company must be rejected
    v_failed := false;
    begin
        update public.contacts set is_primary = true where id = v_contact_id;
    exception
        when unique_violation then
            v_failed := true;
    end;
    if not v_failed then
        raise exception 'uq_contacts_one_primary_per_company did not reject a second primary contact';
    end if;

    -- 3e. create_customer_with_contact with an existing contact id relinks + marks primary
    insert into public.contacts (first_name, last_name)
    values ('Frank', 'Keller')
    returning id into v_existing_contact_id;

    v_result := public.create_customer_with_contact(
        jsonb_build_object('name', 'Bestehender Kontakt GmbH', 'customer_kind', 'business'),
        null,
        v_existing_contact_id
    );

    if (v_result->>'contact_id')::bigint <> v_existing_contact_id then
        raise exception 'create_customer_with_contact did not return the relinked existing contact id';
    end if;

    select company_id, is_primary into v_company_id, v_is_primary
    from public.contacts where id = v_existing_contact_id;

    if v_company_id <> (v_result->>'company_id')::bigint then
        raise exception 'Existing contact was not relinked to the new company';
    end if;
    if v_is_primary is not true then
        raise exception 'Relinked existing contact must become is_primary=true';
    end if;

    -- 3f. Privatperson: company + contact both individual/primary
    v_result := public.create_customer_with_contact(
        jsonb_build_object('name', 'Sabine Becker', 'customer_kind', 'individual'),
        jsonb_build_object('first_name', 'Sabine', 'last_name', 'Becker'),
        null
    );
    select customer_kind into v_customer_kind from public.companies where id = (v_result->>'company_id')::bigint;
    if v_customer_kind <> 'individual' then
        raise exception 'Expected customer_kind=individual for Privatperson, got %', v_customer_kind;
    end if;

    -- 3g. CHECK constraint rejects an invalid customer_kind
    v_failed := false;
    begin
        update public.companies set customer_kind = 'nonsense' where id = v_company_id;
    exception
        when check_violation then
            v_failed := true;
    end;
    if not v_failed then
        raise exception 'companies_customer_kind_check did not reject an invalid customer_kind';
    end if;

    -- 3h. viewer role must be rejected by can_write() inside the RPC (not just RLS)
    perform set_config('request.jwt.claim.sub', v_viewer_user::text, true);
    execute 'set local role authenticated';

    v_failed := false;
    begin
        perform public.create_customer_with_contact(
            jsonb_build_object('name', 'Viewer Should Not Create'), null, null
        );
    exception
        when others then
            v_failed := true;
    end;
    if not v_failed then
        raise exception 'viewer role was able to call create_customer_with_contact — can_write() gate is broken';
    end if;

    raise notice 'customer_contact_workflow_verification: all checks passed';
end;
$$;
