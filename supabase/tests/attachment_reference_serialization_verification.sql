-- Nora W8-C S3A — storage-key serialization & reference admission guard:
-- database contract verification
--
-- Self-contained and rollback-safe: every fixture is created inside a DO block
-- that terminates with ROLLBACK_W8C_S3A_TEST (or inside an explicit
-- transaction that is rolled back). Safe at any point after a fresh
-- `npx supabase db reset --local`, outside the RBAC setup -> teardown window
-- (21-agent-runbooks.md section 5): the owner-only ACL assertions would
-- otherwise see the test role's EXECUTE grants.
--
-- Usage (local only):
--   docker exec -i supabase_db_atomic-crm-demo psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/attachment_reference_serialization_verification.sql
--
-- What it proves (single session; the real two-session races are in
-- attachment_reference_serialization_concurrency_runner.ps1):
--   1. shape: the lock helper, the rewritten capture and inspect, the two
--      guards - owner postgres, exact settings, owner-only ACL, no API EXECUTE,
--      no network / Storage reference; the lock is transaction-scoped and
--      namespaced; capture / inspect take it at the agreed point; inspect still
--      calls the resolver exactly once; exactly three triggers on
--      public.attachments; queue vocabulary untouched; no done writer
--   2. API boundary: no API role can call the lock helper (real call -> 42501)
--   3. lock helper behaviour: the exact advisory lock (namespace + key hash),
--      re-entrant, per key, released at COMMIT (transaction-scoped, proven
--      across two statements), invalid keys -> 22023 NORA_ATTACHMENT_INVALID_ARGUMENT
--   4. READ COMMITTED contract: under REPEATABLE READ and SERIALIZABLE the
--      helper AND the protected paths (admission, capture) fail closed with
--      55000 NORA_ATTACHMENT_READ_COMMITTED_REQUIRED
--   5. admission state matrix (I1): pending / claimed / claimed with an
--      expired lease / failed_retryable / done -> REJECT; skipped_live /
--      failed_terminal / no queue row -> ALLOW; the job is never modified; a
--      multi-row INSERT is rejected as a whole; the message names no key
--   6. participation: admission, capture and inspect each hold the key lock of
--      exactly their key in their own transaction; inspect on an unknown job or
--      a wrong token is a lost lease
--   7. storage_key immutability: A -> B rejected, A -> A and other columns
--      harmless, the note-id FK ON UPDATE CASCADE still works, a logical move
--      (DELETE + INSERT) goes through capture + admission
--   8. access: authenticated SELECT only - INSERT / UPDATE / DELETE denied by
--      the table privilege for admin, office and service_role; anon nothing
--   9. cascades: note, contact and company deletes capture every row; a
--      200-key company cascade captures 200 intents and holds 200 key locks
--  10. I1 holds and nothing leaked
--
-- NOT proven here: real concurrency (see the runner), S3B projection, physical
-- deletion (S2B). S3A adds no worker, no Storage call and no path to done.

\set ON_ERROR_STOP on

\echo '=== W8-C S3A: attachment reference serialization verification ==='

-- ---------------------------------------------------------------------------
-- 1. Shape and hygiene
-- ---------------------------------------------------------------------------
do $$
declare
    r           record;
    v_role      text;
    v_src       text;
    v_names     text;
    v_literals  text[];
    v_forbidden text;
    v_failures  text[] := '{}';
