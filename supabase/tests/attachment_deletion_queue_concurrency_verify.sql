-- W8-C S2A2.2 attachment deletion queue — concurrency verification + cleanup.
-- Invoked by attachment_deletion_queue_concurrency_runner.ps1 with psql
-- variables:
--   mode      check | cleanup
--   scenario  scenario / round label (check mode)
--   workers   number of claiming sessions (C1)
--   count     claims per session (C1)
--
-- Assertion principle (as in the contact-primary matrix): assert OUTCOME
-- CLASSES and INVARIANTS, never one arbitrary race winner and never a
-- wall-clock duration where a logical ordering exists. Every state / token
-- change of the queue is recorded by the transition-log trigger, so "exactly
-- once" is read from the log, not inferred from the final row.
--
--   C1  N sessions x M claims (each claim its own transaction) against K due
--       jobs: every job claimed exactly once, disjoint tokens, no error, the
--       surplus claims return zero rows
--   C2  session A holds its claim open; session B, fired while A still holds
--       the lock, gets a DIFFERENT job and finishes BEFORE A releases (logical
--       ordering: B's finish instant < A's pre-commit marker) - SKIP LOCKED
--       of the claim SELECTION
--   C2b session A row-locks an EXPIRED claim and signals it (advisory lock);
--       session B claims only after that signal. B must complete - recover
--       the other, unlocked expired claim and claim the due job - while A
--       still holds the lock, and A releases only after it sees B's committed
--       result. The locked claim stays untouched. A blocking stale recovery
--       (no SKIP LOCKED) makes A time out and fails the check - SKIP LOCKED
--       of the stale RECOVERY
--   C3  concurrent claimers against expired leases only: every lease recovered
--       exactly once, attempt_count unchanged, at most 25 per transaction, no
--       claim
--   C4  the lease holder's fail races stale recovery at the expiry instant:
--       exactly one of them releases the job, never both, and the loser gets
--       LEASE_LOST or does nothing
--   C4b a stale holder (token A) and the current holder (token B) fail the
--       reclaimed job concurrently: A is LEASE_LOST, B wins, the row carries
--       B's code
--
-- Never point this at Production.

\set ON_ERROR_STOP on

select set_config('aqc.mode', :'mode', false),
       set_config('aqc.scenario', :'scenario', false),
       set_config('aqc.workers', :'workers', false),
       set_config('aqc.count', :'count', false);

-- raw outcomes for the report
select worker, outcome, job_id, attempt, detail
from public.aqc_results
where scenario = current_setting('aqc.scenario')
order by id;

do $$
declare
    v_scenario text := current_setting('aqc.scenario');
    v_kind     text := left(current_setting('aqc.scenario'), 3);
    v_workers  integer := coalesce(nullif(current_setting('aqc.workers'), ''), '0')::integer;
    v_count    integer := coalesce(nullif(current_setting('aqc.count'), ''), '0')::integer;
    v_like     text := 'aqc-' || current_setting('aqc.scenario') || '-%';
    v_jobs     integer;
    v_n        integer;
    v_distinct integer;
    v_job      bigint;
    v_tok      text;
    v_tok_a    text;
    v_tok_b    text;
    v_ids      bigint[];
    v_holder   record;
    v_other    record;
    v_release  timestamptz;
    v_failures text[] := '{}';
