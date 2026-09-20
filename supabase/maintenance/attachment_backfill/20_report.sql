-- STRICT READ-ONLY. Nora CRM — W8-C S4 attachment backfill · STEP 20: PROGRESS REPORT.
--
-- Operational visibility while the backfill runs, and afterwards. One SELECT.
-- It writes nothing, creates nothing, locks nothing, needs no session
-- prerequisite and no pg_temp helper, runs inside BEGIN TRANSACTION READ ONLY,
-- and is safe against Production at any moment.
--
-- It is NOT a second reconciliation and NOT a second classification: whether
-- note JSON and public.attachments actually AGREE is answered by
-- supabase/tests/attachment_backfill_consistency_verification.sql, and whether
-- the backfill may run at all by 00_preflight.sql. This file only counts.
--
-- Usage:
--   psql -v ON_ERROR_STOP=1 -f supabase/maintenance/attachment_backfill/20_report.sql
--   (Production: send it as one MCP execute_sql payload.)
--
-- Storage keys are never printed.
--
-- The key-level figures go through the ONE grammar
-- (nora_private.note_attachment_reference_rows), so a note outside grammar v1
-- makes this file raise 22023 NORA_ATTACHMENT_REFERENCE_INVALID instead of
-- quietly reporting a number derived from a second parser. That is itself the
-- signal to run the preflight, which names the note.

with note as (
    select 'contact_notes'::text as tbl, n.id, coalesce(cardinality(n.attachments), 0) as n_el, n.attachments
      from public.contact_notes n
    union all
    select 'deal_notes'::text, n.id, coalesce(cardinality(n.attachments), 0), n.attachments
      from public.deal_notes n
),
owned as (
    select case when a.contact_note_id is not null then 'contact_notes' else 'deal_notes' end as tbl,
           coalesce(a.contact_note_id, a.deal_note_id) as note_id
      from public.attachments a
),
note_state as (
    select note.tbl, note.id, note.n_el,
           (select count(*) from owned o where o.tbl = note.tbl and o.note_id = note.id) as n_rows
      from note
),
desired as (
    select note.tbl, note.id, r.storage_key
      from note
      cross join lateral nora_private.note_attachment_reference_rows(note.attachments) as r
     where note.n_el > 0
),
figure as (
    select 1 as ord, 'notes total'::text as metric, count(*)::text as value from note
    union all
    select 2, 'notes with attachments', count(*)::text from note where n_el > 0
    union all
    select 3, 'attachment elements (JSON)', coalesce(sum(n_el), 0)::text from note
    union all
    select 4, 'backfill candidates remaining (attachments, no row)', count(*)::text
      from note_state where n_el > 0 and n_rows = 0
    union all
    select 5, 'notes already projected (attachments, >= 1 row)', count(*)::text
      from note_state where n_el > 0 and n_rows > 0
    union all
    select 6, 'public.attachments rows', count(*)::text from public.attachments
    union all
    select 7, 'rows owned by a contact note', count(*)::text from public.attachments where contact_note_id is not null
    union all
    select 8, 'rows owned by a deal note', count(*)::text from public.attachments where deal_note_id is not null
    union all
    select 9, 'rows with byte_size set (S4 writes NULL)', count(*)::text from public.attachments where byte_size is not null
    union all
    select 10, 'oldest / newest attachment row (created_at = row creation time)',
           coalesce(min(created_at)::text, '-') || ' / ' || coalesce(max(created_at)::text, '-')
      from public.attachments
    union all
    select 11, 'deletion queue: ' || q.state, count(*)::text
      from nora_private.attachment_storage_deletion_queue q group by q.state
    union all
    select 12, 'deletion queue: total', count(*)::text from nora_private.attachment_storage_deletion_queue
    union all
    select 13, 'storage objects in bucket attachments', count(*)::text
      from storage.objects where bucket_id = 'attachments'
    union all
    select 14, 'desired references without a storage object (INFO)', count(*)::text
      from desired d
     where not exists (select 1 from storage.objects o
                        where o.bucket_id = 'attachments' and o.name = d.storage_key)
    union all
    select 15, 'consistency verdict',
           'run attachment_backfill_consistency_verification.sql — this file only counts'
)
select figure.metric, figure.value
  from figure
 order by figure.ord, figure.metric;
