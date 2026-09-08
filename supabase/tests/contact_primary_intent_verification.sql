-- Nora CRM — Atomic Contact Primary Intent verification (2026-09-08)
-- Run after: npx supabase db reset --local
-- Usage: docker exec -i supabase_db_atomic-crm-demo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/contact_primary_intent_verification.sql
--
-- Self-contained: everything runs inside one transaction that is rolled back
-- at the end (fixtures, contacts, audit rows, idempotency records, the
-- test-only failure-injection triggers). Safe at any position after a reset.
--
-- Proves, against a real Postgres instance:
--   1. privilege matrix of the new command surface (A.8 explicit revokes)
--   2. CREATE: ordinary / make_primary (incident regression) / stale holder
--   3. UPDATE matrix A–I incl. customer moves and company_id = null
--   4. patch allowlist semantics (is_primary ignored, unknown keys ignored)
--   5. viewer rejected server-side (NORA_PERMISSION_DENIED)
--   6. idempotency: replay / conflict / volatile timestamps excluded
--   7. audit: exact rows, actors, change payloads, one request_id per save,
--      no duplicate audit on replay
--   8. failure injection: demote-then-fail, write-then-persist-fail,
--      audit-stage fail — old primary restored, nothing committed, key retriable
--   9. set_primary_contact refactor keeps its contract
--  10. self-contact / private-customer safety
--  11. legacy raw write still hits uq_contacts_one_primary_per_company

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- 1. Privilege matrix + surface shape
-- ---------------------------------------------------------------------------
do $$
declare
    r record;
    v_failures text[] := '{}';
begin
    for r in
        select * from (values
            ('public.create_contact(jsonb, text, bigint, uuid)', 'anon', false),
            ('public.create_contact(jsonb, text, bigint, uuid)', 'authenticated', true),
            ('public.create_contact(jsonb, text, bigint, uuid)', 'service_role', false),
            ('public.update_contact(bigint, jsonb, text, bigint)', 'anon', false),
            ('public.update_contact(bigint, jsonb, text, bigint)', 'authenticated', true),
            ('public.update_contact(bigint, jsonb, text, bigint)', 'service_role', false),
            ('public.set_primary_contact(bigint)', 'anon', false),
            ('public.set_primary_contact(bigint)', 'authenticated', true),
            ('public.set_primary_contact(bigint)', 'service_role', true),
            ('nora_private.prepare_primary_contact_slot(bigint, bigint, bigint, boolean)', 'anon', false),
            ('nora_private.prepare_primary_contact_slot(bigint, bigint, bigint, boolean)', 'authenticated', false),
            ('nora_private.prepare_primary_contact_slot(bigint, bigint, bigint, boolean)', 'service_role', false),
            ('nora_private.lock_customers_for_primary_transition(bigint[])', 'anon', false),
            ('nora_private.lock_customers_for_primary_transition(bigint[])', 'authenticated', false),
            ('nora_private.lock_customers_for_primary_transition(bigint[])', 'service_role', false)
        ) as t(fn, role_name, expected)
    loop
        if has_function_privilege(r.role_name, r.fn, 'EXECUTE') <> r.expected then
            v_failures := v_failures || format('%s EXECUTE on %s expected %s', r.role_name, r.fn, r.expected);
        end if;
    end loop;

    for r in
        select p.proname, p.proacl, pg_get_userbyid(p.proowner) as owner, p.prosecdef, p.proconfig
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('create_contact', 'update_contact', 'set_primary_contact')
    loop
        if r.proacl is null or exists (
            select 1 from aclexplode(r.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'
        ) then
            v_failures := v_failures || format('PUBLIC can execute public.%s', r.proname);
        end if;
        if r.owner <> 'postgres' then
            v_failures := v_failures || format('public.%s owner is %s', r.proname, r.owner);
        end if;
        if not r.prosecdef then
            v_failures := v_failures || format('public.%s is not SECURITY DEFINER', r.proname);
        end if;
        if not (r.proconfig @> array['search_path=""']) then
            v_failures := v_failures || format('public.%s search_path is not empty: %s', r.proname, r.proconfig);
        end if;
    end loop;

    if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('create_contact', 'update_contact', 'set_primary_contact')) <> 3 then
        v_failures := v_failures || 'expected exactly one overload each of create_contact/update_contact/set_primary_contact';
    end if;

    if not exists (select 1 from pg_indexes where indexname = 'uq_contacts_one_primary_per_company') then
        v_failures := v_failures || 'uq_contacts_one_primary_per_company missing';
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'1. privilege matrix failed:\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK 1. privilege matrix / surface shape';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Fixtures (legacy-GUC compat path, pattern of customer_contact_workflow)
-- ---------------------------------------------------------------------------
create temp table cpi_ctx (
    key text primary key,
    id bigint
) on commit drop;

do $$
declare
    v_admin_user uuid := 'c0000000-0000-4000-8000-000000000010';
    v_office_user uuid := 'c0000000-0000-4000-8000-000000000011';
    v_viewer_user uuid := 'c0000000-0000-4000-8000-000000000012';
    v_admin_sale_id bigint;
    v_office_sale_id bigint;
    v_viewer_sale_id bigint;
    v_k1 bigint; v_k2 bigint; v_k3 bigint;
    v_freddie bigint; v_greta bigint; v_hans bigint;
