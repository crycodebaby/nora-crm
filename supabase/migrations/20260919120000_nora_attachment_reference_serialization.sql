-- Nora CRM: W8-C S3A Attachment Storage-Key Serialization & Reference Guard (2026-09-19)
--
-- Closes LOW-1 and the re-reference race at the database level, before any
-- writer uses public.attachments (S3B) and long before any physical deletion
-- (S2B). Four pieces, all DB-only:
--
--   1. ONE per-storage-key coordination point:
--      nora_private.lock_attachment_storage_key(text) - a TRANSACTION-scoped
--      advisory lock, pg_advisory_xact_lock(hashtext('nora_attachment_storage_key'),
--      hashtext(key)), the same convention as nora_primary_contact /
--      nora_idempotency. It refuses to run outside READ COMMITTED, because the
--      whole protocol relies on the fresh statement snapshot taken AFTER the
--      lock wait.
--   2. The same lock in every operation that changes whether a key is
--      referenced or decides on its deletion intent:
--        * capture   (AFTER DELETE on public.attachments, S2A1) - lock, then enqueue
--        * admission (AFTER INSERT on public.attachments, new)  - lock, then check
--        * inspect   (S2A2.2) - read key, lock, THEN the authoritative leased
--                    FOR UPDATE and the single resolver call
--   3. Reference admission (invariant I1): a new public.attachments row for key
--      K must not commit while K has an ACTIVE deletion intent (pending /
--      claimed / failed_retryable) or a done tombstone. It is rejected with
--      DETAIL NORA_ATTACHMENT_STORAGE_KEY_PENDING_DELETION. The job is never
--      touched: no withdrawal, no cancel, no new state.
--   4. storage_key is immutable on public.attachments; a logical move is
--      DELETE + INSERT and therefore goes through capture + admission.
--
-- plus the single-writer preparation for S3B: `authenticated` loses direct
-- INSERT / DELETE on public.attachments (SELECT stays), and the two writer
-- policies that only existed for that direct path are dropped.
--
-- LOCK ORDER (global discipline, see 03-data-model-guardrails.md 3.3):
--     attachment row / unique-index entry  ->  storage-key lock  ->  queue row
-- Admission and capture are AFTER row triggers, so they hold the row side
-- first. Inspect holds no attachment row and takes the key lock before it
-- locks the queue row. claim / fail / stale recovery never wait on a key lock.
-- Taking the key lock BEFORE an attachment INSERT/DELETE would invert this
-- order against capture and deadlock - never do that.
--
-- WHAT THIS MIGRATION DOES NOT DO:
--   * no note JSON -> public.attachments projection, no JSON validation, no
--     application-facing RPC, no frontend error mapping (all S3B),
--   * no backfill (S4), no read switch (S5), no legacy write retirement (S6),
--   * no worker, no Storage call, no network, no pg_net, no Edge Function,
--     no path to 'done', no new queue state, no service_role capability (S2B),
--   * no change to claim / fail / the lease constants / the resolver,
--   * no column, constraint, index or FK change on public.attachments or the
--     queue, no data migration.
-- The DB lock does NOT make an external Storage DELETE safe: it lives only as
-- long as a database transaction. External side-effect fencing stays with S2B.

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
    v_literals  text[];
    v_def       text;
    v_names     text;
