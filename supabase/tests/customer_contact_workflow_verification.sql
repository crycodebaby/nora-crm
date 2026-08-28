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
        'anon', 'public.create_customer_with_contact(jsonb, jsonb, bigint, bigint, boolean)', 'EXECUTE'
    ) then
        raise exception 'anon must not EXECUTE create_customer_with_contact';
    end if;

    if has_function_privilege(
        'anon', 'public.set_primary_contact(bigint)', 'EXECUTE'
    ) then
        raise exception 'anon must not EXECUTE set_primary_contact';
    end if;

    if has_function_privilege(
        'anon', 'public.create_quick_capture_case(jsonb, bigint, jsonb, bigint, bigint, jsonb, boolean)', 'EXECUTE'
    ) then
        raise exception 'anon must not EXECUTE create_quick_capture_case';
    end if;

    if exists (
        select 1 from pg_proc
        where proname = 'create_customer_with_contact'
          and pronamespace = 'public'::regnamespace
          and pronargs = 3
    ) then
        raise exception 'legacy 3-arg create_customer_with_contact overload must not exist (PostgREST ambiguity risk)';
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

    -- back to office for the Self Contact Wave checks below
    perform set_config('request.jwt.claim.sub', v_office_user::text, true);
    execute 'set local role authenticated';

    raise notice 'customer_contact_workflow_verification: all checks passed';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Self Contact Wave (2026-08-26)
-- ---------------------------------------------------------------------------
do $$
declare
    v_office_user uuid := 'a0000000-0000-4000-8000-000000000098';
    v_viewer_user uuid := 'a0000000-0000-4000-8000-000000000097';
    v_admin_user uuid := 'a0000000-0000-4000-8000-000000000096';
    v_admin_sale_id bigint;
    v_firma_a_id bigint;
    v_freddie_id bigint;
    v_freddie_company_id bigint;
    v_freddie_is_primary boolean;
    v_result jsonb;
    v_privat_id bigint;
    v_biz1_id bigint;
    v_biz2_id bigint;
    v_owner_id bigint;
    v_self_contact_id bigint;
    v_name text;
    v_failed boolean;
    v_other_company_id bigint;
    v_other_contact_id bigint;
    v_deal_id bigint;
    v_contact_ids bigint[];
