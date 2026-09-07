-- Nora CRM — Public schema privilege hardening (Security Hardening Wave 1)
--
-- WHY
-- ---
-- The default table privileges of schema `public` (grantor `postgres`) hand every
-- newly created table a set of non-DML privileges to the API-facing roles before
-- any migration issues an explicit GRANT:
--
--   Production (PG17): anon / authenticated / service_role = Dxtm
--                      (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN)
--   local      (PG15): anon / authenticated / service_role = arwdDxt
--                      (everything PG15 knows)
--
-- A migration that only writes `grant select` leaves that inheritance in place —
-- which is how the `audit_events` TRUNCATE finding (Security Hardening Wave 0)
-- came to exist. TRUNCATE bypasses RLS completely and fires no row triggers, so
-- no audit row is written. Reproduced locally on the base of this migration:
-- `set role authenticated; truncate public.sales cascade;` succeeded and cascaded
-- into companies, contact_notes, contacts, deal_notes, deals, tasks,
-- checklist_runs, checklist_run_items and google_calendar_events, while a plain
-- `delete from public.sales` was refused.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
--   1. preconditions
--   2. root cause: secure default privileges for schema `public`, creator `postgres`
--   3. convergence of every existing public base table onto an explicit matrix
--   4. convergence of every existing public view
--   5. `revoke create on schema public from nora_calendar_linker`
--   6. terminal negative assertions
--   7. terminal positive assertions (a failure rolls the whole file back)
--   8. future-table regression probe (create -> assert -> drop, inside this transaction)
--
-- DESIGN NOTES
-- ------------
--   * `revoke all` -> explicit `grant` per object. Additive grants would leave the
--     inherited Dxtm in place (03-data-model-guardrails.md, Migrationsregel).
--   * The DDL never names MAINTAIN. `revoke all` removes it on PG17 and is a no-op
--     for it on PG15, so one file parses and runs on both supported versions.
--     Only the assertions are version-aware (`server_version_num`).
--   * Capability roles (nora_audit_writer, nora_calendar_writer,
--     nora_calendar_linker, nora_role_manager, nora_identity_manager) are never a
--     target of a revoke here; their grants — including the column grant
--     `sales.email` -> nora_identity_manager — are asserted afterwards.
--   * Schema `storage` is deliberately untouched: different owner, different
--     platform behaviour, separate task.
--
-- NOT COVERED (documented, not fixed here)
-- ----------------------------------------
--   * `pg_default_acl` for creator `supabase_admin` in schema `public` still reads
--     `anon/authenticated/service_role = arwdDxtm`. `postgres` is not a member of
--     `supabase_admin` and cannot alter it. It is dormant: every relation in
--     `public` is owned by `postgres` (asserted below). A future platform-created
--     table in `public` would inherit it.
--   * schema `storage` (own owner/rollback path) and the undeployed `mcp` Edge
--     Function remain separate work items.

-- ---------------------------------------------------------------------------
-- 1. Preconditions
-- ---------------------------------------------------------------------------

do $$
declare
    v_missing text;
    v_acl     text;
    v_shape   text;
