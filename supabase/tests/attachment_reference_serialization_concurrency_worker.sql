-- One REAL database session of the W8-C S3A concurrency matrix. Invoked in
-- parallel by attachment_reference_serialization_concurrency_runner.ps1 with
-- psql variables:
--   scenario  scenario / round label
--   worker    label; a holder signals under this name
--   mode      hold_delete | hold_inspect | after_delete | after_insert | after_inspect | insert
--   key       storage key the operation targets
--   note      contact note id (insert modes)
--   job       queue job id, token = its lease token (inspect modes)
--   signal    after_* modes: the holder's worker label to wait for
--   await     hold_* modes: 'blocked' (commit once a session is blocked BY this
--             one) or 'event:<worker>:<EVENT>' (commit once that event is
--             recorded)
--   timeout   seconds for every wait (a timeout is recorded, never passes)
-- Outcomes are recorded in public.ars_results by the ars_* functions.

\set ON_ERROR_STOP off

select (:'mode' = 'hold_delete')   as m_hold_delete,
       (:'mode' = 'hold_inspect')  as m_hold_inspect,
       (:'mode' = 'after_delete')  as m_after_delete,
       (:'mode' = 'after_insert')  as m_after_insert,
       (:'mode' = 'after_inspect') as m_after_inspect,
       (:'mode' = 'insert')        as m_insert \gset

\if :m_hold_delete
    begin;
    select public.ars_delete_ref(:'scenario', :'worker', :'key');
    select public.ars_signal(:'scenario', :'worker');
    select public.ars_wait(:'scenario', :'worker', :'await', :'timeout'::double precision);
    select public.ars_log(:'scenario', :'worker', 'RELEASE', null);
    commit;
\endif

\if :m_hold_inspect
    begin;
    select public.ars_inspect(:'scenario', :'worker', :'job'::bigint, :'token');
    select public.ars_signal(:'scenario', :'worker');
    select public.ars_wait(:'scenario', :'worker', :'await', :'timeout'::double precision);
    select public.ars_log(:'scenario', :'worker', 'RELEASE', null);
    commit;
\endif

-- followers: every statement is its own autocommit transaction; the wait is a
-- separate statement, so the operation's snapshot is taken after the signal
\if :m_after_delete
    select public.ars_wait_signal(:'scenario', :'worker', :'signal', :'timeout'::double precision);
    select public.ars_delete_ref(:'scenario', :'worker', :'key');
\endif

\if :m_after_insert
    select public.ars_wait_signal(:'scenario', :'worker', :'signal', :'timeout'::double precision);
    select public.ars_insert_ref(:'scenario', :'worker', :'note'::bigint, :'key');
\endif

\if :m_after_inspect
    select public.ars_wait_signal(:'scenario', :'worker', :'signal', :'timeout'::double precision);
    select public.ars_inspect(:'scenario', :'worker', :'job'::bigint, :'token');
\endif

\if :m_insert
    select public.ars_insert_ref(:'scenario', :'worker', :'note'::bigint, :'key');
\endif
