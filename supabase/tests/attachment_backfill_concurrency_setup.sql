-- W8-C S4 historical attachment backfill — REAL-session concurrency fixture.
-- Invoked by attachment_backfill_concurrency_runner.ps1 with psql variables:
--   mode      init | fixture | arm_job | drain_check
--   scenario  scenario / round label, e.g. C1r1
--   kind      C1 .. C15 (fixture mode)
--
-- init    creates the result / context tables (public.s4h_*), the recorder and
--         coordination functions the workers call, and TWO harness-only pause
--         hooks on public.attachments that are INERT unless a session sets
--         s4h.pause_before / s4h.pause_after. Local test objects only - removed
--         again by the verify step in cleanup mode.
-- fixture wipes the previous scenario, then builds this scenario's starting
--         state: LEGACY notes (attachment array planted with the S3B projection
--         trigger switched off, so the note carries attachments and owns NO
--         row) plus ids, arrays, keys and lease tokens in public.s4h_ctx.
-- arm_job records a claimed deletion intent while a worker is paused - the only
--         way to get "S4 took the key lock first, inspect second".
--
-- COORDINATION IS EXPLICIT, NOT TIMED. A holder signals "my operation is done
-- and my transaction is still open" with a transaction-scoped advisory lock
-- (namespace 7405) visible in pg_locks; a follower starts only after that
-- signal; a holder releases only once pg_locks shows a session blocked BY IT
-- (pg_blocking_pids), or once a named event was recorded, and it records what
-- it waited on. The pause hooks stop the backfill transaction in the middle -
-- before its first attachment row exists (pause_before), or after that row and
-- its S3A key lock exist (pause_after, which sorts AFTER the admission trigger
-- and therefore runs after it). Sleeps exist only inside polling loops; every
-- wait has a timeout that is recorded as a failure, never as success.
--
-- Never point this at Production.

\set ON_ERROR_STOP on

select set_config('s4h.mode', :'mode', false),
       set_config('s4h.scenario', :'scenario', false),
       set_config('s4h.kind', :'kind', false);