begin
    insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        recovery_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
    )
    values
        ('00000000-0000-0000-0000-000000000000', v_admin_user, 'authenticated', 'authenticated',
         'cpi-admin@nora.test', crypt('password', gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
        ('00000000-0000-0000-0000-000000000000', v_office_user, 'authenticated', 'authenticated',
         'cpi-office@nora.test', crypt('password', gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
        ('00000000-0000-0000-0000-000000000000', v_viewer_user, 'authenticated', 'authenticated',
         'cpi-viewer@nora.test', crypt('password', gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '')
    on conflict (id) do nothing;

    -- handle_new_user may already have created the sales rows (pattern of the
    -- other suites): fall back to the existing row + explicit role. The admin
    -- fixture keeps the last-active-admin guard satisfied on an empty database.
    begin
        insert into public.sales (first_name, last_name, email, user_id, role, administrator, disabled)
        values ('CPI', 'Admin', 'cpi-admin@nora.test', v_admin_user, 'admin', true, false)
        returning id into v_admin_sale_id;
    exception when unique_violation then
        execute 'reset role';
        select id into v_admin_sale_id from public.sales where user_id = v_admin_user;
        perform nora_private.apply_sales_role_change(v_admin_sale_id, 'admin', false);
    end;
    begin
        insert into public.sales (first_name, last_name, email, user_id, role, administrator, disabled)
        values ('CPI', 'Office', 'cpi-office@nora.test', v_office_user, 'office', false, false)
        returning id into v_office_sale_id;
    exception when unique_violation then
        execute 'reset role';
        select id into v_office_sale_id from public.sales where user_id = v_office_user;
        perform nora_private.apply_sales_role_change(v_office_sale_id, 'office', false);
    end;
    begin
        insert into public.sales (first_name, last_name, email, user_id, role, administrator, disabled)
        values ('CPI', 'Viewer', 'cpi-viewer@nora.test', v_viewer_user, 'viewer', false, false)
        returning id into v_viewer_sale_id;
    exception when unique_violation then
        execute 'reset role';
        select id into v_viewer_sale_id from public.sales where user_id = v_viewer_user;
        perform nora_private.apply_sales_role_change(v_viewer_sale_id, 'viewer', false);
    end;

    insert into public.companies (name, customer_kind) values ('freddie krueger test', 'business') returning id into v_k1;
    insert into public.companies (name, customer_kind) values ('Zweitkunde GmbH', 'business') returning id into v_k2;
    insert into public.companies (name, customer_kind) values ('Leerkunde AG', 'business') returning id into v_k3;

    insert into public.contacts (first_name, last_name, company_id, is_primary) values ('Freddie', 'Krueger', v_k1, true) returning id into v_freddie;
    insert into public.contacts (first_name, last_name, company_id, is_primary) values ('Greta', 'Gruen', v_k2, true) returning id into v_greta;
    insert into public.contacts (first_name, last_name, company_id, is_primary) values ('Hans', 'Hilfe', v_k1, false) returning id into v_hans;

    insert into cpi_ctx values
        ('office_sale', v_office_sale_id), ('viewer_sale', v_viewer_sale_id),
        ('k1', v_k1), ('k2', v_k2), ('k3', v_k3),
        ('freddie', v_freddie), ('greta', v_greta), ('hans', v_hans);

    raise notice 'OK 2. fixtures: office=% viewer=% k1=% k2=% k3=% freddie=% greta=% hans=%',
        v_office_sale_id, v_viewer_sale_id, v_k1, v_k2, v_k3, v_freddie, v_greta, v_hans;
end;
$$;

-- helper: act as the office user with a fixed operation id
create or replace function pg_temp.cpi_as_office(p_operation_id uuid)
returns void language plpgsql as $$
begin
    perform set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000011', true);
    perform set_config('nora.operation_id', p_operation_id::text, true);
    execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.cpi_as_viewer()
returns void language plpgsql as $$
begin
    perform set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000012', true);
    perform set_config('nora.operation_id', '', true);
    execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.cpi_id(p_key text)
returns bigint language sql as $$ select id from cpi_ctx where key = p_key $$;

create or replace function pg_temp.cpi_primary_of(p_company bigint)
returns bigint language sql as $$
    select id from public.contacts where company_id = p_company and is_primary
$$;

create or replace function pg_temp.cpi_primary_count(p_company bigint)
returns int language sql as $$
    select count(*)::int from public.contacts where company_id = p_company and is_primary
$$;

-- ---------------------------------------------------------------------------
-- 3. CREATE — ordinary contact (keep), incident regression, stale holder
-- ---------------------------------------------------------------------------
do $$
declare
    v_k1 bigint := pg_temp.cpi_id('k1');
    v_k3 bigint := pg_temp.cpi_id('k3');
    v_freddie bigint := pg_temp.cpi_id('freddie');
    v_office_sale bigint := pg_temp.cpi_id('office_sale');
    v_op uuid;
    v_result jsonb;
    v_new_id bigint;
    v_traeumchen bigint;
    v_caught boolean;
    v_sqlstate text; v_detail text;
    v_before_contacts bigint;
    v_events int;
    v_changes jsonb;
begin
    -- 3a. ordinary create (keep) — non-primary, holder untouched, ONE audit row
    v_op := gen_random_uuid();
    perform pg_temp.cpi_as_office(v_op);
    v_result := public.create_contact(
        jsonb_build_object('first_name', 'Olga', 'last_name', 'Ordinaer', 'company_id', v_k1, 'title', 'Buchhaltung',
                           'email_jsonb', jsonb_build_array(jsonb_build_object('email', 'Olga@Example.DE', 'type', 'Work')),
                           'tags', jsonb_build_array(), 'company_name', 'ignored view column', 'is_primary', true),
        'keep', null, null
    );
    execute 'reset role';
    v_new_id := (v_result->>'contact_id')::bigint;
    if v_new_id is null then raise exception '3a: no contact_id returned: %', v_result; end if;
    if (v_result->'contact'->>'is_primary')::boolean then raise exception '3a: keep must not create a primary (is_primary in payload must be ignored)'; end if;
    if v_result ? '_meta' then raise exception '3a: _meta must be absent without idempotency key'; end if;
    if pg_temp.cpi_primary_of(v_k1) <> v_freddie then raise exception '3a: Freddie must stay primary'; end if;
    if (select email_jsonb->0->>'email' from public.contacts where id = v_new_id) <> 'olga@example.de' then
        raise exception '3a: existing lowercase trigger did not run inside the command';
    end if;
    if (select tags from public.contacts where id = v_new_id) <> '{}'::bigint[] then raise exception '3a: empty tags array must be stored as empty array'; end if;
    select count(*) into v_events from public.audit_events where request_id = v_op::text;
    if v_events <> 1 then raise exception '3a: expected exactly 1 audit row for the op, got %', v_events; end if;
    if not exists (select 1 from public.audit_events where request_id = v_op::text and event_type = 'contact.created'
                   and contact_id = v_new_id and company_id = v_k1 and actor_sales_id = v_office_sale) then
        raise exception '3a: contact.created row missing or wrong actor/entity';
    end if;

    -- 3b. INCIDENT REGRESSION: customer already has Freddie; new contact
    -- Traeumchen with Hauptansprechpartner — the user saw Freddie.
    v_op := gen_random_uuid();
    perform pg_temp.cpi_as_office(v_op);
    v_result := public.create_contact(
        jsonb_build_object('first_name', 'Traeumchen', 'last_name', 'Test', 'company_id', v_k1),
        'make_primary', v_freddie, null
    );
    execute 'reset role';
    v_traeumchen := (v_result->>'contact_id')::bigint;
    if (v_result->>'demoted_contact_id')::bigint <> v_freddie then raise exception '3b: demoted_contact_id must be Freddie'; end if;
    if not (select is_primary from public.contacts where id = v_traeumchen) then raise exception '3b: Traeumchen must be primary'; end if;
    if (select is_primary from public.contacts where id = v_freddie) then raise exception '3b: Freddie must be demoted'; end if;
    if pg_temp.cpi_primary_count(v_k1) <> 1 then raise exception '3b: exactly one primary expected'; end if;

    -- audit: Freddie contact.updated {is_primary true->false} + Traeumchen contact.created; same request id; real actor
    select count(*) into v_events from public.audit_events where request_id = v_op::text;
    if v_events <> 2 then raise exception '3b: expected exactly 2 audit rows, got %', v_events; end if;
    select metadata->'changes' into v_changes from public.audit_events
    where request_id = v_op::text and event_type = 'contact.updated' and contact_id = v_freddie;
    if v_changes is null then raise exception '3b: contact.updated for Freddie missing'; end if;
    if (v_changes->'is_primary'->>'old')::boolean is not true or (v_changes->'is_primary'->>'new')::boolean is not false then
        raise exception '3b: Freddie change payload must be is_primary true -> false (old/new), got %', v_changes;
    end if;
    if v_changes - 'is_primary' <> '{}'::jsonb then raise exception '3b: Freddie audit must contain only is_primary, got %', v_changes; end if;
    if not exists (select 1 from public.audit_events where request_id = v_op::text and event_type = 'contact.created' and contact_id = v_traeumchen) then
        raise exception '3b: contact.created for Traeumchen missing';
    end if;
    if exists (select 1 from public.audit_events where request_id = v_op::text and event_type = 'contact.updated' and contact_id = v_traeumchen) then
        raise exception '3b: new contact must be created in its FINAL state (no created-then-updated audit pair)';
    end if;
    if exists (select 1 from public.audit_events where request_id = v_op::text and actor_sales_id is distinct from v_office_sale) then
        raise exception '3b: every audit row must carry the real actor';
    end if;
    insert into cpi_ctx values ('traeumchen', v_traeumchen), ('olga', v_new_id);

    -- 3c. STALE HOLDER: a second form still shows Freddie, but Traeumchen holds the slot now
    v_op := gen_random_uuid();
    perform pg_temp.cpi_as_office(v_op);
    select count(*) into v_before_contacts from public.contacts;
    v_caught := false;
    begin
        perform public.create_contact(
            jsonb_build_object('first_name', 'Stale', 'last_name', 'Versuch', 'company_id', v_k1),
            'make_primary', v_freddie, null
        );
        execute 'reset role';
    exception when others then
        execute 'reset role';
        v_caught := true;
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_detail = pg_exception_detail;
    end;
    if not v_caught then raise exception '3c: stale expected primary must be rejected'; end if;
    if v_detail <> 'NORA_PRIMARY_CONTACT_CHANGED' then raise exception '3c: expected DETAIL NORA_PRIMARY_CONTACT_CHANGED, got % (%)', v_detail, v_sqlstate; end if;
    if (select count(*) from public.contacts) <> v_before_contacts then raise exception '3c: rejected create must not leave a contact behind'; end if;
    if pg_temp.cpi_primary_of(v_k1) <> v_traeumchen then raise exception '3c: holder must be unchanged after rejection'; end if;
    if exists (select 1 from public.audit_events where request_id = v_op::text) then raise exception '3c: no audit row may survive a rolled-back operation'; end if;

    -- 3d. expected NULL ("user observed no primary") on a customer WITH a primary → rejected
    v_caught := false;
    begin
        perform public.create_contact(jsonb_build_object('first_name', 'Null', 'last_name', 'Erwartung', 'company_id', v_k1), 'make_primary', null, null);
        execute 'reset role';
    exception when others then
        execute 'reset role';
        v_caught := true; get stacked diagnostics v_detail = pg_exception_detail;
    end;
    if not v_caught or v_detail <> 'NORA_PRIMARY_CONTACT_CHANGED' then raise exception '3d: expected NORA_PRIMARY_CONTACT_CHANGED, got %', v_detail; end if;

    -- 3e. expected NULL on a customer WITHOUT primary → becomes primary
    v_op := gen_random_uuid();
    perform pg_temp.cpi_as_office(v_op);
    v_result := public.create_contact(jsonb_build_object('first_name', 'Erste', 'last_name', 'Person', 'company_id', v_k3), 'make_primary', null, null);
    execute 'reset role';
    if pg_temp.cpi_primary_of(v_k3) <> (v_result->>'contact_id')::bigint then raise exception '3e: first contact must become primary of empty customer'; end if;
    if (v_result->>'demoted_contact_id') is not null then raise exception '3e: nothing to demote'; end if;
    insert into cpi_ctx values ('erste', (v_result->>'contact_id')::bigint);

    -- 3f. make_primary without a customer → validation error, nothing written
    v_caught := false;
    begin
        perform public.create_contact(jsonb_build_object('first_name', 'Ohne', 'last_name', 'Kunde'), 'make_primary', null, null);
        execute 'reset role';
    exception when others then
        execute 'reset role';
        v_caught := true; get stacked diagnostics v_sqlstate = returned_sqlstate;
    end;
    if not v_caught or v_sqlstate <> '22023' then raise exception '3f: make_primary without customer must raise 22023'; end if;

    -- 3g. 'clear' is not a create intent
    v_caught := false;
    begin
        perform public.create_contact(jsonb_build_object('first_name', 'X', 'last_name', 'Y', 'company_id', v_k1), 'clear', null, null);
        execute 'reset role';
    exception when others then v_caught := true; end;
        execute 'reset role';
    if not v_caught then raise exception '3g: clear must be rejected on create'; end if;

    raise notice 'OK 3. create: ordinary / incident regression / stale holder / empty customer';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. UPDATE matrix A–I
-- ---------------------------------------------------------------------------
do $$
declare
    v_k1 bigint := pg_temp.cpi_id('k1');
    v_k2 bigint := pg_temp.cpi_id('k2');
    v_freddie bigint := pg_temp.cpi_id('freddie');
    v_greta bigint := pg_temp.cpi_id('greta');
    v_hans bigint := pg_temp.cpi_id('hans');
    v_traeumchen bigint := pg_temp.cpi_id('traeumchen');
    v_olga bigint := pg_temp.cpi_id('olga');
    v_office_sale bigint := pg_temp.cpi_id('office_sale');
    v_op uuid;
    v_result jsonb;
    v_changes jsonb;
    v_events int;
    v_caught boolean; v_detail text; v_sqlstate text;
    v_row public.contacts;
begin
    -- A. ordinary fields, primary unchanged (Traeumchen is primary)
    v_op := gen_random_uuid(); perform pg_temp.cpi_as_office(v_op);
    v_result := public.update_contact(v_traeumchen, jsonb_build_object('title', 'Leitung', 'is_primary', false, 'nb_tasks', 99), 'keep', null);
    execute 'reset role';
    select * into v_row from public.contacts where id = v_traeumchen;
    if v_row.title <> 'Leitung' or not v_row.is_primary then raise exception 'A: title must change, primary must stay (is_primary in patch ignored)'; end if;
    select count(*) into v_events from public.audit_events where request_id = v_op::text;
    if v_events <> 1 then raise exception 'A: expected 1 audit row, got %', v_events; end if;
    select metadata->'changes' into v_changes from public.audit_events where request_id = v_op::text;
    if v_changes ? 'is_primary' or not (v_changes ? 'title') then raise exception 'A: audit must show title only, got %', v_changes; end if;

    -- B. non-primary → make_primary (Freddie back; user observed Traeumchen)
    v_op := gen_random_uuid(); perform pg_temp.cpi_as_office(v_op);
    v_result := public.update_contact(v_freddie, jsonb_build_object('title', 'Chef'), 'make_primary', v_traeumchen);
    execute 'reset role';
    if (v_result->>'demoted_contact_id')::bigint <> v_traeumchen then raise exception 'B: Traeumchen must be reported as demoted'; end if;
    if pg_temp.cpi_primary_of(v_k1) <> v_freddie then raise exception 'B: Freddie must be primary'; end if;
    if pg_temp.cpi_primary_count(v_k1) <> 1 then raise exception 'B: exactly one primary'; end if;
    select count(*) into v_events from public.audit_events where request_id = v_op::text and event_type = 'contact.updated';
    if v_events <> 2 then raise exception 'B: expected 2 contact.updated rows, got %', v_events; end if;
    select metadata->'changes' into v_changes from public.audit_events where request_id = v_op::text and contact_id = v_freddie;
    if (v_changes->'is_primary'->>'new')::boolean is not true or (v_changes->'title'->>'new') <> 'Chef' then
        raise exception 'B: Freddie audit must contain title + is_primary false->true, got %', v_changes;
    end if;
    select metadata->'changes' into v_changes from public.audit_events where request_id = v_op::text and contact_id = v_traeumchen;
    if (v_changes->'is_primary'->>'new')::boolean is not false then raise exception 'B: Traeumchen audit must show demotion, got %', v_changes; end if;
    if exists (select 1 from public.audit_events where request_id = v_op::text and actor_sales_id is distinct from v_office_sale) then
        raise exception 'B: real actor missing';
    end if;

    -- C. primary remains primary: keep → no change; make_primary on the holder with a WRONG expected → no-op success (natural retry idempotency)
    v_op := gen_random_uuid(); perform pg_temp.cpi_as_office(v_op);
    perform public.update_contact(v_freddie, '{}'::jsonb, 'keep', null);
    execute 'reset role';
    perform public.update_contact(v_freddie, '{}'::jsonb, 'make_primary', v_traeumchen);
    execute 'reset role';
    if pg_temp.cpi_primary_of(v_k1) <> v_freddie then raise exception 'C: Freddie must remain primary'; end if;
    if exists (select 1 from public.audit_events where request_id = v_op::text) then raise exception 'C: a no-op save must not produce audit rows'; end if;

    -- D. primary → clear (customer may legitimately end up without a primary)
    v_op := gen_random_uuid(); perform pg_temp.cpi_as_office(v_op);
    perform public.update_contact(v_freddie, '{}'::jsonb, 'clear', null);
    execute 'reset role';
    if pg_temp.cpi_primary_count(v_k1) <> 0 then raise exception 'D: customer must have no primary after clear'; end if;
    select metadata->'changes' into v_changes from public.audit_events where request_id = v_op::text and contact_id = v_freddie;
    if (v_changes->'is_primary'->>'new')::boolean is not false then raise exception 'D: audit must show clearing, got %', v_changes; end if;

    -- E. non-primary remains non-primary (keep) — and re-establish Freddie as primary for the moves below
    perform public.update_contact(v_hans, jsonb_build_object('title', 'Assistenz'), 'keep', null);
    execute 'reset role';
    if (select is_primary from public.contacts where id = v_hans) then raise exception 'E: Hans must stay non-primary'; end if;
    perform public.update_contact(v_freddie, '{}'::jsonb, 'make_primary', null);
    execute 'reset role';
    if pg_temp.cpi_primary_of(v_k1) <> v_freddie then raise exception 'E: Freddie primary again'; end if;

    -- F. move non-primary contact to another customer (keep) → non-primary there, Greta untouched
    v_op := gen_random_uuid(); perform pg_temp.cpi_as_office(v_op);
    perform public.update_contact(v_hans, jsonb_build_object('company_id', v_k2), 'keep', null);
    execute 'reset role';
    select * into v_row from public.contacts where id = v_hans;
    if v_row.company_id <> v_k2 or v_row.is_primary then raise exception 'F: Hans must be non-primary at K2'; end if;
    if pg_temp.cpi_primary_of(v_k2) <> v_greta then raise exception 'F: Greta untouched'; end if;

    -- G. move PRIMARY contact to another customer, remain non-primary (keep) → flag never travels
    v_op := gen_random_uuid(); perform pg_temp.cpi_as_office(v_op);
    perform public.update_contact(v_freddie, jsonb_build_object('company_id', v_k2), 'keep', null);
    execute 'reset role';
    select * into v_row from public.contacts where id = v_freddie;
    if v_row.company_id <> v_k2 or v_row.is_primary then raise exception 'G: moved primary must arrive non-primary'; end if;
    if pg_temp.cpi_primary_count(v_k1) <> 0 then raise exception 'G: old customer may legitimately have no primary'; end if;
    if pg_temp.cpi_primary_of(v_k2) <> v_greta then raise exception 'G: Greta must stay primary at K2'; end if;
    select metadata->'changes' into v_changes from public.audit_events where request_id = v_op::text and contact_id = v_freddie;
    if not (v_changes ? 'company_id') or (v_changes->'is_primary'->>'new')::boolean is not false then
        raise exception 'G: audit must carry company_id + is_primary true->false, got %', v_changes;
    end if;

    -- H. move contact to another customer AND make it that customer's primary (user saw Greta)
    v_op := gen_random_uuid(); perform pg_temp.cpi_as_office(v_op);
    v_result := public.update_contact(v_traeumchen, jsonb_build_object('company_id', v_k2), 'make_primary', v_greta);
    execute 'reset role';
    if (v_result->>'demoted_contact_id')::bigint <> v_greta then raise exception 'H: Greta must be demoted'; end if;
    if pg_temp.cpi_primary_of(v_k2) <> v_traeumchen then raise exception 'H: Traeumchen must be primary at K2'; end if;
    if pg_temp.cpi_primary_count(v_k2) <> 1 then raise exception 'H: exactly one primary at K2'; end if;
    if pg_temp.cpi_primary_count(v_k1) <> 0 then raise exception 'H: K1 has no primary'; end if;
    select count(*) into v_events from public.audit_events where request_id = v_op::text;
    if v_events <> 2 then raise exception 'H: expected 2 audit rows (Greta demoted, Traeumchen moved+promoted), got %', v_events; end if;

    -- H'. move + make_primary with STALE expected (user saw Greta, but Traeumchen holds K2 now) → rejected, nothing moved
    v_caught := false;
    begin
        perform public.update_contact(v_olga, jsonb_build_object('company_id', v_k2), 'make_primary', v_greta);
        execute 'reset role';
    exception when others then v_caught := true; get stacked diagnostics v_detail = pg_exception_detail; end;
        execute 'reset role';
    if not v_caught or v_detail <> 'NORA_PRIMARY_CONTACT_CHANGED' then raise exception 'H'': expected NORA_PRIMARY_CONTACT_CHANGED, got %', v_detail; end if;
    if (select company_id from public.contacts where id = v_olga) <> v_k1 then raise exception 'H'': rejected move must not have moved Olga'; end if;

    -- I. remove customer association entirely while primary → is_primary false; make_primary with null customer → 22023
    perform public.update_contact(v_traeumchen, jsonb_build_object('company_id', null), 'keep', null);
    execute 'reset role';
    select * into v_row from public.contacts where id = v_traeumchen;
    if v_row.company_id is not null or v_row.is_primary then raise exception 'I: company_id null must force is_primary false'; end if;
    if pg_temp.cpi_primary_count(v_k2) <> 0 then raise exception 'I: K2 has no primary now'; end if;
    v_caught := false;
    begin
        perform public.update_contact(v_traeumchen, '{}'::jsonb, 'make_primary', null);
        execute 'reset role';
    exception when others then v_caught := true; get stacked diagnostics v_sqlstate = returned_sqlstate; end;
        execute 'reset role';
    if not v_caught or v_sqlstate <> '22023' then raise exception 'I: make_primary without customer must raise 22023'; end if;
    -- moving back to K2 with make_primary while K2 has no primary
    perform public.update_contact(v_traeumchen, jsonb_build_object('company_id', v_k2), 'make_primary', null);
    execute 'reset role';
    if pg_temp.cpi_primary_of(v_k2) <> v_traeumchen then raise exception 'I: Traeumchen primary at K2 again'; end if;

    -- patch semantics: JSON null clears; unknown key ignored; missing key untouched
    perform public.update_contact(v_hans, jsonb_build_object('title', null, 'company_name', 'ignored', 'tags', jsonb_build_array(1, 2)), 'keep', null);
    execute 'reset role';
    select * into v_row from public.contacts where id = v_hans;
    if v_row.title is not null or v_row.tags <> '{1,2}'::bigint[] or v_row.first_name <> 'Hans' then raise exception 'patch semantics broken: %', to_jsonb(v_row); end if;

    -- unknown intent / missing contact
    v_caught := false;
    begin perform public.update_contact(v_hans, '{}'::jsonb, 'promote', null); exception when others then v_caught := true; end;
    if not v_caught then raise exception 'unknown intent must be rejected'; end if;
    v_caught := false;
    begin perform public.update_contact(999999999, '{}'::jsonb, 'keep', null); exception when others then v_caught := true; get stacked diagnostics v_sqlstate = returned_sqlstate; end;
    if not v_caught or v_sqlstate <> 'P0002' then raise exception 'missing contact must raise P0002'; end if;

    raise notice 'OK 4. update matrix A-I, patch semantics';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Viewer rejected server-side (EXECUTE technically present)
-- ---------------------------------------------------------------------------
do $$
declare
    v_k1 bigint := pg_temp.cpi_id('k1');
    v_hans bigint := pg_temp.cpi_id('hans');
    v_caught boolean; v_detail text;
begin
    perform pg_temp.cpi_as_viewer();
    v_caught := false;
    begin
        perform public.create_contact(jsonb_build_object('first_name', 'V', 'last_name', 'W', 'company_id', v_k1), 'keep', null, null);
        execute 'reset role';
    exception when others then v_caught := true; get stacked diagnostics v_detail = pg_exception_detail; end;
        execute 'reset role';
    if not v_caught or v_detail <> 'NORA_PERMISSION_DENIED' then raise exception '5: viewer create must carry NORA_PERMISSION_DENIED, got %', v_detail; end if;
    v_caught := false;
    begin
        perform public.update_contact(v_hans, jsonb_build_object('title', 'x'), 'keep', null);
        execute 'reset role';
    exception when others then v_caught := true; get stacked diagnostics v_detail = pg_exception_detail; end;
        execute 'reset role';
    if not v_caught or v_detail <> 'NORA_PERMISSION_DENIED' then raise exception '5: viewer update must carry NORA_PERMISSION_DENIED, got %', v_detail; end if;
    v_caught := false;
    begin
        perform public.set_primary_contact(v_hans);
        execute 'reset role';
    exception when others then v_caught := true; get stacked diagnostics v_detail = pg_exception_detail; end;
        execute 'reset role';
    if not v_caught or v_detail <> 'NORA_PERMISSION_DENIED' then raise exception '5: viewer set_primary_contact must carry NORA_PERMISSION_DENIED'; end if;
    reset role;
    raise notice 'OK 5. viewer rejected server-side';
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Idempotency — replay / conflict / volatile timestamps / no duplicate audit
-- ---------------------------------------------------------------------------
do $$
declare
    v_k3 bigint := pg_temp.cpi_id('k3');
    v_erste bigint := pg_temp.cpi_id('erste');
    v_key uuid := gen_random_uuid();
    v_op1 uuid := gen_random_uuid();
    v_op2 uuid := gen_random_uuid();
    v_first jsonb; v_second jsonb; v_third jsonb;
    v_before bigint;
    v_caught boolean; v_detail text;
begin
    perform pg_temp.cpi_as_office(v_op1);
    v_first := public.create_contact(
        jsonb_build_object('first_name', 'Idem', 'last_name', 'Potent', 'company_id', v_k3, 'first_seen', '2026-09-08T10:00:00Z', 'last_seen', '2026-09-08T10:00:00Z'),
        'make_primary', v_erste, v_key
    );
    execute 'reset role';
    if v_first->'_meta'->>'disposition' <> 'executed' then raise exception '6: first write must report executed'; end if;
    if pg_temp.cpi_primary_of(v_k3) <> (v_first->>'contact_id')::bigint then raise exception '6: new contact must be primary'; end if;
    select count(*) into v_before from public.contacts;

    -- replay: same key, same payload except volatile timestamps → same contact, replayed, no insert, no audit
    perform pg_temp.cpi_as_office(v_op2);
    v_second := public.create_contact(
        jsonb_build_object('first_name', 'Idem', 'last_name', 'Potent', 'company_id', v_k3, 'first_seen', '2026-09-08T10:05:00Z', 'last_seen', '2026-09-08T10:05:00Z'),
        'make_primary', v_erste, v_key
    );
    execute 'reset role';
    if v_second->'_meta'->>'disposition' <> 'replayed' then raise exception '6: replay must report replayed, got %', v_second->'_meta'; end if;
    if (v_second->>'contact_id')::bigint <> (v_first->>'contact_id')::bigint then raise exception '6: replay must return the original contact id'; end if;
    if (select count(*) from public.contacts) <> v_before then raise exception '6: replay must not insert a second contact'; end if;
    if exists (select 1 from public.audit_events where request_id = v_op2::text) then raise exception '6: replay must not write audit rows'; end if;
    if pg_temp.cpi_primary_count(v_k3) <> 1 then raise exception '6: still exactly one primary'; end if;

    -- same key, different payload → conflict, no mutation
    v_caught := false;
    begin
        v_third := public.create_contact(jsonb_build_object('first_name', 'Anders', 'last_name', 'Potent', 'company_id', v_k3), 'make_primary', v_erste, v_key);
        execute 'reset role';
    exception when others then v_caught := true; get stacked diagnostics v_detail = pg_exception_detail; end;
        execute 'reset role';
    if not v_caught or v_detail <> 'NORA_IDEMPOTENCY_CONFLICT' then raise exception '6: expected NORA_IDEMPOTENCY_CONFLICT, got %', v_detail; end if;
    if (select count(*) from public.contacts) <> v_before then raise exception '6: conflict must not mutate'; end if;

    -- the stored record is scoped to command contact.create
    if not exists (select 1 from nora_private.idempotency_records where command = 'contact.create' and idempotency_key = v_key) then
        raise exception '6: idempotency record not persisted under scope contact.create';
    end if;
    reset role;
    raise notice 'OK 6. idempotency replay / conflict / volatile timestamps excluded';
end;
$$;

-- ---------------------------------------------------------------------------
-- 6b. Idempotency fingerprint describes the BUSINESS request, not client JSON
--     (RC review 2026-09-08, LOW). public.create_contact ignores unknown keys
--     (view columns such as company_name/nb_notes, UI helper fields), so two
--     submits that differ only in those keys are the SAME request and must
--     replay. A difference in any writable field must still conflict.
-- ---------------------------------------------------------------------------
do $$
declare
    v_k3 bigint := pg_temp.cpi_id('k3');
    v_key uuid := gen_random_uuid();
    v_base jsonb := jsonb_build_object('first_name', 'Fp', 'last_name', 'Basis', 'company_id', v_k3);
    v_first jsonb; v_second jsonb;
    v_before bigint;
    v_caught boolean; v_detail text;
begin
    perform pg_temp.cpi_as_office(gen_random_uuid());
    v_first := public.create_contact(v_base, 'keep', null, v_key);
    execute 'reset role';
    if v_first->'_meta'->>'disposition' <> 'executed' then
        raise exception '6b: first write must report executed';
    end if;
    select count(*) into v_before from public.contacts;

    -- same business request, decorated with keys create_contact ignores
    perform pg_temp.cpi_as_office(gen_random_uuid());
    v_second := public.create_contact(
        v_base || jsonb_build_object(
            'company_name', 'wird ignoriert',
            'nb_notes', 7,
            'unknown_ui_helper', true,
            'first_seen', '2026-09-08T11:00:00Z',
            'last_seen', '2026-09-08T11:30:00Z'
        ),
        'keep', null, v_key
    );
    execute 'reset role';
    if v_second->'_meta'->>'disposition' <> 'replayed' then
        raise exception '6b: ignored unknown keys must not change the fingerprint, got %', v_second->'_meta';
    end if;
    if (v_second->>'contact_id')::bigint <> (v_first->>'contact_id')::bigint then
        raise exception '6b: replay must return the original contact id';
    end if;
    if (select count(*) from public.contacts) <> v_before then
        raise exception '6b: replay must not insert a second contact';
    end if;

    -- a real writable field differs → still a conflict
    v_caught := false;
    begin
        perform public.create_contact(v_base || jsonb_build_object('title', 'Andere Rolle'), 'keep', null, v_key);
        execute 'reset role';
    exception when others then
        v_caught := true;
        get stacked diagnostics v_detail = pg_exception_detail;
    end;
    execute 'reset role';
    if not v_caught or v_detail <> 'NORA_IDEMPOTENCY_CONFLICT' then
        raise exception '6b: a writable-field difference must still conflict, got %', v_detail;
    end if;

    -- a different primary intent under the same key is a different request too
    v_caught := false;
    begin
        perform public.create_contact(v_base, 'make_primary', pg_temp.cpi_primary_of(v_k3), v_key);
        execute 'reset role';
    exception when others then
        v_caught := true;
        get stacked diagnostics v_detail = pg_exception_detail;
    end;
    execute 'reset role';
    if not v_caught or v_detail <> 'NORA_IDEMPOTENCY_CONFLICT' then
        raise exception '6b: a different primary intent must conflict, got %', v_detail;
    end if;

    if (select count(*) from public.contacts) <> v_before then
        raise exception '6b: a conflicting request must not mutate';
    end if;

    -- the ignored keys really were ignored on the stored row
    if exists (
        select 1 from public.contacts
        where id = (v_first->>'contact_id')::bigint
          and (title is not null or last_name <> 'Basis')
    ) then
        raise exception '6b: an ignored key leaked into the stored contact';
    end if;

    reset role;
    raise notice 'OK 6b. idempotency fingerprint = canonical business payload (unknown keys replay, writable diff conflicts)';
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Failure injection — atomicity under real rollback
--    Test-only triggers, created as postgres inside this (rolled back) txn.
-- ---------------------------------------------------------------------------
reset role;

create or replace function pg_temp.cpi_fail_point()
returns trigger language plpgsql as $$
begin
    if coalesce(current_setting('nora.cpi_fail_point', true), '') = tg_argv[0] then
        raise exception 'injected failure at %', tg_argv[0] using errcode = 'P0001', detail = 'CPI_INJECTED_' || tg_argv[0];
    end if;
    return coalesce(new, old);
end;
$$;

create trigger zz_cpi_fail_before_contact_insert before insert on public.contacts
    for each row execute function pg_temp.cpi_fail_point('before_contact_insert');
create trigger zz_cpi_fail_before_idempotency_persist before insert on nora_private.idempotency_records
    for each row execute function pg_temp.cpi_fail_point('before_idempotency_persist');
create trigger zz_cpi_fail_before_audit_insert before insert on public.audit_events
    for each row execute function pg_temp.cpi_fail_point('before_audit_insert');

do $$
declare
    v_k3 bigint := pg_temp.cpi_id('k3');
    v_holder bigint := pg_temp.cpi_primary_of(pg_temp.cpi_id('k3'));
    v_key uuid;
    v_op uuid;
    v_before_contacts bigint;
    v_before_audit bigint;
    v_before_idem bigint;
    v_caught boolean; v_detail text;
    v_result jsonb;
    v_case text;
begin
    if v_holder is null then raise exception '7: fixture expects a primary at K3'; end if;

    foreach v_case in array array['before_contact_insert', 'before_idempotency_persist', 'before_audit_insert'] loop
        v_key := gen_random_uuid();
        v_op := gen_random_uuid();
        select count(*) into v_before_contacts from public.contacts;
        select count(*) into v_before_audit from public.audit_events;
        select count(*) into v_before_idem from nora_private.idempotency_records;

        perform set_config('nora.cpi_fail_point', v_case, true);
        perform pg_temp.cpi_as_office(v_op);
        v_caught := false;
        begin
            perform public.create_contact(
                jsonb_build_object('first_name', 'Inject', 'last_name', v_case, 'company_id', v_k3),
                'make_primary', v_holder, v_key
            );
            execute 'reset role';
        exception when others then
            execute 'reset role';
            v_caught := true; get stacked diagnostics v_detail = pg_exception_detail;
        end;
        reset role;
        perform set_config('nora.cpi_fail_point', '', true);

        if not v_caught or v_detail <> 'CPI_INJECTED_' || v_case then
            raise exception '7 (%): injected failure did not surface (detail=%)', v_case, v_detail;
        end if;
        -- old primary restored (never demoted in a committed state)
        if pg_temp.cpi_primary_of(v_k3) is distinct from v_holder then
            raise exception '7 (%): previous primary was not restored', v_case;
        end if;
        if pg_temp.cpi_primary_count(v_k3) <> 1 then raise exception '7 (%): primary count drifted', v_case; end if;
        if (select count(*) from public.contacts) <> v_before_contacts then raise exception '7 (%): partial contact survived', v_case; end if;
        if (select count(*) from public.audit_events) <> v_before_audit then raise exception '7 (%): committed audit for a rolled-back operation', v_case; end if;
        if (select count(*) from nora_private.idempotency_records) <> v_before_idem then raise exception '7 (%): consumed idempotency record after failure', v_case; end if;

        -- key stays retriable: the same request now succeeds as "executed"
        perform pg_temp.cpi_as_office(gen_random_uuid());
        v_result := public.create_contact(
            jsonb_build_object('first_name', 'Inject', 'last_name', v_case, 'company_id', v_k3),
            'make_primary', v_holder, v_key
        );
        execute 'reset role';
        reset role;
        if v_result->'_meta'->>'disposition' <> 'executed' then raise exception '7 (%): retry after failure must execute, got %', v_case, v_result->'_meta'; end if;
        if pg_temp.cpi_primary_of(v_k3) <> (v_result->>'contact_id')::bigint then raise exception '7 (%): retry must take the slot', v_case; end if;
        v_holder := (v_result->>'contact_id')::bigint;
    end loop;

    -- update path: demote-then-fail must restore the holder too
    v_op := gen_random_uuid();
    perform set_config('nora.cpi_fail_point', 'before_audit_insert', true);
    perform pg_temp.cpi_as_office(v_op);
    v_caught := false;
    begin
        perform public.update_contact(pg_temp.cpi_id('erste'), jsonb_build_object('title', 'Rollback'), 'make_primary', v_holder);
        execute 'reset role';
    exception when others then v_caught := true; end;
        execute 'reset role';
    reset role;
    perform set_config('nora.cpi_fail_point', '', true);
    if not v_caught then raise exception '7 update: injected failure did not surface'; end if;
    if pg_temp.cpi_primary_of(v_k3) <> v_holder then raise exception '7 update: holder must be restored after rollback'; end if;
    if (select title from public.contacts where id = pg_temp.cpi_id('erste')) = 'Rollback' then raise exception '7 update: field change must be rolled back'; end if;
    if exists (select 1 from public.audit_events where request_id = v_op::text) then raise exception '7 update: no audit for rolled-back op'; end if;

    raise notice 'OK 7. failure injection: holder restored, nothing committed, key retriable';
end;
$$;

drop trigger zz_cpi_fail_before_contact_insert on public.contacts;
drop trigger zz_cpi_fail_before_idempotency_persist on nora_private.idempotency_records;
drop trigger zz_cpi_fail_before_audit_insert on public.audit_events;

-- ---------------------------------------------------------------------------
-- 8. set_primary_contact keeps its contract on the shared core
-- ---------------------------------------------------------------------------
do $$
declare
    v_k2 bigint := pg_temp.cpi_id('k2');
    v_greta bigint := pg_temp.cpi_id('greta');
    v_hans bigint := pg_temp.cpi_id('hans');
    v_op uuid := gen_random_uuid();
    v_events int;
begin
    perform pg_temp.cpi_as_office(v_op);
    perform public.set_primary_contact(v_greta);          -- replaces Traeumchen without expected verification
    execute 'reset role';
    if pg_temp.cpi_primary_of(v_k2) <> v_greta then raise exception '8: set_primary_contact must promote Greta'; end if;
    if pg_temp.cpi_primary_count(v_k2) <> 1 then raise exception '8: exactly one primary'; end if;
    perform pg_temp.cpi_as_office(v_op);
    perform public.set_primary_contact(v_greta);          -- idempotent no-op
    execute 'reset role';
    select count(*) into v_events from public.audit_events where request_id = v_op::text;
    if v_events <> 2 then raise exception '8: expected exactly 2 audit rows (demote + promote), got %', v_events; end if;
    perform pg_temp.cpi_as_office(v_op);
    perform public.set_primary_contact(v_hans);
    execute 'reset role';
    if pg_temp.cpi_primary_of(v_k2) <> v_hans then raise exception '8: Hans must be primary'; end if;
    reset role;
    raise notice 'OK 8. set_primary_contact on the shared transition core';
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Self-contact / private-customer safety
-- ---------------------------------------------------------------------------
do $$
declare
    v_k1 bigint := pg_temp.cpi_id('k1');
    v_result jsonb;
    v_privat bigint;
    v_person bigint;
    v_caught boolean;
    v_name text;
    v_row public.contacts;
begin
    perform pg_temp.cpi_as_office(gen_random_uuid());
    -- Privatkundenakte via the existing atomic command (unchanged contract)
    v_result := public.create_customer_with_contact(
        jsonb_build_object('name', 'wird abgeleitet', 'customer_kind', 'individual'),
        jsonb_build_object('first_name', 'Paula', 'last_name', 'Privat'), null, null, false
    );
    execute 'reset role';
    v_privat := (v_result->>'company_id')::bigint;
    v_person := (v_result->>'contact_id')::bigint;

    -- rename through update_contact keeps the name sync trigger working
    perform public.update_contact(v_person, jsonb_build_object('last_name', 'Privatier'), 'keep', null);
    execute 'reset role';
    select name into v_name from public.companies where id = v_privat;
    if v_name <> 'Paula Privatier' then raise exception '9: individual name sync broken through update_contact, got %', v_name; end if;

    -- blanking the representing person is still rejected, whole save rolled back
    v_caught := false;
    begin
        perform public.update_contact(v_person, jsonb_build_object('first_name', ' ', 'last_name', ' ', 'title', 'sollte nicht bleiben'), 'keep', null);
        execute 'reset role';
    exception when others then v_caught := true; end;
        execute 'reset role';
    if not v_caught then raise exception '9: blank name for a Privatkundenakte must be rejected'; end if;
    select * into v_row from public.contacts where id = v_person;
    if v_row.title = 'sollte nicht bleiben' or v_row.first_name = ' ' then raise exception '9: rejected rename must not partially apply'; end if;

    -- moving the representing person to another customer (Freddie scenario) does not touch self_contact_id
    perform public.update_contact(v_person, jsonb_build_object('company_id', v_k1), 'keep', null);
    execute 'reset role';
    select * into v_row from public.contacts where id = v_person;
    if v_row.company_id <> v_k1 or v_row.is_primary then raise exception '9: moved person must be non-primary at K1'; end if;
    if (select self_contact_id from public.companies where id = v_privat) <> v_person then raise exception '9: self_contact_id must be independent of contacts.company_id'; end if;
    if (select name from public.companies where id = v_privat) <> 'Paula Privatier' then raise exception '9: private customer name must survive the move'; end if;

    -- and she can become K1's Hauptansprechpartner (K1 currently has none)
    perform public.update_contact(v_person, '{}'::jsonb, 'make_primary', null);
    execute 'reset role';
    if pg_temp.cpi_primary_of(v_k1) <> v_person then raise exception '9: person must be primary at K1'; end if;
    reset role;
    raise notice 'OK 9. self-contact / private-customer safety';
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Legacy raw write still hits the invariant (unchanged final defense)
-- ---------------------------------------------------------------------------
do $$
declare
    v_k2 bigint := pg_temp.cpi_id('k2');
    v_caught boolean; v_sqlstate text; v_constraint text;
begin
    perform pg_temp.cpi_as_office(gen_random_uuid());
    v_caught := false;
    begin
        insert into public.contacts (first_name, last_name, company_id, is_primary) values ('Raw', 'Write', v_k2, true);
    exception when unique_violation then
        execute 'reset role';
        v_caught := true; get stacked diagnostics v_sqlstate = returned_sqlstate, v_constraint = constraint_name;
    end;
    if not v_caught or v_constraint <> 'uq_contacts_one_primary_per_company' then
        raise exception '10: raw write must still be refused by uq_contacts_one_primary_per_company';
    end if;
    if pg_temp.cpi_primary_count(v_k2) <> 1 then raise exception '10: invariant intact'; end if;
    reset role;
    raise notice 'OK 10. legacy raw write still refused by the unique index (SQLSTATE %)', v_sqlstate;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Global invariant after everything: never more than one primary anywhere
-- ---------------------------------------------------------------------------
do $$
begin
    if exists (select company_id from public.contacts where is_primary and company_id is not null group by company_id having count(*) > 1) then
        raise exception '11: more than one primary per customer detected';
    end if;
    if exists (select 1 from public.contacts where is_primary and company_id is null) then
        raise exception '11: primary without customer detected';
    end if;
    raise notice 'OK 11. global invariant intact';
    raise notice 'contact_primary_intent_verification: all checks passed';
end;
$$;

rollback;
