-- W8-C S3A storage-key serialization — REAL-session concurrency verification.
-- Invoked by attachment_reference_serialization_concurrency_runner.ps1 with
-- psql variables:
--   mode      check | cleanup
--   scenario  scenario / round label (check mode)
--   kind      C1 .. C6 (check mode)
--
-- check    asserts the recorded events and the final committed state of one
--          scenario:
--   C1  LOW-1 choreography: the reference DELETE (capture) holds the key lock,
--       inspect WAITS on it (advisory), then observes DEAD; the job stays
--       claimed, one active intent, no skipped_live orphan
--   C2  reverse: inspect holds the key lock and observes LIVE; the reference
--       DELETE (capture) WAITS on it (advisory), then enqueues a fresh pending
--       intent next to the skipped_live one
--   C3  a new reference to a key with a claimed intent (currently DEAD) is
--       rejected with NORA_ATTACHMENT_STORAGE_KEY_PENDING_DELETION
--   C4  admission WAITS behind an inspect holding the key lock with a DEAD
--       verdict (advisory), then is rejected; the job stays claimed
--   C5  admission against an uncommitted DELETE of the same key WAITS
--       (transactionid, the unique index) and is then rejected by the intent
--       that DELETE captured
--   C6  different keys: a DELETE of K2 completes while another session holds
--       the key lock of K1 - the lock is per key, not global
--   every scenario: no timeout, no unexpected error, no deadlock (40P01), I1
-- cleanup  removes every ars-* row and all public.ars_* test objects.
--
-- Never point this at Production.

\set ON_ERROR_STOP on

select set_config('ars.mode', :'mode', false),
       set_config('ars.scenario', :'scenario', false),
       set_config('ars.kind', :'kind', false);

do $$
declare
    v_s        text := current_setting('ars.scenario');
    v_kind     text := current_setting('ars.kind');
    v_k        text;
    v_k2       text;
    v_job      bigint;
    v_failures text[] := '{}';
    v_states   text;
    v_active   bigint;
    v_rows     bigint;
    v_live     text;
    v_events   text;
