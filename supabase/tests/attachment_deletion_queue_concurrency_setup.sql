-- W8-C S2A2.2 attachment deletion queue — REAL-session concurrency fixture.
-- Invoked by attachment_deletion_queue_concurrency_runner.ps1 with psql
-- variables:
--   mode       init | fixture
--   scenario   scenario / round label (fixture mode), e.g. C1r1
--   jobs       number of jobs to create (C1 / C2 / C3; C2b has a fixed fixture)
--   expire_at  unix epoch (float) at which the C4 lease must expire
--
-- init    creates the result / transition log objects (public.aqc_*), the
--         transition-log trigger on the queue and the recorder /
--         coordination functions the workers call. Local test objects only — they are
--         dropped again by the verify step in cleanup mode.
-- fixture deletes every earlier aqc-* queue row (a plain DELETE, which the
--         transition log does not record) and creates the scenario's jobs.
--
-- Never point this at Production.

\set ON_ERROR_STOP on

select set_config('aqc.mode', :'mode', false),
       set_config('aqc.scenario', :'scenario', false),
       set_config('aqc.jobs', :'jobs', false),
       set_config('aqc.expire_at', :'expire_at', false);

do $$
begin
    if current_setting('aqc.mode') <> 'init' then
        return;
    end if;

    -- claim_next works on the whole queue: foreign rows would take part in
    -- the races and make every assertion meaningless
    if exists (select 1 from nora_private.attachment_storage_deletion_queue where storage_key not like 'aqc-%') then
        raise exception 'the local queue holds rows that are not concurrency fixtures - run after a fresh `npx supabase db reset --local`';
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

    create table public.aqc_results (
        id          bigint generated always as identity,
        scenario    text,
        worker      text,
        outcome     text,          -- CLAIMED | EMPTY | SUCCESS | ERROR | RELEASE
        job_id      bigint,
        token       text,
        attempt     integer,
        detail      text,
        started_at  timestamptz,
        finished_at timestamptz default clock_timestamp()
    );
    create table public.aqc_transitions (
        id          bigint generated always as identity,
        job_id      bigint,
        storage_key text,
        old_state   text,
        new_state   text,
        old_token   text,
        new_token   text,
        old_attempt integer,
        new_attempt integer,
        new_code    text,
        txid        bigint,
        at          timestamptz default clock_timestamp()
    );
    create table public.aqc_ctx (scenario text, key text, value text);
    revoke all on public.aqc_results, public.aqc_transitions, public.aqc_ctx from anon, authenticated, service_role;

    -- every change of state or lease token, with the writing transaction
    create function public.aqc_log_transition()
    returns trigger
    language plpgsql
    as $f$
    begin
        insert into public.aqc_transitions (job_id, storage_key, old_state, new_state, old_token, new_token,
                                            old_attempt, new_attempt, new_code, txid)
        values (new.id, new.storage_key, old.state, new.state, old.claimed_by, new.claimed_by,
                old.attempt_count, new.attempt_count, new.last_error_code, txid_current());
        return null;
    end;
    $f$;
    create trigger aqc_transition_log
        after update on nora_private.attachment_storage_deletion_queue
        for each row
        when (old.state is distinct from new.state or old.claimed_by is distinct from new.claimed_by)
        execute function public.aqc_log_transition();

    -- one claim in the caller's transaction, recorded with its outcome
    create function public.aqc_claim(p_scenario text, p_worker text)
    returns void
    language plpgsql
    as $f$
    declare
        r        record;
        v_t0     timestamptz := clock_timestamp();
        v_state  text;
        v_detail text;
        v_msg    text;
    begin
        select * into r from nora_private.attachment_deletion_claim_next();
        if found then
            insert into public.aqc_results (scenario, worker, outcome, job_id, token, attempt, started_at)
            values (p_scenario, p_worker, 'CLAIMED', r.job_id, r.lease_token, r.attempt_count, v_t0);
        else
            insert into public.aqc_results (scenario, worker, outcome, started_at)
            values (p_scenario, p_worker, 'EMPTY', v_t0);
        end if;
    exception when others then
        get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail, v_msg = message_text;
        insert into public.aqc_results (scenario, worker, outcome, detail, started_at)
        values (p_scenario, p_worker, 'ERROR', coalesce(v_detail, '') || ' [' || v_state || '] ' || v_msg, v_t0);
    end;
    $f$;

    -- one retryable fail under the given lease, recorded with its outcome
    create function public.aqc_fail(p_scenario text, p_worker text, p_job bigint, p_token text, p_code text)
    returns void
    language plpgsql
    as $f$
    declare
        v_t0     timestamptz := clock_timestamp();
        v_res    text;
        v_state  text;
        v_detail text;
        v_msg    text;
    begin
        v_res := nora_private.attachment_deletion_fail(p_job, p_token, p_code, true);
        insert into public.aqc_results (scenario, worker, outcome, job_id, token, detail, started_at)
        values (p_scenario, p_worker, 'SUCCESS', p_job, p_token, v_res, v_t0);
    exception when others then
        get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail, v_msg = message_text;
        insert into public.aqc_results (scenario, worker, outcome, job_id, token, detail, started_at)
        values (p_scenario, p_worker, 'ERROR', p_job, p_token, coalesce(v_detail, '') || ' [' || v_state || '] ' || v_msg, v_t0);
    end;
    $f$;

    -- a timestamped marker inside the caller's transaction (e.g. just before COMMIT)
    create function public.aqc_mark(p_scenario text, p_worker text, p_outcome text)
    returns void
    language sql
    as $f$
        insert into public.aqc_results (scenario, worker, outcome, started_at)
        values (p_scenario, p_worker, p_outcome, clock_timestamp());
    $f$;

    -- C2b holder: row-locks one EXPIRED claim (a lease holder still at work
    -- after its lease ran out), then publishes "lock acquired" as a
    -- transaction advisory lock - visible in pg_locks to every session at
    -- once, unlike a row written by this still-open transaction. It keeps both
    -- locks until the claimer's committed result is visible (RELEASE), or until
    -- p_timeout seconds have passed (RELEASE_TIMEOUT: the claimer never
    -- finished while the row was locked). Everything runs in ONE statement,
    -- i.e. one transaction, so the row lock is held throughout.
    create function public.aqc_hold_stale_lock(p_scenario text, p_worker text, p_job bigint, p_timeout double precision)
    returns void
    language plpgsql
    as $f$
    declare
        v_deadline timestamptz := clock_timestamp() + make_interval(secs => p_timeout);
        v_seen     boolean := false;
    begin
        perform 1 from nora_private.attachment_storage_deletion_queue
         where id = p_job and state = 'claimed'
           and claimed_at <= now() - nora_private.attachment_deletion_lease_ttl()
           for update;
        if not found then
            raise exception 'C2b holder: job % is not an expired claim', p_job;
        end if;
        insert into public.aqc_results (scenario, worker, outcome, job_id, started_at)
        values (p_scenario, p_worker, 'LOCKED', p_job, clock_timestamp());
        perform pg_advisory_xact_lock(7302, hashtext(p_scenario) & 2147483647);

        -- each statement of a volatile plpgsql function takes a fresh snapshot
        -- (READ COMMITTED), so the claimer's committed result becomes visible
        while not v_seen and clock_timestamp() < v_deadline loop
            v_seen := exists (select 1 from public.aqc_results
                              where scenario = p_scenario and worker <> p_worker
                                and outcome in ('CLAIMED', 'EMPTY', 'ERROR'));
            if not v_seen then
                perform pg_sleep(0.05);
            end if;
        end loop;

        insert into public.aqc_results (scenario, worker, outcome, job_id, started_at)
        values (p_scenario, p_worker, case when v_seen then 'RELEASE' else 'RELEASE_TIMEOUT' end,
                p_job, clock_timestamp());
    end;
    $f$;

    -- C2b claimer: waits until the holder's "lock acquired" advisory lock is
    -- granted (so the stale row is provably locked), then claims once.
    create function public.aqc_wait_then_claim(p_scenario text, p_worker text, p_timeout double precision)
    returns void
    language plpgsql
    as $f$
    declare
        v_deadline timestamptz := clock_timestamp() + make_interval(secs => p_timeout);
    begin
        while not exists (select 1 from pg_catalog.pg_locks l
                          where l.locktype = 'advisory' and l.granted
                            and l.classid = 7302::oid
                            and l.objid = (hashtext(p_scenario) & 2147483647)::oid
                            and l.objsubid = 2) loop
            if clock_timestamp() >= v_deadline then
                insert into public.aqc_results (scenario, worker, outcome, detail, started_at)
                values (p_scenario, p_worker, 'NO_HOLDER', 'the holder never published its lock', clock_timestamp());
                return;
            end if;
            perform pg_sleep(0.02);
        end loop;
        perform public.aqc_claim(p_scenario, p_worker);
    end;
    $f$;

    revoke all on function public.aqc_log_transition(), public.aqc_claim(text, text),
                           public.aqc_fail(text, text, bigint, text, text), public.aqc_mark(text, text, text),
                           public.aqc_hold_stale_lock(text, text, bigint, double precision),
                           public.aqc_wait_then_claim(text, text, double precision)
        from public, anon, authenticated, service_role;
