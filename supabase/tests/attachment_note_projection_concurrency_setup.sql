-- W8-C S3B note-attachment projection — REAL-session concurrency fixture.
-- Invoked by attachment_note_projection_concurrency_runner.ps1 with psql
-- variables:
--   mode      init | fixture
--   scenario  scenario / round label, e.g. C1r1
--   kind      C1 .. C9b (fixture mode)
--
-- init    creates the result / context tables (public.s3bh_*), the recorder /
--         coordination functions the workers call, and a harness-only pause
--         hook (BEFORE INSERT on public.attachments) that is INERT unless a
--         session sets s3bh.pause_before. Local test objects only - dropped
--         again by the verify step in cleanup mode.
-- fixture builds the scenario's starting state through the REAL projection
--         (committed note writes) and records ids, arrays, keys and lease
--         tokens in public.s3bh_ctx.
--
-- COORDINATION IS EXPLICIT, NOT TIMED. A holder signals "my operation is done
-- and my transaction is still open" with a transaction-scoped advisory lock
-- (namespace 7305) visible in pg_locks; a follower starts only after that
-- signal; the holder commits only once pg_locks shows a session blocked BY IT
-- (pg_blocking_pids) and records the lock type it waits on. The pause hook
-- stops a statement just before one chosen row is inserted and resumes once
-- the peer has paused too or is blocked by this session - that is how the
-- multi-key and swap interleavings are forced deterministically. Sleeps exist
-- only inside the polling loops; every wait has a timeout that is recorded as
-- a failure, never as success.
--
-- Never point this at Production.

\set ON_ERROR_STOP on

select set_config('s3bh.mode', :'mode', false),
       set_config('s3bh.scenario', :'scenario', false),
       set_config('s3bh.kind', :'kind', false);

