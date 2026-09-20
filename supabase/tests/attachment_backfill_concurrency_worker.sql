-- One REAL database session of the W8-C S4 backfill concurrency matrix.
-- Invoked in parallel by attachment_backfill_concurrency_runner.ps1 with psql
-- variables:
--   scenario  scenario / round label
--   worker    label; a holder signals under this name
--   mode      s4 | hold_s4 | hold_set | after_set | after_text |
--             hold_delete | after_delete | hold_inspect | after_inspect
--   tbl       table the operation targets (contact_notes | deal_notes | contacts |
--             companies | deals)
--   id        row id
--   arr       s4h_ctx key of the attachment array to write (set modes)
--   job       queue job id, token = its lease token (inspect modes)
--   signal    follower modes: the holder's worker label to wait for ('' = none)
--   await     holder modes: 'blocked' | 'event:<worker>:<EVENT>' | 'seconds:<n>'
--   pause     hold_s4: the storage key to pause on
--   pausewhen hold_s4: 'before' (row does not exist yet) | 'after' (row and its
--             S3A key lock are held)
--   runner    path of the REAL 10_backfill_one_note.sql inside the container
--   timeout   seconds for every wait (a timeout is recorded, never passes)
--
-- The backfill modes run the REAL maintenance file with \i. It is one
-- statement, so in autocommit it is exactly one transaction - the same shape
-- the operator uses in Production.

\set ON_ERROR_STOP off

-- The runner's third statement returns the outcome row of THAT invocation.
-- Unaligned, tuples-only output makes it one greppable line, so the harness can
-- capture what the operator's single call actually returned - it never asks the
-- database a second time.
\pset format unaligned
\pset tuples_only on

select (:'mode' = 's4')            as m_s4,
       (:'mode' = 'hold_s4')       as m_hold_s4,
       (:'mode' = 'hold_set')      as m_hold_set,
       (:'mode' = 'after_set')     as m_after_set,
       (:'mode' = 'after_text')    as m_after_text,
       (:'mode' = 'hold_delete')   as m_hold_delete,
       (:'mode' = 'after_delete')  as m_after_delete,
       (:'mode' = 'hold_inspect')  as m_hold_inspect,
       (:'mode' = 'after_inspect') as m_after_inspect \gset

-- ---- the backfill, optionally after another worker's signal ----------------
\if :m_s4
    select public.s4h_wait_signal(:'scenario', :'worker', :'signal', :'timeout'::double precision);
    \i :runner
    \set s4st :LAST_ERROR_SQLSTATE
    \set s4ms :LAST_ERROR_MESSAGE
    select public.s4h_record(:'scenario', :'worker', :'s4st', :'s4ms');
\endif

-- ---- the backfill, paused mid-transaction so it becomes the holder ---------
\if :m_hold_s4
    select set_config('s4h.scenario', :'scenario', false),
           set_config('s4h.worker', :'worker', false),
           set_config('s4h.await', :'await', false),
           set_config('s4h.timeout', :'timeout', false),
           set_config('s4h.pause_before', case when :'pausewhen' = 'before' then :'pause' else '' end, false),
           set_config('s4h.pause_after',  case when :'pausewhen' = 'after'  then :'pause' else '' end, false);
    \i :runner
    \set s4st :LAST_ERROR_SQLSTATE
    \set s4ms :LAST_ERROR_MESSAGE
    select public.s4h_record(:'scenario', :'worker', :'s4st', :'s4ms');
\endif

-- ---- holders: operate, signal, wait, then commit ---------------------------
\if :m_hold_set
    begin;
    select public.s4h_set(:'scenario', :'worker', :'tbl', :'id'::bigint, :'arr');
    select public.s4h_signal(:'scenario', :'worker');
    select public.s4h_wait(:'scenario', :'worker', :'await', :'timeout'::double precision);
    select public.s4h_log(:'scenario', :'worker', 'RELEASE', null);
    commit;
\endif

\if :m_hold_delete
    begin;
    select public.s4h_delete(:'scenario', :'worker', :'tbl', :'id'::bigint);
    select public.s4h_signal(:'scenario', :'worker');
    select public.s4h_wait(:'scenario', :'worker', :'await', :'timeout'::double precision);
    select public.s4h_log(:'scenario', :'worker', 'RELEASE', null);
    commit;
\endif

\if :m_hold_inspect
    begin;
    select public.s4h_inspect(:'scenario', :'worker', :'job'::bigint, :'token');
    select public.s4h_signal(:'scenario', :'worker');
    select public.s4h_wait(:'scenario', :'worker', :'await', :'timeout'::double precision);
    select public.s4h_log(:'scenario', :'worker', 'RELEASE', null);
    commit;
\endif

-- ---- followers: every statement is its own autocommit transaction, so the
--      operation's snapshot is taken AFTER the signal was seen ---------------
\if :m_after_set
    select public.s4h_wait_signal(:'scenario', :'worker', :'signal', :'timeout'::double precision);
    select public.s4h_set(:'scenario', :'worker', :'tbl', :'id'::bigint, :'arr');
\endif

\if :m_after_text
    select public.s4h_wait_signal(:'scenario', :'worker', :'signal', :'timeout'::double precision);
    select public.s4h_text(:'scenario', :'worker', :'tbl', :'id'::bigint);
\endif

\if :m_after_delete
    select public.s4h_wait_signal(:'scenario', :'worker', :'signal', :'timeout'::double precision);
    select public.s4h_delete(:'scenario', :'worker', :'tbl', :'id'::bigint);
\endif

\if :m_after_inspect
    select public.s4h_wait_signal(:'scenario', :'worker', :'signal', :'timeout'::double precision);
    select public.s4h_inspect(:'scenario', :'worker', :'job'::bigint, :'token');
\endif
