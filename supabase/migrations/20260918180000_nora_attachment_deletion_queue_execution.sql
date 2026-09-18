-- Nora CRM: W8-C S2A2.2 Attachment Deletion Queue Execution Contract (2026-09-18)
--
-- Gives the private deletion outbox (S2A1) its execution contract, inside the
-- database only:
--
--   claim_next()             claim one due job under an exclusive, server-minted
--                            lease; recovers expired leases first
--   inspect(job, token)      lease-guarded liveness inspection via the S2A2.1
--                            resolver:  live    -> skipped_live
--                                       unknown -> fail (retry / terminal)
--                                       dead    -> NO WRITE, still claimed
--   fail(job, token, ...)    lease-guarded failure: retry with backoff or
--                            terminal once the attempt budget is spent
--
-- plus three DB-owned constants (lease TTL, attempt budget, retry delay) and a
-- partial index for stale-lease recovery. That is the entire capability.
--
-- WHAT THIS MIGRATION DOES NOT DO (deliberately, so a reviewer does not look
-- for it):
--   * no physical storage deletion, no Storage API call, no worker, no Edge
--     Function, no cron, no HTTP, no pg_net, no network action of any kind,
--   * no completion / ack and no path to 'done' — 'done' means "object
--     confirmed gone", and nothing here removes an object,
--   * no new queue state: the six-state vocabulary of S2A1 + S2A2.1 is kept,
--   * no public RPC and no grant for any API role. Every new function lives in
--     nora_private with EXECUTE revoked from public / anon / authenticated /
--     service_role: only postgres may run them. A service_role execution
--     boundary requires a deployed caller (22-security-and-access.md 6.3) and
--     is added together with the worker (S2B),
--   * no S3 reference-write guard, no requeue tooling, no orphan cleanup, no
--     dual-write, no backfill, no read switch,
--   * no constraint change, no new column, no data migration.
--
-- THE LEASE IS A DATABASE FENCING MECHANISM ONLY
-- ----------------------------------------------
-- The lease (claimed_by = server-minted per-claim token, validity bounded by
-- attachment_deletion_lease_ttl()) guarantees that a stale holder can no longer
-- mutate the queue once its lease is lost: every lease-guarded write re-checks
-- id + state + token + validity in one predicate, and a miss raises
-- NORA_ATTACHMENT_LEASE_LOST.
--
-- It does NOT fence an EXTERNAL side effect. A future worker that has already
-- started a Storage request can see that request complete after its DB lease
-- expired. S2A2.2 is therefore NOT sufficient physical-delete safety, and the
-- DEAD verdict is not a deletion permission. Before physical deletion is ever
-- enabled, S3 (reference-write guard against active deletion intents) and S2B
-- (worker + external side-effect contract) must close that problem. It is not
-- solved here, on purpose.

-- ---------------------------------------------------------------------------
-- 0. Preconditions (fail-closed)
--
-- Requires a runner that stops at the first error (supabase db push /
-- apply_migration; psql only with -v ON_ERROR_STOP=1).
-- ---------------------------------------------------------------------------
do $$
declare
    r           record;
    v_failures  text[] := '{}';
    v_cols      text[];
    v_literals  text[];
    v_def       text;
