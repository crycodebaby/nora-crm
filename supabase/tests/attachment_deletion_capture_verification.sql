-- Nora W8-C S2A1 — attachment deletion capture: database contract verification
--
-- Self-contained and rollback-safe: every fixture is created inside a DO block
-- that terminates with ROLLBACK_W8C_S2A1_TEST, so the block's subtransaction
-- undoes it. Safe at any point after a fresh `npx supabase db reset --local`.
--
-- Usage (local only):
--   docker exec -i supabase_db_atomic-crm-demo psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/attachment_deletion_capture_verification.sql
--
-- What it proves:
--   1. queue shape: columns, types, nullability, defaults, the six check
--      constraints, and that the idempotency index is UNIQUE *and* PARTIAL
--      (a permanent UNIQUE would strand a legitimately re-referenced key)
--   2. queue security: no privilege for anon / authenticated / service_role on
--      any of the eight/seven privilege kinds, RLS enabled, zero policies,
--      owned by postgres, and the schema is not PostgREST-exposed; the only
--      consumer functions are the W8-C S2A2.2 set in nora_private
--      (claim_next / inspect / fail), none executable by any API role and none
--      in public
--   3. capture function: SECURITY DEFINER, owner postgres, search_path = '',
--      no EXECUTE for public/anon/authenticated/service_role, and a body that
--      contains no HTTP / pg_net / Storage / Edge Function call whatsoever
--   4. the capture hook is the only DELETE trigger on public.attachments:
--      AFTER DELETE FOR EACH ROW; besides it only the two W8-C S3A guards
--      (reference admission AFTER INSERT, storage_key immutability BEFORE UPDATE)
--   5. CASCADE PROOF — one deleted attachment row yields exactly one active
--      job for its storage_key along all six deletion paths:
--         direct / contact_note / deal_note / contact / deal / company
--   6. idempotency: first enqueue creates one pending job; a repeated intent
--      while an active job exists is a NO-OP and does NOT abort the business
--      DELETE (pre-existing intent, reference created first); a terminal
--      (done / failed_terminal) row does NOT permanently block a future job
--      for the same key. Since W8-C S3A a NEW reference to a key with an
--      active intent or a done tombstone is rejected (I1)
--   7. negatives: INSERT creates no job, UPDATE creates no job, a blank
--      storage_key is rejected by the backstop check, and the privilege
--      matrix on public.attachments is exactly the S3A one (authenticated
--      SELECT only; service_role gains nothing)
--   9. CONFLICT PRECISION — the two conflict classes behave DIFFERENTLY: a
--      duplicate ACTIVE storage_key is suppressed and the DELETE succeeds,
--      while an unrelated PRIMARY KEY conflict propagates and rolls the
--      business DELETE back. A bare `on conflict do nothing` would swallow
--      both and silently lose the deletion intent
--  10. THE SECURITY DEFINER BOUNDARY, exercised by a real `authenticated`
--      caller with a live auth.sessions binding: it holds no queue privilege
--      and no EXECUTE, cannot touch either directly, yet deleting the owning
--      note captures exactly one pending job — and the same admin identity
--      WITHOUT a live session captures none. Since W8-C S3A (20260919120000)
--      a direct DELETE on public.attachments is denied to every API role by
--      the table privilege (42501) and captures nothing; the note delete
--      (FK cascade) is the remaining API-reachable capture path. Sections 5–7
--      run as postgres and prove nothing about this boundary
--  11. FAIL-CLOSED ATOMICITY: when capture fails for a reason that is NOT the
--      intended duplicate, the business DELETE (an admin's note delete that
--      cascades) rolls back and note + attachment row survive — no silent loss
--      of deletion intent
--
-- NOT proven here (out of S2A1 scope by design): claim/inspect/fail semantics
-- (attachment_deletion_queue_execution_verification.sql), the live-reference
-- resolver, lease/retry behaviour, and any physical storage deletion. S2A1 has
-- no consumer — a row in this queue is an INTENT, never a permission to delete
-- an object.

\set ON_ERROR_STOP on

\echo '=== W8-C S2A1: attachment deletion capture verification ==='

-- ---------------------------------------------------------------------------
-- 1. Queue shape
-- ---------------------------------------------------------------------------
do $$
declare
    r          record;
    v_extra    text;
    v_failures text[] := '{}';