do $$
begin
    if current_setting('s4h.mode') <> 'init' then
        return;
    end if;

    if exists (select 1 from public.attachments where storage_key not like 's4h-%')
       or exists (select 1 from nora_private.attachment_storage_deletion_queue where storage_key not like 's4h-%') then
        raise exception 'the local attachment tables hold rows that are not concurrency fixtures - run after a fresh `npx supabase db reset --local`';
    end if;

    drop trigger if exists s4h_pause_before_insert_trigger on public.attachments;
    drop trigger if exists s4h_pause_after_insert_trigger on public.attachments;
    drop function if exists public.s4h_pause();
    drop function if exists public.s4h_log(text, text, text, text);
    drop function if exists public.s4h_signal(text, text);
    drop function if exists public.s4h_signaled(text, text);
    drop function if exists public.s4h_wait_signal(text, text, text, double precision);
    drop function if exists public.s4h_wait(text, text, text, double precision);
    drop function if exists public.s4h_set(text, text, text, bigint, text);
    drop function if exists public.s4h_text(text, text, text, bigint);
    drop function if exists public.s4h_delete(text, text, text, bigint);
    drop function if exists public.s4h_inspect(text, text, bigint, text);
    drop function if exists public.s4h_record(text, text, text, text);
    drop function if exists public.s4h_el(text);
    drop function if exists public.s4h_plant(text, bigint, jsonb[]);
    drop table if exists public.s4h_results;
    drop table if exists public.s4h_ctx;

    create table public.s4h_results (
        id       bigint generated always as identity,
        scenario text,
        worker   text,
        event    text,   -- S4 | SET_OK | TEXT_OK | DELETE_OK | INSPECT | ERROR |
                         -- SIGNAL_SEEN | SIGNAL_TIMEOUT | WAITER | WAITER_TIMEOUT |
                         -- EVENT_SEEN | EVENT_TIMEOUT | PAUSED | RESUMED |
                         -- PAUSE_TIMEOUT | RELEASE
        detail   text,
        at       timestamptz default clock_timestamp()
    );
    create table public.s4h_ctx (scenario text, key text, value text);
    revoke all on public.s4h_results, public.s4h_ctx from anon, authenticated, service_role;

    create function public.s4h_log(p_s text, p_w text, p_e text, p_d text)
    returns void language sql as $f$
        insert into public.s4h_results (scenario, worker, event, detail) values (p_s, p_w, p_e, p_d);
    $f$;

    create function public.s4h_el(p_key text)
    returns jsonb language sql immutable as $f$
        select jsonb_build_object('path', p_key, 'title', p_key, 'type', 'application/pdf')
    $f$;

    -- LEGACY planting: the array is set with the S3B projection trigger off, so
    -- the note looks exactly like a pre-S3B historical note.
    create function public.s4h_plant(p_table text, p_id bigint, p_arr jsonb[])
    returns void language plpgsql as $f$
    declare v_trg text := case p_table when 'contact_notes' then 'project_contact_note_attachments_after_update_trigger'
                                       else 'project_deal_note_attachments_after_update_trigger' end;
    begin
        execute format('alter table public.%I disable trigger %I', p_table, v_trg);
        execute format('update public.%I set attachments = $1 where id = $2', p_table) using p_arr, p_id;
        execute format('alter table public.%I enable trigger %I', p_table, v_trg);
    end;
    $f$;

    -- "my operation is done, my transaction is open": visible in pg_locks
    create function public.s4h_signal(p_s text, p_name text)
    returns void language sql as $f$
        select pg_advisory_xact_lock(7405, hashtext(p_s || ':' || p_name));
    $f$;

    create function public.s4h_signaled(p_s text, p_name text)
    returns boolean language sql as $f$
        select exists (select 1 from pg_locks
                        where locktype = 'advisory' and granted and pid <> pg_backend_pid()
                          and objsubid = 2 and classid::bigint = 7405
                          and objid::bigint = (hashtext(p_s || ':' || p_name)::bigint & 4294967295));
    $f$;

    create function public.s4h_wait_signal(p_s text, p_w text, p_name text, p_timeout double precision)
    returns boolean language plpgsql as $f$
    declare v_deadline timestamptz := clock_timestamp() + make_interval(secs => p_timeout);
    begin
        if coalesce(p_name, '') = '' then
            return true;
        end if;
        loop
            if public.s4h_signaled(p_s, p_name) then
                perform public.s4h_log(p_s, p_w, 'SIGNAL_SEEN', p_name);
                return true;
            end if;
            if clock_timestamp() > v_deadline then
                perform public.s4h_log(p_s, p_w, 'SIGNAL_TIMEOUT', p_name);
                return false;
            end if;
            perform pg_sleep(0.02);
        end loop;
    end;
    $f$;

    -- holder: 'blocked' (a session is blocked BY this one), 'event:<w>:<E>'
    -- (another worker recorded that event) or 'seconds:<n>' (hold at least n
    -- seconds - the only place a duration is the point, for the lock timeout).
    create function public.s4h_wait(p_s text, p_w text, p_await text, p_timeout double precision)
    returns void language plpgsql as $f$
    declare
        v_deadline timestamptz := clock_timestamp() + make_interval(secs => p_timeout);
        v_types    text;
        v_event    text := substr(p_await, 7);
    begin
        if coalesce(p_await, '') = '' then
            return;
        end if;
        if p_await like 'seconds:%' then
            perform pg_sleep(substr(p_await, 9)::double precision);
            perform public.s4h_log(p_s, p_w, 'RESUMED', p_await);
            return;
        end if;
        loop
            if p_await = 'blocked' then
                select string_agg(distinct l.locktype, ',') into v_types
                  from pg_locks l
                 where not l.granted and pg_backend_pid() = any (pg_blocking_pids(l.pid));
                if v_types is not null then
                    perform public.s4h_log(p_s, p_w, 'WAITER', v_types);
                    return;
                end if;
            elsif p_await like 'event:%' then
                if exists (select 1 from public.s4h_results
                           where scenario = p_s and worker || ':' || event = v_event) then
                    perform public.s4h_log(p_s, p_w, 'EVENT_SEEN', v_event);
                    return;
                end if;
            else
                raise exception 's4h_wait: unknown await %', p_await;
            end if;
            if clock_timestamp() > v_deadline then
                perform public.s4h_log(p_s, p_w, case when p_await = 'blocked' then 'WAITER_TIMEOUT' else 'EVENT_TIMEOUT' end, p_await);
                return;
            end if;
            perform pg_sleep(0.02);
        end loop;
    end;
    $f$;

    -- a user attachment write: the array comes from s4h_ctx, the REAL S3B
    -- trigger does the projection
    create function public.s4h_set(p_s text, p_w text, p_table text, p_id bigint, p_arr_key text)
    returns void language plpgsql as $f$
    declare v_n bigint; v_state text; v_detail text; v_arr jsonb[];
    begin
        select nullif(value, '')::jsonb[] into v_arr from public.s4h_ctx where scenario = p_s and key = p_arr_key;
        execute format('update public.%I set attachments = $1 where id = $2', p_table) using v_arr, p_id;
        get diagnostics v_n = row_count;
        perform public.s4h_log(p_s, p_w, 'SET_OK', v_n::text);
    exception when others then
        get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
        perform public.s4h_log(p_s, p_w, 'ERROR', v_state || '|' || coalesce(v_detail, ''));
    end;
    $f$;

    -- a body-only edit: the projection trigger must not even fire
    create function public.s4h_text(p_s text, p_w text, p_table text, p_id bigint)
    returns void language plpgsql as $f$
    declare v_n bigint; v_state text; v_detail text;
    begin
        execute format('update public.%I set text = %L where id = $1', p_table, 'S4H body edit') using p_id;
        get diagnostics v_n = row_count;
        perform public.s4h_log(p_s, p_w, 'TEXT_OK', v_n::text);
    exception when others then
        get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
        perform public.s4h_log(p_s, p_w, 'ERROR', v_state || '|' || coalesce(v_detail, ''));
    end;
    $f$;

    create function public.s4h_delete(p_s text, p_w text, p_table text, p_id bigint)
    returns void language plpgsql as $f$
    declare v_n bigint; v_state text; v_detail text;
    begin
        if p_table = 'companies' then
            update public.companies set self_contact_id = null where id = p_id;
        end if;
        execute format('delete from public.%I where id = $1', p_table) using p_id;
        get diagnostics v_n = row_count;
        perform public.s4h_log(p_s, p_w, 'DELETE_OK', v_n::text);
    exception when others then
        get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
        perform public.s4h_log(p_s, p_w, 'ERROR', v_state || '|' || coalesce(v_detail, ''));
    end;
    $f$;

    create function public.s4h_inspect(p_s text, p_w text, p_job bigint, p_token text)
    returns void language plpgsql as $f$
    declare r record; v_state text; v_detail text;
    begin
        select * into r from nora_private.attachment_deletion_inspect(p_job, p_token);
        perform public.s4h_log(p_s, p_w, 'INSPECT', r.verdict || '|' || r.job_state);
    exception when others then
        get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
        perform public.s4h_log(p_s, p_w, 'ERROR', v_state || '|' || coalesce(v_detail, ''));
    end;
    $f$;

    -- what the REAL runner file did in this session: its committed outcome, or
    -- the SQLSTATE / DETAIL of the error that rolled it back
    create function public.s4h_record(p_s text, p_w text, p_state text, p_msg text)
    returns void language plpgsql as $f$
    begin
        if coalesce(p_state, '00000') = '00000' then
            perform public.s4h_log(p_s, p_w, 'S4',
                coalesce(current_setting('nora.s4_backfill_outcome', true), '<unset>'));
        else
            perform public.s4h_log(p_s, p_w, 'ERROR', p_state || '|' || coalesce(p_msg, ''));
        end if;
    end;
    $f$;

    -- HARNESS-ONLY pause hooks: inert unless the session set s4h.pause_before /
    -- s4h.pause_after. BEFORE fires while neither the row nor its unique index
    -- entry exists; AFTER sorts behind
    -- guard_attachment_reference_admission_after_insert_trigger, so by then the
    -- row AND its S3A storage-key lock are held. Each signals
    -- '<worker>-paused', then waits per s4h.await.
    create function public.s4h_pause()
    returns trigger language plpgsql as $f$
    declare
        v_key     text := current_setting(case when tg_when = 'BEFORE' then 's4h.pause_before' else 's4h.pause_after' end, true);
        v_s       text := current_setting('s4h.scenario', true);
        v_w       text := current_setting('s4h.worker', true);
        v_await   text := current_setting('s4h.await', true);
        v_timeout double precision := coalesce(nullif(current_setting('s4h.timeout', true), ''), '8')::double precision;
    begin
        if coalesce(v_key, '') = '' or new.storage_key is distinct from v_key then
            return new;
        end if;
        perform public.s4h_signal(v_s, v_w || '-paused');
        perform public.s4h_log(v_s, v_w, 'PAUSED', tg_when || ':' || new.storage_key);
        perform public.s4h_wait(v_s, v_w, coalesce(nullif(v_await, ''), 'blocked'), v_timeout);
        perform public.s4h_log(v_s, v_w, 'RESUMED', tg_when || ':' || new.storage_key);
        return new;
    end;
    $f$;
    create trigger s4h_pause_before_insert_trigger
        before insert on public.attachments
        for each row execute function public.s4h_pause();
    create trigger s4h_pause_after_insert_trigger
        after insert on public.attachments
        for each row execute function public.s4h_pause();

    revoke all on function public.s4h_log(text, text, text, text), public.s4h_el(text),
                           public.s4h_plant(text, bigint, jsonb[]),
                           public.s4h_signal(text, text), public.s4h_signaled(text, text),
                           public.s4h_wait_signal(text, text, text, double precision),
                           public.s4h_wait(text, text, text, double precision),
                           public.s4h_set(text, text, text, bigint, text),
                           public.s4h_text(text, text, text, bigint),
                           public.s4h_delete(text, text, text, bigint),
                           public.s4h_inspect(text, text, bigint, text),
                           public.s4h_record(text, text, text, text), public.s4h_pause()
        from public, anon, authenticated, service_role;