begin
    -- The default-privilege contract is grantor specific. If this migration were
    -- ever applied by another role, `alter default privileges for role postgres`
    -- would target a creator that does not create Nora's tables.
    if current_user <> 'postgres' then
        raise exception 'NORA_PRIVILEGE_HARDENING: expected migration creator postgres, got %', current_user;
    end if;

    if to_regnamespace('public') is null or to_regnamespace('nora_private') is null then
        raise exception 'NORA_PRIVILEGE_HARDENING: schema public and nora_private must exist';
    end if;

    select string_agg(r.expected, ', ')
      into v_missing
    from (values ('anon'),('authenticated'),('service_role'),('postgres'),
                 ('nora_audit_writer'),('nora_calendar_writer'),('nora_calendar_linker'),
                 ('nora_role_manager'),('nora_identity_manager')) r(expected)
    where not exists (select 1 from pg_roles where rolname = r.expected);

    if v_missing is not null then
        raise exception 'NORA_PRIVILEGE_HARDENING: missing roles: %', v_missing;
    end if;

    select string_agg(t.expected, ', ')
      into v_missing
    from (values ('public.sales'),('public.companies'),('public.contacts'),('public.deals'),
                 ('public.contact_notes'),('public.deal_notes'),('public.tasks'),('public.tags'),
                 ('public.audit_events'),('public.email_delivery_events'),('public.operation_errors'),
                 ('public.number_counters'),('public.configuration'),('public.favicons_excluded_domains'),
                 ('public.saved_text_snippets'),('public.checklist_templates'),('public.checklist_template_items'),
                 ('public.checklist_runs'),('public.checklist_run_items'),
                 ('public.google_calendar_connections'),('public.google_calendar_events'),
                 ('public.activity_log'),('public.companies_summary'),('public.contacts_summary'),
                 ('public.init_state'),('public.sales_directory'),('public.sales_identities')) t(expected)
    where to_regclass(t.expected) is null;

    if v_missing is not null then
        raise exception 'NORA_PRIVILEGE_HARDENING: missing relations: %', v_missing;
    end if;

    -- Every relation in public must be owned by postgres. Otherwise the
    -- supabase_admin default ACL (which this migration cannot reach) would be live.
    if exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r','v','p','m')
          and pg_get_userbyid(c.relowner) <> 'postgres'
    ) then
        raise exception 'NORA_PRIVILEGE_HARDENING: public contains relations not owned by postgres';
    end if;

    -- Capability grants that must survive this migration must exist before it.
    if not has_table_privilege('nora_audit_writer','public.audit_events','INSERT')
       or not has_table_privilege('nora_role_manager','public.sales','UPDATE')
       or not has_table_privilege('nora_calendar_linker','public.google_calendar_events','UPDATE')
       or not has_table_privilege('nora_calendar_writer','public.google_calendar_events','INSERT')
       or not has_column_privilege('nora_identity_manager','public.sales','email','UPDATE') then
        raise exception 'NORA_PRIVILEGE_HARDENING: expected capability-role grants are not present before the change';
    end if;

    -- Classify (do not gate on) the starting default ACL: local and Production
    -- start from different shapes on purpose and are converged below.
    select d.defaclacl::text into v_acl
    from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
    where n.nspname = 'public' and d.defaclobjtype = 'r'
      and pg_get_userbyid(d.defaclrole) = 'postgres';

    v_shape := case
        when v_acl is null then 'no default acl row'
        when v_acl like '%anon=Dxtm%' then 'production shape (Dxtm to api roles)'
        when v_acl like '%anon=arwdDxt%' then 'local shape (full dml to api roles)'
        when v_acl not like '%anon=%' and v_acl not like '%authenticated=%' then 'already hardened'
        else 'unclassified: ' || v_acl
    end;
    raise notice 'NORA_PRIVILEGE_HARDENING: starting default table ACL for postgres/public = % [%]',
        coalesce(v_acl, '(none)'), v_shape;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Root cause — default privileges for schema public, creator postgres
--
-- After this, a `create table` in public grants NOTHING to anon/authenticated/
-- service_role. Runtime access is only ever what a migration grants explicitly.
-- `revoke all` (rather than naming privileges) is what makes this file valid on
-- PG15 and PG17 alike.
-- ---------------------------------------------------------------------------

alter default privileges for role postgres in schema public
    revoke all on tables from anon, authenticated, service_role;

-- Sequences: Production is already narrow, local is not. Nora's id columns are all
-- `generated by default as identity`, which needs no sequence grant, so the API
-- roles must not carry one. This converges local onto the Production model.
alter default privileges for role postgres in schema public
    revoke all on sequences from anon, authenticated, service_role;

-- Functions: same divergence. EXECUTE stays an explicit, per-function decision.
alter default privileges for role postgres in schema public
    revoke execute on functions from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Existing base tables — explicit target matrix
--
-- `authenticated` is granted exactly the operations its RLS policies express.
-- `service_role` keeps the read/write it already had, minus:
--   * TRUNCATE/REFERENCES/TRIGGER/MAINTAIN — no PostgREST or Edge Function path
--     can use them;
--   * DELETE — no `.delete()` against a public table exists anywhere in
--     supabase/functions (deployed or not); `merge_contacts` runs on its own
--     `SUPABASE_DB_URL` connection, not on service_role; and the one supported
--     account deletion runs as `postgres` inside
--     `nora_private.guard_auth_user_delete`, while `nora_private.guard_sales_delete`
--     refuses a direct service_role DELETE anyway (W6-B).
-- `anon` keeps nothing on any base table.
-- ---------------------------------------------------------------------------

