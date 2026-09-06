-- Nora User Lifecycle W6-B — controlled hard delete of an employee account
--
-- Self-contained: seeds its own throwaway identities inside one DO block and
-- rolls everything back at the end (the block raises ROLLBACK_W6B_TEST and
-- catches it). Safe to run on a fresh `npx supabase db reset --local` with or
-- without rbac_rls_setup.sql.
--
-- Usage (local only):
--   docker exec -i supabase_db_atomic-crm-demo psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/lifecycle_account_deletion_verification.sql
--
-- The GoTrue Admin hard delete is simulated by `DELETE FROM auth.users` in a
-- JWT-less database session (no request.jwt.* claims) — exactly the context
-- GoTrue's own DELETE runs in (proven: current_user = postgres via SECURITY
-- DEFINER, session_user = supabase_auth_admin, no claims). The HTTP-level
-- proof against the real GoTrue lives in the release evidence (bash script).
--
-- What it proves:
--   1. privilege contract: preview / prepare / cancel / evidence RPCs are
--      service_role-only; the internal preview, the normaliser and both guard
--      functions are not API-executable; the ticket table is closed to every
--      API role; both guard triggers exist; the six W2 FKs are still NO ACTION
--   2. browser JWTs cannot call any of the four RPCs
--   3. eligibility: an active target is not eligible; a disabled but unbanned
--      target is not eligible; each of the six business tables blocks on its
--      own — including an ARCHIVED deal, a COMPLETED task and a historical
--      note; authored template / snippet / calendar connection and audit rows
--      as ACTOR block as durable provenance; audit rows as TARGET only do not
--      block; a pristine disabled+banned fake account is eligible
--   4. prepare refusals leave no ticket: viewer / forged / disabled-admin
--      actor, self, wrong typed name (incl. another employee's name), admin
--      target without the extra confirmation, active target, target with
--      history; an admin target WITH the extra confirmation is accepted
--   5. direct DELETE FROM public.sales is refused (postgres and service_role
--      claim), direct DELETE FROM auth.users without a ticket is refused,
--      an expired ticket is refused, a ticket whose identity snapshot no
--      longer matches is refused, a ticket for A never deletes B — and every
--      refusal leaves all state unchanged
--   6. business reference appearing between prepare and delete aborts the
--      whole deletion; nothing changes, the ticket stays live; 6b. the six W2
--      NO ACTION FKs still fire (23503) even when the sales-guard capability
--      (live ticket GUC + nested trigger depth) is satisfied
--   7. authorized eligible delete: sales row, Auth user, sessions, refresh
--      tokens, one-time tokens, identities, W4 email ticket and the
--      attributable delivery rows are gone; a foreign-address delivery row and
--      an unrelated employee's rows stay; exactly one user.account_deleted
--      with the real admin actor, the stable entity, the request id and
--      bounded metadata (no address, no name, no token); prior target-audit
--      rows preserved; ticket consumed; GUCs cleared; unrelated sessions
--      untouched
--   8. retry: deleting again is a no-op; evidence says sale gone + 1 event;
--      no duplicate audit
--   9. id reuse defence: tickets bound to an old identity never match a new
--      sales row, whatever its numeric id
--  10. no audit / capability context leak

\set ON_ERROR_STOP on

\echo '=== W6-B: lifecycle account deletion verification ==='

-- ---------------------------------------------------------------------------
-- 1. Declarative privilege contract
-- ---------------------------------------------------------------------------
do $$
declare
    v_prev text := 'public.get_employee_deletion_preview(bigint)';
    v_prep text := 'public.prepare_employee_account_deletion(uuid, bigint, text, boolean, uuid)';
    v_cancel text := 'public.cancel_employee_account_deletion(uuid)';
    v_evid text := 'public.get_employee_deletion_evidence(bigint)';
    v_int text := 'nora_private.employee_deletion_preview(bigint)';
    v_norm text := 'nora_private.normalize_confirmation_name(text)';
    v_g_auth text := 'nora_private.guard_auth_user_delete()';
    v_g_sales text := 'nora_private.guard_sales_delete()';
    r record;
begin
    for r in select unnest(array[v_prev, v_prep, v_cancel, v_evid, v_int, v_g_auth, v_g_sales]) as sig loop
        if to_regprocedure(r.sig) is null then
            raise exception 'FAIL: % missing', r.sig;
        end if;
        if not exists (
            select 1 from pg_proc p join pg_roles o on o.oid = p.proowner
            where p.oid = r.sig::regprocedure and p.prosecdef and o.rolname = 'postgres'
              and p.proconfig::text like '%search_path=%'
        ) then
            raise exception 'FAIL: % must be postgres-owned SECURITY DEFINER with pinned search_path', r.sig;
        end if;
    end loop;

    for r in select unnest(array[v_prev, v_prep, v_cancel, v_evid]) as sig loop
        if has_function_privilege('anon', r.sig, 'EXECUTE')
           or has_function_privilege('authenticated', r.sig, 'EXECUTE') then
            raise exception 'FAIL: browser roles may EXECUTE %', r.sig;
        end if;
        if not has_function_privilege('service_role', r.sig, 'EXECUTE') then
            raise exception 'FAIL: service_role must EXECUTE %', r.sig;
        end if;
    end loop;

    for r in select unnest(array[v_int, v_norm, v_g_auth, v_g_sales]) as sig loop
        if has_function_privilege('anon', r.sig, 'EXECUTE')
           or has_function_privilege('authenticated', r.sig, 'EXECUTE')
           or has_function_privilege('service_role', r.sig, 'EXECUTE') then
            raise exception 'FAIL: % must not be API-executable', r.sig;
        end if;
    end loop;

    for r in select unnest(array['anon', 'authenticated', 'service_role']) as rol loop
        if has_table_privilege(r.rol, 'nora_private.sales_account_deletion_tickets', 'SELECT')
           or has_table_privilege(r.rol, 'nora_private.sales_account_deletion_tickets', 'INSERT')
           or has_table_privilege(r.rol, 'nora_private.sales_account_deletion_tickets', 'DELETE') then
            raise exception 'FAIL: % may access the deletion ticket table', r.rol;
        end if;
    end loop;

    if not exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'guard_auth_user_delete_trigger' and tgenabled <> 'D') then
        raise exception 'FAIL: guard_auth_user_delete_trigger missing on auth.users';
    end if;
    if not exists (select 1 from pg_trigger where tgrelid = 'public.sales'::regclass and tgname = 'guard_sales_delete_trigger' and tgenabled <> 'D') then
        raise exception 'FAIL: guard_sales_delete_trigger missing on public.sales';
    end if;

    if (select count(*) from pg_constraint where contype = 'f' and confrelid = 'public.sales'::regclass) <> 6
       or exists (select 1 from pg_constraint where contype = 'f' and confrelid = 'public.sales'::regclass and confdeltype <> 'a') then
        raise exception 'FAIL: the six NO ACTION references on sales.id must be unchanged';
    end if;
    if has_table_privilege('anon', 'public.sales', 'DELETE') or has_table_privilege('authenticated', 'public.sales', 'DELETE') then
        raise exception 'FAIL: browser roles must not hold DELETE on sales';
    end if;

    raise notice 'OK  1. privilege contract';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Browser roles cannot execute the RPCs
