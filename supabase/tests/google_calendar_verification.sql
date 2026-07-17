-- Nora CRM v0.4c.1 — Google Calendar read-only foundation verification
-- Run after rbac_rls_setup.sql
-- Usage:
--   Get-Content supabase/tests/google_calendar_verification.sql -Raw | docker exec -i supabase_db_atomic-crm-demo psql -U postgres -d postgres

\set ON_ERROR_STOP on

\echo '=== Google Calendar v0.4c.2 verification ==='

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'nora_calendar_writer') then
        raise exception 'nora_calendar_writer role missing';
    end if;
    if exists (
        select 1 from pg_roles
        where rolname = 'nora_calendar_writer' and (rolcanlogin or rolbypassrls)
    ) then
        raise exception 'nora_calendar_writer must be NOLOGIN NOBYPASSRLS';
    end if;
    if pg_has_role('authenticated', 'nora_calendar_writer', 'member') then
        raise exception 'authenticated must not be member of nora_calendar_writer';
    end if;
    if not exists (select 1 from pg_roles where rolname = 'nora_calendar_linker') then
        raise exception 'nora_calendar_linker role missing';
    end if;
    if exists (
        select 1 from pg_roles
        where rolname = 'nora_calendar_linker' and (rolcanlogin or rolbypassrls)
    ) then
        raise exception 'nora_calendar_linker must be NOLOGIN NOBYPASSRLS';
    end if;
    if pg_has_role('authenticated', 'nora_calendar_linker', 'member') then
        raise exception 'authenticated must not be member of nora_calendar_linker';
    end if;
end;
$$;

-- Allowlist for tests
do $$
begin
    update public.configuration
    set config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
        'google_calendar',
        jsonb_build_object(
            'allowed_calendar_ids',
            jsonb_build_array('test-allowed-cal@group.calendar.google.com')
        )
    )
    where id = 1;

    if not found then
        insert into public.configuration (id, config)
        values (
            1,
            jsonb_build_object(
                'google_calendar',
                jsonb_build_object(
                    'allowed_calendar_ids',
                    jsonb_build_array('test-allowed-cal@group.calendar.google.com')
                )
            )
        );
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Singleton connection + allowlist
-- ---------------------------------------------------------------------------

do $$
declare
    v_conn1 uuid;
    v_conn2 uuid;
    v_admin uuid := 'b1000000-0000-4000-8000-000000000001';
begin
    delete from public.google_calendar_events;
    delete from public.google_calendar_connections;

    insert into public.google_calendar_connections (
        calendar_id, calendar_name, status, connected_by
    )
    values (
        'test-allowed-cal@group.calendar.google.com',
        'Test Kalender',
        'connected',
        v_admin
    )
    returning id into v_conn1;

    begin
        insert into public.google_calendar_connections (
            calendar_id, status
        )
        values (
            'test-allowed-cal@group.calendar.google.com',
            'connected'
        );
        raise exception 'second connected calendar must fail';
    exception
        when others then
            if sqlerrm not like '%only one connected%'
                and sqlerrm not like '%unique%'
                and sqlerrm not like '%duplicate key%' then
                raise;
            end if;
    end;

    begin
        insert into public.google_calendar_connections (
            calendar_id, status
        )
        values (
            'foreign-cal@group.calendar.google.com',
            'disconnected'
        );
        raise exception 'foreign calendar_id must fail allowlist';
    exception
        when others then
            if sqlerrm not like '%allowlist%' then
                raise;
            end if;
    end;

    insert into public.google_calendar_connections (
        calendar_id, status
    )
    values (
        'test-allowed-cal@group.calendar.google.com',
        'disconnected'
    )
    returning id into v_conn2;
end;
$$;

-- ---------------------------------------------------------------------------
-- Event constraints + uniqueness + FK bigint + entity delete
-- ---------------------------------------------------------------------------

do $$
declare
    v_conn uuid;
    v_event uuid;
    v_event2 uuid;
    v_company_id bigint;
    v_deal_id bigint;
    v_count int;
    v_office uuid := 'b1000000-0000-4000-8000-000000000002';