begin
    for r in
        select * from (values
            ('nora_private.lock_attachment_storage_key(text)',              'void',    false, array['search_path=""']),
            ('nora_private.enqueue_attachment_storage_deletion()',          'trigger', true,  array['search_path=""']),
            ('nora_private.attachment_deletion_inspect(bigint,text)',       'record',  false, array['search_path=""', 'row_security=off']),
            ('nora_private.guard_attachment_reference_admission()',         'trigger', true,  array['search_path=""', 'row_security=off']),
            ('nora_private.guard_attachment_storage_key_immutable()',       'trigger', false, array['search_path=""'])
        ) as t(sig, rettype, secdef, config)
    loop
        if to_regprocedure(r.sig) is null then
            v_failures := v_failures || format('%s is missing', r.sig);
            continue;
        end if;
        if not exists (select 1 from pg_proc p join pg_language l on l.oid = p.prolang
                       join pg_namespace n on n.oid = p.pronamespace
                       where p.oid = to_regprocedure(r.sig)
                         and n.nspname = 'nora_private'
                         and p.prorettype = r.rettype::regtype
                         and l.lanname = 'plpgsql'
                         and p.provolatile = 'v'
                         and p.prosecdef = r.secdef
                         and pg_get_userbyid(p.proowner) = 'postgres'
                         and p.proconfig = r.config) then
            v_failures := v_failures || format('1a %s: wrong return type / language / volatility / definer / owner / settings', r.sig);
        end if;
        if (select p.proacl is null from pg_proc p where p.oid = to_regprocedure(r.sig))
           or exists (select 1 from pg_proc p, aclexplode(p.proacl) acl
                      where p.oid = to_regprocedure(r.sig)
                        and (acl.grantee = 0 or pg_get_userbyid(acl.grantee) <> 'postgres')) then
            v_failures := v_failures || format('1a %s carries an ACL entry for a role other than postgres', r.sig);
        end if;
        foreach v_role in array array['public','anon','authenticated','service_role'] loop
            if has_function_privilege(v_role, r.sig, 'EXECUTE') then
                v_failures := v_failures || format('1a %s holds EXECUTE on %s', v_role, r.sig);
            end if;
        end loop;
        select p.prosrc into v_src from pg_proc p where p.oid = to_regprocedure(r.sig);
        foreach v_forbidden in array array['net.http', 'pg_net', 'http_post', 'http_get', 'storage.objects',
                                           'storage.buckets', 'functions/v1', 'supabase.co', 'dblink',
                                           'pg_background', 'execute '] loop
            if position(v_forbidden in lower(v_src)) > 0 then
                v_failures := v_failures || format('1a %s references %s', r.sig, v_forbidden);
            end if;
        end loop;
    end loop;

    -- 1b. the lock: transaction-scoped, namespaced, READ COMMITTED only
    select p.prosrc into v_src from pg_proc p where p.oid = to_regprocedure('nora_private.lock_attachment_storage_key(text)');
    if (select count(*) from regexp_matches(v_src, 'pg_advisory_xact_lock\(', 'g')) <> 1
       or v_src ~* 'pg_advisory_lock\s*\(|pg_advisory_lock_shared|pg_try_advisory|pg_advisory_unlock|pg_advisory_xact_lock_shared'
       or position('pg_catalog.hashtext(''nora_attachment_storage_key'')' in v_src) = 0
       or position('pg_catalog.hashtext(p_storage_key)' in v_src) = 0
       or position('transaction_isolation' in v_src) = 0 then
        v_failures := array_append(v_failures, '1b the lock helper is not the transaction-scoped, namespaced, READ COMMITTED-only key lock');
    end if;

    -- 1c. capture: the key lock strictly before the unchanged enqueue
    select p.prosrc into v_src from pg_proc p where p.oid = to_regprocedure('nora_private.enqueue_attachment_storage_deletion()');
    if (select count(*) from regexp_matches(v_src, 'lock_attachment_storage_key\(', 'g')) <> 1
       or position('nora_private.lock_attachment_storage_key(old.storage_key)' in v_src)
          >= position('insert into nora_private.attachment_storage_deletion_queue' in v_src)
       or position('on conflict (storage_key) where state in (''pending'', ''claimed'', ''failed_retryable'')' in v_src) = 0 then
        v_failures := array_append(v_failures, '1c capture does not take the key lock once, before its unchanged enqueue');
    end if;

    -- 1d. inspect: key read -> key lock -> single leased FOR UPDATE -> single resolver call
    select p.prosrc into v_src from pg_proc p where p.oid = to_regprocedure('nora_private.attachment_deletion_inspect(bigint,text)');
    if (select count(*) from regexp_matches(v_src, 'lock_attachment_storage_key\(', 'g')) <> 1
       or (select count(*) from regexp_matches(v_src, 'for update', 'g')) <> 1
       or (select count(*) from regexp_matches(v_src, 'attachment_storage_key_liveness\(', 'g')) <> 1
       or not (position('nora_private.lock_attachment_storage_key(v_lock_key)' in v_src) > 0
               and position('nora_private.lock_attachment_storage_key(v_lock_key)' in v_src) < position('for update' in v_src)
               and position('for update' in v_src) < position('nora_private.attachment_storage_key_liveness(v_key)' in v_src))
       or position('nora_private.attachment_deletion_lease_ttl()' in v_src) = 0 then
        v_failures := array_append(v_failures, '1d inspect is not key lock -> leased FOR UPDATE -> one resolver call');
    end if;

    -- 1e. admission: the key lock, then a read-only check of exactly active + done
    select p.prosrc into v_src from pg_proc p where p.oid = to_regprocedure('nora_private.guard_attachment_reference_admission()');
    select array_agg(m[1] order by m[1]) into v_literals
      from regexp_matches(v_src, 'q\.state in \(([^)]*)\)', 'g') as mm(m0),
           lateral regexp_matches(mm.m0[1], '''([a-z_]+)''', 'g') as m;
    if v_literals is distinct from array['claimed','done','failed_retryable','pending']
       or position('nora_private.lock_attachment_storage_key(new.storage_key)' in v_src) = 0
       or position('nora_private.lock_attachment_storage_key(new.storage_key)' in v_src)
          > position('from nora_private.attachment_storage_deletion_queue' in v_src)
       or v_src ~* '\m(update|insert|delete)\s'
       or position('NORA_ATTACHMENT_STORAGE_KEY_PENDING_DELETION' in v_src) = 0 then
        v_failures := array_append(v_failures, '1e admission is not lock -> read-only check of exactly pending/claimed/failed_retryable/done');
    end if;

    -- 1f. exactly three triggers on public.attachments, each on its function
    select string_agg(format('%s:%s:%s', t.tgname, t.tgfoid::regprocedure, t.tgtype & 31), ', ' order by t.tgname)
      into v_names
    from pg_trigger t where t.tgrelid = 'public.attachments'::regclass and not t.tgisinternal;
    if v_names is distinct from
           'enqueue_attachment_storage_deletion_after_delete_trigger:nora_private.enqueue_attachment_storage_deletion():9, '
        || 'guard_attachment_reference_admission_after_insert_trigger:nora_private.guard_attachment_reference_admission():5, '
        || 'guard_attachment_storage_key_immutable_before_update_trigger:nora_private.guard_attachment_storage_key_immutable():19' then
        v_failures := v_failures || format('1f trigger set on public.attachments: %s', coalesce(v_names, '<none>'));
    end if;
    if exists (select 1 from pg_trigger t where t.tgrelid = 'public.attachments'::regclass
               and not t.tgisinternal and t.tgenabled <> 'O') then
        v_failures := array_append(v_failures, '1f a trigger on public.attachments is not enabled');
    end if;

    -- 1g. no trigger projects note JSON (that is S3B, not S3A)
    if exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
               where t.tgrelid in ('public.contact_notes'::regclass, 'public.deal_notes'::regclass)
                 and not t.tgisinternal and p.prosrc like '%public.attachments%') then
        v_failures := array_append(v_failures, '1g a note trigger writes public.attachments - S3B projection must not exist in S3A');
    end if;

    -- 1h. queue contract untouched; no done writer; no worker-like function
    if (select array_agg(m[1] order by m[1])
          from pg_constraint con,
               lateral regexp_matches(pg_get_constraintdef(con.oid), '''([a-z_]+)''::text', 'g') as m
         where con.conrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
           and con.conname = 'attachment_storage_deletion_queue_state_check')
       is distinct from array['claimed','done','failed_retryable','failed_terminal','pending','skipped_live'] then
        v_failures := array_append(v_failures, '1h the six-state vocabulary changed');
    end if;
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname in ('public', 'nora_private')
                 and p.prosrc like '%attachment_storage_deletion_queue%'
                 and p.prosrc ~* 'state\s*=\s*''done''') then
        v_failures := array_append(v_failures, '1h a function writes state = done');
    end if;
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname in ('public', 'nora_private')
                 and p.proname ~* 'attachment.*(ack|complete|done|requeue|drain|worker)') then
        v_failures := array_append(v_failures, '1h an ack / completion / worker function exists');
    end if;
    select array_agg(n.nspname || '.' || p.proname order by p.proname) into v_literals
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'nora_private') and p.prosrc like '%skipped_live%';
    if v_literals is distinct from array['nora_private.attachment_deletion_inspect'] then
        v_failures := v_failures || format('1h skipped_live is referenced by %s, expected only inspect', v_literals);
    end if;
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public'
                 and (p.prosrc like '%attachment_storage_deletion_queue%' or p.prosrc like '%lock_attachment_storage_key%')) then
        v_failures := array_append(v_failures, '1h a public (API-exposed) function references the queue or the key lock');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (shape):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  1. shape: five functions owner postgres / exact settings / owner-only ACL / no API EXECUTE / no network; xact-scoped namespaced lock; capture + inspect + admission take it at the agreed point; resolver once; three triggers; queue untouched; no done writer';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. API boundary: no API role can call the lock helper