-- ---------------------------------------------------------------------------
do $$
declare
    v_ok boolean;
    v_sql text;
begin
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
    foreach v_sql in array array[
        'select public.get_employee_deletion_preview(1)',
        'select public.prepare_employee_account_deletion(gen_random_uuid(), 1, ''x'', false, null)',
        'select public.cancel_employee_account_deletion(gen_random_uuid())',
        'select public.get_employee_deletion_evidence(1)'
    ] loop
        v_ok := false;
        begin
            execute v_sql;
        exception when others then
            if sqlstate = '42501' then v_ok := true; else raise; end if;
        end;
        if not v_ok then raise exception 'FAIL: authenticated JWT could execute: %', v_sql; end if;
    end loop;
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    raise notice 'OK  2. browser JWTs refused';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3.–9. Behaviour (single subtransaction, rolled back)
-- ---------------------------------------------------------------------------
do $$
declare
    v_admin_a uuid := gen_random_uuid();   -- acting admin
    v_admin_b uuid := gen_random_uuid();   -- second admin (disabled as actor in one case)
    v_admin_c uuid := gen_random_uuid();   -- disabled admin TARGET
    v_fake uuid := gen_random_uuid();      -- eligible fake account
    v_hist uuid := gen_random_uuid();      -- account with business history
    v_prov uuid := gen_random_uuid();      -- account with provenance
    v_viewer uuid := gen_random_uuid();    -- active viewer
    v_other uuid := gen_random_uuid();     -- unrelated employee (must stay untouched)
    v_a bigint; v_b bigint; v_c bigint; v_f bigint; v_h bigint; v_p bigint; v_v bigint; v_o bigint;
    v_f_entity uuid;
    v_session1 uuid := gen_random_uuid();
    v_session2 uuid := gen_random_uuid();
    v_session_o uuid := gen_random_uuid();
    v_company bigint; v_contact bigint; v_deal bigint; v_task bigint; v_note bigint;
    v_template uuid;
    v_res jsonb; v_prev jsonb; v_evid jsonb;
    v_ticket uuid;
    v_ok boolean;
    v_detail text;
    v_op uuid := '66666666-2222-4333-8444-555555555555';
    v_audit_before bigint;
    v_target_rows_before bigint;
    v_deliv_other_before bigint;
    v_row record;
    v_n integer;
