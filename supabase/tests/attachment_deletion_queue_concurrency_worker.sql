-- One REAL database session of the W8-C S2A2.2 concurrency matrix. Invoked N
-- times in parallel by attachment_deletion_queue_concurrency_runner.ps1 with
-- psql variables:
--   scenario  scenario / round label
--   worker    label
--   fire_at   unix epoch (float) - every worker sleeps until this instant so
--             the calls genuinely overlap
--   mode      claim | hold | fail | lockstale | waitclaim
--   count     claim: number of claims, each in its OWN transaction
--   hold      hold: seconds to keep the claiming transaction open;
--             lockstale / waitclaim: timeout in seconds
--   job       fail: job id; lockstale: the expired claim to row-lock
--   token     fail: lease token
--   code      fail: NORA_ATTACHMENT_* cause code
-- Outcomes are recorded in public.aqc_results by the aqc_* recorder functions.
--
-- The sleep is its OWN statement (own transaction), so the primitive's now()
-- is taken after the fire instant, not before the sleep.

\set ON_ERROR_STOP off

select pg_sleep(greatest(0, :'fire_at'::double precision - extract(epoch from clock_timestamp())));

select (:'mode' = 'claim') as is_claim, (:'mode' = 'hold') as is_hold, (:'mode' = 'fail') as is_fail,
       (:'mode' = 'lockstale') as is_lockstale, (:'mode' = 'waitclaim') as is_waitclaim \gset

\if :is_claim
    -- every generated statement runs in its own autocommit transaction
    select format('select public.aqc_claim(%L, %L)', :'scenario', :'worker')
    from generate_series(1, :'count'::integer) \gexec
\endif

\if :is_hold
    begin;
    select public.aqc_claim(:'scenario', :'worker');
    select pg_sleep(:'hold'::double precision);
    select public.aqc_mark(:'scenario', :'worker', 'RELEASE');
    commit;
\endif

\if :is_fail
    select public.aqc_fail(:'scenario', :'worker', :'job'::bigint, :'token', :'code');
\endif

\if :is_lockstale
    -- C2b: one statement = one transaction holding the expired claim's row lock
    select public.aqc_hold_stale_lock(:'scenario', :'worker', :'job'::bigint, :'hold'::double precision);
\endif

\if :is_waitclaim
    -- C2b: claim only once the holder has provably locked the expired claim
    select public.aqc_wait_then_claim(:'scenario', :'worker', :'hold'::double precision);
\endif
