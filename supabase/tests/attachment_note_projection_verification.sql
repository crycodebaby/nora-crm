-- Nora W8-C S3B — atomic note-attachment projection: database contract verification
--
-- Self-contained and rollback-safe: the helpers live in pg_temp (dropped at
-- disconnect), every fixture is created inside an explicit transaction that
-- ends with ROLLBACK. Safe at any point after a fresh
-- `npx supabase db reset --local`, outside the RBAC setup -> teardown window
-- (21-agent-runbooks.md section 5): the owner-only ACL assertions would
-- otherwise see the test role's EXECUTE grants.
--
-- Usage (local only):
--   docker exec -i supabase_db_atomic-crm-demo psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/attachment_note_projection_verification.sql
--
-- What it proves (single session; the real multi-session races are in
-- attachment_note_projection_concurrency_runner.ps1):
--    1. shape: validator / core / dispatcher - owner postgres, exact settings
--       and volatility (core VOLATILE), owner-only ACL, no API EXECUTE, no key
--       lock / queue execution / resolver / network / dynamic SQL / exception
--       handler; exactly four AFTER ROW triggers with their WHEN guards, no
--       UPDATE OF list, no DELETE projection; public.attachments untouched
--    2. API boundary: no API role can call the validator or the core (42501)
--    3. grammar v1 on both note tables: every rejected form -> 22023
--       NORA_ATTACHMENT_REFERENCE_INVALID (element number, never the key),
--       JSON unchanged, nothing projected; every accepted form projects exactly
--       (byte_size NULL, file_name = title, mime_type = type)
--    4. delta matrix on both note tables: ADD / KEEP / REMOVE, reorder, src-only
--       change, metadata change, duplicates, re-adding a removed key, NULL / {}
--    5. zero work: body-only and identical writes do not invoke the projection
--       (no scan of public.attachments), reorder writes nothing and locks
--       nothing; [P,Q] -> [Q,R] = 1 DELETE + 1 INSERT + 1 capture, key locks
--       exactly P and R
--    6. S3A admission matrix through note writes + whole-statement atomicity
--    7. cross-note: UNIQUE(storage_key) stays authoritative (23505)
--    8. cascades: note / contact / deal / company delete capture every row
--    9. legacy (pre-S4) notes: body-only stays unprojected, the first
--       attachment-changing write reconciles the WHOLE note, a legacy key
--       removed before the first touch is not captured (documented gap), a
--       dirty OLD never blocks a valid NEW
--   10. RBAC: office / service_role writes project through the definer;
--       viewer / disabled / anon cannot; direct public.attachments writes and
--       direct core calls stay denied
--   11. RLS drift: with row_security = off a filtered read raises (42501);
--       control without the setting silently drifts
--   12. scale 0 / 1 / 5 / 20 attachments: writes, captures and key locks = n
--   13. invariants: every projected note equals its JSON; I1; no done row; no
--       Storage object deleted; no HTTP request enqueued
--   14. REPEATABLE READ / SERIALIZABLE: attachment-changing note writes and
--       attachment cascades fail closed (55000
--       NORA_ATTACHMENT_READ_COMMITTED_REQUIRED); key-free writes still work
--
-- NOT proven here: real concurrency (see the runner), S4 backfill, physical
-- deletion (S2B). S3B adds no worker, no Storage call and no path to done.

\set ON_ERROR_STOP on

\echo '=== W8-C S3B: note attachment projection verification ==='

-- ---------------------------------------------------------------------------
-- Session helpers (pg_temp - gone at disconnect)
-- ---------------------------------------------------------------------------
create function pg_temp.s3b_el(p_key text, p_title text default 'datei.pdf', p_type text default 'application/pdf')
returns jsonb language sql immutable as $$
    select jsonb_build_object('path', p_key, 'title', p_title, 'type', p_type)
$$;

create function pg_temp.s3b_src(p_key text, p_origin text default 'http://127.0.0.1:54321')
returns text language sql immutable as $$
    select p_origin || '/storage/v1/object/public/attachments/' || p_key
$$;

-- one statement in its own subtransaction: 'ok' or 'SQLSTATE|DETAIL|MESSAGE'
create function pg_temp.s3b_try(p_sql text)
returns text language plpgsql as $$
declare v_state text; v_detail text; v_msg text;
begin
    execute p_sql;
    return 'ok';
exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail, v_msg = message_text;
    return v_state || '|' || coalesce(v_detail, '') || '|' || coalesce(v_msg, '');
end;
$$;

create function pg_temp.s3b_set(p_table text, p_id bigint, p_arr jsonb[])
returns text language plpgsql as $$
declare v_state text; v_detail text; v_msg text;
begin
    execute format('update public.%I set attachments = $1 where id = $2', p_table) using p_arr, p_id;
    return 'ok';
exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail, v_msg = message_text;
    return v_state || '|' || coalesce(v_detail, '') || '|' || coalesce(v_msg, '');
end;
$$;

create function pg_temp.s3b_parent(p_table text)
returns bigint language plpgsql as $$
begin
    -- s3b_ctx is the per-transaction fixture table (created later)
    return (select c.value from s3b_ctx c where c.key = case p_table when 'contact_notes' then 'contact' else 'deal' end);
end;
$$;

-- a new note: 'ok:<id>' or 'SQLSTATE|DETAIL|MESSAGE'
create function pg_temp.s3b_insert(p_table text, p_arr jsonb[])
returns text language plpgsql as $$
declare v_id bigint; v_state text; v_detail text; v_msg text;
begin
    execute format('insert into public.%I (%I, text, date, attachments) values ($1, %L, now(), $2) returning id',
                   p_table, case p_table when 'contact_notes' then 'contact_id' else 'deal_id' end, 'S3B')
       into v_id using pg_temp.s3b_parent(p_table), p_arr;
    return 'ok:' || v_id;
exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail, v_msg = message_text;
    return v_state || '|' || coalesce(v_detail, '') || '|' || coalesce(v_msg, '');
end;
$$;

create function pg_temp.s3b_note(p_table text)
returns bigint language plpgsql as $$
declare v_res text := pg_temp.s3b_insert(p_table, null);
begin
    if v_res not like 'ok:%' then
        raise exception 'S3B fixture note on % failed: %', p_table, v_res;
    end if;
    return substr(v_res, 4)::bigint;
end;
$$;

create function pg_temp.s3b_json(p_table text, p_id bigint)
returns jsonb[] language plpgsql as $$
declare v jsonb[];
begin
    execute format('select attachments from public.%I where id = $1', p_table) into v using p_id;
    return v;
end;
$$;

create function pg_temp.s3b_keys(p_table text, p_id bigint)
returns text language sql as $$
    select coalesce(string_agg(a.storage_key, ',' order by a.storage_key collate "C"), '')
      from public.attachments a
     where (p_table = 'contact_notes' and a.contact_note_id = p_id)
        or (p_table = 'deal_notes' and a.deal_note_id = p_id)
$$;

-- S6-A: `key=ordinal` in append order. A reorder must NOT move anything here.
create function pg_temp.s3b_ordinals(p_table text, p_id bigint)
returns text language sql as $$
    select coalesce(string_agg(a.storage_key || '=' || a.ordinal::text, ',' order by a.ordinal, a.id), '')
      from public.attachments a
     where (p_table = 'contact_notes' and a.contact_note_id = p_id)
        or (p_table = 'deal_notes' and a.deal_note_id = p_id)
$$;

-- id:xmin per row - an UPDATE changes xmin, a DELETE + INSERT changes id
create function pg_temp.s3b_rowids(p_table text, p_id bigint)
returns text language sql as $$
    select coalesce(string_agg(a.storage_key || '=' || a.id || ':' || a.xmin::text, ',' order by a.storage_key collate "C"), '')
      from public.attachments a
     where (p_table = 'contact_notes' and a.contact_note_id = p_id)
        or (p_table = 'deal_notes' and a.deal_note_id = p_id)
$$;

-- [attachment scans, attachment inserts, deletes, updates, queue inserts, key locks held]
create function pg_temp.s3b_counters()
returns bigint[] language sql volatile as $$
    select array[
        (select coalesce(s.seq_scan, 0) + coalesce(s.idx_scan, 0) from pg_stat_xact_user_tables s where s.relid = 'public.attachments'::regclass),
        (select s.n_tup_ins from pg_stat_xact_user_tables s where s.relid = 'public.attachments'::regclass),
        (select s.n_tup_del from pg_stat_xact_user_tables s where s.relid = 'public.attachments'::regclass),
        (select s.n_tup_upd from pg_stat_xact_user_tables s where s.relid = 'public.attachments'::regclass),
        (select s.n_tup_ins from pg_stat_xact_user_tables s where s.relid = 'nora_private.attachment_storage_deletion_queue'::regclass),
        (select count(*) from pg_locks l
          where l.pid = pg_backend_pid() and l.locktype = 'advisory' and l.objsubid = 2
            and l.classid::bigint = (hashtext('nora_attachment_storage_key')::bigint & 4294967295))]::bigint[]
$$;

create function pg_temp.s3b_diff(p_before bigint[], p_after bigint[])
returns text language sql immutable as $$
    select format('scans=%s ins=%s del=%s upd=%s queue=%s locks=%s',
                  p_after[1] - p_before[1], p_after[2] - p_before[2], p_after[3] - p_before[3],
                  p_after[4] - p_before[4], p_after[5] - p_before[5], p_after[6] - p_before[6])
$$;

create function pg_temp.s3b_locked(p_key text)
returns boolean language sql volatile as $$
    select exists (select 1 from pg_locks l
                    where l.pid = pg_backend_pid() and l.locktype = 'advisory' and l.objsubid = 2
                      and l.classid::bigint = (hashtext('nora_attachment_storage_key')::bigint & 4294967295)
                      and l.objid::bigint = (hashtext(p_key)::bigint & 4294967295))
$$;

create function pg_temp.s3b_update_trigger(p_table text)
returns text language sql immutable as $$
    select case p_table when 'contact_notes' then 'project_contact_note_attachments_after_update_trigger'
                        else 'project_deal_note_attachments_after_update_trigger' end
$$;

-- LEGACY state (pre-S3B history): the array is set with the projection
-- trigger switched off, inside the caller's rolled-back transaction.
create function pg_temp.s3b_plant_legacy(p_table text, p_id bigint, p_arr jsonb[])
returns void language plpgsql as $$
begin
    execute format('alter table public.%I disable trigger %I', p_table, pg_temp.s3b_update_trigger(p_table));
    execute format('update public.%I set attachments = $1 where id = $2', p_table) using p_arr, p_id;
    execute format('alter table public.%I enable trigger %I', p_table, pg_temp.s3b_update_trigger(p_table));
