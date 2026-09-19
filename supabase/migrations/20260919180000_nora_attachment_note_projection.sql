-- Nora CRM: W8-C S3B Atomic Note-Attachment Projection (2026-09-19)
--
-- The database becomes the one writer of public.attachments: every note write
-- that changes contact_notes.attachments / deal_notes.attachments (jsonb[])
-- reconciles that note's attachment rows in the SAME statement, so the legacy
-- JSON and its relational projection can never commit in different states.
--
-- CONTRACT
--   D  = validated desired set from NEW.attachments (grammar v1, below)
--   E  = the public.attachments rows that note owns RIGHT NOW (read from the
--        table, never inferred from OLD.attachments)
--   REMOVE = E - D  -> plain DELETE   (S2A1/S3A capture runs)
--   KEEP   = E n D  -> NO mutation    (title / type must be unchanged)
--   ADD    = D - E  -> plain INSERT   (S3A admission runs), in storage_key
--                      COLLATE "C" order
--   Phases: validate -> KEEP metadata check -> REMOVE -> ADD.
--
-- Minimal delta is a CORRECTNESS rule, not only an efficiency rule: a
-- delete-all + insert-all rebuild captures a pending intent for every kept key
-- and the re-insert of that key in the same transaction is then rejected by
-- S3A admission (NORA_ATTACHMENT_STORAGE_KEY_PENDING_DELETION).
--
-- Because E is the ACTUAL row set, the first attachment-changing write on a
-- legacy note that was never projected reconciles the WHOLE note (rows :=
-- NEW keys) - never a partial JSON delta. Body-only writes do not fire the
-- trigger at all. Until the S4 backfill, every note is therefore either
-- unprojected (no rows) or projected exactly.
--
-- GRAMMAR v1 (every element of NEW.attachments; OLD is never validated)
--   * a JSON object (no SQL NULL member, one-dimensional array)
--   * path  : string matching ^[A-Za-z0-9._-]+$, <= 512 chars, not '.'/'..'
--             -> storage_key, verbatim (never trimmed or derived from src)
--   * title : non-blank string <= 255 chars -> file_name
--   * type  : non-blank string <= 255 chars -> mime_type
--   * src   : absent / JSON null, or the canonical public attachments URL of
--             exactly this path on an allowlisted origin
--             (nora_private.attachment_url_liveness(src, path) = 'live')
--   * rawFile and every other field are ignored; byte_size stays NULL
--   * the same path twice in one note is rejected (no dedupe, no first/last
--     wins); across notes UNIQUE(storage_key) stays authoritative (23505)
-- Any violation: 22023 NORA_ATTACHMENT_REFERENCE_INVALID, naming the element
-- number and the failing field, never the key. A pathless element (e.g. a JSON
-- import whose external download failed) is NOT a Nora attachment.
--
-- LOCK ORDER (03-data-model-guardrails.md 3.3, unchanged): the note row is held
-- by the triggering statement; then attachment row / unique entry -> S3A key
-- lock (inside the existing AFTER triggers on public.attachments) -> queue row.
-- The projection never takes the key lock itself, never calls claim / inspect /
-- fail / the resolver, and adds no isolation protocol: attachment-changing note
-- writes inherit the S3A READ COMMITTED requirement.
--
-- SECURITY: the dispatcher is SECURITY DEFINER (authenticated holds only
-- SELECT on public.attachments since S3A) with row_security = off; ownership
-- comes from the triggering table and NEW.id, never from a caller value. The
-- core and the validator are SECURITY INVOKER. No API role may execute any of
-- the three functions; no grant changes; no service_role capability; no
-- Storage, network, pg_net or Edge call; no dynamic SQL.
--
-- WHAT THIS MIGRATION DOES NOT DO:
--   * no backfill (S4): public.attachments stays empty on a clean baseline and
--     untouched legacy notes stay unprojected; S4 reuses
--     nora_private.reconcile_note_attachments under a note row lock,
--   * no read switch (S5), no legacy JSON write retirement (S6),
--   * no note DELETE trigger: the FK ON DELETE CASCADE already deletes the
--     rows and fires the S2A1/S3A capture,
--   * no worker, no physical Storage delete, no path to 'done' (S2B).
--
-- RUNNER: must stop at the first error and run the file in ONE transaction
-- (supabase db push / apply_migration). The lock, the legacy census and the
-- trigger creation additionally share one DO block, so the census cannot go
-- stale before the triggers exist.

-- ---------------------------------------------------------------------------
-- 0. Static preconditions (fail-closed)
-- ---------------------------------------------------------------------------
do $$
declare
    r          record;
    v_failures text[] := '{}';
    v_names    text;