begin
    if current_user <> 'postgres' then
        raise exception 'NORA_ATTACHMENT_REFERENCE_SERIALIZATION: expected migration creator postgres, got %', current_user
            using errcode = '42501';
    end if;

    if to_regnamespace('nora_private') is null then
        raise exception 'NORA_ATTACHMENT_REFERENCE_SERIALIZATION: schema nora_private is missing'
            using errcode = '3F000';
    end if;

    if to_regclass('public.attachments') is null
       or to_regclass('nora_private.attachment_storage_deletion_queue') is null then
        raise exception 'NORA_ATTACHMENT_REFERENCE_SERIALIZATION: public.attachments or the deletion queue is missing (W8-C S1 / S2A1 not applied)'
            using errcode = 'P0002';
    end if;

    -- The new objects are created exactly once.
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'nora_private'
                 and p.proname in ('lock_attachment_storage_key',
                                   'guard_attachment_reference_admission',
                                   'guard_attachment_storage_key_immutable')) then
        raise exception 'NORA_ATTACHMENT_REFERENCE_SERIALIZATION: an S3A function already exists in nora_private'
            using errcode = '42723',
                  hint = 'This migration creates the S3A objects once. Investigate where the existing object came from instead of re-running it.';
    end if;

    -- ---- public.attachments: the S1 shape this slice relies on --------------
    if pg_get_userbyid((select relowner from pg_class where oid = 'public.attachments'::regclass)) <> 'postgres' then
        v_failures := array_append(v_failures, 'public.attachments is not owned by postgres');
    end if;
    if not exists (select 1 from pg_attribute a
                   where a.attrelid = 'public.attachments'::regclass and a.attname = 'storage_key'
                     and not a.attisdropped and a.attnotnull
                     and format_type(a.atttypid, a.atttypmod) = 'text') then
        v_failures := array_append(v_failures, 'public.attachments.storage_key is not text NOT NULL');
    end if;
    if not exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
                   where i.indrelid = 'public.attachments'::regclass
                     and c.relname = 'uq__attachments__storage_key'
                     and i.indisunique and i.indpred is null and i.indnatts = 1
                     and i.indkey[0] = (select a.attnum from pg_attribute a
                                        where a.attrelid = 'public.attachments'::regclass and a.attname = 'storage_key')) then
        v_failures := array_append(v_failures, 'the full UNIQUE index uq__attachments__storage_key (storage_key) is missing or changed');
    end if;
    if not exists (select 1 from pg_constraint con
                   where con.conrelid = 'public.attachments'::regclass
                     and con.conname = 'attachments_owner_check' and con.contype = 'c') then
        v_failures := array_append(v_failures, 'attachments_owner_check (note XOR) is missing');
    end if;
    if (select count(*) from pg_constraint con
        where con.conrelid = 'public.attachments'::regclass and con.contype = 'f'
          and con.confdeltype = 'c'
          and con.confrelid in ('public.contact_notes'::regclass, 'public.deal_notes'::regclass)) <> 2 then
        v_failures := array_append(v_failures, 'the two note FKs are not both ON DELETE CASCADE');
    end if;
    if not (select c.relrowsecurity from pg_class c where c.oid = 'public.attachments'::regclass) then
        v_failures := array_append(v_failures, 'row level security is not enabled on public.attachments');
    end if;

    -- exactly the three S1 policies, with their S1 expressions
    select string_agg(format('%s/%s/%s/%s/%s', p.policyname, p.cmd, p.roles::text,
                             coalesce(p.qual, '-'), coalesce(p.with_check, '-')), ' | ' order by p.policyname)
      into v_def
    from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'attachments';
    if v_def is distinct from
           'attachments_delete_writer/DELETE/{authenticated}/nora_private.can_write()/-'
        || ' | attachments_insert_writer/INSERT/{authenticated}/-/nora_private.can_write()'
        || ' | attachments_select_active_user/SELECT/{authenticated}/nora_private.is_active_user()/-' then
        v_failures := v_failures || format('public.attachments policies are not the S1 set: %s', coalesce(v_def, '<none>'));
    end if;

    -- the S1 privilege matrix
    for r in
        select * from (values ('authenticated', 'SELECT,INSERT,DELETE'), ('anon', ''), ('service_role', '')) as t(grantee, privs)
    loop
        if (select string_agg(pr, ',' order by pr) from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) pr
            where has_table_privilege(r.grantee, 'public.attachments', pr))
           is distinct from nullif((select string_agg(x, ',' order by x) from unnest(string_to_array(r.privs, ',')) x), '') then
            v_failures := v_failures || format('%s privileges on public.attachments are not the S1 matrix (%s)', r.grantee, r.privs);
        end if;
    end loop;

    -- the only trigger is the S2A1 capture hook, still AFTER DELETE FOR EACH ROW
    select string_agg(t.tgname, ', ' order by t.tgname) into v_names
    from pg_trigger t where t.tgrelid = 'public.attachments'::regclass and not t.tgisinternal;
    if v_names is distinct from 'enqueue_attachment_storage_deletion_after_delete_trigger' then
        v_failures := v_failures || format('public.attachments triggers are not exactly the S2A1 capture hook: %s', coalesce(v_names, '<none>'));
    end if;
    if not exists (select 1 from pg_trigger t
                   where t.tgrelid = 'public.attachments'::regclass
                     and t.tgname = 'enqueue_attachment_storage_deletion_after_delete_trigger'
                     and t.tgfoid = to_regprocedure('nora_private.enqueue_attachment_storage_deletion()')
                     and (t.tgtype & 1) = 1 and (t.tgtype & 8) = 8 and (t.tgtype & 2) = 0
                     and (t.tgtype & 4) = 0 and (t.tgtype & 16) = 0) then
        v_failures := array_append(v_failures, 'the capture trigger is not AFTER DELETE FOR EACH ROW -> enqueue_attachment_storage_deletion()');
    end if;

    -- ---- the queue: S2A1 + S2A2.1 + S2A2.2 contract -------------------------
    select pg_get_constraintdef(con.oid),
           (select array_agg(m[1] order by m[1])
              from regexp_matches(pg_get_constraintdef(con.oid), '''([a-z_]+)''::text', 'g') as m)
      into v_def, v_literals
    from pg_constraint con
    where con.conrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
      and con.conname = 'attachment_storage_deletion_queue_state_check' and con.contype = 'c';
    if v_literals is distinct from array['claimed','done','failed_retryable','failed_terminal','pending','skipped_live'] then
        v_failures := v_failures || format('state_check is not the six-state vocabulary: %s', coalesce(v_def, '<missing>'));
    end if;
    if not exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
                   where i.indrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
                     and c.relname = 'uq__attachment_deletion_queue__active_storage_key'
                     and i.indisunique
                     and (select array_agg(m[1] order by m[1])
                            from regexp_matches(pg_get_expr(i.indpred, i.indrelid), '''([a-z_]+)''::text', 'g') as m)
                         = array['claimed','failed_retryable','pending']) then
        v_failures := array_append(v_failures, 'the active-intent partial unique index is missing or changed');
    end if;
    if pg_get_userbyid((select relowner from pg_class
                        where oid = 'nora_private.attachment_storage_deletion_queue'::regclass)) <> 'postgres'
       or not (select c.relrowsecurity from pg_class c
               where c.oid = 'nora_private.attachment_storage_deletion_queue'::regclass)
       or exists (select 1 from pg_policies p
                  where p.schemaname = 'nora_private' and p.tablename = 'attachment_storage_deletion_queue')
       or exists (select 1 from pg_class c, aclexplode(c.relacl) acl
                  where c.oid = 'nora_private.attachment_storage_deletion_queue'::regclass
                    and (acl.grantee = 0 or pg_get_userbyid(acl.grantee) <> 'postgres')) then
        v_failures := array_append(v_failures, 'the queue is no longer postgres-owned / RLS on / no policy / owner-only ACL');
    end if;

    -- ---- the functions this slice modifies or delegates to -------------------
    if not exists (select 1 from pg_proc p
                   where p.oid = to_regprocedure('nora_private.enqueue_attachment_storage_deletion()')
                     and p.prosecdef and p.prorettype = 'trigger'::regtype
                     and pg_get_userbyid(p.proowner) = 'postgres'
                     and p.proconfig = array['search_path=""']) then
        v_failures := array_append(v_failures, 'the S2A1 capture function is missing or not the SECURITY DEFINER search_path='''' contract');
    end if;
    if not exists (select 1 from pg_proc p
                   where p.oid = to_regprocedure('nora_private.attachment_deletion_inspect(bigint,text)')
                     and not p.prosecdef and p.proretset and p.provolatile = 'v'
                     and pg_get_userbyid(p.proowner) = 'postgres'
                     and p.proconfig = array['search_path=""', 'row_security=off']) then
        v_failures := array_append(v_failures, 'the S2A2.2 inspect function is missing or its security contract changed');
    end if;
    if exists (select 1 from unnest(array['public','anon','authenticated','service_role']) as rl(role_name)
               where has_function_privilege(rl.role_name, 'nora_private.attachment_deletion_inspect(bigint,text)', 'EXECUTE')
                  or has_function_privilege(rl.role_name, 'nora_private.enqueue_attachment_storage_deletion()', 'EXECUTE')) then
        v_failures := array_append(v_failures, 'an API role holds EXECUTE on capture or inspect');
    end if;
    if not exists (select 1 from pg_proc p
                   where p.oid = to_regprocedure('nora_private.attachment_storage_key_liveness(text)')
                     and p.prosecdef and p.prorettype = 'text'::regtype
                     and pg_get_userbyid(p.proowner) = 'postgres'
                     and p.proconfig = array['search_path=""', 'row_security=off']) then
        v_failures := array_append(v_failures, 'the S2A2.1 liveness resolver is missing or not the definer resolver');
    end if;

    -- ---- I1 must already hold, or the guard would protect a broken state -----
    if exists (select 1 from public.attachments a
               join nora_private.attachment_storage_deletion_queue q on q.storage_key = a.storage_key
               where q.state in ('pending', 'claimed', 'failed_retryable', 'done')) then
        v_failures := array_append(v_failures,
            'a public.attachments row shares its storage_key with an active or done deletion intent (I1 already violated)');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'NORA_ATTACHMENT_REFERENCE_SERIALIZATION: precondition failed:\n%', array_to_string(v_failures, E'\n')
            using errcode = '55000';
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. The per-storage-key coordination point
--
-- Transaction-scoped advisory lock, released only at COMMIT / ROLLBACK. Same
-- key -> same lock; different keys proceed concurrently. A hash collision
-- makes two keys share one lock: that can only over-serialize (or turn a wait
-- into a detected deadlock), it never lets two operations on the SAME key
-- overlap.
--
-- READ COMMITTED only: after waiting for the lock, the caller's NEXT statement
-- must see what the previous holder committed. Under REPEATABLE READ /
-- SERIALIZABLE the snapshot predates the wait, so the check after the lock
-- could not see the competing commit. Refused, never silently accepted.
-- A NULL key would make the strict lock function a silent no-op: refused too.
-- ---------------------------------------------------------------------------
create function nora_private.lock_attachment_storage_key(p_storage_key text)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
    if p_storage_key is null
       or btrim(p_storage_key) = ''
       or char_length(p_storage_key) > 512 then
        raise exception 'attachment storage key lock: storage key must be non-blank text of at most 512 characters'
            using errcode = '22023', detail = 'NORA_ATTACHMENT_INVALID_ARGUMENT';
    end if;

    if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
        raise exception 'attachment storage key lock: requires READ COMMITTED, the transaction runs %',
                        pg_catalog.current_setting('transaction_isolation')
            using errcode = '55000', detail = 'NORA_ATTACHMENT_READ_COMMITTED_REQUIRED';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('nora_attachment_storage_key'),
        pg_catalog.hashtext(p_storage_key)
    );
end;
$$;

alter function nora_private.lock_attachment_storage_key(text) owner to postgres;

comment on function nora_private.lock_attachment_storage_key(text) is
    'W8-C S3A: the single per-storage-key coordination point of the attachment reference / deletion-intent protocol. Takes pg_advisory_xact_lock(hashtext(''nora_attachment_storage_key''), hashtext(key)) - transaction-scoped, released at commit/rollback. Callers: the admission guard and the capture trigger on public.attachments (AFTER row triggers: attachment row first, then this lock) and nora_private.attachment_deletion_inspect (this lock, then the queue row). Requires READ COMMITTED (55000 NORA_ATTACHMENT_READ_COMMITTED_REQUIRED) because the caller''s next statement must see what the previous holder committed; NULL / blank / > 512 chars raises 22023 NORA_ATTACHMENT_INVALID_ARGUMENT. No API role may execute it.';

revoke all on function nora_private.lock_attachment_storage_key(text) from public;
revoke all on function nora_private.lock_attachment_storage_key(text) from anon;
revoke all on function nora_private.lock_attachment_storage_key(text) from authenticated;
revoke all on function nora_private.lock_attachment_storage_key(text) from service_role;

-- ---------------------------------------------------------------------------
-- 2. Capture (S2A1) - now serialized per storage key
--
-- Unchanged except for the key lock before the enqueue. The trigger itself
-- (AFTER DELETE FOR EACH ROW) is not touched. Because it is an AFTER row
-- trigger, the deleted attachment row is already held when the key lock is
-- requested (lock order: row -> key -> queue).
--
-- With the lock, an inspect that is deciding on this key's active intent
-- either finished before this capture (and its withdrawal is visible to the
-- ON CONFLICT arbiter, so a fresh pending intent is inserted), or it waits
-- until this deletion commits and then observes the key without this
-- reference (LOW-1 closed).
-- ---------------------------------------------------------------------------
create or replace function nora_private.enqueue_attachment_storage_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    -- OLD.storage_key is trusted input: persisted under the S1 invariants and
    -- never supplied by the deleting statement.
    perform nora_private.lock_attachment_storage_key(old.storage_key);

    -- The conflict target is stated EXPLICITLY. A bare `on conflict do nothing`
    -- arbitrates over EVERY unique index including the primary key, so a PK
    -- conflict (possible because `id` is `generated BY DEFAULT as identity`)
    -- would be silently swallowed and the deletion intent lost while the
    -- business DELETE committed. Naming the partial index's columns and
    -- predicate narrows suppression to the one conflict that means "already
    -- captured": duplicate ACTIVE storage_key -> NO-OP; every other insertion
    -- failure propagates and rolls the deletion back. Capture is fail-closed,
    -- and there is deliberately no `exception when others` here.
    insert into nora_private.attachment_storage_deletion_queue (storage_key)
    values (old.storage_key)
    on conflict (storage_key) where state in ('pending', 'claimed', 'failed_retryable')
    do nothing;

    return old;
end;
$$;

alter function nora_private.enqueue_attachment_storage_deletion() owner to postgres;

comment on function nora_private.enqueue_attachment_storage_deletion() is
    'W8-C S2A1: AFTER DELETE row trigger on public.attachments. Captures OLD.storage_key as a pending deletion INTENT in nora_private.attachment_storage_deletion_queue. Database work only - no HTTP, no pg_net, no Storage API, no Edge Function, no network. A repeated intent while an active job exists is a NO-OP; any other failure aborts the deletion (fail-closed capture). W8-C S3A: takes nora_private.lock_attachment_storage_key(OLD.storage_key) before the enqueue, serializing capture with reference admission and with inspect on the same key.';

revoke all on function nora_private.enqueue_attachment_storage_deletion() from public;
revoke all on function nora_private.enqueue_attachment_storage_deletion() from anon;
revoke all on function nora_private.enqueue_attachment_storage_deletion() from authenticated;
revoke all on function nora_private.enqueue_attachment_storage_deletion() from service_role;

-- ---------------------------------------------------------------------------
-- 3. Inspect (S2A2.2) - liveness decision coordinated with reference mutation
--
-- Signature, settings, verdict mapping, lease fencing and error contract are
-- unchanged. New is the ORDER of the first steps:
--
--   1. read the job's storage_key WITHOUT locking the queue row (this read
--      authorizes nothing; storage_key of a queue row is never rewritten),
--   2. take the storage-key lock,
--   3. re-select the job under the full valid-lease rule FOR UPDATE - the
--      authoritative lease check, now under the key lock,
--   4. call the resolver exactly once. Its statement snapshot is taken after
--      the key lock was granted, so every reference deletion / admission on
--      this key has either committed (and is visible) or not started,
--   5. map live / unknown / dead exactly as before.
--
-- A job id that does not exist, or a key/lease mismatch after the lock, is a
-- lost lease (55000 NORA_ATTACHMENT_LEASE_LOST), never success.
-- ---------------------------------------------------------------------------
create or replace function nora_private.attachment_deletion_inspect(
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
    v_lock_key text;
    v_key      text;
    v_verdict  text;
    v_state    text;
    v_rows     integer;
begin
    if p_job_id is null or p_lease_token is null or btrim(p_lease_token) = '' then
        raise exception 'attachment deletion inspect: job id and lease token are required'
            using errcode = '22023', detail = 'NORA_ATTACHMENT_INVALID_ARGUMENT';
    end if;

    -- (1) key only, no row lock: the lease is NOT validated here
    select q.storage_key
      into v_lock_key
      from nora_private.attachment_storage_deletion_queue q
     where q.id = p_job_id;

    if v_lock_key is null then
        raise exception 'attachment deletion lease lost: job % is not held by this lease token', p_job_id
            using errcode = '55000', detail = 'NORA_ATTACHMENT_LEASE_LOST';
    end if;

    -- (2) the per-key coordination point, BEFORE the queue row lock
    perform nora_private.lock_attachment_storage_key(v_lock_key);

    -- (3) the authoritative lease check, under the key lock
    select q.storage_key
      into v_key
      from nora_private.attachment_storage_deletion_queue q
     where q.id = p_job_id
       and q.state = 'claimed'
       and q.claimed_by = p_lease_token
       and q.claimed_at > now() - nora_private.attachment_deletion_lease_ttl()
       and q.storage_key = v_lock_key
       for update;

    if v_key is null then
        raise exception 'attachment deletion lease lost: job % is not held by this lease token', p_job_id
            using errcode = '55000', detail = 'NORA_ATTACHMENT_LEASE_LOST';
    end if;

    -- (4) exactly one liveness observation, taken after the key lock
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
    'W8-C S2A2.2: lease-guarded liveness inspection of a claimed attachment deletion job. Locks the job under the full valid-lease rule, calls nora_private.attachment_storage_key_liveness exactly once and returns (verdict, job_state): live -> skipped_live (intent withdrawn, completed_at set, attempt_count and error history kept); unknown -> attachment_deletion_fail with NORA_ATTACHMENT_LIVENESS_UNKNOWN (retry, or terminal at the budget); dead -> no write, the job stays claimed under the same lease. DEAD is an observation for the lease holder, never a deletion permission, and the lease fences queue mutations only, not an external Storage request. Resolver errors propagate. Lost lease 55000 NORA_ATTACHMENT_LEASE_LOST, invalid arguments 22023 NORA_ATTACHMENT_INVALID_ARGUMENT. postgres only - no API role may execute it. W8-C S3A: reads the job''s storage_key without a row lock, takes nora_private.lock_attachment_storage_key(key), and only then performs the authoritative leased FOR UPDATE and the single resolver call, so the liveness observation cannot race a reference deletion or admission on the same key (LOW-1).';

revoke all on function nora_private.attachment_deletion_inspect(bigint, text) from public;
revoke all on function nora_private.attachment_deletion_inspect(bigint, text) from anon;
revoke all on function nora_private.attachment_deletion_inspect(bigint, text) from authenticated;
revoke all on function nora_private.attachment_deletion_inspect(bigint, text) from service_role;

-- ---------------------------------------------------------------------------
-- 4. Reference admission guard (invariant I1)
--
-- AFTER INSERT FOR EACH ROW on public.attachments: the new row (and its unique
-- index entry) is already held, then the key lock, then the queue is read with
-- a statement snapshot taken after the lock. An intent in pending / claimed
-- (valid or expired lease) / failed_retryable, or a done tombstone, rejects
-- the whole INSERT. Historical-only rows (the two other terminal states) and
-- no row at all admit the reference.
--
-- The job is never modified here: no withdrawal, no cancel, no new state.
-- SECURITY DEFINER because the inserting role holds nothing on the private
-- queue; row_security = off so that any future RLS drift on the queue raises
-- instead of hiding an intent (a hidden intent would be a false admission).
-- The error message deliberately names no storage key.
-- ---------------------------------------------------------------------------
create function nora_private.guard_attachment_reference_admission()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
    perform nora_private.lock_attachment_storage_key(new.storage_key);

    if exists (select 1
                 from nora_private.attachment_storage_deletion_queue q
                where q.storage_key = new.storage_key
                  and q.state in ('pending', 'claimed', 'failed_retryable', 'done')) then
        raise exception 'attachment reference rejected: the storage object has a deletion intent or was confirmed deleted'
            using errcode = '55000', detail = 'NORA_ATTACHMENT_STORAGE_KEY_PENDING_DELETION';
    end if;

    return null;
end;
$$;

alter function nora_private.guard_attachment_reference_admission() owner to postgres;

comment on function nora_private.guard_attachment_reference_admission() is
    'W8-C S3A: AFTER INSERT row trigger on public.attachments enforcing reference admission (I1): a new reference to storage key K must not commit while K has an ACTIVE deletion intent (pending, claimed incl. an expired lease, failed_retryable) or a done tombstone. Takes nora_private.lock_attachment_storage_key(NEW.storage_key) first (row -> key -> queue), then reads the queue with a post-lock snapshot. Rejection: 55000 NORA_ATTACHMENT_STORAGE_KEY_PENDING_DELETION; the queue row is never modified. Database work only. No API role may execute it.';

revoke all on function nora_private.guard_attachment_reference_admission() from public;
revoke all on function nora_private.guard_attachment_reference_admission() from anon;
revoke all on function nora_private.guard_attachment_reference_admission() from authenticated;
revoke all on function nora_private.guard_attachment_reference_admission() from service_role;

create trigger guard_attachment_reference_admission_after_insert_trigger
    after insert on public.attachments
    for each row execute function nora_private.guard_attachment_reference_admission();

-- ---------------------------------------------------------------------------
-- 5. storage_key is immutable
--
-- Rewriting storage_key would move a reference from one object to another
-- without capture and without admission. No API role holds UPDATE; this
-- protects owner / manual paths too. Same-value updates and updates of other
-- columns (e.g. the FK ON UPDATE CASCADE of a note id) are unaffected.
-- ---------------------------------------------------------------------------
create function nora_private.guard_attachment_storage_key_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    if new.storage_key is distinct from old.storage_key then
        raise exception 'public.attachments.storage_key is immutable - remove the reference and create a new one instead'
            using errcode = '55000', detail = 'NORA_ATTACHMENT_STORAGE_KEY_IMMUTABLE';
    end if;

    return new;
end;
$$;

alter function nora_private.guard_attachment_storage_key_immutable() owner to postgres;

comment on function nora_private.guard_attachment_storage_key_immutable() is
    'W8-C S3A: BEFORE UPDATE row trigger on public.attachments. storage_key is an immutable identity: any change raises 55000 NORA_ATTACHMENT_STORAGE_KEY_IMMUTABLE. A logical move is DELETE + INSERT and therefore goes through capture and reference admission. Same-value updates and other columns are unaffected. No API role may execute it.';

revoke all on function nora_private.guard_attachment_storage_key_immutable() from public;
revoke all on function nora_private.guard_attachment_storage_key_immutable() from anon;
revoke all on function nora_private.guard_attachment_storage_key_immutable() from authenticated;
revoke all on function nora_private.guard_attachment_storage_key_immutable() from service_role;

create trigger guard_attachment_storage_key_immutable_before_update_trigger
    before update on public.attachments
    for each row
    when (old.storage_key is distinct from new.storage_key)
    execute function nora_private.guard_attachment_storage_key_immutable();

-- ---------------------------------------------------------------------------
-- 6. Single-writer preparation: no direct API write on public.attachments
--
-- S1 granted INSERT / DELETE (can_write) for a future direct application
-- writer. S3 chose a database-owned writer instead (S3B projection). A direct
-- row DELETE would let the table diverge from the note JSON and capture an
-- intent for a key that is still live in the JSON; a direct INSERT would
-- create references the JSON does not know. SELECT (is_active_user) stays.
-- FK cascades are unaffected: referential actions run as the table owner.
-- ---------------------------------------------------------------------------
drop policy "attachments_insert_writer" on public.attachments;
drop policy "attachments_delete_writer" on public.attachments;

revoke all on table public.attachments from anon, authenticated, service_role;
grant select on table public.attachments to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Postconditions (fail-closed, inert: no function is invoked, no queue or
--    attachment row is written)
-- ---------------------------------------------------------------------------
do $$
declare
    r           record;
    v_role      text;
    v_priv      text;
    v_failures  text[] := '{}';
    v_src       text;
    v_names     text;
    v_literals  text[];
    v_all_privs text[] := case when current_setting('server_version_num')::int >= 170000
                               then array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']
                               else array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']
                          end;
    v_forbidden text;
begin
    -- 7a. function shape, security settings, owner-only ACL, no API EXECUTE
    for r in
        select * from (values
            ('nora_private.lock_attachment_storage_key(text)',              'void',    false, 'v', array['search_path=""']),
            ('nora_private.enqueue_attachment_storage_deletion()',          'trigger', true,  'v', array['search_path=""']),
            ('nora_private.attachment_deletion_inspect(bigint,text)',       'record',  false, 'v', array['search_path=""', 'row_security=off']),
            ('nora_private.guard_attachment_reference_admission()',         'trigger', true,  'v', array['search_path=""', 'row_security=off']),
            ('nora_private.guard_attachment_storage_key_immutable()',       'trigger', false, 'v', array['search_path=""'])
        ) as t(sig, rettype, secdef, vol, config)
    loop
        if to_regprocedure(r.sig) is null then
            v_failures := v_failures || format('%s is missing', r.sig);
            continue;
        end if;
        if not exists (select 1 from pg_proc p join pg_language l on l.oid = p.prolang
                       where p.oid = to_regprocedure(r.sig)
                         and p.prorettype = r.rettype::regtype
                         and l.lanname = 'plpgsql'
                         and p.provolatile = r.vol
                         and p.prosecdef = r.secdef
                         and pg_get_userbyid(p.proowner) = 'postgres'
                         and p.proconfig = r.config) then
            v_failures := v_failures || format('%s is not %s / plpgsql / %s / definer=%s / owner postgres / %s',
                r.sig, r.rettype, r.vol, r.secdef, r.config);
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
        -- database work only
        select p.prosrc into v_src from pg_proc p where p.oid = to_regprocedure(r.sig);
        foreach v_forbidden in array array['net.http', 'pg_net', 'http_post', 'http_get', 'storage.objects',
                                           'storage.buckets', 'functions/v1', 'supabase.co', 'dblink', 'pg_background'] loop
            if position(v_forbidden in v_src) > 0 then
                v_failures := v_failures || format('%s references %s', r.sig, v_forbidden);
            end if;
        end loop;
    end loop;

    -- 7b. the lock helper: transaction-scoped, the namespaced key, RC assertion
    select p.prosrc into v_src from pg_proc p where p.oid = to_regprocedure('nora_private.lock_attachment_storage_key(text)');
    if position('pg_advisory_xact_lock(' in v_src) = 0
       or v_src ~* 'pg_advisory_lock\s*\(|pg_advisory_lock_shared|pg_try_advisory|pg_advisory_unlock'
       or position('hashtext(''nora_attachment_storage_key'')' in v_src) = 0
       or position('hashtext(p_storage_key)' in v_src) = 0
       or position('transaction_isolation' in v_src) = 0
       or position('NORA_ATTACHMENT_READ_COMMITTED_REQUIRED' in v_src) = 0 then
        v_failures := array_append(v_failures, 'the lock helper is not the transaction-scoped, namespaced, READ COMMITTED-only key lock');
    end if;

    -- 7c. capture: key lock strictly before the enqueue, enqueue unchanged
    select p.prosrc into v_src from pg_proc p where p.oid = to_regprocedure('nora_private.enqueue_attachment_storage_deletion()');
    if position('nora_private.lock_attachment_storage_key(old.storage_key)' in v_src) = 0
       or position('nora_private.lock_attachment_storage_key(old.storage_key)' in v_src)
          > position('insert into nora_private.attachment_storage_deletion_queue' in v_src)
       or position('on conflict (storage_key) where state in (''pending'', ''claimed'', ''failed_retryable'')' in v_src) = 0
       or v_src ~* E'\\n[ \\t]*exception[ \\t]*\\n' then
        v_failures := array_append(v_failures, 'capture does not take the key lock before its unchanged, fail-closed enqueue');
    end if;

    -- 7d. inspect: key lock before the authoritative FOR UPDATE, resolver once
    select p.prosrc into v_src from pg_proc p where p.oid = to_regprocedure('nora_private.attachment_deletion_inspect(bigint,text)');
    if (select count(*) from regexp_matches(v_src, 'lock_attachment_storage_key\(', 'g')) <> 1
       or position('nora_private.lock_attachment_storage_key(v_lock_key)' in v_src) = 0
       or position('nora_private.lock_attachment_storage_key(v_lock_key)' in v_src) > position('for update' in v_src)
       or (select count(*) from regexp_matches(v_src, 'for update', 'g')) <> 1
       or (select count(*) from regexp_matches(v_src, 'attachment_storage_key_liveness\(', 'g')) <> 1
       or position('nora_private.attachment_storage_key_liveness(v_key)' in v_src) < position('for update' in v_src) then
        v_failures := array_append(v_failures, 'inspect does not take the key lock before its single leased FOR UPDATE and single resolver call');
    end if;

    -- 7e. admission guard: key lock, then exactly the active + done predicate
    select p.prosrc into v_src from pg_proc p where p.oid = to_regprocedure('nora_private.guard_attachment_reference_admission()');
    select array_agg(m[1] order by m[1]) into v_literals
      from regexp_matches(v_src, 'q\.state in \(([^)]*)\)', 'g') as mm(m0),
           lateral regexp_matches(mm.m0[1], '''([a-z_]+)''', 'g') as m;
    if v_literals is distinct from array['claimed','done','failed_retryable','pending']
       or position('nora_private.lock_attachment_storage_key(new.storage_key)' in v_src) = 0
       or position('nora_private.lock_attachment_storage_key(new.storage_key)' in v_src)
          > position('from nora_private.attachment_storage_deletion_queue' in v_src)
       or position('NORA_ATTACHMENT_STORAGE_KEY_PENDING_DELETION' in v_src) = 0
       or v_src ~* '\m(update|insert|delete)\s' then
        v_failures := array_append(v_failures, 'the admission guard is not lock -> read-only check of exactly pending/claimed/failed_retryable/done');
    end if;

    -- 7f. triggers on public.attachments: exactly the three agreed hooks
    select string_agg(t.tgname, ', ' order by t.tgname) into v_names
    from pg_trigger t where t.tgrelid = 'public.attachments'::regclass and not t.tgisinternal;
    if v_names is distinct from 'enqueue_attachment_storage_deletion_after_delete_trigger, '
                             || 'guard_attachment_reference_admission_after_insert_trigger, '
                             || 'guard_attachment_storage_key_immutable_before_update_trigger' then
        v_failures := v_failures || format('public.attachments triggers are not the S3A set: %s', coalesce(v_names, '<none>'));
    end if;
    for r in
        select * from (values
            -- tgtype bits: 1 ROW, 2 BEFORE, 4 INSERT, 8 DELETE, 16 UPDATE
            ('enqueue_attachment_storage_deletion_after_delete_trigger',     'nora_private.enqueue_attachment_storage_deletion()',     9,  false),
            ('guard_attachment_reference_admission_after_insert_trigger',    'nora_private.guard_attachment_reference_admission()',    5,  false),
            ('guard_attachment_storage_key_immutable_before_update_trigger', 'nora_private.guard_attachment_storage_key_immutable()',  19, true)
        ) as t(tg, fn, tgtype, has_when)
    loop
        if not exists (select 1 from pg_trigger t
                       where t.tgrelid = 'public.attachments'::regclass and t.tgname = r.tg
                         and t.tgfoid = to_regprocedure(r.fn)
                         and (t.tgtype & 31) = r.tgtype
                         and t.tgenabled = 'O'
                         and (t.tgqual is not null) = r.has_when) then
            v_failures := v_failures || format('trigger %s is not the expected %s hook', r.tg, r.fn);
        end if;
    end loop;
    if (select pg_get_triggerdef(t.oid) from pg_trigger t
        where t.tgrelid = 'public.attachments'::regclass
          and t.tgname = 'guard_attachment_storage_key_immutable_before_update_trigger')
       not ilike '%WHEN ((old.storage_key IS DISTINCT FROM new.storage_key))%' then
        v_failures := array_append(v_failures, 'the immutability trigger does not fire exactly on a storage_key change');
    end if;
    if (select count(*) from pg_trigger t
        where t.tgrelid = 'public.attachments'::regclass and not t.tgisinternal and t.tgenabled <> 'O') > 0 then
        v_failures := array_append(v_failures, 'a trigger on public.attachments is disabled or not ORIGIN-enabled');
    end if;

    -- 7g. access: authenticated SELECT only, anon / service_role nothing, one policy
    for r in
        select * from (values ('authenticated', 'SELECT'), ('anon', ''), ('service_role', '')) as t(grantee, privs)
    loop
        foreach v_priv in array v_all_privs loop
            if has_table_privilege(r.grantee, 'public.attachments', v_priv)
               is distinct from (v_priv = any (string_to_array(r.privs, ','))) then
                v_failures := v_failures || format('%s %s on public.attachments: expected %s',
                    r.grantee, v_priv, (v_priv = any (string_to_array(r.privs, ','))));
            end if;
        end loop;
    end loop;
    select string_agg(format('%s/%s/%s/%s/%s', p.policyname, p.cmd, p.roles::text,
                             coalesce(p.qual, '-'), coalesce(p.with_check, '-')), ' | ' order by p.policyname)
      into v_names
    from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'attachments';
    if v_names is distinct from 'attachments_select_active_user/SELECT/{authenticated}/nora_private.is_active_user()/-' then
        v_failures := v_failures || format('public.attachments policies are not exactly the SELECT policy: %s', coalesce(v_names, '<none>'));
    end if;
    if not (select c.relrowsecurity from pg_class c where c.oid = 'public.attachments'::regclass) then
        v_failures := array_append(v_failures, 'row level security is not enabled on public.attachments');
    end if;

    -- 7h. the queue contract is untouched
    if (select count(*) from pg_constraint con
        where con.conrelid = 'nora_private.attachment_storage_deletion_queue'::regclass and con.contype = 'c') <> 6
       or (select array_agg(m[1] order by m[1])
             from pg_constraint con,
                  lateral regexp_matches(pg_get_constraintdef(con.oid), '''([a-z_]+)''::text', 'g') as m
            where con.conrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
              and con.conname = 'attachment_storage_deletion_queue_state_check')
          is distinct from array['claimed','done','failed_retryable','failed_terminal','pending','skipped_live'] then
        v_failures := array_append(v_failures, 'the queue constraints / six-state vocabulary changed');
    end if;
    foreach v_role in array array['anon','authenticated','service_role'] loop
        foreach v_priv in array v_all_privs loop
            if has_table_privilege(v_role, 'nora_private.attachment_storage_deletion_queue', v_priv) then
                v_failures := v_failures || format('%s holds %s on the queue', v_role, v_priv);
            end if;
        end loop;
    end loop;

    -- 7i. no done writer, no ack / completion / worker function, nothing public
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname in ('public', 'nora_private')
                 and p.prosrc like '%attachment_storage_deletion_queue%'
                 and p.prosrc ~* 'state\s*=\s*''done''') then
        v_failures := array_append(v_failures, 'a function writes state = done');
    end if;
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname in ('public', 'nora_private')
                 and p.proname ~* 'attachment.*(ack|complete|done|requeue|drain|worker)') then
        v_failures := array_append(v_failures, 'an ack / completion / requeue / worker function exists - that is S2B');
    end if;
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public'
                 and (p.prosrc like '%attachment_storage_deletion_queue%' or p.prosrc like '%lock_attachment_storage_key%')) then
        v_failures := array_append(v_failures, 'a public (API-exposed) function references the queue or the key lock');
    end if;

    -- 7j. I1 holds (read-only)
    if exists (select 1 from public.attachments a
               join nora_private.attachment_storage_deletion_queue q on q.storage_key = a.storage_key
               where q.state in ('pending', 'claimed', 'failed_retryable', 'done')) then
        v_failures := array_append(v_failures, 'I1 violated after the migration');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'NORA_ATTACHMENT_REFERENCE_SERIALIZATION aborted:\n%', array_to_string(v_failures, E'\n');
    end if;

    raise notice 'NORA_ATTACHMENT_REFERENCE_SERIALIZATION: key lock + serialized capture/inspect + admission guard + storage_key immutability installed, public.attachments is SELECT-only for authenticated (pg %)',
        current_setting('server_version_num');
end;
$$;

notify pgrst, 'reload schema';