do $$
begin
    if current_setting('s3bh.mode') <> 'init' then
        return;
    end if;

    if exists (select 1 from public.attachments where storage_key not like 's3bh-%')
       or exists (select 1 from nora_private.attachment_storage_deletion_queue where storage_key not like 's3bh-%') then
        raise exception 'the local attachment tables hold rows that are not concurrency fixtures - run after a fresh `npx supabase db reset --local`';
    end if;

    drop trigger if exists s3bh_pause_before_insert_trigger on public.attachments;
    drop function if exists public.s3bh_pause();
    drop function if exists public.s3bh_log(text, text, text, text);
    drop function if exists public.s3bh_signal(text, text);
    drop function if exists public.s3bh_signaled(text, text);
    drop function if exists public.s3bh_wait_signal(text, text, text, double precision);
    drop function if exists public.s3bh_wait(text, text, text, double precision);
    drop function if exists public.s3bh_set(text, text, text, bigint, text);
    drop function if exists public.s3bh_delete(text, text, text, bigint);
    drop function if exists public.s3bh_inspect(text, text, bigint, text);
    drop function if exists public.s3bh_el(text);
    drop table if exists public.s3bh_results;
    drop table if exists public.s3bh_ctx;

    create table public.s3bh_results (
        id       bigint generated always as identity,
        scenario text,
        worker   text,
        event    text,     -- SET_OK | DELETE_OK | INSPECT | ERROR | SIGNAL_SEEN | SIGNAL_TIMEOUT |
                           -- WAITER | WAITER_TIMEOUT | EVENT_SEEN | EVENT_TIMEOUT | PAUSED | RESUMED |
                           -- PAUSE_TIMEOUT | RELEASE
        detail   text,
        at       timestamptz default clock_timestamp()
    );
    create table public.s3bh_ctx (scenario text, key text, value text);
    revoke all on public.s3bh_results, public.s3bh_ctx from anon, authenticated, service_role;

    create function public.s3bh_log(p_s text, p_w text, p_e text, p_d text)
    returns void language sql as $f$
        insert into public.s3bh_results (scenario, worker, event, detail) values (p_s, p_w, p_e, p_d);
    $f$;

    create function public.s3bh_el(p_key text)
    returns jsonb language sql immutable as $f$
        select jsonb_build_object('path', p_key, 'title', p_key, 'type', 'application/pdf')
    $f$;

    -- "my operation is done, my transaction is open": visible in pg_locks
    create function public.s3bh_signal(p_s text, p_name text)
    returns void language sql as $f$
        select pg_advisory_xact_lock(7305, hashtext(p_s || ':' || p_name));
    $f$;

    create function public.s3bh_signaled(p_s text, p_name text)
    returns boolean language sql as $f$
        select exists (select 1 from pg_locks
                        where locktype = 'advisory' and granted and pid <> pg_backend_pid()
                          and objsubid = 2 and classid::bigint = 7305
                          and objid::bigint = (hashtext(p_s || ':' || p_name)::bigint & 4294967295));
    $f$;

    -- follower: wait for another session's signal
    create function public.s3bh_wait_signal(p_s text, p_w text, p_name text, p_timeout double precision)
    returns boolean language plpgsql as $f$
    declare
        v_deadline timestamptz := clock_timestamp() + make_interval(secs => p_timeout);
    begin
        loop
            if public.s3bh_signaled(p_s, p_name) then
                perform public.s3bh_log(p_s, p_w, 'SIGNAL_SEEN', p_name);
                return true;
            end if;
            if clock_timestamp() > v_deadline then
                perform public.s3bh_log(p_s, p_w, 'SIGNAL_TIMEOUT', p_name);
                return false;
            end if;
            perform pg_sleep(0.02);
        end loop;
    end;
    $f$;

    -- holder: wait until a session is blocked BY this session ('blocked'), or
    -- until another worker has recorded an event ('event:<worker>:<EVENT>')
    create function public.s3bh_wait(p_s text, p_w text, p_await text, p_timeout double precision)
    returns void language plpgsql as $f$
    declare
        v_deadline timestamptz := clock_timestamp() + make_interval(secs => p_timeout);
        v_types    text;
        v_event    text := substr(p_await, 7);
    begin
        loop
            if p_await = 'blocked' then
                select string_agg(distinct l.locktype, ',') into v_types
                  from pg_locks l
                 where not l.granted and pg_backend_pid() = any (pg_blocking_pids(l.pid));
                if v_types is not null then
                    perform public.s3bh_log(p_s, p_w, 'WAITER', v_types);
                    return;
                end if;
            elsif p_await like 'event:%' then
                if exists (select 1 from public.s3bh_results
                           where scenario = p_s and worker || ':' || event = v_event) then
                    perform public.s3bh_log(p_s, p_w, 'EVENT_SEEN', v_event);
                    return;
                end if;
            else
                raise exception 's3bh_wait: unknown await %', p_await;
            end if;
            if clock_timestamp() > v_deadline then
                perform public.s3bh_log(p_s, p_w, case when p_await = 'blocked' then 'WAITER_TIMEOUT' else 'EVENT_TIMEOUT' end, p_await);
                return;
            end if;
            perform pg_sleep(0.02);
        end loop;
    end;
    $f$;

    -- the note write under test: the array comes from s3bh_ctx (no quoting
    -- through psql variables); the real trigger does the projection
    create function public.s3bh_set(p_s text, p_w text, p_table text, p_id bigint, p_arr_key text)
    returns void language plpgsql as $f$
    declare v_n bigint; v_state text; v_detail text; v_arr jsonb[];
    begin
        select nullif(value, '')::jsonb[] into v_arr from public.s3bh_ctx where scenario = p_s and key = p_arr_key;
        execute format('update public.%I set attachments = $1 where id = $2', p_table) using v_arr, p_id;
        get diagnostics v_n = row_count;
        perform public.s3bh_log(p_s, p_w, 'SET_OK', v_n::text);
    exception when others then
        get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
        perform public.s3bh_log(p_s, p_w, 'ERROR', v_state || '|' || coalesce(v_detail, ''));
    end;
    $f$;

    create function public.s3bh_delete(p_s text, p_w text, p_table text, p_id bigint)
    returns void language plpgsql as $f$
    declare v_n bigint; v_state text; v_detail text;
    begin
        if p_table = 'companies' then
            update public.companies set self_contact_id = null where id = p_id;
        end if;
        execute format('delete from public.%I where id = $1', p_table) using p_id;
        get diagnostics v_n = row_count;
        perform public.s3bh_log(p_s, p_w, 'DELETE_OK', v_n::text);
    exception when others then
        get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
        perform public.s3bh_log(p_s, p_w, 'ERROR', v_state || '|' || coalesce(v_detail, ''));
    end;
    $f$;

    create function public.s3bh_inspect(p_s text, p_w text, p_job bigint, p_token text)
    returns void language plpgsql as $f$
    declare r record; v_state text; v_detail text;
    begin
        select * into r from nora_private.attachment_deletion_inspect(p_job, p_token);
        perform public.s3bh_log(p_s, p_w, 'INSPECT', r.verdict || '|' || r.job_state);
    exception when others then
        get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
        perform public.s3bh_log(p_s, p_w, 'ERROR', v_state || '|' || coalesce(v_detail, ''));
    end;
    $f$;

    -- HARNESS-ONLY pause hook: inert unless the session set s3bh.pause_before.
    -- Fires BEFORE the row (and its unique-index entry) exists, signals
    -- '<worker>-paused', then resumes once the peer paused too or a session
    -- is blocked by this one.
    create function public.s3bh_pause()
    returns trigger language plpgsql as $f$
    declare
        v_key      text := current_setting('s3bh.pause_before', true);
        v_s        text := current_setting('s3bh.scenario', true);
        v_w        text := current_setting('s3bh.worker', true);
        v_peer     text := current_setting('s3bh.peer', true);
        v_timeout  double precision := coalesce(nullif(current_setting('s3bh.timeout', true), ''), '8')::double precision;
        v_deadline timestamptz;
    begin
        if coalesce(v_key, '') = '' or new.storage_key is distinct from v_key then
            return new;
        end if;
        perform public.s3bh_signal(v_s, v_w || '-paused');
        perform public.s3bh_log(v_s, v_w, 'PAUSED', new.storage_key);
        v_deadline := clock_timestamp() + make_interval(secs => v_timeout);
        loop
            exit when public.s3bh_signaled(v_s, v_peer || '-paused');
            exit when exists (select 1 from pg_locks l
                              where not l.granted and pg_backend_pid() = any (pg_blocking_pids(l.pid)));
            if clock_timestamp() > v_deadline then
                perform public.s3bh_log(v_s, v_w, 'PAUSE_TIMEOUT', new.storage_key);
                exit;
            end if;
            perform pg_sleep(0.02);
        end loop;
        perform public.s3bh_log(v_s, v_w, 'RESUMED', new.storage_key);
        return new;
    end;
    $f$;
    create trigger s3bh_pause_before_insert_trigger
        before insert on public.attachments
        for each row execute function public.s3bh_pause();

    revoke all on function public.s3bh_log(text, text, text, text), public.s3bh_el(text),
                           public.s3bh_signal(text, text), public.s3bh_signaled(text, text),
                           public.s3bh_wait_signal(text, text, text, double precision),
                           public.s3bh_wait(text, text, text, double precision),
                           public.s3bh_set(text, text, text, bigint, text),
                           public.s3bh_delete(text, text, text, bigint),
                           public.s3bh_inspect(text, text, bigint, text), public.s3bh_pause()
        from public, anon, authenticated, service_role;
