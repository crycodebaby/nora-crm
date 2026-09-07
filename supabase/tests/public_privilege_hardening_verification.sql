-- Nora CRM — Security Hardening Wave 1: public schema privilege verification
--
-- Run position: any time after a fresh `npx supabase db reset --local`.
-- The suite is self-contained and rolls its own fixtures back; it does not need
-- rbac_rls_setup and leaves no test role behind.
--
--   Get-Content supabase/tests/public_privilege_hardening_verification.sql -Raw |
--     docker exec -i supabase_db_atomic-crm-demo psql -U postgres -d postgres
--
-- What it proves:
--   1. default-privilege contract — the root cause. A `create table` in public by
--      the migration creator must grant NOTHING to anon/authenticated/service_role.
--   2. exact effective privilege matrix for the three API roles (positive AND
--      negative), version-aware for PG17's MAINTAIN.
--   3. anon scope: nothing on base tables, SELECT on init_state only.
--   4. capability roles keep their narrow rights, including the `sales.email`
--      column grant for nora_identity_manager.
--   5. schema privileges: no API role and no capability role holds CREATE on public.
--   6. future-object regression, executed against real freshly created objects:
--      a new table and its identity sequence grant nothing to the API roles, and
--      no browser role can execute an executor / privileged writer RPC.
--      (A new FUNCTION is PUBLIC-executable by plain PostgreSQL default; that is
--      pre-existing, not removable via ALTER DEFAULT PRIVILEGES, and is recorded
--      as a NOTICE rather than asserted — see 17-known-issues A.8.)
--   7. behavioural refusals: TRUNCATE and the revoked DELETEs are actually
--      attempted and actually denied — not merely reported absent by a catalog
--      lookup.
--   8. anti-lockout: normal CRM read/write still works for a real authenticated
--      session through RLS, and identity inserts work without sequence grants.
--
-- This suite fails if somebody reintroduces the dangerous default ACL, widens an
-- API role, or strips a capability role.

\set ON_ERROR_STOP on

\echo '=== Security Hardening Wave 1: public privilege verification ==='

-- ---------------------------------------------------------------------------
-- 1. Default-privilege contract (the root cause)
-- ---------------------------------------------------------------------------
do $$
declare
    v_acl text;
    r     record;
begin
    for r in
        select unnest(array['r','S','f']) as objtype
    loop
        select d.defaclacl::text into v_acl
        from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
        where n.nspname = 'public' and d.defaclobjtype = r.objtype
          and pg_get_userbyid(d.defaclrole) = 'postgres';

        if v_acl is not null
           and (v_acl like '%anon=%' or v_acl like '%authenticated=%' or v_acl like '%service_role=%') then
            raise exception 'FAIL: default privileges for postgres/public/% still grant an API role: %',
                r.objtype, v_acl;
        end if;
    end loop;

    raise notice 'OK  1. default privileges for schema public (creator postgres) grant no API role';
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Exact effective privilege matrix
-- ---------------------------------------------------------------------------
do $$
declare
    v_pg        int    := current_setting('server_version_num')::int;
    v_dangerous text[] := case when current_setting('server_version_num')::int >= 170000
                               then array['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']
                               else array['TRUNCATE','REFERENCES','TRIGGER']
                          end;
    r           record;
    v_priv      text;
    v_role      text;
    v_expected  boolean;
    v_actual    boolean;
    v_failures  text[] := '{}';
