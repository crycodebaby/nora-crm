-- !!! THIS FILE WRITES AND COMMITS REAL ROWS. IT IS NOT A TEST. !!!
--
-- Nora CRM — W8-C S4 attachment backfill · STEP 10: BACKFILL EXACTLY ONE NOTE.
--
-- One invocation of THIS PAYLOAD = at most one note, processed atomically. It
-- selects its own next candidate, so it carries no note id, no project ref and
-- no storage key; run it again and again until it returns NO_CANDIDATE.
--
-- THE RESULT OF AN INVOCATION IS THE ROW THAT INVOCATION RETURNS. Nothing has
-- to be read back afterwards, from this session or any other:
--
--   outcome                note_table      note_id  row_count
--   ---------------------  --------------  -------  ---------
--   BACKFILLED             contact_notes        16          6
--   SKIPPED_ALREADY_EXACT  contact_notes        16          0
--   NO_CANDIDATE           (null)           (null)          0
--
--   row_count is what THIS transaction actually inserted, measured, not
--   assumed (step 7). A storage key is never returned.
--
--   any error              the transaction rolled back; the run STOPS. A
--                          failure is an SQL error and never an outcome row -
--                          there is no outcome value that means "it went
--                          wrong", and no failure can be mistaken for
--                          NO_CANDIDATE.
--
-- PRE-CONDITION, not optional: 00_preflight.sql said GO in this corpus. The
-- candidate predicate below is "note has attachments AND owns no attachment
-- row". That predicate is cheap and correct ONLY because the preflight proved
-- corpus-wide that no note is PARTIAL, EXTRA or metadata-diverged - such a note
-- already owns a row and would never be picked up here. The re-check under the
-- lock protects the note this invocation touches; it cannot protect a note it
-- never looks at. Cross-source storage keys are a preflight gate for the same
-- reason: a shared key is a property of the corpus, not of one note.
--
-- WHAT IT DOES
--   1. refuses anything but postgres and READ COMMITTED (the S3A key protocol)
--   2. SET LOCAL lock_timeout - maintenance yields to live users, it never
--      forces its way through contention
--   3. SELECT ... FOR UPDATE on the note row - the LOCK IS TAKEN FIRST and the
--      statement reads nothing but the id
--   4. only THEN reads that note's attachment array, and its current rows, each
--      in its own statement so READ COMMITTED gives a snapshot taken AFTER the
--      wait. Reading the array before the lock would let a stale form overwrite
--      a newer one - that is the race this slice exists to prevent
--   5. re-classifies the note under the lock: EMPTY -> reconcile, EXACT -> no
--      work, anything else -> RAISE
--   6. calls the ONE existing core, nora_private.reconcile_note_attachments,
--      with the locked row's array verbatim. No second reconcile algorithm, no
--      second grammar, no key derived by hand, no JSON rebuilt
--   7. asserts note-local parity and that the work really was INSERT-only
--
-- WHAT IT NEVER DOES
--   * UPDATE a note (that would fire the note audit trigger and the S3B
--     projection - the backfill must leave no audit trace of its own)
--   * touch nora_private.attachment_storage_deletion_queue in any way
--   * DELETE an attachment row, or repair PARTIAL / EXTRA / METADATA_MISMATCH
--   * call Storage, pg_net, an Edge Function, claim / inspect / fail, or the
--     liveness resolver
--   * set byte_size or created_at - byte_size stays NULL (W8-F owns metadata
--     enrichment) and created_at is the RELATIONAL ROW's creation time, i.e.
--     backfill time. No upload timestamp is invented from storage.objects
--   * run dynamic SQL, loop over several notes, or continue after an error
--
-- USAGE
--   Send this file VERBATIM as ONE payload, once per note:
--
--   Production (canonical): Supabase MCP execute_sql as postgres.
--   Fallback: psql -v ON_ERROR_STOP=1 \
--       -f supabase/maintenance/attachment_backfill/10_backfill_one_note.sql
--
--   Read the outcome from the row THAT CALL returns. Do not issue a second
--   query to find out what happened: there is nothing to find out afterwards,
--   the answer was already returned. Repeat only after a successful row; stop
--   on any SQL error; stop when the row says NO_CANDIDATE.
--
-- TRANSACTION CONTRACT - what is actually guaranteed, and by what
--   The payload is three statements: arm, work, report. The guarantee is
--   "the approved payload processes AT MOST ONE NOTE ATOMICALLY", and it is
--   the MUTATING statement that carries it: step 3 below locks exactly one
--   note row and the block returns after it, so no execution shape can make
--   this file touch a second note. That is a property of the work, not of a
--   statement count - a claim like "one statement is therefore one atomic
--   note" would depend on the execution vehicle and is not made here.
--
--   MCP execute_sql sends the payload as one statement stream, so all three
--   run in ONE transaction: an error rolls the whole invocation back and
--   returns no row. psql -f sends them one at a time, so the mutating
--   statement commits on its own and the report reads what it committed;
--   after a failure ON_ERROR_STOP=1 stops there. Under BOTH vehicles a failed
--   invocation returns NO ROW, and under both the note is all-or-nothing.
--
-- WHY THERE IS AN ARM STATEMENT
--   Statement 1 clears the session variable the block uses to hand its result
--   to statement 3. The variable is transport INSIDE this payload, never an
--   operator contract: it is written and consumed in the same invocation.
--   Clearing it first is what makes a stale result impossible - a GUC write
--   is transactional, so a rolled-back invocation would otherwise restore the
--   PREVIOUS invocation's value, and a psql run without ON_ERROR_STOP would
--   report that older note as if it were this one. After the arm statement
--   the worst case is an empty variable, and statement 3 answers an empty or
--   unrecognised variable with ZERO ROWS, never with a fabricated outcome.

