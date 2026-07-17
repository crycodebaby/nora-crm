-- Nora CRM v0.4b.1 — entry point for production-only checks (pipe-friendly)
-- Full local flow:
--   db reset → this file → setup → matrix → teardown → this file again
-- Usage:
--   Get-Content supabase/tests/rbac_rls_verification.sql -Raw | docker exec -i supabase_db_atomic-crm-demo psql -U postgres -d postgres

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

    if has_function_privilege('anon', 'nora_private.has_role(text[])', 'EXECUTE') then
        raise exception 'anon must not EXECUTE nora_private.has_role';
    end if;
end;
$$;

select 'rbac_rls_verification: OK' as result;