end;
$$;

-- PROJECTED state committed by an earlier transaction: JSON + exact rows,
-- planted without the projection and without admission, so this session holds
-- no key lock for these keys (lock proofs start from zero).
create function pg_temp.s3b_plant_projected(p_table text, p_id bigint, p_arr jsonb[])
returns void language plpgsql as $$
begin
    perform pg_temp.s3b_plant_legacy(p_table, p_id, p_arr);
    alter table public.attachments disable trigger guard_attachment_reference_admission_after_insert_trigger;
    insert into public.attachments (contact_note_id, deal_note_id, storage_key, file_name, mime_type, ordinal)
    select case when p_table = 'contact_notes' then p_id end, case when p_table = 'deal_notes' then p_id end,
           r.storage_key, r.file_name, r.mime_type, r.element_no::integer
      from nora_private.note_attachment_reference_rows(p_arr) as r;
    alter table public.attachments enable trigger guard_attachment_reference_admission_after_insert_trigger;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Shape and hygiene
-- ---------------------------------------------------------------------------
do $$
declare
    r          record;
    v_role     text;
    v_src      text;
    v_token    text;
    v_names    text;
    v_failures text[] := '{}';
begin
    for r in
        select * from (values
            ('nora_private.note_attachment_reference_rows(jsonb[])',            'record',  false, 's', true,  array['search_path=""']),
            ('nora_private.reconcile_note_attachments(bigint,bigint,jsonb[])',  'void',    false, 'v', false, array['search_path=""', 'row_security=off']),
            ('nora_private.project_note_attachments()',                         'trigger', true,  'v', false, array['search_path=""', 'row_security=off'])
        ) as t(sig, rettype, secdef, volatility, retset, config)
    loop
        if to_regprocedure(r.sig) is null then
            v_failures := v_failures || format('1a %s is missing', r.sig);
            continue;
        end if;
        if not exists (select 1 from pg_proc p join pg_language l on l.oid = p.prolang
                       join pg_namespace n on n.oid = p.pronamespace
                       where p.oid = to_regprocedure(r.sig) and n.nspname = 'nora_private'
                         and p.prorettype = r.rettype::regtype and p.proretset = r.retset
                         and l.lanname = 'plpgsql' and p.provolatile = r.volatility::"char"
                         and p.prosecdef = r.secdef and pg_get_userbyid(p.proowner) = 'postgres'
                         and p.proconfig = r.config) then
            v_failures := v_failures || format('1a %s: wrong return type / language / volatility / definer / owner / settings', r.sig);
        end if;
        if (select p.proacl is null from pg_proc p where p.oid = to_regprocedure(r.sig))
           or exists (select 1 from pg_proc p, aclexplode(p.proacl) acl
                      where p.oid = to_regprocedure(r.sig)
                        and (acl.grantee = 0 or pg_get_userbyid(acl.grantee) <> 'postgres')) then
            v_failures := v_failures || format('1a %s carries an ACL entry for a role other than postgres', r.sig);
        end if;
        foreach v_role in array array['public', 'anon', 'authenticated', 'service_role'] loop
            if has_function_privilege(v_role, r.sig, 'EXECUTE') then
                v_failures := v_failures || format('1a %s holds EXECUTE on %s', v_role, r.sig);
            end if;
        end loop;
        select p.prosrc into v_src from pg_proc p where p.oid = to_regprocedure(r.sig);
        foreach v_token in array array['lock_attachment_storage_key', 'attachment_deletion_claim_next',
                                       'attachment_deletion_inspect', 'attachment_deletion_fail',
                                       'attachment_storage_key_liveness', 'attachment_storage_deletion_queue',
                                       'pg_advisory', 'net.http', 'pg_net', 'http_post', 'http_get',
                                       'storage.objects', 'storage.buckets', 'functions/v1', 'supabase.co',
                                       'dblink', 'pg_background', 'execute ', 'transaction_isolation'] loop
            if position(v_token in lower(v_src)) > 0 then
                v_failures := v_failures || format('1b %s references %s', r.sig, v_token);
            end if;
        end loop;
        if v_src ~* 'exception\s+when' then
            v_failures := v_failures || format('1b %s swallows exceptions', r.sig);
        end if;
    end loop;

    -- 1c. the core is VOLATILE (fresh snapshot per statement, and it writes)
    if (select p.provolatile from pg_proc p
        where p.oid = to_regprocedure('nora_private.reconcile_note_attachments(bigint,bigint,jsonb[])')) is distinct from 'v' then
        v_failures := array_append(v_failures, '1c the reconcile core is not VOLATILE');
    end if;

    -- 1d. minimal delta, REMOVE before ADD, ADD in COLLATE "C" order, no UPDATE
    select p.prosrc into v_src from pg_proc p
     where p.oid = to_regprocedure('nora_private.reconcile_note_attachments(bigint,bigint,jsonb[])');
    if (select count(*) from regexp_matches(v_src, 'delete from public\.attachments', 'g')) <> 1
       or (select count(*) from regexp_matches(v_src, 'insert into public\.attachments', 'g')) <> 1
       or v_src ~* 'update\s+public\.attachments'
       or position('delete from public.attachments' in v_src) > position('insert into public.attachments' in v_src)
       or position('order by d.storage_key collate "C"' in v_src) = 0 then
        v_failures := array_append(v_failures, '1d the core is not REMOVE (DELETE) -> ADD (INSERT, COLLATE "C") without UPDATE');
    end if;

    -- 1d2 (S6-A). The check above cannot tell the S6-A body from the S3B one,
    -- and it cannot tell it from the NAIVE `ordinal := element_no` body either
    -- - which applies green and then raises 23505 on a user's next note save.
    -- So: the append base is read exactly once, BETWEEN the REMOVE delete and
    -- the ADD insert, and the ADD inserts v_base + element_no.
    if (select count(*) from regexp_matches(v_src, 'select coalesce\(max\(a\.ordinal\), 0\)', 'g')) <> 1
       or position('select coalesce(max(a.ordinal), 0)' in v_src) < position('delete from public.attachments' in v_src)
       or position('select coalesce(max(a.ordinal), 0)' in v_src) > position('insert into public.attachments' in v_src)
       or position('(v_base + d.element_no)::integer' in v_src) = 0
       or position('with ordinality' in substr(v_src, position('insert into public.attachments' in v_src))) = 0 then
        v_failures := array_append(v_failures,
            '1d2 the core does not append v_base + element_no with v_base read between REMOVE and ADD');
    end if;

    -- 1d3 (S6-A, contract 18 SCOPE). From the ADD onwards there is EXACTLY one
    -- ORDER BY and it is the collation-pinned one: a second ordering would make
    -- the insert order - and with it the ordinals - depend on something else.
    if (select count(*) from regexp_matches(substr(v_src, position('insert into public.attachments' in v_src)),
                                            'order by', 'g')) <> 1
       or position('order by d.storage_key collate "C"' in substr(v_src, position('insert into public.attachments' in v_src))) = 0 then
        v_failures := array_append(v_failures, '1d3 the ADD does not end in exactly one ORDER BY d.storage_key COLLATE "C"');
    end if;

    -- 1e. trigger inventory: exactly four, AFTER ROW, INSERT / UPDATE, no column list
    select string_agg(t.tgname || '@' || t.tgrelid::regclass::text, ', ' order by t.tgname) into v_names
      from pg_trigger t
     where not t.tgisinternal and t.tgfoid = to_regprocedure('nora_private.project_note_attachments()');
    if v_names is distinct from
           'project_contact_note_attachments_after_insert_trigger@contact_notes, project_contact_note_attachments_after_update_trigger@contact_notes, '
        || 'project_deal_note_attachments_after_insert_trigger@deal_notes, project_deal_note_attachments_after_update_trigger@deal_notes' then
        v_failures := v_failures || format('1e unexpected projection trigger inventory: %s', coalesce(v_names, '<none>'));
    end if;
    for r in
        select t.tgname, t.tgtype, t.tgattr::text as cols, t.tgenabled, pg_get_triggerdef(t.oid) as def
          from pg_trigger t
         where not t.tgisinternal and t.tgfoid = to_regprocedure('nora_private.project_note_attachments()')
    loop
        if (r.tgtype & 1) <> 1 or (r.tgtype & 2) <> 0 or (r.tgtype & 64) <> 0 or r.cols <> '' or r.tgenabled <> 'O'
           or (r.tgtype & 28) <> (case when r.tgname like '%insert%' then 4 else 16 end)
           or (r.tgname like '%insert%'
               and position('WHEN ((cardinality(new.attachments) > 0))' in r.def) = 0)
           or (r.tgname like '%update%'
               and position('WHEN ((COALESCE(old.attachments, ''{}''::jsonb[]) IS DISTINCT FROM COALESCE(new.attachments, ''{}''::jsonb[])))' in r.def) = 0) then
            v_failures := v_failures || format('1e %s is not the AFTER ROW trigger with its WHEN guard: %s', r.tgname, r.def);
        end if;
    end loop;
    if exists (select 1 from pg_trigger t
               where t.tgrelid in ('public.contact_notes'::regclass, 'public.deal_notes'::regclass)
                 and not t.tgisinternal and (t.tgtype & 8) = 8
                 and t.tgfoid = to_regprocedure('nora_private.project_note_attachments()')) then
        v_failures := array_append(v_failures, '1e a note DELETE trigger calls the projection');
    end if;

    -- 1f. public.attachments: S3A triggers and the single-writer matrix unchanged
    select string_agg(t.tgname, ', ' order by t.tgname) into v_names
      from pg_trigger t where t.tgrelid = 'public.attachments'::regclass and not t.tgisinternal;
    if v_names is distinct from 'enqueue_attachment_storage_deletion_after_delete_trigger, '
                             || 'guard_attachment_reference_admission_after_insert_trigger, '
                             || 'guard_attachment_storage_key_immutable_before_update_trigger' then
        v_failures := v_failures || format('1f public.attachments triggers changed: %s', coalesce(v_names, '<none>'));
    end if;
    for r in select * from (values ('authenticated', 'SELECT'), ('anon', ''), ('service_role', '')) as t(grantee, privs) loop
        if (select string_agg(pr, ',' order by pr) from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) pr
            where has_table_privilege(r.grantee, 'public.attachments', pr)) is distinct from nullif(r.privs, '') then
            v_failures := v_failures || format('1f %s privileges on public.attachments are not %s', r.grantee, coalesce(nullif(r.privs, ''), 'none'));
        end if;
    end loop;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (shape):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  1. shape: 3 functions (validator STABLE / core VOLATILE INVOKER / dispatcher DEFINER), owner-only ACL, hygiene; 4 AFTER ROW triggers with WHEN guards, no UPDATE OF, no DELETE projection; public.attachments untouched';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. API boundary: no API role can call the validator or the core