-- ---------------------------------------------------------------------------
do $$
declare
    v_role     text;
    v_state    text;
    v_failures text[] := '{}';
begin
    foreach v_role in array array['anon','authenticated','service_role'] loop
        v_state := 'no error';
        begin
            execute format('set local role %I', v_role);
            perform nora_private.lock_attachment_storage_key('s3a-api.pdf');
        exception when others then
            v_state := sqlstate;
        end;
        reset role;
        if v_state <> '42501' then
            v_failures := v_failures || format('%s calling the lock helper -> %s, expected 42501', v_role, v_state);
        end if;
    end loop;
    if exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()) then
        v_failures := array_append(v_failures, 'a denied call left an advisory lock behind');
    end if;
    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (API boundary):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  2. API boundary: anon / authenticated / service_role cannot call the lock helper (42501)';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Lock helper behaviour
-- ---------------------------------------------------------------------------
do $$
declare
    v_ns       bigint := hashtext('nora_attachment_storage_key')::bigint & 4294967295;
    v_n        bigint;
    v_key      text;
    v_state    text;
    v_detail   text;
    v_failures text[] := '{}';
begin
    perform nora_private.lock_attachment_storage_key('s3a-lock-a.pdf');
    select count(*) into v_n from pg_locks
     where locktype = 'advisory' and pid = pg_backend_pid() and granted and mode = 'ExclusiveLock'
       and objsubid = 2 and classid::bigint = v_ns
       and objid::bigint = (hashtext('s3a-lock-a.pdf')::bigint & 4294967295);
    if v_n <> 1 then
        v_failures := v_failures || format('3a the exact namespaced key lock is not held (%s)', v_n);
    end if;

    -- re-entrant in the same transaction, one lock-table entry per key
    perform nora_private.lock_attachment_storage_key('s3a-lock-a.pdf');
    perform nora_private.lock_attachment_storage_key('s3a-lock-b.pdf');
    select count(*) into v_n from pg_locks
     where locktype = 'advisory' and pid = pg_backend_pid() and classid::bigint = v_ns;
    if v_n <> 2 then
        v_failures := v_failures || format('3b expected 2 distinct key locks, got %s', v_n);
    end if;

    -- exact key: a padded key is a different key (never trimmed)
    if (hashtext(' s3a-lock-a.pdf ') = hashtext('s3a-lock-a.pdf')) then
        v_failures := array_append(v_failures, '3c padded and trimmed key share a hash - pick another probe');
    end if;

    foreach v_key in array array[null, '', '   ', repeat('k', 513)] loop
        v_state := 'no error'; v_detail := null;
        begin
            perform nora_private.lock_attachment_storage_key(v_key);
        exception when others then
            get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
        end;
        if v_state <> '22023' or v_detail is distinct from 'NORA_ATTACHMENT_INVALID_ARGUMENT' then
            v_failures := v_failures || format('3d key %s -> %s %s, expected 22023 NORA_ATTACHMENT_INVALID_ARGUMENT',
                coalesce(quote_literal(left(v_key, 20)), 'NULL'), v_state, coalesce(v_detail, ''));
        end if;
    end loop;
    perform nora_private.lock_attachment_storage_key(repeat('k', 512));

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (lock helper):\n%', array_to_string(v_failures, E'\n');
    end if;
