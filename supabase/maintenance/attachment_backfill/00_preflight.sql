-- STRICT READ-ONLY. Nora CRM — W8-C S4 attachment backfill · STEP 00: PREFLIGHT GATE.
--
-- This file writes NOTHING: no INSERT / UPDATE / DELETE, no reconcile call, no
-- queue transition, no Storage call, no durable object, no DDL, no lock. It
-- runs inside BEGIN TRANSACTION READ ONLY. (It does set one session variable to
-- hand its verdict from its first statement to its next two; a GUC is not a
-- database write and READ ONLY permits it.) It decides one thing and prints its
-- reasoning:
--
--     GO    -> 10_backfill_one_note.sql may be run
--     STOP  -> it may not; the listed condition is resolved first
--
-- It is safe against Production at any moment, and it is the ONLY thing that
-- makes the runner's cheap candidate predicate ("note has attachments and owns
-- no row") legitimate. That predicate cannot see a PARTIAL, EXTRA or
-- metadata-diverged note, because such a note already owns a row and is
-- therefore never picked up. The corpus-wide classification below is what rules
-- those states out; skipping this step turns a silent mis-classification into a
-- silent gap.
--
-- REQUIRES, in the SAME session, the canonical verifier:
--     supabase/tests/attachment_backfill_consistency_verification.sql
-- There is one implementation of the consistency classes and this file does not
-- copy it. The order matters and so does the session:
--
--   1. the verifier runs FIRST and creates a session-local pg_temp helper
--   2. this file runs SECOND and calls that helper
--   3. both must reach the SAME execution session / payload
--   4. disconnecting removes the helper; nothing durable is left behind
--   5. this file can NOT recreate the helper, and does not try - a session
--      that never ran the verifier fails closed below, it never guesses GO
--   6. the helper EXISTING is not the same as the helper having CLASSIFIED,
--      so this file also asserts the shape of what came back (see next block)
--
-- THE CENSUS CONTRACT - why "the helper exists" is not enough.
--   This gate does not define consistency; it delegates that to the verifier
--   and then counts. So it has to prove the delegate really delivered the
--   definition, because every failure mode of the delegate looks like good
--   news here: a census with no rows, a class short, a class renamed, a class
--   duplicated over another, or a blocking class quietly turned non-blocking
--   all produce "nothing is blocking" - and "nothing was classified" would
--   otherwise be waved through as "nothing is wrong".
--
--   Section E therefore reads the census ONCE and asserts, BEFORE consuming a
--   single count, that it is exactly the canonical contract: the sixteen
--   class names, each present once, each with its documented blocking flag,
--   each with a non-negative count. Anything else raises 55000
--   NORA_S4_CLASSIFICATION_CENSUS_INVALID and no verdict is written - so an
--   incomplete classification can never become GO. The class set itself is
--   the verifier's (14 blocking + 2 INFO); this file only insists on getting
--   all of it.
--
--   psql -v ON_ERROR_STOP=1 \
--        -f supabase/tests/attachment_backfill_consistency_verification.sql \
--        -f supabase/maintenance/attachment_backfill/00_preflight.sql
--
--   (Production: send both files as ONE MCP execute_sql payload, verifier
--    first.)
--
--   The two files are NOT the same kind of artifact, and it matters if you
--   intend to declare a READ ONLY transaction:
--     this file                  STRICT READ-ONLY, READ ONLY compatible
--     the verifier               session-local verification setup; it creates
--                                a pg_temp function, so it is NOT strict SQL
--                                read-only and PostgreSQL REFUSES it inside a
--                                READ ONLY transaction. It still makes no
--                                durable or business-data change, which is
--                                what makes it Production-safe.
--
-- THE GO RULE IS NOT THE VERIFIER'S GREEN RULE.
--   verifier GREEN  = all fourteen blocking classes are 0  (the S5 gate)
--   preflight GO    = all blocking classes are 0 EXCEPT
--                     BACKFILL_CANDIDATE_REMAINING, which is the WORK
-- Before S4 runs, BACKFILL_CANDIDATE_REMAINING is exactly the set of notes to
-- process; after the last note it is 0 and the verifier turns GREEN.
--
-- STATE POLICY (S4 decisions D, E, G)
--   EMPTY (attachments, no rows)          allowed - this is the candidate
--   EXACT (rows match the JSON)           allowed - no work, never locked
--   PARTIAL / EXTRA / METADATA_MISMATCH   STOP - never auto-repaired
--   INVALID_GRAMMAR / duplicates          STOP
--   WRONG_OWNER / ROW_FOR_EMPTY_NOTE      STOP
--   active or done deletion intent        STOP
--   cross-source storage key              STOP - escalate, do not continue
--   STORAGE_OBJECT_MISSING                INFO only - reported, never a STOP
--   ORDINAL_NULL / ORDINAL_DUPLICATE_PER_NOTE   STOP - S6-A, and they do
--     NOT join the BACKFILL_CANDIDATE_REMAINING exemption below: a row
--     without an append position, or two rows of one note claiming the
--     same one, is a defect and never "the work that is left"
--   ORDINAL_VS_ARRAY_ORDER                INFO only - S6-A; an append
--     sequence may legally diverge from the legacy array order (a
--     front-insert, a zero-write reorder); retires at S6-B1
--
-- OUTPUT: one row per check and per census figure, then a verdict row. The
-- last statement raises 55000 on STOP so the file also fails closed under
-- ON_ERROR_STOP / MCP. Storage keys are never printed; evidence is always a
-- `<table>:<id>` label or a surface name.
--
-- WHY THERE IS AN ARM STATEMENT: the classification hands its verdict to the
-- report and the gate through a session variable. A GUC write is transactional,
-- so without statement 1 a classification that aborted would leave the PREVIOUS
-- run's verdict in place - and if that verdict was GO, the gate would wave a
-- corpus through that was never classified. Clearing it first makes the only
-- reachable failure "no verdict", which statement 4 turns into a 55000. The
-- variable is transport INSIDE this payload, never an operator contract.

