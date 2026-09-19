-- One REAL database session of the W8-C S3B concurrency matrix. Invoked in
-- parallel by attachment_note_projection_concurrency_runner.ps1 with psql
-- variables:
--   scenario  scenario / round label
--   worker    label; a holder signals under this name
--   mode      hold_set | after_set | paused_set | hold_delete | after_delete |
--             hold_inspect | after_inspect
--   tbl       table the operation targets (contact_notes | companies)
--   id        row id (note id, or company id for after_delete on companies)
--   arr       s3bh_ctx key of the attachment array to write (set modes)
--   job       queue job id, token = its lease token (inspect modes)
--   signal    after_* modes: the holder's worker label to wait for
--   await     hold_* modes: 'blocked' (commit once a session is blocked BY this
--             one) or 'event:<worker>:<EVENT>'
--   pause     paused_set: the storage key before whose INSERT the statement
--             pauses; peer = the other paused worker
--   timeout   seconds for every wait (a timeout is recorded, never passes)
-- Outcomes are recorded in public.s3bh_results by the s3bh_* functions.

\set ON_ERROR_STOP off

select (:'mode' = 'hold_set')      as m_hold_set,
       (:'mode' = 'after_set')     as m_after_set,
       (:'mode' = 'paused_set')    as m_paused_set,
       (:'mode' = 'hold_delete')   as m_hold_delete,
       (:'mode' = 'after_delete')  as m_after_delete,
       (:'mode' = 'hold_inspect')  as m_hold_inspect,
       (:'mode' = 'after_inspect') as m_after_inspect \gset

\if :m_hold_set
    begin;
    select public.s3bh_set(:'scenario', :'worker', :'tbl', :'id'::bigint, :'arr');
    select public.s3bh_signal(:'scenario', :'worker');
    select public.s3bh_wait(:'scenario', :'worker', :'await', :'timeout'::double precision);
    select public.s3bh_log(:'scenario', :'worker', 'RELEASE', null);
    commit;
\endif

\if :m_hold_delete
    begin;
    select public.s3bh_delete(:'scenario', :'worker', :'tbl', :'id'::bigint);
    select public.s3bh_signal(:'scenario', :'worker');
    select public.s3bh_wait(:'scenario', :'worker', :'await', :'timeout'::double precision);
    select public.s3bh_log(:'scenario', :'worker', 'RELEASE', null);
    commit;
\endif

\if :m_hold_inspect
    begin;
    select public.s3bh_inspect(:'scenario', :'worker', :'job'::bigint, :'token');
    select public.s3bh_signal(:'scenario', :'worker');
    select public.s3bh_wait(:'scenario', :'worker', :'await', :'timeout'::double precision);
    select public.s3bh_log(:'scenario', :'worker', 'RELEASE', null);
    commit;
\endif

-- followers: every statement is its own autocommit transaction; the wait is a
-- separate statement, so the operation's snapshot is taken after the signal
\if :m_after_set
    select public.s3bh_wait_signal(:'scenario', :'worker', :'signal', :'timeout'::double precision);
    select public.s3bh_set(:'scenario', :'worker', :'tbl', :'id'::bigint, :'arr');
\endif

\if :m_after_delete
    select public.s3bh_wait_signal(:'scenario', :'worker', :'signal', :'timeout'::double precision);
    select public.s3bh_delete(:'scenario', :'worker', :'tbl', :'id'::bigint);
\endif

\if :m_after_inspect
    select public.s3bh_wait_signal(:'scenario', :'worker', :'signal', :'timeout'::double precision);
    select public.s3bh_inspect(:'scenario', :'worker', :'job'::bigint, :'token');
\endif

-- both sessions of a pause pair run this concurrently; the pause hook stops
-- each statement just before its chosen row until the peer paused as well
\if :m_paused_set
    select set_config('s3bh.scenario', :'scenario', false),
           set_config('s3bh.worker', :'worker', false),
           set_config('s3bh.peer', :'signal', false),
           set_config('s3bh.pause_before', :'pause', false),
           set_config('s3bh.timeout', :'timeout', false);
    select public.s3bh_set(:'scenario', :'worker', :'tbl', :'id'::bigint, :'arr');
\endif