end;
$$;

-- 3e. transaction scope, proven across statements: the previous DO block's
-- transaction has committed, so its key locks must be gone.
select nora_private.lock_attachment_storage_key('s3a-lock-xact.pdf');
do $$
begin
    if exists (select 1 from pg_locks
               where locktype = 'advisory' and pid = pg_backend_pid()
                 and classid::bigint = (hashtext('nora_attachment_storage_key')::bigint & 4294967295)) then
        raise exception 'FAIL (lock helper): a key lock survived its transaction - the lock is not transaction-scoped';
    end if;
    raise notice 'OK  3. lock helper: exact namespaced advisory lock, re-entrant, per key, released at commit (xact-scoped), invalid keys -> 22023, 512 chars valid';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. READ COMMITTED contract: the helper and the protected paths fail closed
-- ---------------------------------------------------------------------------
begin isolation level repeatable read;
do $$
declare
    v_company bigint; v_contact bigint; v_cnote bigint; v_a bigint;
    v_state text; v_detail text;
    v_failures text[] := '{}';
begin
    v_state := 'no error'; v_detail := null;
    begin
        perform nora_private.lock_attachment_storage_key('s3a-rr.pdf');
    exception when others then
        get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
    end;
    if v_state <> '55000' or v_detail is distinct from 'NORA_ATTACHMENT_READ_COMMITTED_REQUIRED' then
        v_failures := v_failures || format('4a RR helper -> %s %s', v_state, coalesce(v_detail, ''));
    end if;

    insert into public.companies (name) values ('W8-C S3A RR') returning id into v_company;
    insert into public.contacts (first_name, last_name, company_id) values ('R', 'R', v_company) returning id into v_contact;
    insert into public.contact_notes (contact_id, text) values (v_contact, 'rr') returning id into v_cnote;

    -- admission under RR fails closed (the whole INSERT)
    v_state := 'no error'; v_detail := null;
    begin
        insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
            values (v_cnote, 's3a-rr.pdf', 'rr.pdf', 'application/pdf');
    exception when others then
        get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
    end;
    if v_state <> '55000' or v_detail is distinct from 'NORA_ATTACHMENT_READ_COMMITTED_REQUIRED'
       or exists (select 1 from public.attachments where storage_key = 's3a-rr.pdf') then
        v_failures := v_failures || format('4b RR admission -> %s %s', v_state, coalesce(v_detail, ''));
    end if;

    -- capture under RR fails closed: the note delete rolls back as a whole
    alter table public.attachments disable trigger guard_attachment_reference_admission_after_insert_trigger;
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
        values (v_cnote, 's3a-rr-cap.pdf', 'rr.pdf', 'application/pdf') returning id into v_a;
    alter table public.attachments enable trigger guard_attachment_reference_admission_after_insert_trigger;
    v_state := 'no error'; v_detail := null;
    begin
        delete from public.contact_notes where id = v_cnote;
    exception when others then
        get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
    end;
    if v_state <> '55000' or v_detail is distinct from 'NORA_ATTACHMENT_READ_COMMITTED_REQUIRED'
       or not exists (select 1 from public.attachments where id = v_a)
       or not exists (select 1 from public.contact_notes where id = v_cnote) then
        v_failures := v_failures || format('4c RR capture (note delete) -> %s %s', v_state, coalesce(v_detail, ''));
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (READ COMMITTED contract, repeatable read):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  4a. REPEATABLE READ: helper, admission and capture fail closed (55000 NORA_ATTACHMENT_READ_COMMITTED_REQUIRED), nothing written';
end;
$$;
rollback;

begin isolation level serializable;
do $$
declare
    v_state text; v_detail text;
begin
    v_state := 'no error';
    begin
        perform nora_private.lock_attachment_storage_key('s3a-ser.pdf');
    exception when others then
        get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
    end;
    if v_state <> '55000' or v_detail is distinct from 'NORA_ATTACHMENT_READ_COMMITTED_REQUIRED' then
        raise exception 'FAIL (READ COMMITTED contract): SERIALIZABLE helper -> % %', v_state, coalesce(v_detail, '');
    end if;
    raise notice 'OK  4b. SERIALIZABLE: helper fails closed';
end;
$$;
rollback;

-- ---------------------------------------------------------------------------
-- 5.–9. Behaviour (as postgres unless stated, everything rolled back)
-- ---------------------------------------------------------------------------
do $$
declare
    v_ns       bigint := hashtext('nora_attachment_storage_key')::bigint & 4294967295;
    r          record;
    v_company  bigint; v_contact bigint; v_deal bigint;
    v_cnote    bigint; v_cnote2 bigint; v_dnote bigint;
    v_a        bigint; v_b bigint; v_job bigint;
    v_n        bigint;
    v_state    text; v_detail text; v_msg text;
    v_before   text; v_after text;
    v_tok      text;
    v_failures text[] := '{}';