begin
    if current_user <> 'postgres' then
        raise exception 'NORA_ATTACHMENT_NOTE_PROJECTION: expected migration creator postgres, got %', current_user
            using errcode = '42501';
    end if;

    if to_regnamespace('nora_private') is null
       or to_regclass('public.attachments') is null
       or to_regclass('nora_private.attachment_storage_deletion_queue') is null
       or to_regclass('public.contact_notes') is null
       or to_regclass('public.deal_notes') is null then
        raise exception 'NORA_ATTACHMENT_NOTE_PROJECTION: nora_private, public.attachments, the deletion queue or a note table is missing'
            using errcode = 'P0002';
    end if;

    -- the S3B objects are created exactly once
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'nora_private'
                 and p.proname in ('note_attachment_reference_rows',
                                   'reconcile_note_attachments',
                                   'project_note_attachments'))
       or exists (select 1 from pg_trigger t
                  where t.tgrelid in ('public.contact_notes'::regclass, 'public.deal_notes'::regclass)
                    and t.tgname like 'project\_%\_note\_attachments\_%') then
        raise exception 'NORA_ATTACHMENT_NOTE_PROJECTION: an S3B projection function or trigger already exists'
            using errcode = '42723',
                  hint = 'This migration creates the S3B objects once. Investigate where the existing object came from instead of re-running it.';
    end if;

    -- ---- the note tables: jsonb[] attachment arrays on bigint ids ----------
    for r in select * from (values ('public.contact_notes'), ('public.deal_notes')) as t(tbl) loop
        if not exists (select 1 from pg_attribute a
                       where a.attrelid = r.tbl::regclass and a.attname = 'attachments'
                         and not a.attisdropped
                         and format_type(a.atttypid, a.atttypmod) = 'jsonb[]') then
            v_failures := v_failures || format('%s.attachments is not jsonb[]', r.tbl);
        end if;
        if not exists (select 1 from pg_attribute a
                       where a.attrelid = r.tbl::regclass and a.attname = 'id'
                         and not a.attisdropped
                         and format_type(a.atttypid, a.atttypmod) = 'bigint') then
            v_failures := v_failures || format('%s.id is not bigint', r.tbl);
        end if;
        -- no competing projection mechanism on the note table
        if exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
                   where t.tgrelid = r.tbl::regclass and not t.tgisinternal
                     and p.prosrc ~* 'public\.attachments') then
            v_failures := v_failures || format('a trigger on %s already writes or reads public.attachments', r.tbl);
        end if;
    end loop;

    -- ---- public.attachments: the S1 + S3A contract ----------------------------
    if pg_get_userbyid((select relowner from pg_class where oid = 'public.attachments'::regclass)) <> 'postgres' then
        v_failures := array_append(v_failures, 'public.attachments is not owned by postgres');
    end if;
    if not exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
                   where i.indrelid = 'public.attachments'::regclass
                     and c.relname = 'uq__attachments__storage_key'
                     and i.indisunique and i.indpred is null and i.indnatts = 1) then
        v_failures := array_append(v_failures, 'the full UNIQUE index uq__attachments__storage_key is missing or changed');
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

    -- exactly the S3A trigger set: capture, admission, immutability
    select string_agg(t.tgname || '->' || t.tgfoid::regprocedure::text, ', ' order by t.tgname) into v_names
    from pg_trigger t where t.tgrelid = 'public.attachments'::regclass and not t.tgisinternal;
    if v_names is distinct from
           'enqueue_attachment_storage_deletion_after_delete_trigger->nora_private.enqueue_attachment_storage_deletion(), '
        || 'guard_attachment_reference_admission_after_insert_trigger->nora_private.guard_attachment_reference_admission(), '
        || 'guard_attachment_storage_key_immutable_before_update_trigger->nora_private.guard_attachment_storage_key_immutable()' then
        v_failures := v_failures || format('public.attachments triggers are not the S3A set: %s', coalesce(v_names, '<none>'));
    end if;

    -- the S3A single-writer matrix: authenticated SELECT only, nobody else
    for r in
        select * from (values ('authenticated', 'SELECT'), ('anon', ''), ('service_role', '')) as t(grantee, privs)
    loop
        if (select string_agg(pr, ',' order by pr) from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) pr
            where has_table_privilege(r.grantee, 'public.attachments', pr))
           is distinct from nullif(r.privs, '') then
            v_failures := v_failures || format('%s privileges on public.attachments are not the S3A matrix (%s)', r.grantee, r.privs);
        end if;
    end loop;

    -- ---- the functions S3B delegates to ----------------------------------------
    if not exists (select 1 from pg_proc p
                   where p.oid = to_regprocedure('nora_private.lock_attachment_storage_key(text)')
                     and not p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres'
                     and p.proconfig = array['search_path=""']
                     and position('transaction_isolation' in p.prosrc) > 0) then
        v_failures := array_append(v_failures, 'the S3A key lock helper is missing or changed');
    end if;
    if not exists (select 1 from pg_proc p
                   where p.oid = to_regprocedure('nora_private.guard_attachment_reference_admission()')
                     and p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres'
                     and p.proconfig = array['search_path=""', 'row_security=off']
                     and position('nora_private.lock_attachment_storage_key(new.storage_key)' in p.prosrc) > 0
                     and position('NORA_ATTACHMENT_STORAGE_KEY_PENDING_DELETION' in p.prosrc) > 0) then
        v_failures := array_append(v_failures, 'the S3A admission guard is missing or changed');
    end if;
    if not exists (select 1 from pg_proc p
                   where p.oid = to_regprocedure('nora_private.enqueue_attachment_storage_deletion()')
                     and p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres'
                     and p.proconfig = array['search_path=""']
                     and position('nora_private.lock_attachment_storage_key(old.storage_key)' in p.prosrc) > 0) then
        v_failures := array_append(v_failures, 'the S2A1/S3A capture function is missing or changed');
    end if;
    if not exists (select 1 from pg_proc p
                   where p.oid = to_regprocedure('nora_private.attachment_url_liveness(text,text)')
                     and not p.prosecdef and p.provolatile = 's'
                     and p.prorettype = 'text'::regtype
                     and pg_get_userbyid(p.proowner) = 'postgres'
                     and p.proconfig = array['search_path=""']) then
        v_failures := array_append(v_failures, 'the S2A2.1 URL helper is missing or changed');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'NORA_ATTACHMENT_NOTE_PROJECTION: precondition failed:\n%', array_to_string(v_failures, E'\n')
            using errcode = '55000';
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Grammar v1 validator / extractor (pure: reads no table)
--
-- Returns one row per element (element_no, storage_key, file_name, mime_type)
-- in array order, or raises 22023 NORA_ATTACHMENT_REFERENCE_INVALID for the
-- first invalid element (then for the first repeated path). NULL and '{}' are
-- the empty set. STABLE because it calls the STABLE URL helper; it writes
-- nothing. S4 will run the same grammar over the historical rows.
-- ---------------------------------------------------------------------------
create function nora_private.note_attachment_reference_rows(p_attachments jsonb[])
returns table (element_no bigint, storage_key text, file_name text, mime_type text)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
    v_element bigint;
    v_field   text;