-- ---------------------------------------------------------------------------
do $$
declare
    v_role     text;
    v_sql      text;
    v_state    text;
    v_failures text[] := '{}';
begin
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
        foreach v_sql in array array[
            'select nora_private.reconcile_note_attachments(1, null, null)',
            'select * from nora_private.note_attachment_reference_rows(null)'] loop
            v_state := 'no error';
            begin
                execute format('set local role %I', v_role);
                execute v_sql;
            exception when others then
                v_state := sqlstate;
            end;
            reset role;
            if v_state <> '42501' then
                v_failures := v_failures || format('2 %s: %s -> %s, expected 42501', v_role, v_sql, v_state);
            end if;
        end loop;
    end loop;
    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (API boundary):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  2. API boundary: anon / authenticated / service_role cannot execute the validator or the core (42501)';
end;
$$;

-- ---------------------------------------------------------------------------
-- Rolled-back fixture transaction (READ COMMITTED) for sections 3-13
-- ---------------------------------------------------------------------------
begin;

create temp table s3b_ctx (key text primary key, value bigint) on commit drop;
create temp table s3b_baseline (key text primary key, value bigint) on commit drop;

do $$
declare
    v_company bigint; v_contact bigint; v_deal bigint;
begin
    insert into s3b_baseline values
        ('storage_objects', (select count(*) from storage.objects)),
        ('http_requests',   (select count(*) from net.http_request_queue)),
        ('queue_rows',      (select count(*) from nora_private.attachment_storage_deletion_queue));
    insert into public.companies (name) values ('W8-C S3B Kunde') returning id into v_company;
    insert into public.contacts (first_name, last_name, company_id)
        values ('Pro', 'Jektion', v_company) returning id into v_contact;
    insert into public.deals (name, company_id, stage)
        values ('W8-C S3B Vorgang', v_company, 'opportunity') returning id into v_deal;
    insert into s3b_ctx values ('company', v_company), ('contact', v_contact), ('deal', v_deal);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Grammar v1 on both note tables
-- ---------------------------------------------------------------------------
do $$
declare
    r          record;
    v_table    text;
    v_id       bigint;
    v_res      text;
    v_notes    bigint;
    v_failures text[] := '{}';
    c_bad      constant text := '22023|NORA_ATTACHMENT_REFERENCE_INVALID|';
    c_k        constant text := 's3b-gram.pdf';
