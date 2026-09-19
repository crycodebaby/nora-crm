-- W8-C S3A storage-key serialization — REAL-session concurrency fixture.
-- Invoked by attachment_reference_serialization_concurrency_runner.ps1 with
-- psql variables:
--   mode      init | fixture
--   scenario  scenario / round label, e.g. C1r1
--   kind      C1 | C2 | C3 | C4 | C5 | C6 (fixture mode)
--
-- init    creates the result / context tables (public.ars_*) and the
--         recorder / coordination functions the workers call, plus one
--         customer -> contact -> contact note that every scenario references.
--         Local test objects only - dropped again by the verify step in
--         cleanup mode.
-- fixture builds the scenario's starting state and records its ids / keys /
--         lease token in public.ars_ctx.
--
-- COORDINATION IS EXPLICIT, NOT TIMED. A holder signals "my operation is done
-- and my transaction is still open" with a transaction-scoped advisory lock
-- (namespace 7304) that other sessions see in pg_locks; a follower starts only
-- after that signal. The holder then commits only once pg_locks shows a
-- session blocked BY IT (pg_blocking_pids), recording the lock type it waits
-- on. Sleeps exist only inside these polling loops; every wait has a timeout
-- that is recorded as a failure, never as success.
--
-- Seeding note: states where a reference to K coexists with an active intent
-- for K cannot be produced through public.attachments any more (W8-C S3A
-- admission, I1). They model pre-S3 / manual-producer state and are built in
-- the only admissible order: the reference first, then the intent recorded
-- directly as postgres.
--
-- Never point this at Production.

\set ON_ERROR_STOP on

select set_config('ars.mode', :'mode', false),
       set_config('ars.scenario', :'scenario', false),
       set_config('ars.kind', :'kind', false);

do $$
begin
    if current_setting('ars.mode') <> 'init' then
        return;
    end if;

    if exists (select 1 from public.attachments where storage_key not like 'ars-%')
       or exists (select 1 from nora_private.attachment_storage_deletion_queue where storage_key not like 'ars-%') then
        raise exception 'the local attachment tables hold rows that are not concurrency fixtures - run after a fresh `npx supabase db reset --local`';
    end if;

    drop function if exists public.ars_log(text, text, text, text);
    drop function if exists public.ars_signal(text, text);
    drop function if exists public.ars_wait_signal(text, text, text, double precision);
    drop function if exists public.ars_wait(text, text, text, double precision);
    drop function if exists public.ars_delete_ref(text, text, text);
    drop function if exists public.ars_insert_ref(text, text, bigint, text);
    drop function if exists public.ars_inspect(text, text, bigint, text);
    drop table if exists public.ars_results;
    drop table if exists public.ars_ctx;

    create table public.ars_results (
        id       bigint generated always as identity,
        scenario text,
        worker   text,
        event    text,     -- DELETE_OK | INSERT_OK | INSPECT | ERROR | SIGNAL_SEEN | SIGNAL_TIMEOUT |
                           -- WAITER | WAITER_TIMEOUT | EVENT_SEEN | EVENT_TIMEOUT | RELEASE
        detail   text,
        at       timestamptz default clock_timestamp()
    );
    create table public.ars_ctx (scenario text, key text, value text);
    revoke all on public.ars_results, public.ars_ctx from anon, authenticated, service_role;

    create function public.ars_log(p_s text, p_w text, p_e text, p_d text)
    returns void language sql as $f$
        insert into public.ars_results (scenario, worker, event, detail) values (p_s, p_w, p_e, p_d);
    $f$;

    -- "my operation is done, my transaction is open": visible in pg_locks
    create function public.ars_signal(p_s text, p_name text)
    returns void language sql as $f$
        select pg_advisory_xact_lock(7304, hashtext(p_s || ':' || p_name));
    $f$;

    -- follower: wait for another session's signal
    create function public.ars_wait_signal(p_s text, p_w text, p_name text, p_timeout double precision)
    returns boolean language plpgsql as $f$
    declare
        v_deadline timestamptz := clock_timestamp() + make_interval(secs => p_timeout);
    begin
        loop
            if exists (select 1 from pg_locks
                       where locktype = 'advisory' and granted and pid <> pg_backend_pid()
                         and objsubid = 2 and classid::bigint = 7304
                         and objid::bigint = (hashtext(p_s || ':' || p_name)::bigint & 4294967295)) then
                perform public.ars_log(p_s, p_w, 'SIGNAL_SEEN', p_name);
                return true;
            end if;
            if clock_timestamp() > v_deadline then
                perform public.ars_log(p_s, p_w, 'SIGNAL_TIMEOUT', p_name);
                return false;
            end if;
            perform pg_sleep(0.02);
        end loop;
    end;
    $f$;

    -- holder: wait until a session is blocked BY this session ('blocked'), or
    -- until another worker has recorded an event ('event:<worker>:<EVENT>')
    create function public.ars_wait(p_s text, p_w text, p_await text, p_timeout double precision)
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
                    perform public.ars_log(p_s, p_w, 'WAITER', v_types);
                    return;
                end if;
            elsif p_await like 'event:%' then
                if exists (select 1 from public.ars_results
                           where scenario = p_s and worker || ':' || event = v_event) then
                    perform public.ars_log(p_s, p_w, 'EVENT_SEEN', v_event);
                    return;
                end if;
            else
                raise exception 'ars_wait: unknown await %', p_await;
            end if;
            if clock_timestamp() > v_deadline then
                perform public.ars_log(p_s, p_w, case when p_await = 'blocked' then 'WAITER_TIMEOUT' else 'EVENT_TIMEOUT' end, p_await);
                return;
            end if;
            perform pg_sleep(0.02);
        end loop;
    end;
    $f$;

    create function public.ars_delete_ref(p_s text, p_w text, p_key text)
    returns void language plpgsql as $f$
    declare v_n bigint; v_state text; v_detail text;
    begin
        delete from public.attachments where storage_key = p_key;
        get diagnostics v_n = row_count;
        perform public.ars_log(p_s, p_w, 'DELETE_OK', v_n::text);
    exception when others then
        get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
        perform public.ars_log(p_s, p_w, 'ERROR', v_state || '|' || coalesce(v_detail, ''));
    end;
    $f$;

    create function public.ars_insert_ref(p_s text, p_w text, p_note bigint, p_key text)
    returns void language plpgsql as $f$
    declare v_state text; v_detail text;
    begin
        insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
            values (p_note, p_key, 'race.pdf', 'application/pdf');
        perform public.ars_log(p_s, p_w, 'INSERT_OK', p_key);
    exception when others then
        get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
        perform public.ars_log(p_s, p_w, 'ERROR', v_state || '|' || coalesce(v_detail, ''));
    end;
    $f$;

    create function public.ars_inspect(p_s text, p_w text, p_job bigint, p_token text)
    returns void language plpgsql as $f$
    declare r record; v_state text; v_detail text;
    begin
        select * into r from nora_private.attachment_deletion_inspect(p_job, p_token);
        perform public.ars_log(p_s, p_w, 'INSPECT', r.verdict || '|' || r.job_state);
    exception when others then
        get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
        perform public.ars_log(p_s, p_w, 'ERROR', v_state || '|' || coalesce(v_detail, ''));
    end;
    $f$;

    revoke all on function public.ars_log(text, text, text, text), public.ars_signal(text, text),
                           public.ars_wait_signal(text, text, text, double precision),
                           public.ars_wait(text, text, text, double precision),
                           public.ars_delete_ref(text, text, text), public.ars_insert_ref(text, text, bigint, text),
                           public.ars_inspect(text, text, bigint, text)
        from public, anon, authenticated, service_role;

    -- one note every scenario references
    with c as (insert into public.companies (name) values ('ARS Concurrency Kunde') returning id),
         p as (insert into public.contacts (first_name, last_name, company_id) select 'Ars', 'Race', id from c returning id),
         n as (insert into public.contact_notes (contact_id, text) select id, 'ARS race note' from p returning id)
    insert into public.ars_ctx (scenario, key, value)
    select '*', 'note', id::text from n
    union all select '*', 'company', (select id::text from c);
