-- Nora CRM: W8-C S6-A Attachment Ordinal (2026-09-22)
--
-- public.attachments becomes the membership AND order authority for a note's
-- attachments: one additive integer column `ordinal` per row, backfilled from
-- the certified legacy element position, made NOT NULL, and protected by one
-- UNIQUE NULLS NOT DISTINCT (contact_note_id, deal_note_id, ordinal) table
-- constraint. The note JSON keeps being written and keeps being the order
-- master for the READ path until S6-B1 - S6-A changes no read, no grant, no
-- policy, no trigger, no RPC and nothing in src/**.
--
-- APPEND SEMANTICS (frozen contract D4, unchanged here)
--   existing rows  ordinal := certified legacy element_no (this migration)
--   future ADD     ordinal := v_base + element_no, where v_base is the highest
--                  ordinal the note still owns AFTER the REMOVE delete
--   KEEP           never renumbered, never updated
--   REMOVE         plain DELETE, no compaction - gaps are normal and expected
--   NEVER          `ordinal := element_no` on its own. That form is a
--                  user-reachable 23505 the moment a key is inserted at the
--                  front of an existing note's array (measured), because
--                  element_no indexes the FULL desired array while the
--                  `where not exists` filter is applied after `with ordinality`
--                  and KEEP rows keep their old ordinals. Step 12e below is the
--                  designed guard against that body ever shipping.
--
-- NO TRANSACTION CONTROL IN THIS FILE.
--   There is no `begin;`, no `commit;`, no `rollback;`, no `start transaction`
--   - as in all 67 migrations before it. The apply channel wraps the whole file
--   in ONE transaction and writes its supabase_migrations.schema_migrations row
--   inside it, so body and ledger commit or abort together. An explicit
--   `commit;` in the file would move the ledger row into a LATER transaction
--   and create exactly the "schema applied, ledger row absent" state this
--   migration must not be able to produce.
--   `LOCK TABLE` is rejected with 25P01 at the top level of such a pipeline
--   (TBLOCK_STARTED is not a transaction BLOCK), which is why the lock enters
--   through a procedural `do $lock$ ... end $lock$;` block - the shape
--   20260919180000_nora_attachment_note_projection.sql:468-479 already applied
--   to Production on 2026-09-19.
--
-- CANONICAL LOCK ORDER - four relations, four statements, never reordered:
--   1. public.contact_notes                             SHARE ROW EXCLUSIVE
--   2. public.deal_notes                                SHARE ROW EXCLUSIVE
--   3. public.attachments                               ACCESS EXCLUSIVE
--   4. nora_private.attachment_storage_deletion_queue   SHARE ROW EXCLUSIVE
--   The note tables come first because every runtime writer descends note row
--   -> attachments -> queue: taking them first means this migration can only
--   ever WAIT on that path, never cycle with it (inverted order: measured
--   deadlock, the user's note save dies). public.attachments is taken DIRECTLY
--   at ACCESS EXCLUSIVE - its final strength - so there is no SHARE ROW
--   EXCLUSIVE -> ACCESS EXCLUSIVE upgrade point for the reverse-order deletion
--   worker to cycle with (upgrade form: measured deadlock, the migration dies).
--   The queue comes last so that worker's terminal queue write can always
--   complete while this migration waits on public.attachments.
--
-- RELATIONS THIS MIGRATION MUST NOT LOCK: public.audit_events, public.contacts,
--   public.deals, public.companies, public.sales. They are runtime-UPSTREAM of
--   public.attachments (the note audit trigger sorts before the projection
--   trigger, and a cascade delete descends company -> contact -> note -> row),
--   and S6-A needs none of them. Locking them would widen the blast radius for
--   no benefit; locking them out of the runtime descent order would add a
--   fresh cycle. Do not "complete" the list.
--
-- TWO BUDGETS, BOTH REAL, NEVER CONFLATED:
--   B_acq       3 s   per ACQUISITION, enforced by PostgreSQL's lock_timeout
--   B_total_acq 6 s   TOTAL acquisition wait, enforced here by a clock_timestamp()
--                     deadline that narrows lock_timeout before every single
--                     acquisition. Without it four acquisitions can wait ~4x3 s
--                     and still return rc=0 (measured 9.6-10.0 s).
--   NAMED TRAP: lock_timeout = '0' means TIMEOUT DISABLED - wait forever - not
--   "deadline expired". The `v_left_ms <= 0` raise below is therefore
--   load-bearing, not defensive decoration. Never write greatest(0, v_left_ms),
--   never let a non-positive remainder reach set_config.
--   statement_timeout = 30 s is a backstop against an unforeseen scan, not a
--   budget; it does NOT bound the lock block itself, which runs under the
--   applying session's INHERITED statement ceiling.
--   idle_in_transaction_session_timeout = 10 s bounds a stalled CLIENT holding
--   ACCESS EXCLUSIVE between acquisition and COMMIT (25P03, fail-closed). It is
--   not a statement execution timeout. transaction_timeout is deliberately not
--   used: it exists only on PG17 and the declared floor is PG15.
--   The measured ACCESS EXCLUSIVE hold is a CERTIFICATION metric, not a runtime
--   guard: nothing in this file enforces it.
--
-- FAIL-CLOSED: every durable step is preceded by an assertion. Unexpected
-- pre-S6-A state aborts; this migration never repairs data. A grammar-invalid
-- note, a note whose JSON references keys but owns no row (PARTIAL / ghost), a
-- row no note's JSON asks for (EXTRA), a queued `done` intent, a NULL ordinal
-- after the backfill and a duplicate ordinal all abort with no residue.

-- ---------------------------------------------------------------------------
-- 1. Pre-lock preconditions - catalog only, so they take no lock on any of the
--    four relations and cannot turn the lock acquisitions into upgrades.
-- ---------------------------------------------------------------------------
do $precond$
declare
    v_failures text[] := '{}';
    v_cols     text;
    v_acl      text;
begin
    if current_setting('transaction_isolation') <> 'read committed' then
        raise exception 'W8-C S6-A: this migration requires READ COMMITTED, found %', current_setting('transaction_isolation')
            using errcode = '55000', detail = 'NORA_S6A_READ_COMMITTED_REQUIRED';
    end if;

    if current_setting('server_version_num')::integer < 150000 then
        v_failures := v_failures || format('PostgreSQL 15 or newer is required for UNIQUE NULLS NOT DISTINCT, found %s',
                                           current_setting('server_version'));
    end if;

    if to_regclass('public.attachments') is null then
        raise exception 'W8-C S6-A: public.attachments does not exist' using errcode = 'P0001';
    end if;

    select string_agg(a.attname, ',' order by a.attnum)
      into v_cols
      from pg_attribute a
     where a.attrelid = 'public.attachments'::regclass
       and a.attnum > 0 and not a.attisdropped;
    if v_cols is distinct from 'id,contact_note_id,deal_note_id,storage_key,file_name,mime_type,byte_size,created_at' then
        v_failures := v_failures || format('public.attachments must carry exactly the eight pre-S6-A columns, found: %s', coalesce(v_cols, '<none>'));
    end if;

    if to_regprocedure('nora_private.note_attachment_reference_rows(jsonb[])') is null then
        v_failures := array_append(v_failures, 'nora_private.note_attachment_reference_rows(jsonb[]) is missing - grammar v1 is the only backfill source');
    end if;
    if to_regprocedure('nora_private.reconcile_note_attachments(bigint,bigint,jsonb[])') is null then
        v_failures := array_append(v_failures, 'nora_private.reconcile_note_attachments(bigint,bigint,jsonb[]) is missing - S6-A replaces its body');
    end if;

    if exists (select 1 from pg_constraint c
                where c.conrelid = 'public.attachments'::regclass
                  and c.conname = 'uq__attachments__owner_ordinal') then
        v_failures := array_append(v_failures, 'constraint uq__attachments__owner_ordinal already exists - this looks like a partial S6-A state');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'W8-C S6-A preconditions failed:\n%', array_to_string(v_failures, E'\n')
            using errcode = 'P0001', detail = 'NORA_S6A_PRECONDITION_FAILED',
                  hint = 'S6-A does not remediate. Restore the expected pre-S6-A state and re-run.';
    end if;

    -- pinned here, compared again in step 12g: create or replace must not move
    -- a single ACL entry of the core.
    select coalesce(p.proacl::text, '<null>')
      into v_acl
      from pg_proc p
     where p.oid = to_regprocedure('nora_private.reconcile_note_attachments(bigint,bigint,jsonb[])');
    perform set_config('nora.s6a_core_acl', v_acl, true);
end
$precond$;

-- ---------------------------------------------------------------------------
-- 2. Lock block: two budgets, four acquisitions, canonical order.
-- ---------------------------------------------------------------------------
do $lock$
declare
    c_acq_ms   constant integer := 3000;
    c_total_ms constant integer := 6000;
    v_deadline constant timestamptz := clock_timestamp() + make_interval(secs => c_total_ms / 1000.0);
    v_left_ms  integer;
begin
    perform set_config('statement_timeout', '30s', true);
    perform set_config('idle_in_transaction_session_timeout', '10s', true);

    v_left_ms := floor(extract(epoch from (v_deadline - clock_timestamp())) * 1000)::integer;
    if v_left_ms <= 0 then
        raise exception 'W8-C S6-A: total lock-acquisition budget exhausted before %', 'public.contact_notes'
            using errcode = '55P03', detail = 'NORA_S6A_LOCK_BUDGET_EXHAUSTED';
    end if;
    perform set_config('lock_timeout', least(c_acq_ms, v_left_ms)::text, true);
    lock table public.contact_notes in share row exclusive mode;

    v_left_ms := floor(extract(epoch from (v_deadline - clock_timestamp())) * 1000)::integer;
    if v_left_ms <= 0 then
        raise exception 'W8-C S6-A: total lock-acquisition budget exhausted before %', 'public.deal_notes'
            using errcode = '55P03', detail = 'NORA_S6A_LOCK_BUDGET_EXHAUSTED';
    end if;
    perform set_config('lock_timeout', least(c_acq_ms, v_left_ms)::text, true);
    lock table public.deal_notes in share row exclusive mode;

    v_left_ms := floor(extract(epoch from (v_deadline - clock_timestamp())) * 1000)::integer;
    if v_left_ms <= 0 then
        raise exception 'W8-C S6-A: total lock-acquisition budget exhausted before %', 'public.attachments'
            using errcode = '55P03', detail = 'NORA_S6A_LOCK_BUDGET_EXHAUSTED';
    end if;
    perform set_config('lock_timeout', least(c_acq_ms, v_left_ms)::text, true);
    lock table public.attachments in access exclusive mode;

    v_left_ms := floor(extract(epoch from (v_deadline - clock_timestamp())) * 1000)::integer;
    if v_left_ms <= 0 then
        raise exception 'W8-C S6-A: total lock-acquisition budget exhausted before %', 'nora_private.attachment_storage_deletion_queue'
            using errcode = '55P03', detail = 'NORA_S6A_LOCK_BUDGET_EXHAUSTED';
    end if;
    perform set_config('lock_timeout', least(c_acq_ms, v_left_ms)::text, true);
    lock table nora_private.attachment_storage_deletion_queue in share row exclusive mode;

    -- the acquisition phase is over: restore the plain per-lock budget for the
    -- remainder of the migration (the DDL below needs no further acquisition -
    -- public.attachments is already held at its final strength).
    perform set_config('lock_timeout', c_acq_ms::text, true);
end
$lock$;

-- ---------------------------------------------------------------------------
-- 3. In-migration census - UNDER the lock, so the corpus cannot move between
--    the census and the backfill. Four probes, all fail-closed, no repair.
-- ---------------------------------------------------------------------------
do $census$
declare
    r          record;
    v_failures text[] := '{}';
    v_invalid  text[] := '{}';
    v_count    bigint;
    v_labels   text;
begin
    -- 3a. grammar v1 over every attachment-bearing note, one note at a time so
    --     a single invalid array is CLASSIFIED instead of aborting the scan.
    for r in
        select 'contact_notes' as tbl, n.id, n.attachments from public.contact_notes n
         where coalesce(cardinality(n.attachments), 0) > 0
        union all
        select 'deal_notes', n.id, n.attachments from public.deal_notes n
         where coalesce(cardinality(n.attachments), 0) > 0
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

    -- 3b. PARTIAL / ghost note: JSON references keys, the note owns no row at
    --     all. The backfill joins rows to elements, so it would never see this
    --     note and the NULL-ordinal backstop would stay silent.
    select count(*), left(coalesce(string_agg(g.label, ', ' order by g.label), ''), 400)
      into v_count, v_labels
      from (
            select 'contact_notes:' || n.id::text as label
              from public.contact_notes n
             where coalesce(cardinality(n.attachments), 0) > 0
               and not exists (select 1 from public.attachments a where a.contact_note_id = n.id)
            union all
            select 'deal_notes:' || n.id::text
              from public.deal_notes n
             where coalesce(cardinality(n.attachments), 0) > 0
               and not exists (select 1 from public.attachments a where a.deal_note_id = n.id)
           ) as g;
    if v_count > 0 then
        v_failures := v_failures || format('%s attachment-bearing note(s) own no attachment row (PARTIAL / not backfilled): %s', v_count, v_labels);
    end if;

    -- 3c. EXTRA: a row whose storage key its owner note's array does not ask
    --     for. Raw `path` only - the grammar itself is checked in 3a.
    with legacy as (
        select n.id as contact_note_id, null::bigint as deal_note_id, e.item ->> 'path' as storage_key
          from public.contact_notes n cross join lateral unnest(n.attachments) as e(item)
         where jsonb_typeof(e.item) = 'object'
        union all
        select null::bigint, n.id, e.item ->> 'path'
          from public.deal_notes n cross join lateral unnest(n.attachments) as e(item)
         where jsonb_typeof(e.item) = 'object'
    )
    select count(*), left(coalesce(string_agg('attachments:' || a.id::text, ', ' order by a.id), ''), 400)
      into v_count, v_labels
      from public.attachments a
     where not exists (select 1 from legacy l
                        where l.storage_key = a.storage_key
                          and l.contact_note_id is not distinct from a.contact_note_id
                          and l.deal_note_id is not distinct from a.deal_note_id);
    if v_count > 0 then
        v_failures := v_failures || format('%s attachment row(s) are not referenced by their owner note (EXTRA): %s', v_count, v_labels);
    end if;

    -- 3d. no `done` deletion intent may still be sitting in the queue
    select count(*)
      into v_count
      from nora_private.attachment_storage_deletion_queue q
     where q.state = 'done';
    if v_count > 0 then
        v_failures := v_failures || format('%s deletion intent(s) are in state done - drain the queue before S6-A', v_count);
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'W8-C S6-A census failed:\n%', array_to_string(v_failures, E'\n')
            using errcode = 'P0001', detail = 'NORA_S6A_CENSUS_FAILED',
                  hint = 'S6-A does not remediate historical data. Resolve the listed notes / rows first and re-run.';
    end if;
end
$census$;

-- ---------------------------------------------------------------------------
-- 4. The column. Nullable and WITHOUT a default on purpose: a default would be
--    a semantic claim about rows nobody has counted yet. public.attachments is
--    already held at ACCESS EXCLUSIVE, so this is not a new acquisition and
--    cannot wait; integer without a default is catalog-only, no table rewrite.
-- ---------------------------------------------------------------------------
alter table public.attachments add column ordinal integer;

-- ---------------------------------------------------------------------------
-- 5. What the column means.
-- ---------------------------------------------------------------------------
comment on column public.attachments.ordinal is
    'W8-C S6-A: append sequence of this attachment within its note, 1-based and STRICTLY APPEND-ONLY. Backfilled from the certified legacy element position (nora_private.note_attachment_reference_rows); afterwards written exactly once, by nora_private.reconcile_note_attachments, as v_base + element_no where v_base is the highest ordinal the note still owns after the REMOVE phase. Never renumbered, never compacted: gaps are normal and a gap is not a defect. Unique per note together with the owner columns (uq__attachments__owner_ordinal). It is NOT the note JSON array position - the JSON stays the order master for the read path until S6-B1.';

-- ---------------------------------------------------------------------------
-- 6. Backfill: ordinal := the certified legacy element position. One grammar
--    (note_attachment_reference_rows), never a second parser, never physical
--    row order. The join is plain equality on storage_key (NOT NULL) and
--    `is not distinct from` on the two nullable owner columns.
-- ---------------------------------------------------------------------------
update public.attachments a
   set ordinal = l.element_no::integer
  from (
        select n.id as contact_note_id, null::bigint as deal_note_id, r.element_no, r.storage_key
          from public.contact_notes n
         cross join lateral nora_private.note_attachment_reference_rows(n.attachments) as r
         where coalesce(cardinality(n.attachments), 0) > 0
        union all
        select null::bigint, n.id, r.element_no, r.storage_key
          from public.deal_notes n
         cross join lateral nora_private.note_attachment_reference_rows(n.attachments) as r
         where coalesce(cardinality(n.attachments), 0) > 0
       ) as l
 where a.storage_key = l.storage_key
   and a.contact_note_id is not distinct from l.contact_note_id
   and a.deal_note_id is not distinct from l.deal_note_id;

-- ---------------------------------------------------------------------------
-- 7. Backstop: not one row may be left without an ordinal. The detectors are
--    3b / 3c; SET NOT NULL in step 10 is the third independent net.
-- ---------------------------------------------------------------------------
do $backfilled$
declare
    v_count  bigint;
    v_labels text;
begin
    select count(*), left(coalesce(string_agg('attachments:' || a.id::text, ', ' order by a.id), ''), 400)
      into v_count, v_labels
      from public.attachments a
     where a.ordinal is null;
    if v_count > 0 then
        raise exception 'W8-C S6-A: % attachment row(s) carry no ordinal after the backfill: %', v_count, v_labels
            using errcode = 'P0001', detail = 'NORA_S6A_ORDINAL_BACKFILL_INCOMPLETE';
    end if;
end
$backfilled$;

-- ---------------------------------------------------------------------------
-- 8. The reconcile core gains the append base. Everything else about it is
--    unchanged and must stay unchanged: one validator call, KEEP is never
--    written, REMOVE (DELETE) strictly before ADD (INSERT), ADD in
--    storage_key COLLATE "C" order, and never an UPDATE of the table.
--    create or replace (never drop + create) preserves the ACL.
-- ---------------------------------------------------------------------------
create or replace function nora_private.reconcile_note_attachments(
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
    v_base    integer;
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
    -- immutable (S1): no metadata UPDATE, and no silently diverging JSON. Its
    -- ordinal is never rewritten either (S6-A): KEEP is read, never written.
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

    -- S6-A: the append base is the highest ordinal this note still owns AFTER
    -- the REMOVE phase. It must be read HERE - between REMOVE and ADD - so a
    -- removed row cannot hold the sequence up while every surviving KEEP row
    -- keeps its ordinal. v_base + element_no (never element_no alone) is what
    -- makes an insert at the FRONT of an existing array legal: element_no is
    -- the position in the full desired array and KEEP rows are not renumbered,
    -- so the naive form collides with a kept row (23505).
    select coalesce(max(a.ordinal), 0)
      into v_base
      from public.attachments a
     where (a.contact_note_id = p_contact_note_id or a.deal_note_id = p_deal_note_id);

    -- ADD = D - E: plain INSERT, so S3A admission runs per row. Deterministic
    -- storage_key COLLATE "C" order: concurrent multi-key adds wait on the
    -- unique index in the same order instead of deadlocking. Gaps in the
    -- resulting sequence are accepted by contract - there is no compaction.
    if cardinality(v_keys) > 0 then
        insert into public.attachments (contact_note_id, deal_note_id, storage_key, file_name, mime_type, ordinal)
        select p_contact_note_id, p_deal_note_id, d.storage_key, d.file_name, d.mime_type, (v_base + d.element_no)::integer
          from unnest(v_keys, v_names, v_mimes) with ordinality as d(storage_key, file_name, mime_type, element_no)
         where not exists (select 1
                             from public.attachments a
                            where a.storage_key = d.storage_key
                              and (a.contact_note_id = p_contact_note_id or a.deal_note_id = p_deal_note_id))
         order by d.storage_key collate "C";
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. The core's comment: create or replace keeps the OLD comment, which no
--    longer describes the body.
-- ---------------------------------------------------------------------------
comment on function nora_private.reconcile_note_attachments(bigint, bigint, jsonb[]) is
    'W8-C S3B/S6-A: reconciles the public.attachments rows of ONE note (exactly one of contact_note_id / deal_note_id, else 22023 NORA_ATTACHMENT_INVALID_ARGUMENT) with its attachment array. D = grammar v1 rows (note_attachment_reference_rows), E = the rows the note owns now. KEEP (E n D) is never written and must keep title / type (else 22023 NORA_ATTACHMENT_REFERENCE_INVALID); REMOVE (E - D) is a plain DELETE (capture); ADD (D - E) a plain INSERT in storage_key COLLATE "C" order (admission), and since S6-A every added row gets ordinal = v_base + element_no, where v_base is the highest ordinal the note still owns after REMOVE. Ordinals are append-only: KEEP rows are never renumbered, nothing is compacted, gaps are normal. Never takes the key lock itself, never calls claim / inspect / fail / the resolver, no exception handler. VOLATILE (fresh snapshot per statement). Caller holds the note row; S4 reuses it under a note row lock. No API role may execute it.';

-- ---------------------------------------------------------------------------
-- 10. Now that every row carries one: the column becomes mandatory.
-- ---------------------------------------------------------------------------
alter table public.attachments alter column ordinal set not null;

-- ---------------------------------------------------------------------------
-- 11. One ordinal per note. NULLS NOT DISTINCT is REQUIRED, not stylistic:
--     exactly one owner column is non-NULL per row, so a plain UNIQUE over
--     (contact_note_id, deal_note_id, ordinal) would be vacuous - every row
--     carries a NULL and would compare distinct from every other row.
--     Table constraint, infix spelling, NOT DEFERRABLE.
-- ---------------------------------------------------------------------------
alter table public.attachments
    add constraint uq__attachments__owner_ordinal
    unique nulls not distinct (contact_note_id, deal_note_id, ordinal);

-- ---------------------------------------------------------------------------
-- 12. Postconditions (fail-closed).
-- ---------------------------------------------------------------------------
do $post$
declare
    r          record;
    v_failures text[] := '{}';
    v_cols     text;
    v_src      text;
    v_role     text;
    v_count    bigint;
    v_labels   text;
    v_ins_pos  integer;
    v_tail     text;
    c_constraintdef constant text := 'UNIQUE NULLS NOT DISTINCT (contact_note_id, deal_note_id, ordinal)';
begin
    -- 12a. nine columns, ordinal integer NOT NULL without a default
    select string_agg(a.attname, ',' order by a.attnum)
      into v_cols
      from pg_attribute a
     where a.attrelid = 'public.attachments'::regclass
       and a.attnum > 0 and not a.attisdropped;
    if v_cols is distinct from 'id,contact_note_id,deal_note_id,storage_key,file_name,mime_type,byte_size,created_at,ordinal' then
        v_failures := v_failures || format('public.attachments does not carry exactly the nine post-S6-A columns: %s', coalesce(v_cols, '<none>'));
    end if;
    if not exists (select 1 from pg_attribute a
                    where a.attrelid = 'public.attachments'::regclass
                      and a.attname = 'ordinal' and a.attnum > 0 and not a.attisdropped
                      and format_type(a.atttypid, a.atttypmod) = 'integer'
                      and a.attnotnull
                      and not a.atthasdef
                      and not a.atthasmissing) then
        v_failures := array_append(v_failures, 'public.attachments.ordinal is not integer NOT NULL without a default or missing value');
    end if;

    -- 12b. the constraint, character-exact and NOT DEFERRABLE
    select pg_get_constraintdef(c.oid) as def, c.condeferrable, c.condeferred, c.contype
      into r
      from pg_constraint c
     where c.conrelid = 'public.attachments'::regclass
       and c.conname = 'uq__attachments__owner_ordinal';
    if not found then
        v_failures := array_append(v_failures, 'constraint uq__attachments__owner_ordinal is missing');
    else
        if r.def is distinct from c_constraintdef then
            v_failures := v_failures || format('uq__attachments__owner_ordinal is %L, expected %L', r.def, c_constraintdef);
        end if;
        if r.contype <> 'u' or r.condeferrable or r.condeferred then
            v_failures := array_append(v_failures, 'uq__attachments__owner_ordinal is not a NOT DEFERRABLE unique table constraint');
        end if;
    end if;
    if not exists (select 1 from pg_constraint c
                    join pg_index i on i.indexrelid = c.conindid
                   where c.conrelid = 'public.attachments'::regclass
                     and c.conname = 'uq__attachments__owner_ordinal'
                     and i.indisunique and i.indimmediate and i.indnullsnotdistinct) then
        v_failures := array_append(v_failures, 'the backing index of uq__attachments__owner_ordinal is not a unique NULLS NOT DISTINCT index');
    end if;
    -- the S1 global key identity is untouched
    if not exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
                   where i.indrelid = 'public.attachments'::regclass and i.indisunique
                     and c.relname = 'uq__attachments__storage_key') then
        v_failures := array_append(v_failures, 'the S1 unique index uq__attachments__storage_key is gone');
    end if;

    -- 12c. no NULL ordinal, no duplicate ordinal within one note
    select count(*) into v_count from public.attachments a where a.ordinal is null;
    if v_count > 0 then
        v_failures := v_failures || format('%s row(s) carry a NULL ordinal', v_count);
    end if;
    select count(*), left(coalesce(string_agg(d.label, ', ' order by d.label), ''), 400)
      into v_count, v_labels
      from (select case when a.contact_note_id is not null then 'contact_notes:' || a.contact_note_id::text
                        else 'deal_notes:' || a.deal_note_id::text end as label
              from public.attachments a
             group by a.contact_note_id, a.deal_note_id, a.ordinal
            having count(*) > 1) as d;
    if v_count > 0 then
        v_failures := v_failures || format('%s note(s) carry a duplicate ordinal: %s', v_count, v_labels);
    end if;

    -- 12d. APPLY-TIME IDENTITY, not steady-state evidence: the backfill set
    --      ordinal := element_no, so ordering by (ordinal, id) and ordering by
    --      the legacy element position are the same permutation right now, by
    --      construction. A later legal reorder or front-insert makes them
    --      differ WITHOUT a defect - which is why the verifier class
    --      ORDINAL_VS_ARRAY_ORDER is INFO and never blocking.
    with legacy as (
        select n.id as contact_note_id, null::bigint as deal_note_id, r2.element_no, r2.storage_key
          from public.contact_notes n
         cross join lateral nora_private.note_attachment_reference_rows(n.attachments) as r2
         where coalesce(cardinality(n.attachments), 0) > 0
        union all
        select null::bigint, n.id, r2.element_no, r2.storage_key
          from public.deal_notes n
         cross join lateral nora_private.note_attachment_reference_rows(n.attachments) as r2
         where coalesce(cardinality(n.attachments), 0) > 0
    ),
    relational as (
        select a.contact_note_id, a.deal_note_id, a.storage_key,
               row_number() over (partition by a.contact_note_id, a.deal_note_id
                                      order by a.ordinal, a.id) as rel_no
          from public.attachments a
    ),
    paired as (
        select l.contact_note_id, l.deal_note_id, rel.rel_no,
               row_number() over (partition by l.contact_note_id, l.deal_note_id order by l.element_no) as leg_no
          from legacy l
          join relational rel
            on rel.storage_key = l.storage_key
           and rel.contact_note_id is not distinct from l.contact_note_id
           and rel.deal_note_id is not distinct from l.deal_note_id
    )
    select count(*), left(coalesce(string_agg(x.label, ', ' order by x.label), ''), 400)
      into v_count, v_labels
      from (select distinct case when p.contact_note_id is not null then 'contact_notes:' || p.contact_note_id::text
                                 else 'deal_notes:' || p.deal_note_id::text end as label
              from paired p
             where p.rel_no is distinct from p.leg_no) as x;
    if v_count > 0 then
        v_failures := v_failures || format('%s note(s) already diverge between ordinal order and legacy array order right after the backfill: %s', v_count, v_labels);
    end if;

    -- 12e. THE REPLACED BODY IS THE CERTIFIED ONE. Without this step a naive
    --      `ordinal := element_no` core applies GREEN here and breaks on a
    --      user's next note save; the standing S3B guard cannot see the
    --      difference, and it equally cannot see an un-replaced S3B body.
    select p.prosrc into v_src
      from pg_proc p
     where p.oid = to_regprocedure('nora_private.reconcile_note_attachments(bigint,bigint,jsonb[])');
    v_ins_pos := position('insert into public.attachments' in v_src);
    if (select count(*) from regexp_matches(v_src, 'select coalesce\(max\(a\.ordinal\), 0\)', 'g')) <> 1 then
        v_failures := array_append(v_failures, '12e the core does not read the append base exactly once (select coalesce(max(a.ordinal), 0))');
    elsif position('select coalesce(max(a.ordinal), 0)' in v_src) < position('delete from public.attachments' in v_src)
       or position('select coalesce(max(a.ordinal), 0)' in v_src) > v_ins_pos then
        v_failures := array_append(v_failures, '12e the append base is not read BETWEEN the REMOVE delete and the ADD insert');
    end if;
    if position('(v_base + d.element_no)::integer' in v_src) = 0 then
        v_failures := array_append(v_failures, '12e the ADD does not insert v_base + element_no - a naive element_no body is a user-reachable 23505');
    end if;
    if v_ins_pos = 0 or position('with ordinality' in substr(v_src, v_ins_pos)) = 0 then
        v_failures := array_append(v_failures, '12e the ADD does not unnest the desired set WITH ORDINALITY');
    end if;
    v_tail := substr(v_src, greatest(v_ins_pos, 1));
    if (select count(*) from regexp_matches(v_tail, 'order by', 'g')) <> 1
       or position('order by d.storage_key collate "C"' in v_tail) = 0 then
        v_failures := array_append(v_failures, '12e the ADD does not end in exactly one ORDER BY d.storage_key COLLATE "C"');
    end if;
    if v_src ~* 'update\s+public\.attachments' then
        v_failures := array_append(v_failures, '12e the core writes an UPDATE of public.attachments - ordinals are never rewritten');
    end if;

    -- 12f. the standing S3B core assertions still hold for the replaced body
    if (select count(*) from regexp_matches(v_src, 'nora_private\.note_attachment_reference_rows\(', 'g')) <> 1
       or (select count(*) from regexp_matches(v_src, 'delete from public\.attachments', 'g')) <> 1
       or (select count(*) from regexp_matches(v_src, 'insert into public\.attachments', 'g')) <> 1
       or position('delete from public.attachments' in v_src) > v_ins_pos
       or position('a.storage_key <> all (v_keys)' in v_src) = 0
       or position('where not exists' in v_src) = 0 then
        v_failures := array_append(v_failures, '12f the core is no longer validate -> KEEP check -> REMOVE (DELETE) -> ADD (INSERT) with one validator call');
    end if;
    if v_src ~* 'exception\s+when' then
        v_failures := array_append(v_failures, '12f the core contains an exception handler');
    end if;
    if not exists (select 1 from pg_proc p join pg_language l on l.oid = p.prolang
                     join pg_namespace n on n.oid = p.pronamespace
                    where p.oid = to_regprocedure('nora_private.reconcile_note_attachments(bigint,bigint,jsonb[])')
                      and n.nspname = 'nora_private'
                      and p.prorettype = 'void'::regtype
                      and not p.proretset
                      and l.lanname = 'plpgsql'
                      and p.provolatile = 'v'
                      and not p.prosecdef
                      and pg_get_userbyid(p.proowner) = 'postgres'
                      and p.proconfig = array['search_path=""', 'row_security=off']) then
        v_failures := array_append(v_failures, '12f the core lost VOLATILE / SECURITY INVOKER / search_path / row_security / owner');
    end if;

    -- 12g. and no API role gained anything: the ACL is byte-identical
    if (select coalesce(p.proacl::text, '<null>')
          from pg_proc p
         where p.oid = to_regprocedure('nora_private.reconcile_note_attachments(bigint,bigint,jsonb[])'))
       is distinct from current_setting('nora.s6a_core_acl', true) then
        v_failures := array_append(v_failures, '12g the ACL of the core changed');
    end if;
    foreach v_role in array array['public', 'anon', 'authenticated', 'service_role'] loop
        if has_function_privilege(v_role, 'nora_private.reconcile_note_attachments(bigint,bigint,jsonb[])', 'EXECUTE') then
            v_failures := v_failures || format('%s holds EXECUTE on the reconcile core', v_role);
        end if;
    end loop;
    if (select string_agg(pr, ',' order by pr)
          from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) pr
         where has_table_privilege('authenticated', 'public.attachments', pr)) is distinct from 'SELECT' then
        v_failures := array_append(v_failures, 'the privileges of authenticated on public.attachments changed');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'W8-C S6-A postconditions failed:\n%', array_to_string(v_failures, E'\n')
            using errcode = 'P0001', detail = 'NORA_S6A_POSTCONDITION_FAILED';
    end if;
end
$post$;