begin
    foreach v_table in array array['contact_notes', 'deal_notes'] loop
        v_id := pg_temp.s3b_note(v_table);

        -- ---- 3a. rejected forms: whole write rejected, element number named, key never
        for r in
            select * from (values
                ('SQL NULL member',              array[null::jsonb],                                                   'element 1 is invalid (not a JSON object)'),
                ('JSON null member',             array['null'::jsonb],                                                 'element 1 is invalid (not a JSON object)'),
                ('string member',                array['"s3b-gram.pdf"'::jsonb],                                       'element 1 is invalid (not a JSON object)'),
                ('number member',                array['42'::jsonb],                                                   'element 1 is invalid (not a JSON object)'),
                ('array member',                 array['[]'::jsonb],                                                   'element 1 is invalid (not a JSON object)'),
                ('boolean member',               array['true'::jsonb],                                                 'element 1 is invalid (not a JSON object)'),
                ('missing path',                 array[pg_temp.s3b_el(c_k) - 'path'],                                  'element 1 is invalid (path)'),
                ('JSON null path',               array[pg_temp.s3b_el(c_k) || '{"path":null}'],                        'element 1 is invalid (path)'),
                ('numeric path',                 array[pg_temp.s3b_el(c_k) || '{"path":42}'],                          'element 1 is invalid (path)'),
                ('blank path',                   array[pg_temp.s3b_el('')],                                            'element 1 is invalid (path)'),
                ('padded path',                  array[pg_temp.s3b_el(' ' || c_k)],                                    'element 1 is invalid (path)'),
                ('path with a slash',            array[pg_temp.s3b_el('dir/' || c_k)],                                 'element 1 is invalid (path)'),
                ('path as URL',                  array[pg_temp.s3b_el(pg_temp.s3b_src(c_k))],                          'element 1 is invalid (path)'),
                ('percent-encoded path',         array[pg_temp.s3b_el('s3b%2Fgram.pdf')],                              'element 1 is invalid (path)'),
                ('path .',                       array[pg_temp.s3b_el('.')],                                           'element 1 is invalid (path)'),
                ('path ..',                      array[pg_temp.s3b_el('..')],                                          'element 1 is invalid (path)'),
                ('path of 513 characters',       array[pg_temp.s3b_el(repeat('k', 509) || '.pdf')],                    'element 1 is invalid (path)'),
                ('missing title',                array[pg_temp.s3b_el(c_k) - 'title'],                                 'element 1 is invalid (title)'),
                ('blank title',                  array[pg_temp.s3b_el(c_k, '   ')],                                    'element 1 is invalid (title)'),
                ('numeric title',                array[pg_temp.s3b_el(c_k) || '{"title":7}'],                          'element 1 is invalid (title)'),
                ('title of 256 characters',      array[pg_temp.s3b_el(c_k, repeat('t', 256))],                         'element 1 is invalid (title)'),
                ('missing type',                 array[pg_temp.s3b_el(c_k) - 'type'],                                  'element 1 is invalid (type)'),
                ('blank type',                   array[pg_temp.s3b_el(c_k, 'a.pdf', '')],                              'element 1 is invalid (type)'),
                ('JSON null type',               array[pg_temp.s3b_el(c_k) || '{"type":null}'],                        'element 1 is invalid (type)'),
                ('type of 256 characters',       array[pg_temp.s3b_el(c_k, 'a.pdf', repeat('m', 256))],                'element 1 is invalid (type)'),
                ('numeric src',                  array[pg_temp.s3b_el(c_k) || '{"src":42}'],                           'element 1 is invalid (src)'),
                ('foreign src',                  array[pg_temp.s3b_el(c_k) || '{"src":"https://example.com/file.pdf"}'], 'element 1 is invalid (src)'),
                ('src naming another key',       array[pg_temp.s3b_el(c_k) || jsonb_build_object('src', pg_temp.s3b_src('s3b-other.pdf'))], 'element 1 is invalid (src)'),
                ('src on a foreign origin',      array[pg_temp.s3b_el(c_k) || jsonb_build_object('src', pg_temp.s3b_src(c_k, 'https://attacker.example.net'))], 'element 1 is invalid (src)'),
                ('signed-URL src',               array[pg_temp.s3b_el(c_k) || jsonb_build_object('src', 'http://127.0.0.1:54321/storage/v1/object/sign/attachments/' || c_k || '?token=x')], 'element 1 is invalid (src)'),
                ('relative src',                 array[pg_temp.s3b_el(c_k) || jsonb_build_object('src', '/storage/v1/object/public/attachments/' || c_k)], 'element 1 is invalid (src)'),
                ('data: src',                    array[pg_temp.s3b_el(c_k) || '{"src":"data:application/pdf;base64,AAAA"}'], 'element 1 is invalid (src)'),
                ('blob: src',                    array[pg_temp.s3b_el(c_k) || '{"src":"blob:http://localhost:5173/abc"}'], 'element 1 is invalid (src)'),
                ('pathless import fallback',     array['{"src":"https://example.com/import/s3b-gram.pdf","title":"import.pdf","rawFile":{"name":"import.pdf","type":"application/pdf"}}'::jsonb], 'element 1 is invalid (path)'),
                ('valid, then invalid',          array[pg_temp.s3b_el('s3b-gram-first.pdf'), '42'::jsonb],             'element 2 is invalid (not a JSON object)'),
                ('duplicate path',               array[pg_temp.s3b_el(c_k), pg_temp.s3b_el(c_k)],                      'element 2 repeats the storage key of an earlier element'),
                ('duplicate path, other title',  array[pg_temp.s3b_el(c_k, 'a.pdf'), pg_temp.s3b_el('s3b-gram-x.pdf'), pg_temp.s3b_el(c_k, 'b.pdf')], 'element 3 repeats the storage key of an earlier element'),
                ('two-dimensional array',        array[[pg_temp.s3b_el(c_k)], [pg_temp.s3b_el('s3b-gram-2d.pdf')]],   'not a one-dimensional array')
            ) as t(label, arr, msg)
        loop
            v_res := pg_temp.s3b_set(v_table, v_id, r.arr);
            if v_res not like c_bad || '%' || r.msg || '%' then
                v_failures := v_failures || format('3a %s UPDATE %s -> %s', v_table, r.label, v_res);
            end if;
            if position('s3b-gram' in split_part(v_res, '|', 3)) > 0 or position('example' in split_part(v_res, '|', 3)) > 0 then
                v_failures := v_failures || format('3a %s %s: the message names the key or URL: %s', v_table, r.label, v_res);
            end if;
            if pg_temp.s3b_json(v_table, v_id) is not null or pg_temp.s3b_keys(v_table, v_id) <> '' then
                v_failures := v_failures || format('3a %s %s: the rejected write left JSON or rows behind', v_table, r.label);
            end if;

            -- the same form on INSERT: no note is created
            select count(*) into v_notes from public.contact_notes;
            v_notes := v_notes + (select count(*) from public.deal_notes);
            v_res := pg_temp.s3b_insert(v_table, r.arr);
            if v_res not like c_bad || '%' || r.msg || '%'
               or v_notes <> (select count(*) from public.contact_notes) + (select count(*) from public.deal_notes) then
                v_failures := v_failures || format('3a %s INSERT %s -> %s', v_table, r.label, v_res);
            end if;
        end loop;

        -- ---- 3b. accepted forms project exactly one row with the element's metadata
        for r in
            select * from (values
                ('src absent',                   pg_temp.s3b_el('s3b-ok-1.pdf'),                                                   's3b-ok-1.pdf', 'datei.pdf', 'application/pdf'),
                ('JSON null src',                pg_temp.s3b_el('s3b-ok-2.pdf') || '{"src":null}',                                 's3b-ok-2.pdf', 'datei.pdf', 'application/pdf'),
                ('canonical local src',          pg_temp.s3b_el('s3b-ok-3.pdf') || jsonb_build_object('src', pg_temp.s3b_src('s3b-ok-3.pdf')), 's3b-ok-3.pdf', 'datei.pdf', 'application/pdf'),
                ('canonical production src',     pg_temp.s3b_el('s3b-ok-4.pdf') || jsonb_build_object('src', pg_temp.s3b_src('s3b-ok-4.pdf', 'https://kixxroxtfzbcbzctohex.supabase.co')), 's3b-ok-4.pdf', 'datei.pdf', 'application/pdf'),
                ('rawFile / size / extras',      pg_temp.s3b_el('s3b-ok-5.png', 'Foto.png', 'image/png') || '{"rawFile":{},"size":123,"foo":"bar"}', 's3b-ok-5.png', 'Foto.png', 'image/png'),
                ('legacy key form',              pg_temp.s3b_el('0.8262106278726917.pdf', 'legacy.pdf'),                           '0.8262106278726917.pdf', 'legacy.pdf', 'application/pdf'),
                ('uuid key form',                pg_temp.s3b_el('6f1c1f7e-2a53-4a5e-9d7e-1b1b1b1b1b1b.docx', 'Angebot.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
                                                 '6f1c1f7e-2a53-4a5e-9d7e-1b1b1b1b1b1b.docx', 'Angebot.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
                ('512-character key',            pg_temp.s3b_el(repeat('k', 508) || '.pdf'),                                        repeat('k', 508) || '.pdf', 'datei.pdf', 'application/pdf'),
                ('255-character title and type', pg_temp.s3b_el('s3b-ok-9.pdf', repeat('t', 255), repeat('m', 255)),               's3b-ok-9.pdf', repeat('t', 255), repeat('m', 255))
            ) as t(label, el, k, title, mime)
        loop
            v_res := pg_temp.s3b_set(v_table, v_id, array[r.el]);
            if v_res <> 'ok' or pg_temp.s3b_keys(v_table, v_id) <> r.k
               or not exists (select 1 from public.attachments a
                              where a.storage_key = r.k and a.file_name = r.title and a.mime_type = r.mime
                                and a.byte_size is null
                                and (case v_table when 'contact_notes' then a.contact_note_id else a.deal_note_id end) = v_id
                                and (case v_table when 'contact_notes' then a.deal_note_id else a.contact_note_id end) is null) then
                v_failures := v_failures || format('3b %s %s -> %s, rows %s', v_table, r.label, v_res, pg_temp.s3b_keys(v_table, v_id));
            end if;
            v_res := pg_temp.s3b_set(v_table, v_id, null);
            if v_res <> 'ok' or pg_temp.s3b_keys(v_table, v_id) <> '' then
                v_failures := v_failures || format('3b %s %s: removal -> %s', v_table, r.label, v_res);
            end if;
        end loop;
        -- the removals captured pending intents; clear them so the second
        -- table can reuse the same accepted keys
        delete from nora_private.attachment_storage_deletion_queue
         where storage_key like 's3b-ok-%' or storage_key in ('0.8262106278726917.pdf',
               '6f1c1f7e-2a53-4a5e-9d7e-1b1b1b1b1b1b.docx', repeat('k', 508) || '.pdf');
    end loop;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (grammar):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  3. grammar v1 (contact + deal, UPDATE + INSERT): 38 rejected forms -> 22023 NORA_ATTACHMENT_REFERENCE_INVALID with element number, no key, nothing written; 9 accepted forms project exactly (byte_size NULL)';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Delta matrix on both note tables
-- ---------------------------------------------------------------------------
do $$
declare
    v_table    text;
    v_p        text;
    v_id       bigint;
    v_res      text;
    v_before   bigint[];
    v_ids      text;
    v_row_b    text;
    v_a text; v_b text; v_c text;
    v_ord      text;
    v_failures text[] := '{}';
begin
    foreach v_table in array array['contact_notes', 'deal_notes'] loop
        v_p := case v_table when 'contact_notes' then 'c' else 'd' end;
        v_a := 's3b-' || v_p || '-a.pdf'; v_b := 's3b-' || v_p || '-b.pdf'; v_c := 's3b-' || v_p || '-c.pdf';
        v_id := pg_temp.s3b_note(v_table);

        -- [] -> [A]: one INSERT
        v_before := pg_temp.s3b_counters();
        v_res := pg_temp.s3b_set(v_table, v_id, array[pg_temp.s3b_el(v_a)]);
        if v_res <> 'ok' or pg_temp.s3b_keys(v_table, v_id) <> v_a
           or pg_temp.s3b_diff(v_before, pg_temp.s3b_counters()) not like '% ins=1 del=0 upd=0 queue=0 %' then
            v_failures := v_failures || format('4a %s [] -> [A]: %s %s', v_table, v_res, pg_temp.s3b_diff(v_before, pg_temp.s3b_counters()));
        end if;

        -- [A] -> [A] (identical array): the projection is not even invoked
        v_before := pg_temp.s3b_counters();
        v_res := pg_temp.s3b_set(v_table, v_id, array[pg_temp.s3b_el(v_a)]);
        if v_res <> 'ok' or pg_temp.s3b_diff(v_before, pg_temp.s3b_counters()) <> 'scans=0 ins=0 del=0 upd=0 queue=0 locks=0' then
            v_failures := v_failures || format('4b %s [A] -> [A]: %s %s', v_table, v_res, pg_temp.s3b_diff(v_before, pg_temp.s3b_counters()));
        end if;

        -- [A] -> [A,B]: one INSERT, A untouched
        v_ids := pg_temp.s3b_rowids(v_table, v_id);
        v_before := pg_temp.s3b_counters();
        v_res := pg_temp.s3b_set(v_table, v_id, array[pg_temp.s3b_el(v_a), pg_temp.s3b_el(v_b)]);
        if v_res <> 'ok' or pg_temp.s3b_keys(v_table, v_id) <> v_a || ',' || v_b
           or pg_temp.s3b_diff(v_before, pg_temp.s3b_counters()) not like '% ins=1 del=0 upd=0 queue=0 %'
           or position(v_ids in pg_temp.s3b_rowids(v_table, v_id)) <> 1
           -- S6-A: A keeps 1; B appends at v_base(=1) + element_no(=2) = 3.
           -- Not 2: element_no is the position in the FULL desired array, and
           -- KEEP rows are never renumbered.
           or pg_temp.s3b_ordinals(v_table, v_id) <> v_a || '=1,' || v_b || '=3' then
            v_failures := v_failures || format('4c %s [A] -> [A,B]: %s %s %s', v_table, v_res,
                pg_temp.s3b_diff(v_before, pg_temp.s3b_counters()), pg_temp.s3b_ordinals(v_table, v_id));
        end if;

        -- [A,B] -> [B,A]: order only - no row write, same ids and versions.
        -- S6-A: and no ordinal moves either. The relational order and the array
        -- order now DIFFER, which is legal (ORDINAL_VS_ARRAY_ORDER is INFO):
        -- the ordinal is an append sequence, not the array position.
        v_ids := pg_temp.s3b_rowids(v_table, v_id);
        v_ord := pg_temp.s3b_ordinals(v_table, v_id);
        v_before := pg_temp.s3b_counters();
        v_res := pg_temp.s3b_set(v_table, v_id, array[pg_temp.s3b_el(v_b), pg_temp.s3b_el(v_a)]);
        if v_res <> 'ok' or pg_temp.s3b_rowids(v_table, v_id) <> v_ids
           or pg_temp.s3b_diff(v_before, pg_temp.s3b_counters()) not like '% ins=0 del=0 upd=0 queue=0 %'
           or pg_temp.s3b_ordinals(v_table, v_id) <> v_ord
           or pg_temp.s3b_ordinals(v_table, v_id) <> v_a || '=1,' || v_b || '=3' then
            v_failures := v_failures || format('4d %s [A,B] -> [B,A]: %s %s %s', v_table, v_res,
                pg_temp.s3b_diff(v_before, pg_temp.s3b_counters()), pg_temp.s3b_ordinals(v_table, v_id));
        end if;

        -- [B,A] -> [B,C]: DELETE A (captured), INSERT C, KEEP B untouched
        select v_b || '=' || a.id || ':' || a.xmin::text into v_row_b from public.attachments a where a.storage_key = v_b;
        v_before := pg_temp.s3b_counters();
        v_res := pg_temp.s3b_set(v_table, v_id, array[pg_temp.s3b_el(v_b), pg_temp.s3b_el(v_c)]);
        if v_res <> 'ok' or pg_temp.s3b_keys(v_table, v_id) <> v_b || ',' || v_c
           or pg_temp.s3b_diff(v_before, pg_temp.s3b_counters()) not like '% ins=1 del=1 upd=0 queue=1 %'
           or position(v_row_b in pg_temp.s3b_rowids(v_table, v_id)) = 0
           or (select count(*) from nora_private.attachment_storage_deletion_queue where storage_key = v_a and state = 'pending') <> 1
           or exists (select 1 from nora_private.attachment_storage_deletion_queue where storage_key in (v_b, v_c))
           -- S6-A: B is KEEP and keeps 3; C is ADD at v_base(=3) + element_no(=2).
           -- The gaps are the contract, not a defect: nothing is compacted.
           or pg_temp.s3b_ordinals(v_table, v_id) <> v_b || '=3,' || v_c || '=5' then
            v_failures := v_failures || format('4e %s [B,A] -> [B,C]: %s %s %s', v_table, v_res,
                pg_temp.s3b_diff(v_before, pg_temp.s3b_counters()), pg_temp.s3b_ordinals(v_table, v_id));
        end if;

        -- metadata change on a kept key: rejected, nothing changes
        v_ids := pg_temp.s3b_rowids(v_table, v_id);
        v_res := pg_temp.s3b_set(v_table, v_id, array[pg_temp.s3b_el(v_b, 'umbenannt.pdf'), pg_temp.s3b_el(v_c)]);
        if v_res not like '22023|NORA_ATTACHMENT_REFERENCE_INVALID|%element 1 changes the title or type%'
           or pg_temp.s3b_rowids(v_table, v_id) <> v_ids then
            v_failures := v_failures || format('4f %s title change on a kept key -> %s', v_table, v_res);
        end if;
        v_res := pg_temp.s3b_set(v_table, v_id, array[pg_temp.s3b_el(v_b), pg_temp.s3b_el(v_c, 'datei.pdf', 'image/png')]);
        if v_res not like '22023|NORA_ATTACHMENT_REFERENCE_INVALID|%element 2 changes the title or type%'
           or pg_temp.s3b_rowids(v_table, v_id) <> v_ids then
            v_failures := v_failures || format('4f %s type change on a kept key -> %s', v_table, v_res);
        end if;

        -- [B,C] -> [B,C,C]: duplicate rejected
        v_res := pg_temp.s3b_set(v_table, v_id, array[pg_temp.s3b_el(v_b), pg_temp.s3b_el(v_c), pg_temp.s3b_el(v_c)]);
        if v_res not like '22023|NORA_ATTACHMENT_REFERENCE_INVALID|%element 3 repeats%' or pg_temp.s3b_rowids(v_table, v_id) <> v_ids then
            v_failures := v_failures || format('4g %s duplicate -> %s', v_table, v_res);
        end if;

        -- src-only change on kept keys: no row write
        v_before := pg_temp.s3b_counters();
        v_res := pg_temp.s3b_set(v_table, v_id, array[pg_temp.s3b_el(v_b) || jsonb_build_object('src', pg_temp.s3b_src(v_b)),
                                                      pg_temp.s3b_el(v_c) || '{"rawFile":{}}']);
        if v_res <> 'ok' or pg_temp.s3b_rowids(v_table, v_id) <> v_ids
           or pg_temp.s3b_diff(v_before, pg_temp.s3b_counters()) not like '% ins=0 del=0 upd=0 queue=0 locks=0' then
            v_failures := v_failures || format('4h %s src-only change: %s %s', v_table, v_res, pg_temp.s3b_diff(v_before, pg_temp.s3b_counters()));
        end if;

        -- re-adding the removed key A (pending intent): admission rejects the whole write
        v_res := pg_temp.s3b_set(v_table, v_id, array[pg_temp.s3b_el(v_a), pg_temp.s3b_el(v_b), pg_temp.s3b_el(v_c)]);
        if v_res not like '55000|NORA_ATTACHMENT_STORAGE_KEY_PENDING_DELETION|%' or pg_temp.s3b_rowids(v_table, v_id) <> v_ids
           or cardinality(pg_temp.s3b_json(v_table, v_id)) <> 2 then
            v_failures := v_failures || format('4i %s re-adding a removed key -> %s', v_table, v_res);
        end if;

        -- [B,C] -> NULL: two DELETEs, two captures
        v_before := pg_temp.s3b_counters();
        v_res := pg_temp.s3b_set(v_table, v_id, null);
        if v_res <> 'ok' or pg_temp.s3b_keys(v_table, v_id) <> ''
           or pg_temp.s3b_diff(v_before, pg_temp.s3b_counters()) not like '% ins=0 del=2 upd=0 queue=2 %' then
            v_failures := v_failures || format('4j %s [B,C] -> NULL: %s %s', v_table, v_res, pg_temp.s3b_diff(v_before, pg_temp.s3b_counters()));
        end if;

        -- NULL <-> {}: equal, the projection is not invoked
        v_before := pg_temp.s3b_counters();
        v_res := pg_temp.s3b_set(v_table, v_id, '{}'::jsonb[]);
        v_res := v_res || pg_temp.s3b_set(v_table, v_id, null);
        if v_res <> 'okok' or pg_temp.s3b_diff(v_before, pg_temp.s3b_counters()) <> 'scans=0 ins=0 del=0 upd=0 queue=0 locks=0' then
            v_failures := v_failures || format('4k %s NULL <-> {}: %s %s', v_table, v_res, pg_temp.s3b_diff(v_before, pg_temp.s3b_counters()));
        end if;
    end loop;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (delta matrix):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  4. delta (contact + deal): []->[A] 1 INSERT; [A]->[A] not invoked; [A,B]->[B,A] 0 writes; [B,A]->[B,C] 1 DELETE + 1 INSERT + 1 capture, B untouched; metadata change / duplicate / re-adding a removed key rejected atomically; src-only 0 writes; NULL <-> {} not invoked';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Zero-work proofs from a planted, already-projected note (no key locks held)
-- ---------------------------------------------------------------------------
do $$
declare
    v_table    text;
    v_id       bigint;
    v_res      text;
    v_before   bigint[];
    v_diff     text;
    v_p text; v_q text; v_r text;
    v_ord      text;
    v_failures text[] := '{}';
begin
    foreach v_table in array array['contact_notes', 'deal_notes'] loop
        v_p := 's3b-zw-' || left(v_table, 1) || '-p.pdf';
        v_q := 's3b-zw-' || left(v_table, 1) || '-q.pdf';
        v_r := 's3b-zw-' || left(v_table, 1) || '-r.pdf';
        v_id := pg_temp.s3b_note(v_table);
        perform pg_temp.s3b_plant_projected(v_table, v_id, array[pg_temp.s3b_el(v_p), pg_temp.s3b_el(v_q)]);
        if pg_temp.s3b_locked(v_p) or pg_temp.s3b_locked(v_q) or pg_temp.s3b_keys(v_table, v_id) <> v_p || ',' || v_q then
            raise exception 'FAIL 5 precondition: the planted fixture holds key locks or is not projected';
        end if;

        -- unrelated body edit: projection not invoked (no scan of public.attachments)
        v_before := pg_temp.s3b_counters();
        execute format('update public.%I set text = %L where id = $1', v_table, 'nur Text') using v_id;
        v_diff := pg_temp.s3b_diff(v_before, pg_temp.s3b_counters());
        if v_diff <> 'scans=0 ins=0 del=0 upd=0 queue=0 locks=0' then
            v_failures := v_failures || format('5a %s body-only edit: %s', v_table, v_diff);
        end if;

        -- the same array written again (PostgREST sends the column): not invoked
        v_before := pg_temp.s3b_counters();
        execute format('update public.%I set attachments = attachments, text = %L where id = $1', v_table, 'nochmal') using v_id;
        v_diff := pg_temp.s3b_diff(v_before, pg_temp.s3b_counters());
        if v_diff <> 'scans=0 ins=0 del=0 upd=0 queue=0 locks=0' then
            v_failures := v_failures || format('5b %s identical array: %s', v_table, v_diff);
        end if;

        -- reorder: invoked (reads), but 0 writes, 0 captures, 0 key locks -
        -- and, S6-A, 0 ordinal movement. This is the action a BLOCKING
        -- ORDINAL_VS_ARRAY_ORDER class would turn RED without a defect.
        v_before := pg_temp.s3b_counters();
        v_ord := pg_temp.s3b_ordinals(v_table, v_id);
        v_res := pg_temp.s3b_set(v_table, v_id, array[pg_temp.s3b_el(v_q), pg_temp.s3b_el(v_p)]);
        v_diff := pg_temp.s3b_diff(v_before, pg_temp.s3b_counters());
        if v_res <> 'ok' or v_diff not like 'scans=% ins=0 del=0 upd=0 queue=0 locks=0' or v_diff like 'scans=0 %'
           or pg_temp.s3b_locked(v_p) or pg_temp.s3b_locked(v_q)
           or pg_temp.s3b_ordinals(v_table, v_id) <> v_ord
           or pg_temp.s3b_ordinals(v_table, v_id) <> v_p || '=1,' || v_q || '=2' then
            v_failures := v_failures || format('5c %s reorder: %s %s %s', v_table, v_res, v_diff,
                pg_temp.s3b_ordinals(v_table, v_id));
        end if;

        -- [Q,P] -> [Q,R]: exactly 1 DELETE (P), 1 INSERT (R), 1 capture, key locks P and R only
        v_before := pg_temp.s3b_counters();
        v_res := pg_temp.s3b_set(v_table, v_id, array[pg_temp.s3b_el(v_q), pg_temp.s3b_el(v_r)]);
        v_diff := pg_temp.s3b_diff(v_before, pg_temp.s3b_counters());
        if v_res <> 'ok' or v_diff not like '% ins=1 del=1 upd=0 queue=1 locks=2'
           or not pg_temp.s3b_locked(v_p) or not pg_temp.s3b_locked(v_r) or pg_temp.s3b_locked(v_q)
           -- S6-A: Q is KEEP and keeps 2; R appends at v_base(=2) + element_no(=2)
           or pg_temp.s3b_ordinals(v_table, v_id) <> v_q || '=2,' || v_r || '=4' then
            v_failures := v_failures || format('5d %s [Q,P] -> [Q,R]: %s %s (P %s, Q %s, R %s)', v_table, v_res, v_diff,
                pg_temp.s3b_locked(v_p), pg_temp.s3b_locked(v_q), pg_temp.s3b_locked(v_r));
        end if;
        raise notice '     5 % [Q,P] -> [Q,R]: %', v_table, v_diff;
    end loop;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (zero work):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  5. zero work (contact + deal): body-only and identical writes do not invoke the projection; reorder 0 writes / 0 captures / 0 key locks; [Q,P]->[Q,R] = 1 DELETE + 1 INSERT + 1 capture + key locks P and R only (Q never locked)';
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. S3A admission through note writes, whole-statement atomicity
-- ---------------------------------------------------------------------------
do $$
declare
    r          record;
    v_id       bigint;
    v_key      text;
    v_res      text;
    v_job      text;
    v_notes    bigint;
    v_failures text[] := '{}';
begin
    v_id := pg_temp.s3b_note('contact_notes');
    for r in
        select * from (values ('pending', true), ('claimed', true), ('claimed_expired', true),
                              ('failed_retryable', true), ('done', true),
                              ('skipped_live', false), ('failed_terminal', false), ('none', false)) as t(label, blocks)
    loop
        v_key := 's3b-adm-' || r.label || '.pdf';
        if r.label = 'pending' then
            insert into nora_private.attachment_storage_deletion_queue (storage_key) values (v_key);
        elsif r.label = 'claimed' then
            insert into nora_private.attachment_storage_deletion_queue (storage_key, state, attempt_count, claimed_at, claimed_by)
                values (v_key, 'claimed', 1, now(), gen_random_uuid()::text);
        elsif r.label = 'claimed_expired' then
            insert into nora_private.attachment_storage_deletion_queue (storage_key, state, attempt_count, claimed_at, claimed_by)
                values (v_key, 'claimed', 1, now() - interval '1 day', gen_random_uuid()::text);
        elsif r.label = 'failed_retryable' then
            insert into nora_private.attachment_storage_deletion_queue (storage_key, state, attempt_count, last_error_code, last_error_at)
                values (v_key, 'failed_retryable', 1, 'NORA_ATTACHMENT_LEASE_EXPIRED', now());
        elsif r.label in ('done', 'skipped_live', 'failed_terminal') then
            insert into nora_private.attachment_storage_deletion_queue (storage_key, state, completed_at)
                values (v_key, r.label, now());
        end if;
        select string_agg(format('%s/%s/%s/%s', q.id, q.state, q.attempt_count, coalesce(q.claimed_by, '-')), ',')
          into v_job from nora_private.attachment_storage_deletion_queue q where q.storage_key = v_key;

        v_res := pg_temp.s3b_set('contact_notes', v_id, array[pg_temp.s3b_el('s3b-adm-fresh.pdf'), pg_temp.s3b_el(v_key)]);
        if r.blocks then
            if v_res not like '55000|NORA_ATTACHMENT_STORAGE_KEY_PENDING_DELETION|%'
               or position(v_key in split_part(v_res, '|', 3)) > 0
               or pg_temp.s3b_json('contact_notes', v_id) is not null
               or pg_temp.s3b_keys('contact_notes', v_id) <> '' then
                v_failures := v_failures || format('6 %s: expected a whole-statement rejection, got %s / rows %s', r.label, v_res,
                                                   pg_temp.s3b_keys('contact_notes', v_id));
            end if;
            -- the same on INSERT: the note itself is not created
            select count(*) into v_notes from public.contact_notes;
            v_res := pg_temp.s3b_insert('contact_notes', array[pg_temp.s3b_el(v_key)]);
            if v_res not like '55000|NORA_ATTACHMENT_STORAGE_KEY_PENDING_DELETION|%'
               or (select count(*) from public.contact_notes) <> v_notes then
                v_failures := v_failures || format('6 %s INSERT: %s', r.label, v_res);
            end if;
        else
            if v_res <> 'ok' or pg_temp.s3b_keys('contact_notes', v_id)
                   <> (select string_agg(k, ',' order by k collate "C") from unnest(array['s3b-adm-fresh.pdf', v_key]) as k) then
                v_failures := v_failures || format('6 %s: expected admission, got %s', r.label, v_res);
            end if;
            perform pg_temp.s3b_set('contact_notes', v_id, null);
            delete from nora_private.attachment_storage_deletion_queue
             where storage_key in ('s3b-adm-fresh.pdf', v_key) and state = 'pending';
        end if;
        -- the job is never touched by a note write
        if (select string_agg(format('%s/%s/%s/%s', q.id, q.state, q.attempt_count, coalesce(q.claimed_by, '-')), ',')
              from nora_private.attachment_storage_deletion_queue q where q.storage_key = v_key) is distinct from v_job then
            v_failures := v_failures || format('6 %s: the queue row was modified', r.label);
        end if;
    end loop;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (admission):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  6. admission via note writes: pending / claimed / expired claim / failed_retryable / done reject the WHOLE statement (JSON unchanged, sibling key not projected, no note on INSERT, key never named); skipped_live / failed_terminal / none admit; jobs untouched';
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Cross-note: UNIQUE(storage_key) stays authoritative
-- ---------------------------------------------------------------------------
do $$
declare
    v_cn bigint := pg_temp.s3b_note('contact_notes');
    v_cn2 bigint := pg_temp.s3b_note('contact_notes');
    v_dn bigint := pg_temp.s3b_note('deal_notes');
    v_res text;
    v_failures text[] := '{}';
begin
    if pg_temp.s3b_set('contact_notes', v_cn, array[pg_temp.s3b_el('s3b-x.pdf')]) <> 'ok' then
        raise exception 'FAIL 7 precondition';
    end if;
    v_res := pg_temp.s3b_set('deal_notes', v_dn, array[pg_temp.s3b_el('s3b-x.pdf')]);
    if v_res not like '23505|%uq__attachments__storage_key%' or pg_temp.s3b_json('deal_notes', v_dn) is not null then
        v_failures := v_failures || format('7a same key on a deal note -> %s', v_res);
    end if;
    v_res := pg_temp.s3b_set('contact_notes', v_cn2, array[pg_temp.s3b_el('s3b-x2.pdf'), pg_temp.s3b_el('s3b-x.pdf')]);
    if v_res not like '23505|%uq__attachments__storage_key%' or pg_temp.s3b_keys('contact_notes', v_cn2) <> '' then
        v_failures := v_failures || format('7b same key on another contact note -> %s', v_res);
    end if;
    if pg_temp.s3b_keys('contact_notes', v_cn) <> 's3b-x.pdf' then
        v_failures := array_append(v_failures, '7c the owning note lost its row');
    end if;
    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (cross-note):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  7. cross-note: a key owned by another contact / deal note -> 23505 uq__attachments__storage_key, whole statement rolled back';
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Cascades capture every projected row
-- ---------------------------------------------------------------------------
do $$
declare
    v_company bigint; v_contact bigint; v_contact2 bigint; v_deal bigint; v_deal2 bigint;
    v_note bigint;
    v_key text;
    v_failures text[] := '{}';
begin
    insert into public.companies (name) values ('W8-C S3B Cascade') returning id into v_company;
    insert into public.contacts (first_name, last_name, company_id) values ('Kas', 'Kade', v_company) returning id into v_contact;
    insert into public.contacts (first_name, last_name, company_id) values ('Kas', 'Kade2', v_company) returning id into v_contact2;
    insert into public.deals (name, company_id, stage) values ('Kaskade', v_company, 'opportunity') returning id into v_deal;
    insert into public.deals (name, company_id, stage) values ('Kaskade2', v_company, 'opportunity') returning id into v_deal2;

    -- direct note delete
    insert into public.contact_notes (contact_id, text, attachments)
        values (v_contact, 'n', array[pg_temp.s3b_el('s3b-cas-n1.pdf'), pg_temp.s3b_el('s3b-cas-n2.pdf')]) returning id into v_note;
    delete from public.contact_notes where id = v_note;
    -- contact delete -> contact note
    insert into public.contact_notes (contact_id, text, attachments) values (v_contact, 'n', array[pg_temp.s3b_el('s3b-cas-c1.pdf')]);
    delete from public.contacts where id = v_contact;
    -- deal delete -> deal note
    insert into public.deal_notes (deal_id, text, attachments) values (v_deal, 'n', array[pg_temp.s3b_el('s3b-cas-d1.pdf'), pg_temp.s3b_el('s3b-cas-d2.pdf')]);
    delete from public.deals where id = v_deal;
    -- company delete -> contacts + deals -> both note kinds
    insert into public.contact_notes (contact_id, text, attachments) values (v_contact2, 'n', array[pg_temp.s3b_el('s3b-cas-k1.pdf')]);
    insert into public.deal_notes (deal_id, text, attachments) values (v_deal2, 'n', array[pg_temp.s3b_el('s3b-cas-k2.pdf')]);
    delete from public.companies where id = v_company;

    foreach v_key in array array['s3b-cas-n1.pdf', 's3b-cas-n2.pdf', 's3b-cas-c1.pdf', 's3b-cas-d1.pdf',
                                 's3b-cas-d2.pdf', 's3b-cas-k1.pdf', 's3b-cas-k2.pdf'] loop
        if exists (select 1 from public.attachments where storage_key = v_key)
           or (select count(*) from nora_private.attachment_storage_deletion_queue
               where storage_key = v_key and state = 'pending') <> 1 then
            v_failures := v_failures || format('8 %s: row survived or not exactly one pending intent', v_key);
        end if;
    end loop;
    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (cascades):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  8. note / contact / deal / company deletes: FK cascade removes every projected row and captures exactly one pending intent each (no note DELETE projection involved)';
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Legacy (pre-S4) notes
-- ---------------------------------------------------------------------------
do $$
declare
    v_table    text;
    v_id       bigint;
    v_res      text;
    v_before   bigint[];
    v_diff     text;
    v_l        text;
    v_failures text[] := '{}';
begin
    foreach v_table in array array['contact_notes', 'deal_notes'] loop
        v_l := 's3b-leg-' || left(v_table, 1);
        v_id := pg_temp.s3b_note(v_table);
        perform pg_temp.s3b_plant_legacy(v_table, v_id, array[pg_temp.s3b_el(v_l || '-1.pdf'), pg_temp.s3b_el(v_l || '-2.pdf')]);

        -- body-only edit: stays unprojected, projection not invoked
        v_before := pg_temp.s3b_counters();
        execute format('update public.%I set text = %L where id = $1', v_table, 'nur Text') using v_id;
        v_diff := pg_temp.s3b_diff(v_before, pg_temp.s3b_counters());
        if v_diff <> 'scans=0 ins=0 del=0 upd=0 queue=0 locks=0' or pg_temp.s3b_keys(v_table, v_id) <> '' then
            v_failures := v_failures || format('9a %s legacy body-only edit: %s rows %s', v_table, v_diff, pg_temp.s3b_keys(v_table, v_id));
        end if;

        -- first attachment-changing write [L1,L2] -> [L1,L3]: the WHOLE note, not [L3]
        v_res := pg_temp.s3b_set(v_table, v_id, array[pg_temp.s3b_el(v_l || '-1.pdf'), pg_temp.s3b_el(v_l || '-3.pdf')]);
        if v_res <> 'ok' or pg_temp.s3b_keys(v_table, v_id) <> v_l || '-1.pdf,' || v_l || '-3.pdf' then
            v_failures := v_failures || format('9b %s first touch -> %s rows %s', v_table, v_res, pg_temp.s3b_keys(v_table, v_id));
        end if;
        -- the legacy key removed before it was ever projected is not captured (window gap)
        if exists (select 1 from nora_private.attachment_storage_deletion_queue where storage_key = v_l || '-2.pdf') then
            v_failures := v_failures || format('9c %s: an unprojected legacy removal produced a capture', v_table);
        end if;

        -- reorder of an unprojected legacy note also reconciles the whole note
        v_id := pg_temp.s3b_note(v_table);
        perform pg_temp.s3b_plant_legacy(v_table, v_id, array[pg_temp.s3b_el(v_l || '-m1.pdf'), pg_temp.s3b_el(v_l || '-m2.pdf')]);
        v_res := pg_temp.s3b_set(v_table, v_id, array[pg_temp.s3b_el(v_l || '-m2.pdf'), pg_temp.s3b_el(v_l || '-m1.pdf')]);
        if v_res <> 'ok' or pg_temp.s3b_keys(v_table, v_id) <> v_l || '-m1.pdf,' || v_l || '-m2.pdf' then
            v_failures := v_failures || format('9d %s legacy reorder -> %s rows %s', v_table, v_res, pg_temp.s3b_keys(v_table, v_id));
        end if;

        -- dirty legacy OLD never blocks a valid NEW; body edits on it pass untouched
        v_id := pg_temp.s3b_note(v_table);
        perform pg_temp.s3b_plant_legacy(v_table, v_id, array[pg_temp.s3b_el(v_l || '-d1.pdf'), pg_temp.s3b_el(v_l || '-d1.pdf'), '"junk"'::jsonb]);
        execute format('update public.%I set text = %L where id = $1', v_table, 'Text trotz Altlast') using v_id;
        v_res := pg_temp.s3b_set(v_table, v_id, array[pg_temp.s3b_el(v_l || '-d1.pdf')]);
        if v_res <> 'ok' or pg_temp.s3b_keys(v_table, v_id) <> v_l || '-d1.pdf' then
            v_failures := v_failures || format('9e %s dirty OLD -> valid NEW: %s rows %s', v_table, v_res, pg_temp.s3b_keys(v_table, v_id));
        end if;

        -- legacy note emptied before its first touch: no rows, no capture
        v_id := pg_temp.s3b_note(v_table);
        perform pg_temp.s3b_plant_legacy(v_table, v_id, array[pg_temp.s3b_el(v_l || '-g1.pdf')]);
        v_res := pg_temp.s3b_set(v_table, v_id, null);
        if v_res <> 'ok' or pg_temp.s3b_keys(v_table, v_id) <> ''
           or exists (select 1 from nora_private.attachment_storage_deletion_queue where storage_key = v_l || '-g1.pdf') then
            v_failures := v_failures || format('9f %s legacy emptied: %s', v_table, v_res);
        end if;
    end loop;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (legacy / S4 boundary):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  9. legacy (contact + deal): body-only stays unprojected (not invoked); first attachment-changing write reconciles the WHOLE note ([L1,L2]->[L1,L3] = L1,L3); legacy reorder projects fully; unprojected legacy removals are not captured (S3B->S4 window gap); dirty OLD never blocks a valid NEW';
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. RBAC: projection runs through the definer; direct writes stay denied
-- ---------------------------------------------------------------------------
do $$
declare
    v_admin uuid := gen_random_uuid();
    v_office uuid := gen_random_uuid();
    v_viewer uuid := gen_random_uuid();
    v_disabled uuid := gen_random_uuid();
    v_a bigint; v_o bigint; v_v bigint; v_d bigint;
    v_contact bigint := (select value from s3b_ctx where key = 'contact');
    v_note bigint;
    v_state text;
    v_sql text;
    v_n bigint;
    v_failures text[] := '{}';
begin
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values
      (v_admin,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's3b-admin@nora.test',    'x', now(), '{"provider":"email","providers":["email"]}', '{"first_name":"Ada","last_name":"Admin"}',    now(), now()),
      (v_office,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's3b-office@nora.test',   'x', now(), '{"provider":"email","providers":["email"]}', '{"first_name":"Olaf","last_name":"Office"}',  now(), now()),
      (v_viewer,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's3b-viewer@nora.test',   'x', now(), '{"provider":"email","providers":["email"]}', '{"first_name":"Vera","last_name":"Viewer"}',  now(), now()),
      (v_disabled, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's3b-disabled@nora.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{"first_name":"Dirk","last_name":"Disabled"}', now(), now());
    select id into v_a from public.sales where user_id = v_admin;
    select id into v_o from public.sales where user_id = v_office;
    select id into v_v from public.sales where user_id = v_viewer;
    select id into v_d from public.sales where user_id = v_disabled;
    perform nora_private.apply_sales_role_change(v_a, 'admin', false);
    perform nora_private.apply_sales_role_change(v_o, 'office', false);
    perform nora_private.apply_sales_role_change(v_v, 'viewer', false);
    perform nora_private.apply_sales_role_change(v_d, 'office', true);
    insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
      (v_admin, v_admin, now(), now(), 'aal1'), (v_office, v_office, now(), now(), 'aal1'),
      (v_viewer, v_viewer, now(), now(), 'aal1'), (v_disabled, v_disabled, now(), now(), 'aal1');

    -- office: create and edit a note with attachments -> projected through the definer
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_office::text, 'session_id', v_office::text)::text, true);
    set local role authenticated;
    insert into public.contact_notes (contact_id, text, date, attachments)
        values (v_contact, 'office', now(), array[pg_temp.s3b_el('s3b-rbac-1.pdf')]) returning id into v_note;
    update public.contact_notes set attachments = array[pg_temp.s3b_el('s3b-rbac-1.pdf'), pg_temp.s3b_el('s3b-rbac-2.pdf')] where id = v_note;
    -- ... while every direct write path to public.attachments and the core stays denied
    foreach v_sql in array array[
        format('insert into public.attachments (contact_note_id, storage_key, file_name, mime_type, ordinal) values (%s, %L, %L, %L, 1)', v_note, 's3b-rbac-direct.pdf', 'x.pdf', 'application/pdf'),
        'delete from public.attachments where storage_key = ''s3b-rbac-1.pdf''',
        'update public.attachments set file_name = ''x.pdf'' where storage_key = ''s3b-rbac-1.pdf''',
        format('select nora_private.reconcile_note_attachments(%s, null, null)', v_note)] loop
        v_state := 'no error';
        begin
            execute v_sql;
        exception when others then
            v_state := sqlstate;
        end;
        if v_state <> '42501' then
            v_failures := v_failures || format('10a office %s -> %s, expected 42501', left(v_sql, 60), v_state);
        end if;
    end loop;
    reset role;
    if pg_temp.s3b_keys('contact_notes', v_note) <> 's3b-rbac-1.pdf,s3b-rbac-2.pdf' then
        v_failures := v_failures || format('10b office note not projected: %s', pg_temp.s3b_keys('contact_notes', v_note));
    end if;

    -- viewer / disabled: no note write, nothing projected
    foreach v_state in array array[v_viewer::text, v_disabled::text] loop
        perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_state, 'session_id', v_state)::text, true);
        set local role authenticated;
        begin
            insert into public.contact_notes (contact_id, text, date, attachments)
                values (v_contact, 'denied', now(), array[pg_temp.s3b_el('s3b-rbac-denied.pdf')]);
            v_failures := v_failures || format('10c %s could write a note', v_state);
        exception when insufficient_privilege then
            null;
        end;
        update public.contact_notes set attachments = null where id = v_note;
        get diagnostics v_n = row_count;
        reset role;
        if v_n <> 0 or pg_temp.s3b_keys('contact_notes', v_note) <> 's3b-rbac-1.pdf,s3b-rbac-2.pdf' then
            v_failures := v_failures || format('10c %s changed the office note (rows %s)', v_state, v_n);
        end if;
    end loop;
    if exists (select 1 from public.attachments where storage_key = 's3b-rbac-denied.pdf') then
        v_failures := array_append(v_failures, '10c a denied note write projected a row');
    end if;

    -- anon: nothing
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;
    begin
        insert into public.contact_notes (contact_id, text, date, attachments)
            values (v_contact, 'anon', now(), array[pg_temp.s3b_el('s3b-rbac-anon.pdf')]);
        v_failures := array_append(v_failures, '10d anon could write a note');
    exception when insufficient_privilege then
        null;
    end;
    reset role;

    -- service_role (backend writer, e.g. a future Postmark deploy): projects too
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    set local role service_role;
    insert into public.contact_notes (contact_id, text, date, sales_id, attachments)
        values (v_contact, 'service', now(), v_o, array[pg_temp.s3b_el('s3b-rbac-svc.pdf')]);
    reset role;
    if not exists (select 1 from public.attachments where storage_key = 's3b-rbac-svc.pdf') then
        v_failures := array_append(v_failures, '10e a service_role note write was not projected');
    end if;

    -- admin: note delete -> cascade capture
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_admin::text, 'session_id', v_admin::text)::text, true);
    set local role authenticated;
    delete from public.contact_notes where id = v_note;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    if exists (select 1 from public.attachments where storage_key like 's3b-rbac-_.pdf')
       or (select count(*) from nora_private.attachment_storage_deletion_queue
           where storage_key in ('s3b-rbac-1.pdf', 's3b-rbac-2.pdf') and state = 'pending') <> 2 then
        v_failures := array_append(v_failures, '10f admin note delete did not cascade + capture both rows');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (RBAC):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK 10. RBAC: office and service_role note writes project through the definer; viewer / disabled / anon cannot write or change notes; direct INSERT / UPDATE / DELETE on public.attachments and direct core calls stay 42501; admin note delete cascades + captures';
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. RLS drift: row_security = off turns a filtered read into an error
-- ---------------------------------------------------------------------------
do $$
declare
    v_case     text;
    v_id       bigint;
    v_res      text;
    v_failures text[] := '{}';
