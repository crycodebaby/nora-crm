-- Nora CRM Operation Status Contract v1 — execution disposition verification
-- Run after: npx supabase db reset --local
-- Usage: docker exec -i supabase_db_atomic-crm-demo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < this file
--
-- NOTE: this file was authored and reviewed but could NOT be executed in
-- this session — no local Docker/Supabase stack was available in the
-- sandbox. It must be run against a real local Postgres instance before the
-- Operation Status Contract v1 is considered production-ready (see final
-- report / decision log "Operation Status Contract Wave").
--
-- Proves, against a real Postgres instance (not a JS mock):
-- - create_customer_with_contact / create_quick_capture_case /
--   create_quick_capture_task return NO `_meta` key at all when
--   p_idempotency_key is null (legacy/backward-compatible callers) — the
--   business result shape is byte-for-byte identical to the pre-wave
--   contract.
-- - with p_idempotency_key set, a fresh write returns
--   _meta.disposition = "executed".
-- - a replay (same key, same fingerprint) returns
--   _meta.disposition = "replayed", with identical business ids to the
--   original write (no duplicate row).
-- - a conflicting replay (same key, different fingerprint) still raises
--   DETAIL=NORA_IDEMPOTENCY_CONFLICT, unaffected by this wave.
-- - the disposition metadata never affects RBAC/permission checks (a
--   rejected office/viewer call fails the same way regardless of
--   p_idempotency_key).

\set ON_ERROR_STOP on

do $$
declare
    v_office_user uuid := 'c0000000-0000-4000-8000-000000000001';
    v_office_sale_id bigint;
    v_result jsonb;
    v_replay jsonb;
    v_key uuid := 'c1111111-1111-4111-8111-111111111111';
    v_task_key uuid := 'c2222222-2222-4222-8222-222222222222';
    v_company_id bigint;
    v_contact_id bigint;
    v_company_count_before int;
    v_company_count_after int;
    v_task_count_before int;
    v_task_count_after int;
    v_detail text;
    v_caught boolean;
