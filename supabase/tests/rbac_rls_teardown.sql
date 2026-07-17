-- Nora CRM v0.4b.1 — local RLS test teardown
-- Usage:
--   Get-Content supabase/tests/rbac_rls_teardown.sql -Raw | docker exec -i supabase_db_atomic-crm-demo psql -U postgres -d postgres

\set ON_ERROR_STOP on

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'nora_rls_test') then
        reassign owned by nora_rls_test to postgres;
        drop owned by nora_rls_test;
        revoke authenticated from nora_rls_test;
        revoke nora_rls_test from postgres;
        drop role nora_rls_test;
    end if;
end;
$$;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'nora_rls_test') then
        raise exception 'nora_rls_test teardown failed';
    end if;
end;
$$;

select 'rbac_rls_teardown: OK' as result;