begin
    if p_attachments is null or cardinality(p_attachments) = 0 then
        return;
    end if;

    if array_ndims(p_attachments) <> 1 then
        raise exception 'note attachment reference rejected: the attachment list is not a one-dimensional array'
            using errcode = '22023', detail = 'NORA_ATTACHMENT_REFERENCE_INVALID';
    end if;

    -- the first element that breaks the grammar (all checks in one pass)
    select e.ord, c.field
      into v_element, v_field
      from unnest(p_attachments) with ordinality as e(item, ord)
      cross join lateral (
          select case
              when e.item is null or jsonb_typeof(e.item) <> 'object'
                  then 'not a JSON object'
              when jsonb_typeof(e.item -> 'path') is distinct from 'string'
                   or char_length(e.item ->> 'path') > 512
                   or (e.item ->> 'path') !~ '^[A-Za-z0-9._-]+$'
                   or (e.item ->> 'path') in ('.', '..')
                  then 'path'
              when jsonb_typeof(e.item -> 'title') is distinct from 'string'
                   or btrim(e.item ->> 'title') = ''
                   or char_length(e.item ->> 'title') > 255
                  then 'title'
              when jsonb_typeof(e.item -> 'type') is distinct from 'string'
                   or btrim(e.item ->> 'type') = ''
                   or char_length(e.item ->> 'type') > 255
                  then 'type'
              when e.item -> 'src' is not null
                   and jsonb_typeof(e.item -> 'src') <> 'null'
                   and (jsonb_typeof(e.item -> 'src') <> 'string'
                        or nora_private.attachment_url_liveness(e.item ->> 'src', e.item ->> 'path') <> 'live')
                  then 'src'
          end as field
      ) as c
     where c.field is not null
     order by e.ord
     limit 1;

    if v_element is not null then
        raise exception 'note attachment reference rejected: element % is invalid (%)', v_element, v_field
            using errcode = '22023', detail = 'NORA_ATTACHMENT_REFERENCE_INVALID',
                  hint = 'Every note attachment needs a Nora storage key (path), a title and a type; a src must be the canonical attachments URL of that path.';
    end if;

    -- the same storage key twice in one note is ambiguous: reject, never dedupe
    select d.ord
      into v_element
      from (select e.ord,
                   row_number() over (partition by e.item ->> 'path' order by e.ord) as occurrence
              from unnest(p_attachments) with ordinality as e(item, ord)) as d
     where d.occurrence > 1
     order by d.ord
     limit 1;

    if v_element is not null then
        raise exception 'note attachment reference rejected: element % repeats the storage key of an earlier element', v_element
            using errcode = '22023', detail = 'NORA_ATTACHMENT_REFERENCE_INVALID';
    end if;

    return query
        select e.ord, e.item ->> 'path', e.item ->> 'title', e.item ->> 'type'
          from unnest(p_attachments) with ordinality as e(item, ord)
         order by e.ord;