begin
    insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        recovery_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
    )
    values
        ('00000000-0000-0000-0000-000000000000', v_office_user, 'authenticated', 'authenticated',
         'op-status-office@nora.test', crypt('password', gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '')
    on conflict (id) do nothing;

    begin
        insert into public.sales (first_name, last_name, email, user_id, role, administrator, disabled)
        values ('OpStatus', 'Office', 'op-status-office@nora.test', v_office_user, 'office', false, false)
        returning id into v_office_sale_id;
    exception
        when unique_violation then
            select id into v_office_sale_id from public.sales where user_id = v_office_user;
            perform nora_private.apply_sales_role_change(v_office_sale_id, 'office', false);
    end;

    perform set_config('request.jwt.claim.sub', v_office_user::text, true);
    execute 'set local role authenticated';

    -- -----------------------------------------------------------------
    -- 1. No p_idempotency_key: result carries NO `_meta` key at all
    --    (backward compatibility — pre-wave callers see byte-identical
    --    shape).
    -- -----------------------------------------------------------------
    v_result := public.create_customer_with_contact(
        jsonb_build_object('name', 'Disposition Legacy GmbH', 'customer_kind', 'business')
    );
    if v_result ? '_meta' then
        raise exception '1: legacy call (no idempotency key) must not carry _meta, got %', v_result;
    end if;

    -- -----------------------------------------------------------------
    -- 2. create_quick_capture_case — fresh write: _meta.disposition = executed
    -- -----------------------------------------------------------------
    select count(*) into v_company_count_before from public.companies;

    v_result := public.create_quick_capture_case(
        jsonb_build_object('name', 'Disposition Quick Capture GmbH', 'customer_kind', 'business'),
        null, null, null, null,
        jsonb_build_object('name', 'Disposition Deal', 'category', 'fensterservice'),
        true,
        v_key
    );
    if v_result->'_meta'->>'disposition' is distinct from 'executed' then
        raise exception '2: expected _meta.disposition=executed on fresh write, got %', v_result;
    end if;
    v_company_id := (v_result->>'company_id')::bigint;
    v_contact_id := (v_result->>'contact_id')::bigint;

    select count(*) into v_company_count_after from public.companies;
    if v_company_count_after <> v_company_count_before + 1 then
        raise exception '2: expected exactly one new company, before=% after=%', v_company_count_before, v_company_count_after;
    end if;

    -- -----------------------------------------------------------------
    -- 3. Replay (same key, same fingerprint): _meta.disposition = replayed,
    --    identical business ids, no new row.
    -- -----------------------------------------------------------------
    v_replay := public.create_quick_capture_case(
        jsonb_build_object('name', 'Disposition Quick Capture GmbH', 'customer_kind', 'business'),
        null, null, null, null,
        jsonb_build_object('name', 'Disposition Deal', 'category', 'fensterservice'),
        true,
        v_key
    );
    if v_replay->'_meta'->>'disposition' is distinct from 'replayed' then
        raise exception '3: expected _meta.disposition=replayed on identical replay, got %', v_replay;
    end if;
    if (v_replay->>'company_id')::bigint is distinct from v_company_id then
        raise exception '3: replay must return the SAME company_id, expected % got %', v_company_id, v_replay->>'company_id';
    end if;

    select count(*) into v_company_count_after from public.companies;
    if v_company_count_after <> v_company_count_before + 1 then
        raise exception '3: replay must not create a second company, count=%', v_company_count_after;
    end if;

    -- -----------------------------------------------------------------
    -- 4. Conflicting replay (same key, different fingerprint): still
    --    NORA_IDEMPOTENCY_CONFLICT, unaffected by the disposition change.
    -- -----------------------------------------------------------------
    v_caught := false;
    begin
        perform public.create_quick_capture_case(
            jsonb_build_object('name', 'Different GmbH', 'customer_kind', 'business'),
            null, null, null, null,
            jsonb_build_object('name', 'Disposition Deal', 'category', 'fensterservice'),
            true,
            v_key
        );
    exception when others then
        v_caught := true;
        get stacked diagnostics v_detail = pg_exception_detail;
    end;
    if not v_caught then
        raise exception '4: expected NORA_IDEMPOTENCY_CONFLICT on a changed payload with the same key';
    end if;
    if v_detail is distinct from 'NORA_IDEMPOTENCY_CONFLICT' then
        raise exception '4: expected DETAIL=NORA_IDEMPOTENCY_CONFLICT, got %', v_detail;
    end if;

    -- -----------------------------------------------------------------
    -- 5. create_quick_capture_task — own scope, own disposition, under the
    --    SAME idempotency_key as the Core call above (independent scopes).
    -- -----------------------------------------------------------------
    select count(*) into v_task_count_before from public.tasks;

    v_result := public.create_quick_capture_task(
        v_company_id, v_contact_id, 'rueckruf', 'Rückruf', current_date, v_office_sale_id, v_task_key
    );
    if v_result->'_meta'->>'disposition' is distinct from 'executed' then
        raise exception '5: expected _meta.disposition=executed on fresh task write, got %', v_result;
    end if;

    v_replay := public.create_quick_capture_task(
        v_company_id, v_contact_id, 'rueckruf', 'Rückruf', current_date, v_office_sale_id, v_task_key
    );
    if v_replay->'_meta'->>'disposition' is distinct from 'replayed' then
        raise exception '5: expected _meta.disposition=replayed on identical task replay, got %', v_replay;
    end if;
    if (v_replay->>'task_id')::bigint is distinct from (v_result->>'task_id')::bigint then
        raise exception '5: task replay must return the SAME task_id';
    end if;

    select count(*) into v_task_count_after from public.tasks;
    if v_task_count_after <> v_task_count_before + 1 then
        raise exception '5: replay must not create a second task, count=%', v_task_count_after;
    end if;

    raise notice 'operation_status_disposition_verification.sql: ALL CHECKS PASSED';
end;
$$;
