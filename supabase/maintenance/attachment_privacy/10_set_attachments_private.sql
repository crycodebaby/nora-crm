-- W8-E Stage C — MAKE THE `attachments` BUCKET PRIVATE. THIS FILE MUTATES.
--
-- It writes exactly one column of exactly one row:
--     storage.buckets.public = false   where id = 'attachments'
--
-- It touches nothing else: no policy, no grant, no object, no `public.*`
-- table, no note JSON, no queue row, no branding bucket.
--
-- WHY THIS IS AN OPERATOR STEP AND NOT A MIGRATION
--   `db push` applies every pending migration before the new runtime is
--   deployed. If the flip lived in a migration, that routine ordering would
--   produce the one combination W8-E declares UNSUPPORTED: the OLD runtime,
--   which reaches attachments through public object URLs, against a PRIVATE
--   bucket — every attachment image broken for every user, for the length of
--   the deploy. Bucket publicness is a configuration row, not schema, so it
--   is packaged where its ordering can be controlled.
--
-- PRECONDITION — release gate, enforced below, not merely documented.
--   The W8-E runtime MUST already be live and verified (Stage B green). This
--   file cannot observe the deployed frontend, so it enforces what it CAN
--   observe and the operator confirms the rest:
--     * the `branding` bucket exists, is public, and carries its two policies
--       — without it the login page loses its logo the moment this runs;
--     * the two W8-B attachments policies are intact — they are what keeps
--       active employees able to sign URLs once the bucket is private;
--     * no branding reference still points into the `attachments` bucket.
--       This is the real gate: if Stage A did not complete, flipping now
--       breaks pre-auth branding.
--
-- ROLLBACK is `20_set_attachments_public.sql` in this directory. It is
-- immediate and total: publicness is one boolean, no data is transformed, and
-- nothing in Stage A or B has to be undone first.
--
-- Run through psql with -v ON_ERROR_STOP=1, or verbatim through Supabase MCP
-- execute_sql. It reports its own result in the same invocation.

do $$
declare
    v_was_public boolean;
    v_stale_refs bigint;
begin
    -- ---------------------------------------------------------------------
    -- Gate 1: the branding bucket must be ready to take over
    -- ---------------------------------------------------------------------
    if not exists (
        select 1 from storage.buckets
        where id = 'branding' and public is true
    ) then
        raise exception 'W8-E Stage C refused: the public "branding" bucket does not exist'
            using errcode = '55000',
                  detail = 'NORA_W8E_BRANDING_BUCKET_MISSING',
                  hint = 'Apply migration 20260928120000_nora_branding_bucket.sql first (Stage A).';
    end if;

    if (select count(*) from pg_policies p
        where p.schemaname = 'storage' and p.tablename = 'objects'
          and p.policyname in ('branding_select_active_user', 'branding_insert_writer')) <> 2 then
        raise exception 'W8-E Stage C refused: the branding policies are not installed'
            using errcode = '55000',
                  detail = 'NORA_W8E_BRANDING_POLICIES_MISSING';
    end if;

    -- ---------------------------------------------------------------------
    -- Gate 2: the attachments read path must survive the flip
    -- ---------------------------------------------------------------------
    -- Once the bucket is private, `attachments_select_active_user` is the ONLY
    -- thing that lets an employee mint a signed URL. Flipping without it would
    -- make every attachment unreachable for everyone.
    if (select count(*) from pg_policies p
        where p.schemaname = 'storage' and p.tablename = 'objects'
          and p.policyname in ('attachments_select_active_user', 'attachments_insert_writer')) <> 2 then
        raise exception 'W8-E Stage C refused: the W8-B attachments policies are not intact'
            using errcode = '55000',
                  detail = 'NORA_W8E_ATTACHMENT_POLICIES_MISSING';
    end if;

    -- ---------------------------------------------------------------------
    -- Gate 3: Stage A must actually have completed
    -- ---------------------------------------------------------------------
    -- A branding reference still pointing into `attachments` is exactly the
    -- thing that breaks at the moment of the flip, and the login page is the
    -- one surface with no session to recover with.
    select count(*) into v_stale_refs
    from (
        select c.config ->> 'lightModeLogo' as v from public.configuration c
        union all
        select c.config ->> 'darkModeLogo' from public.configuration c
        union all
        select co.logo ->> 'src' from public.companies co where co.logo is not null
    ) as refs
    where refs.v is not null
      and refs.v ~ '^https?://[^/?#[:space:]]+/storage/v1/object/public/attachments/';

    if v_stale_refs > 0 then
        raise exception 'W8-E Stage C refused: % branding reference(s) still point into the attachments bucket', v_stale_refs
            using errcode = '55000',
                  detail = 'NORA_W8E_BRANDING_NOT_RELOCATED',
                  hint = 'Run supabase/maintenance/branding_migration/relocate_branding_objects.mjs --apply first (Stage A).';
    end if;

    -- ---------------------------------------------------------------------
    -- The flip
    -- ---------------------------------------------------------------------
    select b.public into v_was_public from storage.buckets b where b.id = 'attachments';
    if v_was_public is null then
        raise exception 'W8-E Stage C refused: bucket "attachments" does not exist'
            using errcode = 'P0002';
    end if;

    update storage.buckets set public = false where id = 'attachments';

    raise notice 'W8-E Stage C: attachments.public % -> false', v_was_public;
end;
$$;

-- The invocation returns its own result. No second query, no second session.
select
    b.id                                            as bucket,
    b.public                                        as is_public,
    (select count(*) from storage.objects o
      where o.bucket_id = b.id)                     as object_count,
    case when b.public is false
         then 'PRIVATE — verify anonymously that a former public object URL no longer returns bytes'
         else 'STILL PUBLIC — the flip did not take effect'
    end                                             as verdict
from storage.buckets b
where b.id in ('attachments', 'branding')
order by b.id;