begin
    foreach v_case in array array['11a', '11b'] loop
        v_res := 'no error';
        begin
            v_id := pg_temp.s3b_note('contact_notes');
            perform pg_temp.s3b_plant_projected('contact_notes', v_id, array[pg_temp.s3b_el('s3b-rls-' || v_case || '.pdf')]);

            create role nora_s3b_rls_drift nologin nobypassrls;
            grant nora_s3b_rls_drift to postgres;
            -- CREATE on the schema: required to become owner of a function there
            grant usage, create on schema nora_private to nora_s3b_rls_drift;
            grant usage on schema public to nora_s3b_rls_drift;
            grant select, insert, delete on public.attachments to nora_s3b_rls_drift;
            grant execute on function nora_private.reconcile_note_attachments(bigint, bigint, jsonb[]),
                                      nora_private.note_attachment_reference_rows(jsonb[]),
                                      nora_private.attachment_url_liveness(text, text) to nora_s3b_rls_drift;
            alter function nora_private.project_note_attachments() owner to nora_s3b_rls_drift;
            if v_case = '11b' then
                alter function nora_private.project_note_attachments() reset row_security;
                alter function nora_private.reconcile_note_attachments(bigint, bigint, jsonb[]) reset row_security;
            end if;

            -- remove the only attachment: E must see the planted row to delete it
            update public.contact_notes set attachments = null where id = v_id;
            raise exception 'S3B_RLS_ANSWERED:%', pg_temp.s3b_keys('contact_notes', v_id);
        exception when others then
            if sqlerrm like 'S3B_RLS_ANSWERED:%' then
                v_res := 'answered rows=' || substr(sqlerrm, length('S3B_RLS_ANSWERED:') + 1);
            else
                v_res := sqlstate || ' ' || sqlerrm;
            end if;
        end;
        if v_case = '11a' and v_res not like '42501 %row-level security%' then
            v_failures := v_failures || format('11a drift with row_security = off -> %s, expected 42501', v_res);
        end if;
        if v_case = '11b' and v_res <> 'answered rows=s3b-rls-11b.pdf' then
            v_failures := v_failures || format('11b control without row_security -> %s, expected the silent drift', v_res);
        end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'nora_s3b_rls_drift')
       or pg_get_userbyid((select proowner from pg_proc where oid = 'nora_private.project_note_attachments()'::regprocedure)) <> 'postgres'
       or (select proconfig from pg_proc where oid = 'nora_private.project_note_attachments()'::regprocedure)
          is distinct from array['search_path=""', 'row_security=off'] then
        v_failures := array_append(v_failures, '11c the drift probe was not fully rolled back');
    end if;
    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (RLS drift):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK 11. RLS drift: with row_security = off a policy-filtered read of E raises 42501; the control without it silently leaves a stale row (the setting is load-bearing)';
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Scale: 0 / 1 / 5 / 20 attachments
-- ---------------------------------------------------------------------------
do $$
declare
    v_n        int;
    v_id       bigint;
    v_res      text;
    v_arr      jsonb[];
    v_before   bigint[];
    v_d1 text; v_d2 text; v_d3 text;
    v_failures text[] := '{}';
