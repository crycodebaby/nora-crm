-- Nora CRM v0.4b.1 — production migration check (run after db reset, BEFORE test setup)
-- Usage:
--   Get-Content supabase/tests/rbac_rls_production_check.sql -Raw | docker exec -i supabase_db_atomic-crm-demo psql -U postgres -d postgres

\set ON_ERROR_STOP on

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'nora_rls_test') then
        raise exception 'nora_rls_test must not exist after production migrations only';
    end if;

    if not exists (
        select 1 from information_schema.schemata where schema_name = 'nora_private'
    ) then
        raise exception 'nora_private schema missing';
    end if;

    if exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'nora_auth_uid'
    ) then
        raise exception 'public.nora_auth_uid must be removed';
    end if;

    if exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'is_admin'
    ) then
        raise exception 'public.is_admin must be removed (use nora_private.is_admin)';
    end if;

    if has_function_privilege('anon', 'nora_private.has_role(text[])', 'EXECUTE') then
        raise exception 'anon must not EXECUTE nora_private.has_role';
    end if;

    if has_function_privilege('anon', 'public.set_sales_role_by_admin(bigint, text, boolean)', 'EXECUTE') then
        raise exception 'anon must not EXECUTE set_sales_role_by_admin';
    end if;

    if has_table_privilege('anon', 'public.companies', 'SELECT') then
        raise exception 'anon must not have SELECT on companies';
    end if;

    if not has_function_privilege('authenticated', 'nora_private.is_active_user()', 'EXECUTE') then
        raise exception 'authenticated must EXECUTE nora_private.is_active_user for RLS';
    end if;

    if has_function_privilege('anon', 'nora_private.safe_auth_uid()', 'EXECUTE') then
        raise exception 'anon must not EXECUTE nora_private.safe_auth_uid';
    end if;
    if not has_function_privilege('authenticated', 'nora_private.safe_auth_uid()', 'EXECUTE')
       or not has_function_privilege('service_role', 'nora_private.safe_auth_uid()', 'EXECUTE') then
        raise exception 'authenticated and service_role must EXECUTE nora_private.safe_auth_uid';
    end if;

    if not exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        join pg_roles r on r.oid = p.proowner
        where n.nspname = 'nora_private'
          and p.proname = 'safe_auth_uid'
          and p.prosecdef
          and r.rolname = 'postgres'
          and pg_get_functiondef(p.oid) like '%request.jwt.claims%'
    ) then
        raise exception 'safe_auth_uid must be postgres-owned SECURITY DEFINER with request.jwt.claims support';
    end if;

    if not exists (select 1 from pg_roles where rolname = 'nora_role_manager') then
        raise exception 'nora_role_manager role missing';
    end if;

    if exists (
        select 1 from pg_roles
        where rolname = 'nora_role_manager' and (rolcanlogin or rolbypassrls)
    ) then
        raise exception 'nora_role_manager must be NOLOGIN NOBYPASSRLS';
    end if;

    if has_function_privilege('authenticated', 'nora_private.apply_sales_role_change(bigint, text, boolean)', 'EXECUTE') then
        raise exception 'authenticated must not EXECUTE apply_sales_role_change';
    end if;

    if not exists (
        select 1 from information_schema.views
        where table_schema = 'public' and table_name = 'sales_directory'
    ) then
        raise exception 'sales_directory view missing';
    end if;

    if has_table_privilege('anon', 'public.sales_directory', 'SELECT') then
        raise exception 'anon must not SELECT sales_directory';
    end if;

    if exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'prevent_sales_privilege_escalation'
          and (
              pg_get_functiondef(p.oid) like '%nora.allow_sales_privilege_change%'
              or pg_get_functiondef(p.oid) like '%nora.privilege_rpc_token%'
          )
    ) then
        raise exception 'prevent_sales_privilege_escalation must not use GUC tokens';
    end if;
    if not exists (select 1 from pg_roles where rolname = 'nora_calendar_writer') then
        raise exception 'nora_calendar_writer role missing';
    end if;

    if exists (
        select 1 from pg_roles
        where rolname = 'nora_calendar_writer' and (rolcanlogin or rolbypassrls)
    ) then
        raise exception 'nora_calendar_writer must be NOLOGIN NOBYPASSRLS';
    end if;

    if not exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'google_calendar_connections'
    ) then
        raise exception 'google_calendar_connections table missing';
    end if;

    if has_table_privilege('anon', 'public.google_calendar_events', 'SELECT') then
        raise exception 'anon must not SELECT google_calendar_events';
    end if;

    if has_function_privilege('authenticated', 'public.store_google_oauth_state(uuid, text, timestamptz, text)', 'EXECUTE') then
        raise exception 'authenticated must not EXECUTE store_google_oauth_state';
    end if;

    if not exists (select 1 from pg_roles where rolname = 'nora_calendar_linker') then
        raise exception 'nora_calendar_linker role missing';
    end if;
end;
$$;

select 'rbac_production_check: OK' as result;