begin
    -- 2a. no dangerous privilege anywhere for the API roles
    for r in
        select c.oid::regclass::text as obj
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r','v','p','m')
        order by 1
    loop
        foreach v_role in array array['anon','authenticated','service_role'] loop
            foreach v_priv in array v_dangerous loop
                if has_table_privilege(v_role, r.obj, v_priv) then
                    v_failures := v_failures || format('%s holds %s on %s', v_role, v_priv, r.obj);
                end if;
            end loop;
        end loop;
    end loop;

    -- 2b. exact DML matrix
    for r in
        select * from (values
            ('authenticated','public.companies',                  'SELECT,INSERT,UPDATE,DELETE'),
            ('authenticated','public.contacts',                   'SELECT,INSERT,UPDATE,DELETE'),
            ('authenticated','public.deals',                      'SELECT,INSERT,UPDATE,DELETE'),
            ('authenticated','public.contact_notes',              'SELECT,INSERT,UPDATE,DELETE'),
            ('authenticated','public.deal_notes',                 'SELECT,INSERT,UPDATE,DELETE'),
            ('authenticated','public.tasks',                      'SELECT,INSERT,UPDATE,DELETE'),
            ('authenticated','public.tags',                       'SELECT,INSERT,UPDATE,DELETE'),
            ('authenticated','public.favicons_excluded_domains',  'SELECT,INSERT,UPDATE,DELETE'),
            ('authenticated','public.sales',                      'SELECT,UPDATE'),
            ('authenticated','public.configuration',              'SELECT,INSERT,UPDATE'),
            ('authenticated','public.saved_text_snippets',        'SELECT,INSERT,UPDATE'),
            ('authenticated','public.checklist_templates',        'SELECT,INSERT,UPDATE'),
            ('authenticated','public.checklist_template_items',   'SELECT,INSERT,UPDATE'),
            ('authenticated','public.checklist_runs',             'SELECT,INSERT,UPDATE'),
            ('authenticated','public.checklist_run_items',        'SELECT,INSERT,UPDATE'),
            ('authenticated','public.audit_events',               'SELECT'),
            ('authenticated','public.email_delivery_events',      'SELECT'),
            ('authenticated','public.operation_errors',           'SELECT'),
            ('authenticated','public.google_calendar_connections','SELECT'),
            ('authenticated','public.google_calendar_events',     'SELECT'),
            ('authenticated','public.number_counters',            ''),
            ('authenticated','public.activity_log',               'SELECT'),
            ('authenticated','public.companies_summary',          'SELECT'),
            ('authenticated','public.contacts_summary',           'SELECT'),
            ('authenticated','public.init_state',                 'SELECT'),
            ('authenticated','public.sales_directory',            'SELECT'),
            ('authenticated','public.sales_identities',           'SELECT'),
            ('service_role','public.sales',                       'SELECT,INSERT,UPDATE'),
            ('service_role','public.companies',                   'SELECT,INSERT,UPDATE'),
            ('service_role','public.contacts',                    'SELECT,INSERT,UPDATE'),
            ('service_role','public.deals',                       'SELECT,INSERT,UPDATE'),
            ('service_role','public.contact_notes',               'SELECT,INSERT,UPDATE'),
            ('service_role','public.deal_notes',                  'SELECT,INSERT,UPDATE'),
            ('service_role','public.tasks',                       'SELECT,INSERT,UPDATE'),
            ('service_role','public.tags',                        'SELECT,INSERT,UPDATE'),
            ('service_role','public.favicons_excluded_domains',   'SELECT,INSERT,UPDATE'),
            ('service_role','public.configuration',               'SELECT,INSERT,UPDATE'),
            ('service_role','public.saved_text_snippets',         'SELECT,INSERT,UPDATE'),
            ('service_role','public.checklist_templates',         'SELECT,INSERT,UPDATE'),
            ('service_role','public.checklist_template_items',    'SELECT,INSERT,UPDATE'),
            ('service_role','public.checklist_runs',              'SELECT,INSERT,UPDATE'),
            ('service_role','public.checklist_run_items',         'SELECT,INSERT,UPDATE'),
            ('service_role','public.operation_errors',            'SELECT,INSERT,UPDATE'),
            ('service_role','public.google_calendar_connections', 'SELECT,INSERT,UPDATE'),
            ('service_role','public.google_calendar_events',      'SELECT,INSERT,UPDATE'),
            ('service_role','public.audit_events',                'SELECT,INSERT'),
            ('service_role','public.email_delivery_events',       'SELECT,INSERT'),
            ('service_role','public.number_counters',             '')
        ) as t(grantee, obj, privs)
    loop
        foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE'] loop
            v_expected := (v_priv = any (string_to_array(r.privs, ',')));
            v_actual   := has_table_privilege(r.grantee, r.obj, v_priv);
            if v_actual is distinct from v_expected then
                v_failures := v_failures || format('%s on %s: %s expected=%s actual=%s',
                    r.grantee, r.obj, v_priv, v_expected, v_actual);
            end if;
        end loop;
    end loop;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL: privilege matrix drift (pg %):\n%', v_pg, array_to_string(v_failures, E'\n');
    end if;

    raise notice 'OK  2. effective privilege matrix exact for anon/authenticated/service_role (pg %, dangerous set %)',
        v_pg, v_dangerous;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. anon scope