begin
    if current_setting('ars.mode') <> 'check' then
        return;
    end if;

    select value into v_k  from public.ars_ctx where scenario = v_s and key = 'key';
    select value into v_k2 from public.ars_ctx where scenario = v_s and key = 'key2';
    select nullif(value, '')::bigint into v_job from public.ars_ctx where scenario = v_s and key = 'job';

    select string_agg(format('%s:%s=%s', worker, event, coalesce(detail, '')), ' ; ' order by id) into v_events
      from public.ars_results where scenario = v_s;
    raise notice '% events: %', v_s, coalesce(v_events, '<none>');

    -- global: no timeout, no deadlock
    if exists (select 1 from public.ars_results where scenario = v_s and event like '%TIMEOUT') then
        v_failures := array_append(v_failures, 'a coordination wait timed out');
    end if;
    if exists (select 1 from public.ars_results where scenario = v_s and event = 'ERROR' and detail like '40P01%') then
        v_failures := array_append(v_failures, 'a deadlock (40P01) occurred');
    end if;

    select string_agg(state, ',' order by id),
           count(*) filter (where state in ('pending', 'claimed', 'failed_retryable'))
      into v_states, v_active
      from nora_private.attachment_storage_deletion_queue where storage_key = v_k;
    select count(*) into v_rows from public.attachments where storage_key = v_k;
    v_live := nora_private.attachment_storage_key_liveness(v_k);

    if v_kind = 'C1' then
        if not exists (select 1 from public.ars_results where scenario = v_s and worker = 'A' and event = 'DELETE_OK' and detail = '1')
           or not exists (select 1 from public.ars_results where scenario = v_s and worker = 'A' and event = 'WAITER' and detail = 'advisory')
           or not exists (select 1 from public.ars_results where scenario = v_s and worker = 'B' and event = 'INSPECT' and detail = 'dead|claimed') then
            v_failures := array_append(v_failures, 'C1 expected: A deleted, B waited on the key lock (advisory), B observed dead|claimed');
        end if;
        if v_states is distinct from 'claimed' or v_active <> 1 or v_rows <> 0 or v_live <> 'dead' then
            v_failures := v_failures || format('C1 final state: queue=%s active=%s rows=%s liveness=%s, expected claimed / 1 / 0 / dead',
                v_states, v_active, v_rows, v_live);
        end if;
        if exists (select 1 from nora_private.attachment_storage_deletion_queue
                   where id = v_job and (state <> 'claimed' or claimed_by is distinct from
                         (select value from public.ars_ctx where scenario = v_s and key = 'token'))) then
            v_failures := array_append(v_failures, 'C1 the job lost its lease');
        end if;

    elsif v_kind = 'C2' then
        if not exists (select 1 from public.ars_results where scenario = v_s and worker = 'B' and event = 'INSPECT' and detail = 'live|skipped_live')
           or not exists (select 1 from public.ars_results where scenario = v_s and worker = 'B' and event = 'WAITER' and detail = 'advisory')
           or not exists (select 1 from public.ars_results where scenario = v_s and worker = 'A' and event = 'DELETE_OK' and detail = '1') then
            v_failures := array_append(v_failures, 'C2 expected: B observed live|skipped_live, A waited on the key lock (advisory), A deleted');
        end if;
        if v_states is distinct from 'skipped_live,pending' or v_active <> 1 or v_rows <> 0 or v_live <> 'dead' then
            v_failures := v_failures || format('C2 final state: queue=%s active=%s rows=%s liveness=%s, expected skipped_live,pending / 1 / 0 / dead',
                v_states, v_active, v_rows, v_live);
        end if;

    elsif v_kind = 'C3' then
        if not exists (select 1 from public.ars_results where scenario = v_s and worker = 'G' and event = 'ERROR'
                       and detail = '55000|NORA_ATTACHMENT_STORAGE_KEY_PENDING_DELETION') then
            v_failures := array_append(v_failures, 'C3 expected the re-reference to be rejected with 55000 NORA_ATTACHMENT_STORAGE_KEY_PENDING_DELETION');
        end if;
        if v_states is distinct from 'claimed' or v_rows <> 0 or v_live <> 'dead' then
            v_failures := v_failures || format('C3 final state: queue=%s rows=%s liveness=%s, expected claimed / 0 / dead', v_states, v_rows, v_live);
        end if;

    elsif v_kind = 'C4' then
        if not exists (select 1 from public.ars_results where scenario = v_s and worker = 'I' and event = 'INSPECT' and detail = 'dead|claimed')
           or not exists (select 1 from public.ars_results where scenario = v_s and worker = 'I' and event = 'WAITER' and detail = 'advisory')
           or not exists (select 1 from public.ars_results where scenario = v_s and worker = 'G' and event = 'ERROR'
                          and detail = '55000|NORA_ATTACHMENT_STORAGE_KEY_PENDING_DELETION') then
            v_failures := array_append(v_failures, 'C4 expected: I observed dead|claimed, G waited on the key lock (advisory), G was rejected');
        end if;
        if v_states is distinct from 'claimed' or v_rows <> 0 or v_live <> 'dead' then
            v_failures := v_failures || format('C4 final state: queue=%s rows=%s liveness=%s, expected claimed / 0 / dead', v_states, v_rows, v_live);
        end if;

    elsif v_kind = 'C5' then
        if not exists (select 1 from public.ars_results where scenario = v_s and worker = 'D' and event = 'DELETE_OK' and detail = '1')
           or not exists (select 1 from public.ars_results where scenario = v_s and worker = 'D' and event = 'WAITER' and detail = 'transactionid')
           or not exists (select 1 from public.ars_results where scenario = v_s and worker = 'G' and event = 'ERROR'
                          and detail = '55000|NORA_ATTACHMENT_STORAGE_KEY_PENDING_DELETION') then
            v_failures := array_append(v_failures, 'C5 expected: D deleted, G waited on D (transactionid), G was rejected');
        end if;
        if v_states is distinct from 'pending' or v_active <> 1 or v_rows <> 0 or v_live <> 'dead' then
            v_failures := v_failures || format('C5 final state: queue=%s active=%s rows=%s liveness=%s, expected pending / 1 / 0 / dead',
                v_states, v_active, v_rows, v_live);
        end if;

    elsif v_kind = 'C6' then
        if not exists (select 1 from public.ars_results where scenario = v_s and worker = 'A' and event = 'EVENT_SEEN' and detail = 'B:DELETE_OK')
           or not exists (select 1 from public.ars_results where scenario = v_s and worker = 'B' and event = 'DELETE_OK' and detail = '1')
           or not exists (select 1 from public.ars_results b, public.ars_results a
                          where b.scenario = v_s and b.worker = 'B' and b.event = 'DELETE_OK'
                            and a.scenario = v_s and a.worker = 'A' and a.event = 'RELEASE'
                            and b.at < a.at) then
            v_failures := array_append(v_failures, 'C6 expected: B''s DELETE of K2 completed while A still held K1 (per-key lock)');
        end if;
        if (select count(*) from nora_private.attachment_storage_deletion_queue
            where storage_key in (v_k, v_k2) and state = 'pending') <> 2
           or exists (select 1 from public.attachments where storage_key in (v_k, v_k2)) then
            v_failures := array_append(v_failures, 'C6 final state: expected two pending intents and no reference');
        end if;
    else
        raise exception 'unknown scenario kind %', v_kind;
    end if;

    -- no unexpected error: the only error any scenario expects is the rejection
    if exists (select 1 from public.ars_results where scenario = v_s and event = 'ERROR'
               and detail <> '55000|NORA_ATTACHMENT_STORAGE_KEY_PENDING_DELETION') then
        v_failures := array_append(v_failures, 'an unexpected error was recorded');
    end if;

    -- I1 over every fixture key
    if exists (select 1 from public.attachments a
               join nora_private.attachment_storage_deletion_queue q on q.storage_key = a.storage_key
               where a.storage_key like 'ars-%' and q.state in ('pending', 'claimed', 'failed_retryable', 'done')) then
        v_failures := array_append(v_failures, 'I1 violated: a reference shares its key with an active or done intent');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL %:\n%', v_s, array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK %', v_s;
