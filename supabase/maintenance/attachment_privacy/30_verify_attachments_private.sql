-- W8-E POST-STAGE-C VERIFICATION — STRICT READ-ONLY. Writes nothing, ever.
--
-- Answers one question: is the database in the W8-E target state after
-- `10_set_attachments_privacy.mjs private --apply` reported PRIVATE /
-- VERIFIED? It is the read-only database half of the post-Stage-C proof;
-- the functional half (signed URLs for active users, nothing for anonymous
-- or deactivated callers, the exact primed URL) is in docs/nora/21 Section 17.
--
-- This file replaces the former `10_set_attachments_private.sql`, which
-- flipped the bucket by direct SQL and thereby bypassed the Storage API's CDN
-- purge (Alpha Storage 3C F-2). There is no SQL privacy flip any more; this
-- file can only read.
--
-- STRICTLY READ-ONLY BY CONSTRUCTION: ONE `select` statement, no DML, no DDL,
-- no temp object, no user-defined function call, no transaction control.
-- Verdict row LAST: `99 | == VERDICT == | VERIFIED` or `… | STOP`, with the
-- failed gates named. Every gate except #1 is identical to
-- `00_preflight.sql` — including the canonical policy fingerprints, which the
-- privacy verifier keeps in lockstep — so "nothing changed but the flip" is
-- shown by the same checks before and after.

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
    select 1, 'attachments bucket exists and is PRIVATE (Stage C target state)',
           coalesce((select not public from bucket where id = 'attachments'), false),
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
       case when bool_and(coalesce(ok, false)) then 'VERIFIED' else 'STOP' end,
       case when bool_and(coalesce(ok, false))
            then 'all gates PASS — database state is the W8-E target; complete the functional post-Stage-C checks'
            else 'failed gate(s): ' || string_agg(seq::text, ', ' order by seq) filter (where not coalesce(ok, false))
       end
  from gates
 order by seq;