begin
    foreach v_n in array array[0, 1, 5, 20] loop
        select coalesce(array_agg(pg_temp.s3b_el(format('s3b-scale-%s-%s.pdf', v_n, i)) order by i), '{}')
          into v_arr from generate_series(1, v_n) as i;
        v_before := pg_temp.s3b_counters();
        v_res := pg_temp.s3b_insert('contact_notes', v_arr);
        v_d1 := pg_temp.s3b_diff(v_before, pg_temp.s3b_counters());
        v_id := substr(v_res, 4)::bigint;
        v_before := pg_temp.s3b_counters();
        update public.contact_notes set text = 'Text' where id = v_id;
        v_d2 := pg_temp.s3b_diff(v_before, pg_temp.s3b_counters());
        v_before := pg_temp.s3b_counters();
        delete from public.contact_notes where id = v_id;
        v_d3 := pg_temp.s3b_diff(v_before, pg_temp.s3b_counters());
        raise notice '     12 n=%: insert [%] | body edit [%] | delete [%]', v_n, v_d1, v_d2, v_d3;
        if v_d1 not like format('%% ins=%s del=0 upd=0 queue=0 locks=%s', v_n, v_n)
           or v_d2 <> 'scans=0 ins=0 del=0 upd=0 queue=0 locks=0'
           or v_d3 not like format('%% ins=0 del=%s upd=0 queue=%s locks=0', v_n, v_n)
           or (v_n = 0 and v_d1 <> 'scans=0 ins=0 del=0 upd=0 queue=0 locks=0') then
            v_failures := v_failures || format('12 n=%s: %s | %s | %s', v_n, v_d1, v_d2, v_d3);
        end if;
    end loop;
    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (scale):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK 12. scale: n = 0 / 1 / 5 / 20 -> n INSERTs + n key locks on create (0 = not invoked), 0 on body edit, n DELETEs + n captures on delete';
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. Invariants over everything this transaction wrote
-- ---------------------------------------------------------------------------
do $$
declare
    v_failures text[] := '{}';
    v_bad      bigint;