end;
$$;

-- ---------------------------------------------------------------------------
-- fixture
-- ---------------------------------------------------------------------------
do $$
declare
    v_s       text := current_setting('s4h.scenario');
    v_kind    text := current_setting('s4h.kind');
    v_p       text := 's4h-' || lower(current_setting('s4h.scenario')) || '-';
    v_company bigint;
    v_contact bigint;
    v_deal    bigint;
    v_n1      bigint;
    v_n2      bigint;
    v_dn1     bigint;
    v_job     bigint;
    v_tok     text := gen_random_uuid()::text;
    v_k1 text; v_k2 text; v_k3 text;
begin
    if current_setting('s4h.mode') <> 'fixture' then
        return;
    end if;
    -- a scenario may be built more than once; its context must not accumulate
    delete from public.s4h_ctx where scenario = v_s;
    v_k1 := v_p || 'k1.pdf'; v_k2 := v_p || 'k2.pdf'; v_k3 := v_p || 'k3.pdf';
    if hashtext(v_k1) in (hashtext(v_k2), hashtext(v_k3)) or hashtext(v_k2) = hashtext(v_k3) then
        raise exception 'fixture keys share a lock hash - pick another naming scheme';
    end if;

    -- the previous scenario must not leave a candidate behind: S4 selects its
    -- own note, so a leftover would be picked up instead of this fixture's
    update public.companies set self_contact_id = null where name like 'S4H Backfill %';
    delete from public.companies where name like 'S4H Backfill %';
    delete from nora_private.attachment_storage_deletion_queue where storage_key like 's4h-%';
    if exists (select 1 from public.contact_notes where coalesce(cardinality(attachments), 0) > 0)
       or exists (select 1 from public.deal_notes where coalesce(cardinality(attachments), 0) > 0)
       or exists (select 1 from public.attachments) then
        raise exception 'the database still holds notes with attachments or attachment rows - the previous scenario did not clean up';
    end if;

    insert into public.companies (name) values ('S4H Backfill ' || v_s) returning id into v_company;
    insert into public.contacts (first_name, last_name, company_id) values ('S4H', v_s, v_company) returning id into v_contact;
    insert into public.deals (name, company_id, stage) values ('S4H ' || v_s, v_company, 'opportunity') returning id into v_deal;
    insert into public.contact_notes (contact_id, text, date) values (v_contact, 'S4H ' || v_s || ' n1', now()) returning id into v_n1;
    insert into public.contact_notes (contact_id, text, date) values (v_contact, 'S4H ' || v_s || ' n2', now()) returning id into v_n2;
    insert into public.deal_notes (deal_id, text, date) values (v_deal, 'S4H ' || v_s || ' dn1', now()) returning id into v_dn1;

    if v_kind in ('C1', 'C13') then
        -- a historical note the user is about to extend
        perform public.s4h_plant('contact_notes', v_n1, array[public.s4h_el(v_k1)]);
        insert into public.s4h_ctx values (v_s, 'arr_B', array[public.s4h_el(v_k1), public.s4h_el(v_k2)]::text);
        insert into public.s4h_ctx values (v_s, 'arr_A', array[public.s4h_el(v_k1), public.s4h_el(v_k2)]::text);
    elsif v_kind = 'C2' then
        perform public.s4h_plant('contact_notes', v_n1, array[public.s4h_el(v_k1)]);
        insert into public.s4h_ctx values (v_s, 'arr_A', array[public.s4h_el(v_k1), public.s4h_el(v_k2)]::text);
    elsif v_kind in ('C3', 'C4', 'C5', 'C6', 'C7', 'C9', 'C11', 'C12') then
        perform public.s4h_plant('contact_notes', v_n1, array[public.s4h_el(v_k1)]);
    elsif v_kind = 'C8' then
        -- only the deal note is a candidate, so S4 must pick it
        perform public.s4h_plant('deal_notes', v_dn1, array[public.s4h_el(v_k1)]);
    elsif v_kind = 'C10' then
        -- S4's note and the user's note are different notes with different keys
        perform public.s4h_plant('contact_notes', v_n1, array[public.s4h_el(v_k1)]);
        insert into public.s4h_ctx values (v_s, 'arr_B', array[public.s4h_el(v_k2)]::text);
    elsif v_kind in ('C14', 'C15') then
        -- three candidates across both note tables
        perform public.s4h_plant('contact_notes', v_n1, array[public.s4h_el(v_k1)]);
        perform public.s4h_plant('contact_notes', v_n2, array[public.s4h_el(v_k2)]);
        perform public.s4h_plant('deal_notes', v_dn1, array[public.s4h_el(v_k3)]);
    elsif v_kind = 'S1' then
        -- the RESULT CONTRACT fixture: two candidates, and an active deletion
        -- intent on the FIRST one so the very first invocation must FAIL. n1 has
        -- the lower id, so which invocation fails is deterministic.
        perform public.s4h_plant('contact_notes', v_n1, array[public.s4h_el(v_k1)]);
        perform public.s4h_plant('contact_notes', v_n2, array[public.s4h_el(v_k2)]);
        insert into nora_private.attachment_storage_deletion_queue (storage_key) values (v_k1);
    else
        raise exception 'unknown scenario kind %', v_kind;
    end if;

    if v_kind = 'C11' then
        -- an inspect-able deletion intent for the very key S4 wants to add
        insert into nora_private.attachment_storage_deletion_queue (storage_key, state, attempt_count, claimed_at, claimed_by)
            values (v_k1, 'claimed', 1, now(), v_tok) returning id into v_job;
    end if;

    insert into public.s4h_ctx (scenario, key, value) values
        (v_s, 'company', v_company::text), (v_s, 'contact', v_contact::text), (v_s, 'deal', v_deal::text),
        (v_s, 'n1', v_n1::text), (v_s, 'n2', v_n2::text), (v_s, 'dn1', v_dn1::text),
        (v_s, 'k1', v_k1), (v_s, 'k2', v_k2), (v_s, 'k3', v_k3),
        (v_s, 'job', coalesce(v_job::text, '')), (v_s, 'token', v_tok);