-- ---------------------------------------------------------------------------
do $$
declare
    r          record;
    v_priv     text;
    v_failures text[] := '{}';
begin
    for r in
        select c.oid::regclass::text as obj, c.relname, c.relkind::text as kind
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r','v','p','m')
        order by 1
    loop
        foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE'] loop
            if has_table_privilege('anon', r.obj, v_priv)
               and not (r.relname = 'init_state' and v_priv = 'SELECT') then
                v_failures := v_failures || format('anon holds %s on %s', v_priv, r.obj);
            end if;
        end loop;
    end loop;

    -- the one thing anon must keep: the pre-login initialisation probe
    if not has_table_privilege('anon', 'public.init_state', 'SELECT') then
        v_failures := v_failures || 'anon lost SELECT on init_state (login page would break)';
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL: anon scope:\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  3. anon: SELECT on init_state only, nothing else in public';
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Capability roles preserved
-- ---------------------------------------------------------------------------
do $$
declare
    v_failures text[] := '{}';
begin
    if not has_table_privilege('nora_audit_writer','public.audit_events','INSERT')
       or not has_table_privilege('nora_audit_writer','public.sales','SELECT')
       or not has_table_privilege('nora_audit_writer','public.companies','SELECT')
       or not has_table_privilege('nora_audit_writer','public.deals','SELECT') then
        v_failures := v_failures || 'nora_audit_writer lost a grant';
    end if;
    if not has_table_privilege('nora_role_manager','public.sales','SELECT')
       or not has_table_privilege('nora_role_manager','public.sales','UPDATE') then
        v_failures := v_failures || 'nora_role_manager lost SELECT/UPDATE on sales';
    end if;
    if not has_table_privilege('nora_identity_manager','public.sales','SELECT')
       or not has_column_privilege('nora_identity_manager','public.sales','email','UPDATE') then
        v_failures := v_failures || 'nora_identity_manager lost its sales.email capability';
    end if;
    -- the identity manager must stay narrow: email column only, no table UPDATE
    if has_table_privilege('nora_identity_manager','public.sales','UPDATE') then
        v_failures := v_failures || 'nora_identity_manager gained a table-wide UPDATE on sales';
    end if;
    if not has_table_privilege('nora_calendar_writer','public.google_calendar_connections','INSERT')
       or not has_table_privilege('nora_calendar_writer','public.google_calendar_connections','SELECT')
       or not has_table_privilege('nora_calendar_writer','public.google_calendar_connections','UPDATE')
       or not has_table_privilege('nora_calendar_writer','public.google_calendar_events','INSERT')
       or not has_table_privilege('nora_calendar_writer','public.google_calendar_events','SELECT')
       or not has_table_privilege('nora_calendar_writer','public.google_calendar_events','UPDATE')
       or not has_table_privilege('nora_calendar_writer','public.google_calendar_events','DELETE') then
        v_failures := v_failures || 'nora_calendar_writer lost a calendar write right';
    end if;
    if not has_table_privilege('nora_calendar_linker','public.google_calendar_events','SELECT')
       or not has_table_privilege('nora_calendar_linker','public.google_calendar_events','UPDATE') then
        v_failures := v_failures || 'nora_calendar_linker lost SELECT/UPDATE on google_calendar_events';
    end if;
    -- the linker must stay scoped to the calendar cache
    if has_table_privilege('nora_calendar_linker','public.companies','SELECT')
       or has_table_privilege('nora_calendar_linker','public.sales','SELECT') then
        v_failures := v_failures || 'nora_calendar_linker reaches beyond the calendar cache';
    end if;
    if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('apply_google_calendar_event_links','clear_google_calendar_event_links')
          and pg_get_userbyid(p.proowner) = 'nora_calendar_linker') <> 2 then
        v_failures := v_failures || 'the calendar link functions are no longer owned by nora_calendar_linker';
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL: capability roles:\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  4. capability roles keep their narrow rights (incl. sales.email column grant)';
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Schema privileges
-- ---------------------------------------------------------------------------
do $$
declare
    v_role     text;
    v_failures text[] := '{}';