end;
$$;

do $$
declare
    v_s    text := current_setting('ars.scenario');
    v_kind text := current_setting('ars.kind');
    v_note bigint;
    v_k    text;
    v_k2   text;
    v_job  bigint;
    v_tok  text := gen_random_uuid()::text;
begin
    if current_setting('ars.mode') <> 'fixture' then
        return;
    end if;
    select value::bigint into v_note from public.ars_ctx where scenario = '*' and key = 'note';
    v_k  := 'ars-' || lower(v_s) || '-k.pdf';
    v_k2 := 'ars-' || lower(v_s) || '-k2.pdf';
    if hashtext(v_k) = hashtext(v_k2) then
        raise exception 'fixture keys share a lock hash - pick another naming scheme';
    end if;

    if v_kind in ('C1', 'C2') then
        -- live row-backed reference K + active claimed intent J for K (pre-S3 order)
        insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
            values (v_note, v_k, 'race.pdf', 'application/pdf');
        insert into nora_private.attachment_storage_deletion_queue (storage_key, state, attempt_count, claimed_at, claimed_by)
            values (v_k, 'claimed', 1, now(), v_tok) returning id into v_job;
    elsif v_kind in ('C3', 'C4') then
        -- active claimed intent J for K, K currently unreferenced (DEAD)
        insert into nora_private.attachment_storage_deletion_queue (storage_key, state, attempt_count, claimed_at, claimed_by)
            values (v_k, 'claimed', 1, now(), v_tok) returning id into v_job;
    elsif v_kind = 'C5' then
        -- live reference K, no intent yet
        insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
            values (v_note, v_k, 'race.pdf', 'application/pdf');
    elsif v_kind = 'C6' then
        -- two live references on DIFFERENT keys
        insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
            values (v_note, v_k, 'race.pdf', 'application/pdf'),
                   (v_note, v_k2, 'race.pdf', 'application/pdf');
    else
        raise exception 'unknown scenario kind %', v_kind;
    end if;

    insert into public.ars_ctx (scenario, key, value) values
        (v_s, 'key', v_k), (v_s, 'key2', v_k2), (v_s, 'note', v_note::text),
        (v_s, 'job', coalesce(v_job::text, '')), (v_s, 'token', v_tok);
end;
$$;
