-- W8-E Stage C PREFLIGHT — STRICT READ-ONLY. Writes nothing, ever.
--
-- Answers one question: may the `attachments` bucket be made private right
-- now? It is the same gate set `10_set_attachments_private.sql` enforces, run
-- separately so an operator can see the verdict before anything mutates.
--
-- It CANNOT observe the deployed frontend. Stage B (the W8-E runtime is live
-- and verified) is confirmed by the operator, not by this file — the file says
-- so in its verdict rather than implying it checked.
--
-- Safe against Production at any moment. No temp objects, no DDL; it runs
-- inside BEGIN TRANSACTION READ ONLY.
--
-- The release procedure (docs/nora/21 Section 17) requires this file
-- IMMEDIATELY before `10_set_attachments_private.sql`. It is defence in
-- depth, not the only line: `10` re-checks every gate below itself, including
-- the unknown-policy gate, and refuses before it writes.

begin transaction read only;

with gates as (
    select
        'branding bucket exists and is public' as gate,
        exists (select 1 from storage.buckets where id = 'branding' and public is true) as ok,
        (select coalesce(public::text, 'missing') from storage.buckets where id = 'branding') as observed
    union all
    select
        'branding policies installed (2)',
        (select count(*) from pg_policies
          where schemaname = 'storage' and tablename = 'objects'
            and policyname in ('branding_select_active_user', 'branding_insert_writer')) = 2,
        (select count(*)::text from pg_policies
          where schemaname = 'storage' and tablename = 'objects'
            and policyname in ('branding_select_active_user', 'branding_insert_writer'))
    union all
    select
        'W8-B attachments policies intact (2)',
        (select count(*) from pg_policies
          where schemaname = 'storage' and tablename = 'objects'
            and policyname in ('attachments_select_active_user', 'attachments_insert_writer')) = 2,
        (select count(*)::text from pg_policies
          where schemaname = 'storage' and tablename = 'objects'
            and policyname in ('attachments_select_active_user', 'attachments_insert_writer'))
    union all
    select
        'no unknown policy on storage.objects',
        not exists (select 1 from pg_policies
                     where schemaname = 'storage' and tablename = 'objects'
                       and policyname not in ('attachments_select_active_user', 'attachments_insert_writer',
                                              'branding_select_active_user', 'branding_insert_writer')),
        coalesce((select string_agg(policyname, ', ' order by policyname) from pg_policies
                   where schemaname = 'storage' and tablename = 'objects'
                     and policyname not in ('attachments_select_active_user', 'attachments_insert_writer',
                                            'branding_select_active_user', 'branding_insert_writer')), 'none')
    union all
    select
        'no branding reference still in the attachments bucket',
        (select count(*) from (
             select c.config ->> 'lightModeLogo' as v from public.configuration c
             union all select c.config ->> 'darkModeLogo' from public.configuration c
             union all select co.logo ->> 'src' from public.companies co where co.logo is not null
         ) r where r.v ~ '^https?://[^/?#[:space:]]+/storage/v1/object/public/attachments/') = 0,
        (select count(*)::text from (
             select c.config ->> 'lightModeLogo' as v from public.configuration c
             union all select c.config ->> 'darkModeLogo' from public.configuration c
             union all select co.logo ->> 'src' from public.companies co where co.logo is not null
         ) r where r.v ~ '^https?://[^/?#[:space:]]+/storage/v1/object/public/attachments/')
    union all
    select
        'attachments bucket is still public (flip not yet done)',
        (select public from storage.buckets where id = 'attachments') is true,
        (select coalesce(public::text, 'missing') from storage.buckets where id = 'attachments')
)
select
    gate,
    case when ok then 'PASS' else 'FAIL' end as status,
    observed
from gates
union all
select
    '== VERDICT ==',
    case when bool_and(ok) then 'GO (operator must also confirm Stage B is verified)' else 'STOP' end,
    ''
from gates
order by 1;

commit;