begin
    foreach v_role in array array['anon','authenticated','service_role',
                                  'nora_audit_writer','nora_calendar_writer','nora_calendar_linker',
                                  'nora_role_manager','nora_identity_manager'] loop
        if has_schema_privilege(v_role, 'public', 'CREATE') then
            v_failures := v_failures || format('%s holds CREATE on schema public', v_role);
        end if;
        if not has_schema_privilege(v_role, 'public', 'USAGE') then
            v_failures := v_failures || format('%s lost USAGE on schema public', v_role);
        end if;
    end loop;

    -- nora_private must stay off the API surface
    if has_schema_privilege('anon', 'nora_private', 'USAGE') then
        v_failures := v_failures || 'anon holds USAGE on nora_private';
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL: schema privileges:\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  5. schema public: USAGE for every runtime role, CREATE for none of them';
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Future-table regression (the canonical root-cause guard)
-- ---------------------------------------------------------------------------
begin;

create table public.nora_privilege_regression_probe (id bigint generated by default as identity primary key, payload text);

do $$
declare
    v_privs    text[] := case when current_setting('server_version_num')::int >= 170000
                              then array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']
                              else array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']
                         end;
    v_role     text;
    v_priv     text;
    v_failures text[] := '{}';
begin
    foreach v_role in array array['anon','authenticated','service_role'] loop
        foreach v_priv in array v_privs loop
            if has_table_privilege(v_role, 'public.nora_privilege_regression_probe', v_priv) then
                v_failures := v_failures || format('%s inherited %s on a new table before any GRANT', v_role, v_priv);
            end if;
        end loop;
    end loop;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL: future-table regression — the dangerous default ACL is back:\n%',
            array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  6. a newly created public table grants nothing to anon/authenticated/service_role (%)', v_privs;
end
$$;

-- 6b. Sequences: a new identity column must not need — or hand out — any
--     sequence privilege for the API roles. (Nora's ids are all
--     `generated by default as identity`; Production's public sequences have a
--     NULL ACL and inserts work, which is the same contract asserted here.)
do $$
declare
    v_seq      oid;
    v_role     text;
    v_failures text[] := '{}';
begin
    select c.oid into v_seq
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'S' and c.relname like 'nora_privilege_regression_probe%';

    if v_seq is null then
        raise exception 'FAIL: probe identity sequence not found';
    end if;

    foreach v_role in array array['anon','authenticated','service_role'] loop
        if has_sequence_privilege(v_role, v_seq, 'USAGE')
           or has_sequence_privilege(v_role, v_seq, 'UPDATE')
           or has_sequence_privilege(v_role, v_seq, 'SELECT') then
            v_failures := v_failures || format('%s inherited a privilege on a new identity sequence', v_role);
        end if;
    end loop;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL: future-sequence regression:\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  6b. a new identity sequence grants nothing to anon/authenticated/service_role';
end
$$;