end;
$$;

alter function nora_private.note_attachment_reference_rows(jsonb[]) owner to postgres;

comment on function nora_private.note_attachment_reference_rows(jsonb[]) is
    'W8-C S3B: grammar v1 of a note attachment array. Returns (element_no, storage_key, file_name, mime_type) per element in array order, or raises 22023 NORA_ATTACHMENT_REFERENCE_INVALID for the first element that is not a JSON object, has no valid path (^[A-Za-z0-9._-]+$, <= 512, not . / ..), no non-blank title / type (<= 255), or a src other than absent / null / the canonical attachments URL of that path on an allowlisted origin (attachment_url_liveness = live); a repeated path is rejected too. NULL and {} are the empty set. storage_key = path verbatim; rawFile and other fields are ignored. Reads no table, writes nothing. No API role may execute it.';

revoke all on function nora_private.note_attachment_reference_rows(jsonb[]) from public;
revoke all on function nora_private.note_attachment_reference_rows(jsonb[]) from anon;
revoke all on function nora_private.note_attachment_reference_rows(jsonb[]) from authenticated;
revoke all on function nora_private.note_attachment_reference_rows(jsonb[]) from service_role;

-- ---------------------------------------------------------------------------
-- 2. Core reconcile: one note, minimal delta against the ACTUAL rows
--
-- VOLATILE is required: it writes, and every statement must take a fresh READ
-- COMMITTED snapshot - a same-note update that waited on the note row and was
-- re-checked must see the rows the previous writer committed.
-- The caller must hold the note row (the triggering UPDATE does; a new INSERT
-- is invisible to others; S4 must lock the note row FOR UPDATE first).
-- ---------------------------------------------------------------------------
create function nora_private.reconcile_note_attachments(
    p_contact_note_id bigint,
    p_deal_note_id    bigint,
    p_attachments     jsonb[]
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
set row_security = off
as $$
declare
    v_keys    text[];
    v_names   text[];
    v_mimes   text[];
    v_element bigint;
    v_remove  bigint[];
begin
    if num_nonnulls(p_contact_note_id, p_deal_note_id) <> 1 then
        raise exception 'note attachment reconciliation: exactly one owner note id is required'
            using errcode = '22023', detail = 'NORA_ATTACHMENT_INVALID_ARGUMENT';
    end if;

    -- D: validated desired set, in element order
    select coalesce(array_agg(r.storage_key order by r.element_no), '{}'),
           coalesce(array_agg(r.file_name   order by r.element_no), '{}'),
           coalesce(array_agg(r.mime_type   order by r.element_no), '{}')
      into v_keys, v_names, v_mimes
      from nora_private.note_attachment_reference_rows(p_attachments) as r;

    -- KEEP: a key the note already has must keep its title and type. Rows are
    -- immutable (S1): no metadata UPDATE, and no silently diverging JSON.
    select d.element_no
      into v_element
      from unnest(v_keys, v_names, v_mimes) with ordinality as d(storage_key, file_name, mime_type, element_no)
      join public.attachments a
        on a.storage_key = d.storage_key
       and (a.contact_note_id = p_contact_note_id or a.deal_note_id = p_deal_note_id)
     where a.file_name is distinct from d.file_name
        or a.mime_type is distinct from d.mime_type
     order by d.element_no
     limit 1;

    if v_element is not null then
        raise exception 'note attachment reference rejected: element % changes the title or type of an attachment the note already has', v_element
            using errcode = '22023', detail = 'NORA_ATTACHMENT_REFERENCE_INVALID';
    end if;

    -- REMOVE = E - D: plain DELETE, so the S2A1/S3A capture runs per row
    select coalesce(array_agg(a.id), '{}')
      into v_remove
      from public.attachments a
     where (a.contact_note_id = p_contact_note_id or a.deal_note_id = p_deal_note_id)
       and a.storage_key <> all (v_keys);

    if cardinality(v_remove) > 0 then
        delete from public.attachments a
         where a.id = any (v_remove);
    end if;

    -- ADD = D - E: plain INSERT, so S3A admission runs per row. Deterministic
    -- storage_key COLLATE "C" order: concurrent multi-key adds wait on the
    -- unique index in the same order instead of deadlocking.
    if cardinality(v_keys) > 0 then
        insert into public.attachments (contact_note_id, deal_note_id, storage_key, file_name, mime_type)
        select p_contact_note_id, p_deal_note_id, d.storage_key, d.file_name, d.mime_type
          from unnest(v_keys, v_names, v_mimes) as d(storage_key, file_name, mime_type)
         where not exists (select 1
                             from public.attachments a
                            where a.storage_key = d.storage_key
                              and (a.contact_note_id = p_contact_note_id or a.deal_note_id = p_deal_note_id))
         order by d.storage_key collate "C";
    end if;
end;
$$;

alter function nora_private.reconcile_note_attachments(bigint, bigint, jsonb[]) owner to postgres;

comment on function nora_private.reconcile_note_attachments(bigint, bigint, jsonb[]) is
    'W8-C S3B: reconciles the public.attachments rows of ONE note (exactly one of contact_note_id / deal_note_id, else 22023 NORA_ATTACHMENT_INVALID_ARGUMENT) with its attachment array. D = grammar v1 rows (note_attachment_reference_rows), E = the rows the note owns now. KEEP (E n D) is never written and must keep title / type (else 22023 NORA_ATTACHMENT_REFERENCE_INVALID); REMOVE (E - D) is a plain DELETE (capture); ADD (D - E) a plain INSERT in storage_key COLLATE "C" order (admission). Never takes the key lock itself, never calls claim / inspect / fail / the resolver, no exception handler. VOLATILE (fresh snapshot per statement). Caller holds the note row; S4 reuses it under a note row lock. No API role may execute it.';

revoke all on function nora_private.reconcile_note_attachments(bigint, bigint, jsonb[]) from public;
revoke all on function nora_private.reconcile_note_attachments(bigint, bigint, jsonb[]) from anon;
revoke all on function nora_private.reconcile_note_attachments(bigint, bigint, jsonb[]) from authenticated;
revoke all on function nora_private.reconcile_note_attachments(bigint, bigint, jsonb[]) from service_role;

-- ---------------------------------------------------------------------------
-- 3. Trigger dispatcher
--
-- SECURITY DEFINER because the note writer (authenticated / service_role)
-- holds no write privilege on public.attachments and no EXECUTE on the core.
-- row_security = off makes RLS drift on public.attachments raise instead of
-- hiding rows from E. The owner is derived from the triggering table and
-- NEW.id only.
-- ---------------------------------------------------------------------------
create function nora_private.project_note_attachments()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
    if tg_when <> 'AFTER' or tg_level <> 'ROW' or tg_op not in ('INSERT', 'UPDATE') then
        raise exception 'note attachment projection must run as an AFTER INSERT / UPDATE row trigger (got % % %)', tg_when, tg_level, tg_op
            using errcode = '22023', detail = 'NORA_ATTACHMENT_INVALID_ARGUMENT';
    end if;

    if tg_table_schema = 'public' and tg_table_name = 'contact_notes' then
        perform nora_private.reconcile_note_attachments(new.id, null, new.attachments);
    elsif tg_table_schema = 'public' and tg_table_name = 'deal_notes' then
        perform nora_private.reconcile_note_attachments(null, new.id, new.attachments);
    else
        raise exception 'note attachment projection is not defined for %.%', tg_table_schema, tg_table_name
            using errcode = '22023', detail = 'NORA_ATTACHMENT_INVALID_ARGUMENT';
    end if;

    return null;
end;
$$;

alter function nora_private.project_note_attachments() owner to postgres;

comment on function nora_private.project_note_attachments() is
    'W8-C S3B: AFTER INSERT / UPDATE row trigger on public.contact_notes and public.deal_notes. Calls nora_private.reconcile_note_attachments(NEW.id as the owner of the triggering table, NEW.attachments); any failure aborts the note statement, so the JSON never commits without its projection. SECURITY DEFINER (writers hold only SELECT on public.attachments), search_path = '''', row_security = off. No DELETE trigger: the note FK CASCADE deletes the rows and fires the S2A1/S3A capture. No API role may execute it.';

revoke all on function nora_private.project_note_attachments() from public;
revoke all on function nora_private.project_note_attachments() from anon;
revoke all on function nora_private.project_note_attachments() from authenticated;
revoke all on function nora_private.project_note_attachments() from service_role;

-- ---------------------------------------------------------------------------
-- 4. Lock, legacy census, triggers - one statement
--
-- SHARE ROW EXCLUSIVE on both note tables, public.attachments and the queue
-- blocks every concurrent writer of the census inputs until COMMIT (reads stay
-- open). With the lock held: public.attachments must be empty (clean pre-S4
-- baseline), every existing note array must satisfy grammar v1, no storage key
-- may appear in two notes, and no key may carry an active or done deletion
-- intent - otherwise the first attachment-changing edit of that note could not
-- reconcile. Then the four triggers are created. No row is written.
-- ---------------------------------------------------------------------------
do $$
declare
    r          record;
    v_failures text[] := '{}';
    v_invalid  text[] := '{}';
    v_count    bigint;
    v_notes    text;
begin
    lock table public.contact_notes, public.deal_notes, public.attachments,
               nora_private.attachment_storage_deletion_queue
        in share row exclusive mode;

    if exists (select 1 from public.attachments) then
        v_failures := array_append(v_failures,
            'public.attachments is not empty - S3B expects the clean pre-S4 baseline (no projection, no backfill yet)');
    end if;

    -- grammar v1 over every existing array (the validator is the one grammar)
    for r in
        select 'contact_notes' as tbl, n.id, n.attachments from public.contact_notes n
         where cardinality(n.attachments) > 0
        union all
        select 'deal_notes', n.id, n.attachments from public.deal_notes n
         where cardinality(n.attachments) > 0
        order by 1, 2
    loop
        begin
            perform nora_private.note_attachment_reference_rows(r.attachments);
        exception when invalid_parameter_value then
            v_invalid := v_invalid || format('%s id=%s: %s', r.tbl, r.id, sqlerrm);
        end;
    end loop;
    if cardinality(v_invalid) > 0 then
        v_failures := v_failures || format('%s note(s) hold attachment elements outside grammar v1:', cardinality(v_invalid));
        v_failures := v_failures || v_invalid[1:20];
    end if;

    -- one storage key, one note (keys are never printed)
    select count(*), string_agg(k.notes, '; ')
      into v_count, v_notes
      from (select string_agg(j.tbl || ' id=' || j.id, ', ' order by j.tbl, j.id) as notes
              from (select 'contact_notes' as tbl, n.id, e.item ->> 'path' as storage_key
                      from public.contact_notes n cross join lateral unnest(n.attachments) as e(item)
                    union all
                    select 'deal_notes', n.id, e.item ->> 'path'
                      from public.deal_notes n cross join lateral unnest(n.attachments) as e(item)) as j
             where j.storage_key is not null
             group by j.storage_key
            having count(*) > 1) as k;
    if v_count > 0 then
        v_failures := v_failures || format('%s storage key(s) appear in more than one note element: %s', v_count, v_notes);
    end if;

    -- no legacy key may already be blocked by an active or done intent
    select count(distinct q.storage_key)
      into v_count
      from nora_private.attachment_storage_deletion_queue q
     where q.state in ('pending', 'claimed', 'failed_retryable', 'done')
       and q.storage_key in (select e.item ->> 'path'
                               from public.contact_notes n cross join lateral unnest(n.attachments) as e(item)
                             union
                             select e.item ->> 'path'
                               from public.deal_notes n cross join lateral unnest(n.attachments) as e(item));
    if v_count > 0 then
        v_failures := v_failures || format('%s legacy note storage key(s) carry an active or done deletion intent', v_count);
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'NORA_ATTACHMENT_NOTE_PROJECTION: legacy census failed:\n%', array_to_string(v_failures, E'\n')
            using errcode = '55000',
                  hint = 'S3B does not remediate historical data. Resolve the listed notes first (S4 scope) and re-run.';
    end if;

    create trigger project_contact_note_attachments_after_insert_trigger
        after insert on public.contact_notes
        for each row
        when (cardinality(new.attachments) > 0)
        execute function nora_private.project_note_attachments();

    create trigger project_contact_note_attachments_after_update_trigger
        after update on public.contact_notes
        for each row
        when (coalesce(old.attachments, '{}'::jsonb[]) is distinct from coalesce(new.attachments, '{}'::jsonb[]))
        execute function nora_private.project_note_attachments();

    create trigger project_deal_note_attachments_after_insert_trigger
        after insert on public.deal_notes
        for each row
        when (cardinality(new.attachments) > 0)
        execute function nora_private.project_note_attachments();

    create trigger project_deal_note_attachments_after_update_trigger
        after update on public.deal_notes
        for each row
        when (coalesce(old.attachments, '{}'::jsonb[]) is distinct from coalesce(new.attachments, '{}'::jsonb[]))
        execute function nora_private.project_note_attachments();
end;
$$;

comment on trigger project_contact_note_attachments_after_insert_trigger on public.contact_notes is
    'W8-C S3B: projects a new contact note''s attachment array into public.attachments (skipped for NULL / empty arrays).';
comment on trigger project_contact_note_attachments_after_update_trigger on public.contact_notes is
    'W8-C S3B: reconciles public.attachments when the attachment array changes (NULL and {} are equal; body-only writes do not fire). Deliberately no UPDATE OF column list: a BEFORE trigger rewriting the array must still be projected.';
comment on trigger project_deal_note_attachments_after_insert_trigger on public.deal_notes is
    'W8-C S3B: projects a new deal note''s attachment array into public.attachments (skipped for NULL / empty arrays).';
comment on trigger project_deal_note_attachments_after_update_trigger on public.deal_notes is
    'W8-C S3B: reconciles public.attachments when the attachment array changes (NULL and {} are equal; body-only writes do not fire). Deliberately no UPDATE OF column list: a BEFORE trigger rewriting the array must still be projected.';

-- ---------------------------------------------------------------------------
-- 5. Postconditions (fail-closed)
-- ---------------------------------------------------------------------------
do $$
declare
    r          record;
    v_role     text;
    v_src      text;
    v_all_src  text;
    v_names    text;
    v_token    text;
    v_failures text[] := '{}';
    c_update_when constant text :=
        'WHEN ((COALESCE(old.attachments, ''{}''::jsonb[]) IS DISTINCT FROM COALESCE(new.attachments, ''{}''::jsonb[])))';
    c_insert_when constant text :=
        'WHEN ((cardinality(new.attachments) > 0))';
begin
    -- 5a. function shape, security settings, owner-only ACL, no API EXECUTE
    for r in
        select * from (values
            ('nora_private.note_attachment_reference_rows(jsonb[])',            'record',  false, 's', true,  array['search_path=""']),
            ('nora_private.reconcile_note_attachments(bigint,bigint,jsonb[])',  'void',    false, 'v', false, array['search_path=""', 'row_security=off']),
            ('nora_private.project_note_attachments()',                         'trigger', true,  'v', false, array['search_path=""', 'row_security=off'])
        ) as t(sig, rettype, secdef, volatility, retset, config)
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
                         and p.proretset = r.retset
                         and l.lanname = 'plpgsql'
                         and p.provolatile = r.volatility::"char"
                         and p.prosecdef = r.secdef
                         and pg_get_userbyid(p.proowner) = 'postgres'
                         and p.proconfig = r.config) then
            v_failures := v_failures || format('%s: wrong return type / language / volatility / definer / owner / settings', r.sig);
        end if;
        if (select p.proacl is null from pg_proc p where p.oid = to_regprocedure(r.sig))
           or exists (select 1 from pg_proc p, aclexplode(p.proacl) acl
                      where p.oid = to_regprocedure(r.sig)
                        and (acl.grantee = 0 or pg_get_userbyid(acl.grantee) <> 'postgres')) then
            v_failures := v_failures || format('%s carries an ACL entry for a role other than postgres', r.sig);
        end if;
        foreach v_role in array array['public', 'anon', 'authenticated', 'service_role'] loop
            if has_function_privilege(v_role, r.sig, 'EXECUTE') then
                v_failures := v_failures || format('%s holds EXECUTE on %s', v_role, r.sig);
            end if;
        end loop;

        -- 5b. hygiene: no key lock, no queue execution, no resolver, no network
        --     / Storage, no dynamic SQL, no exception handler
        select p.prosrc into v_src from pg_proc p where p.oid = to_regprocedure(r.sig);
        foreach v_token in array array['lock_attachment_storage_key', 'attachment_deletion_claim_next',
                                       'attachment_deletion_inspect', 'attachment_deletion_fail',
                                       'attachment_storage_key_liveness', 'attachment_storage_deletion_queue',
                                       'pg_advisory', 'net.http', 'pg_net', 'http_post', 'http_get',
                                       'storage.objects', 'storage.buckets', 'functions/v1', 'dblink',
                                       'pg_background', 'execute ', 'transaction_isolation'] loop
            if position(v_token in lower(v_src)) > 0 then
                v_failures := v_failures || format('%s references %s', r.sig, v_token);
            end if;
        end loop;
        if v_src ~* 'exception\s+when' then
            v_failures := v_failures || format('%s contains an exception handler', r.sig);
        end if;
    end loop;

    -- 5c. the validator is the only grammar and delegates src to the URL helper
    select p.prosrc into v_src from pg_proc p where p.oid = to_regprocedure('nora_private.note_attachment_reference_rows(jsonb[])');
    if (select count(*) from regexp_matches(v_src, 'nora_private\.attachment_url_liveness\(', 'g')) <> 1
       or position('NORA_ATTACHMENT_REFERENCE_INVALID' in v_src) = 0
       or v_src ~* '(insert|update|delete)\s' then
        v_failures := array_append(v_failures, '5c the validator is not the read-only grammar delegating src to attachment_url_liveness');
    end if;

    -- 5d. the core: one validator call, minimal delta, REMOVE before ADD, ADD
    --     in COLLATE "C" order, never an UPDATE of public.attachments
    select p.prosrc into v_src from pg_proc p where p.oid = to_regprocedure('nora_private.reconcile_note_attachments(bigint,bigint,jsonb[])');
    if (select count(*) from regexp_matches(v_src, 'nora_private\.note_attachment_reference_rows\(', 'g')) <> 1
       or (select count(*) from regexp_matches(v_src, 'delete from public\.attachments', 'g')) <> 1
       or (select count(*) from regexp_matches(v_src, 'insert into public\.attachments', 'g')) <> 1
       or v_src ~* 'update\s+public\.attachments'
       or position('delete from public.attachments' in v_src) > position('insert into public.attachments' in v_src)
       or position('order by d.storage_key collate "C"' in v_src) = 0
       or position('a.storage_key <> all (v_keys)' in v_src) = 0
       or position('where not exists' in v_src) = 0 then
        v_failures := array_append(v_failures, '5d the core is not validate -> KEEP check -> REMOVE (DELETE) -> ADD (INSERT, COLLATE "C") without UPDATE');
    end if;

    -- 5e. the dispatcher: owner from the triggering table only
    select p.prosrc into v_src from pg_proc p where p.oid = to_regprocedure('nora_private.project_note_attachments()');
    if (select count(*) from regexp_matches(v_src, 'nora_private\.reconcile_note_attachments\(', 'g')) <> 2
       or position('reconcile_note_attachments(new.id, null, new.attachments)' in v_src) = 0
       or position('reconcile_note_attachments(null, new.id, new.attachments)' in v_src) = 0 then
        v_failures := array_append(v_failures, '5e the dispatcher does not derive the owner from the triggering table and NEW.id');
    end if;

    -- 5f. trigger inventory on the note tables: exactly the four S3B triggers
    --     that call the dispatcher, AFTER ROW, INSERT / UPDATE only, exact WHEN
    select string_agg(t.tgname, ', ' order by t.tgname) into v_names
      from pg_trigger t
     where not t.tgisinternal and t.tgfoid = to_regprocedure('nora_private.project_note_attachments()');
    if v_names is distinct from
           'project_contact_note_attachments_after_insert_trigger, project_contact_note_attachments_after_update_trigger, '
        || 'project_deal_note_attachments_after_insert_trigger, project_deal_note_attachments_after_update_trigger' then
        v_failures := v_failures || format('the dispatcher triggers are not exactly the four S3B triggers: %s', coalesce(v_names, '<none>'));
    end if;
    for r in
        select * from (values
            ('public.contact_notes', 'project_contact_note_attachments_after_insert_trigger', 4,  c_insert_when),
            ('public.contact_notes', 'project_contact_note_attachments_after_update_trigger', 16, c_update_when),
            ('public.deal_notes',    'project_deal_note_attachments_after_insert_trigger',    4,  c_insert_when),
            ('public.deal_notes',    'project_deal_note_attachments_after_update_trigger',    16, c_update_when)
        ) as t(tbl, tgname, event_bit, when_clause)
    loop
        if not exists (select 1 from pg_trigger t
                       where t.tgrelid = r.tbl::regclass and t.tgname = r.tgname
                         and t.tgfoid = to_regprocedure('nora_private.project_note_attachments()')
                         and t.tgenabled = 'O'
                         and (t.tgtype & 1) = 1           -- ROW
                         and (t.tgtype & 2) = 0           -- AFTER
                         and (t.tgtype & 64) = 0          -- not INSTEAD OF
                         and (t.tgtype & 28) = r.event_bit -- exactly one of INSERT(4) / DELETE(8) / UPDATE(16)
                         and t.tgattr::text = ''          -- no UPDATE OF column list
                         and position(r.when_clause in pg_get_triggerdef(t.oid)) > 0) then
            v_failures := v_failures || format('%s on %s is not the expected AFTER ROW trigger with its WHEN guard', r.tgname, r.tbl);
        end if;
    end loop;
    -- no projection on DELETE (the FK cascade + capture own it)
    if exists (select 1 from pg_trigger t
               where t.tgrelid in ('public.contact_notes'::regclass, 'public.deal_notes'::regclass)
                 and not t.tgisinternal and (t.tgtype & 8) = 8
                 and t.tgfoid = to_regprocedure('nora_private.project_note_attachments()')) then
        v_failures := array_append(v_failures, 'a note DELETE trigger calls the projection');
    end if;

    -- 5g. public.attachments untouched: S3A triggers, single-writer matrix, empty
    select string_agg(t.tgname, ', ' order by t.tgname) into v_names
    from pg_trigger t where t.tgrelid = 'public.attachments'::regclass and not t.tgisinternal;
    if v_names is distinct from 'enqueue_attachment_storage_deletion_after_delete_trigger, '
                             || 'guard_attachment_reference_admission_after_insert_trigger, '
                             || 'guard_attachment_storage_key_immutable_before_update_trigger' then
        v_failures := v_failures || format('public.attachments triggers changed: %s', coalesce(v_names, '<none>'));
    end if;
    for r in
        select * from (values ('authenticated', 'SELECT'), ('anon', ''), ('service_role', '')) as t(grantee, privs)
    loop
        if (select string_agg(pr, ',' order by pr) from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) pr
            where has_table_privilege(r.grantee, 'public.attachments', pr))
           is distinct from nullif(r.privs, '') then
            v_failures := v_failures || format('%s privileges on public.attachments changed (expected %s)', r.grantee, coalesce(nullif(r.privs, ''), 'none'));
        end if;
    end loop;
    if exists (select 1 from public.attachments) then
        v_failures := array_append(v_failures, 'public.attachments is not empty after the migration (S3B writes no row)');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'NORA_ATTACHMENT_NOTE_PROJECTION aborted:\n%', array_to_string(v_failures, E'\n');
    end if;
end;
$$;
