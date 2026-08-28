-- Nora CRM Error Contract Wave verification — run after: npx supabase db reset --local
-- Usage: docker exec -i supabase_db_atomic-crm-demo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < this file
--
-- Proves, against a real Postgres instance (not a JS mock):
-- - every migrated RAISE EXCEPTION carries the expected DETAIL = NORA_* code
-- - Human Message Independence: two different origins/MESSAGE texts for the
--   "same" business rejection produce the SAME DETAIL code
-- - the uq_companies_self_contact_individual race is translated to
--   NORA_PRIVATE_CUSTOMER_ALREADY_EXISTS, while an unrelated unique
--   violation is never mistranslated into it

\set ON_ERROR_STOP on

do $$
declare
    v_office_user uuid := 'b0000000-0000-4000-8000-000000000001';
    v_viewer_user uuid := 'b0000000-0000-4000-8000-000000000002';
    v_admin_user uuid := 'b0000000-0000-4000-8000-000000000003';
    v_office_sale_id bigint;
    v_viewer_sale_id bigint;
    v_admin_sale_id bigint;
    v_result jsonb;
    v_company_a_id bigint;
    v_company_b_id bigint;
    v_contact_x_id bigint;
    v_company_id bigint;
    v_contact_id bigint;
    v_sqlstate text;
    v_detail text;
    v_message text;
    v_caught boolean;
