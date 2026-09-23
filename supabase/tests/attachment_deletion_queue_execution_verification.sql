-- Nora W8-C S2A2.2 — attachment deletion queue execution contract: database verification
--
-- Self-contained and rollback-safe: every fixture is created inside a DO block
-- that terminates with ROLLBACK_W8C_S2A22_TEST, so the block's subtransaction
-- undoes it (queue rows included — each block starts from an empty queue of
-- its own). The only session objects are the pg_temp helpers below, which
-- disappear with the session. Requires the clean-reference universe of a fresh
-- `npx supabase db reset --local` (the liveness section checks that precondition
-- explicitly and fails loudly otherwise). Like the S2A2.1 resolver suite it
-- must run OUTSIDE the rbac_rls_setup -> rbac_rls_teardown window: that
-- fixture grants EXECUTE on every nora_private function to its test role,
-- which the owner-only ACL assertion of section 1 rightly reports.
--
-- A DO block is one transaction, so now() is frozen inside it: lease expiry and
-- backoff are simulated by moving claimed_at / available_at, never by waiting.
--
-- Usage (local only):
--   docker exec -i supabase_db_atomic-crm-demo psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/attachment_deletion_queue_execution_verification.sql
--
-- What it proves:
--   1. shape: exactly the six approved nora_private functions (no ack, no
--      completion, no public RPC), exact signatures / return types / language /
--      volatility, SECURITY INVOKER, owner postgres, search_path = '' (plus
--      row_security = off on the three mutating ones), owner-only ACL, no
--      `when others`, no dynamic SQL, no network / Storage / Edge reference, no
--      'done', no INSERT / DELETE, the resolver called exactly once by inspect,
--      only inspect produces skipped_live, the claimed recovery index, queue
--      ACL / RLS / policies unchanged
--   2. API boundary: anon / authenticated / service_role cannot execute any of
--      the six functions (catalog AND a real `set local role` call -> 42501)
--   3. helpers: TTL 10 min, budget 5, delays 15/30/60/120/240 min, cap 6 h,
--      invalid attempt -> 22023
--   4. claim: no work -> zero rows; due pending / failed_retryable claimed;
--      future and terminal rows never; order available_at, id; attempt_count
--      +1 exactly; UUID token minted per claim and never reused; lease expiry
--      = claimed_at + ttl; earlier error fields kept
--   5. stale recovery: exact boundary is stale, 1 us before is valid; fields,
--      LEASE_EXPIRED, backoff, attempt_count unchanged, budget -> terminal,
--      at most 25 per call (oldest first), runs without due work, a recovered
--      row is not re-claimed in the same call
--   6. lease loss: wrong token, expired, exact boundary, unknown id, every
--      non-claimed state -> 55000 NORA_ATTACHMENT_LEASE_LOST, row untouched;
--      invalid arguments -> 22023 NORA_ATTACHMENT_INVALID_ARGUMENT
--   7. ABA: A claims, lease expires, recovery, B reclaims with a new token; A's
--      fail and inspect are LEASE_LOST and B's claim stays byte-identical
--   8. fail: retryable, non-retryable, budget exhaustion across five full
--      claim/fail cycles, cause code kept, no second fail on a released job
--   9. inspect: LIVE (public.attachments, legacy note array) -> skipped_live;
--      UNKNOWN (residual config tripwire, foreign-origin avatar) -> retry, then
--      terminal at the budget, never skipped_live / done; DEAD -> no write,
--      same token / claimed_at / attempt_count, later ordinary recovery; LIVE
--      dominates UNKNOWN; a resolver error propagates and leaves the job
--      claimed
--  10. terminal recreation: after skipped_live / failed_terminal a new capture
--      for the same key creates a fresh pending intent
--  11. no S2A2.2 path writes done
--
-- NOT proven here (by design): real concurrency — see
-- attachment_deletion_queue_concurrency_runner.ps1. No physical deletion
-- exists; the lease fences queue mutations only, never an external request.

\set ON_ERROR_STOP on

\echo '=== W8-C S2A2.2: attachment deletion queue execution verification ==='

-- Runs one statement; returns 'OK' or '<sqlstate>:<detail>'. The statement
-- runs in a subtransaction, so a failing call leaves no partial effect.
create function pg_temp.s2a22_try(p_sql text)
returns text
language plpgsql
as $$
declare
    v_state  text;
    v_detail text;
begin
    execute p_sql;
    return 'OK';
exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
    return v_state || ':' || coalesce(v_detail, '');
end;
$$;

-- Full row image, for "untouched" assertions.
create function pg_temp.s2a22_row(p_id bigint)
returns jsonb
language sql
as $$
    select to_jsonb(q) from nora_private.attachment_storage_deletion_queue q where q.id = p_id;
$$;

create function pg_temp.s2a22_fail_sql(p_id bigint, p_token text, p_code text, p_retryable boolean)
returns text
language sql
as $$
    select format('select nora_private.attachment_deletion_fail(%s, %L, %L, %s)',
                  coalesce(p_id::text, 'null'), p_token, p_code, coalesce(p_retryable::text, 'null'));
$$;

create function pg_temp.s2a22_inspect_sql(p_id bigint, p_token text)
returns text
language sql
as $$
    select format('select * from nora_private.attachment_deletion_inspect(%s, %L)',
                  coalesce(p_id::text, 'null'), p_token);
$$;

-- ---------------------------------------------------------------------------
-- 1. Shape and hygiene
-- ---------------------------------------------------------------------------
do $$
declare
    r          record;
    v_src      text;
    v_names    text[];
    v_failures text[] := '{}';