-- 6c. Functions: PostgreSQL's BUILT-IN default for a function is
--     `owner + PUBLIC EXECUTE`, and that PUBLIC grant cannot be removed through
--     ALTER DEFAULT PRIVILEGES (verified 2026-09-07 on PG15: neither
--     `revoke execute ... from public` nor grant-then-revoke changes the stored
--     row; a new function still comes out with a NULL proacl). This is plain
--     Postgres behaviour, identical in a brand-new schema, and identical on
--     Production — it is NOT the pg_default_acl defect this wave fixes.
--
--     The control Nora actually relies on is therefore per-function: every
--     sensitive RPC carries an explicit `revoke all on function ... from public`
--     in its migration. That is what this section asserts, because that is what
--     protects the database.
create function public.nora_privilege_regression_probe_fn() returns int language sql immutable as $$ select 1 $$;

do $$
declare
    r          record;
    v_role     text;
    v_failures text[] := '{}';
    v_public_default boolean;
begin
    -- Record (do not fail on) the built-in behaviour, so a future PostgreSQL or
    -- platform change that removes it is visible in the log rather than silent.
    v_public_default := has_function_privilege('anon', 'public.nora_privilege_regression_probe_fn()', 'EXECUTE');
    raise notice '     note: a new public function is PUBLIC-executable by Postgres default = % (pre-existing, see 17-known-issues A.8)',
        v_public_default;

    -- The executors and privileged writers must never be reachable from a browser.
    for r in
        select * from (values
            ('set_sales_access_by_executor'),
            ('offboard_employee_by_executor'),
            ('prepare_employee_account_deletion'),
            ('cancel_employee_account_deletion'),
            ('prepare_sales_email_change'),
            ('record_employee_admin_event'),
            ('insert_audit_event'),
            ('ingest_email_delivery_event'),
            ('get_user_id_by_email')
        ) as t(fname)
    loop
        if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public' and p.proname = r.fname) then
            v_failures := v_failures || format('expected public.%s to exist', r.fname);
            continue;
        end if;
        foreach v_role in array array['anon','authenticated'] loop
            if (select bool_or(has_function_privilege(v_role, p.oid, 'EXECUTE'))
                from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = r.fname) then
                v_failures := v_failures || format('%s can EXECUTE the privileged function public.%s', v_role, r.fname);
            end if;
        end loop;
    end loop;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL: privileged function exposure:\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  6c. no browser role can execute an executor / privileged writer RPC';
end
$$;

rollback;

-- ---------------------------------------------------------------------------
-- 7. Behavioural refusals — actually attempted, actually denied
--    (no fixtures are inserted in this transaction, so a TRUNCATE that got past
--     the privilege check would fail on data, not on "pending trigger events")
-- ---------------------------------------------------------------------------
begin;

do $$
declare
    r          record;
    v_ok       boolean;
    v_failures text[] := '{}';
begin
    for r in
        select * from (values
            ('authenticated','public.sales'),
            ('authenticated','public.companies'),
            ('authenticated','public.contacts'),
            ('authenticated','public.deals'),
            ('authenticated','public.tasks'),
            ('authenticated','public.audit_events'),
            ('authenticated','public.google_calendar_events'),
            ('authenticated','public.checklist_runs'),
            ('authenticated','public.configuration'),
            ('service_role','public.sales'),
            ('service_role','public.companies'),
            ('service_role','public.audit_events'),
            ('service_role','public.number_counters'),
            ('anon','public.sales'),
            ('anon','public.companies')
        ) as t(grantee, obj)
    loop
        v_ok := false;
        begin
            execute format('set local role %I', r.grantee);
            execute format('truncate table %s', r.obj);
        exception when insufficient_privilege then
            v_ok := true;
        when others then
            v_ok := false;
        end;
        execute 'reset role';
        if not v_ok then
            v_failures := v_failures || format('%s was NOT denied TRUNCATE on %s', r.grantee, r.obj);
        end if;
    end loop;

    -- the DELETEs this wave revoked
    for r in
        select * from (values
            ('service_role','public.sales'),
            ('service_role','public.companies'),
            ('service_role','public.contacts'),
            ('service_role','public.audit_events'),
            ('authenticated','public.sales'),
            ('authenticated','public.checklist_templates'),
            ('authenticated','public.saved_text_snippets'),
            ('authenticated','public.audit_events'),
            ('authenticated','public.configuration')
        ) as t(grantee, obj)
    loop
        v_ok := false;
        begin
            execute format('set local role %I', r.grantee);
            execute format('delete from %s', r.obj);
        exception when insufficient_privilege then
            v_ok := true;
        when others then
            v_ok := false;
        end;
        execute 'reset role';
        if not v_ok then
            v_failures := v_failures || format('%s was NOT denied DELETE on %s', r.grantee, r.obj);
        end if;
    end loop;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL: behavioural refusals:\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  7. TRUNCATE and the revoked DELETEs are refused in practice, not just in the catalog';
