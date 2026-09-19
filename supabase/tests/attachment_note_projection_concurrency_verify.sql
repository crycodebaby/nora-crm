-- W8-C S3B note-attachment projection — REAL-session concurrency verification.
-- Invoked by attachment_note_projection_concurrency_runner.ps1 with psql
-- variables:
--   mode      check | cleanup
--   scenario  scenario / round label (check mode)
--   kind      C1 .. C9 (check mode)
--
-- check asserts the recorded events and the final committed state of one
-- scenario:
--   C1  same note, stale second writer: B waits on the note row, then
--       reconciles against the FRESH rows A committed -> rows = B's JSON
--       [K1,K3], K2 captured once, no 23505, no drift
--   C2  different notes / keys: B completes while A still holds its note
--   C3  two notes add the same new key: B waits (unique index), then fails
--       cleanly with 23505; A keeps the key
--   C4  opposite-order multi-key adds, both statements paused mid-insert:
--       the COLLATE "C" order makes B wait behind A - one clean 23505, never
--       a deadlock
--   C5  cross-note swap, both statements paused between REMOVE and ADD: the
--       accepted outcome is that NEITHER commits (40P01 for one, 23505 for the
--       other); state and queue unchanged
--   C6  ADD K while inspect holds K (claimed intent, DEAD): admission waits
--       (advisory), then rejects the whole note write
--   C7a REMOVE K holds the key lock (capture no-op against the claimed job),
--       inspect waits (advisory) and observes DEAD - no skipped_live orphan
--   C7b inspect holds K (row LIVE -> skipped_live), REMOVE waits (advisory),
--       then captures a fresh pending intent
--   C8a note DELETE holds, the edit waits and updates 0 rows - nothing projected
--   C8b the edit holds, the note DELETE waits and captures every row
--   C9  the edit holds, a company delete waits and cascades + captures every row
--   every scenario: no coordination timeout, no unexpected error, a deadlock
--   (40P01) only in C5, I1 holds, every surviving note equals its JSON
-- cleanup removes every s3bh-* row and all public.s3bh_* test objects.
--
-- Never point this at Production.

\set ON_ERROR_STOP on

select set_config('s3bh.mode', :'mode', false),
       set_config('s3bh.scenario', :'scenario', false),
       set_config('s3bh.kind', :'kind', false);

do $$
declare
    v_s        text := current_setting('s3bh.scenario');
    v_kind     text := current_setting('s3bh.kind');
    v_n1       bigint;
    v_n2       bigint;
    v_company  bigint;
    v_k1 text; v_k2 text; v_k3 text;
    v_job      bigint;
    v_failures text[] := '{}';
    v_events   text;
    v_errors   text;
    v_rows1    text;
    v_rows2    text;