end;
$$;

do $$
declare
    v_company bigint;
begin
    if current_setting('ars.mode') <> 'cleanup' then
        return;
    end if;
    if to_regclass('public.ars_ctx') is not null then
        select value::bigint into v_company from public.ars_ctx where scenario = '*' and key = 'company';
        -- the company cascade removes the fixture note and its remaining
        -- references (and captures their intents, removed next)
        update public.companies set self_contact_id = null where id = v_company;
        delete from public.companies where id = v_company;
    end if;
    delete from nora_private.attachment_storage_deletion_queue where storage_key like 'ars-%';

    drop function if exists public.ars_log(text, text, text, text);
    drop function if exists public.ars_signal(text, text);
    drop function if exists public.ars_wait_signal(text, text, text, double precision);
    drop function if exists public.ars_wait(text, text, text, double precision);
    drop function if exists public.ars_delete_ref(text, text, text);
    drop function if exists public.ars_insert_ref(text, text, bigint, text);
    drop function if exists public.ars_inspect(text, text, bigint, text);
    drop table if exists public.ars_results;
    drop table if exists public.ars_ctx;

    if exists (select 1 from public.attachments where storage_key like 'ars-%')
       or exists (select 1 from nora_private.attachment_storage_deletion_queue where storage_key like 'ars-%')
       or exists (select 1 from public.companies where name = 'ARS Concurrency Kunde')
       or exists (select 1 from pg_proc where proname like 'ars\_%')
       or to_regclass('public.ars_results') is not null then
        raise exception 'cleanup left ars-* fixtures or test objects behind';
    end if;
    raise notice 'cleanup: all ars-* fixtures and test objects removed';
end;
$$;