begin
    -- every projected note equals its JSON exactly (keys + metadata)
    with notes as (
        select 'contact_notes' as tbl, n.id, n.attachments from public.contact_notes n
        union all
        select 'deal_notes', n.id, n.attachments from public.deal_notes n
    ), projected as (
        select * from notes
         where exists (select 1 from public.attachments a
                        where (notes.tbl = 'contact_notes' and a.contact_note_id = notes.id)
                           or (notes.tbl = 'deal_notes' and a.deal_note_id = notes.id))
    )
    select count(*) into v_bad
      from projected p
     where (select string_agg(a.storage_key || '|' || a.file_name || '|' || a.mime_type, ',' order by a.storage_key collate "C")
              from public.attachments a
             where (p.tbl = 'contact_notes' and a.contact_note_id = p.id) or (p.tbl = 'deal_notes' and a.deal_note_id = p.id))
           is distinct from
           (select string_agg(r.storage_key || '|' || r.file_name || '|' || r.mime_type, ',' order by r.storage_key collate "C")
              from nora_private.note_attachment_reference_rows(p.attachments) r);
    if v_bad > 0 then
        v_failures := v_failures || format('13a %s projected note(s) differ from their JSON', v_bad);
    end if;
    -- I1: no reference shares its key with an active or done intent
    if exists (select 1 from public.attachments a
               join nora_private.attachment_storage_deletion_queue q on q.storage_key = a.storage_key
               where q.state in ('pending', 'claimed', 'failed_retryable', 'done')) then
        v_failures := array_append(v_failures, '13b I1 violated');
    end if;
    -- no done written, no Storage object removed, no HTTP enqueued
    if exists (select 1 from nora_private.attachment_storage_deletion_queue where state = 'done' and storage_key <> 's3b-adm-done.pdf') then
        v_failures := array_append(v_failures, '13c a done row appeared');
    end if;
    if (select count(*) from storage.objects) <> (select value from s3b_baseline where key = 'storage_objects') then
        v_failures := array_append(v_failures, '13d the Storage object count changed');
    end if;
    if (select count(*) from net.http_request_queue) <> (select value from s3b_baseline where key = 'http_requests') then
        v_failures := array_append(v_failures, '13e an HTTP request was enqueued');
    end if;
    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (invariants):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK 13. invariants: every projected note equals its JSON (keys + metadata); I1 holds; no done row; no Storage object deleted; no HTTP request enqueued';