begin
    if current_setting('s3bh.mode') <> 'check' then
        return;
    end if;

    select value::bigint into v_n1 from public.s3bh_ctx where scenario = v_s and key = 'n1';
    select value::bigint into v_n2 from public.s3bh_ctx where scenario = v_s and key = 'n2';
    select value::bigint into v_company from public.s3bh_ctx where scenario = v_s and key = 'company';
    select value into v_k1 from public.s3bh_ctx where scenario = v_s and key = 'k1';
    select value into v_k2 from public.s3bh_ctx where scenario = v_s and key = 'k2';
    select value into v_k3 from public.s3bh_ctx where scenario = v_s and key = 'k3';
    select nullif(value, '')::bigint into v_job from public.s3bh_ctx where scenario = v_s and key = 'job';

    select string_agg(format('%s:%s=%s', worker, event, coalesce(detail, '')), ' ; ' order by id) into v_events
      from public.s3bh_results where scenario = v_s;
    raise notice '% events: %', v_s, coalesce(v_events, '<none>');
    select string_agg(distinct split_part(detail, '|', 1), ',') into v_errors
      from public.s3bh_results where scenario = v_s and event = 'ERROR';

    select coalesce(string_agg(a.storage_key, ',' order by a.storage_key collate "C"), '') into v_rows1
      from public.attachments a where a.contact_note_id = v_n1;
    select coalesce(string_agg(a.storage_key, ',' order by a.storage_key collate "C"), '') into v_rows2
      from public.attachments a where a.contact_note_id = v_n2;

    -- global: no coordination timeout; a deadlock only where it is the accepted outcome
    if exists (select 1 from public.s3bh_results where scenario = v_s and event like '%TIMEOUT') then
        v_failures := array_append(v_failures, 'a coordination wait timed out');
    end if;
    if v_kind <> 'C5' and exists (select 1 from public.s3bh_results
                                  where scenario = v_s and event = 'ERROR' and detail like '40P01%') then
        v_failures := array_append(v_failures, 'a deadlock (40P01) occurred');
    end if;
    -- global: every surviving scenario note equals its JSON (keys)
    if exists (select 1 from public.contact_notes n
               where n.id in (v_n1, v_n2)
                 and coalesce((select string_agg(a.storage_key, ',' order by a.storage_key collate "C")
                                 from public.attachments a where a.contact_note_id = n.id), '')
                     is distinct from
                     coalesce((select string_agg(r.storage_key, ',' order by r.storage_key collate "C")
                                 from nora_private.note_attachment_reference_rows(n.attachments) r), '')) then
        v_failures := array_append(v_failures, 'a note and its projection differ');
    end if;
    -- global: I1
    if exists (select 1 from public.attachments a
               join nora_private.attachment_storage_deletion_queue q on q.storage_key = a.storage_key
               where a.storage_key in (v_k1, v_k2, v_k3)
                 and q.state in ('pending', 'claimed', 'failed_retryable', 'done')) then
        v_failures := array_append(v_failures, 'I1 violated: a reference shares its key with an active intent');
    end if;

    if v_kind = 'C1' then
        if not exists (select 1 from public.s3bh_results where scenario = v_s and worker = 'A' and event = 'SET_OK' and detail = '1')
           or not exists (select 1 from public.s3bh_results where scenario = v_s and worker = 'A' and event = 'WAITER'
                          and (detail like '%transactionid%' or detail like '%tuple%'))
           or not exists (select 1 from public.s3bh_results where scenario = v_s and worker = 'B' and event = 'SET_OK' and detail = '1')
           or v_errors is not null then
            v_failures := array_append(v_failures, 'C1: expected A to hold, B to wait on the note row and then succeed');
        end if;
        if v_rows1 <> v_k1 || ',' || v_k3
           or (select count(*) from nora_private.attachment_storage_deletion_queue where storage_key = v_k2 and state = 'pending') <> 1
           or exists (select 1 from nora_private.attachment_storage_deletion_queue where storage_key in (v_k1, v_k3)) then
            v_failures := v_failures || format('C1: rows %s / queue wrong - the second writer did not reconcile against fresh rows', v_rows1);
        end if;

    elsif v_kind = 'C2' then
        if (select id from public.s3bh_results where scenario = v_s and worker = 'B' and event = 'SET_OK' and detail = '1')
           > coalesce((select id from public.s3bh_results where scenario = v_s and worker = 'A' and event = 'RELEASE'), 0)
           or not exists (select 1 from public.s3bh_results where scenario = v_s and worker = 'A' and event = 'SET_OK' and detail = '1')
           or v_errors is not null or v_rows1 <> v_k1 or v_rows2 <> v_k2 then
            v_failures := v_failures || format('C2: different notes / keys blocked each other or failed (rows %s / %s)', v_rows1, v_rows2);
        end if;

    elsif v_kind = 'C3' then
        if not exists (select 1 from public.s3bh_results where scenario = v_s and worker = 'A' and event = 'WAITER' and detail like '%transactionid%')
           or not exists (select 1 from public.s3bh_results where scenario = v_s and worker = 'B' and event = 'ERROR' and detail like '23505|%')
           or v_rows1 <> v_k1 or v_rows2 <> ''
           or (select attachments from public.contact_notes where id = v_n2) is not null then
            v_failures := v_failures || format('C3: expected a unique-index wait and one clean 23505 (rows %s / %s)', v_rows1, v_rows2);
        end if;

    elsif v_kind = 'C4' then
        -- the pause log of a statement that fails is rolled back with it, so
        -- the evidence is the survivor's: it paused before its second key and
        -- resumed without a timeout (the peer reached its own pause point)
        if not exists (select 1 from public.s3bh_results where scenario = v_s and worker = 'A' and event = 'PAUSED' and detail = v_k2)
           or not exists (select 1 from public.s3bh_results where scenario = v_s and worker = 'A' and event = 'RESUMED' and detail = v_k2)
           or not exists (select 1 from public.s3bh_results where scenario = v_s and worker = 'A' and event = 'SET_OK' and detail = '1')
           or not exists (select 1 from public.s3bh_results where scenario = v_s and worker = 'B' and event = 'ERROR' and detail like '23505|%')
           or v_errors <> '23505'
           or v_rows1 <> v_k1 || ',' || v_k2 or v_rows2 <> ''
           or (select attachments from public.contact_notes where id = v_n2) is not null then
            v_failures := v_failures || format('C4: expected both paused, A to win, B one clean 23505 (errors %s, rows %s / %s)',
                                               coalesce(v_errors, '-'), v_rows1, v_rows2);
        end if;

    elsif v_kind = 'C5' then
        -- both statements fail, so their pause logs are rolled back; the
        -- deadlock itself proves the forced interleaving (each had removed its
        -- key and was inserting the other's), and the survivor then meets the
        -- restored row (23505). Accepted classes only; never a success.
        if exists (select 1 from public.s3bh_results where scenario = v_s and event = 'SET_OK')
           or (select count(*) from public.s3bh_results where scenario = v_s and event = 'ERROR') <> 2
           or v_errors is distinct from '23505,40P01'
           or v_rows1 <> v_k1 or v_rows2 <> v_k2
           or exists (select 1 from nora_private.attachment_storage_deletion_queue where storage_key in (v_k1, v_k2)) then
            v_failures := v_failures || format('C5: the swap must not commit on either side (errors %s, rows %s / %s)',
                                               coalesce(v_errors, '-'), v_rows1, v_rows2);
        end if;
        raise notice '% swap failure classes: %', v_s, coalesce(v_errors, '-');

    elsif v_kind = 'C6' then
        if not exists (select 1 from public.s3bh_results where scenario = v_s and worker = 'I' and event = 'INSPECT' and detail = 'dead|claimed')
           or not exists (select 1 from public.s3bh_results where scenario = v_s and worker = 'I' and event = 'WAITER' and detail = 'advisory')
           or not exists (select 1 from public.s3bh_results where scenario = v_s and worker = 'B' and event = 'ERROR'
                          and detail = '55000|NORA_ATTACHMENT_STORAGE_KEY_PENDING_DELETION')
           or v_rows1 <> '' or (select attachments from public.contact_notes where id = v_n1) is not null
           or (select state from nora_private.attachment_storage_deletion_queue where id = v_job) <> 'claimed' then
            v_failures := array_append(v_failures, 'C6: admission did not wait on inspect and reject the whole note write');
        end if;

    elsif v_kind = 'C7a' then
        if not exists (select 1 from public.s3bh_results where scenario = v_s and worker = 'A' and event = 'SET_OK' and detail = '1')
           or not exists (select 1 from public.s3bh_results where scenario = v_s and worker = 'A' and event = 'WAITER' and detail = 'advisory')
           or not exists (select 1 from public.s3bh_results where scenario = v_s and worker = 'I' and event = 'INSPECT' and detail = 'dead|claimed')
           or v_rows1 <> ''
           or (select string_agg(state, ',' order by id) from nora_private.attachment_storage_deletion_queue where storage_key = v_k1) <> 'claimed' then
            v_failures := array_append(v_failures, 'C7a: inspect did not wait behind the note REMOVE and observe DEAD with the intent kept');
        end if;

    elsif v_kind = 'C7b' then
        if not exists (select 1 from public.s3bh_results where scenario = v_s and worker = 'I' and event = 'INSPECT' and detail = 'live|skipped_live')
           or not exists (select 1 from public.s3bh_results where scenario = v_s and worker = 'I' and event = 'WAITER' and detail = 'advisory')
           or not exists (select 1 from public.s3bh_results where scenario = v_s and worker = 'A' and event = 'SET_OK' and detail = '1')
           or v_rows1 <> ''
           or (select string_agg(state, ',' order by id) from nora_private.attachment_storage_deletion_queue where storage_key = v_k1)
              <> 'skipped_live,pending' then
            v_failures := array_append(v_failures, 'C7b: the note REMOVE did not wait behind inspect and capture a fresh intent');
        end if;

    elsif v_kind = 'C8a' then
        if not exists (select 1 from public.s3bh_results where scenario = v_s and worker = 'A' and event = 'DELETE_OK' and detail = '1')
           or not exists (select 1 from public.s3bh_results where scenario = v_s and worker = 'A' and event = 'WAITER'
                          and (detail like '%transactionid%' or detail like '%tuple%'))
           or not exists (select 1 from public.s3bh_results where scenario = v_s and worker = 'B' and event = 'SET_OK' and detail = '0')
           or exists (select 1 from public.contact_notes where id = v_n1)
           or exists (select 1 from public.attachments where storage_key in (v_k1, v_k2))
           or (select count(*) from nora_private.attachment_storage_deletion_queue where storage_key = v_k1 and state = 'pending') <> 1
           or exists (select 1 from nora_private.attachment_storage_deletion_queue where storage_key = v_k2) then
            v_failures := array_append(v_failures, 'C8a: the edit behind a note DELETE must update 0 rows and project nothing');
        end if;

    elsif v_kind in ('C8b', 'C9') then
        if not exists (select 1 from public.s3bh_results where scenario = v_s and worker = 'A' and event = 'SET_OK' and detail = '1')
           or not exists (select 1 from public.s3bh_results where scenario = v_s and worker = 'A' and event = 'WAITER')
           or not exists (select 1 from public.s3bh_results where scenario = v_s and worker = 'B' and event = 'DELETE_OK' and detail = '1')
           or exists (select 1 from public.contact_notes where id = v_n1)
           or exists (select 1 from public.attachments where storage_key in (v_k1, v_k2))
           or (select count(*) from nora_private.attachment_storage_deletion_queue where storage_key in (v_k1, v_k2) and state = 'pending') <> 2
           or (v_kind = 'C9' and exists (select 1 from public.companies where id = v_company)) then
            v_failures := v_failures || format('%s: the delete behind the edit must cascade and capture both rows', v_kind);
        end if;
    else
        raise exception 'unknown scenario kind %', v_kind;
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL %:\n%', v_s, array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK %', v_s;
end;
$$;

do $$
begin
    if current_setting('s3bh.mode') <> 'cleanup' then
        return;
    end if;
    drop trigger if exists s3bh_pause_before_insert_trigger on public.attachments;
    -- the company cascades remove every fixture note and its references (and
    -- capture their intents, removed next)
    update public.companies set self_contact_id = null where name like 'S3BH Concurrency %';
    delete from public.companies where name like 'S3BH Concurrency %';
    delete from nora_private.attachment_storage_deletion_queue where storage_key like 's3bh-%';

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

    if exists (select 1 from public.attachments where storage_key like 's3bh-%')
       or exists (select 1 from nora_private.attachment_storage_deletion_queue where storage_key like 's3bh-%')
       or exists (select 1 from public.companies where name like 'S3BH Concurrency %')
       or exists (select 1 from pg_proc where proname like 's3bh\_%')
       or exists (select 1 from pg_trigger where tgname = 's3bh_pause_before_insert_trigger')
       or to_regclass('public.s3bh_results') is not null then
        raise exception 'cleanup left s3bh-* fixtures or test objects behind';
    end if;
    raise notice 'cleanup: all s3bh-* fixtures and test objects removed';
end;
$$;