-- Core CRM ------------------------------------------------------------------
revoke all on table public.companies from anon, authenticated, service_role;
grant select, insert, update, delete on table public.companies to authenticated;
grant select, insert, update on table public.companies to service_role;

revoke all on table public.contacts from anon, authenticated, service_role;
grant select, insert, update, delete on table public.contacts to authenticated;
grant select, insert, update on table public.contacts to service_role;

revoke all on table public.deals from anon, authenticated, service_role;
grant select, insert, update, delete on table public.deals to authenticated;
grant select, insert, update on table public.deals to service_role;

revoke all on table public.contact_notes from anon, authenticated, service_role;
grant select, insert, update, delete on table public.contact_notes to authenticated;
grant select, insert, update on table public.contact_notes to service_role;

revoke all on table public.deal_notes from anon, authenticated, service_role;
grant select, insert, update, delete on table public.deal_notes to authenticated;
grant select, insert, update on table public.deal_notes to service_role;

revoke all on table public.tasks from anon, authenticated, service_role;
grant select, insert, update, delete on table public.tasks to authenticated;
grant select, insert, update on table public.tasks to service_role;

revoke all on table public.tags from anon, authenticated, service_role;
grant select, insert, update, delete on table public.tags to authenticated;
grant select, insert, update on table public.tags to service_role;

revoke all on table public.favicons_excluded_domains from anon, authenticated, service_role;
grant select, insert, update, delete on table public.favicons_excluded_domains to authenticated;
grant select, insert, update on table public.favicons_excluded_domains to service_role;

-- Employees -----------------------------------------------------------------
-- `sales` has SELECT and UPDATE policies for authenticated (own profile / admin)
-- and no INSERT policy: rows are created by the SECURITY DEFINER trigger
-- `handle_new_user` and by the users Edge Function. The inherited INSERT
-- privilege was unreachable and is dropped. DELETE stays absent for every
-- browser role (W2/W6-B). service_role keeps select/insert/update — the deployed
-- users Edge Function uses all three.
revoke all on table public.sales from anon, authenticated, service_role;
grant select, update on table public.sales to authenticated;
grant select, insert, update on table public.sales to service_role;

-- Configuration / settings --------------------------------------------------
revoke all on table public.configuration from anon, authenticated, service_role;
grant select, insert, update on table public.configuration to authenticated;
grant select, insert, update on table public.configuration to service_role;

revoke all on table public.saved_text_snippets from anon, authenticated, service_role;
grant select, insert, update on table public.saved_text_snippets to authenticated;
grant select, insert, update on table public.saved_text_snippets to service_role;

-- Checklists ----------------------------------------------------------------
revoke all on table public.checklist_templates from anon, authenticated, service_role;
grant select, insert, update on table public.checklist_templates to authenticated;
grant select, insert, update on table public.checklist_templates to service_role;

revoke all on table public.checklist_template_items from anon, authenticated, service_role;
grant select, insert, update on table public.checklist_template_items to authenticated;
grant select, insert, update on table public.checklist_template_items to service_role;

revoke all on table public.checklist_runs from anon, authenticated, service_role;
grant select, insert, update on table public.checklist_runs to authenticated;
grant select, insert, update on table public.checklist_runs to service_role;

revoke all on table public.checklist_run_items from anon, authenticated, service_role;
grant select, insert, update on table public.checklist_run_items to authenticated;
grant select, insert, update on table public.checklist_run_items to service_role;

-- Append-only / observability ----------------------------------------------
-- audit_events is append-only: `prevent_audit_events_update` and
-- `prevent_audit_events_delete` already refuse both for every role. The object
-- privileges now say the same thing. Writes arrive through the SECURITY DEFINER
-- RPCs (`insert_audit_event`, `record_employee_admin_event`) and the narrow
-- writer role, not through a direct service_role INSERT.
revoke all on table public.audit_events from anon, authenticated, service_role;
grant select on table public.audit_events to authenticated;
grant select, insert on table public.audit_events to service_role;

revoke all on table public.email_delivery_events from anon, authenticated, service_role;
grant select on table public.email_delivery_events to authenticated;
grant select, insert on table public.email_delivery_events to service_role;

revoke all on table public.operation_errors from anon, authenticated, service_role;
grant select on table public.operation_errors to authenticated;
grant select, insert, update on table public.operation_errors to service_role;

-- Numbering -----------------------------------------------------------------
-- Reached only through the SECURITY DEFINER RPCs `next_customer_number` /
-- `next_case_number`. The service_role entry was pure default-ACL residue.
revoke all on table public.number_counters from anon, authenticated, service_role;