begin
    select id into v_conn
    from public.google_calendar_connections
    where status = 'connected'
    limit 1;

    insert into public.companies (name, customer_number, city)
    values ('Cal Link Co', 'KD-999950', 'Düsseldorf')
    returning id into v_company_id;

    insert into public.deals (name, stage, company_id, case_number)
    values ('Cal Deal', 'opportunity', v_company_id, 'VG-9999-000050')
    returning id into v_deal_id;

    set local role nora_calendar_writer;

    insert into public.google_calendar_events (
        connection_id, google_event_id, origin, is_all_day,
        start_date, end_date, title_snapshot
    )
    values (
        v_conn, 'evt-all-day-1', 'google', true,
        current_date, current_date + 1, 'Ganztag Test'
    )
    returning id into v_event;

    begin
        insert into public.google_calendar_events (
            connection_id, google_event_id, origin, is_all_day,
            starts_at, ends_at, title_snapshot
        )
        values (
            v_conn, 'evt-bad-mixed', 'google', true,
            now(), now() + interval '1 hour', 'Invalid mixed'
        );
        raise exception 'all-day with timestamps must fail';
    exception
        when check_violation then
            null;
    end;

    begin
        insert into public.google_calendar_events (
            connection_id, google_event_id, origin, is_all_day,
            starts_at, ends_at, title_snapshot
        )
        values (
            v_conn, 'evt-bad-timed', 'google', false,
            null, null, 'Invalid timed'
        );
        raise exception 'timed without timestamps must fail';
    exception
        when check_violation then
            null;
    end;

    insert into public.google_calendar_events (
        connection_id, google_event_id, origin, is_all_day,
        starts_at, ends_at, title_snapshot
    )
    values (
        v_conn, 'evt-timed-1', 'google', false,
        now(), now() + interval '1 hour', 'Timed Test'
    )
    returning id into v_event2;

    begin
        insert into public.google_calendar_events (
            connection_id, google_event_id, origin, is_all_day,
            starts_at, ends_at
        )
        values (
            v_conn, 'evt-timed-1', 'google', false,
            now(), now() + interval '2 hours'
        );
        raise exception 'duplicate google_event_id per connection must fail';
    exception
        when unique_violation then
            null;
    end;

    reset role;

    set local role nora_rls_test;
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', v_office::text, true);

    perform public.link_google_calendar_event(v_event, p_company_id := v_company_id, p_deal_id := v_deal_id);

    reset role;

    select count(*) into v_count
    from public.audit_events
    where event_type = 'calendar.event_linked'
      and entity_id = v_event;
    if v_count <> 1 then
        raise exception 'calendar.event_linked audit expected 1, got %', v_count;
    end if;

    if exists (
        select 1 from public.audit_events
        where event_type = 'calendar.event_linked'
          and (
              metadata::text ilike '%refresh_token%'
              or metadata::text ilike '%access_token%'
          )
    ) then
        raise exception 'audit must not contain tokens';
    end if;

    delete from public.deals where id = v_deal_id;

    select deal_id into v_deal_id
    from public.google_calendar_events
    where id = v_event;
    if v_deal_id is not null then
        raise exception 'deal delete must set deal_id null on cache event';
    end if;

    select count(*) into v_count
    from public.google_calendar_events
    where id = v_event;
    if v_count <> 1 then
        raise exception 'cache event must survive deal delete';
    end if;

    delete from public.companies where id = v_company_id;
    delete from public.google_calendar_events where connection_id = v_conn;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS: anon, viewer read, office no connection, no direct cache writes
-- ---------------------------------------------------------------------------

do $$
declare
    v_admin uuid := 'b1000000-0000-4000-8000-000000000001';
    v_office uuid := 'b1000000-0000-4000-8000-000000000002';
    v_viewer uuid := 'b1000000-0000-4000-8000-000000000003';
    v_conn uuid;
    v_event uuid;
    v_company_id bigint;
    v_audit_count int;
begin
    select id into v_conn
    from public.google_calendar_connections
    where status = 'connected'
    limit 1;

    set local role nora_calendar_writer;
    insert into public.google_calendar_events (
        connection_id, google_event_id, origin, is_all_day,
        starts_at, ends_at, title_snapshot
    )
    values (
        v_conn, 'evt-rls-1', 'google', false,
        now(), now() + interval '1 hour', 'RLS Test'
    )
    returning id into v_event;
    reset role;

    insert into public.companies (name, customer_number, city)
    values ('RLS Cal Co', 'KD-999951', 'Neuss')
    returning id into v_company_id;

    set local role anon;
    begin
        perform count(*) from public.google_calendar_events;
        raise exception 'anon must not read calendar events';
    exception
        when insufficient_privilege then
            null;
        when others then
            if sqlerrm not like '%permission denied%'
                and sqlerrm not like '%row-level security%' then
                raise;
            end if;
    end;

    set local role nora_rls_test;
    set local role authenticated;

    perform set_config('request.jwt.claim.sub', v_viewer::text, true);
    perform count(*) from public.google_calendar_events;

    if exists (select 1 from public.google_calendar_connections) then
        raise exception 'viewer must not read connections';
    end if;

    begin
        perform public.link_google_calendar_event(v_event, p_company_id := v_company_id);
        raise exception 'viewer must not link calendar events';
    exception
        when others then
            if sqlerrm not like '%forbidden%' then
                raise;
            end if;
    end;

    perform set_config('request.jwt.claim.sub', v_office::text, true);
    perform count(*) from public.google_calendar_events;

    if exists (select 1 from public.google_calendar_connections) then
        raise exception 'office must not read connections';
    end if;

    begin
        insert into public.google_calendar_events (
            connection_id, google_event_id, origin, is_all_day,
            starts_at, ends_at
        )
        values (
            v_conn, 'evt-office-insert', 'google', false,
            now(), now() + interval '1 hour'
        );
        raise exception 'office must not insert cache events';
    exception
        when others then
            if sqlerrm not like '%read-only%'
                and sqlerrm not like '%permission denied%'
                and sqlerrm not like '%row-level security%' then
                raise;
            end if;
    end;

    perform public.link_google_calendar_event(v_event, p_company_id := v_company_id);

    perform public.unlink_google_calendar_event(v_event);

    reset role;

    select count(*) into v_audit_count
    from public.audit_events
    where event_type in ('calendar.event_linked', 'calendar.event_unlinked')
      and entity_id = v_event;
    if v_audit_count < 2 then
        raise exception 'link/unlink audit events missing';
    end if;

    set local role nora_rls_test;
    set local role authenticated;

    perform set_config('request.jwt.claim.sub', v_admin::text, true);
    perform count(*) from public.google_calendar_connections;

    begin
        insert into public.google_calendar_events (
            connection_id, google_event_id, origin, is_all_day,
            starts_at, ends_at
        )
        values (
            v_conn, 'evt-admin-insert', 'google', false,
            now(), now() + interval '1 hour'
        );
        raise exception 'admin must not insert cache events directly';
    exception
        when others then
            if sqlerrm not like '%read-only%'
                and sqlerrm not like '%permission denied%'
                and sqlerrm not like '%row-level security%' then
                raise;
            end if;
    end;

    reset role;
    delete from public.companies where customer_number = 'KD-999951';
    delete from public.google_calendar_events where id = v_event;