-- ---------------------------------------------------------------------------
-- 1. Arm: no result can survive from an earlier invocation.
-- ---------------------------------------------------------------------------
set nora.s4_backfill_outcome = '';

-- ---------------------------------------------------------------------------
-- 2. The one mutating statement: one note, one transaction, fail closed.
-- ---------------------------------------------------------------------------
do $$
declare
    v_tbl      text;
    v_id       bigint;
    v_cn       bigint;
    v_dn       bigint;
    v_arr      jsonb[];
    v_keys     text[];   -- D, in element order
    v_names    text[];
    v_mimes    text[];
    v_want     text[];   -- D, sorted
    v_have     text[];   -- E, sorted
    v_before   bigint[];
    v_after    bigint[];
    v_outcome  text;
    v_detail   text := '';
begin
    -- ---- 1. executor and isolation ------------------------------------------
    if current_user <> 'postgres' then
        raise exception 'attachment backfill: runs as postgres only, not as %', current_user
            using errcode = '42501', detail = 'NORA_ATTACHMENT_INVALID_ARGUMENT';
    end if;
    if current_setting('transaction_isolation') <> 'read committed' then
        raise exception 'attachment backfill: requires READ COMMITTED, the transaction runs %',
                        current_setting('transaction_isolation')
            using errcode = '55000', detail = 'NORA_ATTACHMENT_READ_COMMITTED_REQUIRED';
    end if;

    -- ---- 2. yield to live users ---------------------------------------------
    -- Transaction-local. A note a user is editing right now must not be held up
    -- by maintenance: after this budget the transaction fails with 55P03 and
    -- the operator simply runs the next pass.
    perform set_config('lock_timeout', '3s', true);

    -- baseline of this transaction's own write counters (see step 7)
    v_before := array[
        coalesce((select s.n_tup_ins from pg_stat_xact_user_tables s where s.relid = 'public.attachments'::regclass), 0),
        coalesce((select s.n_tup_del from pg_stat_xact_user_tables s where s.relid = 'public.attachments'::regclass), 0),
        coalesce((select s.n_tup_upd from pg_stat_xact_user_tables s where s.relid = 'public.attachments'::regclass), 0),
        coalesce((select s.n_tup_ins + s.n_tup_upd + s.n_tup_del from pg_stat_xact_user_tables s
                   where s.relid = 'nora_private.attachment_storage_deletion_queue'::regclass), 0),
        coalesce((select s.n_tup_ins + s.n_tup_upd + s.n_tup_del from pg_stat_xact_user_tables s
                   where s.relid = 'public.contact_notes'::regclass), 0),
        coalesce((select s.n_tup_ins + s.n_tup_upd + s.n_tup_del from pg_stat_xact_user_tables s
                   where s.relid = 'public.deal_notes'::regclass), 0),
        coalesce((select s.n_tup_ins from pg_stat_xact_user_tables s where s.relid = 'public.audit_events'::regclass), 0)];

    -- ---- 3. LOCK FIRST -------------------------------------------------------
    -- Only the id is selected. The array is deliberately NOT read here: it is
    -- read in step 4, after this statement returned, so READ COMMITTED hands
    -- the next statement a snapshot that includes whatever the previous holder
    -- of this row committed while we waited.
    select 'contact_notes', n.id
      into v_tbl, v_id
      from public.contact_notes n
     where coalesce(cardinality(n.attachments), 0) > 0
       and not exists (select 1 from public.attachments a where a.contact_note_id = n.id)
     order by n.id
     limit 1
       for update;

    if v_id is null then
        select 'deal_notes', n.id
          into v_tbl, v_id
          from public.deal_notes n
         where coalesce(cardinality(n.attachments), 0) > 0
           and not exists (select 1 from public.attachments a where a.deal_note_id = n.id)
         order by n.id
         limit 1
           for update;
    end if;

    if v_id is null then
        -- outcome|note_table|note_id|row_count - no note, nothing written
        perform set_config('nora.s4_backfill_outcome', 'NO_CANDIDATE|||0', false);
        raise notice 'W8-C S4 backfill: NO_CANDIDATE';
        return;
    end if;

    v_cn := case when v_tbl = 'contact_notes' then v_id end;
    v_dn := case when v_tbl = 'deal_notes'    then v_id end;

    -- ---- 4. read the CURRENT state of the LOCKED note ------------------------
    if v_tbl = 'contact_notes' then
        select n.attachments into v_arr from public.contact_notes n where n.id = v_id;
    else
        select n.attachments into v_arr from public.deal_notes n where n.id = v_id;
    end if;

    select coalesce(array_agg(a.storage_key order by a.storage_key collate "C"), '{}')
      into v_have
      from public.attachments a
     where a.contact_note_id = v_cn or a.deal_note_id = v_dn;

    -- D comes from the ONE grammar (S3B), never from a hand-written parser and
    -- never from `src`. An array outside grammar v1 raises here, exactly as it
    -- would for a live note write.
    select coalesce(array_agg(x.storage_key order by x.element_no), '{}'),
           coalesce(array_agg(x.file_name   order by x.element_no), '{}'),
           coalesce(array_agg(x.mime_type   order by x.element_no), '{}')
      into v_keys, v_names, v_mimes
      from nora_private.note_attachment_reference_rows(v_arr) as x;

    select coalesce(array_agg(k order by k collate "C"), '{}') into v_want from unnest(v_keys) as t(k);

    -- ---- 5. re-classify UNDER THE LOCK --------------------------------------
    -- The preflight's verdict is corpus-wide and older than this transaction.
    -- Everything that is not "EMPTY with work" or "already EXACT" stops the run
    -- here, and it stops BEFORE reconcile: calling the core on an EXTRA note
    -- would manufacture a deletion intent out of drift nobody has explained.
    if cardinality(v_want) = 0 then
        if cardinality(v_have) > 0 then
            raise exception 'attachment backfill: % id=% owns % attachment row(s) but its array is empty (ROW_FOR_EMPTY_NOTE)',
                            v_tbl, v_id, cardinality(v_have)
                using errcode = '55000', hint = 'S4 never repairs unexplained relational state. Re-run the preflight.';
        end if;
        -- the array was emptied by a live write while we waited for the lock
        v_outcome := 'SKIPPED_ALREADY_EXACT';
        v_detail  := 'array empty under lock';

    elsif cardinality(v_have) = 0 then
        -- EMPTY: the historical case S4 exists for. E = {} means REMOVE = {}
        -- and KEEP = {}, so the core can only INSERT (asserted in step 7).
        perform nora_private.reconcile_note_attachments(v_cn, v_dn, v_arr);
        v_outcome := 'BACKFILLED';
        v_detail  := cardinality(v_want)::text || ' attachment(s)';

    elsif v_have = v_want then
        -- projected already - by S3B first touch, or by an earlier invocation
        -- that won the race for this note. Metadata must agree too, otherwise
        -- this is METADATA_MISMATCH and not a no-op.
        if exists (select 1
                     from unnest(v_keys, v_names, v_mimes) as d(storage_key, file_name, mime_type)
                     join public.attachments a
                       on a.storage_key = d.storage_key
                      and (a.contact_note_id = v_cn or a.deal_note_id = v_dn)
                    where a.file_name is distinct from d.file_name
                       or a.mime_type is distinct from d.mime_type) then
            raise exception 'attachment backfill: % id=% has rows whose title or type differ from its array (METADATA_MISMATCH)',
                            v_tbl, v_id
                using errcode = '55000', hint = 'S4 never rewrites an existing attachment row. Re-run the preflight.';
        end if;
        v_outcome := 'SKIPPED_ALREADY_EXACT';
        v_detail  := cardinality(v_have)::text || ' attachment(s)';

    else
        raise exception 'attachment backfill: % id=% is neither empty nor exact under the lock (% desired key(s), % row(s)) — PARTIAL or EXTRA',
                        v_tbl, v_id, cardinality(v_want), cardinality(v_have)
            using errcode = '55000',
                  hint = 'S4 never auto-repairs drift, and never lets an EXTRA row become a deletion intent. Re-run the preflight.';
    end if;

    -- ---- 6. note-local parity ------------------------------------------------
    select coalesce(array_agg(a.storage_key order by a.storage_key collate "C"), '{}')
      into v_have
      from public.attachments a
     where a.contact_note_id = v_cn or a.deal_note_id = v_dn;

    if v_have <> v_want then
        raise exception 'attachment backfill: % id=% did not reach parity (% row(s) for % desired key(s))',
                        v_tbl, v_id, cardinality(v_have), cardinality(v_want)
            using errcode = '55000';
    end if;
    if exists (select 1
                 from unnest(v_keys, v_names, v_mimes) as d(storage_key, file_name, mime_type)
                 left join public.attachments a
                        on a.storage_key = d.storage_key
                       and (a.contact_note_id = v_cn or a.deal_note_id = v_dn)
                where a.id is null
                   or a.file_name is distinct from d.file_name
                   or a.mime_type is distinct from d.mime_type
                   or a.byte_size is not null
                   or num_nonnulls(a.contact_note_id, a.deal_note_id) <> 1) then
        raise exception 'attachment backfill: % id=% has a row with wrong metadata, a byte_size or a broken owner',
                        v_tbl, v_id
            using errcode = '55000';
    end if;

    -- ---- 7. what this transaction actually wrote ----------------------------
    -- Self-validating: the INSERT count must equal the number of keys, which
    -- also proves the counters are live. Everything else must be zero - no
    -- DELETE, no UPDATE, no queue row, no note write, no audit event.
    v_after := array[
        coalesce((select s.n_tup_ins from pg_stat_xact_user_tables s where s.relid = 'public.attachments'::regclass), 0),
        coalesce((select s.n_tup_del from pg_stat_xact_user_tables s where s.relid = 'public.attachments'::regclass), 0),
        coalesce((select s.n_tup_upd from pg_stat_xact_user_tables s where s.relid = 'public.attachments'::regclass), 0),
        coalesce((select s.n_tup_ins + s.n_tup_upd + s.n_tup_del from pg_stat_xact_user_tables s
                   where s.relid = 'nora_private.attachment_storage_deletion_queue'::regclass), 0),
        coalesce((select s.n_tup_ins + s.n_tup_upd + s.n_tup_del from pg_stat_xact_user_tables s
                   where s.relid = 'public.contact_notes'::regclass), 0),
        coalesce((select s.n_tup_ins + s.n_tup_upd + s.n_tup_del from pg_stat_xact_user_tables s
                   where s.relid = 'public.deal_notes'::regclass), 0),
        coalesce((select s.n_tup_ins from pg_stat_xact_user_tables s where s.relid = 'public.audit_events'::regclass), 0)];

    if (v_after[1] - v_before[1]) <> (case when v_outcome = 'BACKFILLED' then cardinality(v_want) else 0 end)
       or v_after[2] <> v_before[2]
       or v_after[3] <> v_before[3]
       or v_after[4] <> v_before[4]
       or v_after[5] <> v_before[5]
       or v_after[6] <> v_before[6]
       or v_after[7] <> v_before[7] then
        raise exception 'attachment backfill: % id=% wrote something it must not (attachments +%/-%/~%, queue %, contact_notes %, deal_notes %, audit %)',
                        v_tbl, v_id,
                        v_after[1] - v_before[1], v_after[2] - v_before[2], v_after[3] - v_before[3],
                        v_after[4] - v_before[4], v_after[5] - v_before[5], v_after[6] - v_before[6],
                        v_after[7] - v_before[7]
            using errcode = '55000';
    end if;

    -- outcome|note_table|note_id|row_count. row_count is the MEASURED insert
    -- delta from the assertion above, not a restatement of the intent, so the
    -- reported number and the number this transaction really wrote cannot
    -- disagree. Statement 3 turns this into the row the caller receives.
    perform set_config('nora.s4_backfill_outcome',
                       v_outcome || '|' || v_tbl || '|' || v_id::text || '|'
                       || (v_after[1] - v_before[1])::text, false);
    raise notice 'W8-C S4 backfill: % — % id=% (%)', v_outcome, v_tbl, v_id, v_detail;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Report: the outcome of THIS invocation, returned by THIS invocation.
--
-- The operator contract. It needs no second call, no second session and no
-- NOTICE: notices are a psql convenience, this row is the answer. An empty or
-- unrecognised variable - only reachable if statement 2 did not complete -
-- yields ZERO ROWS, so "no row" means "this invocation did not finish" and
-- never a fabricated success.
-- ---------------------------------------------------------------------------
select s.p[1]                                     as outcome,
       nullif(s.p[2], '')                         as note_table,
       nullif(s.p[3], '')::bigint                 as note_id,
       coalesce(nullif(s.p[4], ''), '0')::integer as row_count
  from (select string_to_array(current_setting('nora.s4_backfill_outcome', true), '|') as p) s
 where s.p[1] in ('BACKFILLED', 'SKIPPED_ALREADY_EXACT', 'NO_CANDIDATE');