-- Google Calendar cache -----------------------------------------------------
-- Read-only for the browser; writes belong to nora_calendar_writer /
-- nora_calendar_linker and to the (currently undeployed) calendar Edge Functions
-- on service_role.
revoke all on table public.google_calendar_connections from anon, authenticated, service_role;
grant select on table public.google_calendar_connections to authenticated;
grant select, insert, update on table public.google_calendar_connections to service_role;

revoke all on table public.google_calendar_events from anon, authenticated, service_role;
grant select on table public.google_calendar_events to authenticated;
grant select, insert, update on table public.google_calendar_events to service_role;

-- ---------------------------------------------------------------------------
-- 4. Views
--
-- None of these are auto-updatable, so the inherited insert/update/delete were
-- inert — but they were also never intended. `init_state` is the one view the
-- `anon` role genuinely needs: authProvider.getIsInitialized() reads it before
-- login. `sales_directory` / `sales_identities` were already SELECT-only (W2);
-- they are re-stated here so the end state does not depend on the starting one.
-- security_invoker / security_definer semantics are unchanged.
-- ---------------------------------------------------------------------------

revoke all on table public.activity_log from anon, authenticated, service_role;
grant select on table public.activity_log to authenticated, service_role;

revoke all on table public.companies_summary from anon, authenticated, service_role;
grant select on table public.companies_summary to authenticated, service_role;

revoke all on table public.contacts_summary from anon, authenticated, service_role;
grant select on table public.contacts_summary to authenticated, service_role;

revoke all on table public.init_state from anon, authenticated, service_role;
grant select on table public.init_state to anon, authenticated, service_role;

revoke all on table public.sales_directory from anon, authenticated, service_role;
grant select on table public.sales_directory to authenticated, service_role;

revoke all on table public.sales_identities from anon, authenticated, service_role;
grant select on table public.sales_identities to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Schema privilege — nora_calendar_linker
--
-- `20260717120000_google_calendar_oauth_sync.sql` granted CREATE ON SCHEMA public
-- to nora_calendar_linker so that `alter function ... owner to nora_calendar_linker`
-- would pass (Postgres requires the new owner to hold CREATE on the function's
-- schema). Nothing at runtime needs it: the two owned SECURITY DEFINER functions
-- already exist, and replacing them later works from `postgres` (a member of the
-- role) without schema CREATE. Verified locally before this migration was written.
--
-- Pattern for a future calendar migration that needs a new ownership transfer:
-- grant CREATE inside that migration, transfer ownership, revoke it again before
-- the migration ends. Never leave it granted.
-- ---------------------------------------------------------------------------

revoke create on schema public from nora_calendar_linker;

-- ---------------------------------------------------------------------------
-- 6. Terminal assertions — negative
-- ---------------------------------------------------------------------------

do $$
declare
    v_pg          int    := current_setting('server_version_num')::int;
    v_dangerous   text[] := case when current_setting('server_version_num')::int >= 170000
                                 then array['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']
                                 else array['TRUNCATE','REFERENCES','TRIGGER']
                            end;
    v_api_roles   text[] := array['anon','authenticated','service_role'];
    v_role        text;
    v_priv        text;
    r             record;
    v_failures    text[] := '{}';
    v_default_acl text;