begin
    if to_regclass('nora_private.attachment_storage_deletion_queue') is null then
        raise exception 'FAIL: nora_private.attachment_storage_deletion_queue does not exist';
    end if;

    if pg_get_userbyid((select relowner from pg_class
                        where oid = 'nora_private.attachment_storage_deletion_queue'::regclass)) <> 'postgres' then
        v_failures := array_append(v_failures, 'the queue is not owned by postgres');
    end if;

    for r in
        select * from (values
            ('id',              'bigint',                   false),
            ('storage_key',     'text',                     false),
            ('state',           'text',                     false),
            ('attempt_count',   'integer',                  false),
            ('available_at',    'timestamp with time zone', false),
            ('claimed_at',      'timestamp with time zone', true),
            ('claimed_by',      'text',                     true),
            ('last_error_code', 'text',                     true),
            ('last_error_at',   'timestamp with time zone', true),
            ('created_at',      'timestamp with time zone', false),
            ('completed_at',    'timestamp with time zone', true)
        ) as t(col, typ, nullable)
    loop
        if not exists (
            select 1 from pg_attribute a
            where a.attrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
              and a.attname = r.col and a.attnum > 0 and not a.attisdropped
              and format_type(a.atttypid, a.atttypmod) = r.typ
              and a.attnotnull = (not r.nullable::boolean)
        ) then
            v_failures := v_failures || format('column %s is not %s %s', r.col, r.typ,
                case when r.nullable::boolean then 'NULL' else 'NOT NULL' end);
        end if;
    end loop;

    -- no column beyond the agreed S2A1 contract
    select string_agg(a.attname, ', ' order by a.attname) into v_extra
    from pg_attribute a
    where a.attrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
      and a.attnum > 0 and not a.attisdropped
      and a.attname not in ('id','storage_key','state','attempt_count','available_at','claimed_at',
                            'claimed_by','last_error_code','last_error_at','created_at','completed_at');
    if v_extra is not null then
        v_failures := v_failures || format('unexpected columns: %s', v_extra);
    end if;

    -- defaults that the capture path relies on
    if not exists (select 1 from pg_attrdef d
                   join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
                   where d.adrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
                     and a.attname = 'state'
                     and pg_get_expr(d.adbin, d.adrelid) like '''pending''%') then
        v_failures := array_append(v_failures, 'state has no ''pending'' default');
    end if;

    if not exists (select 1 from pg_attrdef d
                   join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
                   where d.adrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
                     and a.attname = 'attempt_count'
                     and pg_get_expr(d.adbin, d.adrelid) = '0') then
        v_failures := array_append(v_failures, 'attempt_count has no 0 default');
    end if;

    -- the six check constraints
    for r in
        select * from (values
            ('attachment_storage_deletion_queue_state_check'),
            ('attachment_storage_deletion_queue_storage_key_check'),
            ('attachment_storage_deletion_queue_attempt_count_check'),
            ('attachment_storage_deletion_queue_claim_check'),
            ('attachment_storage_deletion_queue_completed_check'),
            ('attachment_storage_deletion_queue_error_check')
        ) as t(conname)
    loop
        if not exists (select 1 from pg_constraint con
                       where con.conrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
                         and con.conname = r.conname and con.contype = 'c') then
            v_failures := v_failures || format('missing check constraint %s', r.conname);
        end if;
    end loop;

    -- THE idempotency invariant must be unique AND partial
    if not exists (
        select 1 from pg_index i
        join pg_class c on c.oid = i.indexrelid
        where i.indrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
          and c.relname = 'uq__attachment_deletion_queue__active_storage_key'
          and i.indisunique and i.indpred is not null
    ) then
        v_failures := array_append(v_failures,
            'the active-job index is missing, not unique, or not partial');
    end if;

    -- an unconditional unique index on storage_key would be the wrong model
    if exists (
        select 1 from pg_index i
        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
        where i.indrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
          and i.indisunique and i.indpred is null and i.indnatts = 1
          and a.attname = 'storage_key'
    ) then
        v_failures := array_append(v_failures,
            'a PERMANENT unique index on storage_key exists — it would strand re-referenced keys');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (queue shape):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK 1. queue shape, defaults, checks and the partial unique index';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Queue security
-- ---------------------------------------------------------------------------
do $$
declare
    v_priv      text;
    v_role      text;
    v_sig       text;
    v_consumers text[];
    v_failures  text[] := '{}';
    v_privs     text[] := case when current_setting('server_version_num')::int >= 170000
                              then array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']
                              else array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']
                         end;
begin
    foreach v_role in array array['anon','authenticated','service_role'] loop
        foreach v_priv in array v_privs loop
            if has_table_privilege(v_role, 'nora_private.attachment_storage_deletion_queue', v_priv) then
                v_failures := v_failures || format('%s holds %s on the queue', v_role, v_priv);
            end if;
        end loop;
    end loop;

    if not (select c.relrowsecurity from pg_class c
            where c.oid = 'nora_private.attachment_storage_deletion_queue'::regclass) then
        v_failures := array_append(v_failures, 'RLS is not enabled on the queue');
    end if;

    if exists (select 1 from pg_policies p
               where p.schemaname = 'nora_private'
                 and p.tablename = 'attachment_storage_deletion_queue') then
        v_failures := array_append(v_failures, 'the queue must carry no policy at all (deny-all by absence)');
    end if;

    -- The consumer contract exists ONLY as the approved W8-C S2A2.2 set in
    -- nora_private (claim_next / inspect / fail): no ack, completion, drain or
    -- worker function anywhere, nothing in public, and no API role - service_role
    -- included - may execute any of them. service_role gained nothing.
    select array_agg(n.nspname || '.' || p.proname order by n.nspname, p.proname) into v_consumers
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname ~ 'attachment.*(claim|ack|fail|drain|worker|inspect|complete)'
       or p.proname ~ '(claim|ack|fail|drain|worker|inspect|complete).*attachment';
    if v_consumers is distinct from array['nora_private.attachment_deletion_claim_next',
                                          'nora_private.attachment_deletion_fail',
                                          'nora_private.attachment_deletion_inspect'] then
        v_failures := v_failures || format(
            'the queue consumer functions are not exactly the approved S2A2.2 set (claim_next / fail / inspect): %s',
            coalesce(array_to_string(v_consumers, ', '), '<none>'));
    end if;

    foreach v_sig in array array['nora_private.attachment_deletion_claim_next()',
                                 'nora_private.attachment_deletion_fail(bigint,text,text,boolean)',
                                 'nora_private.attachment_deletion_inspect(bigint,text)'] loop
        if to_regprocedure(v_sig) is not null then
            foreach v_role in array array['public','anon','authenticated','service_role'] loop
                if has_function_privilege(v_role, v_sig, 'EXECUTE') then
                    v_failures := v_failures || format('%s holds EXECUTE on the consumer function %s', v_role, v_sig);
                end if;
            end loop;
        end if;
    end loop;

    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public'
                 and p.prosrc like '%attachment_storage_deletion_queue%') then
        v_failures := array_append(v_failures, 'a public (API-exposed) function references the queue');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (queue security):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK 2. queue security: zero API-role privileges, RLS on, no policy, consumer = exactly the postgres-only S2A2.2 set, no API-executable consumer';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Capture function contract
-- ---------------------------------------------------------------------------
do $$
declare
    v_def      text;
    v_role     text;
    v_failures text[] := '{}';
    v_forbidden text;
begin
    if to_regprocedure('nora_private.enqueue_attachment_storage_deletion()') is null then
        raise exception 'FAIL: nora_private.enqueue_attachment_storage_deletion() does not exist';
    end if;

    if not exists (select 1 from pg_proc p
                   join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'nora_private'
                     and p.proname = 'enqueue_attachment_storage_deletion'
                     and p.prosecdef
                     and pg_get_userbyid(p.proowner) = 'postgres'
                     and p.proconfig @> array['search_path=""']) then
        v_failures := array_append(v_failures,
            'not SECURITY DEFINER / not owned by postgres / search_path is not empty');
    end if;

    foreach v_role in array array['public','anon','authenticated','service_role'] loop
        if has_function_privilege(v_role, 'nora_private.enqueue_attachment_storage_deletion()', 'EXECUTE') then
            v_failures := v_failures || format('%s holds EXECUTE on the capture function', v_role);
        end if;
    end loop;

    -- THE architectural invariant: database work only. The pre-W8-B path
    -- (trigger -> pg_net -> Edge Function -> service_role remove) is not coming
    -- back, and this assertion is what keeps it out.
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'nora_private' and p.proname = 'enqueue_attachment_storage_deletion';

    foreach v_forbidden in array array['net.http', 'pg_net', 'http_post', 'http_get',
                                       'storage.objects', 'storage.buckets',
                                       'functions/v1', 'supabase.co', 'dblink', 'pg_background']
    loop
        if position(v_forbidden in v_def) > 0 then
            v_failures := v_failures || format('the capture function references %s — it must do database work only', v_forbidden);
        end if;
    end loop;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (capture function):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK 3. capture function: definer, locked down, no HTTP / pg_net / Storage / Edge reference';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Trigger placement
-- ---------------------------------------------------------------------------
do $$
declare
    v_extra    text;
    v_failures text[] := '{}';
begin
    -- Since W8-C S3A (20260919120000) the capture hook shares the table with
    -- exactly two guards (reference admission AFTER INSERT, storage_key
    -- immutability BEFORE UPDATE). Neither fires on DELETE, so the capture
    -- hook is still the ONLY delete-time trigger.
    select string_agg(t.tgname, ', ' order by t.tgname) into v_extra
    from pg_trigger t
    where t.tgrelid = 'public.attachments'::regclass
      and not t.tgisinternal
      and t.tgname not in ('enqueue_attachment_storage_deletion_after_delete_trigger',
                           'guard_attachment_reference_admission_after_insert_trigger',
                           'guard_attachment_storage_key_immutable_before_update_trigger');
    if v_extra is not null then
        v_failures := v_failures || format('unexpected triggers on public.attachments: %s', v_extra);
    end if;

    select string_agg(t.tgname, ', ' order by t.tgname) into v_extra
    from pg_trigger t
    where t.tgrelid = 'public.attachments'::regclass
      and not t.tgisinternal
      and (t.tgtype & 8) = 8
      and t.tgname <> 'enqueue_attachment_storage_deletion_after_delete_trigger';
    if v_extra is not null then
        v_failures := v_failures || format('a trigger other than the capture hook fires on DELETE: %s', v_extra);
    end if;

    if not exists (
        select 1 from pg_trigger t
        where t.tgrelid = 'public.attachments'::regclass
          and t.tgname = 'enqueue_attachment_storage_deletion_after_delete_trigger'
          and not t.tgisinternal
          and (t.tgtype & 1) = 1      -- FOR EACH ROW
          and (t.tgtype & 8) = 8      -- ON DELETE
          and (t.tgtype & 2) = 0      -- AFTER
          and (t.tgtype & 4) = 0      -- not INSERT
          and (t.tgtype & 16) = 0     -- not UPDATE
    ) then
        v_failures := array_append(v_failures,
            'the capture trigger is not exactly AFTER DELETE FOR EACH ROW on public.attachments');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (trigger):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK 4. capture = the only DELETE trigger (AFTER DELETE FOR EACH ROW); besides it only the two S3A guards';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5.–7. Behaviour: cascade proofs, idempotency, negatives
--       (as postgres, everything rolled back)
-- ---------------------------------------------------------------------------
do $$
declare
    v_sales    bigint;
    v_user     uuid := gen_random_uuid();
    v_company  bigint; v_contact bigint; v_deal bigint;
    v_cnote    bigint; v_dnote bigint;
    v_a        bigint;
    v_n        bigint;
    v_state    text;
    v_detail   text;
    v_failures text[] := '{}';
begin
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'w8c-s2a1-owner@nora.test', 'x', now(),
            '{"provider":"email","providers":["email"]}', '{"first_name":"Ole","last_name":"Owner"}', now(), now());
    select id into v_sales from public.sales where user_id = v_user;

    insert into public.companies (name, sales_id) values ('W8-C S2A1 Kunde', v_sales) returning id into v_company;
    insert into public.contacts (first_name, last_name, company_id, sales_id)
        values ('Kon', 'Takt', v_company, v_sales) returning id into v_contact;
    insert into public.deals (name, company_id, stage, sales_id)
        values ('W8-C S2A1 Vorgang', v_company, 'opportunity', v_sales) returning id into v_deal;

    -- ---- 5a. direct attachment DELETE --------------------------------------
    insert into public.contact_notes (contact_id, text, date, sales_id)
        values (v_contact, 'Notiz', now(), v_sales) returning id into v_cnote;
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
        values (v_cnote, 's2a1-direct.pdf', 'plan.pdf', 'application/pdf') returning id into v_a;

    -- the INSERT itself must not enqueue anything (negative 7a)
    if (select count(*) from nora_private.attachment_storage_deletion_queue
        where storage_key = 's2a1-direct.pdf') <> 0 then
        v_failures := array_append(v_failures, '7a INSERT created a queue job');
    end if;

    delete from public.attachments where id = v_a;

    select count(*), min(state) into v_n, v_state
    from nora_private.attachment_storage_deletion_queue where storage_key = 's2a1-direct.pdf';
    if v_n <> 1 or v_state <> 'pending' then
        v_failures := v_failures || format('5a direct delete: expected 1 pending job, got %s (%s)', v_n, v_state);
    end if;

    -- ---- 5b. contact_note DELETE -> cascade --------------------------------
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
        values (v_cnote, 's2a1-cnote.pdf', 'plan.pdf', 'application/pdf');
    delete from public.contact_notes where id = v_cnote;

    select count(*), min(state) into v_n, v_state
    from nora_private.attachment_storage_deletion_queue where storage_key = 's2a1-cnote.pdf';
    if v_n <> 1 or v_state <> 'pending' then
        v_failures := v_failures || format('5b contact_note cascade: expected 1 pending job, got %s (%s)', v_n, v_state);
    end if;

    -- ---- 5c. deal_note DELETE -> cascade -----------------------------------
    insert into public.deal_notes (deal_id, text, date, sales_id)
        values (v_deal, 'Notiz', now(), v_sales) returning id into v_dnote;
    insert into public.attachments (deal_note_id, storage_key, file_name, mime_type)
        values (v_dnote, 's2a1-dnote.pdf', 'angebot.pdf', 'application/pdf');
    delete from public.deal_notes where id = v_dnote;

    select count(*), min(state) into v_n, v_state
    from nora_private.attachment_storage_deletion_queue where storage_key = 's2a1-dnote.pdf';
    if v_n <> 1 or v_state <> 'pending' then
        v_failures := v_failures || format('5c deal_note cascade: expected 1 pending job, got %s (%s)', v_n, v_state);
    end if;

    -- ---- 5d. contact DELETE -> contact_note -> attachment ------------------
    insert into public.contact_notes (contact_id, text, date, sales_id)
        values (v_contact, 'Notiz 2', now(), v_sales) returning id into v_cnote;
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
        values (v_cnote, 's2a1-contact.pdf', 'plan.pdf', 'application/pdf');
    delete from public.contacts where id = v_contact;

    select count(*), min(state) into v_n, v_state
    from nora_private.attachment_storage_deletion_queue where storage_key = 's2a1-contact.pdf';
    if v_n <> 1 or v_state <> 'pending' then
        v_failures := v_failures || format('5d contact cascade: expected 1 pending job, got %s (%s)', v_n, v_state);
    end if;

    -- ---- 5e. deal DELETE -> deal_note -> attachment ------------------------
    insert into public.deal_notes (deal_id, text, date, sales_id)
        values (v_deal, 'Notiz 2', now(), v_sales) returning id into v_dnote;
    insert into public.attachments (deal_note_id, storage_key, file_name, mime_type)
        values (v_dnote, 's2a1-deal.pdf', 'angebot.pdf', 'application/pdf');
    delete from public.deals where id = v_deal;

    select count(*), min(state) into v_n, v_state
    from nora_private.attachment_storage_deletion_queue where storage_key = 's2a1-deal.pdf';
    if v_n <> 1 or v_state <> 'pending' then
        v_failures := v_failures || format('5e deal cascade: expected 1 pending job, got %s (%s)', v_n, v_state);
    end if;

    -- ---- 5f. company DELETE -> contacts/deals -> notes -> attachments ------
    insert into public.contacts (first_name, last_name, company_id, sales_id)
        values ('Kas', 'Kade', v_company, v_sales) returning id into v_contact;
    insert into public.contact_notes (contact_id, text, date, sales_id)
        values (v_contact, 'Notiz 3', now(), v_sales) returning id into v_cnote;
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
        values (v_cnote, 's2a1-company-c.pdf', 'plan.pdf', 'application/pdf');

    insert into public.deals (name, company_id, stage, sales_id)
        values ('W8-C S2A1 Vorgang 2', v_company, 'opportunity', v_sales) returning id into v_deal;
    insert into public.deal_notes (deal_id, text, date, sales_id)
        values (v_deal, 'Notiz 3', now(), v_sales) returning id into v_dnote;
    insert into public.attachments (deal_note_id, storage_key, file_name, mime_type)
        values (v_dnote, 's2a1-company-d.pdf', 'angebot.pdf', 'application/pdf');

    update public.companies set self_contact_id = null where id = v_company;
    delete from public.companies where id = v_company;

    select count(*) into v_n
    from nora_private.attachment_storage_deletion_queue
    where storage_key in ('s2a1-company-c.pdf', 's2a1-company-d.pdf') and state = 'pending';
    if v_n <> 2 then
        v_failures := v_failures || format('5f company cascade: expected 2 pending jobs, got %s', v_n);
    end if;

    -- ---- 6a. duplicate intent while an active job exists = NO-OP -----------
    -- Before W8-C S3A (20260919120000) the key of 5a was free again in
    -- public.attachments, so the same object could be re-referenced while its
    -- first job was still active. Reference admission (I1) now rejects that
    -- re-reference - asserted first. The capture suppression itself must still
    -- hold for a PRE-EXISTING active intent whose key is still referenced (a
    -- legacy / manual producer, i.e. pre-S3 state): the reference exists first,
    -- the intent is recorded directly as postgres, then the reference is
    -- deleted. That must NOT create a second job and must NOT abort the DELETE.
    insert into public.companies (name, sales_id)
        values ('W8-C S2A1 Kunde 2', v_sales) returning id into v_company;
    insert into public.contacts (first_name, last_name, company_id, sales_id)
        values ('Dup', 'Likat', v_company, v_sales) returning id into v_contact;
    insert into public.contact_notes (contact_id, text, date, sales_id)
        values (v_contact, 'Dup', now(), v_sales) returning id into v_cnote;

    v_state := 'admitted'; v_detail := null;
    begin
        insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
            values (v_cnote, 's2a1-direct.pdf', 'plan.pdf', 'application/pdf');
    exception when others then
        get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
    end;
    if v_state <> '55000' or v_detail is distinct from 'NORA_ATTACHMENT_STORAGE_KEY_PENDING_DELETION' then
        v_failures := v_failures || format('6a S3A: re-referencing a key with an active intent -> %s %s, expected 55000 NORA_ATTACHMENT_STORAGE_KEY_PENDING_DELETION',
            v_state, coalesce(v_detail, ''));
    end if;

    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
        values (v_cnote, 's2a1-dup.pdf', 'plan.pdf', 'application/pdf') returning id into v_a;
    insert into nora_private.attachment_storage_deletion_queue (storage_key) values ('s2a1-dup.pdf');
    delete from public.attachments where id = v_a;

    if not found then
        v_failures := array_append(v_failures, '6a the duplicate-intent DELETE did not report a deleted row');
    end if;

    if (select count(*) from public.attachments where id = v_a) <> 0 then
        v_failures := array_append(v_failures, '6a the business DELETE was aborted by the duplicate intent');
    end if;

    select count(*) into v_n
    from nora_private.attachment_storage_deletion_queue where storage_key = 's2a1-dup.pdf';
    if v_n <> 1 then
        v_failures := v_failures || format('6a duplicate intent: expected 1 job, got %s', v_n);
    end if;

    -- ---- 6b. a terminal row does not block a future job --------------------
    -- done: since W8-C S3A a done tombstone makes the key non-referencable
    -- (I1) - the object is confirmed gone. At the QUEUE level the done row
    -- still does not block a future intent: the partial unique index ignores
    -- terminal rows (shown with a direct insert, the only producer that can
    -- target a key without a reference).
    update nora_private.attachment_storage_deletion_queue
       set state = 'done', completed_at = now()
     where storage_key = 's2a1-direct.pdf';

    v_state := 'admitted'; v_detail := null;
    begin
        insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
            values (v_cnote, 's2a1-direct.pdf', 'plan.pdf', 'application/pdf');
    exception when others then
        get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
    end;
    if v_state <> '55000' or v_detail is distinct from 'NORA_ATTACHMENT_STORAGE_KEY_PENDING_DELETION' then
        v_failures := v_failures || format('6b S3A: referencing a key with a done tombstone -> %s %s, expected rejection',
            v_state, coalesce(v_detail, ''));
    end if;

    insert into nora_private.attachment_storage_deletion_queue (storage_key) values ('s2a1-direct.pdf');

    select count(*) into v_n
    from nora_private.attachment_storage_deletion_queue where storage_key = 's2a1-direct.pdf';
    if v_n <> 2 then
        v_failures := v_failures || format('6b done row blocked a new job: expected 2 rows, got %s', v_n);
    end if;

    if (select count(*) from nora_private.attachment_storage_deletion_queue
        where storage_key = 's2a1-direct.pdf' and state = 'pending') <> 1 then
        v_failures := array_append(v_failures, '6b expected exactly one fresh pending job after the done row');
    end if;

    -- failed_terminal (historical only): the key may be referenced again, and
    -- deleting that reference captures a fresh job through the ordinary path
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
        values (v_cnote, 's2a1-terminal.pdf', 'plan.pdf', 'application/pdf') returning id into v_a;
    delete from public.attachments where id = v_a;
    update nora_private.attachment_storage_deletion_queue
       set state = 'failed_terminal', completed_at = now(),
           last_error_code = 'storage_forbidden', last_error_at = now()
     where storage_key = 's2a1-terminal.pdf' and state = 'pending';

    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
        values (v_cnote, 's2a1-terminal.pdf', 'plan.pdf', 'application/pdf') returning id into v_a;
    delete from public.attachments where id = v_a;

    if (select count(*) from nora_private.attachment_storage_deletion_queue
        where storage_key = 's2a1-terminal.pdf') <> 2
       or (select count(*) from nora_private.attachment_storage_deletion_queue
           where storage_key = 's2a1-terminal.pdf' and state = 'pending') <> 1 then
        v_failures := array_append(v_failures, '6b failed_terminal blocked a new job for the same key');
    end if;

    -- ---- 7b. UPDATE creates no job -----------------------------------------
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
        values (v_cnote, 's2a1-update.pdf', 'plan.pdf', 'application/pdf') returning id into v_a;
    -- public.attachments has no UPDATE policy and no UPDATE privilege for any
    -- API role; postgres can still write, which is exactly the harshest case.
    update public.attachments set file_name = 'plan-neu.pdf' where id = v_a;

    if (select count(*) from nora_private.attachment_storage_deletion_queue
        where storage_key = 's2a1-update.pdf') <> 0 then
        v_failures := array_append(v_failures, '7b UPDATE created a queue job');
    end if;

    -- ---- 7c. blank / oversized storage_key backstop ------------------------
    v_state := 'accepted';
    begin
        insert into nora_private.attachment_storage_deletion_queue (storage_key) values ('   ');
    exception when check_violation then
        v_state := 'rejected';
    end;
    if v_state <> 'rejected' then
        v_failures := array_append(v_failures, '7c a whitespace-only storage_key was accepted by the queue');
    end if;

    v_state := 'accepted';
    begin
        insert into nora_private.attachment_storage_deletion_queue (storage_key)
        values (repeat('x', 513));
    exception when check_violation then
        v_state := 'rejected';
    end;
    if v_state <> 'rejected' then
        v_failures := array_append(v_failures, '7c an over-long storage_key was accepted by the queue');
    end if;

    -- ---- 7d. state vocabulary is closed ------------------------------------
    v_state := 'accepted';
    begin
        insert into nora_private.attachment_storage_deletion_queue (storage_key, state)
        values ('s2a1-badstate.pdf', 'deleted');
    exception when check_violation then
        v_state := 'rejected';
    end;
    if v_state <> 'rejected' then
        v_failures := array_append(v_failures, '7d an unknown state was accepted');
    end if;

    -- ---- 7e. claim / completed invariants ----------------------------------
    v_state := 'accepted';
    begin
        insert into nora_private.attachment_storage_deletion_queue (storage_key, state, claimed_at)
        values ('s2a1-badclaim.pdf', 'claimed', now());   -- claimed_by missing
    exception when check_violation then
        v_state := 'rejected';
    end;
    if v_state <> 'rejected' then
        v_failures := array_append(v_failures, '7e a claimed job without claimed_by was accepted');
    end if;

    v_state := 'accepted';
    begin
        insert into nora_private.attachment_storage_deletion_queue (storage_key, state)
        values ('s2a1-baddone.pdf', 'done');              -- completed_at missing
    exception when check_violation then
        v_state := 'rejected';
    end;
    if v_state <> 'rejected' then
        v_failures := array_append(v_failures, '7e a done job without completed_at was accepted');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (behaviour):\n%', array_to_string(v_failures, E'\n');
    end if;

    raise notice 'OK 5. cascade proof: direct, contact_note, deal_note, contact, deal, company';
    raise notice 'OK 6. idempotency: duplicate intent is a NO-OP, terminal rows do not block a future intent; S3A: re-reference under an active intent or a done tombstone is rejected';
    raise notice 'OK 7. negatives: INSERT/UPDATE enqueue nothing, invariants enforced';

    raise exception 'ROLLBACK_W8C_S2A1_TEST';
exception
    when others then
        if sqlerrm = 'ROLLBACK_W8C_S2A1_TEST' then
            raise notice 'behaviour fixtures rolled back';
        else
            raise;
        end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. CONFLICT PRECISION — the intended conflict is suppressed, no other one
--
-- The enqueue names its conflict target explicitly. This section is what keeps
-- it explicit: a bare `on conflict do nothing` arbitrates over EVERY unique
-- index, so a PRIMARY KEY conflict would be swallowed too and the business
-- DELETE would commit having silently lost the deletion intent — the one
-- failure this queue exists to prevent.
--
-- The two halves must therefore behave DIFFERENTLY, and the test only has
-- meaning because it distinguishes them:
--   A. duplicate ACTIVE storage_key  -> suppressed, DELETE succeeds
--   B. unrelated PRIMARY KEY conflict -> propagates, DELETE rolls back
-- ---------------------------------------------------------------------------
do $$
declare
    v_admin    uuid := gen_random_uuid();
    v_office   uuid := gen_random_uuid();
    v_ad bigint; v_o bigint;
    v_company bigint; v_contact bigint; v_cnote bigint; v_a bigint;
    v_n bigint; v_deleted int;
    v_raised boolean; v_state text;
    v_failures text[] := '{}';
begin
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values
      (v_admin, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','w8c-s2a1-conflict-admin@nora.test','x',now(),'{"provider":"email","providers":["email"]}','{"first_name":"Ada","last_name":"Admin"}',now(),now()),
      (v_office,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','w8c-s2a1-conflict-office@nora.test','x',now(),'{"provider":"email","providers":["email"]}','{"first_name":"Olaf","last_name":"Office"}',now(),now());
    select id into v_ad from public.sales where user_id = v_admin;
    select id into v_o  from public.sales where user_id = v_office;
    perform nora_private.apply_sales_role_change(v_ad, 'admin',  false);
    perform nora_private.apply_sales_role_change(v_o,  'office', false);

    insert into public.companies (name, sales_id) values ('W8-C S2A1 Konflikt', v_o) returning id into v_company;
    insert into public.contacts (first_name, last_name, company_id, sales_id)
        values ('Kon', 'Flikt', v_company, v_o) returning id into v_contact;
    insert into public.contact_notes (contact_id, text, date, sales_id)
        values (v_contact, 'Konflikt', now(), v_o) returning id into v_cnote;

    -- ---- 9A. the INTENDED conflict: duplicate ACTIVE storage_key ----------
    -- An active job already holds this key, so the intent is already captured.
    -- Since W8-C S3A (20260919120000) reference admission rejects a NEW
    -- reference to a key with an active intent, so the pre-existing state is
    -- built in the only admissible order (pre-S3 / manual producer): the
    -- reference first, then the intent recorded directly as postgres.
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
        values (v_cnote, 's2a1-conflict-active.pdf', 'plan.pdf', 'application/pdf') returning id into v_a;

    insert into nora_private.attachment_storage_deletion_queue (storage_key)
        values ('s2a1-conflict-active.pdf');

    v_raised := false;
    begin
        delete from public.attachments where id = v_a;
        get diagnostics v_deleted = row_count;
    exception when others then
        v_raised := true;
    end;

    if v_raised then
        v_failures := array_append(v_failures,
            '9A the duplicate ACTIVE storage_key was NOT suppressed — the business DELETE aborted');
    elsif v_deleted <> 1 then
        v_failures := v_failures || format('9A expected the business DELETE to remove 1 row, got %s', v_deleted);
    end if;

    if (select count(*) from public.attachments where id = v_a) <> 0 then
        v_failures := array_append(v_failures, '9A the attachment row survived although the DELETE should have succeeded');
    end if;

    select count(*) into v_n from nora_private.attachment_storage_deletion_queue
     where storage_key = 's2a1-conflict-active.pdf';
    if v_n <> 1 then
        v_failures := v_failures || format('9A expected exactly 1 active job to remain, got %s', v_n);
    end if;

    -- ---- 9B. an UNRELATED conflict: the PRIMARY KEY ------------------------
    -- `id` is `generated BY DEFAULT as identity`, so an explicit id is accepted
    -- and does NOT advance the sequence. That models an operator or S2A2 data
    -- fix and leaves the sequence behind the maximum id. The next capture hits
    -- a PK conflict, which has NOTHING to do with active-key idempotency and
    -- must therefore abort the deletion instead of being swallowed.
    insert into nora_private.attachment_storage_deletion_queue (id, storage_key)
        values (999999, 's2a1-conflict-unrelated.pdf');
    perform setval(pg_get_serial_sequence('nora_private.attachment_storage_deletion_queue','id'), 999998, true);

    -- a DISTINCT storage key: the partial active-key index cannot be the arbiter
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
        values (v_cnote, 's2a1-conflict-distinct.pdf', 'plan.pdf', 'application/pdf') returning id into v_a;

    v_raised := false; v_state := null;
    begin
        delete from public.attachments where id = v_a;
    exception when others then
        v_raised := true; v_state := sqlstate;
    end;

    if not v_raised then
        v_failures := array_append(v_failures,
            '9B the unrelated PRIMARY KEY conflict was SWALLOWED — the deletion intent was silently lost');
    elsif v_state <> '23505' then
        v_failures := v_failures || format('9B expected a unique_violation (23505) to propagate, got SQLSTATE %s', v_state);
    end if;

    -- the outer business DELETE must have rolled back with it
    if (select count(*) from public.attachments where id = v_a) <> 1 then
        v_failures := array_append(v_failures,
            '9B the attachment row was deleted although its deletion intent could not be captured');
    end if;

    -- and no job may exist for that key
    if (select count(*) from nora_private.attachment_storage_deletion_queue
        where storage_key = 's2a1-conflict-distinct.pdf') <> 0 then
        v_failures := array_append(v_failures, '9B a job was captured despite the aborted insert');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (conflict precision):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK 9. conflict precision: active-key duplicate suppressed, unrelated PK conflict propagates and rolls the DELETE back';

    raise exception 'ROLLBACK_W8C_S2A1_TEST';
exception
    when others then
        if sqlerrm = 'ROLLBACK_W8C_S2A1_TEST' then
            raise notice 'conflict-precision fixtures rolled back';
        else
            raise;
        end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. THE SECURITY DEFINER BOUNDARY, exercised by a REAL authenticated caller
--
-- Sections 5–7 run as postgres, which owns everything and therefore proves
-- nothing about the boundary. The capture only works in production because a
-- caller with NO privilege on the queue reaches it through the definer
-- function and through nothing else. That is what is asserted here, with a
-- structurally valid JWT and a LIVE auth.sessions binding — and with the
-- matching negative, an identical office identity whose only difference is the
-- missing session row.
-- ---------------------------------------------------------------------------
do $$
declare
    v_admin  uuid := gen_random_uuid();
    v_office uuid := gen_random_uuid();
    v_nosess uuid := gen_random_uuid();
    v_ad bigint; v_o bigint; v_ns bigint;
    v_company bigint; v_contact bigint; v_cnote bigint; v_cnote2 bigint; v_a bigint;
    v_n bigint; v_deleted int;
    v_ok boolean; v_state text;
    v_failures text[] := '{}';
begin
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values
      (v_admin, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','w8c-s2a1-definer-admin@nora.test','x',now(),'{"provider":"email","providers":["email"]}','{"first_name":"Ada","last_name":"Admin"}',now(),now()),
      (v_office,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','w8c-s2a1-definer-office@nora.test','x',now(),'{"provider":"email","providers":["email"]}','{"first_name":"Olaf","last_name":"Office"}',now(),now()),
      (v_nosess,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','w8c-s2a1-definer-nosession@nora.test','x',now(),'{"provider":"email","providers":["email"]}','{"first_name":"Nina","last_name":"Nosession"}',now(),now());
    select id into v_ad from public.sales where user_id = v_admin;
    select id into v_o  from public.sales where user_id = v_office;
    select id into v_ns from public.sales where user_id = v_nosess;
    perform nora_private.apply_sales_role_change(v_ad, 'admin',  false);
    perform nora_private.apply_sales_role_change(v_o,  'office', false);
    -- active admin, identical to v_admin; the ONLY difference is that it
    -- deliberately receives no auth.sessions row. Admin, because since W8-C
    -- S3A the API-reachable capture path is the note DELETE (is_admin).
    perform nora_private.apply_sales_role_change(v_ns, 'admin', false);

    insert into auth.sessions (id, user_id, created_at, updated_at, aal)
        values (v_office, v_office, now(), now(), 'aal1'),
               (v_admin,  v_admin,  now(), now(), 'aal1');

    insert into public.companies (name, sales_id) values ('W8-C S2A1 Definer', v_o) returning id into v_company;
    insert into public.contacts (first_name, last_name, company_id, sales_id)
        values ('Def', 'Iner', v_company, v_o) returning id into v_contact;
    insert into public.contact_notes (contact_id, text, date, sales_id)
        values (v_contact, 'Definer', now(), v_o) returning id into v_cnote;
    insert into public.contact_notes (contact_id, text, date, sales_id)
        values (v_contact, 'Definer ohne Sitzung', now(), v_o) returning id into v_cnote2;

    -- ---- 10a. the caller holds nothing, in the catalog ---------------------
    if has_table_privilege('authenticated','nora_private.attachment_storage_deletion_queue','SELECT')
       or has_table_privilege('authenticated','nora_private.attachment_storage_deletion_queue','INSERT') then
        v_failures := array_append(v_failures, '10a authenticated holds a direct privilege on the queue');
    end if;
    if has_function_privilege('authenticated','nora_private.enqueue_attachment_storage_deletion()','EXECUTE') then
        v_failures := array_append(v_failures, '10a authenticated holds EXECUTE on the capture function');
    end if;

    -- ---- 10b. the real authenticated capture path ---------------------------
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
        values (v_cnote, 's2a1-definer.pdf', 'plan.pdf', 'application/pdf') returning id into v_a;

    perform set_config('request.jwt.claims',
        json_build_object('role','authenticated','sub',v_admin::text,'session_id',v_admin::text)::text, true);
    set local role authenticated;

    -- the queue is unreachable directly ...
    v_ok := true;
    begin
        perform count(*) from nora_private.attachment_storage_deletion_queue;
    exception when insufficient_privilege then v_ok := false;
    end;
    if v_ok then
        v_failures := array_append(v_failures, '10b authenticated could read the queue directly');
    end if;

    -- ... and so is the capture function
    v_ok := true; v_state := null;
    begin
        execute 'select nora_private.enqueue_attachment_storage_deletion()';
    exception when others then v_ok := false; v_state := sqlstate;
    end;
    if v_ok then
        v_failures := array_append(v_failures, '10b authenticated could call the capture function directly');
    elsif v_state <> '42501' then
        v_failures := v_failures || format('10b the direct function call failed with %s, expected 42501 (no EXECUTE)', v_state);
    end if;

    -- ... and since W8-C S3A so is a direct metadata DELETE, even for an admin
    v_ok := true; v_state := null;
    begin
        delete from public.attachments where id = v_a;
    exception when others then v_ok := false; v_state := sqlstate;
    end;
    if v_ok then
        v_failures := array_append(v_failures, '10b authenticated could DELETE from public.attachments directly (S3A revoked it)');
    elsif v_state <> '42501' then
        v_failures := v_failures || format('10b the direct attachment DELETE failed with %s, expected 42501 (no privilege)', v_state);
    end if;

    -- ... yet deleting the owning note works and captures through the definer
    delete from public.contact_notes where id = v_cnote;
    get diagnostics v_deleted = row_count;

    reset role;
    perform set_config('request.jwt.claims', null, true);

    if v_deleted <> 1 then
        v_failures := v_failures || format('10b the authenticated note DELETE removed %s row(s), expected 1', v_deleted);
    end if;
    if (select count(*) from public.attachments where id = v_a) <> 0 then
        v_failures := array_append(v_failures, '10b the note DELETE did not cascade to the attachment row');
    end if;

    select count(*) into v_n from nora_private.attachment_storage_deletion_queue
     where storage_key = 's2a1-definer.pdf' and state = 'pending';
    if v_n <> 1 then
        v_failures := v_failures || format('10b expected exactly 1 pending job through the definer boundary, got %s', v_n);
    end if;

    -- ---- 10c. the negative: same admin identity, no live session -----------
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
        values (v_cnote2, 's2a1-definer-nosession.pdf', 'plan.pdf', 'application/pdf') returning id into v_a;

    perform set_config('request.jwt.claims',
        json_build_object('role','authenticated','sub',v_nosess::text,'session_id',v_nosess::text)::text, true);
    set local role authenticated;
    delete from public.contact_notes where id = v_cnote2;
    get diagnostics v_deleted = row_count;
    reset role;
    perform set_config('request.jwt.claims', null, true);

    if v_deleted <> 0 then
        v_failures := v_failures || format('10c an admin without a live session deleted %s note(s)', v_deleted);
    end if;
    if (select count(*) from public.attachments where id = v_a) <> 1 then
        v_failures := array_append(v_failures, '10c the attachment row did not survive the blind delete');
    end if;
    if (select count(*) from nora_private.attachment_storage_deletion_queue
        where storage_key = 's2a1-definer-nosession.pdf') <> 0 then
        v_failures := array_append(v_failures, '10c a no-session admin produced a queue job');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (definer boundary):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK 10. definer boundary: privilege-less authenticated admin captures exactly one job via the note DELETE cascade, a direct attachment DELETE is denied (S3A); no live session captures none';

    raise exception 'ROLLBACK_W8C_S2A1_TEST';
exception
    when others then
        if sqlerrm = 'ROLLBACK_W8C_S2A1_TEST' then
            raise notice 'definer-boundary fixtures rolled back';
        else
            raise;
        end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. FAIL-CLOSED ATOMICITY — a failed capture must abort the deletion
--
-- If capture can fail while the metadata row disappears anyway, the storage
-- object is stranded with nothing recording that it should go. The failure is
-- induced with a temporary CHECK constraint — deliberately NOT a unique
-- violation, so it cannot be confused with the intended active-key conflict of
-- section 9A — and the constraint is dropped again inside this rolled-back
-- block. No runtime object is modified to make this test pass. Since W8-C S3A
-- (20260919120000) no API role may DELETE from public.attachments directly;
-- the business delete is therefore a real admin deleting the owning note, whose
-- FK cascade fires the capture - the note must survive together with the row.
-- ---------------------------------------------------------------------------
do $$
declare
    v_admin  uuid := gen_random_uuid();
    v_office uuid := gen_random_uuid();
    v_ad bigint; v_o bigint;
    v_company bigint; v_contact bigint; v_cnote bigint; v_a bigint;
    v_raised boolean; v_state text;
    v_failures text[] := '{}';
begin
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values
      (v_admin, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','w8c-s2a1-atomic-admin@nora.test','x',now(),'{"provider":"email","providers":["email"]}','{"first_name":"Ada","last_name":"Admin"}',now(),now()),
      (v_office,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','w8c-s2a1-atomic-office@nora.test','x',now(),'{"provider":"email","providers":["email"]}','{"first_name":"Olaf","last_name":"Office"}',now(),now());
    select id into v_ad from public.sales where user_id = v_admin;
    select id into v_o  from public.sales where user_id = v_office;
    perform nora_private.apply_sales_role_change(v_ad, 'admin',  false);
    perform nora_private.apply_sales_role_change(v_o,  'office', false);
    insert into auth.sessions (id, user_id, created_at, updated_at, aal)
        values (v_office, v_office, now(), now(), 'aal1'),
               (v_admin,  v_admin,  now(), now(), 'aal1');

    insert into public.companies (name, sales_id) values ('W8-C S2A1 Atomar', v_o) returning id into v_company;
    insert into public.contacts (first_name, last_name, company_id, sales_id)
        values ('Ato', 'Mar', v_company, v_o) returning id into v_contact;
    insert into public.contact_notes (contact_id, text, date, sales_id)
        values (v_contact, 'Atomar', now(), v_o) returning id into v_cnote;

    execute 'alter table nora_private.attachment_storage_deletion_queue
             add constraint tmp_s2a1_atomicity_probe_check
             check (storage_key <> ''s2a1-atomicity.pdf'')';

    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
        values (v_cnote, 's2a1-atomicity.pdf', 'plan.pdf', 'application/pdf') returning id into v_a;

    perform set_config('request.jwt.claims',
        json_build_object('role','authenticated','sub',v_admin::text,'session_id',v_admin::text)::text, true);

    v_raised := false; v_state := null;
    begin
        set local role authenticated;
        delete from public.contact_notes where id = v_cnote;
        reset role;
    exception when others then
        v_raised := true; v_state := sqlstate;
    end;
    reset role;
    perform set_config('request.jwt.claims', null, true);

    if not v_raised then
        v_failures := array_append(v_failures,
            '11 the business DELETE succeeded although the capture insert failed — deletion intent silently lost');
    elsif v_state <> '23514' then
        v_failures := v_failures || format('11 expected a check_violation (23514) to propagate, got SQLSTATE %s', v_state);
    end if;

    if (select count(*) from public.attachments where id = v_a) <> 1 then
        v_failures := array_append(v_failures,
            '11 the attachment row was lost although its deletion intent could not be captured');
    end if;
    if (select count(*) from public.contact_notes where id = v_cnote) <> 1 then
        v_failures := array_append(v_failures,
            '11 the owning note was deleted although the cascaded capture failed');
    end if;

    execute 'alter table nora_private.attachment_storage_deletion_queue
             drop constraint tmp_s2a1_atomicity_probe_check';

    if exists (select 1 from pg_constraint
               where conrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
                 and conname = 'tmp_s2a1_atomicity_probe_check') then
        v_failures := array_append(v_failures, '11 the temporary probe constraint was not removed');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (fail-closed atomicity):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK 11. fail-closed: a failed capture aborts the business DELETE (admin note delete -> cascade) and note + attachment row survive';

    raise exception 'ROLLBACK_W8C_S2A1_TEST';
exception
    when others then
        if sqlerrm = 'ROLLBACK_W8C_S2A1_TEST' then
            raise notice 'atomicity fixtures rolled back';
        else
            raise;
        end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. S1 is untouched, and no storage object was involved anywhere
-- ---------------------------------------------------------------------------
do $$
declare
    r          record;
    v_priv     text;
    v_failures text[] := '{}';
begin
    -- the privilege matrix on public.attachments is exactly the current one:
    -- S1 granted SELECT, INSERT, DELETE; W8-C S3A (20260919120000) revoked the
    -- direct INSERT / DELETE (database-owned writers only). service_role and
    -- anon never gained anything.
    for r in
        select * from (values
            ('authenticated', 'SELECT'),
            ('anon',          ''),
            ('service_role',  '')
        ) as t(grantee, privs)
    loop
        foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE'] loop
            if has_table_privilege(r.grantee, 'public.attachments', v_priv)
               is distinct from (v_priv = any (string_to_array(r.privs, ','))) then
                v_failures := v_failures || format('privilege regression: %s on public.attachments for %s',
                    v_priv, r.grantee);
            end if;
        end loop;
    end loop;

    -- the queue is empty after a rolled-back run: S2A1 backfills nothing
    if (select count(*) from nora_private.attachment_storage_deletion_queue) <> 0 then
        v_failures := array_append(v_failures,
            'the queue is not empty — S2A1 performs no backfill and the test fixtures must roll back');
    end if;

    -- W8-B boundary: still exactly the two storage policies, still no physical
    -- delete path anywhere in the database
    if (select count(*) from pg_policies
        where schemaname = 'storage' and tablename = 'objects') <> 2 then
        v_failures := array_append(v_failures,
            'the storage.objects policy set changed — S2A1 must not touch W8-B');
    end if;

    if to_regprocedure('public.cleanup_note_attachments()') is not null
       or to_regprocedure('public.get_note_attachments_function_url()') is not null then
        v_failures := array_append(v_failures,
            'a removed W8-B function reappeared — the old pg_net delete path must stay gone');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (S1/W8-B boundary):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK 8. public.attachments privilege matrix = S3A (authenticated SELECT only), queue empty, W8-B boundary intact';
end;
$$;

\echo '=== W8-C S2A1 verification: ALL CHECKS PASSED ==='