end;
$$;

do $$
declare
    v_s       text := current_setting('s3bh.scenario');
    v_kind    text := current_setting('s3bh.kind');
    v_p       text := 's3bh-' || lower(current_setting('s3bh.scenario')) || '-';
    v_company bigint;
    v_contact bigint;
    v_n1      bigint;
    v_n2      bigint;
    v_job     bigint;
    v_tok     text := gen_random_uuid()::text;
    v_k1 text; v_k2 text; v_k3 text;
begin
    if current_setting('s3bh.mode') <> 'fixture' then
        return;
    end if;
    v_k1 := v_p || 'k1.pdf'; v_k2 := v_p || 'k2.pdf'; v_k3 := v_p || 'k3.pdf';
    if hashtext(v_k1) in (hashtext(v_k2), hashtext(v_k3)) or hashtext(v_k2) = hashtext(v_k3) then
        raise exception 'fixture keys share a lock hash - pick another naming scheme';
    end if;

    -- every scenario: its own company, contact and two contact notes
    insert into public.companies (name) values ('S3BH Concurrency ' || v_s) returning id into v_company;
    insert into public.contacts (first_name, last_name, company_id) values ('S3BH', v_s, v_company) returning id into v_contact;
    insert into public.contact_notes (contact_id, text) values (v_contact, 'S3BH ' || v_s || ' n1') returning id into v_n1;
    insert into public.contact_notes (contact_id, text) values (v_contact, 'S3BH ' || v_s || ' n2') returning id into v_n2;

    if v_kind = 'C1' then
        -- same note: A [K1] -> [K1,K2] (holds), B [K1] -> [K1,K3] (stale form, waits)
        update public.contact_notes set attachments = array[public.s3bh_el(v_k1)] where id = v_n1;
        insert into public.s3bh_ctx values
            (v_s, 'arr_A', array[public.s3bh_el(v_k1), public.s3bh_el(v_k2)]::text),
            (v_s, 'arr_B', array[public.s3bh_el(v_k1), public.s3bh_el(v_k3)]::text);
    elsif v_kind = 'C2' then
        -- different notes, different keys
        insert into public.s3bh_ctx values
            (v_s, 'arr_A', array[public.s3bh_el(v_k1)]::text),
            (v_s, 'arr_B', array[public.s3bh_el(v_k2)]::text);
    elsif v_kind = 'C3' then
        -- two notes add the same new key
        insert into public.s3bh_ctx values
            (v_s, 'arr_A', array[public.s3bh_el(v_k1)]::text),
            (v_s, 'arr_B', array[public.s3bh_el(v_k1)]::text);
    elsif v_kind = 'C4' then
        -- opposite-order multi-key adds on two notes
        insert into public.s3bh_ctx values
            (v_s, 'arr_A', array[public.s3bh_el(v_k1), public.s3bh_el(v_k2)]::text),
            (v_s, 'arr_B', array[public.s3bh_el(v_k2), public.s3bh_el(v_k1)]::text);
    elsif v_kind = 'C5' then
        -- cross-note swap: n1 [K1] -> [K2], n2 [K2] -> [K1]
        update public.contact_notes set attachments = array[public.s3bh_el(v_k1)] where id = v_n1;
        update public.contact_notes set attachments = array[public.s3bh_el(v_k2)] where id = v_n2;
        insert into public.s3bh_ctx values
            (v_s, 'arr_A', array[public.s3bh_el(v_k2)]::text),
            (v_s, 'arr_B', array[public.s3bh_el(v_k1)]::text);
    elsif v_kind = 'C6' then
        -- ADD K vs inspect K: K unreferenced (DEAD) with a claimed intent
        insert into nora_private.attachment_storage_deletion_queue (storage_key, state, attempt_count, claimed_at, claimed_by)
            values (v_k1, 'claimed', 1, now(), v_tok) returning id into v_job;
        insert into public.s3bh_ctx values (v_s, 'arr_B', array[public.s3bh_el(v_k1)]::text);
    elsif v_kind in ('C7a', 'C7b') then
        -- REMOVE K vs inspect K: n1 references K (row), then a claimed intent
        -- for K recorded directly (pre-S3 order, as in the S3A matrix)
        update public.contact_notes set attachments = array[public.s3bh_el(v_k1)] where id = v_n1;
        insert into nora_private.attachment_storage_deletion_queue (storage_key, state, attempt_count, claimed_at, claimed_by)
            values (v_k1, 'claimed', 1, now(), v_tok) returning id into v_job;
        insert into public.s3bh_ctx values (v_s, 'arr_A', '');
    elsif v_kind in ('C8a', 'C8b', 'C9') then
        -- note delete / company cascade vs note edit [K1] -> [K1,K2]
        update public.contact_notes set attachments = array[public.s3bh_el(v_k1)] where id = v_n1;
        insert into public.s3bh_ctx values (v_s, 'arr_A', array[public.s3bh_el(v_k1), public.s3bh_el(v_k2)]::text);
    else
        raise exception 'unknown scenario kind %', v_kind;
    end if;

    insert into public.s3bh_ctx (scenario, key, value) values
        (v_s, 'company', v_company::text), (v_s, 'contact', v_contact::text),
        (v_s, 'n1', v_n1::text), (v_s, 'n2', v_n2::text),
        (v_s, 'k1', v_k1), (v_s, 'k2', v_k2), (v_s, 'k3', v_k3),
        (v_s, 'job', coalesce(v_job::text, '')), (v_s, 'token', v_tok);
end;
$$;