begin
    -- Contact DELETE requires the admin role (RLS "Contacts delete admin"),
    -- office cannot delete contacts at all — fixture needed for section 4d.
    -- Must run before switching to the "authenticated" role below (auth.users
    -- writes need the postgres/service role).
    insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        recovery_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
    )
    values
        ('00000000-0000-0000-0000-000000000000', v_admin_user, 'authenticated', 'authenticated',
         'self-contact-admin@nora.test', crypt('password', gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '')
    on conflict (id) do nothing;

    begin
        insert into public.sales (first_name, last_name, email, user_id, role, administrator, disabled)
        values ('Admin', 'SelfContactTester', 'self-contact-admin@nora.test', v_admin_user, 'admin', true, false);
    exception
        when unique_violation then
            select id into v_admin_sale_id from public.sales where user_id = v_admin_user;
            perform nora_private.apply_sales_role_change(v_admin_sale_id, 'admin', false);
    end;

    perform set_config('request.jwt.claim.sub', v_office_user::text, true);
    execute 'set local role authenticated';

    -- 4a. Freddie scenario: contact stays Ansprechpartner of Firma A,
    -- becomes self_contact of a NEW customer record — company_id/is_primary
    -- at Firma A must not change.
    insert into public.companies (name, customer_kind) values ('Traum und Horror UG', 'business')
    returning id into v_firma_a_id;
    insert into public.contacts (first_name, last_name, company_id, is_primary)
    values ('Freddie', 'Krueger', v_firma_a_id, true)
    returning id into v_freddie_id;

    v_result := public.create_customer_with_contact(
        jsonb_build_object('name', 'Freddie Krueger (Privat)', 'customer_kind', 'individual'),
        null, null, v_freddie_id, false
    );
    v_privat_id := (v_result->>'company_id')::bigint;
    if (v_result->>'contact_id')::bigint <> v_freddie_id then
        raise exception 'self_contact path did not return the self contact id';
    end if;

    select company_id, is_primary into v_freddie_company_id, v_freddie_is_primary
    from public.contacts where id = v_freddie_id;
    if v_freddie_company_id <> v_firma_a_id or v_freddie_is_primary is not true then
        raise exception 'Freddie scenario regression: self_contact_id must not reassign contacts.company_id/is_primary';
    end if;

    select self_contact_id into v_self_contact_id from public.companies where id = v_privat_id;
    if v_self_contact_id <> v_freddie_id then
        raise exception 'companies.self_contact_id was not set on the new Privatkundenakte';
    end if;

    -- 4b. Partial unique index: only individual is restricted to one
    -- self-representation per person — the same contact CAN be
    -- self_contact_id of two different business customer records.
    insert into public.companies (name, customer_kind) values ('Freddie Solo A', 'business') returning id into v_biz1_id;
    insert into public.companies (name, customer_kind) values ('Freddie Solo B', 'business') returning id into v_biz2_id;
    update public.companies set self_contact_id = v_freddie_id where id in (v_biz1_id, v_biz2_id);
    if (select count(*) from public.companies where self_contact_id = v_freddie_id and customer_kind = 'business') <> 2 then
        raise exception 'business self_contact_id must allow the same person on multiple customer records';
    end if;

    v_failed := false;
    begin
        insert into public.companies (name, customer_kind, self_contact_id)
        values ('Zweite Privatakte fuer Freddie', 'individual', v_freddie_id);
    exception
        when unique_violation then
            v_failed := true;
    end;
    if not v_failed then
        raise exception 'uq_companies_self_contact_individual did not reject a second Privatkundenakte for the same person';
    end if;

    -- 4c. Individual name sync: renaming the contact must update the
    -- Privatkundenakte name (contacts stays canonical, companies.name is a
    -- controlled derivation).
    update public.contacts set first_name = 'Freddie', last_name = 'Mueller' where id = v_freddie_id;
    select name into v_name from public.companies where id = v_privat_id;
    if v_name <> 'Freddie Mueller' then
        raise exception 'Individual company name did not sync from the self contact rename, got %', v_name;
    end if;
    -- Business customer records must NOT be renamed by the same contact edit
    if exists (select 1 from public.companies where id in (v_biz1_id, v_biz2_id) and name like 'Freddie Mueller%') then
        raise exception 'Business self_contact_id must not drive companies.name (individual-only sync)';
    end if;

    -- 4c-ii. Individual Name Invariant (Pre-Production Hardening Patch):
    -- blanking both first_name/last_name (even whitespace-only, which
    -- passes client-side required() validation) must be rejected server-side
    -- rather than silently producing companies.name = ''.
    v_failed := false;
    begin
        update public.contacts set first_name = ' ', last_name = ' ' where id = v_freddie_id;
    exception
        when others then
            v_failed := true;
    end;
    if not v_failed then
        raise exception 'sync_individual_company_name did not reject a rename that would blank companies.name';
    end if;
    select name into v_name from public.companies where id = v_privat_id;
    if v_name = '' or v_name is null then
        raise exception 'companies.name went blank for a Privatkundenakte despite the guard';
    end if;
    -- Contact row itself must not have been half-updated by the rejected transaction.
    if exists (select 1 from public.contacts where id = v_freddie_id and first_name = ' ') then
        raise exception 'rejected rename must not have partially applied to contacts';
    end if;

    -- 4d. Self Contact delete guard: individual blocked, business allowed
    -- (contact DELETE requires admin — see fixture above)
    perform set_config('request.jwt.claim.sub', v_admin_user::text, true);
    execute 'set local role authenticated';

    v_failed := false;
    begin
        delete from public.contacts where id = v_freddie_id;
    exception
        when others then
            v_failed := true;
    end;
    if not v_failed then
        raise exception 'guard_self_contact_delete did not block deleting the self contact of a Privatkundenakte';
    end if;

    -- Deliberate akte fix before delete: an individual company cannot be
    -- left with self_contact_id = null (deferred invariant, checked at
    -- commit) — retire the throwaway Privatkundenakte itself, then the
    -- contact delete must succeed.
    delete from public.companies where id = v_privat_id;
    delete from public.contacts where id = v_freddie_id;
    if exists (select 1 from public.companies where id in (v_biz1_id, v_biz2_id) and self_contact_id is not null) then
        raise exception 'business self_contact_id should have been ON DELETE SET NULL after deleting the contact';
    end if;

    raise notice 'self_contact_wave: Freddie/partial-unique/name-sync/delete-guard checks passed';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Self Contact Wave: merge_contacts preserves self_contact_id
-- ---------------------------------------------------------------------------
do $$
declare
    v_admin_user uuid := 'a0000000-0000-4000-8000-000000000096';
    v_loser_id bigint;
    v_winner_id bigint;
    v_company_id bigint;
    v_self_contact_id bigint;
begin
    -- merge_contacts() is invoker-rights and internally DELETEs the loser
    -- contact, which requires the admin role under RLS ("Contacts delete
    -- admin") — same fixture as section 4d, already committed by then.
    perform set_config('request.jwt.claim.sub', v_admin_user::text, true);
    execute 'set local role authenticated';

    insert into public.contacts (first_name, last_name) values ('Anna', 'Loeser') returning id into v_loser_id;
    insert into public.contacts (first_name, last_name) values ('Anna', 'Gewinner') returning id into v_winner_id;
    insert into public.companies (name, customer_kind, self_contact_id)
    values ('Anna Solo', 'business', v_loser_id) returning id into v_company_id;

    perform public.merge_contacts(v_loser_id, v_winner_id);

    select self_contact_id into v_self_contact_id from public.companies where id = v_company_id;
    if v_self_contact_id <> v_winner_id then
        raise exception 'merge_contacts did not repoint self_contact_id to the winner';
    end if;
    if exists (select 1 from public.contacts where id = v_loser_id) then
        raise exception 'merge_contacts did not delete the loser contact';
    end if;

    raise notice 'self_contact_wave: merge_contacts self_contact_id preservation passed';
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Self Contact Wave: create_quick_capture_case
-- ---------------------------------------------------------------------------
do $$
declare
    v_office_user uuid := 'a0000000-0000-4000-8000-000000000098';
    v_viewer_user uuid := 'a0000000-0000-4000-8000-000000000097';
    v_result jsonb;
    v_company_id bigint;
    v_contact_id bigint;
    v_deal_id bigint;
    v_other_company_id bigint;
    v_other_contact_id bigint;
    v_foreign_contact_id bigint;
    v_contact_ids bigint[];
    v_failed boolean;
begin
    perform set_config('request.jwt.claim.sub', v_office_user::text, true);
    execute 'set local role authenticated';

    -- 6a. New customer + new contact + deal — single atomic call
    v_result := public.create_quick_capture_case(
        jsonb_build_object('name', 'Schnellerfassung GmbH', 'customer_kind', 'business'),
        null,
        jsonb_build_object('first_name', 'Nina', 'last_name', 'Neu'),
        null, null,
        jsonb_build_object('name', 'Fenster klemmt', 'category', 'fensterservice')
    );
    v_company_id := (v_result->>'company_id')::bigint;
    v_contact_id := (v_result->>'contact_id')::bigint;
    v_deal_id := (v_result->>'deal_id')::bigint;
    if v_company_id is null or v_contact_id is null or v_deal_id is null then
        raise exception 'create_quick_capture_case (new customer) did not return all three ids: %', v_result;
    end if;
    select contact_ids into v_contact_ids from public.deals where id = v_deal_id;
    if v_contact_ids <> array[v_contact_id] then
        raise exception 'quick capture deal.contact_ids does not reference the created contact';
    end if;

    -- 6b. Existing customer (no new company insert) + existing contact that
    -- already belongs to it — must succeed, no duplicate company created
    v_result := public.create_quick_capture_case(
        null, v_company_id,
        null, v_contact_id, null,
        jsonb_build_object('name', 'Zweiter Vorgang', 'category', 'fensterservice')
    );
    if (v_result->>'company_id')::bigint <> v_company_id then
        raise exception 'create_quick_capture_case (existing customer) created a duplicate company';
    end if;

    -- 6c. Existing customer + no contact
    v_result := public.create_quick_capture_case(
        null, v_company_id,
        null, null, null,
        jsonb_build_object('name', 'Vorgang ohne Kontakt', 'category', 'fensterservice')
    );
    select contact_ids into v_contact_ids from public.deals where id = (v_result->>'deal_id')::bigint;
    if v_contact_ids is not null and array_length(v_contact_ids, 1) > 0 then
        raise exception 'quick capture deal without a contact must have an empty contact_ids array';
    end if;

    -- 6d. Existing customer + a FOREIGN existing contact (belongs to a
    -- different company, not self_contact of this one either) — must be
    -- rejected, never silently reparented
    insert into public.companies (name, customer_kind) values ('Andere Firma', 'business') returning id into v_other_company_id;
    insert into public.contacts (first_name, last_name, company_id) values ('Fremd', 'Kontakt', v_other_company_id)
    returning id into v_foreign_contact_id;

    v_failed := false;
    begin
        perform public.create_quick_capture_case(
            null, v_company_id,
            null, v_foreign_contact_id, null,
            jsonb_build_object('name', 'Sollte scheitern', 'category', 'fensterservice')
        );
    exception
        when others then
            v_failed := true;
    end;
    if not v_failed then
        raise exception 'create_quick_capture_case silently reparented a foreign contact onto an unrelated existing company';
    end if;

    -- 6f. Regression: adding a NEW contact to a customer that already has a
    -- primary contact must not hit uq_contacts_one_primary_per_company.
    -- p_contact_is_primary=true (default) demotes the old primary.
    v_result := public.create_quick_capture_case(
        null, v_company_id,
        jsonb_build_object('first_name', 'Zweite', 'last_name', 'Ansprechperson'),
        null, null,
        jsonb_build_object('name', 'Dritter Vorgang', 'category', 'fensterservice')
    );
    if not exists (
        select 1 from public.contacts
        where id = (v_result->>'contact_id')::bigint and is_primary
    ) then
        raise exception 'new contact was not promoted to primary despite p_contact_is_primary default true';
    end if;
    if exists (select 1 from public.contacts where id = v_contact_id and is_primary) then
        raise exception 'previous primary contact was not demoted when a new primary contact was inserted';
    end if;
    if (select count(*) from public.contacts where company_id = v_company_id and is_primary) <> 1 then
        raise exception 'expected exactly one primary contact after adding a second, promoted contact';
    end if;

    -- 6g. p_contact_is_primary=false adds a non-primary contact alongside
    -- the existing primary without touching it.
    v_result := public.create_quick_capture_case(
        null, v_company_id,
        jsonb_build_object('first_name', 'Dritte', 'last_name', 'Ansprechperson'),
        null, null,
        jsonb_build_object('name', 'Vierter Vorgang', 'category', 'fensterservice'),
        false
    );
    if exists (
        select 1 from public.contacts
        where id = (v_result->>'contact_id')::bigint and is_primary
    ) then
        raise exception 'p_contact_is_primary=false must not mark the new contact primary';
    end if;
    if (select count(*) from public.contacts where company_id = v_company_id and is_primary) <> 1 then
        raise exception 'p_contact_is_primary=false must not disturb the existing primary contact';
    end if;

    -- 6e. viewer must be rejected
    perform set_config('request.jwt.claim.sub', v_viewer_user::text, true);
    execute 'set local role authenticated';
    v_failed := false;
    begin
        perform public.create_quick_capture_case(
            jsonb_build_object('name', 'Viewer Should Not Create'), null, null, null, null,
            jsonb_build_object('name', 'x')
        );
    exception
        when others then
            v_failed := true;
    end;
    if not v_failed then
        raise exception 'viewer role was able to call create_quick_capture_case — can_write() gate is broken';
    end if;

    -- 6f. Atomic rollback proof (Pre-Production Hardening Patch, 2026-08-27):
    -- a valid company+contact combined with a deliberately invalid deal
    -- (empty name) must leave behind NO half-created company/contact/deal —
    -- not just trusted PL/pgSQL transaction semantics, but empirically shown.
    perform set_config('request.jwt.claim.sub', v_office_user::text, true);
    execute 'set local role authenticated';
    declare
        v_before_companies bigint;
        v_before_contacts bigint;
        v_before_deals bigint;
    begin
        select count(*) into v_before_companies from public.companies;
        select count(*) into v_before_contacts from public.contacts;
        select count(*) into v_before_deals from public.deals;

        v_failed := false;
        begin
            perform public.create_quick_capture_case(
                jsonb_build_object('name', 'Atomic Rollback Probe GmbH'),
                null,
                jsonb_build_object('first_name', 'Rollback', 'last_name', 'Probe'),
                null, null,
                jsonb_build_object('name', '')  -- deliberately invalid: empty deal name
            );
        exception
            when others then
                v_failed := true;
        end;
        if not v_failed then
            raise exception 'expected create_quick_capture_case to fail on an empty deal name';
        end if;

        if (select count(*) from public.companies) <> v_before_companies
           or (select count(*) from public.contacts) <> v_before_contacts
           or (select count(*) from public.deals) <> v_before_deals
           or exists (select 1 from public.companies where name = 'Atomic Rollback Probe GmbH')
        then
            raise exception 'atomic rollback proof failed: a half-created company/contact/deal survived the deliberately-invalid quick capture';
        end if;
    end;

    raise notice 'self_contact_wave: create_quick_capture_case checks passed';
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Domain Contract: is_effective_contact_of_company scenario matrix
--
-- Same named cases as src/components/atomic-crm/domain/effectiveContactContext.contractCases.ts
-- and the FakeRest mirror in providers/fakerest/internal/taskContextCheck.ts.
-- Keep names and expected results in sync across all three implementations
-- (Falle 31, 03-data-model-guardrails.md).
-- ---------------------------------------------------------------------------
do $$
declare
    v_company_a bigint; -- plain company, no self_contact_id
    v_company_b bigint; -- company whose self_contact_id is set below
    v_contact_regular bigint; -- company_id = company_a
    v_contact_self bigint; -- self_contact_id of company_b, company_id = company_a
    v_contact_foreign bigint; -- belongs to neither company_a nor company_b
    v_contact_both bigint; -- company_id = company_a AND self_contact_id of company_a
begin
    insert into public.companies (name, customer_kind) values ('Contract A', 'business') returning id into v_company_a;
    insert into public.companies (name, customer_kind) values ('Contract B', 'business') returning id into v_company_b;

    insert into public.contacts (first_name, last_name, company_id) values ('Regular', 'Contract', v_company_a) returning id into v_contact_regular;
    insert into public.contacts (first_name, last_name, company_id) values ('Self', 'Contract', v_company_a) returning id into v_contact_self;
    insert into public.contacts (first_name, last_name, company_id) values ('Foreign', 'Contract', v_company_a) returning id into v_contact_foreign;
    insert into public.contacts (first_name, last_name, company_id) values ('Both', 'Contract', v_company_a) returning id into v_contact_both;

    update public.companies set self_contact_id = v_contact_self where id = v_company_b;
    update public.companies set self_contact_id = v_contact_both where id = v_company_a;

    -- regular_contact: contact.company_id = company.id
    if not nora_private.is_effective_contact_of_company(v_contact_regular, v_company_a) then
        raise exception 'contract case regular_contact failed';
    end if;

    -- self_contact: contact is company_b.self_contact_id, company_id points elsewhere (company_a)
    if not nora_private.is_effective_contact_of_company(v_contact_self, v_company_b) then
        raise exception 'contract case self_contact failed';
    end if;

    -- foreign_contact / foreign_primary_contact: belongs to neither
    if nora_private.is_effective_contact_of_company(v_contact_foreign, v_company_b) then
        raise exception 'contract case foreign_contact failed';
    end if;

    -- regular_and_self: company_id member AND self_contact_id of the SAME company — must count once, no error
    if not nora_private.is_effective_contact_of_company(v_contact_both, v_company_a) then
        raise exception 'contract case regular_and_self failed';
    end if;

    -- missing_contact / missing_company: non-existent ids must be rejected, not error
    if nora_private.is_effective_contact_of_company(999999999, v_company_a) then
        raise exception 'contract case missing_contact failed';
    end if;
    if nora_private.is_effective_contact_of_company(v_contact_regular, 999999999) then
        raise exception 'contract case missing_company failed';
    end if;

    raise notice 'domain_contract: is_effective_contact_of_company scenario matrix passed';
end;
$$;