begin
    insert into public.companies (name) values ('W8-C S3A Kunde') returning id into v_company;
    insert into public.contacts (first_name, last_name, company_id) values ('Ser', 'Ial', v_company) returning id into v_contact;
    insert into public.contact_notes (contact_id, text) values (v_contact, 'S3A') returning id into v_cnote;
    insert into public.contact_notes (contact_id, text) values (v_contact, 'S3A 2') returning id into v_cnote2;
    insert into public.deals (name, company_id, stage) values ('W8-C S3A Vorgang', v_company, 'opportunity') returning id into v_deal;
    insert into public.deal_notes (deal_id, text) values (v_deal, 'S3A') returning id into v_dnote;

    -- ---- 5. admission state matrix ----------------------------------------
    for r in
        select * from (values
            ('pending',           'reject'),
            ('claimed',           'reject'),
            ('claimed_expired',   'reject'),
            ('failed_retryable',  'reject'),
            ('done',              'reject'),
            ('skipped_live',      'allow'),
            ('failed_terminal',   'allow'),
            ('none',              'allow')
        ) as t(label, expected)
    loop
        if r.label = 'pending' then
            insert into nora_private.attachment_storage_deletion_queue (storage_key) values ('s3a-state-' || r.label);
        elsif r.label = 'claimed' then
            insert into nora_private.attachment_storage_deletion_queue (storage_key, state, attempt_count, claimed_at, claimed_by)
                values ('s3a-state-' || r.label, 'claimed', 1, now(), gen_random_uuid()::text);
        elsif r.label = 'claimed_expired' then
            insert into nora_private.attachment_storage_deletion_queue (storage_key, state, attempt_count, claimed_at, claimed_by)
                values ('s3a-state-' || r.label, 'claimed', 1, now() - interval '1 day', gen_random_uuid()::text);
        elsif r.label = 'failed_retryable' then
            insert into nora_private.attachment_storage_deletion_queue (storage_key, state, attempt_count, last_error_code, last_error_at)
                values ('s3a-state-' || r.label, 'failed_retryable', 1, 'NORA_ATTACHMENT_LEASE_EXPIRED', now());
        elsif r.label in ('done', 'skipped_live', 'failed_terminal') then
            insert into nora_private.attachment_storage_deletion_queue (storage_key, state, completed_at)
                values ('s3a-state-' || r.label, r.label, now());
        end if;

        select string_agg(to_jsonb(q)::text, ',' order by q.id) into v_before
          from nora_private.attachment_storage_deletion_queue q where q.storage_key = 's3a-state-' || r.label;

        v_state := 'admitted'; v_detail := null; v_msg := null;
        begin
            insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
                values (v_cnote, 's3a-state-' || r.label, 'x.pdf', 'application/pdf');
        exception when others then
            get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail, v_msg = message_text;
        end;

        if r.expected = 'reject' then
            if v_state <> '55000' or v_detail is distinct from 'NORA_ATTACHMENT_STORAGE_KEY_PENDING_DELETION' then
                v_failures := v_failures || format('5 %s: -> %s %s, expected REJECT 55000 NORA_ATTACHMENT_STORAGE_KEY_PENDING_DELETION',
                    r.label, v_state, coalesce(v_detail, ''));
            end if;
            if position('s3a-state-' in coalesce(v_msg, '')) > 0 then
                v_failures := v_failures || format('5 %s: the rejection message names the storage key', r.label);
            end if;
            if exists (select 1 from public.attachments where storage_key = 's3a-state-' || r.label) then
                v_failures := v_failures || format('5 %s: a rejected reference was persisted', r.label);
            end if;
        elsif v_state <> 'admitted'
              or not exists (select 1 from public.attachments where storage_key = 's3a-state-' || r.label) then
            v_failures := v_failures || format('5 %s: -> %s %s, expected ALLOW', r.label, v_state, coalesce(v_detail, ''));
        end if;

        -- the job is never touched by admission (either outcome)
        select string_agg(to_jsonb(q)::text, ',' order by q.id) into v_after
          from nora_private.attachment_storage_deletion_queue q where q.storage_key = 's3a-state-' || r.label;
        if v_before is distinct from v_after then
            v_failures := v_failures || format('5 %s: admission modified the queue row(s)', r.label);
        end if;
    end loop;

    -- an active intent dominates history for the same key
    insert into nora_private.attachment_storage_deletion_queue (storage_key, state, completed_at)
        values ('s3a-mixed.pdf', 'skipped_live', now());
    insert into nora_private.attachment_storage_deletion_queue (storage_key) values ('s3a-mixed.pdf');
    v_state := 'admitted';
    begin
        insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
            values (v_cnote, 's3a-mixed.pdf', 'x.pdf', 'application/pdf');
    exception when others then v_state := sqlstate;
    end;
    if v_state <> '55000' then
        v_failures := array_append(v_failures, '5 skipped_live + pending history did not reject');
    end if;

    -- a multi-row INSERT with one rejected key is rejected as a whole
    v_state := 'admitted';
    begin
        insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
        values (v_cnote, 's3a-multi-ok.pdf', 'x.pdf', 'application/pdf'),
               (v_cnote, 's3a-state-pending', 'x.pdf', 'application/pdf');
    exception when others then v_state := sqlstate;
    end;
    if v_state <> '55000' or exists (select 1 from public.attachments where storage_key = 's3a-multi-ok.pdf') then
        v_failures := array_append(v_failures, '5 multi-row INSERT was not rejected as a whole');
    end if;

    -- ---- 6. participation: each path holds exactly its key lock -----------
    -- (the locks taken by section 5 are still held in this transaction, so
    -- every probe below uses a key that nothing above touched)
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
        values (v_cnote, 's3a-part-admit.pdf', 'x.pdf', 'application/pdf') returning id into v_a;
    if not exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()
                   and classid::bigint = v_ns and objid::bigint = (hashtext('s3a-part-admit.pdf')::bigint & 4294967295)) then
        v_failures := array_append(v_failures, '6a admission did not take the key lock');
    end if;

    alter table public.attachments disable trigger guard_attachment_reference_admission_after_insert_trigger;
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
        values (v_cnote, 's3a-part-capture.pdf', 'x.pdf', 'application/pdf') returning id into v_b;
    alter table public.attachments enable trigger guard_attachment_reference_admission_after_insert_trigger;
    if exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()
               and classid::bigint = v_ns and objid::bigint = (hashtext('s3a-part-capture.pdf')::bigint & 4294967295)) then
        v_failures := array_append(v_failures, '6b probe precondition: capture key already locked');
    end if;
    delete from public.attachments where id = v_b;
    if not exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()
                   and classid::bigint = v_ns and objid::bigint = (hashtext('s3a-part-capture.pdf')::bigint & 4294967295)) then
        v_failures := array_append(v_failures, '6b capture did not take the key lock');
    end if;
    if (select count(*) from nora_private.attachment_storage_deletion_queue
        where storage_key = 's3a-part-capture.pdf' and state = 'pending') <> 1 then
        v_failures := array_append(v_failures, '6b capture did not enqueue exactly one pending intent');
    end if;

    insert into nora_private.attachment_storage_deletion_queue (storage_key, state, attempt_count, claimed_at, claimed_by)
        values ('s3a-part-inspect.pdf', 'claimed', 1, now(), 'tok-s3a-inspect') returning id into v_job;
    select job_state into v_state from nora_private.attachment_deletion_inspect(v_job, 'tok-s3a-inspect');
    if v_state <> 'claimed' then
        v_failures := v_failures || format('6c inspect of an unreferenced key -> %s, expected claimed (dead, no write)', v_state);
    end if;
    if not exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()
                   and classid::bigint = v_ns and objid::bigint = (hashtext('s3a-part-inspect.pdf')::bigint & 4294967295)) then
        v_failures := array_append(v_failures, '6c inspect did not take the key lock');
    end if;

    -- lost lease: unknown job id (the pre-lock key read finds nothing), wrong token
    foreach v_tok in array array['unknown-id', 'wrong-token'] loop
        v_state := 'no error'; v_detail := null;
        begin
            if v_tok = 'unknown-id' then
                perform * from nora_private.attachment_deletion_inspect(-1, 'tok-s3a-inspect');
            else
                perform * from nora_private.attachment_deletion_inspect(v_job, 'not-the-token');
            end if;
        exception when others then
            get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
        end;
        if v_state <> '55000' or v_detail is distinct from 'NORA_ATTACHMENT_LEASE_LOST' then
            v_failures := v_failures || format('6d inspect %s -> %s %s, expected 55000 NORA_ATTACHMENT_LEASE_LOST', v_tok, v_state, coalesce(v_detail, ''));
        end if;
    end loop;
    if (select state || ':' || claimed_by from nora_private.attachment_storage_deletion_queue where id = v_job)
       <> 'claimed:tok-s3a-inspect' then
        v_failures := array_append(v_failures, '6d a lost-lease inspect modified the job');
    end if;

    -- ---- 7. storage_key immutability ---------------------------------------
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
        values (v_cnote, 's3a-imm-a.pdf', 'x.pdf', 'application/pdf') returning id into v_a;
    v_state := 'no error'; v_detail := null;
    begin
        update public.attachments set storage_key = 's3a-imm-b.pdf' where id = v_a;
    exception when others then
        get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
    end;
    if v_state <> '55000' or v_detail is distinct from 'NORA_ATTACHMENT_STORAGE_KEY_IMMUTABLE'
       or (select storage_key from public.attachments where id = v_a) <> 's3a-imm-a.pdf' then
        -- fail fast: every later step of section 7 builds on key A staying A
        raise exception E'FAIL (behaviour):\n7a storage_key A -> B -> % %, expected 55000 NORA_ATTACHMENT_STORAGE_KEY_IMMUTABLE',
            v_state, coalesce(v_detail, '');
    end if;
    update public.attachments set storage_key = storage_key where id = v_a;
    get diagnostics v_n = row_count;
    if v_n <> 1 then
        v_failures := array_append(v_failures, '7b a same-value storage_key update failed');
    end if;
    update public.attachments set file_name = 'y.pdf' where id = v_a;
    get diagnostics v_n = row_count;
    if v_n <> 1 then
        v_failures := array_append(v_failures, '7c an update of another column failed');
    end if;
    -- the note-id FK ON UPDATE CASCADE rewrites contact_note_id, not the key
    update public.contact_notes set id = id + 1000000 where id = v_cnote2;
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
        values (v_cnote2 + 1000000, 's3a-imm-fk.pdf', 'x.pdf', 'application/pdf') returning id into v_b;
    update public.contact_notes set id = v_cnote2 where id = v_cnote2 + 1000000;
    if (select contact_note_id from public.attachments where id = v_b) <> v_cnote2 then
        v_failures := array_append(v_failures, '7d the note-id FK ON UPDATE CASCADE did not reach the attachment row');
    end if;
    -- logical move to another note, same key, same transaction: capture then admission rejects
    v_state := 'no error';
    begin
        delete from public.attachments where id = v_a;
        insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
            values (v_cnote2, 's3a-imm-a.pdf', 'x.pdf', 'application/pdf');
    exception when others then
        get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
    end;
    if v_state <> '55000' or v_detail is distinct from 'NORA_ATTACHMENT_STORAGE_KEY_PENDING_DELETION'
       or (select contact_note_id from public.attachments where id = v_a) <> v_cnote then
        v_failures := v_failures || format('7e same-key move -> %s %s, expected rejection and rollback of the pair', v_state, coalesce(v_detail, ''));
    end if;
    -- logical move to a NEW key: capture of A + admission of B
    delete from public.attachments where id = v_a;
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
        values (v_cnote2, 's3a-imm-b.pdf', 'x.pdf', 'application/pdf');
    if (select count(*) from nora_private.attachment_storage_deletion_queue where storage_key = 's3a-imm-a.pdf' and state = 'pending') <> 1
       or not exists (select 1 from public.attachments where storage_key = 's3a-imm-b.pdf') then
        v_failures := array_append(v_failures, '7f DELETE A + INSERT B did not capture A and admit B');
    end if;

    -- ---- 9. cascades --------------------------------------------------------
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
    values (v_cnote2, 's3a-cas-n1.pdf', 'x.pdf', 'application/pdf'),
           (v_cnote2, 's3a-cas-n2.pdf', 'x.pdf', 'application/pdf'),
           (v_cnote2, 's3a-cas-n3.pdf', 'x.pdf', 'application/pdf');
    delete from public.contact_notes where id = v_cnote2;
    if (select count(*) from nora_private.attachment_storage_deletion_queue
        where storage_key in ('s3a-cas-n1.pdf', 's3a-cas-n2.pdf', 's3a-cas-n3.pdf', 's3a-imm-b.pdf', 's3a-imm-fk.pdf') and state = 'pending') <> 5 then
        v_failures := array_append(v_failures, '9a note delete did not capture every attachment row');
    end if;

    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
        values (v_cnote, 's3a-cas-c1.pdf', 'x.pdf', 'application/pdf');
    delete from public.contacts where id = v_contact;
    if (select count(*) from nora_private.attachment_storage_deletion_queue
        where storage_key in ('s3a-cas-c1.pdf', 's3a-part-admit.pdf', 's3a-state-skipped_live', 's3a-state-failed_terminal', 's3a-state-none')
          and state = 'pending') <> 5 then
        v_failures := array_append(v_failures, '9b contact delete did not capture every row of its notes');
    end if;

    -- 200-key company cascade: contacts -> notes and deals -> deal notes
    insert into public.contacts (first_name, last_name, company_id) values ('Bulk', 'Kontakt', v_company) returning id into v_contact;
    insert into public.contact_notes (contact_id, text) values (v_contact, 'bulk') returning id into v_cnote;
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
        select v_cnote, format('s3a-bulk-c-%s.pdf', g), 'x.pdf', 'application/pdf' from generate_series(1, 100) g;
    insert into public.attachments (deal_note_id, storage_key, file_name, mime_type)
        select v_dnote, format('s3a-bulk-d-%s.pdf', g), 'x.pdf', 'application/pdf' from generate_series(1, 100) g;
    update public.companies set self_contact_id = null where id = v_company;
    delete from public.companies where id = v_company;
    if (select count(*) from nora_private.attachment_storage_deletion_queue
        where storage_key like 's3a-bulk-%' and state = 'pending') <> 200 then
        v_failures := array_append(v_failures, '9c the 200-key company cascade did not capture 200 pending intents');
    end if;
    if (select count(*) from public.attachments where storage_key like 's3a-bulk-%') <> 0 then
        v_failures := array_append(v_failures, '9c the company cascade left attachment rows');
    end if;
    select count(*) into v_n from pg_locks l
     where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.classid::bigint = v_ns
       and l.objid::bigint in (select hashtext(format('s3a-bulk-%s-%s.pdf', k, g))::bigint & 4294967295
                                 from generate_series(1, 100) g, unnest(array['c', 'd']) k);
    if v_n <> 200 then
        v_failures := v_failures || format('9c expected 200 key locks held by the cascade, got %s', v_n);
    end if;

    -- ---- 10. I1 holds -------------------------------------------------------
    if exists (select 1 from public.attachments a
               join nora_private.attachment_storage_deletion_queue q on q.storage_key = a.storage_key
               where q.state in ('pending', 'claimed', 'failed_retryable', 'done')) then
        v_failures := array_append(v_failures, '10 I1 violated: a reference shares its key with an active or done intent');
    end if;
    if exists (select 1 from nora_private.attachment_storage_deletion_queue where state = 'done' and storage_key not like 's3a-state-%') then
        v_failures := array_append(v_failures, '10 something other than the fixture produced done');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (behaviour):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  5. admission: pending / claimed / expired claim / failed_retryable / done REJECT; skipped_live / failed_terminal / none ALLOW; job untouched; multi-row rejected whole; key not in message';
    raise notice 'OK  6. participation: admission, capture and inspect each hold exactly their key lock; unknown job / wrong token -> LEASE_LOST, job untouched';
    raise notice 'OK  7. immutability: A -> B rejected, A -> A / other columns / note-id cascade harmless, same-key move rejected, DELETE A + INSERT B captures A and admits B';
    raise notice 'OK  9. cascades: note, contact, 200-key company cascade capture every row, 200 key locks held, no deadlock';
    raise notice 'OK 10. I1 holds, no done writer';

    raise exception 'ROLLBACK_W8C_S3A_TEST';
