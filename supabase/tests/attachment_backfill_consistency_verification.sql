-- Nora W8-C S4 — GLOBAL attachment consistency verifier.
-- CLASSIFICATION: SESSION-LOCAL VERIFICATION SETUP — NO DURABLE OR
-- BUSINESS-DATA MUTATION. It is deliberately NOT called "read-only": see below.
--
-- THE canonical statement of "note JSON and public.attachments agree", used by
-- three different callers and implemented exactly once:
--   * supabase/maintenance/attachment_backfill/00_preflight.sql   (GO / STOP)
--   * supabase/tests/attachment_backfill_verification.sql         (drift matrix)
--   * the S5 read-switch gate                                     (GREEN rule)
--
-- WHAT IT DOES AND DOES NOT DO TO THE DATABASE
--   durable or business-data mutation        NO  - no row, no table, no grant,
--                                                  nothing that survives the
--                                                  connection
--   lock                                     NO
--   calls anything that mutates              NO
--   prints a storage key                     NO  - evidence is a `<table>:<id>`
--                                                  label or a surface name
--   creates a session-local pg_temp function YES - the one thing it creates
--   requires TEMP privilege on the database  YES
--   STRICT SQL READ-ONLY                     NO  - CREATE FUNCTION is DDL
--   runs in BEGIN TRANSACTION READ ONLY      NO  - PostgreSQL refuses it there
--                                                  ("cannot execute CREATE
--                                                  FUNCTION in a read-only
--                                                  transaction")
--   survives disconnect                      NO  - pg_temp dies with the session
--
-- It is safe to run against Production at any moment: "no durable or
-- business-data mutation" is the property that makes it safe, and that is a
-- DIFFERENT property from "strict SQL read-only". Do not declare a READ ONLY
-- transaction around it - declare one around 00_preflight.sql or 20_report.sql,
-- which are STRICT READ-ONLY.
--
-- WHY A pg_temp FUNCTION AND NOT PURE SQL
--   nora_private.note_attachment_reference_rows RAISES on an array outside
--   grammar v1. Classifying such a note instead of aborting the whole query
--   needs per-note `begin ... exception when others ... continue` isolation,
--   which pure SELECT / CTE SQL cannot express. The only pure-SQL alternative
--   would be a SECOND grammar parser - exactly what this slice exists to
--   avoid. The temp function is the minimum vehicle, not a convenience.
--
-- Usage - LOCAL (psql; the file is self-contained):
--   docker exec -i supabase_db_atomic-crm-demo psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/attachment_backfill_consistency_verification.sql
--
-- Usage - PRODUCTION: send this file as ONE MCP execute_sql payload, or run it
--   with psql -v ON_ERROR_STOP=1. The pg_temp definition and the two SELECTs
--   must reach the SAME session - one payload is what guarantees that.
--
-- IT DOES NOT RAISE. A verifier that aborts cannot report the class that made
-- it abort, and the backfill preflight has to read a RED corpus to decide what
-- to do about it. The verdict is a row, and the GREEN rule is data:
--   `blocking = true` classes are the S5 gate; all fourteen must be 0.
--   STORAGE_OBJECT_MISSING is INFO: reference consistency and physical object
--   existence are separate contracts (S4 decision E), so a missing object is
--   reported and never turns the verdict RED.
--   ORDINAL_VS_ARRAY_ORDER is INFO too, and for a sharper reason: an append
--   sequence and an array order are allowed to diverge on a legal, zero-write
--   action (S6-A / contract 344). It retires at S6-B1.
--
-- CLASSES (14 blocking + 2 INFO)
--   INVALID_GRAMMAR             note array outside grammar v1
--   JSON_KEY_WITHOUT_ROW        PARTIAL: a projected note misses one key's row
--   ROW_WITHOUT_JSON_KEY        EXTRA: a row nobody's JSON asks for
--   METADATA_MISMATCH           same (note, key), different file_name / mime_type
--   DUPLICATE_KEY_IN_NOTE       the same path twice in one note
--   DUPLICATE_KEY_ACROSS_NOTES  the same path in two notes
--   WRONG_OWNER                 the key is desired by note X, the row belongs to Y
--   ROW_FOR_EMPTY_NOTE          rows under a note whose array is NULL / empty
--   QUEUE_CONFLICT              a referenced key carries an active or done intent
--   BYTE_SIZE_NOT_NULL          a row carries a fabricated size (S4 writes NULL)
--   CROSS_SOURCE_KEY            a note key is also a logo / avatar / branding key
--   BACKFILL_CANDIDATE_REMAINING  a note with attachments owns no row at all
--   ORDINAL_NULL                a row without an append position (S6-A)
--   ORDINAL_DUPLICATE_PER_NOTE  two rows of one note share an ordinal (S6-A)
--   STORAGE_OBJECT_MISSING      INFO: no object in the bucket for a desired key
--   ORDINAL_VS_ARRAY_ORDER      INFO: the relational order of a note's rows is
--                               no longer its legacy array order (S6-A; legal
--                               after a front-insert or a pure reorder)
--
-- ALL SIXTEEN ARE ALWAYS RETURNED, one row each, zero-count or not: the census
-- is a fixed shape, not a list of what happens to be wrong. 00_preflight.sql
-- ASSERTS that shape (name, uniqueness and blocking flag) before it counts
-- anything, because a short census reads downstream exactly like a clean
-- corpus. Adding, renaming or removing a class here therefore means updating
-- the contract in 00_preflight.sql in the same change.
--
-- The classes are OBSERVATIONS with deliberately disjoint row / key scopes, not
-- a partition of every conceivable defect: a note whose grammar is broken is
-- reported once (INVALID_GRAMMAR) and its rows are left unclassified rather than
-- double-counted, and BACKFILL_CANDIDATE_REMAINING overlaps nothing because
-- JSON_KEY_WITHOUT_ROW is restricted to notes that already own a row.
--
-- BEFORE and AFTER the S4 backfill:
--   before  BACKFILL_CANDIDATE_REMAINING > 0, everything else 0  -> work to do
--   after   every blocking class 0                               -> GREEN, S5 gate open
-- The preflight's GO rule is therefore NOT the GREEN rule: it exempts exactly
-- BACKFILL_CANDIDATE_REMAINING (see 00_preflight.sql).
--
-- `path` is extracted raw ONLY to find duplicates (in one note, across notes) -
-- the same census the S3B migration does. The DESIRED SET always comes from
-- nora_private.note_attachment_reference_rows(); this file re-implements
-- neither grammar v1 nor the reconcile algorithm.

create or replace function pg_temp.attachment_backfill_findings()
returns table (problem_class text, blocking boolean, finding_count bigint, evidence text)
language plpgsql
stable
security invoker
set search_path = ''
set row_security = off
as $fn$
declare
    r             record;
    v_k           text[];
    v_n           text[];
    v_m           text[];
    -- notes reported once and then left out of the row-side classes
    v_dup_note    text[] := '{}';
    v_invalid     text[] := '{}';
    -- the validated desired set D, as parallel arrays
    v_tbl         text[] := '{}';
    v_note        bigint[] := '{}';
    v_key         text[] := '{}';
    v_name        text[] := '{}';
    v_mime        text[] := '{}';
    -- S6-A: the three ordinal classes are the only ones that depend on a
    -- column the database may not carry yet. The gate that decides whether
    -- S6-A may be applied runs this same file against a database where
    -- `ordinal` does not exist, so the classes report 0 with an explicit
    -- evidence text there instead of aborting the whole census.
    v_has_ordinal boolean := exists (select 1 from pg_attribute a
                                      where a.attrelid = 'public.attachments'::regclass
                                        and a.attname = 'ordinal'
                                        and a.attnum > 0 and not a.attisdropped);
    c_pre_s6a     constant text := 'not applicable: public.attachments carries no ordinal column yet (pre-S6-A)';
begin
    -- ---- D: grammar v1 over every note that carries attachments --------------
    for r in
        select 'contact_notes'::text as tbl, n.id, n.attachments from public.contact_notes n
         where coalesce(cardinality(n.attachments), 0) > 0
        union all
        select 'deal_notes'::text, n.id, n.attachments from public.deal_notes n
         where coalesce(cardinality(n.attachments), 0) > 0
        order by 1, 2
    loop
        -- the same path twice is its own class: check it BEFORE the validator,
        -- which would reject the note and hide the reason behind INVALID_GRAMMAR
        if exists (select 1
                     from unnest(r.attachments) as e(item)
                    where jsonb_typeof(e.item) = 'object'
                      and e.item ->> 'path' is not null
                    group by e.item ->> 'path'
                   having count(*) > 1) then
            v_dup_note := v_dup_note || (r.tbl || ':' || r.id::text);
            continue;
        end if;

        begin
            select coalesce(array_agg(x.storage_key order by x.element_no), '{}'),
                   coalesce(array_agg(x.file_name   order by x.element_no), '{}'),
                   coalesce(array_agg(x.mime_type   order by x.element_no), '{}')
              into v_k, v_n, v_m
              from nora_private.note_attachment_reference_rows(r.attachments) as x;
        exception when others then
            v_invalid := v_invalid || (r.tbl || ':' || r.id::text);
            continue;
        end;

        v_tbl  := v_tbl  || array_fill(r.tbl, array[cardinality(v_k)]);
        v_note := v_note || array_fill(r.id,  array[cardinality(v_k)]);
        v_key  := v_key  || v_k;
        v_name := v_name || v_n;
        v_mime := v_mime || v_m;
    end loop;

    -- ---- 1. INVALID_GRAMMAR --------------------------------------------------
    return query
    select 'INVALID_GRAMMAR'::text, true, cardinality(v_invalid)::bigint,
           left(coalesce(array_to_string(v_invalid, ', '), ''), 400);

    -- ---- 2. DUPLICATE_KEY_IN_NOTE -------------------------------------------
    return query
    select 'DUPLICATE_KEY_IN_NOTE'::text, true, cardinality(v_dup_note)::bigint,
           left(coalesce(array_to_string(v_dup_note, ', '), ''), 400);

    -- ---- 3. DUPLICATE_KEY_ACROSS_NOTES --------------------------------------
    -- raw `path` over EVERY note (an invalid note can still collide)
    return query
    with raw as (
        select 'contact_notes'::text as tbl, n.id, e.item ->> 'path' as k
          from public.contact_notes n cross join lateral unnest(n.attachments) as e(item)
         where jsonb_typeof(e.item) = 'object'
        union all
        select 'deal_notes'::text, n.id, e.item ->> 'path'
          from public.deal_notes n cross join lateral unnest(n.attachments) as e(item)
         where jsonb_typeof(e.item) = 'object'
    ),
    shared as (
        select string_agg(distinct raw.tbl || ':' || raw.id::text, ', ' order by raw.tbl || ':' || raw.id::text) as notes
          from raw
         where raw.k is not null
         group by raw.k
        having count(distinct raw.tbl || ':' || raw.id::text) > 1
    )
    select 'DUPLICATE_KEY_ACROSS_NOTES'::text, true, count(*)::bigint,
           left(coalesce(string_agg(shared.notes, ' | ' order by shared.notes), ''), 400)
      from shared;

    -- ---- 4. JSON_KEY_WITHOUT_ROW (PARTIAL) ----------------------------------
    -- a desired key with no row ANYWHERE, on a note that already owns a row.
    -- A note that owns NO row is a backfill candidate (class 12), not PARTIAL.
    return query
    with d as (
        select * from unnest(v_tbl, v_note, v_key) as t(tbl, note_id, storage_key)
    ),
    owned as (
        select case when a.contact_note_id is not null then 'contact_notes' else 'deal_notes' end as tbl,
               coalesce(a.contact_note_id, a.deal_note_id) as note_id
          from public.attachments a
    ),
    miss as (
        select distinct d.tbl || ':' || d.note_id::text as label
          from d
         where not exists (select 1 from public.attachments a where a.storage_key = d.storage_key)
           and exists (select 1 from owned o where o.tbl = d.tbl and o.note_id = d.note_id)
    )
    select 'JSON_KEY_WITHOUT_ROW'::text, true, count(*)::bigint,
           left(coalesce(string_agg(miss.label, ', ' order by miss.label), ''), 400)
      from miss;

    -- ---- 5. ROW_WITHOUT_JSON_KEY (EXTRA) ------------------------------------
    -- a row whose key no note desires, under a note whose array is non-empty
    -- and classifiable (a note counted in 1 or 2 contributes no desired key, so
    -- its rows are deliberately left out instead of double-reported).
    return query
    with owner_note as (
        select a.id,
               case when a.contact_note_id is not null then 'contact_notes' else 'deal_notes' end as tbl,
               coalesce(a.contact_note_id, a.deal_note_id) as note_id,
               a.storage_key
          from public.attachments a
    ),
    note_arr as (
        select 'contact_notes'::text as tbl, n.id, coalesce(cardinality(n.attachments), 0) as n_el
          from public.contact_notes n
        union all
        select 'deal_notes'::text, n.id, coalesce(cardinality(n.attachments), 0)
          from public.deal_notes n
    ),
    extra as (
        select 'attachments:' || o.id::text as label
          from owner_note o
          join note_arr na on na.tbl = o.tbl and na.id = o.note_id
         where na.n_el > 0
           and not (o.tbl || ':' || o.note_id::text) = any (v_invalid || v_dup_note)
           and o.storage_key <> all (coalesce(v_key, '{}'))
    )
    select 'ROW_WITHOUT_JSON_KEY'::text, true, count(*)::bigint,
           left(coalesce(string_agg(extra.label, ', ' order by extra.label), ''), 400)
      from extra;

    -- ---- 6. WRONG_OWNER ------------------------------------------------------
    -- the key IS desired - by a different note than the one that owns the row
    return query
    with d as (
        select * from unnest(v_tbl, v_note, v_key) as t(tbl, note_id, storage_key)
    ),
    owner_note as (
        select a.id,
               case when a.contact_note_id is not null then 'contact_notes' else 'deal_notes' end as tbl,
               coalesce(a.contact_note_id, a.deal_note_id) as note_id,
               a.storage_key
          from public.attachments a
    ),
    wrong as (
        select distinct 'attachments:' || o.id::text as label
          from owner_note o
          join d on d.storage_key = o.storage_key
         where d.tbl is distinct from o.tbl or d.note_id is distinct from o.note_id
    )
    select 'WRONG_OWNER'::text, true, count(*)::bigint,
           left(coalesce(string_agg(wrong.label, ', ' order by wrong.label), ''), 400)
      from wrong;

    -- ---- 7. METADATA_MISMATCH -----------------------------------------------
    return query
    with d as (
        select * from unnest(v_tbl, v_note, v_key, v_name, v_mime)
                      as t(tbl, note_id, storage_key, file_name, mime_type)
    ),
    owner_note as (
        select a.id,
               case when a.contact_note_id is not null then 'contact_notes' else 'deal_notes' end as tbl,
               coalesce(a.contact_note_id, a.deal_note_id) as note_id,
               a.storage_key, a.file_name, a.mime_type
          from public.attachments a
    ),
    mism as (
        select 'attachments:' || o.id::text as label
          from owner_note o
          join d on d.storage_key = o.storage_key and d.tbl = o.tbl and d.note_id = o.note_id
         where o.file_name is distinct from d.file_name
            or o.mime_type is distinct from d.mime_type
    )
    select 'METADATA_MISMATCH'::text, true, count(*)::bigint,
           left(coalesce(string_agg(mism.label, ', ' order by mism.label), ''), 400)
      from mism;

    -- ---- 8. ROW_FOR_EMPTY_NOTE ----------------------------------------------
    return query
    with owner_note as (
        select a.id,
               case when a.contact_note_id is not null then 'contact_notes' else 'deal_notes' end as tbl,
               coalesce(a.contact_note_id, a.deal_note_id) as note_id
          from public.attachments a
    ),
    note_arr as (
        select 'contact_notes'::text as tbl, n.id, coalesce(cardinality(n.attachments), 0) as n_el
          from public.contact_notes n
        union all
        select 'deal_notes'::text, n.id, coalesce(cardinality(n.attachments), 0)
          from public.deal_notes n
    ),
    orphan as (
        select 'attachments:' || o.id::text as label
          from owner_note o
          join note_arr na on na.tbl = o.tbl and na.id = o.note_id
         where na.n_el = 0
    )
    select 'ROW_FOR_EMPTY_NOTE'::text, true, count(*)::bigint,
           left(coalesce(string_agg(orphan.label, ', ' order by orphan.label), ''), 400)
      from orphan;

    -- ---- 9. QUEUE_CONFLICT ---------------------------------------------------
    -- a key that is still referenced (desired by a note, or carried by a row)
    -- must not hold an active or done deletion intent (invariant I1 + the S3A
    -- admission a later re-insert would hit).
    return query
    with k as (
        select distinct s.storage_key
          from (select unnest(coalesce(v_key, '{}')) as storage_key
                union
                select a.storage_key from public.attachments a) as s
         where s.storage_key is not null
    ),
    conflict as (
        select 'queue:' || q.id::text as label
          from nora_private.attachment_storage_deletion_queue q
          join k on k.storage_key = q.storage_key
         where q.state in ('pending', 'claimed', 'failed_retryable', 'done')
    )
    select 'QUEUE_CONFLICT'::text, true, count(*)::bigint,
           left(coalesce(string_agg(conflict.label, ', ' order by conflict.label), ''), 400)
      from conflict;

    -- ---- 10. BYTE_SIZE_NOT_NULL ---------------------------------------------
    return query
    with sized as (
        select 'attachments:' || a.id::text as label
          from public.attachments a
         where a.byte_size is not null
    )
    select 'BYTE_SIZE_NOT_NULL'::text, true, count(*)::bigint,
           left(coalesce(string_agg(sized.label, ', ' order by sized.label), ''), 400)
      from sized;

    -- ---- 11. CROSS_SOURCE_KEY -----------------------------------------------
    -- A note key that a NON-note registered reference surface also names. The
    -- surfaces are the S2A2.1 registry minus its two note branches, and they are
    -- classified with the SAME private helpers the resolver uses - no second
    -- parser. Evidence is the surface name, never a key.
    return query
    with k as (
        select distinct s.storage_key
          from (select unnest(coalesce(v_key, '{}')) as storage_key
                union
                select a.storage_key from public.attachments a) as s
         where s.storage_key is not null
    ),
    hit as (
        select 'companies.logo'::text as surface
          from k where exists (select 1 from public.companies c
                                where nora_private.attachment_file_value_liveness(c.logo, k.storage_key) = 'live')
        union all
        select 'contacts.avatar'
          from k where exists (select 1 from public.contacts c
                                where nora_private.attachment_file_value_liveness(c.avatar, k.storage_key) = 'live')
        union all
        select 'sales.avatar'
          from k where exists (select 1 from public.sales sa
                                where nora_private.attachment_file_value_liveness(sa.avatar, k.storage_key) = 'live')
        union all
        select 'configuration.lightModeLogo/darkModeLogo'
          from k where exists (
              select 1 from public.configuration cf
              cross join lateral (values (cf.config -> 'lightModeLogo'), (cf.config -> 'darkModeLogo')) as b(item)
               where case
                       when jsonb_typeof(cf.config) is distinct from 'object' then 'unknown'
                       when b.item is null or jsonb_typeof(b.item) = 'null' then 'none'
                       when jsonb_typeof(b.item) = 'string'
                           then nora_private.attachment_url_liveness(b.item #>> '{}', k.storage_key)
                       when jsonb_typeof(b.item) = 'object'
                           then nora_private.attachment_file_value_liveness(b.item, k.storage_key)
                       else 'unknown'
                     end = 'live')
        union all
        -- S2A2.1 residual tripwire: storage-looking residue left in config after
        -- the two registered branding keys, or the candidate key itself
        select 'configuration residual'
          from k where exists (
              select 1 from public.configuration cf
               where jsonb_typeof(cf.config) is distinct from 'object'
                  or lower((cf.config - 'lightModeLogo' - 'darkModeLogo')::text) ~ 'storage(/|%2f)+v1'
                  or lower((cf.config - 'lightModeLogo' - 'darkModeLogo')::text) ~ 'attachments(/|%2f)'
                  or (position('attachments' in lower((cf.config - 'lightModeLogo' - 'darkModeLogo')::text)) > 0
                      and lower((cf.config - 'lightModeLogo' - 'darkModeLogo')::text) ~ '(/|%2f)object(/|%2f)')
                  or position(substr(to_jsonb(k.storage_key)::text, 2,
                                     char_length(to_jsonb(k.storage_key)::text) - 2)
                              in (cf.config - 'lightModeLogo' - 'darkModeLogo')::text) > 0)
    )
    select 'CROSS_SOURCE_KEY'::text, true, count(*)::bigint,
           left(coalesce(string_agg(distinct hit.surface, ', '), ''), 400)
      from hit;

    -- ---- 12. BACKFILL_CANDIDATE_REMAINING -----------------------------------
    return query
    with d as (
        select distinct t.tbl, t.note_id from unnest(v_tbl, v_note) as t(tbl, note_id)
    ),
    owned as (
        select distinct case when a.contact_note_id is not null then 'contact_notes' else 'deal_notes' end as tbl,
               coalesce(a.contact_note_id, a.deal_note_id) as note_id
          from public.attachments a
    ),
    cand as (
        select d.tbl || ':' || d.note_id::text as label
          from d
         where not exists (select 1 from owned o where o.tbl = d.tbl and o.note_id = d.note_id)
    )
    select 'BACKFILL_CANDIDATE_REMAINING'::text, true, count(*)::bigint,
           left(coalesce(string_agg(cand.label, ', ' order by cand.label), ''), 400)
      from cand;

    -- ---- 13. STORAGE_OBJECT_MISSING (INFO) ----------------------------------
    -- Reference consistency and physical object existence are separate
    -- contracts (S4 decision E): reported, never blocking, never repaired, and
    -- Storage is only READ here.
    return query
    with d as (
        select distinct t.tbl, t.note_id, t.storage_key
          from unnest(v_tbl, v_note, v_key) as t(tbl, note_id, storage_key)
    ),
    missing as (
        -- counted per REFERENCE (one note may miss several objects); the
        -- evidence stays note labels, because keys are never printed
        select d.tbl || ':' || d.note_id::text as label
          from d
         where not exists (select 1 from storage.objects o
                            where o.bucket_id = 'attachments' and o.name = d.storage_key)
    )
    select 'STORAGE_OBJECT_MISSING'::text, false, count(*)::bigint,
           left(coalesce((select string_agg(distinct missing.label, ', ') from missing), ''), 400)
      from missing;

    -- ---- 14. ORDINAL_NULL (S6-A) --------------------------------------------
    -- A row without an append position. Unreachable while the column is NOT
    -- NULL, which is exactly why it is worth asserting: it is the class that
    -- goes non-zero if that guarantee is ever relaxed or a write bypasses the
    -- reconcile core.
    if v_has_ordinal then
        return query
        with bad as (
            select 'attachments:' || a.id::text as label
              from public.attachments a
             where a.ordinal is null
        )
        select 'ORDINAL_NULL'::text, true, count(*)::bigint,
               left(coalesce(string_agg(bad.label, ', ' order by bad.label), ''), 400)
          from bad;
    else
        return query select 'ORDINAL_NULL'::text, true, 0::bigint, c_pre_s6a;
    end if;

    -- ---- 15. ORDINAL_DUPLICATE_PER_NOTE (S6-A) ------------------------------
    -- Two rows of ONE note claiming the same append position. Counted per
    -- note, not per row: one note with a collision is one finding.
    if v_has_ordinal then
        return query
        with dup as (
            select case when a.contact_note_id is not null
                        then 'contact_notes:' || a.contact_note_id::text
                        else 'deal_notes:' || a.deal_note_id::text end as label
              from public.attachments a
             group by a.contact_note_id, a.deal_note_id, a.ordinal
            having count(*) > 1
        )
        select 'ORDINAL_DUPLICATE_PER_NOTE'::text, true, count(*)::bigint,
               left(coalesce(string_agg(distinct dup.label, ', '), ''), 400)
          from dup;
    else
        return query select 'ORDINAL_DUPLICATE_PER_NOTE'::text, true, 0::bigint, c_pre_s6a;
    end if;

    -- ---- 16. ORDINAL_VS_ARRAY_ORDER (S6-A, INFO) ----------------------------
    -- NOT BLOCKING, and that is a contract decision, not an oversight. The
    -- ordinal is an APPEND sequence, the legacy array is an ORDER. Two legal,
    -- defect-free actions make them diverge: the deliberate insert-at-front
    -- (contract 9) and a pure reorder, which writes NOTHING at all (REMOVE and
    -- ADD are both empty, so no row is touched and no ordinal changes). A
    -- blocking class here would turn a zero-write action RED and would make
    -- S6-B1's own exit gate - "verifier GREEN including the ordinal classes" -
    -- unsatisfiable. Membership defects are caught by ORDINAL_NULL,
    -- ORDINAL_DUPLICATE_PER_NOTE, the unique constraint and the nine standing
    -- membership classes; this class observes the TRANSITION and retires at B1.
    --
    -- It is driven from the legacy side (D), like every other class here, and
    -- compares the two orders over the keys a note actually owns relationally:
    -- a note that owns no row at all is BACKFILL_CANDIDATE_REMAINING and a key
    -- without a row is JSON_KEY_WITHOUT_ROW - neither is an ORDER observation.
    if v_has_ordinal then
        return query
        with d as (
            select t.tbl, t.note_id, t.storage_key, t.ord as element_pos
              from unnest(v_tbl, v_note, v_key) with ordinality as t(tbl, note_id, storage_key, ord)
        ),
        owned as (
            select case when a.contact_note_id is not null then 'contact_notes' else 'deal_notes' end as tbl,
                   coalesce(a.contact_note_id, a.deal_note_id) as note_id,
                   a.storage_key, a.ordinal, a.id
              from public.attachments a
        ),
        paired as (
            select d.tbl, d.note_id,
                   row_number() over (partition by d.tbl, d.note_id order by d.element_pos) as legacy_no,
                   row_number() over (partition by d.tbl, d.note_id order by o.ordinal, o.id) as relational_no
              from d
              join owned o
                on o.tbl = d.tbl and o.note_id = d.note_id and o.storage_key = d.storage_key
        ),
        diverged as (
            select distinct paired.tbl || ':' || paired.note_id::text as label
              from paired
             where paired.legacy_no is distinct from paired.relational_no
        )
        select 'ORDINAL_VS_ARRAY_ORDER'::text, false, count(*)::bigint,
               left(coalesce(string_agg(diverged.label, ', ' order by diverged.label), ''), 400)
          from diverged;
    else
        return query select 'ORDINAL_VS_ARRAY_ORDER'::text, false, 0::bigint, c_pre_s6a;
    end if;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- The findings, then the verdict. Both are plain SELECTs.
-- ---------------------------------------------------------------------------
select f.problem_class,
       case when f.blocking then 'BLOCKING' else 'INFO' end as severity,
       f.finding_count,
       f.evidence
  from pg_temp.attachment_backfill_findings() f
 order by f.blocking desc, f.problem_class;

select 'VERDICT'::text as problem_class,
       case when count(*) filter (where f.blocking and f.finding_count > 0) = 0
            then 'GREEN' else 'RED' end as severity,
       count(*) filter (where f.blocking and f.finding_count > 0) as finding_count,
       left(coalesce(string_agg(f.problem_class, ', ' order by f.problem_class)
                     filter (where f.blocking and f.finding_count > 0), ''), 400) as evidence
  from pg_temp.attachment_backfill_findings() f;
