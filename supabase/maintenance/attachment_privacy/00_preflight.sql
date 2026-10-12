-- W8-E Stage C PREFLIGHT — STRICT READ-ONLY. Writes nothing, ever.
--
-- Answers one question: may the `attachments` bucket be made private right
-- now? The flip itself is NOT SQL: it is `10_set_attachments_privacy.mjs`
-- through the Storage API (the only path that purges the CDN). This file is
-- the database half of the gate, run IMMEDIATELY before that script; the
-- script re-checks what it can observe through the Storage API itself.
--
-- It CANNOT observe the deployed frontend. Stage B (the W8-E runtime is live)
-- and B.5 (client convergence) are confirmed by the operator, not by this
-- file — the verdict row says so rather than implying it checked.
--
-- STRICTLY READ-ONLY BY CONSTRUCTION: the whole file is ONE `select`
-- statement over catalogs and three tables. No DML, no DDL, no temp object,
-- no user-defined function call, no transaction control. Safe against
-- Production at any moment.
--
-- ONE STATEMENT, VERDICT LAST (Alpha Storage 3C F-6 / F-40). A runner that
-- shows only the last result of a call (Supabase MCP `execute_sql`) and
-- psql (`-v ON_ERROR_STOP=1 -f`) show the same rows. The final row is
-- `99 | == VERDICT == | GO` or `… | STOP`, and `observed` names the failed
-- gates. Anything else — no verdict row, an error — is STOP.
--
-- POLICY DEFINITIONS, NOT NAMES (Alpha Storage 3C F-3). A same-named policy
-- with widened roles or a weakened predicate is drift and STOPs. Expected
-- definitions are the canonical migrations (W8-B 20260915120000, W8-E
-- 20260928120000) in PostgreSQL's own normalized form (`pg_policies.qual` /
-- `with_check` are `pg_get_expr` output), so whitespace in the migration text
-- is irrelevant. The fingerprint block is kept identical to
-- `30_verify_attachments_private.sql`; the privacy verifier asserts that.
--
-- A FAILED GATE IS NEVER "FIXED" HERE. An unknown policy is not dropped to get
-- past the gate: permissive policies are OR-combined, and removing a foreign
-- one can break another surface. It goes to a Product Owner decision
-- (docs/nora/21 Section 17).