-- ---------------------------------------------------------------------------
-- 1. Arm: no verdict can survive from an earlier run in this session.
-- ---------------------------------------------------------------------------
set nora.s4_preflight = '';

-- ---------------------------------------------------------------------------
-- 2. Classify. Result goes into a SESSION GUC - no table is written.
-- ---------------------------------------------------------------------------
do $$
declare
    r            record;
    v_rows       jsonb := '[]'::jsonb;
    v_stop       text[] := '{}';
    v_names      text;
    v_notes      bigint;
    v_notes_att  bigint;
    v_elements   bigint;
    v_att_rows   bigint;
    v_cand       bigint;
    v_blocking   bigint;
    v_iso        text;
    v_ok         boolean;
    v_census     jsonb;
    v_shape      text[];
    v_expect     text[];

    c_missing constant text :=
        'W8-C S4 preflight: pg_temp.attachment_backfill_findings() is not defined in this session. '
        || 'Run supabase/tests/attachment_backfill_consistency_verification.sql FIRST, in the same session.';

    -- The canonical census contract: `<problem_class>:<blocking>`, 14 blocking
    -- classes plus the two INFO classes. Order is irrelevant - both sides are
    -- sorted before they are compared - but PRESENCE, UNIQUENESS and the
    -- BLOCKING FLAG are all part of it.
    c_census constant text[] := array[
        'INVALID_GRAMMAR:true',      'JSON_KEY_WITHOUT_ROW:true',  'ROW_WITHOUT_JSON_KEY:true',
        'METADATA_MISMATCH:true',    'DUPLICATE_KEY_IN_NOTE:true', 'DUPLICATE_KEY_ACROSS_NOTES:true',
        'WRONG_OWNER:true',          'ROW_FOR_EMPTY_NOTE:true',    'QUEUE_CONFLICT:true',
        'BYTE_SIZE_NOT_NULL:true',   'CROSS_SOURCE_KEY:true',      'BACKFILL_CANDIDATE_REMAINING:true',
        'ORDINAL_NULL:true',         'ORDINAL_DUPLICATE_PER_NOTE:true',
        'STORAGE_OBJECT_MISSING:false', 'ORDINAL_VS_ARRAY_ORDER:false'];
