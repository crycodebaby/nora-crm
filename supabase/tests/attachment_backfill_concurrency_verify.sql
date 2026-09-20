-- W8-C S4 historical attachment backfill — REAL-session concurrency
-- verification. Invoked by attachment_backfill_concurrency_runner.ps1 with psql
-- variables:
--   mode      check | cleanup
--   scenario  scenario / round label (check mode)
--   kind      C1 .. C15 (check mode)
--
-- check asserts the recorded events and the final committed state:
--   C1  S4 holds the note row, the user's attachment write waits, then
--       reconciles against the rows S4 committed -> final = the user's array
--   C2  the user writes first (S3B projects), S4 waits on the note row and then
--       reads the FRESH array and the FRESH rows -> SKIPPED_ALREADY_EXACT.
--       THE stale-read test: a backfill that derived its desired set before the
--       lock would compare an old array against new rows and abort
--   C3  a concurrent body-only edit waits, then changes nothing about the
--       projection
--   C4  S4 first, note DELETE second -> cascade removes the rows S4 just wrote
--       and captures one intent per row; no orphan row survives
--   C5  note DELETE first -> S4 finds no candidate at all
--   C6  parent contact cascade      C7  parent company cascade
--   C8  parent deal cascade (deal note)
--   C9  two backfill workers on the same note -> one BACKFILLED, one
--       SKIPPED_ALREADY_EXACT, never two inserts and never a 23505
--   C10 S4 holds one note while a user attachment write on ANOTHER note
--       completes - unrelated notes are not serialized
--   C11 inspect holds the storage key (claimed intent) -> S4's admission waits
--       on the advisory lock; the note keeps the key alive, so the verdict is
--       live -> skipped_live, which does not block, and S4 then succeeds
--   C12 S4 holds the storage key first (paused after its INSERT, so the S3A key
--       lock is held) -> inspect waits, then observes the fresh row as live
--   C13 a user holds the note row longer than the backfill's lock_timeout ->
--       S4 fails with 55P03 instead of forcing its way through contention
--   C14 four separate runner processes drain three candidates and then report
--       NO_CANDIDATE - progress survives a restart with no checkpoint table
--   C15 two further passes stay NO_CANDIDATE and change nothing
--   S1  the operator result contract - the row-level assertions are made by the
--       runner script against what each separate PROCESS printed; here only the
--       durable state it must have left behind
--   every `mode = s4` worker also records an S4ROW event: the outcome row that
--   worker's own invocation returned, captured from its stdout, never read back
--   every scenario: no coordination timeout, no deadlock, no unexpected error,
--   every surviving note equals its projection, and no live key shares its
--   storage key with an active or done deletion intent (I1)
-- cleanup removes every s4h-* row and all public.s4h_* test objects.
--
-- Never point this at Production.

\set ON_ERROR_STOP on

select set_config('s4h.mode', :'mode', false),
       set_config('s4h.scenario', :'scenario', false),
       set_config('s4h.kind', :'kind', false);

do $$
declare
    v_s        text := current_setting('s4h.scenario');
    v_kind     text := current_setting('s4h.kind');
    v_n1 bigint; v_n2 bigint; v_dn1 bigint;
    v_company bigint; v_contact bigint; v_deal bigint;
    v_k1 text; v_k2 text; v_k3 text;
    v_job      bigint;
    v_failures text[] := '{}';
    v_events   text;
    v_errors   text;
    v_s4       text;
    v_rows1    text;
    v_rows2    text;
    v_rowsd    text;
    v_queue    text;
    v_rows     text;