begin
    -- Every function Nora creates must be owned by postgres
    -- (22-security-and-access.md 6.3).
    if current_user <> 'postgres' then
        raise exception 'NORA_ATTACHMENT_QUEUE_EXECUTION: expected migration creator postgres, got %', current_user
            using errcode = '42501';
    end if;

    if to_regnamespace('nora_private') is null then
        raise exception 'NORA_ATTACHMENT_QUEUE_EXECUTION: schema nora_private is missing'
            using errcode = '3F000';
    end if;

    if to_regclass('nora_private.attachment_storage_deletion_queue') is null then
        raise exception 'NORA_ATTACHMENT_QUEUE_EXECUTION: the deletion queue is missing (W8-C S2A1 not applied)'
            using errcode = 'P0002';
    end if;

    if to_regprocedure('nora_private.enqueue_attachment_storage_deletion()') is null then
        raise exception 'NORA_ATTACHMENT_QUEUE_EXECUTION: the S2A1 capture function is missing'
            using errcode = 'P0002';
    end if;

    -- The resolver this contract delegates to must be the S2A2.1 one:
    -- SECURITY DEFINER with fail-closed RLS visibility.
    if not exists (select 1 from pg_proc p
                   where p.oid = to_regprocedure('nora_private.attachment_storage_key_liveness(text)')
                     and p.prosecdef
                     and p.prorettype = 'text'::regtype
                     and pg_get_userbyid(p.proowner) = 'postgres'
                     and p.proconfig = array['search_path=""', 'row_security=off']) then
        raise exception 'NORA_ATTACHMENT_QUEUE_EXECUTION: nora_private.attachment_storage_key_liveness(text) is missing or not the S2A2.1 definer resolver'
            using errcode = 'P0002';
    end if;

    -- The new objects are created exactly once.
    if exists (select 1 from pg_proc p
               join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'nora_private'
                 and p.proname in ('attachment_deletion_lease_ttl',
                                   'attachment_deletion_max_attempts',
                                   'attachment_deletion_retry_delay',
                                   'attachment_deletion_claim_next',
                                   'attachment_deletion_fail',
                                   'attachment_deletion_inspect')) then
        raise exception 'NORA_ATTACHMENT_QUEUE_EXECUTION: an attachment deletion execution function already exists in nora_private'
            using errcode = '42723',
                  hint = 'This migration is additive and creates the execution contract once. Investigate where the existing object came from instead of re-running it.';
    end if;

    if to_regclass('nora_private.attachment_deletion_queue_claimed_idx') is not null then
        raise exception 'NORA_ATTACHMENT_QUEUE_EXECUTION: nora_private.attachment_deletion_queue_claimed_idx already exists'
            using errcode = '42P07';
    end if;

    -- The six-state vocabulary and the terminal/completed contract of S2A2.1.
    select pg_get_constraintdef(con.oid),
           (select array_agg(a.attname::text order by a.attname)
              from unnest(con.conkey) k join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k),
           (select array_agg(m[1] order by m[1])
              from regexp_matches(pg_get_constraintdef(con.oid), '''([a-z_]+)''::text', 'g') as m)
      into v_def, v_cols, v_literals
    from pg_constraint con
    where con.conrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
      and con.conname = 'attachment_storage_deletion_queue_state_check'
      and con.contype = 'c';
    if v_def is null
       or v_cols is distinct from array['state']
       or v_literals is distinct from array['claimed','done','failed_retryable','failed_terminal','pending','skipped_live'] then
        v_failures := v_failures || format('state_check is not the S2A2.1 six-state definition: %s', coalesce(v_def, '<missing>'));
    end if;

    v_def := null; v_cols := null; v_literals := null;
    select pg_get_constraintdef(con.oid),
           (select array_agg(a.attname::text order by a.attname)
              from unnest(con.conkey) k join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k),
           (select array_agg(m[1] order by m[1])
              from regexp_matches(pg_get_constraintdef(con.oid), '''([a-z_]+)''::text', 'g') as m)
      into v_def, v_cols, v_literals
    from pg_constraint con
    where con.conrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
      and con.conname = 'attachment_storage_deletion_queue_completed_check'
      and con.contype = 'c';
    if v_def is null
       or v_cols is distinct from array['completed_at','state']
       or v_literals is distinct from array['done','failed_terminal','skipped_live']
       or position('completed_at IS NOT NULL' in v_def) = 0 then
        v_failures := v_failures || format('completed_check is not the S2A2.1 definition: %s', coalesce(v_def, '<missing>'));
    end if;

    -- The claim / error pairing constraints this contract relies on.
    if not exists (select 1 from pg_constraint con
                   where con.conrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
                     and con.conname = 'attachment_storage_deletion_queue_claim_check' and con.contype = 'c')
       or not exists (select 1 from pg_constraint con
                      where con.conrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
                        and con.conname = 'attachment_storage_deletion_queue_error_check' and con.contype = 'c') then
        v_failures := array_append(v_failures, 'claim_check or error_check is missing');
    end if;

    -- The active (unique) and due indexes, with their exact predicates.
    for r in
        select * from (values
            ('uq__attachment_deletion_queue__active_storage_key', true,
             array['claimed','failed_retryable','pending']),
            ('attachment_deletion_queue_due_idx', false,
             array['failed_retryable','pending'])
        ) as t(idx, uniq, states)
    loop
        if not exists (
            select 1 from pg_index i
            join pg_class c on c.oid = i.indexrelid
            where i.indrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
              and c.relname = r.idx
              and i.indisunique = r.uniq
              and i.indpred is not null
              and (select array_agg(m[1] order by m[1])
                     from regexp_matches(pg_get_expr(i.indpred, i.indrelid), '''([a-z_]+)''::text', 'g') as m)
                  = r.states
        ) then
            v_failures := v_failures || format('index %s is missing or changed (uniqueness or partial predicate)', r.idx);
        end if;
    end loop;

    -- claimed_by is being REDEFINED from "consumer instance identifier" to a
    -- server-minted per-claim lease token. A claimed row written under the old
    -- meaning would be misread by every lease check below.
    if exists (select 1 from nora_private.attachment_storage_deletion_queue where state = 'claimed') then
        v_failures := array_append(v_failures,
            'the queue holds claimed rows - claimed_by cannot be redefined as a lease token while claims exist');
    end if;

    if pg_get_userbyid((select relowner from pg_class
                        where oid = 'nora_private.attachment_storage_deletion_queue'::regclass)) <> 'postgres' then
        v_failures := array_append(v_failures, 'the queue is not owned by postgres');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'NORA_ATTACHMENT_QUEUE_EXECUTION: precondition failed:\n%', array_to_string(v_failures, E'\n')
            using errcode = '55000';
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. DB-owned constants
--
-- One definition each; every lease, budget and backoff decision below reads
-- them. STABLE (not IMMUTABLE) on purpose: no index or generated column may
-- ever bake one of these values in. Changed only by a migration.
-- ---------------------------------------------------------------------------

-- Lease TTL. Comfortably longer than the longest run of a future external
-- worker (an Edge Function is bounded at roughly 400 s), so a lease should
-- only expire when its holder is dead. S2B re-validates this against the
-- platform it actually runs on.
create function nora_private.attachment_deletion_lease_ttl()
returns interval
language sql
stable
security invoker
set search_path = ''
as $$
    select interval '10 minutes';
$$;

alter function nora_private.attachment_deletion_lease_ttl() owner to postgres;

comment on function nora_private.attachment_deletion_lease_ttl() is
    'W8-C S2A2.2: the single authoritative lease TTL of the attachment deletion queue (10 minutes). A lease is valid while claimed_at > now() - ttl and stale once claimed_at <= now() - ttl (the exact boundary is expired). Changed only by migration.';

revoke all on function nora_private.attachment_deletion_lease_ttl() from public;
revoke all on function nora_private.attachment_deletion_lease_ttl() from anon;
revoke all on function nora_private.attachment_deletion_lease_ttl() from authenticated;
revoke all on function nora_private.attachment_deletion_lease_ttl() from service_role;

-- Attempt budget, global across all failure causes. attempt_count grows at
-- CLAIM, so a worker that crashes after claiming still consumes budget.
create function nora_private.attachment_deletion_max_attempts()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
    select 5;
$$;

alter function nora_private.attachment_deletion_max_attempts() owner to postgres;

comment on function nora_private.attachment_deletion_max_attempts() is
    'W8-C S2A2.2: attempt budget of an attachment deletion job (5), shared by every failure cause. attempt_count increments at claim; a failure or lease expiry at attempt_count >= 5 ends the job as failed_terminal with its real cause code.';

revoke all on function nora_private.attachment_deletion_max_attempts() from public;
revoke all on function nora_private.attachment_deletion_max_attempts() from anon;
revoke all on function nora_private.attachment_deletion_max_attempts() from authenticated;
revoke all on function nora_private.attachment_deletion_max_attempts() from service_role;

-- Deterministic exponential backoff, no jitter: 15 min x 2^(n-1), capped at
-- 6 hours. The exponent is clamped before multiplying so no attempt count can
-- overflow the interval; with a budget of 5 the cap is dormant.
create function nora_private.attachment_deletion_retry_delay(p_attempt_count integer)
returns interval
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
    if p_attempt_count is null or p_attempt_count < 1 then
        raise exception 'attachment deletion retry delay: attempt count must be >= 1, got %', p_attempt_count
            using errcode = '22023', detail = 'NORA_ATTACHMENT_INVALID_ARGUMENT';
    end if;

    return least(interval '15 minutes' * power(2, least(p_attempt_count - 1, 5)),
                 interval '6 hours');
end;
$$;

alter function nora_private.attachment_deletion_retry_delay(integer) owner to postgres;

comment on function nora_private.attachment_deletion_retry_delay(integer) is
    'W8-C S2A2.2: retry delay after the n-th attempt failed: 15 min x 2^(n-1), capped at 6 hours (15 / 30 / 60 / 120 / 240 min for attempts 1-5). Deterministic, no jitter. n < 1 or NULL raises 22023 NORA_ATTACHMENT_INVALID_ARGUMENT.';

revoke all on function nora_private.attachment_deletion_retry_delay(integer) from public;
revoke all on function nora_private.attachment_deletion_retry_delay(integer) from anon;
revoke all on function nora_private.attachment_deletion_retry_delay(integer) from authenticated;
revoke all on function nora_private.attachment_deletion_retry_delay(integer) from service_role;

-- ---------------------------------------------------------------------------
-- 2. Claim (with stale-lease recovery)
--
-- SECURITY INVOKER, callable by postgres only. Every execution path runs as
-- postgres (a test, or a future S2B definer wrapper owned by postgres); if
-- EXECUTE ever leaked to an API role, the call would still fail on the queue,
-- which grants that role nothing. row_security = off turns any RLS-visibility
-- drift on the queue into an error instead of silently hiding claimed rows
-- from recovery.
--
-- 1. Recovery: at most 25 expired leases (claimed_at <= now() - ttl), oldest
--    first, SKIP LOCKED. claimed -> failed_retryable (+ backoff) or, with the
--    budget spent, failed_terminal; code NORA_ATTACHMENT_LEASE_EXPIRED.
--    Recovery never increments attempt_count.
-- 2. Selection: the oldest due job (pending / failed_retryable,
--    available_at <= now(), ordered by available_at, id), SKIP LOCKED, one row.
--    A just-recovered row is never due in the same call (its backoff is >= 15
--    minutes).
-- 3. Claim: state claimed, attempt_count + 1, claimed_at = now(), claimed_by =
--    a fresh server-minted UUID token. The caller supplies nothing. Earlier
--    error fields are kept as history.
--
-- No work returns zero rows, never an exception.
-- ---------------------------------------------------------------------------
create function nora_private.attachment_deletion_claim_next()
returns table (
    job_id           bigint,
    storage_key      text,
    lease_token      text,
    attempt_count    integer,
    claimed_at       timestamptz,
    lease_expires_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = ''
set row_security = off
as $$
declare
    v_ttl constant interval := nora_private.attachment_deletion_lease_ttl();
    v_max constant integer  := nora_private.attachment_deletion_max_attempts();
    v_id  bigint;
begin
    -- 1. stale-lease recovery (bounded, never blocks on a lock)
    with stale as (
        select q.id
          from nora_private.attachment_storage_deletion_queue q
         where q.state = 'claimed'
           and q.claimed_at <= now() - v_ttl
         order by q.claimed_at, q.id
         limit 25
         for update skip locked
    )
    update nora_private.attachment_storage_deletion_queue q
       set state           = case when q.attempt_count < v_max then 'failed_retryable' else 'failed_terminal' end,
           available_at    = case when q.attempt_count < v_max
                                  then now() + nora_private.attachment_deletion_retry_delay(q.attempt_count)
                                  else q.available_at end,
           completed_at    = case when q.attempt_count < v_max then null else now() end,
           claimed_at      = null,
           claimed_by      = null,
           last_error_code = 'NORA_ATTACHMENT_LEASE_EXPIRED',
           last_error_at   = now()
      from stale
     where q.id = stale.id;

    -- 2. the next due job
    select q.id
      into v_id
      from nora_private.attachment_storage_deletion_queue q
     where q.state in ('pending', 'failed_retryable')
       and q.available_at <= now()
     order by q.available_at, q.id
     limit 1
     for update skip locked;

    if v_id is null then
        return;
    end if;

    -- 3. the claim: a fresh, server-minted lease token per claim
    return query
    update nora_private.attachment_storage_deletion_queue q
       set state         = 'claimed',
           attempt_count = q.attempt_count + 1,
           claimed_at    = now(),
           claimed_by    = gen_random_uuid()::text
     where q.id = v_id
       and q.state in ('pending', 'failed_retryable')
    returning q.id, q.storage_key, q.claimed_by, q.attempt_count, q.claimed_at, q.claimed_at + v_ttl;
end;
$$;

alter function nora_private.attachment_deletion_claim_next() owner to postgres;

comment on function nora_private.attachment_deletion_claim_next() is
    'W8-C S2A2.2: claims the oldest due attachment deletion job (pending / failed_retryable, available_at <= now(), ordered by available_at, id, FOR UPDATE SKIP LOCKED) under a fresh server-minted lease token (gen_random_uuid) and increments attempt_count. First recovers at most 25 expired leases (claimed_at <= now() - lease_ttl) to failed_retryable with backoff, or failed_terminal once the attempt budget is spent, code NORA_ATTACHMENT_LEASE_EXPIRED, without incrementing attempt_count. Returns zero rows when there is no work. The lease fences queue mutations only, never an external side effect. postgres only - no API role may execute it.';

revoke all on function nora_private.attachment_deletion_claim_next() from public;
revoke all on function nora_private.attachment_deletion_claim_next() from anon;
revoke all on function nora_private.attachment_deletion_claim_next() from authenticated;
revoke all on function nora_private.attachment_deletion_claim_next() from service_role;

-- ---------------------------------------------------------------------------
-- 3. Fail (lease-guarded)
--
-- ONE conditional UPDATE whose predicate is the full valid-lease rule:
--   id = p_job_id AND state = 'claimed' AND claimed_by = p_lease_token
--   AND claimed_at > now() - lease_ttl()
-- Zero matching rows - wrong token, expired lease, unknown id, non-claimed
-- row - raise 55000 NORA_ATTACHMENT_LEASE_LOST. A lost lease is never success
-- and never "last writer wins".
--
--   retryable and attempt_count < budget  -> failed_retryable, backoff
--   otherwise                             -> failed_terminal, completed_at
--
-- The supplied cause code is kept in both cases (no separate "max attempts"
-- code: state + attempt_count already say that).
-- ---------------------------------------------------------------------------
create function nora_private.attachment_deletion_fail(
    p_job_id      bigint,
    p_lease_token text,
    p_error_code  text,
    p_retryable   boolean
)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
set row_security = off
as $$
declare
    v_ttl   constant interval := nora_private.attachment_deletion_lease_ttl();
    v_max   constant integer  := nora_private.attachment_deletion_max_attempts();
    v_state text;
begin
    if p_job_id is null
       or p_lease_token is null or btrim(p_lease_token) = ''
       or p_retryable is null
       or p_error_code is null
       or p_error_code !~ '^NORA_ATTACHMENT_[A-Z0-9_]{1,64}$' then
        raise exception 'attachment deletion fail: job id, lease token, retryable flag and a NORA_ATTACHMENT_* error code are required'
            using errcode = '22023', detail = 'NORA_ATTACHMENT_INVALID_ARGUMENT';
    end if;

    update nora_private.attachment_storage_deletion_queue q
       set state           = case when p_retryable and q.attempt_count < v_max
                                  then 'failed_retryable' else 'failed_terminal' end,
           available_at    = case when p_retryable and q.attempt_count < v_max
                                  then now() + nora_private.attachment_deletion_retry_delay(q.attempt_count)
                                  else q.available_at end,
           completed_at    = case when p_retryable and q.attempt_count < v_max
                                  then null else now() end,
           claimed_at      = null,
           claimed_by      = null,
           last_error_code = p_error_code,
           last_error_at   = now()
     where q.id = p_job_id
       and q.state = 'claimed'
       and q.claimed_by = p_lease_token
       and q.claimed_at > now() - v_ttl
    returning q.state into v_state;

    if v_state is null then
        raise exception 'attachment deletion lease lost: job % is not held by this lease token', p_job_id
            using errcode = '55000', detail = 'NORA_ATTACHMENT_LEASE_LOST';
    end if;

    return v_state;
end;
$$;

alter function nora_private.attachment_deletion_fail(bigint, text, text, boolean) owner to postgres;

comment on function nora_private.attachment_deletion_fail(bigint, text, text, boolean) is
    'W8-C S2A2.2: lease-guarded failure of an attachment deletion job, one conditional UPDATE on id + state claimed + lease token + claimed_at > now() - lease_ttl. Retryable below the attempt budget -> failed_retryable with backoff; otherwise failed_terminal with completed_at. The cause code (^NORA_ATTACHMENT_[A-Z0-9_]{1,64}$) is stored either way. A lost lease (wrong token, expired, unknown id, not claimed) raises 55000 NORA_ATTACHMENT_LEASE_LOST; invalid arguments raise 22023 NORA_ATTACHMENT_INVALID_ARGUMENT. Returns the resulting state. postgres only - no API role may execute it.';

revoke all on function nora_private.attachment_deletion_fail(bigint, text, text, boolean) from public;
revoke all on function nora_private.attachment_deletion_fail(bigint, text, text, boolean) from anon;
revoke all on function nora_private.attachment_deletion_fail(bigint, text, text, boolean) from authenticated;
revoke all on function nora_private.attachment_deletion_fail(bigint, text, text, boolean) from service_role;

-- ---------------------------------------------------------------------------
-- 4. Inspect (lease-guarded liveness)
--
-- Locks the job under the full valid-lease rule, calls the S2A2.1 resolver
-- exactly once and maps its verdict:
--
--   live     claimed -> skipped_live: completed_at = now(), claim cleared,
--            attempt_count and error history kept. The intent is WITHDRAWN
--            because the key was observed live at this moment - not deleted,
--            not permanently safe from later orphaning.
--   unknown  fail(..., 'NORA_ATTACHMENT_LIVENESS_UNKNOWN', retryable): retry
--            with backoff, terminal once the budget is spent. Never done,
--            never skipped_live - UNKNOWN is fail-closed.
--   dead     NO WRITE. The row stays claimed with the same token, claimed_at
--            and attempt_count; the verdict goes back to the lease holder
--            only. DEAD is an observation, not a deletion permission, and it
--            is never persisted (it would be stale at once). If nothing acts
--            on it, the lease expires and ordinary recovery applies.
--
-- A resolver error propagates and aborts the caller's transaction, leaving the
-- job claimed and unchanged: an error is never a verdict.
-- ---------------------------------------------------------------------------
create function nora_private.attachment_deletion_inspect(
    p_job_id      bigint,
    p_lease_token text
)
returns table (
    verdict   text,
    job_state text
)
language plpgsql
volatile
security invoker
set search_path = ''
set row_security = off
as $$
declare
    v_key     text;
    v_verdict text;
    v_state   text;
    v_rows    integer;
begin
    if p_job_id is null or p_lease_token is null or btrim(p_lease_token) = '' then
        raise exception 'attachment deletion inspect: job id and lease token are required'
            using errcode = '22023', detail = 'NORA_ATTACHMENT_INVALID_ARGUMENT';
    end if;

    select q.storage_key
      into v_key
      from nora_private.attachment_storage_deletion_queue q
     where q.id = p_job_id
       and q.state = 'claimed'
       and q.claimed_by = p_lease_token
       and q.claimed_at > now() - nora_private.attachment_deletion_lease_ttl()
       for update;

    if v_key is null then
        raise exception 'attachment deletion lease lost: job % is not held by this lease token', p_job_id
            using errcode = '55000', detail = 'NORA_ATTACHMENT_LEASE_LOST';
    end if;

    v_verdict := nora_private.attachment_storage_key_liveness(v_key);

    if v_verdict = 'live' then
        update nora_private.attachment_storage_deletion_queue q
           set state        = 'skipped_live',
               completed_at = now(),
               claimed_at   = null,
               claimed_by   = null
         where q.id = p_job_id
           and q.state = 'claimed'
           and q.claimed_by = p_lease_token;
        get diagnostics v_rows = row_count;
        if v_rows <> 1 then
            raise exception 'attachment deletion inspect: locked job % could not be withdrawn', p_job_id
                using errcode = 'XX000';
        end if;
        v_state := 'skipped_live';
    elsif v_verdict = 'unknown' then
        v_state := nora_private.attachment_deletion_fail(p_job_id, p_lease_token,
                                                         'NORA_ATTACHMENT_LIVENESS_UNKNOWN', true);
    elsif v_verdict = 'dead' then
        v_state := 'claimed';
    else
        raise exception 'attachment deletion inspect: unexpected liveness verdict %', coalesce(v_verdict, '<null>')
            using errcode = 'XX000';
    end if;

    verdict := v_verdict;
    job_state := v_state;
    return next;
end;
$$;

alter function nora_private.attachment_deletion_inspect(bigint, text) owner to postgres;

comment on function nora_private.attachment_deletion_inspect(bigint, text) is
    'W8-C S2A2.2: lease-guarded liveness inspection of a claimed attachment deletion job. Locks the job under the full valid-lease rule, calls nora_private.attachment_storage_key_liveness exactly once and returns (verdict, job_state): live -> skipped_live (intent withdrawn, completed_at set, attempt_count and error history kept); unknown -> attachment_deletion_fail with NORA_ATTACHMENT_LIVENESS_UNKNOWN (retry, or terminal at the budget); dead -> no write, the job stays claimed under the same lease. DEAD is an observation for the lease holder, never a deletion permission, and the lease fences queue mutations only, not an external Storage request. Resolver errors propagate. Lost lease 55000 NORA_ATTACHMENT_LEASE_LOST, invalid arguments 22023 NORA_ATTACHMENT_INVALID_ARGUMENT. postgres only - no API role may execute it.';

revoke all on function nora_private.attachment_deletion_inspect(bigint, text) from public;
revoke all on function nora_private.attachment_deletion_inspect(bigint, text) from anon;
revoke all on function nora_private.attachment_deletion_inspect(bigint, text) from authenticated;
revoke all on function nora_private.attachment_deletion_inspect(bigint, text) from service_role;

-- ---------------------------------------------------------------------------
-- 5. Stale-lease recovery index
--
-- Recovery runs on EVERY claim, and terminal rows are retained forever, so a
-- scan for expired leases must not grow with history. The claimed set is tiny
-- (at most one row per live worker). The S2A1 due index deliberately does not
-- cover claimed rows.
-- ---------------------------------------------------------------------------
create index attachment_deletion_queue_claimed_idx
    on nora_private.attachment_storage_deletion_queue (claimed_at, id)
    where state = 'claimed';

-- ---------------------------------------------------------------------------
-- 6. Queue documentation: the execution contract now exists
-- ---------------------------------------------------------------------------
comment on table nora_private.attachment_storage_deletion_queue is
    'W8-C S2A1 (2026-09-17): durable capture of the intent to delete a storage object, written by the AFTER DELETE trigger on public.attachments. A row here is an INTENT, never a permission: nothing may delete an object before a consumer has proven the key is referenced nowhere (legacy note JSON arrays, company logos and the URL-only branding logos included). No direct grants for any API role - not reachable through PostgREST. W8-C S2A2.1 (2026-09-18) adds the read-only liveness resolver nora_private.attachment_storage_key_liveness(text) and the terminal state skipped_live. W8-C S2A2.2 (2026-09-18) adds the DB-only execution contract (nora_private.attachment_deletion_claim_next / _inspect / _fail, postgres only): claim under a server-minted lease, stale-lease recovery, bounded attempts with backoff, LIVE -> skipped_live, UNKNOWN -> retry/terminal, DEAD -> no write. The lease fences queue mutations only, not an external side effect. Still no worker, no Storage call, no path to done.';

comment on column nora_private.attachment_storage_deletion_queue.state is
    'pending | claimed | failed_retryable | done | failed_terminal | skipped_live. pending, claimed and failed_retryable are ACTIVE and carry the partial unique invariant on storage_key; done, failed_terminal and skipped_live are TERMINAL. done = object confirmed gone; nothing writes it yet (S2B). skipped_live = the deletion intent was terminally withdrawn because the key was observed LIVE under the liveness contract in force at that moment - it is NOT a physical deletion, NOT a permanent guarantee against future orphaning and NOT a deletion authorization; only nora_private.attachment_deletion_inspect produces it.';
comment on column nora_private.attachment_storage_deletion_queue.attempt_count is
    'Number of claims granted for this job. Incremented by nora_private.attachment_deletion_claim_next at CLAIM (a crash after claiming still consumes budget), never by recovery or failure. Budget: nora_private.attachment_deletion_max_attempts().';
comment on column nora_private.attachment_storage_deletion_queue.available_at is
    'Earliest instant claim_next may claim this job. Defaults to now(), i.e. immediately due; after a retryable failure or lease expiry it is now() + nora_private.attachment_deletion_retry_delay(attempt_count).';
comment on column nora_private.attachment_storage_deletion_queue.claimed_at is
    'Lease start. Non-null exactly while state = claimed. The lease is valid while claimed_at > now() - nora_private.attachment_deletion_lease_ttl() and stale (recoverable) once claimed_at <= now() - lease_ttl.';
comment on column nora_private.attachment_storage_deletion_queue.claimed_by is
    'Server-minted per-claim LEASE TOKEN (gen_random_uuid()::text written by nora_private.attachment_deletion_claim_next), never a caller-supplied value and never a reusable worker identity: every claim gets a fresh token, so a stale holder cannot act on a reclaimed job (ABA). Non-null exactly while state = claimed.';
comment on column nora_private.attachment_storage_deletion_queue.last_error_code is
    'Machine-readable cause of the last failed attempt (^NORA_ATTACHMENT_[A-Z0-9_]+$, e.g. NORA_ATTACHMENT_LEASE_EXPIRED, NORA_ATTACHMENT_LIVENESS_UNKNOWN), never a free-text provider message. Kept as history across later claims and on terminal rows.';

-- ---------------------------------------------------------------------------
-- 7. Postconditions (fail-closed, inert: no primitive is invoked, no queue row
--    is read for update or written)
-- ---------------------------------------------------------------------------
do $$
declare
    r           record;
    v_role      text;
    v_priv      text;
    v_failures  text[] := '{}';
    v_all_privs text[] := case when current_setting('server_version_num')::int >= 170000
                               then array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']
                               else array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']
                          end;
    v_state     text;
begin
    -- 7a. the six functions: signature, return type, language, volatility,
    --     invoker, owner, exact settings, owner-only ACL, no API EXECUTE
    for r in
        select * from (values
            ('nora_private.attachment_deletion_lease_ttl()',                          'interval', false, 'sql',     's', array['search_path=""']),
            ('nora_private.attachment_deletion_max_attempts()',                       'integer',  false, 'sql',     's', array['search_path=""']),
            ('nora_private.attachment_deletion_retry_delay(integer)',                 'interval', false, 'plpgsql', 's', array['search_path=""']),
            ('nora_private.attachment_deletion_claim_next()',                         'record',   true,  'plpgsql', 'v', array['search_path=""', 'row_security=off']),
            ('nora_private.attachment_deletion_fail(bigint,text,text,boolean)',       'text',     false, 'plpgsql', 'v', array['search_path=""', 'row_security=off']),
            ('nora_private.attachment_deletion_inspect(bigint,text)',                 'record',   true,  'plpgsql', 'v', array['search_path=""', 'row_security=off'])
        ) as t(sig, rettype, retset, lang, vol, config)
    loop
        if to_regprocedure(r.sig) is null then
            v_failures := v_failures || format('%s was not created', r.sig);
            continue;
        end if;
        if not exists (select 1 from pg_proc p
                       join pg_language l on l.oid = p.prolang
                       where p.oid = to_regprocedure(r.sig)
                         and p.prorettype = r.rettype::regtype
                         and p.proretset = r.retset
                         and l.lanname = r.lang
                         and p.provolatile = r.vol
                         and not p.prosecdef
                         and pg_get_userbyid(p.proowner) = 'postgres'
                         and p.proconfig = r.config) then
            v_failures := v_failures || format('%s is not %s / %s / volatility %s / SECURITY INVOKER / owner postgres / settings %s',
                r.sig, r.rettype, r.lang, r.vol, r.config);
        end if;
        if (select p.proacl is null from pg_proc p where p.oid = to_regprocedure(r.sig))
           or exists (select 1 from pg_proc p, aclexplode(p.proacl) acl
                      where p.oid = to_regprocedure(r.sig)
                        and (acl.grantee = 0 or pg_get_userbyid(acl.grantee) <> 'postgres')) then
            v_failures := v_failures || format('%s carries an ACL entry for a role other than postgres', r.sig);
        end if;
        foreach v_role in array array['public','anon','authenticated','service_role'] loop
            if has_function_privilege(v_role, r.sig, 'EXECUTE') then
                v_failures := v_failures || format('%s holds EXECUTE on %s', v_role, r.sig);
            end if;
        end loop;
    end loop;

    -- 7b. no public (API-exposed) function touches the queue
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public'
                 and p.prosrc like '%attachment_storage_deletion_queue%') then
        v_failures := array_append(v_failures, 'a public function references the deletion queue');
    end if;

    -- 7c. helper values (pure, no queue access)
    if nora_private.attachment_deletion_lease_ttl() <> interval '10 minutes' then
        v_failures := array_append(v_failures, 'lease ttl is not 10 minutes');
    end if;
    if nora_private.attachment_deletion_max_attempts() <> 5 then
        v_failures := array_append(v_failures, 'max attempts is not 5');
    end if;
    for r in
        select * from (values (1, interval '15 minutes'), (2, interval '30 minutes'), (3, interval '60 minutes'),
                              (4, interval '120 minutes'), (5, interval '240 minutes'), (6, interval '6 hours'),
                              (1000, interval '6 hours')) as t(n, expected)
    loop
        if nora_private.attachment_deletion_retry_delay(r.n) <> r.expected then
            v_failures := v_failures || format('retry delay(%s) = %s, expected %s',
                r.n, nora_private.attachment_deletion_retry_delay(r.n), r.expected);
        end if;
    end loop;
    v_state := 'no error';
    begin
        perform nora_private.attachment_deletion_retry_delay(0);
    exception when others then
        v_state := sqlstate;
    end;
    if v_state <> '22023' then
        v_failures := v_failures || format('retry delay(0) -> %s, expected 22023', v_state);
    end if;

    -- 7d. the recovery index: (claimed_at, id), partial on claimed, not unique
    if not exists (
        select 1 from pg_index i
        join pg_class c on c.oid = i.indexrelid
        where i.indrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
          and c.relname = 'attachment_deletion_queue_claimed_idx'
          and not i.indisunique
          and i.indnatts = 2
          and (select array_agg(a.attname::text order by k.ord)
                 from unnest(i.indkey::int2[]) with ordinality k(attnum, ord)
                 join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum)
              = array['claimed_at', 'id']
          and (select array_agg(m[1] order by m[1])
                 from regexp_matches(pg_get_expr(i.indpred, i.indrelid), '''([a-z_]+)''::text', 'g') as m)
              = array['claimed']
    ) then
        v_failures := array_append(v_failures, 'attachment_deletion_queue_claimed_idx is not (claimed_at, id) WHERE state = claimed');
    end if;

    -- 7e. the S2A1/S2A2.1 queue contract is untouched: six check constraints,
    --     active/due index predicates, six-state vocabulary
    if (select count(*) from pg_constraint con
        where con.conrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
          and con.contype = 'c') <> 6 then
        v_failures := array_append(v_failures, 'the queue does not carry exactly six check constraints');
    end if;
    for r in
        select * from (values
            ('uq__attachment_deletion_queue__active_storage_key', true,  array['claimed','failed_retryable','pending']),
            ('attachment_deletion_queue_due_idx',                 false, array['failed_retryable','pending'])
        ) as t(idx, uniq, states)
    loop
        if not exists (
            select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
            where i.indrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
              and c.relname = r.idx and i.indisunique = r.uniq
              and (select array_agg(m[1] order by m[1])
                     from regexp_matches(pg_get_expr(i.indpred, i.indrelid), '''([a-z_]+)''::text', 'g') as m)
                  = r.states
        ) then
            v_failures := v_failures || format('index %s changed', r.idx);
        end if;
    end loop;

    -- 7f. queue access unchanged: no API role holds anything, RLS on, no policy
    foreach v_role in array array['anon','authenticated','service_role'] loop
        foreach v_priv in array v_all_privs loop
            if has_table_privilege(v_role, 'nora_private.attachment_storage_deletion_queue', v_priv) then
                v_failures := v_failures || format('%s holds %s on the queue', v_role, v_priv);
            end if;
        end loop;
    end loop;
    if exists (select 1 from pg_class c, aclexplode(c.relacl) acl
               where c.oid = 'nora_private.attachment_storage_deletion_queue'::regclass
                 and (acl.grantee = 0 or pg_get_userbyid(acl.grantee) <> 'postgres')) then
        v_failures := array_append(v_failures, 'the queue ACL names a grantee other than postgres');
    end if;
    if not (select c.relrowsecurity from pg_class c
            where c.oid = 'nora_private.attachment_storage_deletion_queue'::regclass) then
        v_failures := array_append(v_failures, 'row level security is not enabled on the queue');
    end if;
    if exists (select 1 from pg_policies p
               where p.schemaname = 'nora_private' and p.tablename = 'attachment_storage_deletion_queue') then
        v_failures := array_append(v_failures, 'the queue must carry no policy at all (deny-all by absence)');
    end if;

    -- 7g. nothing was claimed and nothing reached done by this migration
    if exists (select 1 from nora_private.attachment_storage_deletion_queue where state in ('claimed', 'done')) then
        v_failures := array_append(v_failures, 'the queue holds a claimed or done row after the migration');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'NORA_ATTACHMENT_QUEUE_EXECUTION aborted:\n%', array_to_string(v_failures, E'\n');
    end if;

    raise notice 'NORA_ATTACHMENT_QUEUE_EXECUTION: claim / inspect / fail + lease constants + recovery index installed, postgres only, no Storage path (pg %)',
        current_setting('server_version_num');
end;
$$;