begin
    if current_setting('aqc.mode') <> 'check' then
        return;
    end if;

    select count(*) into v_jobs from nora_private.attachment_storage_deletion_queue where storage_key like v_like;

    if left(v_kind, 2) = 'C1' then
        if exists (select 1 from public.aqc_results where scenario = v_scenario and outcome = 'ERROR') then
            v_failures := array_append(v_failures, 'a claim raised an error');
        end if;
        select count(*), count(distinct job_id) into v_n, v_distinct
          from public.aqc_results where scenario = v_scenario and outcome = 'CLAIMED';
        if v_n <> v_jobs or v_distinct <> v_jobs then
            v_failures := v_failures || format('%s claims over %s distinct jobs, expected %s jobs claimed exactly once', v_n, v_distinct, v_jobs);
        end if;
        if (select count(*) from public.aqc_results where scenario = v_scenario and outcome = 'EMPTY')
           <> v_workers * v_count - v_jobs then
            v_failures := array_append(v_failures, 'the surplus claims did not return zero rows');
        end if;
        if (select count(distinct token) from public.aqc_results where scenario = v_scenario and outcome = 'CLAIMED') <> v_jobs then
            v_failures := array_append(v_failures, 'lease tokens are not unique per claim');
        end if;
        -- the row carries exactly the token its one claimer received
        if exists (select 1 from nora_private.attachment_storage_deletion_queue q
                   where q.storage_key like v_like
                     and (q.state <> 'claimed' or q.attempt_count <> 1
                          or q.claimed_by is distinct from (select r.token from public.aqc_results r
                                                            where r.scenario = v_scenario and r.outcome = 'CLAIMED'
                                                              and r.job_id = q.id))) then
            v_failures := array_append(v_failures, 'a job is not claimed once under the token its claimer received');
        end if;
        -- the log: exactly one pending -> claimed transition per job
        if exists (select 1 from nora_private.attachment_storage_deletion_queue q
                   where q.storage_key like v_like
                     and (select count(*) from public.aqc_transitions t where t.job_id = q.id) <> 1)
           or exists (select 1 from public.aqc_transitions t
                      where t.storage_key like v_like and (t.old_state <> 'pending' or t.new_state <> 'claimed')) then
            v_failures := array_append(v_failures, 'the transition log does not show exactly one pending -> claimed per job');
        end if;

    elsif v_kind = 'C2b' then
        v_job   := (select value from public.aqc_ctx where scenario = v_scenario and key = 'locked')::bigint;
        v_tok   := (select value from public.aqc_ctx where scenario = v_scenario and key = 'locked_token');
        v_ids   := array[(select value from public.aqc_ctx where scenario = v_scenario and key = 'stale')::bigint,
                         (select value from public.aqc_ctx where scenario = v_scenario and key = 'due')::bigint];
        select * into v_holder from public.aqc_results where scenario = v_scenario and worker = 'holder' and outcome = 'LOCKED';
        select * into v_other  from public.aqc_results where scenario = v_scenario and worker = 'claimer';
        select started_at into v_release from public.aqc_results
         where scenario = v_scenario and worker = 'holder' and outcome in ('RELEASE', 'RELEASE_TIMEOUT');
        -- 1. the claimer completed while the expired claim was still row-locked:
        --    the holder saw its committed result BEFORE releasing (a blocking
        --    recovery can only finish after the release -> RELEASE_TIMEOUT)
        if v_holder.id is null or v_release is null then
            v_failures := array_append(v_failures, 'the holder did not lock and release the expired claim');
        end if;
        if not exists (select 1 from public.aqc_results where scenario = v_scenario and worker = 'holder' and outcome = 'RELEASE') then
            v_failures := array_append(v_failures,
                'the holder timed out: stale recovery WAITED on the locked expired claim instead of skipping it (missing SKIP LOCKED)');
        end if;
        if v_other.outcome is distinct from 'CLAIMED'
           or not (v_holder.started_at < v_other.started_at and v_other.finished_at < v_release) then
            v_failures := v_failures || format('ordering broken: locked %s, claimer %s %s..%s, release %s',
                v_holder.started_at, v_other.outcome, v_other.started_at, v_other.finished_at, v_release);
        end if;
        -- 2. recovery really ran in that call: the unlocked expired claim was recovered
        if (select state <> 'failed_retryable' or last_error_code is distinct from 'NORA_ATTACHMENT_LEASE_EXPIRED'
                   or attempt_count <> 1
            from nora_private.attachment_storage_deletion_queue where id = v_ids[1]) then
            v_failures := array_append(v_failures, 'the unlocked expired claim was not recovered');
        end if;
        -- 3. the locked expired claim was skipped, not recovered: same token, no transition
        if (select state <> 'claimed' or claimed_by is distinct from v_tok or attempt_count <> 1 or last_error_code is not null
            from nora_private.attachment_storage_deletion_queue where id = v_job)
           or exists (select 1 from public.aqc_transitions where job_id = v_job) then
            v_failures := array_append(v_failures, 'the row-locked expired claim was touched by recovery');
        end if;
        -- 4. the claim itself still went to the due job
        if v_other.job_id is distinct from v_ids[2] then
            v_failures := v_failures || format('the claimer claimed %s, expected the due job %s', v_other.job_id, v_ids[2]);
        end if;

    elsif left(v_kind, 2) = 'C2' then
        select * into v_holder from public.aqc_results where scenario = v_scenario and worker = 'holder' and outcome = 'CLAIMED';
        select * into v_other  from public.aqc_results where scenario = v_scenario and worker = 'skipper';
        select started_at into v_release from public.aqc_results
         where scenario = v_scenario and worker = 'holder' and outcome = 'RELEASE';
        select array_agg(id order by available_at, id) into v_ids
          from nora_private.attachment_storage_deletion_queue where storage_key like v_like;
        -- available_at of claimed rows is unchanged, so this is still the original order
        if v_holder.job_id is distinct from v_ids[1] then
            v_failures := v_failures || format('the holder claimed %s, expected the oldest job %s', v_holder.job_id, v_ids[1]);
        end if;
        if v_other.outcome is distinct from 'CLAIMED' or v_other.job_id is distinct from v_ids[2] then
            v_failures := v_failures || format('the concurrent session got %s / %s, expected CLAIMED job %s (the next unlocked one)',
                v_other.outcome, v_other.job_id, v_ids[2]);
        end if;
        if v_release is null or v_other.finished_at is null or not (v_other.finished_at < v_release) then
            v_failures := v_failures || format('the concurrent session finished at %s, NOT before the holder released at %s - it waited on the lock',
                v_other.finished_at, v_release);
        end if;
        if (select state from nora_private.attachment_storage_deletion_queue where id = v_ids[3]) <> 'pending' then
            v_failures := array_append(v_failures, 'the third job was touched');
        end if;

    elsif left(v_kind, 2) = 'C3' then
        if exists (select 1 from public.aqc_results where scenario = v_scenario and outcome <> 'EMPTY') then
            v_failures := array_append(v_failures, 'a claimer raised or claimed although no job was due');
        end if;
        if exists (select 1 from nora_private.attachment_storage_deletion_queue
                   where storage_key like v_like
                     and (state <> 'failed_retryable' or attempt_count <> 1
                          or last_error_code is distinct from 'NORA_ATTACHMENT_LEASE_EXPIRED'
                          or claimed_by is not null)) then
            v_failures := array_append(v_failures, 'not every expired lease ended failed_retryable / attempt 1 / LEASE_EXPIRED');
        end if;
        if exists (select 1 from nora_private.attachment_storage_deletion_queue q
                   where q.storage_key like v_like
                     and (select count(*) from public.aqc_transitions t where t.job_id = q.id) <> 1)
           or exists (select 1 from public.aqc_transitions t
                      where t.storage_key like v_like
                        and (t.old_state <> 'claimed' or t.new_state <> 'failed_retryable'
                             or t.old_attempt <> t.new_attempt)) then
            v_failures := array_append(v_failures, 'the transition log does not show exactly one recovery per lease (without an attempt increment)');
        end if;
        if exists (select 1 from public.aqc_transitions t where t.storage_key like v_like
                   group by t.txid having count(*) > 25) then
            v_failures := array_append(v_failures, 'one transaction recovered more than 25 leases');
        end if;
        select count(distinct txid) into v_n from public.aqc_transitions t where t.storage_key like v_like;
        raise notice '% recoveries spread over % transaction(s)', v_jobs, v_n;

    elsif v_kind = 'C4b' then
        v_job   := (select value from public.aqc_ctx where scenario = v_scenario and key = 'job')::bigint;
        v_tok_a := (select value from public.aqc_ctx where scenario = v_scenario and key = 'token_a');
        v_tok_b := (select value from public.aqc_ctx where scenario = v_scenario and key = 'token_b');
        if (select outcome || ':' || coalesce(split_part(detail, ' ', 1), '') from public.aqc_results
             where scenario = v_scenario and worker = 'stale-a') <> 'ERROR:NORA_ATTACHMENT_LEASE_LOST' then
            v_failures := array_append(v_failures, 'the stale holder A was not refused with LEASE_LOST');
        end if;
        if (select outcome from public.aqc_results where scenario = v_scenario and worker = 'current-b') <> 'SUCCESS' then
            v_failures := array_append(v_failures, 'the current holder B could not fail its own job');
        end if;
        if (select state <> 'failed_retryable' or last_error_code <> 'NORA_ATTACHMENT_CONC_B' or attempt_count <> 2
            from nora_private.attachment_storage_deletion_queue where id = v_job) then
            v_failures := array_append(v_failures, 'the final row does not carry B''s failure');
        end if;
        -- only B's token ever released the reclaimed job
        if (select count(*) from public.aqc_transitions where job_id = v_job and old_token = v_tok_b) <> 1
           or exists (select 1 from public.aqc_transitions where job_id = v_job and new_code = 'NORA_ATTACHMENT_CONC_A') then
            v_failures := array_append(v_failures, 'the transition log shows a write under the stale token');
        end if;

    elsif left(v_kind, 2) = 'C4' then
        v_job := (select value from public.aqc_ctx where scenario = v_scenario and key = 'job')::bigint;
        v_tok := (select value from public.aqc_ctx where scenario = v_scenario and key = 'token');
        select * into v_holder from public.aqc_results where scenario = v_scenario and worker = 'holder';
        select * into v_other  from public.aqc_results where scenario = v_scenario and worker = 'recoverer';
        -- exactly one release of the lease, by whichever side won
        select count(*) into v_n from public.aqc_transitions where job_id = v_job and old_token = v_tok;
        if v_n <> 1 then
            v_failures := v_failures || format('the lease was released %s times, expected exactly once', v_n);
        end if;
        if v_other.outcome is distinct from 'EMPTY' then
            v_failures := v_failures || format('the recoverer ended %s (%s), expected EMPTY', v_other.outcome, v_other.detail);
        end if;
        if v_holder.outcome = 'SUCCESS' then
            if (select last_error_code from nora_private.attachment_storage_deletion_queue where id = v_job)
               is distinct from 'NORA_ATTACHMENT_CONC_HOLDER' then
                v_failures := array_append(v_failures, 'the holder succeeded but the row does not carry its code');
            end if;
            raise notice 'outcome: holder won (fail before expiry)';
        elsif v_holder.outcome = 'ERROR' and split_part(v_holder.detail, ' ', 1) = 'NORA_ATTACHMENT_LEASE_LOST' then
            if (select last_error_code from nora_private.attachment_storage_deletion_queue where id = v_job)
               is distinct from 'NORA_ATTACHMENT_LEASE_EXPIRED' then
                v_failures := array_append(v_failures, 'the holder lost the lease but the row does not carry LEASE_EXPIRED');
            end if;
            raise notice 'outcome: lease expired (holder refused with LEASE_LOST)';
        else
            v_failures := v_failures || format('the holder ended %s (%s) - neither success nor LEASE_LOST', v_holder.outcome, v_holder.detail);
        end if;
        if (select state from nora_private.attachment_storage_deletion_queue where id = v_job) <> 'failed_retryable' then
            v_failures := array_append(v_failures, 'the job did not end failed_retryable');
        end if;
    else
        raise exception 'unknown scenario %', v_scenario;
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (%):\n%', v_scenario, array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK %', v_scenario;
end;
$$;

do $$
begin
    if current_setting('aqc.mode') <> 'cleanup' then
        return;
    end if;
    drop trigger if exists aqc_transition_log on nora_private.attachment_storage_deletion_queue;
    drop function if exists public.aqc_log_transition();
    drop function if exists public.aqc_claim(text, text);
    drop function if exists public.aqc_fail(text, text, bigint, text, text);
    drop function if exists public.aqc_mark(text, text, text);
    drop function if exists public.aqc_hold_stale_lock(text, text, bigint, double precision);
    drop function if exists public.aqc_wait_then_claim(text, text, double precision);
    drop table if exists public.aqc_results;
    drop table if exists public.aqc_transitions;
    drop table if exists public.aqc_ctx;
    delete from nora_private.attachment_storage_deletion_queue where storage_key like 'aqc-%';
    if exists (select 1 from nora_private.attachment_storage_deletion_queue)
       or exists (select 1 from pg_trigger where tgrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
                                             and not tgisinternal) then
        raise exception 'cleanup incomplete: queue rows or a queue trigger survived';
    end if;
    raise notice 'OK cleanup: fixtures, log, trigger and recorder functions removed; queue empty';
end;
$$;