exception
    when others then
        if sqlerrm = 'ROLLBACK_W8C_S3A_TEST' then
            raise notice 'behaviour fixtures rolled back';
        else
            raise;
        end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Access: authenticated SELECT only, real claims + live sessions
-- ---------------------------------------------------------------------------
do $$
declare
    v_admin  uuid := gen_random_uuid();
    v_office uuid := gen_random_uuid();
    v_ad bigint; v_o bigint;
    v_company bigint; v_contact bigint; v_cnote bigint; v_a bigint;
    r record;
    v_n bigint; v_state text;
    v_failures text[] := '{}';
begin
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values
      (v_admin, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','w8c-s3a-admin@nora.test','x',now(),'{"provider":"email","providers":["email"]}','{"first_name":"Ada","last_name":"Admin"}',now(),now()),
      (v_office,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','w8c-s3a-office@nora.test','x',now(),'{"provider":"email","providers":["email"]}','{"first_name":"Olaf","last_name":"Office"}',now(),now());
    select id into v_ad from public.sales where user_id = v_admin;
    select id into v_o  from public.sales where user_id = v_office;
    perform nora_private.apply_sales_role_change(v_ad, 'admin',  false);
    perform nora_private.apply_sales_role_change(v_o,  'office', false);
    insert into auth.sessions (id, user_id, created_at, updated_at, aal)
        values (v_admin, v_admin, now(), now(), 'aal1'), (v_office, v_office, now(), now(), 'aal1');

    insert into public.companies (name, sales_id) values ('W8-C S3A Zugriff', v_o) returning id into v_company;
    insert into public.contacts (first_name, last_name, company_id, sales_id) values ('Zu', 'Griff', v_company, v_o) returning id into v_contact;
    insert into public.contact_notes (contact_id, text, date, sales_id) values (v_contact, 'Zugriff', now(), v_o) returning id into v_cnote;
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
        values (v_cnote, 's3a-acl.pdf', 'x.pdf', 'application/pdf') returning id into v_a;

    for r in select * from (values ('admin', v_admin, 'authenticated'), ('office', v_office, 'authenticated'),
                                   ('service_role', null::uuid, 'service_role'), ('anon', null::uuid, 'anon')) as t(label, uid, api_role)
    loop
        perform set_config('request.jwt.claims',
            case when r.uid is null then json_build_object('role', r.api_role)::text
                 else json_build_object('role', 'authenticated', 'sub', r.uid::text, 'session_id', r.uid::text)::text end, true);
        execute format('set local role %I', r.api_role);

        v_state := 'ok';
        begin
            select count(*) into v_n from public.attachments where id = v_a;
            if v_n <> 1 then v_state := 'rows=' || v_n; end if;
        exception when others then v_state := sqlstate;
        end;
        if (r.label in ('admin', 'office') and v_state <> 'ok') or (r.label in ('service_role', 'anon') and v_state <> '42501') then
            v_failures := v_failures || format('8 %s SELECT -> %s', r.label, v_state);
        end if;

        v_state := 'ok';
        begin
            insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
                values (v_cnote, 's3a-acl-' || r.label || '.pdf', 'x.pdf', 'application/pdf');
        exception when others then v_state := sqlstate;
        end;
        if v_state <> '42501' then
            v_failures := v_failures || format('8 %s INSERT -> %s, expected 42501', r.label, v_state);
        end if;

        v_state := 'ok';
        begin
            update public.attachments set storage_key = 's3a-acl-moved.pdf' where id = v_a;
        exception when others then v_state := sqlstate;
        end;
        if v_state <> '42501' then
            v_failures := v_failures || format('8 %s UPDATE -> %s, expected 42501', r.label, v_state);
        end if;

        v_state := 'ok';
        begin
            delete from public.attachments where id = v_a;
        exception when others then v_state := sqlstate;
        end;
        if v_state <> '42501' then
            v_failures := v_failures || format('8 %s DELETE -> %s, expected 42501', r.label, v_state);
        end if;

        reset role;
        perform set_config('request.jwt.claims', null, true);
    end loop;

    if (select storage_key from public.attachments where id = v_a) <> 's3a-acl.pdf' then
        v_failures := array_append(v_failures, '8 the fixture row changed');
    end if;
    if exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'attachments'
               and p.policyname <> 'attachments_select_active_user') then
        v_failures := array_append(v_failures, '8 a policy other than attachments_select_active_user exists');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (access):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  8. access: admin / office read; INSERT / UPDATE / DELETE denied by privilege for admin, office, service_role and anon; only the SELECT policy exists';

    raise exception 'ROLLBACK_W8C_S3A_TEST';
exception
    when others then
        if sqlerrm = 'ROLLBACK_W8C_S3A_TEST' then
            raise notice 'access fixtures rolled back';
        else
            raise;
        end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. No leak
-- ---------------------------------------------------------------------------
do $$
begin
    if coalesce(current_setting('request.jwt.claims', true), '') <> ''
       or current_user <> 'postgres'
       or exists (select 1 from public.attachments where storage_key like 's3a-%')
       or exists (select 1 from nora_private.attachment_storage_deletion_queue where storage_key like 's3a-%')
       or exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid())
       or exists (select 1 from pg_trigger t where t.tgrelid = 'public.attachments'::regclass
                  and not t.tgisinternal and t.tgenabled <> 'O') then
        raise exception 'FAIL (leak): a GUC, role, fixture row, key lock or disabled trigger survived';
    end if;
    raise notice 'OK 11. no GUC / role / fixture / lock leak, all triggers enabled';
end;
$$;

\echo '=== W8-C S3A verification: ALL CHECKS PASSED ==='