end;
$$;

-- ---------------------------------------------------------------------------
-- clear_queue: lift the deliberate S1 block once the failing invocation has
-- been observed, so the next invocation can succeed.
-- ---------------------------------------------------------------------------
do $$
begin
    if current_setting('s4h.mode') <> 'clear_queue' then
        return;
    end if;
    delete from nora_private.attachment_storage_deletion_queue where storage_key like 's4h-%';
end;
$$;

-- ---------------------------------------------------------------------------
-- arm_job: record a claimed intent for k1 WHILE a worker is paused holding the
-- key lock. A plain INSERT takes no advisory lock, so it does not block - which
-- is exactly what makes "S4 first, inspect second" reachable.
-- ---------------------------------------------------------------------------
do $$
declare
    v_s   text := current_setting('s4h.scenario');
    v_k1  text;
    v_tok text;
    v_job bigint;
begin
    if current_setting('s4h.mode') <> 'arm_job' then
        return;
    end if;
    select value into v_k1 from public.s4h_ctx where scenario = v_s and key = 'k1';
    select value into v_tok from public.s4h_ctx where scenario = v_s and key = 'token';
    insert into nora_private.attachment_storage_deletion_queue (storage_key, state, attempt_count, claimed_at, claimed_by)
        values (v_k1, 'claimed', 1, now(), v_tok) returning id into v_job;
    update public.s4h_ctx set value = v_job::text where scenario = v_s and key = 'job';
end;
$$;