end;
$$;

-- ---------------------------------------------------------------------------
-- Token tables must stay empty in v0.4c.1; secrets table exists but locked
-- ---------------------------------------------------------------------------

do $$
begin
    if exists (select 1 from nora_private.google_calendar_oauth_secrets) then
        raise exception 'oauth secrets must be empty in v0.4c.1 seed';
    end if;

    if has_table_privilege('authenticated', 'nora_private.google_calendar_oauth_secrets', 'SELECT') then
        raise exception 'authenticated must not SELECT oauth secrets';
    end if;

    if has_table_privilege('anon', 'public.google_calendar_events', 'SELECT') then
        raise exception 'anon must not SELECT google_calendar_events';
    end if;
end;
$$;

-- Backend capability write path
do $$
declare
    v_conn uuid;
    v_count int;
begin
    select id into v_conn
    from public.google_calendar_connections
    where status = 'connected'
    limit 1;

    set local role nora_calendar_writer;

    insert into public.google_calendar_events (
        connection_id, google_event_id, origin, is_all_day,
        starts_at, ends_at, title_snapshot, description_snapshot
    )
    values (
        v_conn, 'evt-writer-1', 'google', false,
        now(), now() + interval '30 minutes',
        'Writer Test',
        repeat('x', 501)
    );
    raise exception 'description_snapshot > 500 must fail';
exception
    when check_violation then
        null;
    when others then
        if sqlerrm not like '%description_snapshot%' and sqlerrm not like '%check%' then
            raise;
        end if;
end;
$$;

do $$
declare
    v_conn uuid;
begin
    select id into v_conn
    from public.google_calendar_connections
    where status = 'connected'
    limit 1;

    set local role nora_calendar_writer;

    insert into public.google_calendar_events (
        connection_id, google_event_id, origin, is_all_day,
        starts_at, ends_at, title_snapshot
    )
    values (
        v_conn, 'evt-writer-1', 'google', false,
        now(), now() + interval '30 minutes',
        'Writer Test'
    );

    reset role;
end;
$$;

-- OAuth state + encrypted token RPCs (no plaintext in DB tables accessible to app roles)
do $$
declare
    v_admin uuid := 'b1000000-0000-4000-8000-000000000001';
    v_state_id uuid;
    v_user uuid;
    v_verifier text;
    v_conn uuid;
begin
    delete from nora_private.google_oauth_states;

    v_state_id := public.store_google_oauth_state(
        v_admin,
        'hash-state-1',
        now() + interval '5 minutes',
        'pkce-verifier-abc'
    );

    if v_state_id is null then
        raise exception 'store_google_oauth_state failed';
    end if;

    select user_id, pkce_verifier
    into v_user, v_verifier
    from public.consume_google_oauth_state('hash-state-1');

    if v_user <> v_admin or v_verifier <> 'pkce-verifier-abc' then
        raise exception 'consume_google_oauth_state failed';
    end if;

    if exists (select 1 from public.consume_google_oauth_state('hash-state-1')) then
        raise exception 'oauth state must be single-use';
    end if;

    select id into v_conn
    from public.google_calendar_connections
    where status = 'connected'
    limit 1;

    perform public.store_google_calendar_refresh_token(
        v_conn,
        'cipher-1',
        'nonce-1',
        'v1',
        false
    );

    perform public.store_google_calendar_refresh_token(
        v_conn,
        'cipher-2',
        'nonce-2',
        'v1',
        true
    );

    if not exists (
        select 1
        from public.load_google_calendar_refresh_token(v_conn)
        where refresh_token_ciphertext = 'cipher-1'
          and nonce = 'nonce-1'
    ) then
        raise exception 'preserve_existing must keep first ciphertext';
    end if;

    if has_function_privilege('authenticated', 'public.load_google_calendar_refresh_token(uuid)', 'EXECUTE') then
        raise exception 'authenticated must not load refresh tokens';
    end if;
end;
$$;

select 'google_calendar_verification: OK' as result;