begin
    -- ---- seed identities (handle_new_user creates sales rows)
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values
      (v_admin_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'w6b-a@nora.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{"first_name":"Ada","last_name":"Admin"}', now(), now()),
      (v_admin_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'w6b-b@nora.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{"first_name":"Ben","last_name":"Admin"}', now(), now()),
      (v_admin_c, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'w6b-c@nora.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{"first_name":"Cid","last_name":"Altadmin"}', now(), now()),
      (v_fake,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'w6b-fake@nora.test', 'x', null, '{"provider":"email","providers":["email"]}', '{"first_name":"Fritz","last_name":"Fake"}', now(), now()),
      (v_hist,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'w6b-hist@nora.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{"first_name":"Hanna","last_name":"Historie"}', now(), now()),
      (v_prov,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'w6b-prov@nora.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{"first_name":"Paul","last_name":"Provenienz"}', now(), now()),
      (v_viewer,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'w6b-v@nora.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{"first_name":"Vin","last_name":"Viewer"}', now(), now()),
      (v_other,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'w6b-o@nora.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{"first_name":"Olga","last_name":"Other"}', now(), now());

    select id into v_a from public.sales where user_id = v_admin_a;
    select id into v_b from public.sales where user_id = v_admin_b;
    select id into v_c from public.sales where user_id = v_admin_c;
    select id into v_f from public.sales where user_id = v_fake;
    select id into v_h from public.sales where user_id = v_hist;
    select id into v_p from public.sales where user_id = v_prov;
    select id into v_v from public.sales where user_id = v_viewer;
    select id into v_o from public.sales where user_id = v_other;
    v_f_entity := public.nora_entity_uuid('sales', v_f);

    -- roles; disabling goes through the W1 capability with the admin pinned so
    -- the targets collect genuine target-only lifecycle audit rows
    perform nora_private.apply_sales_role_change(v_a, 'admin', false);
    perform nora_private.apply_sales_role_change(v_b, 'admin', false);
    perform nora_private.pin_audit_context(v_admin_a, v_op);
    perform nora_private.apply_sales_role_change(v_c, 'admin', true);
    perform nora_private.apply_sales_role_change(v_f, 'office', false);
    perform nora_private.apply_sales_role_change(v_h, 'office', true);
    perform nora_private.apply_sales_role_change(v_p, 'office', true);
    perform nora_private.apply_sales_role_change(v_v, 'viewer', false);
    perform nora_private.apply_sales_role_change(v_o, 'office', false);
    perform nora_private.pin_audit_context(null, null);
    -- Auth bans for the disabled targets (the Edge executor's job in production)
    update auth.users set banned_until = now() + interval '10 years' where id in (v_admin_c, v_hist, v_prov);

    -- ---- 3. eligibility
    perform set_config('request.jwt.claim.role', 'service_role', true);

    -- active target
    v_prev := public.get_employee_deletion_preview(v_f);
    if (v_prev ->> 'eligible')::boolean is not false or not (v_prev -> 'reasons') ? 'NORA_EMPLOYEE_STILL_ACTIVE' then
        raise exception 'FAIL: active target must not be eligible: %', v_prev;
    end if;
    -- disabled in Nora but not banned in Auth
    perform nora_private.pin_audit_context(v_admin_a, v_op);
    perform nora_private.apply_sales_role_change(v_f, 'office', true);
    perform nora_private.pin_audit_context(null, null);
    v_prev := public.get_employee_deletion_preview(v_f);
    if (v_prev ->> 'eligible')::boolean is not false or not (v_prev -> 'reasons') ? 'NORA_EMPLOYEE_ACCESS_INCONSISTENT' then
        raise exception 'FAIL: disabled-but-unbanned target must not be eligible: %', v_prev;
    end if;
    update auth.users set banned_until = now() + interval '10 years' where id = v_fake;
    -- pristine disabled+banned fake account, with target-only audit rows
    v_prev := public.get_employee_deletion_preview(v_f);
    if (v_prev ->> 'eligible')::boolean is not true or jsonb_array_length(v_prev -> 'reasons') <> 0 then
        raise exception 'FAIL: pristine fake account must be eligible: %', v_prev;
    end if;
    if (v_prev -> 'technical' ->> 'audit_events_as_target')::int < 1 then
        raise exception 'FAIL: fixture should carry target-only audit rows (user.disabled)';
    end if;
    if (v_prev -> 'target' ->> 'auth_banned')::boolean is not true or (v_prev -> 'target' ->> 'identity_consistent')::boolean is not true then
        raise exception 'FAIL: target facts wrong: %', v_prev -> 'target';
    end if;

    -- each business table blocks on its own — archived deal, done task, notes included
    insert into public.companies (name, sales_id) values ('W6B Kunde', v_o) returning id into v_company;
    insert into public.contacts (first_name, last_name, company_id, sales_id) values ('Kon', 'Takt', v_company, v_o) returning id into v_contact;
    insert into public.deals (name, company_id, stage, sales_id) values ('W6B Deal', v_company, 'opportunity', v_o) returning id into v_deal;

    -- The assignment guard (W2) refuses assigning a DISABLED employee, so each
    -- historical reference is written while H is active and H is disabled
    -- again before the preview is read (the Auth ban stays in place).
    -- companies
    perform nora_private.apply_sales_role_change(v_h, 'office', false);
    update public.companies set sales_id = v_h where id = v_company;
    perform nora_private.apply_sales_role_change(v_h, 'office', true);
    v_prev := public.get_employee_deletion_preview(v_h);
    if (v_prev ->> 'eligible')::boolean is not false or not (v_prev -> 'reasons') ? 'NORA_EMPLOYEE_HAS_BUSINESS_HISTORY' or (v_prev -> 'business_history' ->> 'companies')::int <> 1 then
        raise exception 'FAIL: company must block: %', v_prev;
    end if;
    update public.companies set sales_id = v_o where id = v_company;
    -- contacts
    perform nora_private.apply_sales_role_change(v_h, 'office', false);
    update public.contacts set sales_id = v_h where id = v_contact;
    perform nora_private.apply_sales_role_change(v_h, 'office', true);
    v_prev := public.get_employee_deletion_preview(v_h);
    if (v_prev ->> 'eligible')::boolean is not false or (v_prev -> 'business_history' ->> 'contacts')::int <> 1 then
        raise exception 'FAIL: contact must block: %', v_prev;
    end if;
    update public.contacts set sales_id = v_o where id = v_contact;
    -- ARCHIVED deal
    perform nora_private.apply_sales_role_change(v_h, 'office', false);
    update public.deals set sales_id = v_h, archived_at = now() where id = v_deal;
    perform nora_private.apply_sales_role_change(v_h, 'office', true);
    v_prev := public.get_employee_deletion_preview(v_h);
    if (v_prev ->> 'eligible')::boolean is not false or (v_prev -> 'business_history' ->> 'deals')::int <> 1 then
        raise exception 'FAIL: archived deal must block: %', v_prev;
    end if;
    -- W5 preview (still open work) says 0 open deals for the same row: the two contracts differ on purpose
    if (public.get_employee_dependency_preview(v_h) ->> 'open_deals')::int <> 0 then
        raise exception 'FAIL: W5 preview must not count an archived deal as open';
    end if;
    update public.deals set sales_id = v_o, archived_at = null where id = v_deal;
    -- COMPLETED task
    perform nora_private.apply_sales_role_change(v_h, 'office', false);
    insert into public.tasks (contact_id, company_id, type, text, due_date, done_date, sales_id) values (v_contact, v_company, 'Call', 'done', now(), now(), v_h) returning id into v_task;
    perform nora_private.apply_sales_role_change(v_h, 'office', true);
    v_prev := public.get_employee_deletion_preview(v_h);
    if (v_prev ->> 'eligible')::boolean is not false or (v_prev -> 'business_history' ->> 'tasks')::int <> 1 then
        raise exception 'FAIL: completed task must block: %', v_prev;
    end if;
    if (public.get_employee_dependency_preview(v_h) ->> 'open_tasks')::int <> 0 then
        raise exception 'FAIL: W5 preview must not count a done task as open';
    end if;
    delete from public.tasks where id = v_task;
    -- contact note (authorship; notes have no assignment guard)
    insert into public.contact_notes (contact_id, text, sales_id, date) values (v_contact, 'n', v_h, now()) returning id into v_note;
    v_prev := public.get_employee_deletion_preview(v_h);
    if (v_prev ->> 'eligible')::boolean is not false or (v_prev -> 'business_history' ->> 'contact_notes')::int <> 1 then
        raise exception 'FAIL: contact note must block: %', v_prev;
    end if;
    delete from public.contact_notes where id = v_note;
    -- deal note
    insert into public.deal_notes (deal_id, text, sales_id, date) values (v_deal, 'n', v_h, now()) returning id into v_note;
    v_prev := public.get_employee_deletion_preview(v_h);
    if (v_prev ->> 'eligible')::boolean is not false or (v_prev -> 'business_history' ->> 'deal_notes')::int <> 1 then
        raise exception 'FAIL: deal note must block: %', v_prev;
    end if;
    -- (the deal note stays: H remains the "with history" fixture)

    -- provenance: authored template
    insert into public.checklist_templates (code, name, service_area_code, created_by) values ('W6B-T', 'W6B Vorlage', 'FENS', v_prov) returning id into v_template;
    v_prev := public.get_employee_deletion_preview(v_p);
    if (v_prev ->> 'eligible')::boolean is not false or not (v_prev -> 'reasons') ? 'NORA_EMPLOYEE_HAS_DURABLE_PROVENANCE' or (v_prev -> 'provenance' ->> 'checklist_templates')::int <> 1 then
        raise exception 'FAIL: authored template must block: %', v_prev;
    end if;
    delete from public.checklist_templates where id = v_template;
    -- provenance: authored snippet
    insert into public.saved_text_snippets (service_area_code, kind, text, created_by) values ('FENS', 'note_text', 'W6B', v_prov);
    v_prev := public.get_employee_deletion_preview(v_p);
    if (v_prev ->> 'eligible')::boolean is not false or (v_prev -> 'provenance' ->> 'saved_text_snippets')::int <> 1 then
        raise exception 'FAIL: authored snippet must block: %', v_prev;
    end if;
    delete from public.saved_text_snippets where created_by = v_prov;
    -- provenance: connected calendar
    -- (the connection rules require an allowlisted calendar id; configuration
    --  is a singleton the suite patches and restores inside the rollback)
    update public.configuration set config = coalesce(config, '{}'::jsonb)
        || jsonb_build_object('google_calendar', jsonb_build_object('allowed_calendar_ids', jsonb_build_array('w6b-cal@group.calendar.google.com')))
      where id = 1;
    if not found then
        insert into public.configuration (id, config) values (1, jsonb_build_object('google_calendar', jsonb_build_object('allowed_calendar_ids', jsonb_build_array('w6b-cal@group.calendar.google.com'))));
    end if;
    insert into public.google_calendar_connections (calendar_id, calendar_name, status, connected_by) values ('w6b-cal@group.calendar.google.com', 'W6B', 'disconnected', v_prov);
    v_prev := public.get_employee_deletion_preview(v_p);
    if (v_prev ->> 'eligible')::boolean is not false or (v_prev -> 'provenance' ->> 'google_calendar_connections')::int <> 1 then
        raise exception 'FAIL: connected calendar must block: %', v_prev;
    end if;
    delete from public.google_calendar_connections where connected_by = v_prov;
    -- now pristine again -> eligible
    v_prev := public.get_employee_deletion_preview(v_p);
    if (v_prev ->> 'eligible')::boolean is not true then
        raise exception 'FAIL: P must be eligible after provenance removed: %', v_prev;
    end if;
    -- provenance: the employee ACTED (one audit row with P as actor)
    perform nora_private.pin_audit_context(v_prov, null);
    perform nora_private.write_audit_event(
        p_event_type := 'company.updated', p_entity_type := 'companies',
        p_entity_id := public.nora_entity_uuid('companies', v_company), p_company_id := v_company,
        p_changes := '{"name":{"old":"a","new":"b"}}'::jsonb, p_retention_class := 'crm_change', p_source := 'user');
    perform nora_private.pin_audit_context(null, null);
    v_prev := public.get_employee_deletion_preview(v_p);
    if (v_prev ->> 'eligible')::boolean is not false or not (v_prev -> 'reasons') ? 'NORA_EMPLOYEE_HAS_DURABLE_PROVENANCE' or (v_prev -> 'provenance' ->> 'audit_events_as_actor')::int <> 1 then
        raise exception 'FAIL: audit rows as ACTOR must block: %', v_prev;
    end if;
    -- unknown target
    v_ok := false;
    begin
        perform public.get_employee_deletion_preview(-1);
    exception when others then
        if sqlstate = 'P0002' then v_ok := true; else raise; end if;
    end;
    if not v_ok then raise exception 'FAIL: preview must refuse an unknown employee'; end if;
    raise notice 'OK  3. eligibility: state, six business tables (archived/done/notes), provenance, target-only audit';

    -- ---- 4. prepare refusals
    select count(*) into v_audit_before from public.audit_events where event_type = 'user.account_deleted';
    for v_row in select * from (values
        (v_viewer,           v_f, 'Fritz Fake',  false, 'NORA_PERMISSION_DENIED',                   'viewer actor'),
        (gen_random_uuid(),  v_f, 'Fritz Fake',  false, 'NORA_PERMISSION_DENIED',                   'forged actor'),
        (v_admin_a,          v_a, 'Ada Admin',   true,  'NORA_SELF_DELETE_FORBIDDEN',               'self'),
        (v_admin_a,          v_f, 'Fritz Fak',   false, 'NORA_DELETE_CONFIRMATION_MISMATCH',        'wrong name'),
        (v_admin_a,          v_f, 'Hanna Historie', false, 'NORA_DELETE_CONFIRMATION_MISMATCH',     'another employee''s name'),
        (v_admin_a,          v_f, 'fritz fake',  false, 'NORA_DELETE_CONFIRMATION_MISMATCH',        'case differs'),
        (v_admin_a,          v_f, '',            false, 'NORA_DELETE_CONFIRMATION_MISMATCH',        'empty'),
        (v_admin_a,          v_c, 'Cid Altadmin', false, 'NORA_ADMIN_TARGET_CONFIRMATION_REQUIRED', 'admin target without checkbox'),
        (v_admin_a,          v_v, 'Vin Viewer',  false, 'NORA_EMPLOYEE_STILL_ACTIVE',               'active target'),
        (v_admin_a,          v_h, 'Hanna Historie', false, 'NORA_EMPLOYEE_HAS_BUSINESS_HISTORY',    'business history'),
        (v_admin_a,          v_p, 'Paul Provenienz', false, 'NORA_EMPLOYEE_HAS_DURABLE_PROVENANCE', 'durable provenance')
    ) as t(actor, target, name, adminok, detail, label) loop
        v_ok := false;
        begin
            perform public.prepare_employee_account_deletion(v_row.actor, v_row.target, v_row.name, v_row.adminok, v_op);
        exception when others then
            get stacked diagnostics v_detail = pg_exception_detail;
            if v_detail = v_row.detail then v_ok := true; else raise exception 'FAIL: % → unexpected % / %', v_row.label, sqlstate, v_detail; end if;
        end;
        if not v_ok then raise exception 'FAIL: % must be refused', v_row.label; end if;
    end loop;
    -- disabled admin as actor
    perform nora_private.apply_sales_role_change(v_b, 'admin', true);
    v_ok := false;
    begin
        perform public.prepare_employee_account_deletion(v_admin_b, v_f, 'Fritz Fake', false, v_op);
    exception when others then
        if sqlstate = '42501' then v_ok := true; else raise; end if;
    end;
    if not v_ok then raise exception 'FAIL: disabled admin actor must be refused'; end if;
    perform nora_private.apply_sales_role_change(v_b, 'admin', false);
    -- unknown target
    v_ok := false;
    begin
        perform public.prepare_employee_account_deletion(v_admin_a, -1, 'x', false, v_op);
    exception when others then
        if sqlstate = 'P0002' then v_ok := true; else raise; end if;
    end;
    if not v_ok then raise exception 'FAIL: unknown target must be P0002'; end if;
    if (select count(*) from nora_private.sales_account_deletion_tickets) <> 0 then
        raise exception 'FAIL: a refused prepare left a ticket';
    end if;
    -- admin target WITH the extra confirmation is accepted (then cancelled)
    v_res := public.prepare_employee_account_deletion(v_admin_a, v_c, '  Cid   Altadmin ', true, v_op);
    if (v_res ->> 'sale_id')::bigint <> v_c or (v_res -> 'preview' ->> 'eligible')::boolean is not true then
        raise exception 'FAIL: admin target with confirmation must be prepared: %', v_res;
    end if;
    if public.cancel_employee_account_deletion((v_res ->> 'ticket_id')::uuid) is not true
       or public.cancel_employee_account_deletion((v_res ->> 'ticket_id')::uuid) is not false then
        raise exception 'FAIL: cancel must remove a live ticket exactly once';
    end if;
    raise notice 'OK  4. prepare refusals leave no ticket; admin target needs the extra confirmation';

    -- ---- 5. guards without / with a wrong ticket
    -- direct DELETE FROM sales (postgres)
    perform set_config('request.jwt.claim.role', '', true);
    v_ok := false;
    begin
        delete from public.sales where id = v_f;
    exception when others then
        get stacked diagnostics v_detail = pg_exception_detail;
        if v_detail = 'NORA_SALES_DELETE_NOT_AUTHORIZED' then v_ok := true; else raise; end if;
    end;
    if not v_ok then raise exception 'FAIL: direct sales DELETE (postgres) must be refused'; end if;
    -- direct DELETE FROM sales as service_role (has the table privilege since W2)
    perform set_config('request.jwt.claim.role', 'service_role', true);
    set local role service_role;
    v_ok := false;
    begin
        delete from public.sales where id = v_f;
    exception when others then
        get stacked diagnostics v_detail = pg_exception_detail;
        if v_detail = 'NORA_SALES_DELETE_NOT_AUTHORIZED' then v_ok := true; else raise; end if;
    end;
    reset role;
    if not v_ok then raise exception 'FAIL: direct sales DELETE (service_role) must be refused'; end if;
    -- a forged capability GUC without a ticket does not help
    perform set_config('nora.account_deletion_ticket', gen_random_uuid()::text, true);
    v_ok := false;
    begin
        delete from public.sales where id = v_f;
    exception when others then
        get stacked diagnostics v_detail = pg_exception_detail;
        if v_detail = 'NORA_SALES_DELETE_NOT_AUTHORIZED' then v_ok := true; else raise; end if;
    end;
    perform set_config('nora.account_deletion_ticket', '', true);
    if not v_ok then raise exception 'FAIL: forged capability GUC must be refused'; end if;
    -- direct DELETE FROM auth.users without ticket (JWT-less = GoTrue / Dashboard / SQL)
    perform set_config('request.jwt.claim.role', '', true);
    v_ok := false;
    begin
        delete from auth.users where id = v_fake;
    exception when others then
        get stacked diagnostics v_detail = pg_exception_detail;
        if v_detail = 'NORA_ACCOUNT_DELETE_NOT_AUTHORIZED' then v_ok := true; else raise; end if;
    end;
    if not v_ok then raise exception 'FAIL: auth.users DELETE without ticket must be refused'; end if;
    -- expired ticket
    perform set_config('request.jwt.claim.role', 'service_role', true);
    v_res := public.prepare_employee_account_deletion(v_admin_a, v_f, 'Fritz Fake', false, v_op);
    v_ticket := (v_res ->> 'ticket_id')::uuid;
    update nora_private.sales_account_deletion_tickets set expires_at = now() - interval '1 second' where id = v_ticket;
    perform set_config('request.jwt.claim.role', '', true);
    v_ok := false;
    begin
        delete from auth.users where id = v_fake;
    exception when others then
        get stacked diagnostics v_detail = pg_exception_detail;
        if v_detail = 'NORA_ACCOUNT_DELETE_NOT_AUTHORIZED' then v_ok := true; else raise; end if;
    end;
    if not v_ok then raise exception 'FAIL: expired ticket must be refused'; end if;
    -- a live ticket for F never deletes V (active) nor O (unrelated)
    perform set_config('request.jwt.claim.role', 'service_role', true);
    v_res := public.prepare_employee_account_deletion(v_admin_a, v_f, 'Fritz Fake', false, v_op);
    v_ticket := (v_res ->> 'ticket_id')::uuid;
    perform set_config('request.jwt.claim.role', '', true);
    v_ok := false;
    begin
        delete from auth.users where id = v_other;
    exception when others then
        get stacked diagnostics v_detail = pg_exception_detail;
        if v_detail = 'NORA_ACCOUNT_DELETE_NOT_AUTHORIZED' then v_ok := true; else raise; end if;
    end;
    if not v_ok then raise exception 'FAIL: ticket for F must not delete O'; end if;
    -- identity changed since the ticket (name) -> refused, ticket stays, state unchanged
    update public.sales set first_name = 'Friedrich' where id = v_f;
    v_ok := false;
    begin
        delete from auth.users where id = v_fake;
    exception when others then
        get stacked diagnostics v_detail = pg_exception_detail;
        if v_detail = 'NORA_EMPLOYEE_IDENTITY_INCONSISTENT' then v_ok := true; else raise; end if;
    end;
    if not v_ok then raise exception 'FAIL: changed identity snapshot must be refused'; end if;
    update public.sales set first_name = 'Fritz' where id = v_f;
    -- actor disabled since the ticket -> refused
    perform nora_private.apply_sales_role_change(v_a, 'admin', true);
    v_ok := false;
    begin
        delete from auth.users where id = v_fake;
    exception when others then
        if sqlstate = '42501' then v_ok := true; else raise; end if;
    end;
    if not v_ok then raise exception 'FAIL: actor disabled meanwhile must be refused'; end if;
    perform nora_private.apply_sales_role_change(v_a, 'admin', false);
    if (select count(*) from public.sales where id = v_f) <> 1 or (select count(*) from auth.users where id = v_fake) <> 1
       or (select count(*) from public.audit_events where event_type = 'user.account_deleted') <> v_audit_before
       or (select count(*) from nora_private.sales_account_deletion_tickets where id = v_ticket) <> 1 then
        raise exception 'FAIL: a refused deletion changed state, wrote audit or consumed the ticket';
    end if;
    raise notice 'OK  5. guards: direct sales/auth deletes, expired/foreign/stale tickets all refused without trace';

    -- ---- 6. business reference appears between prepare and delete
    -- (assigned while F is briefly active again — the W2 guard forbids
    --  assigning a disabled employee — then F is disabled again; the ban stays)
    perform nora_private.apply_sales_role_change(v_f, 'office', false);
    update public.companies set sales_id = v_f where id = v_company;
    perform nora_private.apply_sales_role_change(v_f, 'office', true);
    v_ok := false;
    begin
        delete from auth.users where id = v_fake;
    exception when others then
        get stacked diagnostics v_detail = pg_exception_detail;
        if v_detail = 'NORA_EMPLOYEE_HAS_BUSINESS_HISTORY' then v_ok := true; else raise; end if;
    end;
    if not v_ok then raise exception 'FAIL: late business reference must abort the deletion'; end if;
    if (select count(*) from public.sales where id = v_f) <> 1 or (select count(*) from auth.users where id = v_fake) <> 1
       or (select count(*) from public.companies where id = v_company and sales_id = v_f) <> 1
       or (select count(*) from nora_private.sales_account_deletion_tickets where id = v_ticket) <> 1 then
        raise exception 'FAIL: aborted deletion left partial state';
    end if;
    if coalesce(current_setting('nora.account_deletion_ticket', true), '') <> '' or coalesce(current_setting('nora.audit_actor_user_id', true), '') <> '' then
        raise exception 'FAIL: aborted deletion leaked context (subtransaction rollback expected)';
    end if;
    raise notice 'OK  6. late business reference aborts the whole deletion, ticket stays';

    -- ---- 6b. the six NO ACTION FKs are the final barrier BEHIND the guards:
    -- with the sales-guard capability satisfied (live ticket in the GUC, nested
    -- trigger depth >= 2, target disabled) and the company still referencing F,
    -- the DELETE FROM sales itself must fail with 23503. Probe: a temp table
    -- whose BEFORE INSERT trigger issues the sales delete (depth 2).
    create temp table w6b_fk_probe (x int);
    execute format($f$
        create function pg_temp.w6b_fk_probe_delete() returns trigger language plpgsql as $b$
        begin
            delete from public.sales where id = %s;
            return new;
        end; $b$
    $f$, v_f);
    create trigger w6b_fk_probe_trigger before insert on w6b_fk_probe for each row execute function pg_temp.w6b_fk_probe_delete();
    perform set_config('nora.account_deletion_ticket', v_ticket::text, true);
    v_ok := false;
    begin
        insert into w6b_fk_probe values (1);
    exception when foreign_key_violation then
        v_ok := true;
    end;
    perform set_config('nora.account_deletion_ticket', '', true);
    if not v_ok then raise exception 'FAIL: FK barrier must hold behind a satisfied guard capability'; end if;
    if (select count(*) from public.sales where id = v_f) <> 1 then raise exception 'FAIL: FK-refused delete removed the row'; end if;
    -- and without the reference, the same nested statement passes the guard
    -- (proving the capability check itself is what section 5 refused)
    update public.companies set sales_id = v_o where id = v_company;
    perform set_config('nora.account_deletion_ticket', v_ticket::text, true);
    begin
        insert into w6b_fk_probe values (2);
        -- the sales row is gone now; undo for the following sections by rolling back this probe
        raise exception 'W6B_PROBE_OK';
    exception when others then
        if sqlerrm <> 'W6B_PROBE_OK' then raise; end if;
    end;
    perform set_config('nora.account_deletion_ticket', '', true);
    if (select count(*) from public.sales where id = v_f) <> 1 then raise exception 'FAIL: probe subtransaction did not roll back'; end if;
    drop trigger w6b_fk_probe_trigger on w6b_fk_probe;
    drop function pg_temp.w6b_fk_probe_delete();
    drop table w6b_fk_probe;
    raise notice 'OK  6b. the W2 FK barrier holds behind a satisfied guard capability (23503)';

    -- ---- 7. authorized eligible delete
    -- technical state of F: 2 sessions + refresh tokens, a one-time token, an
    -- identity, a W4 email-change ticket, delivery rows: current address, a
    -- former address (W4 history), a foreign address; plus O's own state
    insert into auth.sessions (id, user_id, created_at, updated_at, aal)
    values (v_session1, v_fake, now(), now(), 'aal1'), (v_session2, v_fake, now(), now(), 'aal1'), (v_session_o, v_other, now(), now(), 'aal1');
    insert into auth.refresh_tokens (instance_id, token, user_id, revoked, created_at, updated_at, session_id)
    values ('00000000-0000-0000-0000-000000000000', 'w6b-rt-1', v_fake::text, false, now(), now(), v_session1),
           ('00000000-0000-0000-0000-000000000000', 'w6b-rt-2', v_fake::text, false, now(), now(), v_session2),
           ('00000000-0000-0000-0000-000000000000', 'w6b-rt-o', v_other::text, false, now(), now(), v_session_o);
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (v_fake::text, v_fake, jsonb_build_object('sub', v_fake::text, 'email', 'w6b-fake@nora.test'), 'email', now(), now(), now());
    insert into auth.one_time_tokens (id, user_id, token_type, token_hash, relates_to, created_at, updated_at)
    values (gen_random_uuid(), v_fake, 'confirmation_token', 'w6b-hash', 'w6b-fake@nora.test', now(), now());
    insert into nora_private.sales_email_change_tickets (sale_id, user_id, old_email, new_email, actor_user_id, expires_at)
    values (v_f, v_fake, 'w6b-fake@nora.test', 'w6b-fake-neu@nora.test', v_admin_a, now() + interval '2 minutes');
    -- W4 history: F once had another address (audit row as the DB would write it)
    perform nora_private.pin_audit_context(v_admin_a, null);
    perform nora_private.write_audit_event(
        p_event_type := 'user.email_changed', p_entity_type := 'sales', p_entity_id := v_f_entity,
        p_changes := jsonb_build_object('email', jsonb_build_object('old', 'w6b-fake-alt@nora.test', 'new', 'w6b-fake@nora.test')),
        p_metadata := jsonb_build_object('sale_id', v_f), p_retention_class := 'user_management', p_source := 'user');
    perform nora_private.pin_audit_context(null, null);
    insert into public.email_delivery_events (provider_event, event_type, recipient_email_snapshot, employee_sale_id, recipient_match, correlation_confidence, event_at, dedupe_key)
    values ('delivered', 'EMAIL_DELIVERED', 'w6b-fake@nora.test',     v_f, 'employee', 'best_effort', now(), 'w6b-d1'),
           ('delivered', 'EMAIL_DELIVERED', 'w6b-fake-alt@nora.test', v_f, 'employee', 'best_effort', now(), 'w6b-d2'),
           ('delivered', 'EMAIL_DELIVERED', 'someone-else@nora.test', v_f, 'employee', 'best_effort', now(), 'w6b-d3'),
           ('delivered', 'EMAIL_DELIVERED', 'w6b-o@nora.test',        v_o, 'employee', 'best_effort', now(), 'w6b-d4');
    select count(*) into v_deliv_other_before from public.email_delivery_events where employee_sale_id = v_o;
    select count(*) into v_target_rows_before from public.audit_events where entity_id = v_f_entity;
    if v_target_rows_before < 2 then raise exception 'FAIL: fixture should carry target rows'; end if;

    perform set_config('request.jwt.claim.role', 'service_role', true);
    v_prev := public.get_employee_deletion_preview(v_f);
    if (v_prev -> 'technical' ->> 'email_delivery_events_attributable')::int <> 2
       or (v_prev -> 'technical' ->> 'email_delivery_events_foreign')::int <> 1
       or (v_prev -> 'technical' ->> 'live_sessions')::int <> 2
       or (v_prev -> 'technical' ->> 'email_change_tickets')::int <> 1 then
        raise exception 'FAIL: technical counts wrong: %', v_prev -> 'technical';
    end if;
    -- the earlier live ticket is replaced by a fresh one (housekeeping)
    v_res := public.prepare_employee_account_deletion(v_admin_a, v_f, ' Fritz Fake ', false, v_op);
    v_ticket := (v_res ->> 'ticket_id')::uuid;
    if (select count(*) from nora_private.sales_account_deletion_tickets where sale_id = v_f) <> 1 then
        raise exception 'FAIL: exactly one live ticket per employee';
    end if;
    -- GoTrue's transaction: JWT-less session
    perform set_config('request.jwt.claim.role', '', true);
    delete from auth.users where id = v_fake;
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'FAIL: auth.users delete did not remove the row'; end if;

    if (select count(*) from public.sales where id = v_f) <> 0 then raise exception 'FAIL: sales row remains'; end if;
    if (select count(*) from auth.users where id = v_fake) <> 0 then raise exception 'FAIL: auth user remains'; end if;
    if (select count(*) from auth.sessions where user_id = v_fake) <> 0 then raise exception 'FAIL: sessions remain'; end if;
    if (select count(*) from auth.refresh_tokens where user_id = v_fake::text) <> 0 then raise exception 'FAIL: refresh tokens remain'; end if;
    if (select count(*) from auth.identities where user_id = v_fake) <> 0 then raise exception 'FAIL: identities remain'; end if;
    if (select count(*) from auth.one_time_tokens where user_id = v_fake) <> 0 then raise exception 'FAIL: one-time tokens remain'; end if;
    if (select count(*) from nora_private.sales_email_change_tickets where sale_id = v_f) <> 0 then raise exception 'FAIL: email-change ticket remains'; end if;
    if (select count(*) from nora_private.sales_account_deletion_tickets where id = v_ticket) <> 0 then raise exception 'FAIL: deletion ticket not consumed'; end if;
    if (select count(*) from public.email_delivery_events where employee_sale_id = v_f) <> 1
       or (select recipient_email_snapshot from public.email_delivery_events where employee_sale_id = v_f) <> 'someone-else@nora.test' then
        raise exception 'FAIL: delivery purge must remove exactly the attributable rows and keep the foreign address';
    end if;
    if (select count(*) from public.email_delivery_events where employee_sale_id = v_o) <> v_deliv_other_before then
        raise exception 'FAIL: unrelated employee delivery rows touched';
    end if;
    if (select count(*) from auth.sessions where user_id = v_other) <> 1 or (select count(*) from public.sales where id = v_o) <> 1
       or (select count(*) from auth.users where id = v_other) <> 1 then
        raise exception 'FAIL: unrelated employee touched';
    end if;
    -- audit: prior target rows preserved, exactly one account_deleted with actor/entity/request facts
    if (select count(*) from public.audit_events where entity_id = v_f_entity and event_type <> 'user.account_deleted') <> v_target_rows_before then
        raise exception 'FAIL: historical target audit rows must be preserved';
    end if;
    if (select count(*) from public.audit_events where event_type = 'user.account_deleted' and entity_id = v_f_entity) <> 1 then
        raise exception 'FAIL: expected exactly one user.account_deleted';
    end if;
    select * into v_row from public.audit_events where event_type = 'user.account_deleted' and entity_id = v_f_entity;
    if v_row.actor_id is distinct from v_admin_a or v_row.actor_sales_id is distinct from v_a
       or v_row.actor_name_snapshot <> 'Ada Admin' or v_row.actor_role_snapshot <> 'admin'
       or v_row.request_id is distinct from v_op::text or v_row.retention_class <> 'user_management' or v_row.source <> 'user'
       or v_row.entity_type <> 'sales' then
        raise exception 'FAIL: user.account_deleted actor/request facts wrong: % % % %', v_row.actor_id, v_row.actor_sales_id, v_row.actor_name_snapshot, v_row.request_id;
    end if;
    if (v_row.metadata ->> 'sale_id')::bigint <> v_f or (v_row.metadata ->> 'actor_sale_id')::bigint <> v_a
       or (v_row.metadata ->> 'sessions_removed')::int <> 2
       or (v_row.metadata ->> 'email_change_tickets_removed')::int <> 1
       or (v_row.metadata ->> 'email_delivery_events_purged')::int <> 2
       or (v_row.metadata ->> 'email_delivery_events_retained')::int <> 1
       or (v_row.metadata ->> 'audit_events_as_target_retained')::bigint <> v_target_rows_before
       or (v_row.metadata -> 'eligibility' -> 'business_history' ->> 'companies')::int <> 0
       or (v_row.metadata ->> 'provider_audit_record')::boolean is not true
       or (v_row.metadata ->> 'role') <> 'office' then
        raise exception 'FAIL: user.account_deleted metadata wrong: %', v_row.metadata;
    end if;
    if v_row.metadata::text ~* 'token|jwt|password|banned_until|session_id|ticket_id|@|fritz|fake' then
        raise exception 'FAIL: metadata carries secrets, addresses or names: %', v_row.metadata;
    end if;
    if coalesce(current_setting('nora.audit_actor_user_id', true), '') <> '' or coalesce(current_setting('nora.operation_id', true), '') <> ''
       or coalesce(current_setting('nora.account_deletion_ticket', true), '') <> '' then
        raise exception 'FAIL: context leaked after the deletion';
    end if;
    -- read models: F is gone from sales_identities (as a live admin session)
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', v_admin_a::text, true);
    if exists (select 1 from public.sales_identities where id = v_f) then raise exception 'FAIL: deleted employee still in sales_identities'; end if;
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    raise notice 'OK  7. authorized delete: Nora + Auth identity gone, technical state purged narrowly, audit exactly once, unrelated untouched';

    -- ---- 8. retry / evidence
    delete from auth.users where id = v_fake;
    get diagnostics v_n = row_count;
    if v_n <> 0 then raise exception 'FAIL: second delete must be a no-op'; end if;
    perform set_config('request.jwt.claim.role', 'service_role', true);
    v_evid := public.get_employee_deletion_evidence(v_f);
    if (v_evid ->> 'sale_exists')::boolean is not false or (v_evid ->> 'deleted_event_count')::int <> 1
       or (v_evid ->> 'last_deleted_request_id') <> v_op::text then
        raise exception 'FAIL: evidence wrong: %', v_evid;
    end if;
    v_evid := public.get_employee_deletion_evidence(v_o);
    if (v_evid ->> 'sale_exists')::boolean is not true or (v_evid ->> 'deleted_event_count')::int <> 0 then
        raise exception 'FAIL: evidence for a living employee wrong: %', v_evid;
    end if;
    -- prepare for a deleted sale id -> not found, no fabricated success
    v_ok := false;
    begin
        perform public.prepare_employee_account_deletion(v_admin_a, v_f, 'Fritz Fake', false, v_op);
    exception when others then
        if sqlstate = 'P0002' then v_ok := true; else raise; end if;
    end;
    if not v_ok then raise exception 'FAIL: prepare on a deleted employee must be P0002'; end if;
    if (select count(*) from public.audit_events where event_type = 'user.account_deleted' and entity_id = v_f_entity) <> 1 then
        raise exception 'FAIL: retry produced a duplicate audit row';
    end if;
    raise notice 'OK  8. retry is a no-op; evidence is truthful; no duplicate audit';

    -- ---- 9. numeric id reuse defence
    -- A new employee N. Hand-written tickets that carry F's old facts but N's
    -- sale id (or N's user id with F's sale id) must never authorize N's deletion.
    declare
        v_new uuid := gen_random_uuid();
        v_nid bigint;
    begin
        insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
        values (v_new, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'w6b-new@nora.test', 'x', null, '{"provider":"email","providers":["email"]}', '{"first_name":"Fritz","last_name":"Fake"}', now(), now());
        select id into v_nid from public.sales where user_id = v_new;
        perform nora_private.pin_audit_context(v_admin_a, null);
        perform nora_private.apply_sales_role_change(v_nid, 'office', true);
        perform nora_private.pin_audit_context(null, null);
        update auth.users set banned_until = now() + interval '10 years' where id = v_new;
        -- (a) old identity's user id, new sale id
        insert into nora_private.sales_account_deletion_tickets (sale_id, user_id, entity_id, email_snapshot, first_name_snapshot, last_name_snapshot, role_snapshot, actor_user_id, eligibility_snapshot, expires_at)
        values (v_nid, v_fake, public.nora_entity_uuid('sales', v_nid), 'w6b-fake@nora.test', 'Fritz', 'Fake', 'office', v_admin_a, '{}', now() + interval '2 minutes');
        perform set_config('request.jwt.claim.role', '', true);
        v_ok := false;
        begin
            delete from auth.users where id = v_new;
        exception when others then
            get stacked diagnostics v_detail = pg_exception_detail;
            if v_detail = 'NORA_ACCOUNT_DELETE_NOT_AUTHORIZED' then v_ok := true; else raise; end if;
        end;
        if not v_ok then raise exception 'FAIL: ticket bound to the old Auth user must not delete the new employee'; end if;
        delete from nora_private.sales_account_deletion_tickets where sale_id = v_nid;
        -- (b) new user id, old (recycled-looking) sale id
        insert into nora_private.sales_account_deletion_tickets (sale_id, user_id, entity_id, email_snapshot, first_name_snapshot, last_name_snapshot, role_snapshot, actor_user_id, eligibility_snapshot, expires_at)
        values (v_f, v_new, public.nora_entity_uuid('sales', v_f), 'w6b-new@nora.test', 'Fritz', 'Fake', 'office', v_admin_a, '{}', now() + interval '2 minutes');
        v_ok := false;
        begin
            delete from auth.users where id = v_new;
        exception when others then
            get stacked diagnostics v_detail = pg_exception_detail;
            if v_detail = 'NORA_ACCOUNT_DELETE_NOT_AUTHORIZED' then v_ok := true; else raise; end if;
        end;
        if not v_ok then raise exception 'FAIL: ticket with a foreign sale id must not delete the new employee'; end if;
        delete from nora_private.sales_account_deletion_tickets where user_id = v_new;
        -- (c) matching sale id + user id but a different email snapshot -> identity inconsistent
        insert into nora_private.sales_account_deletion_tickets (sale_id, user_id, entity_id, email_snapshot, first_name_snapshot, last_name_snapshot, role_snapshot, actor_user_id, eligibility_snapshot, expires_at)
        values (v_nid, v_new, public.nora_entity_uuid('sales', v_nid), 'w6b-fake@nora.test', 'Fritz', 'Fake', 'office', v_admin_a, '{}', now() + interval '2 minutes');
        v_ok := false;
        begin
            delete from auth.users where id = v_new;
        exception when others then
            get stacked diagnostics v_detail = pg_exception_detail;
            if v_detail = 'NORA_EMPLOYEE_IDENTITY_INCONSISTENT' then v_ok := true; else raise; end if;
        end;
        if not v_ok then raise exception 'FAIL: ticket with a foreign email snapshot must be refused'; end if;
        if (select count(*) from public.sales where id = v_nid) <> 1 or (select count(*) from auth.users where id = v_new) <> 1 then
            raise exception 'FAIL: reuse-defence probes changed state';
        end if;
        if v_nid <= v_f then raise exception 'FAIL: sequence must only move forward'; end if;
    end;
    raise notice 'OK  9. id reuse defence: tickets bind Auth user + sale + identity snapshot';

    perform set_config('request.jwt.claim.role', '', true);
    raise notice 'W6-B behaviour suite passed (rolled back)';
    raise exception 'ROLLBACK_W6B_TEST';
exception
    when others then
        if sqlerrm = 'ROLLBACK_W6B_TEST' then
            return;
        end if;
        raise;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. No context leak
-- ---------------------------------------------------------------------------
do $$
begin
    if coalesce(current_setting('nora.audit_actor_user_id', true), '') <> ''
       or coalesce(current_setting('nora.operation_id', true), '') <> ''
       or coalesce(current_setting('nora.account_deletion_ticket', true), '') <> ''
       or coalesce(current_setting('request.jwt.claim.role', true), '') <> '' then
        raise exception 'FAIL: context leaked out of the suite';
    end if;
    if (select count(*) from nora_private.sales_account_deletion_tickets) <> 0 then
        raise exception 'FAIL: ticket table not empty after the suite';
    end if;
    raise notice 'OK 10. no context leak, ticket table empty';
end;
$$;

\echo '=== W6-B: all checks passed ==='
select 'lifecycle_account_deletion_verification: OK' as result;