end;
$$;

do $$
declare
    v_scenario text := current_setting('aqc.scenario');
    v_kind     text := left(current_setting('aqc.scenario'), 3);
    v_jobs     integer := coalesce(nullif(current_setting('aqc.jobs'), ''), '0')::integer;
    v_expire   double precision := nullif(current_setting('aqc.expire_at'), '')::double precision;
    v_id       bigint;
    v_tok_a    text;
    v_tok_b    text;
    r          record;
begin
    if current_setting('aqc.mode') <> 'fixture' then
        return;
    end if;

    delete from nora_private.attachment_storage_deletion_queue where storage_key like 'aqc-%';
    if exists (select 1 from nora_private.attachment_storage_deletion_queue) then
        raise exception 'the local queue holds non-fixture rows';
    end if;

    if v_kind = 'C2b' then
        -- L = the expired claim the holder will lock (oldest claimed_at, so a
        -- blocking recovery would reach it first), S = a second expired claim
        -- nobody locks, D = one due pending job
        insert into nora_private.attachment_storage_deletion_queue (storage_key, state, attempt_count, claimed_at, claimed_by)
            values ('aqc-' || v_scenario || '-locked.pdf', 'claimed', 1, now() - interval '2 hours', gen_random_uuid()::text)
            returning id, claimed_by into v_id, v_tok_a;
        insert into public.aqc_ctx values (v_scenario, 'locked', v_id::text), (v_scenario, 'locked_token', v_tok_a);
        insert into nora_private.attachment_storage_deletion_queue (storage_key, state, attempt_count, claimed_at, claimed_by)
            values ('aqc-' || v_scenario || '-stale.pdf', 'claimed', 1, now() - interval '1 hour', gen_random_uuid()::text)
            returning id into v_id;
        insert into public.aqc_ctx values (v_scenario, 'stale', v_id::text);
        insert into nora_private.attachment_storage_deletion_queue (storage_key, available_at)
            values ('aqc-' || v_scenario || '-due.pdf', now() - interval '1 minute')
            returning id into v_id;
        insert into public.aqc_ctx values (v_scenario, 'due', v_id::text);

    elsif left(v_kind, 2) in ('C1', 'C2') then
        -- due jobs, strictly ordered by available_at (oldest = lowest index)
        insert into nora_private.attachment_storage_deletion_queue (storage_key, available_at)
        select 'aqc-' || v_scenario || '-' || g || '.pdf', now() - make_interval(mins => v_jobs - g + 1)
        from generate_series(1, v_jobs) g;

    elsif left(v_kind, 2) = 'C3' then
        -- expired leases only, nothing due
        insert into nora_private.attachment_storage_deletion_queue (storage_key, state, attempt_count, claimed_at, claimed_by)
        select 'aqc-' || v_scenario || '-' || g || '.pdf', 'claimed', 1,
               now() - interval '1 hour' - make_interval(secs => g), gen_random_uuid()::text
        from generate_series(1, v_jobs) g;

    elsif v_kind = 'C4b' then
        -- A claimed, A's lease expired and was recovered, B reclaimed the job
        insert into nora_private.attachment_storage_deletion_queue (storage_key)
            values ('aqc-' || v_scenario || '-1.pdf') returning id into v_id;
        select * into r from nora_private.attachment_deletion_claim_next();
        v_tok_a := r.lease_token;
        update nora_private.attachment_storage_deletion_queue
           set claimed_at = now() - nora_private.attachment_deletion_lease_ttl() where id = v_id;
        perform nora_private.attachment_deletion_claim_next();
        update nora_private.attachment_storage_deletion_queue set available_at = now() - interval '1 second' where id = v_id;
        select * into r from nora_private.attachment_deletion_claim_next();
        v_tok_b := r.lease_token;
        if r.job_id is distinct from v_id or v_tok_b = v_tok_a then
            raise exception 'C4b fixture: B did not reclaim the job under a new token';
        end if;
        insert into public.aqc_ctx values (v_scenario, 'job', v_id::text), (v_scenario, 'token_a', v_tok_a),
                                          (v_scenario, 'token_b', v_tok_b);

    elsif left(v_kind, 2) = 'C4' then
        -- one claimed job whose lease expires exactly at expire_at
        insert into nora_private.attachment_storage_deletion_queue (storage_key)
            values ('aqc-' || v_scenario || '-1.pdf') returning id into v_id;
        select * into r from nora_private.attachment_deletion_claim_next();
        update nora_private.attachment_storage_deletion_queue
           set claimed_at = to_timestamp(v_expire) - nora_private.attachment_deletion_lease_ttl()
         where id = v_id;
        insert into public.aqc_ctx values (v_scenario, 'job', v_id::text), (v_scenario, 'token', r.lease_token);
    else
        raise exception 'unknown scenario %', v_scenario;
    end if;
end;
$$;