begin
    for r in
        select * from (values
            ('nora_private.attachment_deletion_lease_ttl()',                    'attachment_deletion_lease_ttl',    'interval', false, 'sql',     's', array['search_path=""']),
            ('nora_private.attachment_deletion_max_attempts()',                 'attachment_deletion_max_attempts', 'integer',  false, 'sql',     's', array['search_path=""']),
            ('nora_private.attachment_deletion_retry_delay(integer)',           'attachment_deletion_retry_delay',  'interval', false, 'plpgsql', 's', array['search_path=""']),
            ('nora_private.attachment_deletion_claim_next()',                   'attachment_deletion_claim_next',   'record',   true,  'plpgsql', 'v', array['search_path=""', 'row_security=off']),
            ('nora_private.attachment_deletion_fail(bigint,text,text,boolean)', 'attachment_deletion_fail',         'text',     false, 'plpgsql', 'v', array['search_path=""', 'row_security=off']),
            ('nora_private.attachment_deletion_inspect(bigint,text)',           'attachment_deletion_inspect',      'record',   true,  'plpgsql', 'v', array['search_path=""', 'row_security=off'])
        ) as t(sig, fname, rettype, retset, lang, vol, config)
    loop
        if to_regprocedure(r.sig) is null then
            v_failures := v_failures || format('%s does not exist', r.sig);
            continue;
        end if;

        if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'nora_private' and p.proname = r.fname) <> 1 then
            v_failures := v_failures || format('%s is overloaded', r.fname);
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
            v_failures := v_failures || format('%s is not %s / %s / volatility %s / SECURITY INVOKER / owner postgres / settings exactly %s',
                r.sig, r.rettype, r.lang, r.vol, r.config);
        end if;

        -- the ACL may name the owner only, and must not be the PUBLIC default
        if (select p.proacl is null from pg_proc p where p.oid = to_regprocedure(r.sig))
           or exists (select 1 from pg_proc p, aclexplode(p.proacl) acl
                      where p.oid = to_regprocedure(r.sig)
                        and (acl.grantee = 0 or pg_get_userbyid(acl.grantee) <> 'postgres')) then
            v_failures := v_failures || format('%s carries an ACL entry for a role other than postgres (or the PUBLIC default)', r.sig);
        end if;

        select p.prosrc into v_src from pg_proc p where p.oid = to_regprocedure(r.sig);

        if v_src ~* '\mwhen\s+others\M' then
            v_failures := v_failures || format('%s contains `when others` - errors must propagate', r.sig);
        end if;
        if v_src ~* '\mexecute\M' then
            v_failures := v_failures || format('%s uses dynamic SQL', r.sig);
        end if;
        if v_src ~* '(pg_net|\mnet\.|\mhttp|extensions\.http|dblink|\mstorage\.|functions/v1|supabase_functions|pg_background)' then
            v_failures := v_failures || format('%s references a network / Storage / Edge Function facility', r.sig);
        end if;
        -- S2A2.2 can never acknowledge a deletion
        if v_src ~* '''done''' then
            v_failures := v_failures || format('%s mentions the state done', r.sig);
        end if;
        -- the primitives only transition existing jobs
        if v_src ~* '(\minsert\M|\mdelete\M|\mtruncate\M)' then
            v_failures := v_failures || format('%s inserts or deletes rows', r.sig);
        end if;
    end loop;

    -- exactly the approved S2A2.2 set: no ack / complete / done / requeue primitive
    select array_agg(p.proname::text order by p.proname) into v_names
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'nora_private' and p.proname like 'attachment\_deletion\_%';
    if v_names is distinct from array['attachment_deletion_claim_next', 'attachment_deletion_fail',
                                      'attachment_deletion_inspect', 'attachment_deletion_lease_ttl',
                                      'attachment_deletion_max_attempts', 'attachment_deletion_retry_delay'] then
        v_failures := v_failures || format('the attachment_deletion_* function set is not the approved S2A2.2 set: %s', v_names);
    end if;
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname in ('public', 'nora_private')
                 and p.proname ~* 'attachment.*(ack|complete|done|requeue|drain|worker)') then
        v_failures := array_append(v_failures, 'an ack / completion / requeue / worker function exists - that is S2B');
    end if;

    -- no API-exposed function touches the queue
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public'
                 and (p.prosrc like '%attachment_storage_deletion_queue%' or p.prosrc like '%attachment_deletion_%')) then
        v_failures := array_append(v_failures, 'a public function references the deletion queue or its primitives');
    end if;

    -- only inspect produces skipped_live, and inspect calls the resolver once
    select array_agg(n.nspname || '.' || p.proname order by p.proname) into v_names
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'nora_private') and p.prosrc like '%skipped_live%';
    if v_names is distinct from array['nora_private.attachment_deletion_inspect'] then
        v_failures := v_failures || format('skipped_live is referenced by %s, expected exactly nora_private.attachment_deletion_inspect', v_names);
    end if;
    select p.prosrc into v_src from pg_proc p
    where p.oid = to_regprocedure('nora_private.attachment_deletion_inspect(bigint,text)');
    if (select count(*) from regexp_matches(v_src, 'attachment_storage_key_liveness\(', 'g')) <> 1 then
        v_failures := array_append(v_failures, 'inspect does not call the liveness resolver exactly once');
    end if;
    -- inspect's UNKNOWN path goes through the one fail implementation
    if position('nora_private.attachment_deletion_fail(' in v_src) = 0
       or position('NORA_ATTACHMENT_LIVENESS_UNKNOWN' in v_src) = 0 then
        v_failures := array_append(v_failures, 'inspect does not route UNKNOWN through attachment_deletion_fail');
    end if;
    -- one TTL definition: no hard-coded lease interval outside the helper
    for r in
        select p.oid::regprocedure::text as sig, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'nora_private'
          and p.proname in ('attachment_deletion_claim_next', 'attachment_deletion_fail', 'attachment_deletion_inspect')
    loop
        if r.prosrc ~* '10\s*min' or position('attachment_deletion_lease_ttl()' in r.prosrc) = 0 then
            v_failures := v_failures || format('%s does not take its lease TTL from attachment_deletion_lease_ttl()', r.sig);
        end if;
    end loop;

    -- the recovery index
    if not exists (
        select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
        where i.indrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
          and c.relname = 'attachment_deletion_queue_claimed_idx'
          and not i.indisunique
          and (select array_agg(a.attname::text order by k.ord)
                 from unnest(i.indkey::int2[]) with ordinality k(attnum, ord)
                 join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum) = array['claimed_at', 'id']
          and (select array_agg(m[1] order by m[1])
                 from regexp_matches(pg_get_expr(i.indpred, i.indrelid), '''([a-z_]+)''::text', 'g') as m) = array['claimed']
    ) then
        v_failures := array_append(v_failures, 'attachment_deletion_queue_claimed_idx is not (claimed_at, id) WHERE state = claimed');
    end if;

    -- the queue itself is unchanged: six states, six checks, no API privilege,
    -- RLS on, no policy
    if (select count(*) from pg_constraint con
        where con.conrelid = 'nora_private.attachment_storage_deletion_queue'::regclass and con.contype = 'c') <> 6
       or (select array_agg(m[1] order by m[1])
             from pg_constraint con,
                  regexp_matches(pg_get_constraintdef(con.oid), '''([a-z_]+)''::text', 'g') as m
            where con.conrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
              and con.conname = 'attachment_storage_deletion_queue_state_check')
          is distinct from array['claimed','done','failed_retryable','failed_terminal','pending','skipped_live'] then
        v_failures := array_append(v_failures, 'the queue check constraints / six-state vocabulary changed');
    end if;
    if exists (select 1 from pg_class c, aclexplode(c.relacl) acl
               where c.oid = 'nora_private.attachment_storage_deletion_queue'::regclass
                 and (acl.grantee = 0 or pg_get_userbyid(acl.grantee) <> 'postgres'))
       or has_table_privilege('service_role', 'nora_private.attachment_storage_deletion_queue', 'SELECT')
       or has_table_privilege('service_role', 'nora_private.attachment_storage_deletion_queue', 'UPDATE')
       or has_table_privilege('authenticated', 'nora_private.attachment_storage_deletion_queue', 'SELECT') then
        v_failures := array_append(v_failures, 'the queue ACL names a grantee other than postgres');
    end if;
    if not (select relrowsecurity from pg_class where oid = 'nora_private.attachment_storage_deletion_queue'::regclass)
       or exists (select 1 from pg_policies where schemaname = 'nora_private'
                                              and tablename = 'attachment_storage_deletion_queue') then
        v_failures := array_append(v_failures, 'queue RLS is off or a policy exists');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (shape):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  1. shape: exactly six nora_private primitives, INVOKER / owner postgres / exact settings, owner-only ACL, no catch-all, no dynamic SQL, no network, no done, no insert/delete, one TTL source, resolver once, recovery index, queue unchanged';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. API boundary: no API role may execute any of the six functions
-- ---------------------------------------------------------------------------
do $$
declare
    v_role     text;
    v_sig      text;
    v_state    text;
    v_failures text[] := '{}';
begin
    foreach v_sig in array array['nora_private.attachment_deletion_lease_ttl()',
                                 'nora_private.attachment_deletion_max_attempts()',
                                 'nora_private.attachment_deletion_retry_delay(integer)',
                                 'nora_private.attachment_deletion_claim_next()',
                                 'nora_private.attachment_deletion_fail(bigint,text,text,boolean)',
                                 'nora_private.attachment_deletion_inspect(bigint,text)'] loop
        foreach v_role in array array['public','anon','authenticated','service_role'] loop
            if has_function_privilege(v_role, v_sig, 'EXECUTE') then
                v_failures := v_failures || format('%s holds EXECUTE on %s', v_role, v_sig);
            end if;
        end loop;
    end loop;

    foreach v_role in array array['anon','authenticated','service_role'] loop
        foreach v_sig in array array['select nora_private.attachment_deletion_lease_ttl()',
                                     'select nora_private.attachment_deletion_max_attempts()',
                                     'select nora_private.attachment_deletion_retry_delay(1)',
                                     'select * from nora_private.attachment_deletion_claim_next()',
                                     'select nora_private.attachment_deletion_fail(1, ''t'', ''NORA_ATTACHMENT_X'', true)',
                                     'select * from nora_private.attachment_deletion_inspect(1, ''t'')'] loop
            v_state := 'no error';
            execute format('set local role %I', v_role);
            begin
                execute v_sig;
            exception when others then
                v_state := sqlstate;
            end;
            reset role;
            if v_state <> '42501' then
                v_failures := v_failures || format('%s: %s -> %s, expected 42501', v_role, v_sig, v_state);
            end if;
        end loop;
    end loop;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (API boundary):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  2. API boundary: anon / authenticated / service_role cannot execute any primitive (catalog + real call -> 42501)';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------
do $$
declare
    r          record;
    v_res      text;
    v_failures text[] := '{}';
begin
    if nora_private.attachment_deletion_lease_ttl() is distinct from interval '10 minutes' then
        v_failures := array_append(v_failures, 'lease ttl is not 10 minutes');
    end if;
    if nora_private.attachment_deletion_max_attempts() is distinct from 5 then
        v_failures := array_append(v_failures, 'max attempts is not 5');
    end if;
    for r in
        select * from (values (1, interval '15 minutes'), (2, interval '30 minutes'), (3, interval '60 minutes'),
                              (4, interval '120 minutes'), (5, interval '240 minutes'), (6, interval '6 hours'),
                              (7, interval '6 hours'), (2147483647, interval '6 hours')) as t(n, expected)
    loop
        if nora_private.attachment_deletion_retry_delay(r.n) is distinct from r.expected then
            v_failures := v_failures || format('retry_delay(%s) = %s, expected %s',
                r.n, nora_private.attachment_deletion_retry_delay(r.n), r.expected);
        end if;
    end loop;
    foreach v_res in array array['0', '-1', 'null'] loop
        if pg_temp.s2a22_try(format('select nora_private.attachment_deletion_retry_delay(%s)', v_res))
           <> '22023:NORA_ATTACHMENT_INVALID_ARGUMENT' then
            v_failures := v_failures || format('retry_delay(%s) did not raise 22023 NORA_ATTACHMENT_INVALID_ARGUMENT', v_res);
        end if;
    end loop;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (helpers):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  3. helpers: ttl 10 min, budget 5, delays 15/30/60/120/240 min, cap 6 h (no overflow), invalid attempt -> 22023';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Claim
-- ---------------------------------------------------------------------------
do $$
declare
    c_uuid     constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
    r          record;
    v_n        integer;
    j_retry    bigint; j_p2 bigint; j_p3 bigint; j_future bigint;
    j_done     bigint; j_term bigint; j_skip bigint;
    v_tok      text[] := '{}';
    v_old_tok  text;
    v_snap     jsonb;
    v_failures text[] := '{}';
begin
    delete from nora_private.attachment_storage_deletion_queue;

    -- 4a. no work -> zero rows, no exception
    select count(*) into v_n from nora_private.attachment_deletion_claim_next();
    if v_n <> 0 then
        v_failures := v_failures || format('4a empty queue returned %s rows', v_n);
    end if;

    insert into nora_private.attachment_storage_deletion_queue (storage_key, available_at)
        values ('s2a22-c-future.pdf', now() + interval '1 hour') returning id into j_future;
    insert into nora_private.attachment_storage_deletion_queue (storage_key, state, completed_at, available_at)
        values ('s2a22-c-done.pdf', 'done', now(), now() - interval '1 day') returning id into j_done;
    insert into nora_private.attachment_storage_deletion_queue
            (storage_key, state, completed_at, available_at, attempt_count, last_error_code, last_error_at)
        values ('s2a22-c-term.pdf', 'failed_terminal', now(), now() - interval '1 day', 5, 'NORA_ATTACHMENT_X', now())
        returning id into j_term;
    insert into nora_private.attachment_storage_deletion_queue (storage_key, state, completed_at, available_at)
        values ('s2a22-c-skip.pdf', 'skipped_live', now(), now() - interval '1 day') returning id into j_skip;
    insert into nora_private.attachment_storage_deletion_queue (storage_key, available_at)
        values ('s2a22-c-p2.pdf', now() - interval '1 minute') returning id into j_p2;
    insert into nora_private.attachment_storage_deletion_queue
            (storage_key, state, attempt_count, available_at, last_error_code, last_error_at)
        values ('s2a22-c-retry.pdf', 'failed_retryable', 1, now() - interval '2 minutes',
                'NORA_ATTACHMENT_LIVENESS_UNKNOWN', now() - interval '1 hour')
        returning id into j_retry;
    insert into nora_private.attachment_storage_deletion_queue (storage_key, available_at)
        values ('s2a22-c-p3.pdf', now() - interval '1 minute') returning id into j_p3;

    v_snap := jsonb_build_object('future', pg_temp.s2a22_row(j_future), 'done', pg_temp.s2a22_row(j_done),
                                 'term', pg_temp.s2a22_row(j_term), 'skip', pg_temp.s2a22_row(j_skip));

    -- 4b. oldest available_at first: the due failed_retryable job
    select * into r from nora_private.attachment_deletion_claim_next();
    if r.job_id is distinct from j_retry then
        v_failures := v_failures || format('4b first claim returned job %s, expected the oldest due job %s', r.job_id, j_retry);
    else
        if r.storage_key <> 's2a22-c-retry.pdf' or r.attempt_count <> 2
           or r.claimed_at <> now() or r.lease_expires_at <> now() + interval '10 minutes'
           or r.lease_token !~ c_uuid then
            v_failures := v_failures || format('4b claim result wrong: %s', row_to_json(r));
        end if;
        if (select state <> 'claimed' or claimed_by is distinct from r.lease_token or claimed_at <> now()
                   or attempt_count <> 2
                   or last_error_code is distinct from 'NORA_ATTACHMENT_LIVENESS_UNKNOWN'
                   or last_error_at is distinct from now() - interval '1 hour'
                   or completed_at is not null
            from nora_private.attachment_storage_deletion_queue where id = j_retry) then
            v_failures := v_failures || format('4b claimed row wrong (error history must be kept): %s', pg_temp.s2a22_row(j_retry));
        end if;
        v_tok := v_tok || r.lease_token;
    end if;

    -- 4c. equal available_at: lower id first
    select * into r from nora_private.attachment_deletion_claim_next();
    if r.job_id is distinct from j_p2 or r.attempt_count <> 1 then
        v_failures := v_failures || format('4c second claim returned %s, expected %s with attempt 1', row_to_json(r), j_p2);
    end if;
    v_tok := v_tok || r.lease_token;
    select * into r from nora_private.attachment_deletion_claim_next();
    if r.job_id is distinct from j_p3 or r.attempt_count <> 1 then
        v_failures := v_failures || format('4c third claim returned %s, expected %s with attempt 1', row_to_json(r), j_p3);
    end if;
    v_tok := v_tok || r.lease_token;

    -- 4d. nothing else is due: future and terminal rows are never claimed
    select count(*) into v_n from nora_private.attachment_deletion_claim_next();
    if v_n <> 0 then
        v_failures := v_failures || format('4d a future or terminal job was claimed (%s rows)', v_n);
    end if;
    if v_snap is distinct from jsonb_build_object('future', pg_temp.s2a22_row(j_future), 'done', pg_temp.s2a22_row(j_done),
                                                  'term', pg_temp.s2a22_row(j_term), 'skip', pg_temp.s2a22_row(j_skip)) then
        v_failures := array_append(v_failures, '4d a future or terminal row was modified by claim_next');
    end if;

    -- 4e. every claim minted its own token
    if (select count(distinct t) from unnest(v_tok) t) <> 3 or exists (select 1 from unnest(v_tok) t where t !~ c_uuid) then
        v_failures := v_failures || format('4e lease tokens are not three distinct UUIDs: %s', v_tok);
    end if;

    -- 4f. a reclaim mints a NEW token and increments exactly once more
    v_old_tok := (select claimed_by from nora_private.attachment_storage_deletion_queue where id = j_p2);
    perform nora_private.attachment_deletion_fail(j_p2, v_old_tok, 'NORA_ATTACHMENT_TEST', true);
    update nora_private.attachment_storage_deletion_queue set available_at = now() - interval '1 second' where id = j_p2;
    select * into r from nora_private.attachment_deletion_claim_next();
    if r.job_id is distinct from j_p2 or r.attempt_count <> 2
       or r.lease_token = v_old_tok or r.lease_token = any (v_tok) or r.lease_token !~ c_uuid then
        v_failures := v_failures || format('4f reclaim %s did not mint a fresh token / increment once (old token %s)', row_to_json(r), v_old_tok);
    end if;
    if (select last_error_code from nora_private.attachment_storage_deletion_queue where id = j_p2) <> 'NORA_ATTACHMENT_TEST' then
        v_failures := array_append(v_failures, '4f the reclaim dropped the error history');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (claim):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  4. claim: no work -> 0 rows; due pending / failed_retryable claimed, future / terminal never; order available_at, id; attempt +1; fresh UUID token per claim; lease expiry = claimed_at + ttl; error history kept';

    raise exception 'ROLLBACK_W8C_S2A22_TEST';
exception
    when others then
        if sqlerrm <> 'ROLLBACK_W8C_S2A22_TEST' then
            raise;
        end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Stale-lease recovery
-- ---------------------------------------------------------------------------
do $$
declare
    c_ttl      constant interval := interval '10 minutes';
    r          record;
    v_n        integer;
    j_a        bigint; j_b bigint; j_c bigint; j_d bigint; j_due bigint;
    v_snap_b   jsonb;
    v_ids      bigint[];
    v_failures text[] := '{}';
begin
    delete from nora_private.attachment_storage_deletion_queue;

    insert into nora_private.attachment_storage_deletion_queue (storage_key) values ('s2a22-r-a.pdf') returning id into j_a;
    insert into nora_private.attachment_storage_deletion_queue (storage_key) values ('s2a22-r-b.pdf') returning id into j_b;
    perform nora_private.attachment_deletion_claim_next();
    perform nora_private.attachment_deletion_claim_next();
    -- A exactly at the boundary (stale), B one microsecond younger (valid)
    update nora_private.attachment_storage_deletion_queue set claimed_at = now() - c_ttl where id = j_a;
    update nora_private.attachment_storage_deletion_queue set claimed_at = now() - c_ttl + interval '1 microsecond' where id = j_b;
    v_snap_b := pg_temp.s2a22_row(j_b);

    -- 5a. recovery runs although there is no due job; it returns nothing
    select count(*) into v_n from nora_private.attachment_deletion_claim_next();
    if v_n <> 0 then
        v_failures := v_failures || format('5a claim_next returned %s rows - a just-recovered job must not be re-claimed', v_n);
    end if;
    if (select state <> 'failed_retryable' or claimed_at is not null or claimed_by is not null
               or attempt_count <> 1 or completed_at is not null
               or last_error_code is distinct from 'NORA_ATTACHMENT_LEASE_EXPIRED' or last_error_at <> now()
               or available_at <> now() + interval '15 minutes'
        from nora_private.attachment_storage_deletion_queue where id = j_a) then
        v_failures := v_failures || format('5a boundary lease not recovered as specified: %s', pg_temp.s2a22_row(j_a));
    end if;
    -- 5b. one microsecond before the boundary the lease is still valid
    if pg_temp.s2a22_row(j_b) is distinct from v_snap_b then
        v_failures := v_failures || format('5b a still-valid lease was touched: %s', pg_temp.s2a22_row(j_b));
    end if;

    -- 5c. attempt 4 -> retry after 120 min; attempt 5 -> terminal
    insert into nora_private.attachment_storage_deletion_queue (storage_key, state, attempt_count, claimed_at, claimed_by, available_at)
        values ('s2a22-r-c.pdf', 'claimed', 4, now() - interval '1 hour', gen_random_uuid()::text, now() - interval '2 hours')
        returning id into j_c;
    insert into nora_private.attachment_storage_deletion_queue (storage_key, state, attempt_count, claimed_at, claimed_by, available_at)
        values ('s2a22-r-d.pdf', 'claimed', 5, now() - interval '1 hour', gen_random_uuid()::text, now() - interval '2 hours')
        returning id into j_d;
    perform nora_private.attachment_deletion_claim_next();
    if (select state <> 'failed_retryable' or attempt_count <> 4 or available_at <> now() + interval '120 minutes'
               or last_error_code <> 'NORA_ATTACHMENT_LEASE_EXPIRED' or completed_at is not null
        from nora_private.attachment_storage_deletion_queue where id = j_c) then
        v_failures := v_failures || format('5c attempt 4 not recovered to retry +120 min: %s', pg_temp.s2a22_row(j_c));
    end if;
    if (select state <> 'failed_terminal' or attempt_count <> 5 or completed_at <> now()
               or available_at <> now() - interval '2 hours'
               or claimed_at is not null or claimed_by is not null
               or last_error_code <> 'NORA_ATTACHMENT_LEASE_EXPIRED' or last_error_at <> now()
        from nora_private.attachment_storage_deletion_queue where id = j_d) then
        v_failures := v_failures || format('5c exhausted budget not recovered to failed_terminal: %s', pg_temp.s2a22_row(j_d));
    end if;

    -- 5d. at most 25 per call, oldest claimed_at first
    delete from nora_private.attachment_storage_deletion_queue;
    insert into nora_private.attachment_storage_deletion_queue (storage_key, state, attempt_count, claimed_at, claimed_by)
        select 's2a22-bulk-' || g || '.pdf', 'claimed', 1, now() - c_ttl - make_interval(secs => g), gen_random_uuid()::text
        from generate_series(1, 30) g;
    perform nora_private.attachment_deletion_claim_next();
    select array_agg(split_part(storage_key, '-', 3)::bigint order by id) into v_ids
      from (select id, replace(storage_key, '.pdf', '') as storage_key
              from nora_private.attachment_storage_deletion_queue where state = 'claimed') s;
    if (select count(*) from nora_private.attachment_storage_deletion_queue where state = 'failed_retryable') <> 25
       or v_ids is distinct from array[1,2,3,4,5]::bigint[] then
        v_failures := v_failures || format('5d first call did not recover exactly the 25 oldest leases (still claimed: %s)', v_ids);
    end if;
    perform nora_private.attachment_deletion_claim_next();
    if exists (select 1 from nora_private.attachment_storage_deletion_queue where state = 'claimed')
       or (select count(*) from nora_private.attachment_storage_deletion_queue
            where state = 'failed_retryable' and attempt_count = 1 and last_error_code = 'NORA_ATTACHMENT_LEASE_EXPIRED') <> 30 then
        v_failures := array_append(v_failures, '5d second call did not recover the remaining 5 leases');
    end if;

    -- 5e. recovery and a real claim in the same call
    delete from nora_private.attachment_storage_deletion_queue;
    insert into nora_private.attachment_storage_deletion_queue (storage_key, state, attempt_count, claimed_at, claimed_by, available_at)
        values ('s2a22-r-stale.pdf', 'claimed', 1, now() - interval '1 hour', gen_random_uuid()::text, now() - interval '3 hours')
        returning id into j_a;
    insert into nora_private.attachment_storage_deletion_queue (storage_key, available_at)
        values ('s2a22-r-due.pdf', now() - interval '1 minute') returning id into j_due;
    select * into r from nora_private.attachment_deletion_claim_next();
    if r.job_id is distinct from j_due
       or (select state from nora_private.attachment_storage_deletion_queue where id = j_a) <> 'failed_retryable' then
        v_failures := v_failures || format('5e expected recovery of %s and a claim of %s, got %s', j_a, j_due, row_to_json(r));
    end if;

    -- 5f. CRASH BUDGET: a worker that dies after every claim (never fails,
    --     never inspects) still exhausts the budget - attempt_count grows at
    --     claim, recovery ends the job terminal after the 5th expired lease
    delete from nora_private.attachment_storage_deletion_queue;
    insert into nora_private.attachment_storage_deletion_queue (storage_key) values ('s2a22-r-crash.pdf') returning id into j_a;
    for v_n in 1..5 loop
        update nora_private.attachment_storage_deletion_queue set available_at = now() - interval '1 second' where id = j_a;
        select * into r from nora_private.attachment_deletion_claim_next();
        if r.job_id is distinct from j_a or r.attempt_count is distinct from v_n then
            raise exception 'FAIL (crash budget): claim % of the crashing worker returned %, expected job % with attempt_count %',
                v_n, row_to_json(r), j_a, v_n;
        end if;
        -- the worker crashes: nothing happens until its lease expires
        update nora_private.attachment_storage_deletion_queue set claimed_at = now() - c_ttl where id = j_a;
        perform nora_private.attachment_deletion_claim_next();
    end loop;
    if (select state <> 'failed_terminal' or attempt_count <> 5 or completed_at <> now()
               or last_error_code <> 'NORA_ATTACHMENT_LEASE_EXPIRED'
        from nora_private.attachment_storage_deletion_queue where id = j_a) then
        v_failures := v_failures || format('5f five crashed claims did not exhaust the budget: %s', pg_temp.s2a22_row(j_a));
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (stale recovery):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  5. stale recovery: exact boundary stale, 1 us before valid; LEASE_EXPIRED + backoff, attempt unchanged, budget -> terminal; at most 25 per call, oldest first; runs without due work; recovered row not re-claimed; five crashed claims exhaust the budget';

    raise exception 'ROLLBACK_W8C_S2A22_TEST';
exception
    when others then
        if sqlerrm <> 'ROLLBACK_W8C_S2A22_TEST' then
            raise;
        end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Lease loss and invalid input
-- ---------------------------------------------------------------------------
do $$
declare
    c_ttl      constant interval := interval '10 minutes';
    c_lost     constant text := '55000:NORA_ATTACHMENT_LEASE_LOST';
    c_invalid  constant text := '22023:NORA_ATTACHMENT_INVALID_ARGUMENT';
    r          record;
    v_id       bigint;
    v_tok      text;
    v_snap     jsonb;
    v_res      text;
    v_other    bigint;
    v_failures text[] := '{}';
begin
    delete from nora_private.attachment_storage_deletion_queue;
    insert into nora_private.attachment_storage_deletion_queue (storage_key) values ('s2a22-l-a.pdf');
    select * into r from nora_private.attachment_deletion_claim_next();
    v_id := r.job_id; v_tok := r.lease_token;
    v_snap := pg_temp.s2a22_row(v_id);

    -- 6a. wrong token
    foreach v_res in array array[pg_temp.s2a22_try(pg_temp.s2a22_fail_sql(v_id, gen_random_uuid()::text, 'NORA_ATTACHMENT_X', true)),
                                 pg_temp.s2a22_try(pg_temp.s2a22_inspect_sql(v_id, gen_random_uuid()::text)),
                                 pg_temp.s2a22_try(pg_temp.s2a22_fail_sql(v_id, substr(v_tok, 2), 'NORA_ATTACHMENT_X', true)),
                                 pg_temp.s2a22_try(pg_temp.s2a22_fail_sql(v_id, v_tok || ' ', 'NORA_ATTACHMENT_X', true))] loop
        if v_res <> c_lost then
            v_failures := v_failures || format('6a wrong token -> %s, expected %s', v_res, c_lost);
        end if;
    end loop;

    -- 6b. unknown id with a real token
    v_res := pg_temp.s2a22_try(pg_temp.s2a22_fail_sql(v_id + 100000, v_tok, 'NORA_ATTACHMENT_X', true));
    if v_res <> c_lost then
        v_failures := v_failures || format('6b unknown id -> %s', v_res);
    end if;
    v_res := pg_temp.s2a22_try(pg_temp.s2a22_inspect_sql(v_id + 100000, v_tok));
    if v_res <> c_lost then
        v_failures := v_failures || format('6b unknown id (inspect) -> %s', v_res);
    end if;
    if pg_temp.s2a22_row(v_id) is distinct from v_snap then
        v_failures := array_append(v_failures, '6a/6b a rejected call modified the claimed row');
    end if;

    -- 6c. exact expiry boundary and beyond: LOST although not yet recovered
    update nora_private.attachment_storage_deletion_queue set claimed_at = now() - c_ttl where id = v_id;
    v_snap := pg_temp.s2a22_row(v_id);
    foreach v_res in array array[pg_temp.s2a22_try(pg_temp.s2a22_fail_sql(v_id, v_tok, 'NORA_ATTACHMENT_X', true)),
                                 pg_temp.s2a22_try(pg_temp.s2a22_inspect_sql(v_id, v_tok))] loop
        if v_res <> c_lost then
            v_failures := v_failures || format('6c exact boundary -> %s, expected %s', v_res, c_lost);
        end if;
    end loop;
    update nora_private.attachment_storage_deletion_queue set claimed_at = now() - c_ttl - interval '1 second' where id = v_id;
    v_snap := pg_temp.s2a22_row(v_id);
    foreach v_res in array array[pg_temp.s2a22_try(pg_temp.s2a22_fail_sql(v_id, v_tok, 'NORA_ATTACHMENT_X', true)),
                                 pg_temp.s2a22_try(pg_temp.s2a22_inspect_sql(v_id, v_tok))] loop
        if v_res <> c_lost then
            v_failures := v_failures || format('6c expired -> %s, expected %s', v_res, c_lost);
        end if;
    end loop;
    if pg_temp.s2a22_row(v_id) is distinct from v_snap then
        v_failures := array_append(v_failures, '6c an expired holder modified the row');
    end if;

    -- 6d. one microsecond before the boundary the holder still acts
    update nora_private.attachment_storage_deletion_queue set claimed_at = now() - c_ttl + interval '1 microsecond' where id = v_id;
    v_res := pg_temp.s2a22_try(pg_temp.s2a22_fail_sql(v_id, v_tok, 'NORA_ATTACHMENT_X', true));
    if v_res <> 'OK' then
        v_failures := v_failures || format('6d a lease 1 us before expiry was rejected: %s', v_res);
    end if;

    -- 6e. every non-claimed state -> LOST, untouched
    for r in
        select * from (values ('pending', null::timestamptz), ('failed_retryable', null), ('done', now()),
                              ('failed_terminal', now()), ('skipped_live', now())) as t(st, completed)
    loop
        insert into nora_private.attachment_storage_deletion_queue (storage_key, state, completed_at)
            values ('s2a22-l-' || r.st || '.pdf', r.st, r.completed) returning id into v_other;
        v_snap := pg_temp.s2a22_row(v_other);
        foreach v_res in array array[pg_temp.s2a22_try(pg_temp.s2a22_fail_sql(v_other, v_tok, 'NORA_ATTACHMENT_X', false)),
                                     pg_temp.s2a22_try(pg_temp.s2a22_inspect_sql(v_other, v_tok))] loop
            if v_res <> c_lost then
                v_failures := v_failures || format('6e %s -> %s, expected %s', r.st, v_res, c_lost);
            end if;
        end loop;
        if pg_temp.s2a22_row(v_other) is distinct from v_snap then
            v_failures := v_failures || format('6e the %s row was modified', r.st);
        end if;
    end loop;

    -- 6f. invalid arguments -> 22023, nothing touched
    insert into nora_private.attachment_storage_deletion_queue (storage_key) values ('s2a22-l-b.pdf');
    select * into r from nora_private.attachment_deletion_claim_next();
    v_id := r.job_id; v_tok := r.lease_token;
    v_snap := pg_temp.s2a22_row(v_id);
    foreach v_res in array array[
        pg_temp.s2a22_try(pg_temp.s2a22_fail_sql(null, v_tok, 'NORA_ATTACHMENT_X', true)),
        pg_temp.s2a22_try(pg_temp.s2a22_fail_sql(v_id, null, 'NORA_ATTACHMENT_X', true)),
        pg_temp.s2a22_try(pg_temp.s2a22_fail_sql(v_id, '', 'NORA_ATTACHMENT_X', true)),
        pg_temp.s2a22_try(pg_temp.s2a22_fail_sql(v_id, '   ', 'NORA_ATTACHMENT_X', true)),
        pg_temp.s2a22_try(pg_temp.s2a22_fail_sql(v_id, v_tok, null, true)),
        pg_temp.s2a22_try(pg_temp.s2a22_fail_sql(v_id, v_tok, 'NORA_ATTACHMENT_X', null)),
        pg_temp.s2a22_try(pg_temp.s2a22_fail_sql(v_id, v_tok, 'storage request failed', true)),
        pg_temp.s2a22_try(pg_temp.s2a22_fail_sql(v_id, v_tok, 'nora_attachment_x', true)),
        pg_temp.s2a22_try(pg_temp.s2a22_fail_sql(v_id, v_tok, 'NORA_ATTACHMENT_', true)),
        pg_temp.s2a22_try(pg_temp.s2a22_fail_sql(v_id, v_tok, 'NORA_ATTACHMENT_' || repeat('X', 65), true)),
        pg_temp.s2a22_try(pg_temp.s2a22_fail_sql(v_id, v_tok, 'NORA_ATTACHMENT_X' || chr(10), true)),
        pg_temp.s2a22_try(pg_temp.s2a22_fail_sql(v_id, v_tok, 'NORA_ATTACHMENT_X-Y', true)),
        pg_temp.s2a22_try(pg_temp.s2a22_fail_sql(v_id, v_tok, 'NORA_PERMISSION_DENIED', true)),
        pg_temp.s2a22_try(pg_temp.s2a22_fail_sql(v_id, v_tok, ' NORA_ATTACHMENT_X', true)),
        pg_temp.s2a22_try(pg_temp.s2a22_inspect_sql(null, v_tok)),
        pg_temp.s2a22_try(pg_temp.s2a22_inspect_sql(v_id, null)),
        pg_temp.s2a22_try(pg_temp.s2a22_inspect_sql(v_id, '')),
        pg_temp.s2a22_try(pg_temp.s2a22_inspect_sql(v_id, '  '))] loop
        if v_res <> c_invalid then
            v_failures := v_failures || format('6f invalid argument -> %s, expected %s', v_res, c_invalid);
        end if;
    end loop;
    if pg_temp.s2a22_row(v_id) is distinct from v_snap then
        v_failures := array_append(v_failures, '6f an invalid call modified the row');
    end if;
    -- the longest valid code (64 characters after the prefix) is accepted
    v_res := pg_temp.s2a22_try(pg_temp.s2a22_fail_sql(v_id, v_tok, 'NORA_ATTACHMENT_' || repeat('X', 64), true));
    if v_res <> 'OK' then
        v_failures := v_failures || format('6f a 64-character code suffix was rejected: %s', v_res);
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (lease loss / invalid input):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  6. lease loss: wrong token, unknown id, exact boundary, expired, every non-claimed state -> 55000 NORA_ATTACHMENT_LEASE_LOST, row untouched; invalid arguments -> 22023 NORA_ATTACHMENT_INVALID_ARGUMENT';

    raise exception 'ROLLBACK_W8C_S2A22_TEST';
exception
    when others then
        if sqlerrm <> 'ROLLBACK_W8C_S2A22_TEST' then
            raise;
        end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. ABA: a stale holder can never touch the current claim
-- ---------------------------------------------------------------------------
do $$
declare
    c_ttl      constant interval := interval '10 minutes';
    c_lost     constant text := '55000:NORA_ATTACHMENT_LEASE_LOST';
    r          record;
    v_id       bigint;
    v_tok_a    text;
    v_tok_b    text;
    v_snap_b   jsonb;
    v_res      text;
    v_n        integer;
    v_failures text[] := '{}';
begin
    delete from nora_private.attachment_storage_deletion_queue;
    insert into nora_private.attachment_storage_deletion_queue (storage_key) values ('s2a22-aba.pdf') returning id into v_id;

    -- worker A claims
    select * into r from nora_private.attachment_deletion_claim_next();
    v_tok_a := r.lease_token;
    -- A's lease expires; recovery releases it
    update nora_private.attachment_storage_deletion_queue set claimed_at = now() - c_ttl where id = v_id;
    select count(*) into v_n from nora_private.attachment_deletion_claim_next();
    if v_n <> 0 or (select state from nora_private.attachment_storage_deletion_queue where id = v_id) <> 'failed_retryable' then
        v_failures := array_append(v_failures, '7 recovery did not release A''s lease');
    end if;
    -- the backoff elapses; worker B reclaims the SAME job
    update nora_private.attachment_storage_deletion_queue set available_at = now() - interval '1 second' where id = v_id;
    select * into r from nora_private.attachment_deletion_claim_next();
    v_tok_b := r.lease_token;
    if r.job_id is distinct from v_id or v_tok_b = v_tok_a or r.attempt_count <> 2 then
        v_failures := v_failures || format('7 B did not reclaim the same job under a new token: %s (A %s)', row_to_json(r), v_tok_a);
    end if;
    v_snap_b := pg_temp.s2a22_row(v_id);

    -- A returns with its old token: every mutation is refused
    foreach v_res in array array[pg_temp.s2a22_try(pg_temp.s2a22_fail_sql(v_id, v_tok_a, 'NORA_ATTACHMENT_X', true)),
                                 pg_temp.s2a22_try(pg_temp.s2a22_fail_sql(v_id, v_tok_a, 'NORA_ATTACHMENT_X', false)),
                                 pg_temp.s2a22_try(pg_temp.s2a22_inspect_sql(v_id, v_tok_a))] loop
        if v_res <> c_lost then
            v_failures := v_failures || format('7 stale holder A -> %s, expected %s', v_res, c_lost);
        end if;
    end loop;
    if pg_temp.s2a22_row(v_id) is distinct from v_snap_b then
        v_failures := v_failures || format('7 stale holder A modified B''s claim: %s', pg_temp.s2a22_row(v_id));
    end if;

    -- B's token remains authoritative
    v_res := pg_temp.s2a22_try(pg_temp.s2a22_fail_sql(v_id, v_tok_b, 'NORA_ATTACHMENT_X', true));
    if v_res <> 'OK'
       or (select state <> 'failed_retryable' or available_at <> now() + interval '30 minutes' or attempt_count <> 2
           from nora_private.attachment_storage_deletion_queue where id = v_id) then
        v_failures := v_failures || format('7 current holder B could not act: %s / %s', v_res, pg_temp.s2a22_row(v_id));
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (ABA):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  7. ABA: A claims, expires, recovery, B reclaims with a fresh token; A fail/inspect -> LEASE_LOST, B untouched and authoritative';

    raise exception 'ROLLBACK_W8C_S2A22_TEST';
exception
    when others then
        if sqlerrm <> 'ROLLBACK_W8C_S2A22_TEST' then
            raise;
        end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Fail transitions
-- ---------------------------------------------------------------------------
do $$
declare
    c_lost     constant text := '55000:NORA_ATTACHMENT_LEASE_LOST';
    r          record;
    v_id       bigint;
    v_state    text;
    v_res      text;
    i          integer;
    v_failures text[] := '{}';
begin
    delete from nora_private.attachment_storage_deletion_queue;

    -- 8a. retryable at attempt 1
    insert into nora_private.attachment_storage_deletion_queue (storage_key) values ('s2a22-f-a.pdf') returning id into v_id;
    select * into r from nora_private.attachment_deletion_claim_next();
    v_state := nora_private.attachment_deletion_fail(v_id, r.lease_token, 'NORA_ATTACHMENT_STORAGE_TIMEOUT', true);
    if v_state <> 'failed_retryable'
       or (select state <> 'failed_retryable' or attempt_count <> 1 or available_at <> now() + interval '15 minutes'
                  or claimed_at is not null or claimed_by is not null or completed_at is not null
                  or last_error_code <> 'NORA_ATTACHMENT_STORAGE_TIMEOUT' or last_error_at <> now()
           from nora_private.attachment_storage_deletion_queue where id = v_id) then
        v_failures := v_failures || format('8a retryable failure wrong (%s): %s', v_state, pg_temp.s2a22_row(v_id));
    end if;
    -- a released job cannot be failed again with the old token
    v_res := pg_temp.s2a22_try(pg_temp.s2a22_fail_sql(v_id, r.lease_token, 'NORA_ATTACHMENT_X', true));
    if v_res <> c_lost then
        v_failures := v_failures || format('8a second fail on a released job -> %s', v_res);
    end if;

    -- 8b. non-retryable at attempt 1 -> terminal immediately
    delete from nora_private.attachment_storage_deletion_queue;
    insert into nora_private.attachment_storage_deletion_queue (storage_key, available_at)
        values ('s2a22-f-b.pdf', now() - interval '5 minutes') returning id into v_id;
    select * into r from nora_private.attachment_deletion_claim_next();
    v_state := nora_private.attachment_deletion_fail(v_id, r.lease_token, 'NORA_ATTACHMENT_FORBIDDEN', false);
    if v_state <> 'failed_terminal'
       or (select state <> 'failed_terminal' or attempt_count <> 1 or completed_at <> now()
                  or available_at <> now() - interval '5 minutes'
                  or claimed_at is not null or claimed_by is not null
                  or last_error_code <> 'NORA_ATTACHMENT_FORBIDDEN' or last_error_at <> now()
           from nora_private.attachment_storage_deletion_queue where id = v_id) then
        v_failures := v_failures || format('8b non-retryable failure wrong (%s): %s', v_state, pg_temp.s2a22_row(v_id));
    end if;

    -- 8c. five full claim / retryable-fail cycles: 15/30/60/120 min, then terminal
    delete from nora_private.attachment_storage_deletion_queue;
    insert into nora_private.attachment_storage_deletion_queue (storage_key) values ('s2a22-f-c.pdf') returning id into v_id;
    for i in 1..5 loop
        update nora_private.attachment_storage_deletion_queue set available_at = now() - interval '1 second' where id = v_id;
        select * into r from nora_private.attachment_deletion_claim_next();
        if r.job_id is distinct from v_id or r.attempt_count <> i then
            v_failures := v_failures || format('8c cycle %s: claim returned %s', i, row_to_json(r));
            exit;
        end if;
        v_state := nora_private.attachment_deletion_fail(v_id, r.lease_token, 'NORA_ATTACHMENT_STORAGE_' || i, true);
        if i < 5 then
            if v_state <> 'failed_retryable'
               or (select available_at <> now() + nora_private.attachment_deletion_retry_delay(i)
                   from nora_private.attachment_storage_deletion_queue where id = v_id) then
                v_failures := v_failures || format('8c cycle %s: %s / %s', i, v_state, pg_temp.s2a22_row(v_id));
            end if;
        elsif v_state <> 'failed_terminal'
              or (select state <> 'failed_terminal' or attempt_count <> 5 or completed_at <> now()
                         or last_error_code <> 'NORA_ATTACHMENT_STORAGE_5'
                  from nora_private.attachment_storage_deletion_queue where id = v_id) then
            v_failures := v_failures || format('8c budget exhaustion wrong (%s): %s', v_state, pg_temp.s2a22_row(v_id));
        end if;
    end loop;
    -- a terminal job is never claimed again
    update nora_private.attachment_storage_deletion_queue set available_at = now() - interval '1 second' where id = v_id;
    if (select count(*) from nora_private.attachment_deletion_claim_next()) <> 0 then
        v_failures := array_append(v_failures, '8c a failed_terminal job was claimed again');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (fail transitions):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  8. fail: retryable -> backoff, non-retryable -> terminal, budget exhausted at attempt 5 -> terminal with the real cause code, released / terminal jobs unreachable';

    raise exception 'ROLLBACK_W8C_S2A22_TEST';
exception
    when others then
        if sqlerrm <> 'ROLLBACK_W8C_S2A22_TEST' then
            raise;
        end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9.–11. Liveness mapping, terminal recreation, no done
-- ---------------------------------------------------------------------------
do $$
declare
    c_ttl      constant interval := interval '10 minutes';
    c_lost     constant text := '55000:NORA_ATTACHMENT_LEASE_LOST';
    c_f        constant text := 'https://attacker.example.net/storage/v1/object/public/attachments/';
    r          record;
    ins        record;
    v_user     uuid := gen_random_uuid();
    v_sales    bigint;
    v_company  bigint; v_contact bigint; v_cnote bigint;
    v_a        bigint;
    v_id       bigint;
    v_tok      text;
    v_snap     jsonb;
    v_res      text;
    v_state    text;
    i          integer;
    v_failures text[] := '{}';
begin
    -- clean-universe precondition: a fresh key must be dead
    if nora_private.attachment_storage_key_liveness('s2a22-baseline-' || gen_random_uuid()::text) <> 'dead' then
        raise exception 'FAIL (precondition): the reference universe is not clean - run this suite after a fresh `npx supabase db reset --local`';
    end if;

    delete from nora_private.attachment_storage_deletion_queue;

    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'w8c-s2a22-owner@nora.test', 'x', now(),
            '{"provider":"email","providers":["email"]}', '{"first_name":"Queue","last_name":"Lease"}', now(), now());
    select id into v_sales from public.sales where user_id = v_user;
    insert into public.companies (name, sales_id) values ('W8-C S2A2.2 Kunde', v_sales) returning id into v_company;
    insert into public.contacts (first_name, last_name, company_id, sales_id)
        values ('Lease', 'Holder', v_company, v_sales) returning id into v_contact;
    insert into public.contact_notes (contact_id, text, date, sales_id)
        values (v_contact, 'Queue', now(), v_sales) returning id into v_cnote;

    -- ---- 9a. LIVE via public.attachments -> skipped_live, history kept -----
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type, ordinal)
        values (v_cnote, 's2a22-live-a.pdf', 'a.pdf', 'application/pdf', 1) returning id into v_a;
    insert into nora_private.attachment_storage_deletion_queue
            (storage_key, state, attempt_count, available_at, last_error_code, last_error_at)
        values ('s2a22-live-a.pdf', 'failed_retryable', 1, now() - interval '1 minute',
                'NORA_ATTACHMENT_LIVENESS_UNKNOWN', now() - interval '1 hour')
        returning id into v_id;
    select * into r from nora_private.attachment_deletion_claim_next();
    v_tok := r.lease_token;
    select * into ins from nora_private.attachment_deletion_inspect(v_id, v_tok);
    if ins.verdict is distinct from 'live' or ins.job_state is distinct from 'skipped_live'
       or (select state <> 'skipped_live' or completed_at <> now() or claimed_at is not null or claimed_by is not null
                  or attempt_count <> 2
                  or last_error_code is distinct from 'NORA_ATTACHMENT_LIVENESS_UNKNOWN'
                  or last_error_at is distinct from now() - interval '1 hour'
           from nora_private.attachment_storage_deletion_queue where id = v_id) then
        v_failures := v_failures || format('9a LIVE (public.attachments) -> %s / %s', row_to_json(ins), pg_temp.s2a22_row(v_id));
    end if;
    -- the lease is consumed: the holder can do nothing more
    foreach v_res in array array[pg_temp.s2a22_try(pg_temp.s2a22_inspect_sql(v_id, v_tok)),
                                 pg_temp.s2a22_try(pg_temp.s2a22_fail_sql(v_id, v_tok, 'NORA_ATTACHMENT_X', true))] loop
        if v_res <> c_lost then
            v_failures := v_failures || format('9a after skipped_live the old lease still acts: %s', v_res);
        end if;
    end loop;

    -- ---- 10a. after skipped_live a new capture creates a fresh intent ------
    delete from public.attachments where id = v_a;
    if (select count(*) from nora_private.attachment_storage_deletion_queue
        where storage_key = 's2a22-live-a.pdf' and state = 'pending') <> 1 then
        v_failures := array_append(v_failures, '10a capture after skipped_live did not create exactly one pending job');
    end if;
    delete from nora_private.attachment_storage_deletion_queue where storage_key = 's2a22-live-a.pdf' and state = 'pending';

    -- ---- 9b. LIVE via a legacy note array -> skipped_live -----------------
    -- W8-C S3B: a LEGACY array (pre-S3B history: JSON reference, no
    -- public.attachments row) is exactly what 9b classifies, so it is stored
    -- with the note projection switched off for this rolled-back block.
    alter table public.contact_notes disable trigger project_contact_note_attachments_after_update_trigger;
    update public.contact_notes set attachments = array[jsonb_build_object('path', 's2a22-live-b.pdf', 'title', 'b.pdf')]
        where id = v_cnote;
    insert into nora_private.attachment_storage_deletion_queue (storage_key) values ('s2a22-live-b.pdf') returning id into v_id;
    select * into r from nora_private.attachment_deletion_claim_next();
    select * into ins from nora_private.attachment_deletion_inspect(v_id, r.lease_token);
    if ins.verdict is distinct from 'live' or ins.job_state is distinct from 'skipped_live'
       or (select state from nora_private.attachment_storage_deletion_queue where id = v_id) <> 'skipped_live' then
        v_failures := v_failures || format('9b LIVE (legacy note array) -> %s / %s', row_to_json(ins), pg_temp.s2a22_row(v_id));
    end if;
    update public.contact_notes set attachments = null where id = v_cnote;
    alter table public.contact_notes enable trigger project_contact_note_attachments_after_update_trigger;

    -- ---- 9c. UNKNOWN (residual config tripwire): retry, then terminal ------
    update public.configuration set config = jsonb_build_object('heroImage', jsonb_build_object('path', 's2a22-unknown-c.png'));
    if nora_private.attachment_storage_key_liveness('s2a22-unknown-c.png') <> 'unknown' then
        v_failures := array_append(v_failures, '9c precondition: the tripwire fixture is not unknown');
    end if;
    insert into nora_private.attachment_storage_deletion_queue (storage_key) values ('s2a22-unknown-c.png') returning id into v_id;
    for i in 1..5 loop
        update nora_private.attachment_storage_deletion_queue set available_at = now() - interval '1 second' where id = v_id;
        select * into r from nora_private.attachment_deletion_claim_next();
        if r.job_id is distinct from v_id then
            v_failures := v_failures || format('9c cycle %s: claim returned %s', i, row_to_json(r));
            exit;
        end if;
        select * into ins from nora_private.attachment_deletion_inspect(v_id, r.lease_token);
        v_state := (select state from nora_private.attachment_storage_deletion_queue where id = v_id);
        if ins.verdict is distinct from 'unknown' or v_state in ('skipped_live', 'done', 'claimed')
           or (select last_error_code from nora_private.attachment_storage_deletion_queue where id = v_id)
              is distinct from 'NORA_ATTACHMENT_LIVENESS_UNKNOWN' then
            v_failures := v_failures || format('9c cycle %s: UNKNOWN -> %s / %s', i, row_to_json(ins), pg_temp.s2a22_row(v_id));
        end if;
        if i < 5 and (ins.job_state <> 'failed_retryable' or v_state <> 'failed_retryable'
                      or (select available_at from nora_private.attachment_storage_deletion_queue where id = v_id)
                         <> now() + nora_private.attachment_deletion_retry_delay(i)) then
            v_failures := v_failures || format('9c cycle %s: not retryable with backoff: %s', i, pg_temp.s2a22_row(v_id));
        end if;
        if i = 5 and (ins.job_state <> 'failed_terminal' or v_state <> 'failed_terminal'
                      or (select completed_at from nora_private.attachment_storage_deletion_queue where id = v_id) <> now()) then
            v_failures := v_failures || format('9c budget spent: not terminal: %s', pg_temp.s2a22_row(v_id));
        end if;
    end loop;

    -- ---- 10b. after failed_terminal a new capture creates a fresh intent ---
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type, ordinal)
        values (v_cnote, 's2a22-unknown-c.png', 'c.png', 'image/png', 2) returning id into v_a;
    delete from public.attachments where id = v_a;
    if (select count(*) from nora_private.attachment_storage_deletion_queue
        where storage_key = 's2a22-unknown-c.png' and state = 'pending') <> 1 then
        v_failures := array_append(v_failures, '10b capture after failed_terminal did not create exactly one pending job');
    end if;
    delete from nora_private.attachment_storage_deletion_queue where storage_key = 's2a22-unknown-c.png' and state = 'pending';
    update public.configuration set config = '{}'::jsonb;

    -- ---- 9d. UNKNOWN (foreign-origin avatar URL) -> failed_retryable ------
    update public.contacts set avatar = jsonb_build_object('src', c_f || 's2a22-unknown-d.png') where id = v_contact;
    insert into nora_private.attachment_storage_deletion_queue (storage_key) values ('s2a22-unknown-d.png') returning id into v_id;
    select * into r from nora_private.attachment_deletion_claim_next();
    select * into ins from nora_private.attachment_deletion_inspect(v_id, r.lease_token);
    if ins.verdict is distinct from 'unknown' or ins.job_state is distinct from 'failed_retryable'
       or (select state <> 'failed_retryable' or last_error_code <> 'NORA_ATTACHMENT_LIVENESS_UNKNOWN'
           from nora_private.attachment_storage_deletion_queue where id = v_id) then
        v_failures := v_failures || format('9d UNKNOWN (foreign origin) -> %s / %s', row_to_json(ins), pg_temp.s2a22_row(v_id));
    end if;
    update public.contacts set avatar = null where id = v_contact;

    -- ---- 9e. DEAD -> no write at all, then ordinary recovery --------------
    insert into nora_private.attachment_storage_deletion_queue (storage_key) values ('s2a22-dead-e.pdf') returning id into v_id;
    select * into r from nora_private.attachment_deletion_claim_next();
    v_tok := r.lease_token;
    v_snap := pg_temp.s2a22_row(v_id);
    for i in 1..2 loop
        select * into ins from nora_private.attachment_deletion_inspect(v_id, v_tok);
        if ins.verdict is distinct from 'dead' or ins.job_state is distinct from 'claimed'
           or pg_temp.s2a22_row(v_id) is distinct from v_snap then
            v_failures := v_failures || format('9e DEAD inspection %s wrote something: %s / %s (before %s)',
                i, row_to_json(ins), pg_temp.s2a22_row(v_id), v_snap);
        end if;
    end loop;
    if (select claimed_by <> v_tok or attempt_count <> 1 or claimed_at <> now() or last_error_code is not null
        from nora_private.attachment_storage_deletion_queue where id = v_id) then
        v_failures := array_append(v_failures, '9e DEAD changed the lease, the attempt count or the error fields');
    end if;
    -- nothing acts on DEAD: the lease expires and ordinary recovery applies
    update nora_private.attachment_storage_deletion_queue set claimed_at = now() - c_ttl where id = v_id;
    perform nora_private.attachment_deletion_claim_next();
    if (select state <> 'failed_retryable' or last_error_code <> 'NORA_ATTACHMENT_LEASE_EXPIRED' or attempt_count <> 1
        from nora_private.attachment_storage_deletion_queue where id = v_id) then
        v_failures := v_failures || format('9e a DEAD job was not recovered normally after expiry: %s', pg_temp.s2a22_row(v_id));
    end if;

    -- ---- 9f. LIVE dominates UNKNOWN -> skipped_live ------------------------
    update public.configuration set config = jsonb_build_object('heroImage', jsonb_build_object('path', 's2a22-both-f.pdf'));
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type, ordinal)
        values (v_cnote, 's2a22-both-f.pdf', 'f.pdf', 'application/pdf', 3);
    insert into nora_private.attachment_storage_deletion_queue (storage_key) values ('s2a22-both-f.pdf') returning id into v_id;
    select * into r from nora_private.attachment_deletion_claim_next();
    select * into ins from nora_private.attachment_deletion_inspect(v_id, r.lease_token);
    if ins.verdict is distinct from 'live' or ins.job_state is distinct from 'skipped_live' then
        v_failures := v_failures || format('9f LIVE + UNKNOWN -> %s, expected live / skipped_live', row_to_json(ins));
    end if;
    update public.configuration set config = '{}'::jsonb;

    -- ---- 9g. a resolver error propagates and leaves the job claimed -------
    insert into nora_private.attachment_storage_deletion_queue (storage_key) values ('s2a22-error-g.pdf') returning id into v_id;
    select * into r from nora_private.attachment_deletion_claim_next();
    v_snap := pg_temp.s2a22_row(v_id);
    v_res := 'no error';
    begin
        alter table public.companies rename column logo to logo_s2a22_drift;
        perform * from nora_private.attachment_deletion_inspect(v_id, r.lease_token);
        raise exception 'S2A22_NO_ERROR';
    exception when others then
        v_res := sqlstate;
        if sqlerrm = 'S2A22_NO_ERROR' then v_res := 'no error'; end if;
    end;
    if v_res <> '42703' then
        v_failures := v_failures || format('9g resolver schema drift -> %s, expected the 42703 error to propagate', v_res);
    end if;
    if pg_temp.s2a22_row(v_id) is distinct from v_snap then
        v_failures := v_failures || format('9g a failed inspection changed the job: %s', pg_temp.s2a22_row(v_id));
    end if;
    -- after the rolled-back drift the same holder inspects normally
    select * into ins from nora_private.attachment_deletion_inspect(v_id, r.lease_token);
    if ins.verdict is distinct from 'dead' or ins.job_state is distinct from 'claimed' then
        v_failures := v_failures || format('9g the holder could not inspect after the error: %s', row_to_json(ins));
    end if;

    -- ---- 11. no S2A2.2 path ever wrote done --------------------------------
    if exists (select 1 from nora_private.attachment_storage_deletion_queue where state = 'done') then
        v_failures := array_append(v_failures, '11 a done row exists after LIVE / UNKNOWN / DEAD / recovery / fail cycles');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (liveness mapping):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  9. inspect: LIVE (attachments, note array) -> skipped_live; UNKNOWN (tripwire, foreign origin) -> retry then terminal; DEAD -> no write, later ordinary recovery; LIVE > UNKNOWN; resolver error propagates, job stays claimed';
    raise notice 'OK 10. terminal recreation: a new capture after skipped_live / failed_terminal creates a fresh pending intent';
    raise notice 'OK 11. no S2A2.2 path wrote done';

    raise exception 'ROLLBACK_W8C_S2A22_TEST';
exception
    when others then
        if sqlerrm <> 'ROLLBACK_W8C_S2A22_TEST' then
            raise;
        end if;
end;
$$;

\echo '=== W8-C S2A2.2: all sections passed ==='
