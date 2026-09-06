-- Nora Application Backbone – Foundation Wave 3
-- Error Observatory Core verification (local Supabase / Docker)
--
-- Run after: npx supabase db reset --local

\set ON_ERROR_STOP on

\echo '=== Error Observatory Wave 3 verification ==='

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'nora_rls_test') then
        create role nora_rls_test
            nosuperuser nobypassrls noinherit nologin;
        grant authenticated to nora_rls_test;
        grant nora_rls_test to postgres;
        grant usage on schema public to nora_rls_test;
        grant usage on schema nora_private to nora_rls_test;
        grant all on all tables in schema public to nora_rls_test;
        grant execute on all functions in schema public to nora_rls_test;
        grant execute on all functions in schema nora_private to nora_rls_test;
    end if;
end;
$$;

create or replace function pg_temp.nora_eo_seed_user(
    p_user_id uuid,
    p_email text,
    p_role text
)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
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
        values ('EO', p_role, p_email, p_user_id, p_role, (p_role = 'admin'), false);
    exception
        when unique_violation then
            -- on_auth_user_created already provisioned a sales row (role
            -- decided by resolve_first_signup_role, not necessarily p_role)
            -- for this user_id via the auth.users insert above. Without this
            -- correction the row silently keeps its auto-assigned role and
            -- every later is_admin()/has_role() check in this suite would
            -- reflect that role instead of the one this test asked for.
            perform nora_private.apply_sales_role_change(
                (select id from public.sales where user_id = p_user_id),
                p_role,
                false
            );
    end;
end;
$$;

do $$
declare
    v_admin uuid := 'c2000000-0000-4000-8000-000000000001';
    v_office uuid := 'c2000000-0000-4000-8000-000000000002';
    v_office2 uuid := 'c2000000-0000-4000-8000-000000000003';
    v_result jsonb;
    v_error_id uuid;
    v_error_id2 uuid;
    v_public_ref text;
    v_public_ref2 text;
    v_actor uuid;
    v_ctx jsonb;
    v_count int;
    v_op uuid := 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    v_op2 uuid := '11111111-2222-4333-8444-555555555555';
    v_op3 uuid := '99999999-aaaa-4bbb-8ccc-dddddddddddd';
    v_company_id bigint;
    v_deal_id bigint;
    v_audit_before int;
    v_audit_after int;
    v_eo_before int;