begin
    -- Fixture: office + viewer auth users / sales rows (pattern from
    -- customer_contact_workflow_verification.sql).
    insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        recovery_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
    )
    values
        ('00000000-0000-0000-0000-000000000000', v_office_user, 'authenticated', 'authenticated',
         'error-contract-office@nora.test', crypt('password', gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
        ('00000000-0000-0000-0000-000000000000', v_viewer_user, 'authenticated', 'authenticated',
         'error-contract-viewer@nora.test', crypt('password', gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
        ('00000000-0000-0000-0000-000000000000', v_admin_user, 'authenticated', 'authenticated',
         'error-contract-admin@nora.test', crypt('password', gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '')
    on conflict (id) do nothing;

    begin
        insert into public.sales (first_name, last_name, email, user_id, role, administrator, disabled)
        values ('EC', 'Office', 'error-contract-office@nora.test', v_office_user, 'office', false, false)
        returning id into v_office_sale_id;
    exception
        when unique_violation then
            select id into v_office_sale_id from public.sales where user_id = v_office_user;
            perform nora_private.apply_sales_role_change(v_office_sale_id, 'office', false);
    end;

    begin
        insert into public.sales (first_name, last_name, email, user_id, role, administrator, disabled)
        values ('EC', 'Viewer', 'error-contract-viewer@nora.test', v_viewer_user, 'viewer', false, false)
        returning id into v_viewer_sale_id;
    exception
        when unique_violation then
            select id into v_viewer_sale_id from public.sales where user_id = v_viewer_user;
            perform nora_private.apply_sales_role_change(v_viewer_sale_id, 'viewer', false);
    end;

    begin
        insert into public.sales (first_name, last_name, email, user_id, role, administrator, disabled)
        values ('EC', 'Admin', 'error-contract-admin@nora.test', v_admin_user, 'admin', true, false)
        returning id into v_admin_sale_id;
    exception
        when unique_violation then
            select id into v_admin_sale_id from public.sales where user_id = v_admin_user;
            perform nora_private.apply_sales_role_change(v_admin_sale_id, 'admin', false);
    end;

    perform set_config('request.jwt.claim.sub', v_office_user::text, true);
    execute 'set local role authenticated';

    -- -----------------------------------------------------------------
    -- 1. Human Message Independence: two different origins, two
    --    different SQLSTATEs, two different MESSAGE texts — same DETAIL.
    -- -----------------------------------------------------------------

    -- Company A owns contact X. Company B is unrelated to X (no
    -- company_id match, no self_contact_id match) — the effective contact
    -- context check must reject X for B via two different origins below.
    v_result := public.create_customer_with_contact(
        jsonb_build_object('name', 'Error Contract Company A', 'customer_kind', 'business'),
        jsonb_build_object('first_name', 'Foreign', 'last_name', 'Contact')
    );
    v_company_a_id := (v_result->>'company_id')::bigint;
    v_contact_x_id := (v_result->>'contact_id')::bigint;

    v_result := public.create_customer_with_contact(
        jsonb_build_object('name', 'Error Contract Company B', 'customer_kind', 'business')
    );
    v_company_b_id := (v_result->>'company_id')::bigint;

    -- 1a. via create_quick_capture_case (42501, English message)
    v_caught := false;
    begin
        perform public.create_quick_capture_case(
            null, v_company_b_id,
            null, v_contact_x_id,
            null,
            jsonb_build_object('name', 'Should not be created', 'category', 'fensterservice')
        );
    exception when others then
        v_caught := true;
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_detail = pg_exception_detail, v_message = message_text;
    end;
    if not v_caught then
        raise exception '1a: expected create_quick_capture_case to reject a contact outside the effective contact context';
    end if;
    if v_detail is distinct from 'NORA_CONTACT_NOT_IN_CUSTOMER_CONTEXT' then
        raise exception '1a: expected DETAIL=NORA_CONTACT_NOT_IN_CUSTOMER_CONTEXT, got % (message: %)', v_detail, v_message;
    end if;
    if v_sqlstate is distinct from '42501' then
        raise exception '1a: expected SQLSTATE 42501, got %', v_sqlstate;
    end if;

    -- 1b. via enforce_task_company_context() trigger (23514, different message)
    v_caught := false;
    begin
        insert into public.tasks (text, type, contact_id, company_id, sales_id, due_date)
        values (
            'should be rejected',
            'rueckruf',
            v_contact_x_id,
            v_company_b_id,
            v_office_sale_id,
            current_date
        );
    exception when others then
        v_caught := true;
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_detail = pg_exception_detail, v_message = message_text;
    end;
    if not v_caught then
        raise exception '1b: expected enforce_task_company_context() to reject a mismatched company_id/contact_id pair';
    end if;
    if v_detail is distinct from 'NORA_CONTACT_NOT_IN_CUSTOMER_CONTEXT' then
        raise exception '1b: expected DETAIL=NORA_CONTACT_NOT_IN_CUSTOMER_CONTEXT, got % (message: %)', v_detail, v_message;
    end if;
    if v_sqlstate is distinct from '23514' then
        raise exception '1b: expected SQLSTATE 23514, got %', v_sqlstate;
    end if;
    -- Different SQLSTATE (42501 vs 23514) and different MESSAGE text than
    -- 1a, but identical DETAIL — the point of this whole wave.

    -- -----------------------------------------------------------------
    -- 2. Individual Name Invariant — CREATE path
    -- -----------------------------------------------------------------
    v_caught := false;
    begin
        perform public.create_customer_with_contact(
            jsonb_build_object('name', 'placeholder', 'customer_kind', 'individual'),
            jsonb_build_object('first_name', '', 'last_name', '')
        );
    exception when others then
        v_caught := true;
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_detail = pg_exception_detail;
    end;
    if not v_caught then
        raise exception '2: expected CREATE-path Individual Name Invariant rejection';
    end if;
    if v_detail is distinct from 'NORA_INDIVIDUAL_NAME_REQUIRED' then
        raise exception '2: expected DETAIL=NORA_INDIVIDUAL_NAME_REQUIRED, got %', v_detail;
    end if;
    if v_sqlstate is distinct from '23514' then
        raise exception '2: expected SQLSTATE 23514, got %', v_sqlstate;
    end if;

    -- -----------------------------------------------------------------
    -- 3. Individual Name Invariant — rename path (different origin/trigger)
    -- -----------------------------------------------------------------
    v_result := public.create_customer_with_contact(
        jsonb_build_object('name', 'placeholder', 'customer_kind', 'individual'),
        jsonb_build_object('first_name', 'Rename', 'last_name', 'Target')
    );
    v_contact_id := (v_result->>'contact_id')::bigint;

    v_caught := false;
    begin
        update public.contacts set first_name = '', last_name = '' where id = v_contact_id;
    exception when others then
        v_caught := true;
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_detail = pg_exception_detail;
    end;
    if not v_caught then
        raise exception '3: expected rename-path Individual Name Invariant rejection';
    end if;
    if v_detail is distinct from 'NORA_INDIVIDUAL_NAME_REQUIRED' then
        raise exception '3: expected DETAIL=NORA_INDIVIDUAL_NAME_REQUIRED, got %', v_detail;
    end if;

    -- -----------------------------------------------------------------
    -- 4. Self Contact Delete Guard — DELETE requires is_admin() per RLS
    --    ("Contacts delete admin"), independent of the domain guard being
    --    tested here, so switch to the admin session for this step.
    -- -----------------------------------------------------------------
    perform set_config('request.jwt.claim.sub', v_admin_user::text, true);

    v_caught := false;
    begin
        delete from public.contacts where id = v_contact_id;
    exception when others then
        v_caught := true;
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_detail = pg_exception_detail;
    end;
    if not v_caught then
        raise exception '4: expected guard_self_contact_delete() rejection';
    end if;
    if v_detail is distinct from 'NORA_SELF_CONTACT_DELETE_BLOCKED' then
        raise exception '4: expected DETAIL=NORA_SELF_CONTACT_DELETE_BLOCKED, got %', v_detail;
    end if;
    if v_sqlstate is distinct from '23503' then
        raise exception '4: expected SQLSTATE 23503, got %', v_sqlstate;
    end if;

    -- -----------------------------------------------------------------
    -- 5. Private Customer Already Exists — DB-race backstop via
    --    uq_companies_self_contact_individual, exercised directly (not a
    --    client pre-check bypass, the real unique-violation path inside
    --    create_customer_with_contact_core's exception handler).
    -- -----------------------------------------------------------------
    v_caught := false;
    begin
        perform public.create_customer_with_contact(
            jsonb_build_object('name', 'placeholder', 'customer_kind', 'individual'),
            null,
            null,
            v_contact_id -- already self_contact_id of the company created in step 3
        );
    exception when others then
        v_caught := true;
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_detail = pg_exception_detail;
    end;
    if not v_caught then
        raise exception '5: expected uq_companies_self_contact_individual rejection';
    end if;
    if v_detail is distinct from 'NORA_PRIVATE_CUSTOMER_ALREADY_EXISTS' then
        raise exception '5: expected DETAIL=NORA_PRIVATE_CUSTOMER_ALREADY_EXISTS, got %', v_detail;
    end if;
    if v_sqlstate is distinct from '23505' then
        raise exception '5: expected SQLSTATE 23505, got %', v_sqlstate;
    end if;

    -- -----------------------------------------------------------------
    -- 5b. A unique violation on a DIFFERENT constraint (companies_pkey)
    --     must never carry NORA_PRIVATE_CUSTOMER_ALREADY_EXISTS. Every
    --     RPC parameter combination that reaches
    --     create_customer_with_contact_core's own INSERT/UPDATE statements
    --     is structurally prevented from hitting any OTHER unique
    --     constraint (uq_contacts_one_primary_per_company is always
    --     avoided by an explicit prior demotion — see the function body),
    --     so this checks the general case outside the RPC surface: no
    --     ambient/global rewrite exists that would ever attach this DETAIL
    --     to an unrelated 23505.
    -- -----------------------------------------------------------------
    v_caught := false;
    begin
        insert into public.companies (id, name, customer_kind)
        values (v_company_a_id, 'Duplicate PK attempt', 'business');
    exception when others then
        v_caught := true;
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_detail = pg_exception_detail;
    end;
    if not v_caught then
        raise exception '5b: expected a primary key violation';
    end if;
    if v_detail = 'NORA_PRIVATE_CUSTOMER_ALREADY_EXISTS' then
        raise exception '5b: an unrelated unique violation (companies_pkey) must never be mistranslated into NORA_PRIVATE_CUSTOMER_ALREADY_EXISTS';
    end if;

    -- -----------------------------------------------------------------
    -- 6. Permission Denied — viewer cannot execute either write RPC
    -- -----------------------------------------------------------------
    perform set_config('request.jwt.claim.sub', v_viewer_user::text, true);

    v_caught := false;
    begin
        perform public.create_customer_with_contact(
            jsonb_build_object('name', 'Viewer Attempt', 'customer_kind', 'business')
        );
    exception when others then
        v_caught := true;
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_detail = pg_exception_detail;
    end;
    if not v_caught then
        raise exception '6: expected viewer to be rejected by create_customer_with_contact';
    end if;
    if v_detail is distinct from 'NORA_PERMISSION_DENIED' then
        raise exception '6: expected DETAIL=NORA_PERMISSION_DENIED, got %', v_detail;
    end if;
    if v_sqlstate is distinct from '42501' then
        raise exception '6: expected SQLSTATE 42501, got %', v_sqlstate;
    end if;

    v_caught := false;
    begin
        perform public.create_quick_capture_case(
            jsonb_build_object('name', 'Viewer Attempt 2', 'customer_kind', 'business'),
            null, null, null, null,
            jsonb_build_object('name', 'Viewer deal attempt', 'category', 'fensterservice')
        );
    exception when others then
        v_caught := true;
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_detail = pg_exception_detail;
    end;
    if not v_caught then
        raise exception '6b: expected viewer to be rejected by create_quick_capture_case';
    end if;
    if v_detail is distinct from 'NORA_PERMISSION_DENIED' then
        raise exception '6b: expected DETAIL=NORA_PERMISSION_DENIED, got %', v_detail;
    end if;

    raise notice 'error_contract_verification.sql: ALL CHECKS PASSED';
end;
$$;