begin
    -- 6a. No API role may hold a dangerous privilege on any relation in public.
    for r in
        select c.oid::regclass::text as obj, c.relname
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r','v','p','m')
        order by 1
    loop
        foreach v_role in array v_api_roles loop
            foreach v_priv in array v_dangerous loop
                if has_table_privilege(v_role, r.obj, v_priv) then
                    v_failures := v_failures || format('%s still holds %s on %s', v_role, v_priv, r.obj);
                end if;
            end loop;
        end loop;
    end loop;

    -- 6b. anon must hold nothing on any base table.
    for r in
        select c.oid::regclass::text as obj, c.relname
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r','p')
        order by 1
    loop
        foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE'] loop
            if has_table_privilege('anon', r.obj, v_priv) then
                v_failures := v_failures || format('anon still holds %s on base table %s', v_priv, r.obj);
            end if;
        end loop;
    end loop;

    -- 6c. anon on views: only init_state, only SELECT.
    for r in
        select c.oid::regclass::text as obj, c.relname
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'v'
        order by 1
    loop
        foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE'] loop
            if has_table_privilege('anon', r.obj, v_priv)
               and not (r.relname = 'init_state' and v_priv = 'SELECT') then
                v_failures := v_failures || format('anon still holds %s on view %s', v_priv, r.obj);
            end if;
        end loop;
    end loop;

    -- 6d. No API role may DELETE on a base table outside the authenticated matrix.
    for r in
        select c.oid::regclass::text as obj, c.relname
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r','p')
        order by 1
    loop
        if has_table_privilege('service_role', r.obj, 'DELETE') then
            v_failures := v_failures || format('service_role still holds DELETE on %s', r.obj);
        end if;
    end loop;

    -- 6e. Default privileges must no longer mention the API roles.
    select d.defaclacl::text into v_default_acl
    from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
    where n.nspname = 'public' and d.defaclobjtype = 'r'
      and pg_get_userbyid(d.defaclrole) = 'postgres';

    if v_default_acl is not null
       and (v_default_acl like '%anon=%' or v_default_acl like '%authenticated=%'
            or v_default_acl like '%service_role=%') then
        v_failures := v_failures || format('default table ACL still grants api roles: %s', v_default_acl);
    end if;

    -- 6f. nora_calendar_linker must not be able to create objects in public.
    if has_schema_privilege('nora_calendar_linker', 'public', 'CREATE') then
        v_failures := v_failures || 'nora_calendar_linker still holds CREATE on schema public';
    end if;

    -- 6g. No client-facing role may hold CREATE on public (the search_path premise
    --     of every SECURITY DEFINER function with a non-empty search_path).
    foreach v_role in array v_api_roles loop
        if has_schema_privilege(v_role, 'public', 'CREATE') then
            v_failures := v_failures || format('%s holds CREATE on schema public', v_role);
        end if;
    end loop;

    if cardinality(v_failures) > 0 then
        raise exception E'NORA_PRIVILEGE_HARDENING negative assertions failed (pg %):\n%',
            v_pg, array_to_string(v_failures, E'\n');
    end if;

    raise notice 'NORA_PRIVILEGE_HARDENING: negative assertions passed (pg %, checked %)',
        v_pg, v_dangerous;
end
$$;

-- ---------------------------------------------------------------------------
-- 7. Terminal assertions — positive (the anti-lockout gate)
-- ---------------------------------------------------------------------------

do $$
declare
    r          record;
    v_priv     text;
    v_expected boolean;
    v_actual   boolean;
    v_role     text;
    v_failures text[] := '{}';