end
$$;

rollback;

-- ---------------------------------------------------------------------------
-- 8. Anti-lockout — normal CRM work still succeeds through RLS
-- ---------------------------------------------------------------------------
begin;

do $$
declare
    v_office uuid := gen_random_uuid();
    v_admin  uuid := gen_random_uuid();
    s_office uuid := gen_random_uuid();
    s_admin  uuid := gen_random_uuid();
    v_o bigint; v_a bigint;
    v_company bigint; v_contact bigint; v_deal bigint; v_task bigint; v_note bigint;
    v_n bigint;
    v_ok boolean;
begin
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values
      (v_office,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','hardening-office@nora.test','x',now(),
       '{"provider":"email","providers":["email"]}','{"first_name":"Olaf","last_name":"Office"}',now(),now()),
      (v_admin, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','hardening-admin@nora.test','x',now(),
       '{"provider":"email","providers":["email"]}','{"first_name":"Ada","last_name":"Admin"}',now(),now());

    -- proves the identity sequences work without any API-role sequence grant
    select id into v_o from public.sales where user_id = v_office;
    select id into v_a from public.sales where user_id = v_admin;
    if v_o is null or v_a is null then
        raise exception 'FAIL: handle_new_user could not create sales rows (identity/sequence privilege regression)';
    end if;

    -- On an empty database the first signup becomes admin (handle_new_user), so
    -- promote the intended admin BEFORE demoting the other row — otherwise
    -- guard_last_active_admin refuses (NORA_LAST_ACTIVE_ADMIN_REQUIRED).
    perform nora_private.apply_sales_role_change(v_a, 'admin', false);
    perform nora_private.apply_sales_role_change(v_o, 'office', false);

    insert into auth.sessions (id, user_id, created_at, updated_at, aal)
    values (s_office, v_office, now(), now(), 'aal1'), (s_admin, v_admin, now(), now(), 'aal1');

    -- ---- office: the normal working day
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', v_office::text, true);
    perform set_config('request.jwt.claim.session_id', s_office::text, true);
    set local role authenticated;

    insert into public.companies (name, sales_id) values ('Hardening Kunde', v_o) returning id into v_company;
    insert into public.contacts (first_name, last_name, company_id, sales_id)
        values ('Kon','Takt', v_company, v_o) returning id into v_contact;
    insert into public.deals (name, company_id, stage, sales_id)
        values ('Hardening Vorgang', v_company, 'opportunity', v_o) returning id into v_deal;
    insert into public.tasks (contact_id, company_id, type, text, due_date, sales_id)
        values (v_contact, v_company, 'Call', 'Nachfassen', now(), v_o) returning id into v_task;
    insert into public.contact_notes (contact_id, text, sales_id, date)
        values (v_contact, 'Notiz', v_o, now()) returning id into v_note;

    update public.companies set name = 'Hardening Kunde (bearbeitet)' where id = v_company;
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'FAIL: office could not update a company'; end if;

    update public.deals set stage = 'proposal-sent' where id = v_deal;
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'FAIL: office could not update a deal'; end if;

    if (select count(*) from public.companies_summary where id = v_company) <> 1 then
        raise exception 'FAIL: office cannot read companies_summary';
    end if;
    if (select count(*) from public.contacts_summary where id = v_contact) <> 1 then
        raise exception 'FAIL: office cannot read contacts_summary';
    end if;
    if (select count(*) from public.activity_log where company_id = v_company) = 0 then
        raise exception 'FAIL: office cannot read activity_log';
    end if;
    if (select count(*) from public.sales_directory where id = v_o) <> 1 then
        raise exception 'FAIL: office cannot read sales_directory';
    end if;
    if (select count(*) from public.sales_identities where id = v_o) <> 1 then
        raise exception 'FAIL: office cannot read sales_identities';
    end if;
    if (select count(*) from public.sales where id = v_o) <> 1 then
        raise exception 'FAIL: office cannot read its own sales row';
    end if;

    -- own profile update (the only sales UPDATE a browser role may do)
    update public.sales set first_name = 'Olaf' where id = v_o;
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'FAIL: office could not update its own profile'; end if;

    -- snippets: insert/update yes (DELETE is not granted and has no policy)
    insert into public.saved_text_snippets (service_area_code, kind, text, created_by)
        values ('FENS','note_text','Hardening Probe', v_office);
    update public.saved_text_snippets set text = 'Hardening Probe 2'
        where created_by = v_office and text = 'Hardening Probe';
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'FAIL: office could not update a snippet'; end if;

    reset role;

    -- ---- admin: audit read paths and the admin-only deletes
    perform set_config('request.jwt.claim.sub', v_admin::text, true);
    perform set_config('request.jwt.claim.session_id', s_admin::text, true);
    set local role authenticated;
    perform public.get_global_audit_events(5, null, null, null, null, null, null, null);
    if (select count(*) from public.audit_events) = 0 then
        raise exception 'FAIL: admin cannot read audit_events';
    end if;

    -- the DELETE grants that must survive (RLS restricts these to admin)
    delete from public.contact_notes where id = v_note;
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'FAIL: admin could not delete a contact note'; end if;
    delete from public.tasks where id = v_task;
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'FAIL: admin could not delete a task'; end if;
    delete from public.deals where id = v_deal;
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'FAIL: admin could not delete a deal'; end if;
    delete from public.contacts where id = v_contact;
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'FAIL: admin could not delete a contact'; end if;
    delete from public.companies where id = v_company;
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'FAIL: admin could not delete a company'; end if;
    reset role;

    -- ---- anon: the pre-login probe still answers
    perform set_config('request.jwt.claim.role', 'anon', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.session_id', '', true);
    set local role anon;
    if (select is_initialized from public.init_state) is null then
        raise exception 'FAIL: anon cannot read init_state (login page would break)';
    end if;
    v_ok := false;
    begin
        perform 1 from public.sales;
    exception when insufficient_privilege then v_ok := true;
    end;
    if not v_ok then raise exception 'FAIL: anon could read sales'; end if;
    reset role;

    -- ---- service_role: backend reach without RLS, still no DELETE
    perform set_config('request.jwt.claim.role', 'service_role', true);
    set local role service_role;
    if (select count(*) from public.sales) < 2 then
        raise exception 'FAIL: service_role cannot read sales';
    end if;
    update public.sales set avatar = avatar where id = v_o;
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'FAIL: service_role cannot update sales (users Edge Function path)'; end if;
    reset role;

    raise notice 'OK  8. normal CRM read/write, own-profile update, audit read, anon init probe and the service_role backend path all still work';
end
$$;

rollback;

-- ---------------------------------------------------------------------------
-- 9. No GUC leak
-- ---------------------------------------------------------------------------
do $$
begin
    if coalesce(current_setting('request.jwt.claim.sub', true), '') <> ''
       or coalesce(current_setting('request.jwt.claim.role', true), '') <> ''
       or coalesce(current_setting('request.jwt.claim.session_id', true), '') <> ''
       or coalesce(current_setting('request.jwt.claims', true), '') <> '' then
        raise exception 'FAIL: JWT GUCs leaked out of the suite';
    end if;
    if current_user <> 'postgres' then
        raise exception 'FAIL: role leaked out of the suite (now %)', current_user;
    end if;
    raise notice 'OK  9. no GUC or role leak';
end
$$;

select 'public_privilege_hardening_verification: OK' as result;