begin
    perform pg_temp.nora_eo_seed_user(v_admin, 'eo-admin@nora.test', 'admin');
    perform pg_temp.nora_eo_seed_user(v_office, 'eo-office@nora.test', 'office');
    perform pg_temp.nora_eo_seed_user(v_office2, 'eo-office2@nora.test', 'office');
    -- W6-A: browser fixtures carry a live session (fixture session id = user id)
    insert into auth.sessions (id, user_id, created_at, updated_at, aal)
    select u, u, now(), now(), 'aal1' from unnest(array[v_admin, v_office, v_office2]) u
    on conflict (id) do nothing;

    -- -----------------------------------------------------------------------
    -- EXECUTE grants: PUBLIC/anon must not execute SECURITY DEFINER RPCs
    -- -----------------------------------------------------------------------
    if has_function_privilege(
        'anon',
        'public.record_operation_error(text, uuid, text, text, text, text, text, jsonb, text)',
        'EXECUTE'
    ) then
        raise exception 'anon must not EXECUTE record_operation_error';
    end if;
    if has_function_privilege(
        'anon',
        'public.report_operation_error(uuid, text)',
        'EXECUTE'
    ) then
        raise exception 'anon must not EXECUTE report_operation_error';
    end if;
    if has_function_privilege(
        'public',
        'public.record_operation_error(text, uuid, text, text, text, text, text, jsonb, text)',
        'EXECUTE'
    ) then
        raise exception 'PUBLIC must not retain EXECUTE on record_operation_error';
    end if;
    if has_function_privilege(
        'public',
        'public.report_operation_error(uuid, text)',
        'EXECUTE'
    ) then
        raise exception 'PUBLIC must not retain EXECUTE on report_operation_error';
    end if;

    -- -----------------------------------------------------------------------
    -- Direct table access denied
    -- -----------------------------------------------------------------------
    if has_table_privilege('authenticated', 'public.operation_errors', 'INSERT')
       or has_table_privilege('authenticated', 'public.operation_errors', 'UPDATE')
       or has_table_privilege('authenticated', 'public.operation_errors', 'DELETE')
    then
        raise exception 'authenticated must not have INSERT/UPDATE/DELETE on operation_errors';
    end if;
    if has_table_privilege('anon', 'public.operation_errors', 'SELECT')
       or has_table_privilege('anon', 'public.operation_errors', 'INSERT')
    then
        raise exception 'anon must not have table privileges on operation_errors';
    end if;

    perform set_config('request.jwt.claim.sub', v_office::text, true);
    perform set_config(
        'request.jwt.claims',
        jsonb_build_object('sub', v_office::text, 'role', 'authenticated', 'session_id', v_office::text)::text,
        true
    );
    set local role authenticated;

    begin
        insert into public.operation_errors (
            public_ref, operation_id, operation_type, source, actor_user_id
        ) values (
            'NORA-E00000001', v_op, 'deal.update', 'frontend', v_office
        );
        raise exception 'authenticated must not INSERT operation_errors';
    exception
        when insufficient_privilege then
            null;
        when others then
            if sqlstate not in ('42501', '42503')
               and sqlerrm not ilike '%permission%'
               and sqlerrm not ilike '%policy%'
            then
                raise;
            end if;
    end;
    reset role;

    set local role anon;
    begin
        insert into public.operation_errors (
            public_ref, operation_id, operation_type, source, actor_user_id
        ) values (
            'NORA-E00000002', v_op, 'deal.update', 'frontend', v_office
        );
        raise exception 'anon must not INSERT operation_errors';
    exception
        when insufficient_privilege then
            null;
        when others then
            if sqlstate not in ('42501', '42503')
               and sqlerrm not ilike '%permission%'
               and sqlerrm not ilike '%policy%'
            then
                raise;
            end if;
    end;

    begin
        perform public.record_operation_error(
            p_operation_type := 'deal.update',
            p_operation_id := v_op
        );
        raise exception 'anon must not call record_operation_error';
    exception
        when insufficient_privilege then
            null;
        when others then
            if sqlstate not in ('42501', '28000')
               and sqlerrm not ilike '%permission%'
            then
                raise;
            end if;
    end;
    reset role;

    -- -----------------------------------------------------------------------
    -- Unauthenticated (no JWT) must not create rows
    -- -----------------------------------------------------------------------
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '{}', true);
    set local role authenticated;
    begin
        perform public.record_operation_error(
            p_operation_type := 'deal.update',
            p_operation_id := v_op
        );
        raise exception 'unauthenticated must not record_operation_error';
    exception
        when others then
            if sqlstate is distinct from '28000'
               and sqlerrm not ilike '%not authenticated%'
            then
                raise;
            end if;
    end;
    reset role;

    -- -----------------------------------------------------------------------
    -- Authenticated record: actor from JWT; sanitization; NOT NULL operation_id
    -- -----------------------------------------------------------------------
    perform set_config('request.jwt.claim.sub', v_office::text, true);
    perform set_config(
        'request.jwt.claims',
        jsonb_build_object('sub', v_office::text, 'role', 'authenticated', 'session_id', v_office::text)::text,
        true
    );
    set local role authenticated;

    begin
        perform public.record_operation_error(
            p_operation_type := 'deal.update',
            p_operation_id := null
        );
        raise exception 'null operation_id must be rejected';
    exception
        when others then
            if sqlstate is distinct from '22023'
               and sqlerrm not ilike '%operation_id%'
            then
                raise;
            end if;
    end;

    v_result := public.record_operation_error(
        p_operation_type := 'deal.update',
        p_operation_id := v_op,
        p_resource_type := 'deals',
        p_resource_id := '42',
        p_source := 'frontend',
        p_safe_error_code := 'permission_denied',
        p_technical_error_code := 'PGRST301',
        p_technical_context := jsonb_build_object(
            'http_status', 403,
            'postgrest_code', 'PGRST301',
            'sqlstate', '42501',
            'password', 'secret-must-drop',
            'authorization', 'Bearer xyz',
            'body', '{"name":"Kunde"}',
            'edge_function', 'users',
            'http_status_bogus', 9999
        ),
        p_frontend_version := 'abc1234'
    );

    v_error_id := (v_result ->> 'error_id')::uuid;
    v_public_ref := v_result ->> 'public_ref';

    if v_error_id is null or v_public_ref is null then
        raise exception 'record_operation_error must return error_id and public_ref: %', v_result;
    end if;
    if v_public_ref !~ '^NORA-E[0-9A-HJKMNP-TV-Z]{8}$' then
        raise exception 'invalid public_ref format: %', v_public_ref;
    end if;

    reset role;
    select actor_user_id, technical_context, operation_id
    into v_actor, v_ctx, v_op3
    from public.operation_errors
    where id = v_error_id;

    if v_actor is distinct from v_office then
        raise exception 'actor_user_id must come from auth context, got %', v_actor;
    end if;
    if v_op3 is distinct from v_op then
        raise exception 'operation_id must be persisted NOT NULL, got %', v_op3;
    end if;
    if v_ctx ? 'password' or v_ctx ? 'authorization' or v_ctx ? 'body'
       or v_ctx ? 'http_status_bogus'
    then
        raise exception 'forbidden technical_context keys persisted: %', v_ctx;
    end if;
    if (v_ctx ->> 'http_status')::int is distinct from 403 then
        raise exception 'http_status allowlist failed: %', v_ctx;
    end if;

    -- -----------------------------------------------------------------------
    -- Dedupe + distinct attempt
    -- -----------------------------------------------------------------------
    perform set_config('request.jwt.claim.sub', v_office::text, true);
    perform set_config(
        'request.jwt.claims',
        jsonb_build_object('sub', v_office::text, 'role', 'authenticated', 'session_id', v_office::text)::text,
        true
    );
    set local role authenticated;

    v_result := public.record_operation_error(
        p_operation_type := 'deal.update',
        p_operation_id := v_op,
        p_resource_type := 'deals',
        p_resource_id := '42',
        p_safe_error_code := 'permission_denied'
    );
    if (v_result ->> 'error_id')::uuid is distinct from v_error_id then
        raise exception 'dedupe by operation_id failed';
    end if;

    v_result := public.record_operation_error(
        p_operation_type := 'deal.update',
        p_operation_id := v_op2,
        p_safe_error_code := 'network'
    );
    v_error_id2 := (v_result ->> 'error_id')::uuid;
    v_public_ref2 := v_result ->> 'public_ref';
    if v_error_id2 = v_error_id then
        raise exception 'distinct operation_id must create distinct error row';
    end if;

    -- -----------------------------------------------------------------------
    -- report: own / idempotent / dual-id contract / foreign forbidden
    -- -----------------------------------------------------------------------
    v_result := public.report_operation_error(p_error_id := v_error_id);
    if (v_result ->> 'already_reported')::boolean is not false then
        raise exception 'first report must set already_reported=false';
    end if;

    v_result := public.report_operation_error(p_public_ref := v_public_ref);
    if (v_result ->> 'already_reported')::boolean is not true then
        raise exception 'second report must be idempotent already_reported=true';
    end if;

    -- Both identifiers matching same row → OK
    v_result := public.report_operation_error(
        p_error_id := v_error_id,
        p_public_ref := v_public_ref
    );
    if (v_result ->> 'already_reported')::boolean is not true then
        raise exception 'matching dual identifiers must succeed idempotently';
    end if;

    -- Mismatched dual identifiers → not found (no loose OR)
    begin
        perform public.report_operation_error(
            p_error_id := v_error_id,
            p_public_ref := v_public_ref2
        );
        raise exception 'mismatched error_id/public_ref must fail';
    exception
        when others then
            if sqlstate is distinct from 'P0002'
               and sqlerrm not ilike '%not found%'
            then
                raise;
            end if;
    end;

    reset role;

    perform set_config('request.jwt.claim.sub', v_office2::text, true);
    perform set_config(
        'request.jwt.claims',
        jsonb_build_object('sub', v_office2::text, 'role', 'authenticated', 'session_id', v_office2::text)::text,
        true
    );
    set local role authenticated;

    begin
        perform public.report_operation_error(p_error_id := v_error_id);
        raise exception 'foreign user must not report foreign error';
    exception
        when insufficient_privilege then
            null;
        when others then
            if sqlstate is distinct from '42501' then
                raise;
            end if;
    end;

    select count(*) into v_count from public.operation_errors;
    if v_count > 0 then
        raise exception 'non-admin SELECT must not see operation_errors rows, got %', v_count;
    end if;
    reset role;

    perform set_config('request.jwt.claim.sub', v_admin::text, true);
    perform set_config(
        'request.jwt.claims',
        jsonb_build_object('sub', v_admin::text, 'role', 'authenticated', 'session_id', v_admin::text)::text,
        true
    );
    set local role authenticated;
    select count(*) into v_count from public.operation_errors where id = v_error_id;
    if v_count <> 1 then
        raise exception 'admin must SELECT diagnose rows, got %', v_count;
    end if;
    reset role;

    -- -----------------------------------------------------------------------
    -- Audit separation: successful deal update still audits;
    -- Observatory record alone does not invent deal.updated
    -- -----------------------------------------------------------------------
    select count(*) into v_audit_before from public.audit_events;
    select count(*) into v_eo_before from public.operation_errors;

    insert into public.companies (name)
    values ('EO Audit Guard GmbH')
    returning id into v_company_id;

    insert into public.deals (name, company_id, stage, category)
    values ('EO Audit Guard Deal', v_company_id, 'requested', 'fensterservice')
    returning id into v_deal_id;

    update public.deals
    set description = 'eo observatory must not break audit'
    where id = v_deal_id;

    select count(*) into v_audit_after from public.audit_events;
    if v_audit_after <= v_audit_before then
        raise exception 'deal update must still produce audit_events';
    end if;
    if not exists (
        select 1 from public.audit_events
        where event_type = 'deal.updated' and deal_id = v_deal_id
    ) then
        raise exception 'deal.updated audit missing after observatory migration';
    end if;

    -- Recording an Observatory error must not invent additional deal.updated rows.
    select count(*) into v_audit_before
    from public.audit_events
    where event_type = 'deal.updated' and deal_id = v_deal_id;

    perform set_config('request.jwt.claim.sub', v_office::text, true);
    perform set_config(
        'request.jwt.claims',
        jsonb_build_object('sub', v_office::text, 'role', 'authenticated', 'session_id', v_office::text)::text,
        true
    );
    set local role authenticated;
    perform public.record_operation_error(
        p_operation_type := 'deal.update',
        p_operation_id := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid,
        p_resource_type := 'deals',
        p_resource_id := v_deal_id::text
    );
    reset role;

    select count(*) into v_audit_after
    from public.audit_events
    where event_type = 'deal.updated' and deal_id = v_deal_id;
    if v_audit_after <> v_audit_before then
        raise exception 'record_operation_error must not invent deal.updated audit rows';
    end if;
end;
$$;

\echo '=== Error Observatory Wave 3 verification OK ==='
