-- Nora Security Hardening Wave 0
-- audit_events immutability / TRUNCATE privilege verification
--
-- Run after: npx supabase db reset
--   docker exec -i supabase_db_atomic-crm-demo psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/audit_immutability_privilege_verification.sql
--
-- Every destructive probe runs inside a transaction that is rolled back, so the
-- script never mutates real audit history. TRUNCATE is transactional in
-- PostgreSQL, so even a probe that unexpectedly SUCCEEDS is undone.

\set ON_ERROR_STOP on

\echo '=== Security Hardening Wave 0: audit_events immutability verification ==='

-- ---------------------------------------------------------------------------
-- 1. Declarative privilege contract
-- ---------------------------------------------------------------------------
do $$
declare
    v_acl text;
begin
    -- authenticated: SELECT only.
    if not has_table_privilege('authenticated', 'public.audit_events', 'SELECT') then
        raise exception 'FAIL: authenticated lost SELECT on audit_events';
    end if;

    if has_table_privilege('authenticated', 'public.audit_events', 'TRUNCATE') then
        raise exception 'FAIL: authenticated holds TRUNCATE on audit_events';
    end if;
    if has_table_privilege('authenticated', 'public.audit_events', 'UPDATE') then
        raise exception 'FAIL: authenticated holds UPDATE on audit_events';
    end if;
    if has_table_privilege('authenticated', 'public.audit_events', 'DELETE') then
        raise exception 'FAIL: authenticated holds DELETE on audit_events';
    end if;
    if has_table_privilege('authenticated', 'public.audit_events', 'INSERT') then
        raise exception 'FAIL: authenticated holds INSERT on audit_events';
    end if;
    if has_table_privilege('authenticated', 'public.audit_events', 'TRIGGER') then
        raise exception 'FAIL: authenticated holds TRIGGER on audit_events';
    end if;
    if has_table_privilege('authenticated', 'public.audit_events', 'REFERENCES') then
        raise exception 'FAIL: authenticated holds REFERENCES on audit_events';
    end if;

    -- anon: nothing at all.
    if has_table_privilege('anon', 'public.audit_events', 'SELECT')
        or has_table_privilege('anon', 'public.audit_events', 'INSERT')
        or has_table_privilege('anon', 'public.audit_events', 'TRUNCATE') then
        raise exception 'FAIL: anon holds privileges on audit_events';
    end if;

    -- Write path intact.
    if not has_table_privilege('nora_audit_writer', 'public.audit_events', 'INSERT') then
        raise exception 'FAIL: nora_audit_writer lost INSERT on audit_events';
    end if;

    select coalesce(c.relacl::text, '<null>') into v_acl
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'audit_events';

    raise notice 'OK  1. privilege contract; audit_events acl = %', v_acl;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Behavioural: authenticated cannot TRUNCATE / UPDATE / DELETE / INSERT
-- ---------------------------------------------------------------------------
begin;

do $$
declare
    v_denied boolean := false;
begin
    set local role authenticated;
    begin
        execute 'truncate table public.audit_events';
    exception
        when insufficient_privilege then
            v_denied := true;
    end;
    reset role;
    if not v_denied then
        raise exception 'FAIL: authenticated was able to TRUNCATE public.audit_events';
    end if;
    raise notice 'OK  2a. authenticated TRUNCATE denied (insufficient_privilege)';
end;
$$;

do $$
declare
    v_denied boolean := false;
begin
    set local role authenticated;
    begin
        execute 'update public.audit_events set event_type = event_type';
    exception
        when insufficient_privilege then
            v_denied := true;
    end;
    reset role;
    if not v_denied then
        raise exception 'FAIL: authenticated was able to UPDATE public.audit_events';
    end if;
    raise notice 'OK  2b. authenticated UPDATE denied (insufficient_privilege)';
end;
$$;

do $$
declare
    v_denied boolean := false;
begin
    set local role authenticated;
    begin
        execute 'delete from public.audit_events';
    exception
        when insufficient_privilege then
            v_denied := true;
    end;
    reset role;
    if not v_denied then
        raise exception 'FAIL: authenticated was able to DELETE from public.audit_events';
    end if;
    raise notice 'OK  2c. authenticated DELETE denied (insufficient_privilege)';
end;
$$;

do $$
declare
    v_denied boolean := false;
