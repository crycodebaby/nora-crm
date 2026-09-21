-- Nora CRM — W-A Universal Work Model v1: Work Read Model verification (2026-09-22)
--
-- Run after: npx supabase db reset --local
-- Usage:
--   Get-Content supabase/tests/work_read_model_verification.sql -Raw |
--     docker exec -i supabase_db_atomic-crm-demo psql -U postgres -d postgres -v ON_ERROR_STOP=1
--
-- Self-contained: everything runs inside ONE transaction that is rolled back at
-- the end. Safe at any position after a reset, on an empty database or with
-- fixtures. Runs OUTSIDE the rbac_rls setup -> teardown window (21 §5): it
-- asserts the exact owner/authenticated ACL of the two new functions, which the
-- test-role setup would legitimately widen.
--
-- DELIBERATE, AND ROLLED BACK: the transaction first DELETEs every row of
-- public.tasks so the Work universe is exactly this suite's fixtures. Sorting,
-- pagination and "no gaps / no duplicates over an unchanged row set" are only
-- provable against a known universe. Nothing is committed.
--
-- What it proves (docs/nora/25 §22 criteria in brackets):
--   A  function form: both objects exist with the contracted language,
--      volatility, INVOKER/DEFINER split, search_path, owner and ACL; the
--      signature carries NO actor parameter                      [1, 2, 5, 18]
--   B  actor resolver: an active session-bound employee resolves; disabled,
--      revoked session, foreign session, missing identity and malformed
--      identity resolve to NULL and never become another actor            [5]
--   C  access matrix: anon / service_role denied; viewer, office and admin
--      permitted through existing Nora security; disabled and revoked denied
--   D  scope: mine vs team through the SAME RPC                        [6, 7]
--   E  state scope: default open, explicit done, explicit all          [6, 7]
--   F  incomplete rows: NULL / '' / '   ' are incomplete and STAY in the open
--      basket; '  foo  ' stays byte-identical and valid                  [15]
--   G  unassigned: is_unassigned true, is_mine false, in team, not in mine;
--      set_sales_id_default() untouched                                   [3]
--   H  nullable due: overdue/due_today false, NULLS LAST ordering     [8, 12]
--   I  Europe/Berlin business day: overdue, due today, future, null,
--      UTC->Berlin rollover, spring DST, autumn DST                 [13, 14]
--   J  deterministic total order incl. the work_id tie-break              [8]
--   K  keyset pagination: non-null->non-null, equal-due tie, non-null->NULL,
--      NULL->NULL, last page, no duplicates, no gaps, several page sizes  [9]
--   L  read-only: the RPC mutates nothing and works in a read-only
--      transaction                                                       [19]
--   M  exact response contract: envelope and row field sets; no
--      allowed_actions, carrier_capabilities, case or deal    [10, 11, 13, 18]
--
-- Criterion 4 (two real GoTrue sessions) is NOT provable from one SQL session —
-- see supabase/tests/work_read_model_session_verification.mjs.
-- Criteria 16, 17, 20, 21 are consumer-side absences: W-A ships no consumer
-- (verified by the empty src/** diff of the RC).

\set ON_ERROR_STOP on

\echo '=== W-A: Work Read Model verification ==='

begin;

-- ---------------------------------------------------------------------------
-- A. Function form, security boundary and ACL
-- ---------------------------------------------------------------------------
do $$
declare
    v_failures text[] := '{}';
    r          record;
    v_oid      oid;
begin
    for r in
        select * from (values
            ('nora_private.current_sales_id()',                           'sql',     's', true,  'bigint', ''),
            ('public.get_work_items(text,text,integer,timestamptz,uuid)', 'plpgsql', 's', false, 'jsonb',
             'p_scope text, p_state_scope text, p_limit integer, p_cursor_due_at timestamp with time zone, p_cursor_work_id uuid')
        ) as t(sig, lang, volat, secdef, rettype, args)
    loop
        v_oid := to_regprocedure(r.sig);
        if v_oid is null then
            v_failures := v_failures || format('A: %s does not exist', r.sig);
            continue;
        end if;
        if (select l.lanname from pg_proc p join pg_language l on l.oid = p.prolang where p.oid = v_oid) <> r.lang then
            v_failures := v_failures || format('A: %s is not LANGUAGE %s', r.sig, r.lang);
        end if;
        if (select p.provolatile from pg_proc p where p.oid = v_oid) <> r.volat then
            v_failures := v_failures || format('A: %s is not STABLE', r.sig);
        end if;
        if (select p.prosecdef from pg_proc p where p.oid = v_oid) <> r.secdef then
            v_failures := v_failures || format('A: %s has the wrong SECURITY setting (expected definer = %s)', r.sig, r.secdef);
        end if;
        if (select coalesce(array_to_string(p.proconfig, ','), '') from pg_proc p where p.oid = v_oid) <> 'search_path=""' then
            v_failures := v_failures || format('A: %s does not pin search_path = ''''', r.sig);
        end if;
        if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = v_oid) <> 'postgres' then
            v_failures := v_failures || format('A: %s is not owned by postgres', r.sig);
        end if;
        if (select pg_catalog.format_type(p.prorettype, null) from pg_proc p where p.oid = v_oid) <> r.rettype then
            v_failures := v_failures || format('A: %s does not return %s', r.sig, r.rettype);
        end if;
        -- The actor is never an argument (25 §10.1, D-26): the signature is
        -- pinned exactly, so an added p_actor_id / p_sales_id fails here.
        if (select pg_get_function_identity_arguments(p.oid) from pg_proc p where p.oid = v_oid) <> r.args then
            v_failures := v_failures || format('A: %s does not carry the contracted signature (%s)', r.sig, r.args);
        end if;
        -- ACL: authenticated only. A new function is born with PUBLIC EXECUTE
        -- (22 §6.3), so the PUBLIC entry is asserted absent, not assumed.
        if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
            v_failures := v_failures || format('A: authenticated cannot EXECUTE %s', r.sig);
        end if;
        if has_function_privilege('anon', v_oid, 'EXECUTE') then
            v_failures := v_failures || format('A: anon can EXECUTE %s', r.sig);
        end if;
        if has_function_privilege('service_role', v_oid, 'EXECUTE') then
            v_failures := v_failures || format('A: service_role can EXECUTE %s', r.sig);
        end if;
        if (select p.proacl is null from pg_proc p where p.oid = v_oid) then
            v_failures := v_failures || format('A: %s still carries the default NULL ACL', r.sig);
        end if;
        if exists (select 1 from pg_proc p, unnest(p.proacl) a where p.oid = v_oid and a::text like '=%') then
            v_failures := v_failures || format('A: PUBLIC still holds EXECUTE on %s', r.sig);
        end if;
    end loop;

    -- exactly one overload of each; no sibling variant that could be reached
    if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'get_work_items') <> 1 then
        v_failures := array_append(v_failures, 'A: public.get_work_items is overloaded');
    end if;
    if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'nora_private' and p.proname = 'current_sales_id') <> 1 then
        v_failures := array_append(v_failures, 'A: nora_private.current_sales_id is overloaded');
    end if;

    -- the resolver is NOT the audit actor resolver (25 §10.1): no externally
    -- supplied GUC may enter the Work actor.
    if position('nora.audit_actor_user_id' in
                (select p.prosrc from pg_proc p where p.oid = to_regprocedure('nora_private.current_sales_id()'))) > 0 then
        v_failures := array_append(v_failures, 'A: current_sales_id() reads the externally supplied audit-actor GUC');
    end if;
    if position('current_setting' in
                (select p.prosrc from pg_proc p where p.oid = to_regprocedure('nora_private.current_sales_id()'))) > 0 then
        v_failures := array_append(v_failures, 'A: current_sales_id() reads a GUC directly instead of going through safe_auth_uid()');
    end if;
    if position('resolve_audit_actor' in
                (select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.get_work_items(text,text,integer,timestamptz,uuid)'))) > 0 then
        v_failures := array_append(v_failures, 'A: the Work Query derives its actor from resolve_audit_actor()');
    end if;

    -- nora_private is not PostgREST-exposed, so the resolver is not an RPC
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where p.proname = 'current_sales_id' and n.nspname = 'public') then
        v_failures := array_append(v_failures, 'A: a public.current_sales_id exists — the resolver must stay internal');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL:\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  A. function form, INVOKER/DEFINER split, signature and ACL';
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- The Work universe is emptied first (rolled back) so that ordering and
-- pagination are provable against a known row set.
delete from public.tasks;

create temp table wa_ctx (key text primary key, id bigint) on commit drop;
create temp table wa_uid (key text primary key, uid uuid, sid uuid) on commit drop;

do $$
declare
    r           record;
    v_uid       uuid;
    v_sale      bigint;
    v_a         bigint;
    v_b         bigint;
    v_company   bigint;
    v_contact   bigint;
    v_today     date        := (now() at time zone 'Europe/Berlin')::date;
    v_today0    timestamptz := (v_today::timestamp) at time zone 'Europe/Berlin';
    v_tomorrow0 timestamptz := ((v_today + 1)::timestamp) at time zone 'Europe/Berlin';
    v_tie       timestamptz := ((v_today + 10)::timestamp + interval '12 hours') at time zone 'Europe/Berlin';
    v_task      bigint;
begin
    -- six employees. handle_new_user creates the public.sales row; the admin is
    -- normalised first so downgrading the auto-admin never trips
    -- guard_last_active_admin on an empty database.
    for r in
        select * from (values
            ('admin',    'admin',  false),
            ('officeA',  'office', false),
            ('officeB',  'office', false),
            ('viewer',   'viewer', false),
            ('disabled', 'office', true ),
            ('revoked',  'office', false)
        ) as t(label, role, disabled)
    loop
        v_uid := gen_random_uuid();
        insert into auth.users (
            instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
            confirmation_token, email_change, email_change_token_new, recovery_token
        )
        values (
            '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
            format('wa-sql-%s@nora.test', r.label), crypt('wa-password', gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
        );
        insert into wa_uid values (r.label, v_uid, gen_random_uuid());
    end loop;

    select s.id into v_sale from public.sales s
      join wa_uid x on x.uid = s.user_id where x.key = 'admin';
    perform nora_private.apply_sales_role_change(v_sale, 'admin', false);
    update public.sales set first_name = 'W-A', last_name = 'Admin' where id = v_sale;
    insert into wa_ctx values ('sale_admin', v_sale);

    -- 'disabled' starts ACTIVE: it must legitimately acquire a task before it
    -- is deactivated at the end of this block (guard_active_assignment refuses
    -- assigning work to a disabled employee — 25 §9).
    for r in
        select * from (values
            ('officeA',  'office', false),
            ('officeB',  'office', false),
            ('viewer',   'viewer', false),
            ('disabled', 'office', false),
            ('revoked',  'office', false)
        ) as t(label, role, disabled)
    loop
        select s.id into v_sale from public.sales s
          join wa_uid x on x.uid = s.user_id where x.key = r.label;
        perform nora_private.apply_sales_role_change(v_sale, r.role, r.disabled);
        update public.sales set first_name = 'W-A', last_name = initcap(r.label) where id = v_sale;
        insert into wa_ctx values ('sale_' || r.label, v_sale);
    end loop;

    -- one live session per employee; 'revoked' loses its session again
    insert into auth.sessions (id, user_id, created_at, updated_at, aal)
    select x.sid, x.uid, now(), now(), 'aal1' from wa_uid x;
    delete from auth.sessions where id = (select sid from wa_uid where key = 'revoked');

    v_a := (select id from wa_ctx where key = 'sale_officeA');
    v_b := (select id from wa_ctx where key = 'sale_officeB');

    insert into public.companies (name, customer_kind) values ('W-A Kunde GmbH', 'business')
        returning id into v_company;
    insert into public.contacts (first_name, last_name, company_id) values ('Wanda', 'Arbeit', v_company)
        returning id into v_contact;
    insert into wa_ctx values ('company', v_company), ('contact', v_contact);

    -- a second customer, a contact that will MOVE to it, and a contact with no
    -- customer at all (25 §14.1 / §14.2 — both are legitimate domain states)
    insert into public.companies (name, customer_kind) values ('W-A Zweitkunde GmbH', 'business')
        returning id into v_task;
    insert into wa_ctx values ('company2', v_task);
    insert into public.contacts (first_name, last_name, company_id) values ('Mara', 'Wandert', v_company)
        returning id into v_task;
    insert into wa_ctx values ('contact_moved', v_task);
    insert into public.contacts (first_name, last_name, company_id) values ('Klaus', 'Kundenlos', null)
        returning id into v_task;
    insert into wa_ctx values ('contact_free', v_task);
    insert into public.contacts (first_name, last_name, company_id) values ('Lena', 'Spaetkunde', null)
        returning id into v_task;
    insert into wa_ctx values ('contact_late', v_task);

    -- dated open work ------------------------------------------------------
    for r in
        select * from (values
            ('d_overdue',   'A ueberfaellig',  v_today0 - interval '3 days' + interval '9 hours', v_a),
            ('d_day_start', 'A Tagesbeginn',   v_today0,                                          v_a),
            ('d_yesterday', 'A gestern Ende',  v_today0 - interval '1 microsecond',               v_a),
            ('d_day_end',   'B Tagesende',     v_tomorrow0 - interval '1 microsecond',            v_b),
            ('d_tomorrow',  'B morgen Anfang', v_tomorrow0,                                       v_b),
            ('tie_1',       'A Gleichstand 1', v_tie,                                             v_a),
            ('tie_2',       'A Gleichstand 2', v_tie,                                             v_a),
            ('tie_3',       'A Gleichstand 3', v_tie,                                             v_a),
            ('dst_spring_before', 'A DST Fruehling vor',  make_timestamptz(2026,  3, 29, 0, 30, 0, 'Europe/Berlin'), v_a),
            ('dst_spring_after',  'A DST Fruehling nach', make_timestamptz(2026,  3, 29, 3, 30, 0, 'Europe/Berlin'), v_a),
            ('dst_autumn_before', 'A DST Herbst vor',     make_timestamptz(2026, 10, 25, 0, 30, 0, 'Europe/Berlin'), v_a),
            ('dst_autumn_after',  'A DST Herbst nach',    make_timestamptz(2026, 10, 26, 0, 30, 0, 'Europe/Berlin'), v_a)
        ) as t(key, txt, due, holder)
    loop
        insert into public.tasks (company_id, type, text, due_date, sales_id)
        values (v_company, 'Anruf', r.txt, r.due, r.holder)
        returning id into v_task;
        insert into wa_ctx values (r.key, v_task);
    end loop;

    -- undated open work ----------------------------------------------------
    for r in
        select * from (values
            ('n_plain',  'A ohne Frist'),
            ('n_null',   null),
            ('n_empty',  ''),
            ('n_blank',  '   '),
            ('n_padded', '  foo  ')
        ) as t(key, txt)
    loop
        insert into public.tasks (company_id, contact_id, type, text, due_date, sales_id)
        values (v_company, v_contact, 'Anruf', r.txt, null, v_a)
        returning id into v_task;
        insert into wa_ctx values (r.key, v_task);
    end loop;

    -- no customer context at all: the contact has none either, so no path
    -- could resolve one (25 §14.2, D-34). company_id stays NULL and the
    -- tasks_company_or_contact_check is satisfied by the contact alone.
    insert into public.tasks (company_id, contact_id, type, text, due_date, sales_id)
    values (null, (select id from wa_ctx where key = 'contact_free'), 'Anruf', 'Ohne Kundenkontext', null, v_a)
    returning id into v_task;
    insert into wa_ctx values ('n_no_customer', v_task);

    -- historical customer context: the task keeps the customer it was created
    -- with, even after its contact moves to another customer (25 §14.1, D-35).
    insert into public.tasks (company_id, contact_id, type, text, due_date, sales_id)
    values (v_company, (select id from wa_ctx where key = 'contact_moved'), 'Anruf',
            'Historischer Kundenkontext', null, v_a)
    returning id into v_task;
    insert into wa_ctx values ('n_historical', v_task);
    update public.contacts set company_id = (select id from wa_ctx where key = 'company2')
     where id = (select id from wa_ctx where key = 'contact_moved');

    -- The case that separates "explicitly null" from "not looked up yet": the
    -- task is created while its contact has no customer (so company_id stays
    -- NULL), and the contact acquires one AFTERWARDS. A resolve-from-contact
    -- fallback would now report a customer the task never had.
    insert into public.tasks (company_id, contact_id, type, text, due_date, sales_id)
    values (null, (select id from wa_ctx where key = 'contact_late'), 'Anruf',
            'Kunde erst spaeter am Kontakt', null, v_a)
    returning id into v_task;
    insert into wa_ctx values ('n_customer_later', v_task);
    update public.contacts set company_id = (select id from wa_ctx where key = 'company2')
     where id = (select id from wa_ctx where key = 'contact_late');

    -- free work: created with a legitimate holder, then released. The shared
    -- set_sales_id_default() is NEVER touched for this (25 §9.1, D-25).
    insert into public.tasks (company_id, type, text, due_date, sales_id)
    values (v_company, 'Anruf', 'Freie Arbeit', null, v_a)
    returning id into v_task;
    update public.tasks set sales_id = null where id = v_task;
    insert into wa_ctx values ('unassigned', v_task);

    -- completed work -------------------------------------------------------
    insert into public.tasks (company_id, type, text, due_date, sales_id, done_date)
    values (v_company, 'Anruf', 'A erledigt', v_today0 - interval '1 day', v_a, now())
    returning id into v_task;
    insert into wa_ctx values ('done_a', v_task);
    insert into public.tasks (company_id, type, text, due_date, sales_id, done_date)
    values (v_company, 'Anruf', 'B erledigt', null, v_b, now())
    returning id into v_task;
    insert into wa_ctx values ('done_b', v_task);

    -- INAKTIV != NICHT-EXISTENT (03 §2.2, 25 §9): work assigned while the
    -- employee was active stays assigned, and the holder must stay resolvable
    -- after deactivation. Only now is the employee disabled.
    insert into public.tasks (company_id, type, text, due_date, sales_id)
    values (v_company, 'Anruf', 'Arbeit eines deaktivierten Halters', null,
            (select id from wa_ctx where key = 'sale_disabled'))
    returning id into v_task;
    insert into wa_ctx values ('held_by_disabled', v_task);
    perform nora_private.apply_sales_role_change(
        (select id from wa_ctx where key = 'sale_disabled'), 'office', true);

    raise notice 'OK  fixtures: % employees, % tasks (% open / % done, % dated / % undated)',
        (select count(*) from wa_uid),
        (select count(*) from public.tasks),
        (select count(*) from public.tasks where done_date is null),
        (select count(*) from public.tasks where done_date is not null),
        (select count(*) from public.tasks where done_date is null and due_date is not null),
        (select count(*) from public.tasks where done_date is null and due_date is null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function pg_temp.wa_id(p_key text) returns bigint
language sql as $$ select id from wa_ctx where key = p_key $$;

create or replace function pg_temp.wa_wid(p_key text) returns uuid
language sql as $$ select public.nora_entity_uuid('task', id) from wa_ctx where key = p_key $$;

create or replace function pg_temp.wa_user(p_key text) returns uuid
language sql as $$ select uid from wa_uid where key = p_key $$;

create or replace function pg_temp.wa_sid(p_key text) returns uuid
language sql as $$ select sid from wa_uid where key = p_key $$;

-- Calls the RPC the way PostgREST does: JWT claims on the request and role
-- `authenticated`, so RLS and the SECURITY INVOKER boundary are real.
create or replace function pg_temp.wa_call(
    p_who text,
    p_scope text default 'mine',
    p_state text default 'open',
    p_limit integer default 200,
    p_cur_due timestamptz default null,
    p_cur_id uuid default null,
    p_role text default 'authenticated'
) returns jsonb
language plpgsql as $$
declare
    v_res jsonb;
begin
    perform set_config('request.jwt.claims',
        json_build_object('role', 'authenticated',
                          'sub', pg_temp.wa_user(p_who)::text,
                          'session_id', pg_temp.wa_sid(p_who)::text)::text, true);
    execute format('set local role %I', p_role);
    v_res := public.get_work_items(p_scope, p_state, p_limit, p_cur_due, p_cur_id);
    reset role;
    return v_res;
end;
$$;

-- Independent oracle for the frozen total order (25 §21.4, D-52), computed
-- outside the function under test.
create or replace function pg_temp.wa_oracle(p_holder bigint, p_state text)
returns uuid[]
language sql as $$
    select coalesce(array_agg(s.w order by s.d asc nulls last, s.w asc), '{}'::uuid[])
    from (
        select public.nora_entity_uuid('task', t.id) as w, t.due_date as d
        from public.tasks t
        where (p_state = 'all'
            or (p_state = 'open' and t.done_date is null)
            or (p_state = 'done' and t.done_date is not null))
          and (p_holder is null or t.sales_id = p_holder)
    ) s;
$$;

create or replace function pg_temp.wa_ids(p_res jsonb) returns uuid[]
language sql as $$
    select coalesce(array_agg((x.value ->> 'work_id')::uuid order by x.o), '{}'::uuid[])
    from jsonb_array_elements(p_res -> 'data') with ordinality as x(value, o);
$$;

-- Walks every page with the given page size and returns the concatenation.
create or replace function pg_temp.wa_walk(p_who text, p_scope text, p_state text, p_page integer)
returns uuid[]
language plpgsql as $$
declare
    v_ids     uuid[] := '{}'::uuid[];
    v_res     jsonb;
    v_cur_due timestamptz := null;
    v_cur_id  uuid := null;
    v_guard   integer := 0;
begin
    loop
        v_guard := v_guard + 1;
        if v_guard > 500 then
            raise exception 'K: runaway pagination at page size %', p_page;
        end if;
        v_res := pg_temp.wa_call(p_who, p_scope, p_state, p_page, v_cur_due, v_cur_id);
        if jsonb_array_length(v_res -> 'data') > p_page then
            raise exception 'K: page size % returned % rows', p_page, jsonb_array_length(v_res -> 'data');
        end if;
        v_ids := v_ids || pg_temp.wa_ids(v_res);
        exit when jsonb_typeof(v_res -> 'next_cursor') = 'null';
        if jsonb_array_length(v_res -> 'data') = 0 then
            raise exception 'K: an empty page announced a next cursor';
        end if;
        v_cur_due := (v_res -> 'next_cursor' ->> 'due_at')::timestamptz;
        v_cur_id  := (v_res -> 'next_cursor' ->> 'work_id')::uuid;
    end loop;
    return v_ids;
end;
$$;

create or replace function pg_temp.wa_row(p_res jsonb, p_key text) returns jsonb
language sql as $$
    select x.value from jsonb_array_elements(p_res -> 'data') x
    where (x.value ->> 'work_id')::uuid = pg_temp.wa_wid(p_key);
$$;

-- ---------------------------------------------------------------------------
-- B. Actor resolver
-- ---------------------------------------------------------------------------
do $$
declare
    v_failures text[] := '{}';
    v_a   bigint := pg_temp.wa_id('sale_officeA');
    v_got bigint;
begin
    -- active, session-bound employee resolves to exactly its own sales.id
    perform set_config('request.jwt.claims',
        json_build_object('role','authenticated','sub', pg_temp.wa_user('officeA')::text,
                          'session_id', pg_temp.wa_sid('officeA')::text)::text, true);
    v_got := nora_private.current_sales_id();
    if v_got is distinct from v_a then
        v_failures := v_failures || format('B: an active session resolved to %s instead of %s', v_got, v_a);
    end if;

    -- disabled employee: no actor
    perform set_config('request.jwt.claims',
        json_build_object('role','authenticated','sub', pg_temp.wa_user('disabled')::text,
                          'session_id', pg_temp.wa_sid('disabled')::text)::text, true);
    if nora_private.current_sales_id() is not null then
        v_failures := array_append(v_failures, 'B: a disabled employee resolved to an actor');
    end if;

    -- revoked session: no actor
    perform set_config('request.jwt.claims',
        json_build_object('role','authenticated','sub', pg_temp.wa_user('revoked')::text,
                          'session_id', pg_temp.wa_sid('revoked')::text)::text, true);
    if nora_private.current_sales_id() is not null then
        v_failures := array_append(v_failures, 'B: a revoked session resolved to an actor');
    end if;

    -- another employee's live session: no actor (owner binding, W6-A)
    perform set_config('request.jwt.claims',
        json_build_object('role','authenticated','sub', pg_temp.wa_user('officeA')::text,
                          'session_id', pg_temp.wa_sid('officeB')::text)::text, true);
    if nora_private.current_sales_id() is not null then
        v_failures := array_append(v_failures, 'B: a foreign session resolved to an actor');
    end if;

    -- identity without a sales row: no actor
    perform set_config('request.jwt.claims',
        json_build_object('role','authenticated','sub', gen_random_uuid()::text,
                          'session_id', gen_random_uuid()::text)::text, true);
    if nora_private.current_sales_id() is not null then
        v_failures := array_append(v_failures, 'B: an unknown identity resolved to an actor');
    end if;

    -- malformed sub: no actor, and above all NOT somebody else's
    perform set_config('request.jwt.claims',
        json_build_object('role','authenticated','sub','not-a-uuid',
                          'session_id', pg_temp.wa_sid('officeA')::text)::text, true);
    if nora_private.current_sales_id() is not null then
        v_failures := array_append(v_failures, 'B: a malformed identity resolved to an actor');
    end if;

    -- no JWT at all: no actor
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.session_id', '', true);
    if nora_private.current_sales_id() is not null then
        v_failures := array_append(v_failures, 'B: a request without a JWT resolved to an actor');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL:\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  B. actor resolver: active binds; disabled/revoked/foreign/unknown/malformed/absent do not';
end;
$$;

-- ---------------------------------------------------------------------------
-- C. Access matrix through the RPC
-- ---------------------------------------------------------------------------
do $$
declare
    v_failures text[] := '{}';
    r          record;
    v_res      jsonb;
    v_state    text;
    v_detail   text;
begin
    -- permitted: every active employee sees Team work (Tasks select active has
    -- no ownership predicate, 25 §15 / D-38)
    for r in select unnest(array['viewer','officeA','officeB','admin']) as who loop
        begin
            v_res := pg_temp.wa_call(r.who, 'team', 'open', 200);
            if jsonb_array_length(v_res -> 'data') = 0 then
                v_failures := v_failures || format('C: %s saw no Team work', r.who);
            end if;
        exception when others then
            reset role;
            v_failures := v_failures || format('C: %s was denied (%s)', r.who, sqlstate);
        end;
    end loop;

    -- denied: disabled employee and revoked session
    for r in select unnest(array['disabled','revoked']) as who loop
        v_state := null;
        v_detail := null;
        begin
            v_res := pg_temp.wa_call(r.who, 'team', 'open', 200);
        exception when others then
            reset role;
            get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
        end;
        if v_state is null then
            v_failures := v_failures || format('C: %s was NOT denied', r.who);
        elsif v_state <> '42501' then
            v_failures := v_failures || format('C: %s was refused with %s instead of 42501', r.who, v_state);
        elsif coalesce(v_detail, '') <> 'NORA_PERMISSION_DENIED' then
            v_failures := v_failures || format('C: %s was refused with DETAIL %L instead of NORA_PERMISSION_DENIED', r.who, v_detail);
        end if;
    end loop;

    -- anon and service_role hold no EXECUTE at all
    for r in select unnest(array['anon','service_role']) as api_role loop
        v_state := null;
        begin
            v_res := pg_temp.wa_call('officeA', 'team', 'open', 200, null, null, r.api_role);
        exception when others then
            reset role;
            get stacked diagnostics v_state = returned_sqlstate;
        end;
        if v_state is null then
            v_failures := v_failures || format('C: %s could EXECUTE public.get_work_items', r.api_role);
        elsif v_state <> '42501' then
            v_failures := v_failures || format('C: %s was refused with %s instead of 42501', r.api_role, v_state);
        end if;
    end loop;

    -- the resolver itself is unreachable for anon / service_role
    for r in select unnest(array['anon','service_role']) as api_role loop
        v_state := null;
        begin
            execute format('set local role %I', r.api_role);
            perform nora_private.current_sales_id();
            reset role;
        exception when others then
            reset role;
            get stacked diagnostics v_state = returned_sqlstate;
        end;
        if v_state is null then
            v_failures := v_failures || format('C: %s could EXECUTE nora_private.current_sales_id', r.api_role);
        end if;
    end loop;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL:\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  C. access: viewer/office/admin permitted; disabled, revoked, anon, service_role denied';
end;
$$;

-- ---------------------------------------------------------------------------
-- D. Scope — mine vs team through the SAME RPC
-- ---------------------------------------------------------------------------
do $$
declare
    v_failures text[] := '{}';
    v_a    bigint := pg_temp.wa_id('sale_officeA');
    v_b    bigint := pg_temp.wa_id('sale_officeB');
    v_res  jsonb;
    v_resb jsonb;
    e      jsonb;
begin
    -- Mine(A) = exactly A's open work
    v_res := pg_temp.wa_call('officeA', 'mine', 'open', 200);
    if pg_temp.wa_ids(v_res) is distinct from pg_temp.wa_oracle(v_a, 'open') then
        v_failures := array_append(v_failures, 'D: Mine(A) is not exactly A''s open work');
    end if;
    for e in select x.value from jsonb_array_elements(v_res -> 'data') x loop
        if (e ->> 'is_mine')::boolean is not true then
            v_failures := v_failures || format('D: Mine(A) contains a row with is_mine = %s', e ->> 'is_mine');
        end if;
        if (e -> 'holder' ->> 'sales_id')::bigint is distinct from v_a then
            v_failures := array_append(v_failures, 'D: Mine(A) contains a row held by somebody else');
        end if;
    end loop;

    -- Mine(B) is a different, disjoint set — from the SAME RPC
    v_resb := pg_temp.wa_call('officeB', 'mine', 'open', 200);
    if pg_temp.wa_ids(v_resb) is distinct from pg_temp.wa_oracle(v_b, 'open') then
        v_failures := array_append(v_failures, 'D: Mine(B) is not exactly B''s open work');
    end if;
    if pg_temp.wa_ids(v_resb) && pg_temp.wa_ids(v_res) then
        v_failures := array_append(v_failures, 'D: Mine(A) and Mine(B) overlap');
    end if;

    -- Team(A) = everything Nora security shows A
    v_res := pg_temp.wa_call('officeA', 'team', 'open', 200);
    if pg_temp.wa_ids(v_res) is distinct from pg_temp.wa_oracle(null, 'open') then
        v_failures := array_append(v_failures, 'D: Team(A) is not every visible open work item');
    end if;
    v_resb := pg_temp.wa_call('officeB', 'team', 'open', 200);
    if pg_temp.wa_ids(v_resb) is distinct from pg_temp.wa_ids(v_res) then
        v_failures := array_append(v_failures, 'D: Team differs per actor although v1 defines no service-area scoping');
    end if;
    -- is_mine is actor-relative inside the same Team set
    if (pg_temp.wa_row(v_res,  'd_day_end') ->> 'is_mine')::boolean is not false then
        v_failures := array_append(v_failures, 'D: B''s work is is_mine for A in the Team view');
    end if;
    if (pg_temp.wa_row(v_resb, 'd_day_end') ->> 'is_mine')::boolean is not true then
        v_failures := array_append(v_failures, 'D: B''s work is not is_mine for B in the Team view');
    end if;
    -- the default scope is 'mine'
    if pg_temp.wa_call('officeA', null, 'open', 200) ->> 'scope' <> 'mine' then
        v_failures := array_append(v_failures, 'D: the default p_scope is not "mine"');
    end if;

    -- unknown scope values are a client error, not a silent default
    begin
        v_res := pg_temp.wa_call('officeA', 'everything', 'open', 200);
        v_failures := array_append(v_failures, 'D: an unknown p_scope was accepted');
    exception when others then
        reset role;
        if sqlstate <> '22023' then
            v_failures := v_failures || format('D: an unknown p_scope raised %s instead of 22023', sqlstate);
        end if;
    end;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL:\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  D. scope: mine vs team from one RPC, actor-relative is_mine, 22023 on an unknown scope';
end;
$$;

-- ---------------------------------------------------------------------------
-- E. State scope — default open, explicit done, explicit all
-- ---------------------------------------------------------------------------
do $$
declare
    v_failures text[] := '{}';
    v_res jsonb;
    e     jsonb;
begin
    -- default: open only, and the envelope says so
    v_res := pg_temp.wa_call('officeA', 'team', null, 200);
    if v_res ->> 'state_scope' <> 'open' then
        v_failures := v_failures || format('E: the default state_scope is %L', v_res ->> 'state_scope');
    end if;
    if pg_temp.wa_ids(v_res) is distinct from pg_temp.wa_oracle(null, 'open') then
        v_failures := array_append(v_failures, 'E: the default scope is not exactly the open work');
    end if;
    if pg_temp.wa_row(v_res, 'done_a') is not null or pg_temp.wa_row(v_res, 'done_b') is not null then
        v_failures := array_append(v_failures, 'E: completed work appeared in the default basket');
    end if;
    for e in select x.value from jsonb_array_elements(v_res -> 'data') x loop
        if e ->> 'state' <> 'open' then
            v_failures := array_append(v_failures, 'E: the default basket contains a non-open row');
        end if;
    end loop;

    -- Mine default excludes done as well (criterion 6)
    if pg_temp.wa_row(pg_temp.wa_call('officeA', 'mine', 'open', 200), 'done_a') is not null then
        v_failures := array_append(v_failures, 'E: Mine(A) default contains completed work');
    end if;

    -- explicit done
    v_res := pg_temp.wa_call('officeA', 'team', 'done', 200);
    if pg_temp.wa_ids(v_res) is distinct from pg_temp.wa_oracle(null, 'done') then
        v_failures := array_append(v_failures, 'E: the done scope is not exactly the completed work');
    end if;
    for e in select x.value from jsonb_array_elements(v_res -> 'data') x loop
        if e ->> 'state' <> 'done' then
            v_failures := array_append(v_failures, 'E: the done scope contains a non-done row');
        end if;
        if (e ->> 'actionable')::boolean is not false then
            v_failures := array_append(v_failures, 'E: a completed row is actionable');
        end if;
    end loop;

    -- explicit all
    v_res := pg_temp.wa_call('officeA', 'team', 'all', 200);
    if pg_temp.wa_ids(v_res) is distinct from pg_temp.wa_oracle(null, 'all') then
        v_failures := array_append(v_failures, 'E: the all scope is not the whole visible carrier');
    end if;
    if jsonb_array_length(v_res -> 'data') <> (select count(*)::int from public.tasks) then
        v_failures := array_append(v_failures, 'E: the all scope does not cover every task row');
    end if;

    -- unknown state scope
    begin
        v_res := pg_temp.wa_call('officeA', 'team', 'cancelled', 200);
        v_failures := array_append(v_failures, 'E: an unknown p_state_scope was accepted');
    exception when others then
        reset role;
        if sqlstate <> '22023' then
            v_failures := v_failures || format('E: an unknown p_state_scope raised %s instead of 22023', sqlstate);
        end if;
    end;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL:\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  E. state scope: open by default, explicit done, explicit all, 22023 on an unknown value';
end;
$$;

-- ---------------------------------------------------------------------------
-- F. Row validity — incomplete rows stay in the open basket
-- ---------------------------------------------------------------------------
do $$
declare
    v_failures text[] := '{}';
    r          record;
    v_res      jsonb := pg_temp.wa_call('officeA', 'mine', 'open', 200);
    e          jsonb;
begin
    for r in select unnest(array['n_null','n_empty','n_blank']) as key loop
        e := pg_temp.wa_row(v_res, r.key);
        if e is null then
            v_failures := v_failures || format('F: the incomplete row %s was filtered out of the open basket', r.key);
            continue;
        end if;
        if jsonb_typeof(e -> 'title') <> 'null' then
            v_failures := v_failures || format('F: %s has title %s instead of null', r.key, e -> 'title');
        end if;
        if e ->> 'validity' <> 'incomplete' then
            v_failures := v_failures || format('F: %s has validity %L', r.key, e ->> 'validity');
        end if;
        if e ->> 'invalid_reason' <> 'missing_title' then
            v_failures := v_failures || format('F: %s has invalid_reason %L', r.key, e ->> 'invalid_reason');
        end if;
        if (e ->> 'actionable')::boolean is not false then
            v_failures := v_failures || format('F: %s is actionable', r.key);
        end if;
        if e ->> 'state' <> 'open' then
            v_failures := v_failures || format('F: %s is not open', r.key);
        end if;
    end loop;

    -- negative control: a padded but non-empty title stays byte-identical
    e := pg_temp.wa_row(v_res, 'n_padded');
    if e is null then
        v_failures := array_append(v_failures, 'F: the padded-title row is missing');
    else
        if e ->> 'title' <> '  foo  ' then
            v_failures := v_failures || format('F: the padded title was normalised to %L', e ->> 'title');
        end if;
        if e ->> 'title' is distinct from (select t.text from public.tasks t where t.id = pg_temp.wa_id('n_padded')) then
            v_failures := array_append(v_failures, 'F: the emitted title is not byte-identical to the persisted value');
        end if;
        if e ->> 'validity' <> 'valid' or jsonb_typeof(e -> 'invalid_reason') <> 'null' then
            v_failures := array_append(v_failures, 'F: the padded title was judged incomplete');
        end if;
        if (e ->> 'actionable')::boolean is not true then
            v_failures := array_append(v_failures, 'F: the padded-title row is not actionable');
        end if;
    end if;

    -- validity is never a filter: the open basket carries both states (D-43)
    if not exists (select 1 from jsonb_array_elements(v_res -> 'data') x where x.value ->> 'validity' = 'incomplete')
       or not exists (select 1 from jsonb_array_elements(v_res -> 'data') x where x.value ->> 'validity' = 'valid') then
        v_failures := array_append(v_failures, 'F: the open basket does not carry both validity states');
    end if;

    -- an incomplete row also stays reachable through the explicit all scope
    if pg_temp.wa_row(pg_temp.wa_call('officeA', 'team', 'all', 200), 'n_blank') is null then
        v_failures := array_append(v_failures, 'F: an incomplete row disappeared from the all scope');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL:\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  F. incomplete rows stay visible and machine-readable; a padded title is untouched';
end;
$$;

-- ---------------------------------------------------------------------------
-- G. Unassigned work
-- ---------------------------------------------------------------------------
do $$
declare
    v_failures text[] := '{}';
    v_team jsonb := pg_temp.wa_call('officeA', 'team', 'open', 200);
    v_mine jsonb := pg_temp.wa_call('officeA', 'mine', 'open', 200);
    e      jsonb := pg_temp.wa_row(v_team, 'unassigned');
    v_src  text;
begin
    if e is null then
        v_failures := array_append(v_failures, 'G: free work is missing from the Team view');
    else
        if (e ->> 'is_unassigned')::boolean is not true then
            v_failures := array_append(v_failures, 'G: free work is not is_unassigned');
        end if;
        if (e ->> 'is_mine')::boolean is not false then
            v_failures := array_append(v_failures, 'G: free work is is_mine');
        end if;
        if jsonb_typeof(e -> 'holder') <> 'null' then
            v_failures := v_failures || format('G: free work carries a holder: %s', e -> 'holder');
        end if;
    end if;
    if pg_temp.wa_row(v_mine, 'unassigned') is not null then
        v_failures := array_append(v_failures, 'G: free work appeared in Mine');
    end if;

    -- every held row reports is_unassigned = false and a resolvable identity
    if exists (select 1 from jsonb_array_elements(v_team -> 'data') x
                where jsonb_typeof(x.value -> 'holder') <> 'null'
                  and (x.value ->> 'is_unassigned')::boolean is not false) then
        v_failures := array_append(v_failures, 'G: a held row reports is_unassigned = true');
    end if;
    if exists (select 1 from jsonb_array_elements(v_team -> 'data') x
                where jsonb_typeof(x.value -> 'holder') <> 'null'
                  and (x.value -> 'holder' -> 'sales_id') is null) then
        v_failures := array_append(v_failures, 'G: a holder was emitted without its sales_id identity');
    end if;
    -- the display name is resolved from sales_identities, never invented
    if (pg_temp.wa_row(v_team, 'd_day_end') -> 'holder' ->> 'display_name')
       is distinct from (select btrim(s.first_name || ' ' || s.last_name) from public.sales s
                          where s.id = pg_temp.wa_id('sale_officeB')) then
        v_failures := array_append(v_failures, 'G: the holder display name does not come from the identity projection');
    end if;

    -- INAKTIV != NICHT-EXISTENT: a deactivated employee stays a resolvable
    -- holder (25 §9 / §13; sales_identities, never sales_directory)
    e := pg_temp.wa_row(v_team, 'held_by_disabled');
    if e is null then
        v_failures := array_append(v_failures, 'G: work held by a deactivated employee disappeared from the Team view');
    else
        if (e -> 'holder' ->> 'sales_id')::bigint is distinct from pg_temp.wa_id('sale_disabled') then
            v_failures := array_append(v_failures, 'G: the deactivated holder lost its identity');
        end if;
        if (e -> 'holder' ->> 'display_name')
           is distinct from (select btrim(s.first_name || ' ' || s.last_name) from public.sales s
                              where s.id = pg_temp.wa_id('sale_disabled')) then
            v_failures := array_append(v_failures,
                'G: a deactivated holder is not resolvable — the projection reads sales_directory (active only) instead of sales_identities');
        end if;
        if (e ->> 'is_unassigned')::boolean is not false or (e ->> 'is_mine')::boolean is not false then
            v_failures := array_append(v_failures, 'G: work of a deactivated holder is reported as free or as mine');
        end if;
    end if;
    if not (select s.disabled from public.sales s where s.id = pg_temp.wa_id('sale_disabled')) then
        v_failures := array_append(v_failures, 'G: the deactivated-holder fixture is not actually deactivated');
    end if;

    -- the shared creation default was NOT changed to make free work possible
    select p.prosrc into v_src from pg_proc p where p.oid = to_regprocedure('public.set_sales_id_default()');
    if v_src is null or position('new.sales_id is null' in v_src) = 0 or position('auth.uid()' in v_src) = 0 then
        v_failures := array_append(v_failures, 'G: public.set_sales_id_default() was changed — forbidden by D-25');
    end if;
    if (select count(*) from pg_trigger t
         where t.tgfoid = to_regprocedure('public.set_sales_id_default()') and not t.tgisinternal) < 2 then
        v_failures := array_append(v_failures, 'G: set_sales_id_default() is no longer shared between tasks and deals');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL:\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  G. free work: in Team, not in Mine, holder null, shared default untouched';
end;
$$;

-- ---------------------------------------------------------------------------
-- H. Nullable due date and NULLS LAST
-- ---------------------------------------------------------------------------
do $$
declare
    v_failures   text[] := '{}';
    v_res        jsonb := pg_temp.wa_call('officeA', 'team', 'open', 200);
    e            jsonb;
    v_first_null integer;
    v_last_dated integer;
begin
    e := pg_temp.wa_row(v_res, 'n_plain');
    if e is null then
        v_failures := array_append(v_failures, 'H: undated work is missing');
    else
        if jsonb_typeof(e -> 'due_at') <> 'null' then
            v_failures := array_append(v_failures, 'H: undated work does not report due_at = null');
        end if;
        if (e ->> 'overdue')::boolean is not false or (e ->> 'due_today')::boolean is not false then
            v_failures := array_append(v_failures, 'H: undated work carries an attention signal');
        end if;
        if (e ->> 'actionable')::boolean is not true then
            v_failures := array_append(v_failures, 'H: undated work is not actionable — due_at = null is a valid Work state (D-9)');
        end if;
    end if;

    select min(x.o) into v_first_null
      from jsonb_array_elements(v_res -> 'data') with ordinality as x(value, o)
     where jsonb_typeof(x.value -> 'due_at') = 'null';
    select max(x.o) into v_last_dated
      from jsonb_array_elements(v_res -> 'data') with ordinality as x(value, o)
     where jsonb_typeof(x.value -> 'due_at') <> 'null';
    if v_first_null is null or v_last_dated is null then
        v_failures := array_append(v_failures, 'H: the fixture set has no dated/undated boundary to check');
    elsif v_first_null < v_last_dated then
        v_failures := v_failures || format('H: an undated row (position %s) sorts before a dated row (position %s) — NULLS LAST is broken',
            v_first_null, v_last_dated);
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL:\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  H. due_at = null: no attention signal, sorted last, still actionable';
end;
$$;

-- ---------------------------------------------------------------------------
-- I. Europe/Berlin business-day semantics
-- ---------------------------------------------------------------------------
do $$
declare
    v_failures text[] := '{}';
    v_res   jsonb := pg_temp.wa_call('officeA', 'team', 'open', 200);
    v_today date := (now() at time zone 'Europe/Berlin')::date;
    r       record;
    e       jsonb;
begin
    -- The Berlin-day boundary cases. Their expectation comes from the way the
    -- fixture was CONSTRUCTED (Berlin wall-clock), not from re-running the
    -- function's own conversion.
    for r in
        select * from (values
            ('d_overdue',   true,  false),   -- three days ago, 09:00 Berlin
            ('d_yesterday', true,  false),   -- last microsecond of yesterday, Berlin
            ('d_day_start', false, true ),   -- 00:00:00.000000 Berlin today
            ('d_day_end',   false, true ),   -- last microsecond of today, Berlin
            ('d_tomorrow',  false, false)    -- 00:00:00.000000 Berlin tomorrow
        ) as t(key, overdue, due_today)
    loop
        e := pg_temp.wa_row(v_res, r.key);
        if e is null then
            v_failures := v_failures || format('I: %s is missing', r.key);
            continue;
        end if;
        if (e ->> 'overdue')::boolean is distinct from r.overdue
           or (e ->> 'due_today')::boolean is distinct from r.due_today then
            v_failures := v_failures || format('I: %s reported overdue=%s due_today=%s (expected %s / %s)',
                r.key, e ->> 'overdue', e ->> 'due_today', r.overdue, r.due_today);
        end if;
    end loop;

    -- UTC -> Berlin rollover: today's Berlin midnight is YESTERDAY in UTC and
    -- must still be "due today".
    if ((select t.due_date from public.tasks t where t.id = pg_temp.wa_id('d_day_start')) at time zone 'UTC')::date
       >= v_today then
        v_failures := array_append(v_failures,
            'I: the day-start fixture does not actually cross the UTC day boundary — the rollover would be untested');
    end if;

    -- The DST fixtures really straddle a transition: 00:30 -> 03:30 Berlin on
    -- 2026-03-29 is TWO real hours, and 00:30 -> 00:30 across 2026-10-25/26 is
    -- TWENTY-FIVE. If the zone data ever changed, this fails loudly instead of
    -- silently weakening the day assertions below.
    if make_timestamptz(2026, 3, 29, 3, 30, 0, 'Europe/Berlin')
     - make_timestamptz(2026, 3, 29, 0, 30, 0, 'Europe/Berlin') <> interval '2 hours' then
        v_failures := array_append(v_failures, 'I: the spring DST fixture does not straddle the transition');
    end if;
    if make_timestamptz(2026, 10, 26, 0, 30, 0, 'Europe/Berlin')
     - make_timestamptz(2026, 10, 25, 0, 30, 0, 'Europe/Berlin') <> interval '25 hours' then
        v_failures := array_append(v_failures, 'I: the autumn DST fixture does not straddle the transition');
    end if;

    -- Each DST fixture is judged against the Berlin day it was built for,
    -- although its UTC day differs.
    for r in
        select * from (values
            ('dst_spring_before', date '2026-03-29'),
            ('dst_spring_after',  date '2026-03-29'),
            ('dst_autumn_before', date '2026-10-25'),
            ('dst_autumn_after',  date '2026-10-26')
        ) as t(key, berlin_day)
    loop
        e := pg_temp.wa_row(v_res, r.key);
        if e is null then
            v_failures := v_failures || format('I: %s is missing', r.key);
            continue;
        end if;
        if (e ->> 'overdue')::boolean is distinct from (r.berlin_day < v_today)
           or (e ->> 'due_today')::boolean is distinct from (r.berlin_day = v_today) then
            v_failures := v_failures || format('I: %s (Berlin day %s) reported overdue=%s due_today=%s',
                r.key, r.berlin_day, e ->> 'overdue', e ->> 'due_today');
        end if;
    end loop;
    -- and the two that cross it really do carry a different UTC day
    if ((select t.due_date from public.tasks t where t.id = pg_temp.wa_id('dst_spring_before')) at time zone 'UTC')::date
       <> date '2026-03-28' then
        v_failures := array_append(v_failures, 'I: the spring-before fixture does not cross the UTC day boundary');
    end if;
    if ((select t.due_date from public.tasks t where t.id = pg_temp.wa_id('dst_autumn_after')) at time zone 'UTC')::date
       <> date '2026-10-25' then
        v_failures := array_append(v_failures, 'I: the autumn-after fixture does not cross the UTC day boundary');
    end if;

    -- due_precision is the constant 'unknown' everywhere (25 §7.6, D-19); no
    -- clock heuristic promotes a Berlin midnight to 'day'
    if exists (select 1 from jsonb_array_elements(pg_temp.wa_call('officeA','team','all',200) -> 'data') x
                where x.value ->> 'due_precision' is distinct from 'unknown') then
        v_failures := array_append(v_failures, 'I: a row reported a due_precision other than "unknown"');
    end if;

    -- under the unknown/business-day rule the two signals are mutually exclusive
    if exists (select 1 from jsonb_array_elements(v_res -> 'data') x
                where (x.value ->> 'overdue')::boolean and (x.value ->> 'due_today')::boolean) then
        v_failures := array_append(v_failures,
            'I: a row is overdue AND due today although due_precision = unknown follows the business-day rule');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL:\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  I. Europe/Berlin business day incl. UTC rollover and both DST transitions';
end;
$$;

-- ---------------------------------------------------------------------------
-- J. Deterministic total order
-- ---------------------------------------------------------------------------
do $$
declare
    v_failures text[] := '{}';
    v_res      jsonb  := pg_temp.wa_call('officeA', 'team', 'all', 200);
    v_got      uuid[] := pg_temp.wa_ids(v_res);
    v_tie      uuid[];
    v_sorted   uuid[];
    v_src      text;
    v_pos      integer;
    v_open     uuid[] := pg_temp.wa_oracle(null, 'open');
begin
    if v_got is distinct from pg_temp.wa_oracle(null, 'all') then
        v_failures := array_append(v_failures, 'J: the emitted order differs from due_at ASC NULLS LAST, work_id ASC');
    end if;

    -- The frozen total order (D-52) must be literally present in BOTH ordered
    -- clauses of the installed query: the window that numbers the rows AND the
    -- ORDER BY that carries the LIMIT. With the tie-break in only one of them
    -- the page boundary may cut an equal-due group differently from the order
    -- the rows are emitted in — a defect a small fixture set does not reliably
    -- surface, so it is asserted structurally as well as behaviourally.
    select p.prosrc into v_src
      from pg_proc p where p.oid = to_regprocedure('public.get_work_items(text,text,integer,timestamptz,uuid)');
    if (select count(*) from regexp_matches(v_src,
            'row_number\(\) over \(order by b\.due_at asc nulls last, b\.work_id asc\)', 'g')) <> 1 then
        v_failures := array_append(v_failures, 'J: the row numbering does not use due_at ASC NULLS LAST, work_id ASC');
    end if;
    if (select count(*) from regexp_matches(v_src,
            'order by b\.due_at asc nulls last, b\.work_id asc\s*\n\s*limit ', 'g')) <> 1 then
        v_failures := array_append(v_failures, 'J: the LIMIT is not carried by the frozen total order — a tie group could be cut arbitrarily');
    end if;
    -- D-52: keyset only, never OFFSET
    if v_src ~* '\moffset\M' then
        v_failures := array_append(v_failures, 'J: the query uses OFFSET — pagination must be keyset only (D-52)');
    end if;

    -- a page boundary that lands INSIDE the equal-due group must cut it at the
    -- smallest work_id, not at an arbitrary member
    select array_agg(w order by w) into v_tie
      from unnest(array[pg_temp.wa_wid('tie_1'), pg_temp.wa_wid('tie_2'), pg_temp.wa_wid('tie_3')]) w;
    select x.o into v_pos from unnest(v_open) with ordinality as x(w, o) where x.w = v_tie[1];
    if v_pos is null then
        v_failures := array_append(v_failures, 'J: the tie group is not part of the open basket');
    else
        if (pg_temp.wa_ids(pg_temp.wa_call('officeA', 'team', 'open', v_pos)))[v_pos] is distinct from v_tie[1] then
            v_failures := array_append(v_failures, 'J: a page ending inside the tie group does not end at its smallest work_id');
        end if;
        if (pg_temp.wa_ids(pg_temp.wa_call('officeA', 'team', 'open', v_pos + 1)))[v_pos + 1] is distinct from v_tie[2] then
            v_failures := array_append(v_failures, 'J: the next page boundary inside the tie group does not continue at the second work_id');
        end if;
    end if;

    -- the tie group: three rows with byte-identical due_date must come out in
    -- work_id ASC order and be contiguous
    select array_agg((x.value ->> 'work_id')::uuid order by x.o) into v_tie
      from jsonb_array_elements(v_res -> 'data') with ordinality as x(value, o)
     where (x.value ->> 'work_id')::uuid in (pg_temp.wa_wid('tie_1'), pg_temp.wa_wid('tie_2'), pg_temp.wa_wid('tie_3'));
    select array_agg(w order by w) into v_sorted from unnest(v_tie) w;
    if coalesce(cardinality(v_tie), 0) <> 3 then
        v_failures := array_append(v_failures, 'J: the equal-due tie group is incomplete');
    elsif v_tie is distinct from v_sorted then
        v_failures := array_append(v_failures, 'J: the equal-due tie group is not ordered by work_id ASC');
    elsif (select max(x.o) - min(x.o) from jsonb_array_elements(v_res -> 'data') with ordinality as x(value, o)
            where (x.value ->> 'work_id')::uuid = any(v_tie)) <> 2 then
        v_failures := array_append(v_failures, 'J: the equal-due tie group is not contiguous');
    end if;

    -- repeated calls are identical (no nondeterminism from the plan)
    if pg_temp.wa_ids(pg_temp.wa_call('officeA', 'team', 'all', 200)) is distinct from v_got then
        v_failures := array_append(v_failures, 'J: two identical calls returned different orders');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL:\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  J. total order incl. the work_id tie-break and call-to-call determinism';
end;
$$;

-- ---------------------------------------------------------------------------
-- K. Keyset pagination
-- ---------------------------------------------------------------------------
do $$
declare
    v_failures text[] := '{}';
    r          record;
    v_page     integer;
    v_oracle   uuid[];
    v_walk     uuid[];
    v_res      jsonb;
    v_dated    integer := (select count(*)::int from public.tasks where done_date is null and due_date is not null);
    v_undated  integer := (select count(*)::int from public.tasks where done_date is null and due_date is null);
    v_cur_due  timestamptz;
    v_cur_id   uuid;
    v_first    jsonb;
    v_tail     uuid[];
    v_tie      uuid[];
    v_tie_due  timestamptz := (select t.due_date from public.tasks t where t.id = pg_temp.wa_id('tie_1'));
begin
    -- K6/K7 — every page size reproduces the oracle exactly: no gaps, no
    -- duplicates, no reordering, over an unchanged row set.
    for r in
        select * from (values
            ('team', 'open'), ('team', 'all'), ('team', 'done'), ('mine', 'open'), ('mine', 'all')
        ) as t(scope, state)
    loop
        v_oracle := pg_temp.wa_oracle(case when r.scope = 'mine' then pg_temp.wa_id('sale_officeA') end, r.state);
        foreach v_page in array array[1, 2, 3, 5, 7, 200] loop
            v_walk := pg_temp.wa_walk('officeA', r.scope, r.state, v_page);
            if v_walk is distinct from v_oracle then
                v_failures := v_failures || format('K: %s/%s at page size %s did not reproduce the total order (%s vs %s rows)',
                    r.scope, r.state, v_page, coalesce(cardinality(v_walk), 0), coalesce(cardinality(v_oracle), 0));
            end if;
            if coalesce(cardinality(v_walk), 0) <> (select count(distinct w) from unnest(v_walk) w) then
                v_failures := v_failures || format('K: %s/%s at page size %s returned duplicates', r.scope, r.state, v_page);
            end if;
        end loop;
    end loop;

    -- K1 — a cursor between two dated rows continues with dated rows
    v_res := pg_temp.wa_call('officeA', 'team', 'open', 2);
    if jsonb_typeof(v_res -> 'next_cursor') = 'null'
       or jsonb_typeof(v_res -> 'next_cursor' -> 'due_at') = 'null' then
        v_failures := array_append(v_failures, 'K1: the first page of the dated head produced no dated cursor');
    else
        v_cur_due := (v_res -> 'next_cursor' ->> 'due_at')::timestamptz;
        v_cur_id  := (v_res -> 'next_cursor' ->> 'work_id')::uuid;
        v_res := pg_temp.wa_call('officeA', 'team', 'open', 2, v_cur_due, v_cur_id);
        v_first := v_res -> 'data' -> 0;
        if jsonb_typeof(v_first -> 'due_at') = 'null' then
            v_failures := array_append(v_failures, 'K1: a non-null cursor jumped straight into the NULL tail');
        elsif (v_first ->> 'due_at')::timestamptz < v_cur_due then
            v_failures := array_append(v_failures, 'K1: a non-null cursor went backwards');
        end if;
    end if;

    -- K2 — a page boundary INSIDE the equal-due tie group continues at the next
    --      work_id of that same group, not at the next due date
    select array_agg(w order by w) into v_tie
      from unnest(array[pg_temp.wa_wid('tie_1'), pg_temp.wa_wid('tie_2'), pg_temp.wa_wid('tie_3')]) w;
    v_res := pg_temp.wa_call('officeA', 'mine', 'open', 1, v_tie_due, v_tie[1]);
    if (v_res -> 'data' -> 0 ->> 'work_id')::uuid is distinct from v_tie[2] then
        v_failures := array_append(v_failures, 'K2: a cursor inside the equal-due tie group skipped the rest of the group');
    end if;
    v_res := pg_temp.wa_call('officeA', 'mine', 'open', 1, v_tie_due, v_tie[2]);
    if (v_res -> 'data' -> 0 ->> 'work_id')::uuid is distinct from v_tie[3] then
        v_failures := array_append(v_failures, 'K2: the second boundary inside the tie group did not continue at the third row');
    end if;

    -- K3 — the cursor on the last dated row crosses into the NULL tail
    v_res := pg_temp.wa_call('officeA', 'team', 'open', v_dated);
    if jsonb_array_length(v_res -> 'data') <> v_dated then
        v_failures := array_append(v_failures, 'K3: the dated head was not returned in one page');
    end if;
    if jsonb_typeof(v_res -> 'next_cursor') = 'null' then
        v_failures := array_append(v_failures, 'K3: the dated head announced no next page although undated work follows');
    else
        v_cur_due := (v_res -> 'next_cursor' ->> 'due_at')::timestamptz;
        v_cur_id  := (v_res -> 'next_cursor' ->> 'work_id')::uuid;
        if v_cur_due is null then
            v_failures := array_append(v_failures, 'K3: the cursor of the dated head has no due_at');
        end if;
        v_res := pg_temp.wa_call('officeA', 'team', 'open', 200, v_cur_due, v_cur_id);
        if exists (select 1 from jsonb_array_elements(v_res -> 'data') x where jsonb_typeof(x.value -> 'due_at') <> 'null') then
            v_failures := array_append(v_failures, 'K3: the page after the dated head still contains dated rows');
        end if;
        if jsonb_array_length(v_res -> 'data') <> v_undated then
            v_failures := array_append(v_failures, 'K3: the NULL tail is incomplete after crossing the boundary');
        end if;
    end if;

    -- K4 — a cursor INSIDE the NULL tail (due_at = null, work_id set) is valid
    --      and returns exactly the remaining tail
    select array_agg(w order by w) into v_tail
      from (select public.nora_entity_uuid('task', t.id) as w from public.tasks t
             where t.done_date is null and t.due_date is null) s(w);
    v_res := pg_temp.wa_call('officeA', 'team', 'open', 200, null, v_tail[1]);
    if pg_temp.wa_ids(v_res) is distinct from v_tail[2:cardinality(v_tail)] then
        v_failures := array_append(v_failures, 'K4: a NULL -> NULL cursor did not return exactly the remaining tail');
    end if;

    -- K5 — the final page announces no next cursor, and a cursor past the end
    --      returns nothing rather than restarting
    v_res := pg_temp.wa_call('officeA', 'team', 'open', 200, null, v_tail[cardinality(v_tail)]);
    if jsonb_array_length(v_res -> 'data') <> 0 then
        v_failures := array_append(v_failures, 'K5: a cursor on the last row returned further rows');
    end if;
    if jsonb_typeof(v_res -> 'next_cursor') <> 'null' then
        v_failures := array_append(v_failures, 'K5: the empty final page announced a next cursor');
    end if;
    v_res := pg_temp.wa_call('officeA', 'team', 'open', 200);
    if jsonb_typeof(v_res -> 'next_cursor') <> 'null' then
        v_failures := array_append(v_failures, 'K5: a page that holds every row announced a next cursor');
    end if;
    -- an exactly-full page that has nothing after it also reports no cursor
    v_res := pg_temp.wa_call('officeA', 'team', 'open', v_dated + v_undated);
    if jsonb_typeof(v_res -> 'next_cursor') <> 'null' then
        v_failures := array_append(v_failures, 'K5: an exactly-full final page announced a next cursor');
    end if;

    -- a half cursor is rejected, never silently treated as the first page
    begin
        v_res := pg_temp.wa_call('officeA', 'team', 'open', 200, now(), null);
        v_failures := array_append(v_failures, 'K: a cursor with due_at but no work_id was accepted');
    exception when others then
        reset role;
        if sqlstate <> '22023' then
            v_failures := v_failures || format('K: a half cursor raised %s instead of 22023', sqlstate);
        end if;
    end;

    -- limit clamping [1, 200] and the documented default
    if (pg_temp.wa_call('officeA', 'team', 'open', 0) ->> 'limit')::int <> 1 then
        v_failures := array_append(v_failures, 'K: p_limit = 0 was not clamped to 1');
    end if;
    if (pg_temp.wa_call('officeA', 'team', 'open', -5) ->> 'limit')::int <> 1 then
        v_failures := array_append(v_failures, 'K: a negative p_limit was not clamped to 1');
    end if;
    if (pg_temp.wa_call('officeA', 'team', 'open', 5000) ->> 'limit')::int <> 200 then
        v_failures := array_append(v_failures, 'K: p_limit = 5000 was not clamped to 200');
    end if;
    if (pg_temp.wa_call('officeA', 'team', 'open', null) ->> 'limit')::int <> 50 then
        v_failures := array_append(v_failures, 'K: a null p_limit did not fall back to the documented default of 50');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL:\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  K. keyset pagination: continuation, tie boundary, NULL tail, final page, no gaps/duplicates, clamping';
end;
$$;

-- ---------------------------------------------------------------------------
-- M. Exact response contract  (before L: L switches the transaction read-only)
-- ---------------------------------------------------------------------------
do $$
declare
    v_failures  text[] := '{}';
    v_res       jsonb  := pg_temp.wa_call('officeA', 'team', 'all', 200);
    v_envelope  text[] := array['data','limit','next_cursor','scope','state_scope'];
    v_row       text[] := array['actionable','carrier','context','due_at','due_precision','due_today','holder',
                                'invalid_reason','is_mine','is_unassigned','overdue','state','title',
                                'validity','work_id','work_type'];
    v_keys      text[];
    e           jsonb;
    v_forbidden text;
begin
    select array_agg(k order by k) into v_keys from jsonb_object_keys(v_res) k;
    if v_keys is distinct from v_envelope then
        v_failures := v_failures || format('M: the envelope carries %s instead of %s', v_keys, v_envelope);
    end if;

    for e in select x.value from jsonb_array_elements(v_res -> 'data') x loop
        select array_agg(k order by k) into v_keys from jsonb_object_keys(e) k;
        if v_keys is distinct from v_row then
            v_failures := v_failures || format('M: a Work row carries %s instead of the 16 contract fields', v_keys);
            exit;
        end if;
        select array_agg(k order by k) into v_keys from jsonb_object_keys(e -> 'context') k;
        if v_keys is distinct from array['contact','customer'] then
            v_failures := v_failures || format('M: context carries %s instead of {customer, contact}', v_keys);
            exit;
        end if;
        if jsonb_typeof(e -> 'holder') = 'object' then
            select array_agg(k order by k) into v_keys from jsonb_object_keys(e -> 'holder') k;
            if v_keys is distinct from array['display_name','sales_id'] then
                v_failures := v_failures || format('M: holder carries %s instead of {sales_id, display_name}', v_keys);
                exit;
            end if;
        end if;
        if e ->> 'carrier' <> 'task' then
            v_failures := array_append(v_failures, 'M: carrier is not the constant "task"');
            exit;
        end if;
    end loop;

    -- keys the freeze explicitly forbids in W-A, plus raw carrier columns, at
    -- any depth of the response
    foreach v_forbidden in array array['allowed_actions','carrier_capabilities','case','deal','deal_id',
                                       'attention','company_id','contact_id','done_date','reappear_at'] loop
        if v_res::text like '%"' || v_forbidden || '":%' then
            v_failures := v_failures || format('M: the response carries the forbidden/raw key %L', v_forbidden);
        end if;
    end loop;
    -- sales_id is legitimate INSIDE holder and nowhere else
    if exists (select 1 from jsonb_array_elements(v_res -> 'data') x where x.value ? 'sales_id') then
        v_failures := array_append(v_failures, 'M: a Work row exposes the raw sales_id column');
    end if;

    -- context mirrors the task's own columns and is never resolved from the
    -- contact (25 §14.1/§14.2, D-34/D-35)
    e := pg_temp.wa_row(v_res, 'n_padded');
    if not (e -> 'context' ? 'customer') or not (e -> 'context' ? 'contact') then
        v_failures := array_append(v_failures, 'M: a context key was omitted instead of being null');
    end if;
    if (e -> 'context' ->> 'customer')::bigint is distinct from pg_temp.wa_id('company')
       or (e -> 'context' ->> 'contact')::bigint is distinct from pg_temp.wa_id('contact') then
        v_failures := array_append(v_failures, 'M: context does not mirror the task''s own company_id / contact_id');
    end if;
    e := pg_temp.wa_row(v_res, 'd_overdue');
    if jsonb_typeof(e -> 'context' -> 'contact') <> 'null' then
        v_failures := array_append(v_failures, 'M: an absent contact context was guessed instead of reported as null');
    end if;

    -- context.customer = null is a legitimate domain state, reported
    -- explicitly and never resolved from the contact (25 §14.2, D-34)
    e := pg_temp.wa_row(v_res, 'n_no_customer');
    if e is null then
        v_failures := array_append(v_failures, 'M: work without a customer context is missing');
    else
        if not (e -> 'context' ? 'customer') then
            v_failures := array_append(v_failures, 'M: an absent customer context was omitted instead of reported as null');
        end if;
        if jsonb_typeof(e -> 'context' -> 'customer') <> 'null' then
            v_failures := v_failures || format('M: an absent customer context was resolved to %s', e -> 'context' -> 'customer');
        end if;
        if (e -> 'context' ->> 'contact')::bigint is distinct from pg_temp.wa_id('contact_free') then
            v_failures := array_append(v_failures, 'M: the contact context of customer-less work is wrong');
        end if;
    end if;

    -- and it stays null even when the contact acquires a customer LATER: a
    -- fallback "resolve the customer through the contact" would show one here
    e := pg_temp.wa_row(v_res, 'n_customer_later');
    if e is null then
        v_failures := array_append(v_failures, 'M: the late-customer row is missing');
    elsif jsonb_typeof(e -> 'context' -> 'customer') <> 'null' then
        v_failures := v_failures || format(
            'M: context.customer was resolved through the contact (%s) although the task carries none',
            e -> 'context' -> 'customer');
    end if;
    if (select t.company_id from public.tasks t where t.id = pg_temp.wa_id('n_customer_later')) is not null
       or (select c.company_id from public.contacts c where c.id = pg_temp.wa_id('contact_late')) is null then
        v_failures := array_append(v_failures,
            'M: the late-customer fixture is not the intended state (task without customer, contact with one)');
    end if;

    -- tasks.company_id is historical and never re-derived from the contact
    -- (25 §14.1, D-35, 03 §1.3 Falle 7a)
    e := pg_temp.wa_row(v_res, 'n_historical');
    if e is null then
        v_failures := array_append(v_failures, 'M: the historical-context row is missing');
    elsif (e -> 'context' ->> 'customer')::bigint is distinct from pg_temp.wa_id('company') then
        v_failures := v_failures || format(
            'M: context.customer was recomputed from the contact (%s) instead of kept historical (%s)',
            e -> 'context' -> 'customer', pg_temp.wa_id('company'));
    end if;
    if (select c.company_id from public.contacts c where c.id = pg_temp.wa_id('contact_moved'))
       is distinct from pg_temp.wa_id('company2') then
        v_failures := array_append(v_failures, 'M: the historical-context fixture did not actually move its contact');
    end if;

    -- the envelope echoes what was actually applied
    if v_res ->> 'scope' <> 'team' or v_res ->> 'state_scope' <> 'all' or (v_res ->> 'limit')::int <> 200 then
        v_failures := array_append(v_failures, 'M: the envelope does not echo the applied scope/state_scope/limit');
    end if;

    -- work_id is the established Nora entity uuid, not a new ID world (D-51)
    if (pg_temp.wa_row(v_res, 'd_overdue') ->> 'work_id')::uuid
       is distinct from public.nora_entity_uuid('task', pg_temp.wa_id('d_overdue')) then
        v_failures := array_append(v_failures, 'M: work_id is not nora_entity_uuid(''task'', id)');
    end if;

    -- an empty result is still a well-formed envelope
    v_res := pg_temp.wa_call('viewer', 'mine', 'open', 200);
    if v_res -> 'data' <> '[]'::jsonb or jsonb_typeof(v_res -> 'next_cursor') <> 'null' then
        v_failures := array_append(v_failures, 'M: an actor without work does not get an empty, well-formed envelope');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL:\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  M. exact envelope and row contract; no allowed_actions, carrier_capabilities, case or deal';
end;
$$;

-- ---------------------------------------------------------------------------
-- L. Read-only behaviour
-- ---------------------------------------------------------------------------
do $$
declare
    v_failures text[] := '{}';
    v_before   text;
    v_after    text;
    v_audit    bigint;
begin
    select md5(coalesce(string_agg(t.id::text || ':' || coalesce(t.text, '<null>') || ':' ||
                                   coalesce(t.due_date::text, '-') || ':' || coalesce(t.done_date::text, '-') || ':' ||
                                   coalesce(t.sales_id::text, '-'), '|' order by t.id), ''))
      into v_before from public.tasks t;
    select count(*) into v_audit from public.audit_events;

    perform pg_temp.wa_call('officeA', 'mine', 'open', 200);
    perform pg_temp.wa_call('officeA', 'team', 'all', 7);
    perform pg_temp.wa_call('officeB', 'mine', 'done', 3);

    select md5(coalesce(string_agg(t.id::text || ':' || coalesce(t.text, '<null>') || ':' ||
                                   coalesce(t.due_date::text, '-') || ':' || coalesce(t.done_date::text, '-') || ':' ||
                                   coalesce(t.sales_id::text, '-'), '|' order by t.id), ''))
      into v_after from public.tasks t;
    if v_after is distinct from v_before then
        v_failures := array_append(v_failures, 'L: the Work Query changed public.tasks');
    end if;
    if (select count(*) from public.audit_events) <> v_audit then
        v_failures := array_append(v_failures, 'L: the Work Query wrote an audit event');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL:\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  L1. the Work Query mutates neither the carrier nor the audit stream';
end;
$$;

-- The transaction becomes read-only for the rest of the run: the RPC must keep
-- working, and a write must now actually be refused (so the flag is real).
set local transaction_read_only = on;

do $$
declare
    v_failures text[] := '{}';
    v_res      jsonb;
    v_state    text := null;
begin
    if current_setting('transaction_read_only') <> 'on' then
        raise exception 'L: the transaction is not read-only — the proof would be vacuous';
    end if;

    v_res := pg_temp.wa_call('officeA', 'team', 'open', 200);
    if jsonb_array_length(v_res -> 'data') = 0 then
        v_failures := array_append(v_failures, 'L: the Work Query returned nothing in a read-only transaction');
    end if;
    v_res := pg_temp.wa_call('officeA', 'mine', 'all', 3);
    if jsonb_array_length(v_res -> 'data') = 0 then
        v_failures := array_append(v_failures, 'L: a paginated call failed in a read-only transaction');
    end if;

    begin
        insert into public.tasks (company_id, type, text, sales_id)
        values (pg_temp.wa_id('company'), 'Anruf', 'darf nicht', pg_temp.wa_id('sale_officeA'));
    exception when others then
        get stacked diagnostics v_state = returned_sqlstate;
    end;
    if v_state is distinct from '25006' then
        v_failures := v_failures || format('L: a write in the read-only transaction was not refused with 25006 (got %L)', v_state);
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL:\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  L2. the Work Query runs in a genuinely read-only transaction';
end;
$$;

rollback;

-- ---------------------------------------------------------------------------
-- Post-rollback: nothing was committed
-- ---------------------------------------------------------------------------
do $$
begin
    if exists (select 1 from public.sales where email like 'wa-sql-%@nora.test') then
        raise exception 'FAIL: the suite committed employee fixtures';
    end if;
    if exists (select 1 from public.companies where name = 'W-A Kunde GmbH') then
        raise exception 'FAIL: the suite committed customer fixtures';
    end if;
    raise notice 'OK  fixtures rolled back — nothing committed';
end;
$$;

\echo '=== W-A: Work Read Model verification PASSED ==='