begin
    -- 7a. Exact DML matrix for the API roles.
    for r in
        select * from (values
            -- authenticated: exactly what the RLS policies express
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
            -- service_role: traced Edge Function / executor needs, no DELETE
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
            ('service_role','public.number_counters',             ''),
            -- anon: the pre-login initialisation probe and nothing else
            ('anon','public.init_state',                          'SELECT'),
            ('anon','public.sales',                               ''),
            ('anon','public.companies',                           ''),
            ('anon','public.activity_log',                        ''),
            ('anon','public.companies_summary',                   ''),
            ('anon','public.contacts_summary',                    '')
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

    -- 7b. Capability roles keep their narrow rights.
    if not has_table_privilege('nora_audit_writer','public.audit_events','INSERT') then
        v_failures := v_failures || 'nora_audit_writer lost INSERT on audit_events';
    end if;
    if not has_table_privilege('nora_audit_writer','public.sales','SELECT')
       or not has_table_privilege('nora_audit_writer','public.companies','SELECT')
       or not has_table_privilege('nora_audit_writer','public.deals','SELECT') then
        v_failures := v_failures || 'nora_audit_writer lost a SELECT it needs';
    end if;
    if not has_table_privilege('nora_role_manager','public.sales','SELECT')
       or not has_table_privilege('nora_role_manager','public.sales','UPDATE') then
        v_failures := v_failures || 'nora_role_manager lost SELECT/UPDATE on sales';
    end if;
    if not has_table_privilege('nora_identity_manager','public.sales','SELECT')
       or not has_column_privilege('nora_identity_manager','public.sales','email','UPDATE') then
        v_failures := v_failures || 'nora_identity_manager lost its sales.email capability';
    end if;
    if not has_table_privilege('nora_calendar_writer','public.google_calendar_connections','INSERT')
       or not has_table_privilege('nora_calendar_writer','public.google_calendar_connections','UPDATE')
       or not has_table_privilege('nora_calendar_writer','public.google_calendar_events','INSERT')
       or not has_table_privilege('nora_calendar_writer','public.google_calendar_events','UPDATE')
       or not has_table_privilege('nora_calendar_writer','public.google_calendar_events','DELETE') then
        v_failures := v_failures || 'nora_calendar_writer lost a calendar write right';
    end if;
    if not has_table_privilege('nora_calendar_linker','public.google_calendar_events','SELECT')
       or not has_table_privilege('nora_calendar_linker','public.google_calendar_events','UPDATE') then
        v_failures := v_failures || 'nora_calendar_linker lost SELECT/UPDATE on google_calendar_events';
    end if;

    -- 7c. Schema USAGE must survive for every role that needs to reach public.
    foreach v_role in array array['anon','authenticated','service_role','postgres',
                                  'nora_audit_writer','nora_calendar_writer','nora_calendar_linker',
                                  'nora_role_manager','nora_identity_manager'] loop
        if not has_schema_privilege(v_role, 'public', 'USAGE') then
            v_failures := v_failures || format('%s lost USAGE on schema public', v_role);
        end if;
    end loop;

    -- 7d. The two SECURITY DEFINER functions owned by nora_calendar_linker must
    --     still be owned by it after the schema CREATE revoke.
    if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('apply_google_calendar_event_links','clear_google_calendar_event_links')
          and pg_get_userbyid(p.proowner) = 'nora_calendar_linker') <> 2 then
        v_failures := v_failures || 'the calendar link functions are no longer owned by nora_calendar_linker';
    end if;

    -- 7e. RPC EXECUTE paths the application depends on. Resolved by name so the
    --     assertion does not rot on a signature change; a name that stops being
    --     unique is itself a failure worth seeing here.
    for r in
        select * from (values
            ('authenticated','start_checklist_run_from_template'),
            ('authenticated','record_operation_error'),
            ('authenticated','get_global_audit_events'),
            ('authenticated','get_entity_audit_events'),
            ('authenticated','create_customer_with_contact'),
            ('authenticated','create_quick_capture_case'),
            ('authenticated','link_google_calendar_event'),
            ('authenticated','unlink_google_calendar_event'),
            ('service_role','set_sales_access_by_executor'),
            ('service_role','record_employee_admin_event'),
            ('service_role','offboard_employee_by_executor'),
            ('service_role','prepare_employee_account_deletion'),
            ('service_role','insert_audit_event'),
            ('service_role','ingest_email_delivery_event')
        ) as t(grantee, fname)
    loop
        if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = r.fname) <> 1 then
            v_failures := v_failures || format('expected exactly one public.%s', r.fname);
        elsif not (select has_function_privilege(r.grantee, p.oid, 'EXECUTE')
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = r.fname) then
            v_failures := v_failures || format('%s lost EXECUTE on public.%s', r.grantee, r.fname);
        end if;
    end loop;

    if cardinality(v_failures) > 0 then
        raise exception E'NORA_PRIVILEGE_HARDENING positive assertions failed:\n%',
            array_to_string(v_failures, E'\n');
    end if;

    raise notice 'NORA_PRIVILEGE_HARDENING: positive assertions passed';
end
$$;

-- ---------------------------------------------------------------------------
-- 8. Future-table regression probe
--
-- The canonical proof of the root-cause fix: a table created here, by the real
-- migration creator, before any explicit grant, must carry no privilege at all
-- for the API roles. Created and dropped inside this migration's transaction.
-- ---------------------------------------------------------------------------

create table public.nora_privilege_hardening_probe (id bigint);

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
            if has_table_privilege(v_role, 'public.nora_privilege_hardening_probe', v_priv) then
                v_failures := v_failures || format('%s inherited %s on a freshly created table', v_role, v_priv);
            end if;
        end loop;
    end loop;

    if cardinality(v_failures) > 0 then
        raise exception E'NORA_PRIVILEGE_HARDENING future-table regression failed:\n%',
            array_to_string(v_failures, E'\n');
    end if;

    raise notice 'NORA_PRIVILEGE_HARDENING: future-table regression passed (%)', v_privs;
end
$$;

drop table public.nora_privilege_hardening_probe;

-- ---------------------------------------------------------------------------
-- 9. PostgREST schema cache
-- ---------------------------------------------------------------------------

notify pgrst, 'reload schema';