begin
    set local role authenticated;
    begin
        execute 'insert into public.audit_events (event_type, entity_type, entity_id) values (''security.probe'', ''company'', gen_random_uuid())';
    exception
        when insufficient_privilege then
            v_denied := true;
    end;
    reset role;
    if not v_denied then
        raise exception 'FAIL: authenticated was able to INSERT into public.audit_events directly';
    end if;
    raise notice 'OK  2d. authenticated direct INSERT denied (insufficient_privilege)';
end;
$$;

rollback;

-- ---------------------------------------------------------------------------
-- 3. Append-only triggers still present and still the UPDATE/DELETE backstop
-- ---------------------------------------------------------------------------
do $$
declare
    v_count integer;
begin
    select count(*) into v_count
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'audit_events'
      and not t.tgisinternal
      and t.tgname in ('prevent_audit_events_update', 'prevent_audit_events_delete')
      and t.tgenabled = 'O';

    if v_count <> 2 then
        raise exception 'FAIL: expected 2 enabled prevent_audit_* triggers, found %', v_count;
    end if;
    raise notice 'OK  3a. append-only triggers intact (prevent_audit_events_update/delete)';
end;
$$;

-- The triggers remain the backstop for any role that *does* hold UPDATE/DELETE
-- (e.g. service_role). Exercised here as postgres, rolled back.
begin;
do $$
declare
    v_blocked boolean := false;
begin
    if (select count(*) from public.audit_events) = 0 then
        raise notice 'SKIP 3b. audit_events empty; row-trigger backstop not exercised';
        return;
    end if;

    begin
        update public.audit_events set event_type = event_type;
    exception
        when others then
            if sqlerrm like '%append-only%' then
                v_blocked := true;
            else
                raise;
            end if;
    end;

    if not v_blocked then
        raise exception 'FAIL: prevent_audit_mutation did not block UPDATE';
    end if;
    raise notice 'OK  3b. prevent_audit_mutation blocks UPDATE for privileged roles';
end;
$$;
rollback;

-- ---------------------------------------------------------------------------
-- 4. Audit write path still works (rolled back — no fake history retained)
-- ---------------------------------------------------------------------------
begin;
do $$
declare
    v_id uuid;
    v_before bigint;
    v_after bigint;
begin
    select count(*) into v_before from public.audit_events;

    v_id := nora_private.write_audit_event(
        p_event_type  => 'security.hardening.probe',
        p_entity_type => 'company',
        p_entity_id   => gen_random_uuid(),
        p_source      => 'system'
    );

    select count(*) into v_after from public.audit_events;

    if v_id is null or v_after <> v_before + 1 then
        raise exception 'FAIL: audit write path broken (id=%, before=%, after=%)',
            v_id, v_before, v_after;
    end if;
    raise notice 'OK  4. audit write path functional via nora_private.write_audit_event';
end;
$$;
rollback;

-- ---------------------------------------------------------------------------
-- 5. Authorised read path unchanged (admin-only RLS policy still in force)
-- ---------------------------------------------------------------------------
do $$
declare
    v_read integer;
    v_insert integer;
begin
    select count(*) into v_read
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'audit_events'
      and p.polname = 'Audit events read admin only' and p.polcmd = 'r';

    select count(*) into v_insert
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'audit_events'
      and p.polname = 'Audit events insert audit writer' and p.polcmd = 'a';

    if v_read <> 1 or v_insert <> 1 then
        raise exception 'FAIL: audit_events RLS policies changed (read=%, insert=%)', v_read, v_insert;
    end if;

    if not (select relrowsecurity from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = 'audit_events') then
        raise exception 'FAIL: RLS disabled on audit_events';
    end if;

    raise notice 'OK  5. RLS enabled; read/insert policies unchanged';
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Sibling observability tables unchanged
-- ---------------------------------------------------------------------------
do $$
begin
    if has_table_privilege('authenticated', 'public.operation_errors', 'TRUNCATE')
        or has_table_privilege('authenticated', 'public.email_delivery_events', 'TRUNCATE') then
        raise exception 'FAIL: sibling table exposes TRUNCATE to authenticated';
    end if;
    if not has_table_privilege('authenticated', 'public.operation_errors', 'SELECT')
        or not has_table_privilege('authenticated', 'public.email_delivery_events', 'SELECT') then
        raise exception 'FAIL: sibling table lost SELECT for authenticated';
    end if;
    raise notice 'OK  6. operation_errors / email_delivery_events unchanged';
end;
$$;

\echo '=== Security Hardening Wave 0 verification PASSED ==='