end;
$$;

rollback;

-- ---------------------------------------------------------------------------
-- 14. REPEATABLE READ / SERIALIZABLE: attachment work fails closed
-- ---------------------------------------------------------------------------
begin isolation level repeatable read;
create temp table s3b_ctx (key text primary key, value bigint) on commit drop;
do $$
declare
    v_company bigint; v_contact bigint; v_deal bigint;
begin
    insert into public.companies (name) values ('W8-C S3B RR') returning id into v_company;
    insert into public.contacts (first_name, last_name, company_id) values ('R', 'R', v_company) returning id into v_contact;
    insert into public.deals (name, company_id, stage) values ('RR', v_company, 'opportunity') returning id into v_deal;
    insert into s3b_ctx values ('company', v_company), ('contact', v_contact), ('deal', v_deal);
end;
$$;
do $$
declare
    v_table text; v_id bigint; v_res text; v_failures text[] := '{}';
begin
    foreach v_table in array array['contact_notes', 'deal_notes'] loop
        v_id := pg_temp.s3b_note(v_table);
        v_res := pg_temp.s3b_set(v_table, v_id, array[pg_temp.s3b_el('s3b-rr-' || left(v_table, 1) || '.pdf')]);
        if v_res not like '55000|NORA_ATTACHMENT_READ_COMMITTED_REQUIRED|%' or pg_temp.s3b_json(v_table, v_id) is not null then
            v_failures := v_failures || format('14a %s RR attachment add -> %s', v_table, v_res);
        end if;
        v_res := pg_temp.s3b_insert(v_table, array[pg_temp.s3b_el('s3b-rr-i.pdf')]);
        if v_res not like '55000|NORA_ATTACHMENT_READ_COMMITTED_REQUIRED|%' then
            v_failures := v_failures || format('14b %s RR note insert with attachment -> %s', v_table, v_res);
        end if;
        -- key-free work still runs: body edit, reorder of a projected note
        perform pg_temp.s3b_plant_projected(v_table, v_id, array[pg_temp.s3b_el('s3b-rr-p' || left(v_table, 1) || '.pdf'),
                                                                 pg_temp.s3b_el('s3b-rr-q' || left(v_table, 1) || '.pdf')]);
        v_res := pg_temp.s3b_try(format('update public.%I set text = %L where id = %s', v_table, 'rr', v_id));
        v_res := v_res || pg_temp.s3b_set(v_table, v_id, array[pg_temp.s3b_el('s3b-rr-q' || left(v_table, 1) || '.pdf'),
                                                               pg_temp.s3b_el('s3b-rr-p' || left(v_table, 1) || '.pdf')]);
        if v_res <> 'okok' then
            v_failures := v_failures || format('14c %s RR key-free writes -> %s', v_table, v_res);
        end if;
        -- a note delete that cascades into attachment rows fails closed
        v_res := pg_temp.s3b_try(format('delete from public.%I where id = %s', v_table, v_id));
        if v_res not like '55000|NORA_ATTACHMENT_READ_COMMITTED_REQUIRED|%' then
            v_failures := v_failures || format('14d %s RR cascade -> %s', v_table, v_res);
        end if;
    end loop;
    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (REPEATABLE READ):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK 14. REPEATABLE READ: attachment add / note insert with attachments / attachment cascade -> 55000 NORA_ATTACHMENT_READ_COMMITTED_REQUIRED (JSON unchanged); body edit and reorder still work';
end;
$$;
rollback;

begin isolation level serializable;
create temp table s3b_ctx (key text primary key, value bigint) on commit drop;
do $$
declare
    v_company bigint; v_contact bigint;
begin
    insert into public.companies (name) values ('W8-C S3B SER') returning id into v_company;
    insert into public.contacts (first_name, last_name, company_id) values ('S', 'S', v_company) returning id into v_contact;
    insert into s3b_ctx values ('company', v_company), ('contact', v_contact);
end;
$$;
do $$
declare
    v_id bigint; v_res text;
begin
    v_id := pg_temp.s3b_note('contact_notes');
    v_res := pg_temp.s3b_set('contact_notes', v_id, array[pg_temp.s3b_el('s3b-ser.pdf')]);
    if v_res not like '55000|NORA_ATTACHMENT_READ_COMMITTED_REQUIRED|%' then
        raise exception 'FAIL 14e SERIALIZABLE attachment add -> %', v_res;
    end if;
    raise notice 'OK 14. SERIALIZABLE: attachment add -> 55000 NORA_ATTACHMENT_READ_COMMITTED_REQUIRED';
end;
$$;
rollback;

-- ---------------------------------------------------------------------------
-- 15. Nothing leaked
-- ---------------------------------------------------------------------------
do $$
begin
    if exists (select 1 from public.attachments where storage_key like 's3b-%' or storage_key like '0.8262106278726917.pdf')
       or exists (select 1 from nora_private.attachment_storage_deletion_queue where storage_key like 's3b-%')
       or exists (select 1 from public.companies where name like 'W8-C S3B%')
       or exists (select 1 from pg_roles where rolname = 'nora_s3b_rls_drift') then
        raise exception 'FAIL (leak): S3B fixtures survived the rollbacks';
    end if;
    raise notice 'OK 15. all fixtures rolled back';
end;
$$;

\echo '=== W8-C S3B: all checks passed ==='