begin
    if to_regprocedure('pg_temp.attachment_backfill_findings()') is null then
        raise exception '%', c_missing using errcode = '55000';
    end if;

    -- ---- A. executor and isolation -------------------------------------------
    if current_user <> 'postgres' then
        v_stop := v_stop || format('executor is %s, the backfill runs as postgres only', current_user);
    end if;
    v_rows := v_rows || jsonb_build_object(
        'section', 'A environment', 'item', 'executor',
        'status', case when current_user = 'postgres' then 'OK' else 'STOP' end,
        'detail', current_user);

    v_iso := current_setting('transaction_isolation');
    if v_iso <> 'read committed' then
        v_stop := v_stop || format('transaction_isolation is %s; the S3A key protocol requires READ COMMITTED', v_iso);
    end if;
    v_rows := v_rows || jsonb_build_object(
        'section', 'A environment', 'item', 'transaction_isolation',
        'status', case when v_iso = 'read committed' then 'OK' else 'STOP' end, 'detail', v_iso);

    if current_setting('default_transaction_isolation') <> 'read committed' then
        v_stop := v_stop || format('default_transaction_isolation is %s', current_setting('default_transaction_isolation'));
    end if;
    v_rows := v_rows || jsonb_build_object(
        'section', 'A environment', 'item', 'default_transaction_isolation',
        'status', case when current_setting('default_transaction_isolation') = 'read committed' then 'OK' else 'STOP' end,
        'detail', current_setting('default_transaction_isolation'));

    -- a database- or role-level override would silently change the isolation of
    -- a later session even though this one looks fine
    select string_agg(s.setconfig::text, ' | ') into v_names
      from pg_db_role_setting s
     where exists (select 1 from unnest(s.setconfig) as c(v) where c.v like 'default\_transaction\_isolation=%');
    if v_names is not null then
        v_stop := v_stop || format('a database/role setting overrides default_transaction_isolation: %s', v_names);
    end if;
    v_rows := v_rows || jsonb_build_object(
        'section', 'A environment', 'item', 'isolation overrides',
        'status', case when v_names is null then 'OK' else 'STOP' end, 'detail', coalesce(v_names, 'none'));

    -- ---- B. S3B runtime objects ---------------------------------------------
    for r in
        select * from (values
            ('nora_private.note_attachment_reference_rows(jsonb[])',           false, 's', array['search_path=""']),
            ('nora_private.reconcile_note_attachments(bigint,bigint,jsonb[])', false, 'v', array['search_path=""', 'row_security=off']),
            ('nora_private.project_note_attachments()',                        true,  'v', array['search_path=""', 'row_security=off'])
        ) as t(sig, secdef, volatility, config)
    loop
        if not exists (select 1 from pg_proc p
                       where p.oid = to_regprocedure(r.sig)
                         and p.prosecdef = r.secdef
                         and p.provolatile = r.volatility::"char"
                         and pg_get_userbyid(p.proowner) = 'postgres'
                         and p.proconfig = r.config) then
            v_stop := v_stop || format('S3B object missing or changed: %s', r.sig);
            v_rows := v_rows || jsonb_build_object('section', 'B S3B objects', 'item', r.sig, 'status', 'STOP', 'detail', 'missing or changed');
        else
            v_rows := v_rows || jsonb_build_object('section', 'B S3B objects', 'item', r.sig, 'status', 'OK', 'detail', '');
        end if;
    end loop;

    select string_agg(t.tgname, ', ' order by t.tgname) into v_names
      from pg_trigger t
     where not t.tgisinternal and t.tgfoid = to_regprocedure('nora_private.project_note_attachments()');
    v_ok := v_names is not distinct from
           'project_contact_note_attachments_after_insert_trigger, project_contact_note_attachments_after_update_trigger, '
        || 'project_deal_note_attachments_after_insert_trigger, project_deal_note_attachments_after_update_trigger';
    if not v_ok then
        v_stop := v_stop || 'the four S3B projection triggers are not exactly as shipped';
    end if;
    v_rows := v_rows || jsonb_build_object('section', 'B S3B objects', 'item', 'projection triggers',
        'status', case when v_ok then 'OK' else 'STOP' end, 'detail', coalesce(v_names, '<none>'));

    -- ---- C. S3A / S2A predecessor objects -----------------------------------
    for r in
        select * from (values
            ('nora_private.lock_attachment_storage_key(text)'),
            ('nora_private.guard_attachment_reference_admission()'),
            ('nora_private.guard_attachment_storage_key_immutable()'),
            ('nora_private.enqueue_attachment_storage_deletion()'),
            ('nora_private.attachment_url_liveness(text,text)'),
            ('nora_private.attachment_file_value_liveness(jsonb,text)'),
            ('nora_private.attachment_storage_key_liveness(text)')
        ) as t(sig)
    loop
        if to_regprocedure(r.sig) is null then
            v_stop := v_stop || format('predecessor object missing: %s', r.sig);
            v_rows := v_rows || jsonb_build_object('section', 'C S3A/S2A objects', 'item', r.sig, 'status', 'STOP', 'detail', 'missing');
        else
            v_rows := v_rows || jsonb_build_object('section', 'C S3A/S2A objects', 'item', r.sig, 'status', 'OK', 'detail', '');
        end if;
    end loop;

    select string_agg(t.tgname, ', ' order by t.tgname) into v_names
      from pg_trigger t where t.tgrelid = 'public.attachments'::regclass and not t.tgisinternal;
    v_ok := v_names is not distinct from 'enqueue_attachment_storage_deletion_after_delete_trigger, '
                                      || 'guard_attachment_reference_admission_after_insert_trigger, '
                                      || 'guard_attachment_storage_key_immutable_before_update_trigger';
    if not v_ok then
        v_stop := v_stop || format('public.attachments triggers are not the S3A set: %s', coalesce(v_names, '<none>'));
    end if;
    v_rows := v_rows || jsonb_build_object('section', 'C S3A/S2A objects', 'item', 'attachments triggers',
        'status', case when v_ok then 'OK' else 'STOP' end, 'detail', coalesce(v_names, '<none>'));

    v_ok := to_regclass('nora_private.attachment_storage_deletion_queue') is not null;
    if not v_ok then
        v_stop := v_stop || 'the deletion queue is missing';
    end if;
    v_rows := v_rows || jsonb_build_object('section', 'C S3A/S2A objects', 'item', 'deletion queue table',
        'status', case when v_ok then 'OK' else 'STOP' end, 'detail', '');

    -- ---- D. direct public.attachments access assumptions --------------------
    for r in
        select * from (values ('authenticated', 'SELECT'), ('anon', ''), ('service_role', '')) as t(grantee, privs)
    loop
        if (select string_agg(pr, ',' order by pr)
              from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) pr
             where has_table_privilege(r.grantee, 'public.attachments', pr))
           is distinct from nullif(r.privs, '') then
            v_stop := v_stop || format('%s privileges on public.attachments are not the S3A matrix', r.grantee);
            v_rows := v_rows || jsonb_build_object('section', 'D attachments surface', 'item', r.grantee || ' privileges',
                'status', 'STOP', 'detail', 'expected ' || coalesce(nullif(r.privs, ''), 'none'));
        else
            v_rows := v_rows || jsonb_build_object('section', 'D attachments surface', 'item', r.grantee || ' privileges',
                'status', 'OK', 'detail', coalesce(nullif(r.privs, ''), 'none'));
        end if;
    end loop;

    v_ok := (select c.relrowsecurity from pg_class c where c.oid = 'public.attachments'::regclass)
        and pg_get_userbyid((select relowner from pg_class where oid = 'public.attachments'::regclass)) = 'postgres'
        and exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
                     where i.indrelid = 'public.attachments'::regclass
                       and c.relname = 'uq__attachments__storage_key'
                       and i.indisunique and i.indpred is null and i.indnatts = 1)
        and exists (select 1 from pg_constraint con
                     where con.conrelid = 'public.attachments'::regclass
                       and con.conname = 'attachments_owner_check' and con.contype = 'c')
        and (select count(*) from pg_constraint con
              where con.conrelid = 'public.attachments'::regclass and con.contype = 'f'
                and con.confdeltype = 'c'
                and con.confrelid in ('public.contact_notes'::regclass, 'public.deal_notes'::regclass)) = 2;
    if not v_ok then
        v_stop := v_stop || 'public.attachments does not carry the S1/S3A table contract '
                         || '(RLS, owner postgres, UNIQUE(storage_key), owner XOR, two CASCADE note FKs)';
    end if;
    v_rows := v_rows || jsonb_build_object('section', 'D attachments surface', 'item', 'table contract',
        'status', case when v_ok then 'OK' else 'STOP' end,
        'detail', 'RLS / owner / UNIQUE(storage_key) / owner XOR / 2 CASCADE FKs');

    -- ---- E. corpus classification (the one canonical verifier) ---------------
    -- Read the census ONCE. Everything below consumes THIS snapshot, so the
    -- census that is asserted is the census that is counted - three separate
    -- calls under READ COMMITTED would be three separate snapshots.
    select coalesce(jsonb_agg(to_jsonb(f) order by f.problem_class collate "C"), '[]'::jsonb)
      into v_census
      from pg_temp.attachment_backfill_findings() f;

    -- Assert the contract BEFORE consuming a single count. coalesce keeps a
    -- NULL class or a NULL flag from turning the comparison itself into NULL -
    -- a malformed census must fail the check, not slip past it.
    select coalesce(array_agg(coalesce(x.problem_class, '<null>') || ':' || coalesce(x.blocking::text, '<null>')
                              order by x.problem_class collate "C"), '{}')
      into v_shape
      from jsonb_to_recordset(v_census)
        as x(problem_class text, blocking boolean, finding_count bigint, evidence text);
    select coalesce(array_agg(e order by e collate "C"), '{}') into v_expect from unnest(c_census) as t(e);

    if v_shape <> v_expect then
        raise exception 'W8-C S4 preflight: the classification census is not the canonical contract — % row(s), unexpected [%], missing [%], duplicated [%]',
                        cardinality(v_shape),
                        array_to_string(array(select u from unnest(v_shape) u except select e from unnest(v_expect) e), ', '),
                        array_to_string(array(select e from unnest(v_expect) e except select u from unnest(v_shape) u), ', '),
                        array_to_string(array(select u from unnest(v_shape) u group by u having count(*) > 1), ', ')
            using errcode = '55000',
                  detail = 'NORA_S4_CLASSIFICATION_CENSUS_INVALID',
                  hint = 'Run supabase/tests/attachment_backfill_consistency_verification.sql - the canonical '
                      || 'verifier - FIRST in this same session, unmodified. A census that is not the '
                      || 'sixteen-class contract is not an all-zero corpus, and this gate never reads it as one.';
    end if;
    if exists (select 1 from jsonb_to_recordset(v_census)
                 as x(problem_class text, blocking boolean, finding_count bigint, evidence text)
                where x.finding_count is null or x.finding_count < 0) then
        raise exception 'W8-C S4 preflight: the classification census carries a NULL or negative finding_count'
            using errcode = '55000',
                  detail = 'NORA_S4_CLASSIFICATION_CENSUS_INVALID',
                  hint = 'The canonical verifier never reports one. Re-run it, unmodified, in this session.';
    end if;

    for r in select * from jsonb_to_recordset(v_census)
               as t(problem_class text, blocking boolean, finding_count bigint, evidence text) loop
        v_rows := v_rows || jsonb_build_object(
            'section', 'E corpus',
            'item', r.problem_class,
            'status', case
                        when not r.blocking then case when r.finding_count > 0 then 'INFO' else 'OK' end
                        when r.problem_class = 'BACKFILL_CANDIDATE_REMAINING'
                            then case when r.finding_count > 0 then 'WORK' else 'OK' end
                        when r.finding_count > 0 then 'STOP'
                        else 'OK' end,
            'detail', r.finding_count::text || case when r.evidence = '' then '' else ' — ' || r.evidence end);
        -- S6-A: the exemption is BACKFILL_CANDIDATE_REMAINING and nothing else.
        -- ORDINAL_NULL and ORDINAL_DUPLICATE_PER_NOTE are ordinary STOP classes.
        if r.blocking and r.finding_count > 0 and r.problem_class <> 'BACKFILL_CANDIDATE_REMAINING' then
            v_stop := v_stop || format('%s = %s (%s)', r.problem_class, r.finding_count,
                                       coalesce(nullif(r.evidence, ''), 'no evidence label'));
        end if;
    end loop;

    select coalesce(sum(x.finding_count), 0) into v_cand
      from jsonb_to_recordset(v_census)
        as x(problem_class text, blocking boolean, finding_count bigint, evidence text)
     where x.problem_class = 'BACKFILL_CANDIDATE_REMAINING';
    select count(*) into v_blocking
      from jsonb_to_recordset(v_census)
        as x(problem_class text, blocking boolean, finding_count bigint, evidence text)
     where x.blocking and x.finding_count > 0 and x.problem_class <> 'BACKFILL_CANDIDATE_REMAINING';

    -- ---- F. census -----------------------------------------------------------
    select (select count(*) from public.contact_notes) + (select count(*) from public.deal_notes),
           (select count(*) from public.contact_notes where coalesce(cardinality(attachments), 0) > 0)
           + (select count(*) from public.deal_notes where coalesce(cardinality(attachments), 0) > 0),
           (select coalesce(sum(cardinality(attachments)), 0) from public.contact_notes)
           + (select coalesce(sum(cardinality(attachments)), 0) from public.deal_notes),
           (select count(*) from public.attachments)
      into v_notes, v_notes_att, v_elements, v_att_rows;

    v_rows := v_rows
        || jsonb_build_object('section', 'F census', 'item', 'notes total', 'status', 'INFO', 'detail', v_notes::text)
        || jsonb_build_object('section', 'F census', 'item', 'notes with attachments', 'status', 'INFO', 'detail', v_notes_att::text)
        || jsonb_build_object('section', 'F census', 'item', 'attachment elements (JSON)', 'status', 'INFO', 'detail', v_elements::text)
        || jsonb_build_object('section', 'F census', 'item', 'public.attachments rows', 'status', 'INFO', 'detail', v_att_rows::text)
        || jsonb_build_object('section', 'F census', 'item', 'EMPTY (backfill candidates)', 'status', 'INFO', 'detail', v_cand::text)
        || jsonb_build_object('section', 'F census', 'item', 'EXACT (already projected)', 'status', 'INFO',
               'detail', case when v_blocking = 0 then (v_notes_att - v_cand)::text
                              else 'not derivable while a blocking class is non-zero' end)
        || jsonb_build_object('section', 'F census', 'item', 'queue rows', 'status', 'INFO',
               'detail', (select count(*)::text from nora_private.attachment_storage_deletion_queue))
        || jsonb_build_object('section', 'F census', 'item', 'storage objects in bucket attachments', 'status', 'INFO',
               'detail', (select count(*)::text from storage.objects where bucket_id = 'attachments'));

    perform set_config('nora.s4_preflight',
        jsonb_build_object(
            'verdict', case when cardinality(v_stop) = 0 then 'GO' else 'STOP' end,
            'candidates', v_cand,
            'reasons', to_jsonb(v_stop),
            'rows', v_rows)::text,
        false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The report. No verdict in this session means NO ROWS, never a stale one.
-- ---------------------------------------------------------------------------
with v as (select nullif(current_setting('nora.s4_preflight', true), '')::jsonb as j)
select x.section, x.item, x.status, x.detail
  from v cross join lateral jsonb_to_recordset(v.j -> 'rows')
         as x(section text, item text, status text, detail text)
 where v.j is not null
union all
select 'Z verdict',
       v.j ->> 'verdict',
       case when (v.j ->> 'verdict') = 'GO' then 'OK' else 'STOP' end,
       'candidates to backfill: ' || (v.j ->> 'candidates')
       || case when jsonb_array_length(v.j -> 'reasons') = 0 then ''
               else ' — ' || (v.j -> 'reasons')::text end
  from v
 where v.j is not null
 order by 1, 2;

-- ---------------------------------------------------------------------------
-- 4. Fail closed: on STOP, and on "this session never classified anything".
-- ---------------------------------------------------------------------------
do $$
declare
    v jsonb := nullif(current_setting('nora.s4_preflight', true), '')::jsonb;
begin
    if v is null then
        raise exception 'W8-C S4 PREFLIGHT: no verdict was produced in this session'
            using errcode = '55000',
                  hint = 'The classifying statement did not complete - most often because '
                      || 'supabase/tests/attachment_backfill_consistency_verification.sql did not run '
                      || 'FIRST in this same session. Absence of a verdict is never GO. Send the '
                      || 'verifier and this file as one payload and read the error above.';
    end if;
    if (v ->> 'verdict') <> 'GO' then
        raise exception E'W8-C S4 PREFLIGHT: STOP\n%',
            (select string_agg('  - ' || (value #>> '{}'), E'\n') from jsonb_array_elements(v -> 'reasons'))
            using errcode = '55000',
                  hint = 'S4 never auto-repairs an unexpected state. Resolve the listed condition, then re-run the verifier and this preflight.';
    end if;
    raise notice 'W8-C S4 PREFLIGHT: GO — % backfill candidate(s)', v ->> 'candidates';
end;
$$;