with expected_policy (policyname, fingerprint) as (
    values
        ('attachments_insert_writer',
         'PERMISSIVE|{authenticated}|INSERT|-|((bucket_id = ''attachments''::text) AND nora_private.can_write())'),
        ('attachments_select_active_user',
         'PERMISSIVE|{authenticated}|SELECT|((bucket_id = ''attachments''::text) AND nora_private.is_active_user())|-'),
        ('branding_insert_writer',
         'PERMISSIVE|{authenticated}|INSERT|-|((bucket_id = ''branding''::text) AND nora_private.can_write())'),
        ('branding_select_active_user',
         'PERMISSIVE|{authenticated}|SELECT|((bucket_id = ''branding''::text) AND nora_private.is_active_user())|-')
),
actual_policy as (
    select p.policyname,
           concat_ws('|', p.permissive, p.roles::text, p.cmd,
                     coalesce(p.qual, '-'), coalesce(p.with_check, '-')) as fingerprint
      from pg_policies p
     where p.schemaname = 'storage' and p.tablename = 'objects'
),
policy_check as (
    select e.policyname,
           a.fingerprint is not distinct from e.fingerprint as ok,
           coalesce(a.fingerprint, 'MISSING') as actual
      from expected_policy e
      left join actual_policy a using (policyname)
),
bucket as (
    select b.id, b.public, b.file_size_limit, b.allowed_mime_types
      from storage.buckets b
     where b.id in ('attachments', 'branding')
),
branding_ref as (
    select r.v
      from (
          select c.config ->> 'lightModeLogo' as v from public.configuration c
          union all select c.config ->> 'darkModeLogo' from public.configuration c
          union all select co.logo ->> 'src' from public.companies co where co.logo is not null
      ) r
     where r.v ~ '^https?://[^/?#[:space:]]+/storage/v1/object/public/attachments/'
),
gates (seq, gate, ok, observed) as (
    select 1, 'attachments bucket exists and is still PUBLIC (flip not done yet)',
           coalesce((select public from bucket where id = 'attachments'), false),
           coalesce((select public::text from bucket where id = 'attachments'), 'missing')
    union all
    select 2, 'attachments controls = W8-B contract (50 MiB, 9 MIME types)',
           coalesce((select file_size_limit = 52428800
                        and cardinality(allowed_mime_types) = 9
                        and allowed_mime_types @> array[
                            'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf',
                            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                            'text/plain', 'text/csv']
                       from bucket where id = 'attachments'), false),
           coalesce((select file_size_limit::text || ' ' || coalesce(allowed_mime_types::text, 'NULL')
                       from bucket where id = 'attachments'), 'missing')
    union all
    select 3, 'branding bucket exists and is PUBLIC',
           coalesce((select public from bucket where id = 'branding'), false),
           coalesce((select public::text from bucket where id = 'branding'), 'missing')
    union all
    select 4, 'branding controls = W8-E contract (5 MiB, 4 raster types)',
           coalesce((select file_size_limit = 5242880
                        and cardinality(allowed_mime_types) = 4
                        and allowed_mime_types @> array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
                       from bucket where id = 'branding'), false),
           coalesce((select file_size_limit::text || ' ' || coalesce(allowed_mime_types::text, 'NULL')
                       from bucket where id = 'branding'), 'missing')
    union all
    select 5, 'row level security is enabled on storage.objects',
           coalesce((select c.relrowsecurity from pg_class c where c.oid = 'storage.objects'::regclass), false),
           coalesce((select c.relrowsecurity::text from pg_class c where c.oid = 'storage.objects'::regclass), 'missing')
    union all
    select 6, 'W8-B attachments policies match their canonical DEFINITIONS (2)',
           (select bool_and(ok) from policy_check where policyname like 'attachments\_%'),
           coalesce((select string_agg(policyname || ' = ' || actual, '; ' order by policyname)
                       from policy_check where policyname like 'attachments\_%' and not ok), 'exact')
    union all
    select 7, 'W8-E branding policies match their canonical DEFINITIONS (2)',
           (select bool_and(ok) from policy_check where policyname like 'branding\_%'),
           coalesce((select string_agg(policyname || ' = ' || actual, '; ' order by policyname)
                       from policy_check where policyname like 'branding\_%' and not ok), 'exact')
    union all
    select 8, 'no unknown policy on storage.objects',
           not exists (select 1 from actual_policy a
                        where a.policyname not in (select policyname from expected_policy)),
           coalesce((select string_agg(a.policyname || ' = ' || a.fingerprint, '; ' order by a.policyname)
                       from actual_policy a
                      where a.policyname not in (select policyname from expected_policy)), 'none')
    union all
    select 9, 'no policy on storage.buckets (nothing but the admin API may change a bucket)',
           not exists (select 1 from pg_policies p where p.schemaname = 'storage' and p.tablename = 'buckets'),
           coalesce((select string_agg(concat_ws('|', p.policyname, p.permissive, p.roles::text, p.cmd,
                                                 coalesce(p.qual, '-'), coalesce(p.with_check, '-')),
                                       '; ' order by p.policyname)
                       from pg_policies p where p.schemaname = 'storage' and p.tablename = 'buckets'), 'none')
    union all
    select 10, 'no branding reference still points into the attachments bucket',
           not exists (select 1 from branding_ref),
           (select count(*)::text from branding_ref)
)
select seq, gate, case when coalesce(ok, false) then 'PASS' else 'FAIL' end as status, observed
  from gates
union all
select 99, '== VERDICT ==',
       case when bool_and(coalesce(ok, false)) then 'GO' else 'STOP' end,
       case when bool_and(coalesce(ok, false))
            then 'all gates PASS — the operator must still confirm Stage B and B.5; then run 10_set_attachments_privacy.mjs private'
            else 'failed gate(s): ' || string_agg(seq::text, ', ' order by seq) filter (where not coalesce(ok, false))
       end
  from gates
 order by seq;