begin
    if current_setting('s4h.mode') <> 'check' then
        return;
    end if;

    select value::bigint into v_n1 from public.s4h_ctx where scenario = v_s and key = 'n1';
    select value::bigint into v_n2 from public.s4h_ctx where scenario = v_s and key = 'n2';
    select value::bigint into v_dn1 from public.s4h_ctx where scenario = v_s and key = 'dn1';
    select value::bigint into v_company from public.s4h_ctx where scenario = v_s and key = 'company';
    select value::bigint into v_contact from public.s4h_ctx where scenario = v_s and key = 'contact';
    select value::bigint into v_deal from public.s4h_ctx where scenario = v_s and key = 'deal';
    select value into v_k1 from public.s4h_ctx where scenario = v_s and key = 'k1';
    select value into v_k2 from public.s4h_ctx where scenario = v_s and key = 'k2';
    select value into v_k3 from public.s4h_ctx where scenario = v_s and key = 'k3';
    select nullif(value, '')::bigint into v_job from public.s4h_ctx where scenario = v_s and key = 'job';

    select string_agg(format('%s:%s=%s', worker, event, coalesce(detail, '')), ' ; ' order by id) into v_events
      from public.s4h_results where scenario = v_s;
    raise notice '% events: %', v_s, coalesce(v_events, '<none>');
    select string_agg(distinct split_part(detail, '|', 1), ',') into v_errors
      from public.s4h_results where scenario = v_s and event = 'ERROR';
    select string_agg(split_part(detail, '|', 1), ',' order by id) into v_s4
      from public.s4h_results where scenario = v_s and event = 'S4';
    -- what each separate runner PROCESS returned to its caller, captured from
    -- that process's own stdout: the operator contract, not a readback
    select string_agg(detail, ' ; ' order by id) into v_rows
      from public.s4h_results where scenario = v_s and event = 'S4ROW' and detail <> '<no row>';

    select coalesce(string_agg(a.storage_key, ',' order by a.storage_key collate "C"), '') into v_rows1
      from public.attachments a where a.contact_note_id = v_n1;
    select coalesce(string_agg(a.storage_key, ',' order by a.storage_key collate "C"), '') into v_rows2
      from public.attachments a where a.contact_note_id = v_n2;
    select coalesce(string_agg(a.storage_key, ',' order by a.storage_key collate "C"), '') into v_rowsd
      from public.attachments a where a.deal_note_id = v_dn1;
    select coalesce(string_agg(q.storage_key || '/' || q.state, ',' order by q.storage_key, q.id), '') into v_queue
      from nora_private.attachment_storage_deletion_queue q;

    -- ---- global ------------------------------------------------------------
    if exists (select 1 from public.s4h_results where scenario = v_s and event like '%TIMEOUT') then
        v_failures := array_append(v_failures, 'a coordination wait timed out');
    end if;
    if exists (select 1 from public.s4h_results where scenario = v_s and event = 'ERROR' and detail like '40P01%') then
        v_failures := array_append(v_failures, 'a deadlock (40P01) occurred');
    end if;
    if exists (select 1 from public.contact_notes n
               where coalesce((select string_agg(a.storage_key, ',' order by a.storage_key collate "C")
                                 from public.attachments a where a.contact_note_id = n.id), '')
                   is distinct from
                   coalesce((select string_agg(r.storage_key, ',' order by r.storage_key collate "C")
                               from nora_private.note_attachment_reference_rows(n.attachments) r), '')) then
        v_failures := array_append(v_failures, 'a contact note and its projection differ');
    end if;
    if exists (select 1 from public.deal_notes n
               where coalesce((select string_agg(a.storage_key, ',' order by a.storage_key collate "C")
                                 from public.attachments a where a.deal_note_id = n.id), '')
                   is distinct from
                   coalesce((select string_agg(r.storage_key, ',' order by r.storage_key collate "C")
                               from nora_private.note_attachment_reference_rows(n.attachments) r), '')) then
        v_failures := array_append(v_failures, 'a deal note and its projection differ');
    end if;
    if exists (select 1 from public.attachments a
               join nora_private.attachment_storage_deletion_queue q on q.storage_key = a.storage_key
               where q.state in ('pending', 'claimed', 'failed_retryable', 'done')) then
        v_failures := array_append(v_failures, 'I1 violated: a reference shares its key with an active intent');
    end if;
    if exists (select 1 from public.attachments where byte_size is not null) then
        v_failures := array_append(v_failures, 'a backfilled row carries a byte_size');
    end if;
    -- The backfill never writes a note, so it never produces a note audit
    -- event. audit_events is append-only and survives every scenario, and its
    -- note_id does NOT say which note table an id came from - the contact-note
    -- and deal-note sequences overlap. Pairing each event_type with its own
    -- note table is what makes this exact: these note ids were created by this
    -- fixture, and an identity sequence never hands the same id out twice.
    if not exists (select 1 from public.s4h_results r
                    where r.scenario = v_s and r.event in ('SET_OK', 'TEXT_OK'))
       and exists (select 1 from public.audit_events e
                    where (e.event_type = 'contact_note.updated' and e.note_id in (v_n1, v_n2))
                       or (e.event_type = 'deal_note.updated' and e.note_id = v_dn1)) then
        v_failures := array_append(v_failures, 'a note audit event appeared although no user write ran');
    end if;

    -- ---- per scenario ------------------------------------------------------
    if v_kind = 'C1' then
        if v_s4 is distinct from 'BACKFILLED'
           or not exists (select 1 from public.s4h_results where scenario = v_s and worker = 'A' and event = 'PAUSED' and detail = 'BEFORE:' || v_k1)
           or not exists (select 1 from public.s4h_results where scenario = v_s and worker = 'A' and event = 'WAITER'
                          and (detail like '%transactionid%' or detail like '%tuple%'))
           or not exists (select 1 from public.s4h_results where scenario = v_s and worker = 'B' and event = 'SET_OK' and detail = '1')
           or v_errors is not null
           or v_rows1 <> v_k1 || ',' || v_k2 or v_queue <> '' then
            v_failures := v_failures || format('C1: expected S4 to hold, the user write to wait and then extend (rows %s, queue %s)', v_rows1, v_queue);
        end if;

    elsif v_kind = 'C2' then
        -- THE stale-read proof, and the only place SKIPPED_ALREADY_EXACT is
        -- reachable: its row must come back from the invocation that skipped
        if v_s4 is distinct from 'SKIPPED_ALREADY_EXACT'
           or v_rows is distinct from 'SKIPPED_ALREADY_EXACT|contact_notes|' || v_n1 || '|0'
           or not exists (select 1 from public.s4h_results where scenario = v_s and worker = 'B' and event = 'SET_OK' and detail = '1')
           or not exists (select 1 from public.s4h_results where scenario = v_s and worker = 'B' and event = 'WAITER'
                          and (detail like '%transactionid%' or detail like '%tuple%'))
           or v_errors is not null
           or v_rows1 <> v_k1 || ',' || v_k2 or v_queue <> '' then
            v_failures := v_failures || format('C2: the backfill did not read the FRESH array and rows after the lock, or did not return its own row (S4 %s, returned %s, rows %s)',
                                               coalesce(v_s4, '-'), coalesce(v_rows, '<none>'), v_rows1);
        end if;

    elsif v_kind = 'C3' then
        if v_s4 is distinct from 'BACKFILLED'
           or not exists (select 1 from public.s4h_results where scenario = v_s and worker = 'B' and event = 'TEXT_OK' and detail = '1')
           or v_errors is not null or v_rows1 <> v_k1 or v_queue <> '' then
            v_failures := v_failures || format('C3: a body-only edit disturbed the projection (rows %s, queue %s)', v_rows1, v_queue);
        end if;

    elsif v_kind in ('C4', 'C6', 'C7') then
        if v_s4 is distinct from 'BACKFILLED'
           or not exists (select 1 from public.s4h_results where scenario = v_s and worker = 'B' and event = 'DELETE_OK' and detail = '1')
           or v_errors is not null
           or exists (select 1 from public.contact_notes where id = v_n1)
           or v_rows1 <> '' or exists (select 1 from public.attachments)
           or v_queue <> v_k1 || '/pending'
           or (v_kind = 'C6' and exists (select 1 from public.contacts where id = v_contact))
           or (v_kind = 'C7' and exists (select 1 from public.companies where id = v_company)) then
            v_failures := v_failures || format('%s: the cascade after the backfill did not remove every row and capture its intent (rows %s, queue %s)',
                                               v_kind, v_rows1, v_queue);
        end if;

    elsif v_kind = 'C8' then
        if v_s4 is distinct from 'BACKFILLED'
           or not exists (select 1 from public.s4h_results where scenario = v_s and worker = 'B' and event = 'DELETE_OK' and detail = '1')
           or v_errors is not null
           or exists (select 1 from public.deals where id = v_deal)
           or v_rowsd <> '' or exists (select 1 from public.attachments)
           or v_queue <> v_k1 || '/pending' then
            v_failures := v_failures || format('C8: the deal cascade did not remove the deal note''s rows and capture the intent (rows %s, queue %s)',
                                               v_rowsd, v_queue);
        end if;

    elsif v_kind = 'C5' then
        if v_s4 is distinct from 'NO_CANDIDATE'
           or not exists (select 1 from public.s4h_results where scenario = v_s and worker = 'B' and event = 'DELETE_OK' and detail = '1')
           or v_errors is not null
           or exists (select 1 from public.contact_notes where id = v_n1)
           or exists (select 1 from public.attachments) or v_queue <> '' then
            v_failures := v_failures || format('C5: the backfill behind a note DELETE must find nothing (S4 %s, queue %s)',
                                               coalesce(v_s4, '-'), v_queue);
        end if;

    elsif v_kind = 'C9' then
        -- each process returned ITS OWN verdict on the same note: one did the
        -- work, the other was told it had nothing to do - neither had to ask
        if v_s4 is distinct from 'BACKFILLED,SKIPPED_ALREADY_EXACT'
           or v_rows is distinct from 'BACKFILLED|contact_notes|' || v_n1 || '|1 ; '
                                   || 'SKIPPED_ALREADY_EXACT|contact_notes|' || v_n1 || '|0'
           or v_errors is not null or v_rows1 <> v_k1 or v_queue <> ''
           or (select count(*) from public.attachments where storage_key = v_k1) <> 1 then
            v_failures := v_failures || format('C9: two workers on one note must give exactly one BACKFILLED and one skip, each returned by its own call (S4 %s, returned %s, rows %s)',
                                               coalesce(v_s4, '-'), coalesce(v_rows, '<none>'), v_rows1);
        end if;

    elsif v_kind = 'C10' then
        if v_s4 is distinct from 'BACKFILLED'
           or not exists (select 1 from public.s4h_results where scenario = v_s and worker = 'B' and event = 'SET_OK' and detail = '1')
           or not exists (select 1 from public.s4h_results where scenario = v_s and worker = 'A' and event = 'EVENT_SEEN')
           or (select min(id) from public.s4h_results where scenario = v_s and worker = 'B' and event = 'SET_OK')
              > (select min(id) from public.s4h_results where scenario = v_s and worker = 'A' and event = 'RESUMED')
           or v_errors is not null or v_rows1 <> v_k1 or v_rows2 <> v_k2 or v_queue <> '' then
            v_failures := v_failures || format('C10: an unrelated note was serialized behind the backfill (rows %s / %s)', v_rows1, v_rows2);
        end if;

    elsif v_kind = 'C11' then
        if v_s4 is distinct from 'BACKFILLED'
           or not exists (select 1 from public.s4h_results where scenario = v_s and worker = 'I' and event = 'INSPECT' and detail = 'live|skipped_live')
           or not exists (select 1 from public.s4h_results where scenario = v_s and worker = 'I' and event = 'WAITER' and detail = 'advisory')
           or v_errors is not null or v_rows1 <> v_k1
           or v_queue <> v_k1 || '/skipped_live' then
            v_failures := v_failures || format('C11: the backfill did not wait behind inspect and then succeed (S4 %s, rows %s, queue %s)',
                                               coalesce(v_s4, '-'), v_rows1, v_queue);
        end if;

    elsif v_kind = 'C12' then
        if v_s4 is distinct from 'BACKFILLED'
           or not exists (select 1 from public.s4h_results where scenario = v_s and worker = 'A' and event = 'PAUSED' and detail = 'AFTER:' || v_k1)
           or not exists (select 1 from public.s4h_results where scenario = v_s and worker = 'A' and event = 'WAITER' and detail = 'advisory')
           or not exists (select 1 from public.s4h_results where scenario = v_s and worker = 'I' and event = 'INSPECT' and detail = 'live|skipped_live')
           or v_errors is not null or v_rows1 <> v_k1
           or v_queue <> v_k1 || '/skipped_live' then
            v_failures := v_failures || format('C12: inspect did not wait behind the backfill''s key lock and observe the fresh row (S4 %s, rows %s, queue %s)',
                                               coalesce(v_s4, '-'), v_rows1, v_queue);
        end if;

    elsif v_kind = 'C13' then
        -- v_rows is built from S4ROW events that are NOT '<no row>', so
        -- requiring it to stay NULL is the returned-row half of this scenario:
        -- a backfill that yields on lock_timeout hands its caller nothing at
        -- all, never an outcome row and never NO_CANDIDATE
        if v_s4 is not null or v_rows is not null
           or not exists (select 1 from public.s4h_results where scenario = v_s and worker = 'A' and event = 'ERROR' and detail like '55P03|%')
           or not exists (select 1 from public.s4h_results where scenario = v_s and worker = 'B' and event = 'SET_OK' and detail = '1')
           or v_errors is distinct from '55P03'
           or v_rows1 <> v_k1 || ',' || v_k2 or v_queue <> '' then
            v_failures := v_failures || format('C13: the backfill did not yield to a user holding the note row, or it returned an outcome row while yielding (S4 %s, returned %s, errors %s, rows %s)',
                                               coalesce(v_s4, '-'), coalesce(v_rows, '<no row>'), coalesce(v_errors, '-'), v_rows1);
        end if;

    elsif v_kind = 'C14' then
        if v_s4 is distinct from 'BACKFILLED,BACKFILLED,BACKFILLED,NO_CANDIDATE'
           or v_rows is distinct from 'BACKFILLED|contact_notes|' || v_n1 || '|1 ; '
                                   || 'BACKFILLED|contact_notes|' || v_n2 || '|1 ; '
                                   || 'BACKFILLED|deal_notes|' || v_dn1 || '|1 ; '
                                   || 'NO_CANDIDATE|||0'
           or v_errors is not null
           or v_rows1 <> v_k1 or v_rows2 <> v_k2 or v_rowsd <> v_k3 or v_queue <> '' then
            v_failures := v_failures || format('C14: three candidates did not drain across four separate runner processes, each reporting its own note (S4 %s, returned %s)',
                                               coalesce(v_s4, '-'), coalesce(v_rows, '<none>'));
        end if;

    elsif v_kind = 'C15' then
        if v_s4 is distinct from 'BACKFILLED,BACKFILLED,BACKFILLED,NO_CANDIDATE,NO_CANDIDATE,NO_CANDIDATE'
           or v_rows not like '%NO_CANDIDATE|||0 ; NO_CANDIDATE|||0 ; NO_CANDIDATE|||0'
           or v_errors is not null
           or v_rows1 <> v_k1 or v_rows2 <> v_k2 or v_rowsd <> v_k3 or v_queue <> ''
           or (select count(*) from public.attachments) <> 3 then
            v_failures := v_failures || format('C15: further passes were not idempotent or did not each report NO_CANDIDATE (S4 %s, returned %s)',
                                               coalesce(v_s4, '-'), coalesce(v_rows, '<none>'));
        end if;

    elsif v_kind = 'S1' then
        -- the row-by-row assertions are made by the runner script, against what
        -- each separate PROCESS printed. What is left to check here is that the
        -- durable state matches those rows and that the deliberate first failure
        -- left nothing behind.
        if v_rows1 <> v_k1 or v_rows2 <> v_k2 or v_queue <> ''
           or (select count(*) from public.attachments) <> 2 then
            v_failures := v_failures || format('S1: the result contract run did not leave both notes projected and the queue empty (rows %s / %s, queue %s)',
                                               v_rows1, v_rows2, v_queue);
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
    if current_setting('s4h.mode') <> 'cleanup' then
        return;
    end if;
    drop trigger if exists s4h_pause_before_insert_trigger on public.attachments;
    drop trigger if exists s4h_pause_after_insert_trigger on public.attachments;
    update public.companies set self_contact_id = null where name like 'S4H Backfill %';
    delete from public.companies where name like 'S4H Backfill %';
    delete from nora_private.attachment_storage_deletion_queue where storage_key like 's4h-%';

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

    if exists (select 1 from public.attachments)
       or exists (select 1 from nora_private.attachment_storage_deletion_queue where storage_key like 's4h-%')
       or exists (select 1 from public.companies where name like 'S4H Backfill %')
       or exists (select 1 from pg_proc where proname like 's4h\_%')
       or exists (select 1 from pg_trigger where tgname like 's4h\_%')
       or to_regclass('public.s4h_results') is not null then
        raise exception 'cleanup left s4h-* fixtures or test objects behind';
    end if;
    raise notice 'cleanup: all s4h-* fixtures and test objects removed';
end;
$$;
