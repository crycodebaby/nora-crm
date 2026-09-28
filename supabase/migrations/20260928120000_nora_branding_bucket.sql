-- Nora CRM: W8-E Branding Bucket (2026-09-28)
--
-- W8-E makes the `attachments` bucket private. Two of the four file classes
-- that share it today cannot survive that, because they are not confidential
-- content at all:
--
--   * the configuration light/dark logos, rendered on the LOGIN page -- there
--     is no session there, so there is nobody to sign a URL as;
--   * customer logos, which are public brand marks of the firms Nora works
--     with, not business documents.
--
-- Solving pre-auth branding with signed URLs is impossible, and solving it
-- with a service broker would introduce a new privileged path for a purely
-- cosmetic asset. The two classes are therefore separated BY BUCKET: this
-- migration creates a small, deliberately public `branding` bucket next to
-- the (still public, for now) `attachments` bucket.
--
-- Deliberately OUT of scope here, each for its own reason:
--
--   * `attachments.public` is NOT touched. Flipping it in a migration would
--     mean a routine pre-runtime `db push` produces the one combination W8-E
--     declares unsupported -- old runtime plus private bucket. The flip is a
--     data change on a configuration row, is packaged as an operator step
--     (supabase/maintenance/attachment_privacy/) and happens only after the
--     W8-E runtime is deployed and verified (Stage C).
--   * No object is copied, moved or deleted here. Relocating the four
--     existing branding objects is a data operation with its own dry-run and
--     verification, not schema.
--   * No change to `public.attachments`, the deletion queue, the liveness
--     resolver, the note projection or the S5 read gate. W8-E is an access
--     change, not an authority change: S6-B1, S6-B2 and S2B stay closed.
--
-- The bucket NAME matters and is not cosmetic. nora_private.attachment_url_
-- liveness (S2A2.1) classifies any storage-looking URL containing the
-- substring `attachments` as `unknown`, which is fail-closed and would make
-- every relocated branding URL permanently ambiguous to the deletion
-- contract. `branding` contains no such substring and classifies cleanly as
-- `none` -- this value does not reference that attachments key -- which is
-- exactly right once a logo has left the attachments bucket.

-- ---------------------------------------------------------------------------
-- 0. Preconditions (fail-closed)
-- ---------------------------------------------------------------------------
do $$
declare
    v_unexpected text;
begin
    if not (select c.relrowsecurity from pg_class c where c.oid = 'storage.objects'::regclass) then
        raise exception 'W8-E cannot be applied: RLS is not enabled on storage.objects'
            using errcode = '42501';
    end if;

    if to_regprocedure('nora_private.is_active_user()') is null
       or to_regprocedure('nora_private.can_write()') is null then
        raise exception 'W8-E cannot be applied: nora_private.is_active_user() / can_write() missing'
            using errcode = '42883';
    end if;

    -- Same rule as W8-B: permissive policies are OR-combined, so an unknown
    -- policy on storage.objects could silently widen either bucket. Abort
    -- before the first mutation; never drop a foreign policy.
    select string_agg(format('%I (%s)', p.policyname, p.cmd), ', ' order by p.policyname)
      into v_unexpected
    from pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.policyname not in ('attachments_select_active_user', 'attachments_insert_writer',
                               'branding_select_active_user', 'branding_insert_writer');

    if v_unexpected is not null then
        raise exception 'W8-E cannot be applied: unexpected policies on storage.objects: %', v_unexpected
            using errcode = '42501',
                  hint = 'Permissive policies are OR-combined. Resolve them with an explicit Product Owner decision; this migration never drops unknown policies.';
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. The branding bucket
-- ---------------------------------------------------------------------------
-- public = true is the POINT of this bucket, not an oversight: the login page
-- must render the logo with no credentials at all. Everything else about it is
-- deliberately narrow.
--
-- MIME allowlist: raster images only. image/svg+xml is excluded on purpose --
-- an SVG is an active document, and one served from a public bucket origin
-- could carry script. The upload UI crops to PNG, so the list is generous
-- rather than restrictive.
--
-- 5 MiB instead of the 50 MiB of `attachments`: a logo is small, and a public
-- bucket should not be usable as general file hosting.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'branding',
    'branding',
    true,
    5242880,
    array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. Storage API policies for bucket `branding`
-- ---------------------------------------------------------------------------
-- Reading the BYTES of a public bucket never consults RLS, so the SELECT
-- policy is not what makes branding readable. It governs the Storage API
-- surface -- listing and signed-URL creation -- and is kept identical to the
-- attachments contract so that one active-user rule covers both buckets.
create policy "branding_select_active_user"
    on storage.objects
    for select
    to authenticated
    using (
        bucket_id = 'branding'
        and nora_private.is_active_user()
    );

-- Writing is NOT public. Only an active office/admin identity with a live,
-- owner-bound session may upload a brand asset -- the same capability that
-- already governs attachment uploads.
create policy "branding_insert_writer"
    on storage.objects
    for insert
    to authenticated
    with check (
        bucket_id = 'branding'
        and nora_private.can_write()
    );

-- No UPDATE and no DELETE policy, deliberately: there is no overwrite contract
-- (replacing a known public key with foreign content is exactly the attack the
-- attachments bucket already refuses) and no Storage API deletion path.

-- ---------------------------------------------------------------------------
-- 3. Postconditions (fail-closed)
-- ---------------------------------------------------------------------------
do $$
declare
    v_unexpected text;
    v_public boolean;
    v_limit bigint;
    v_mime text[];
begin
    select string_agg(format('%I (%s)', p.policyname, p.cmd), ', ' order by p.policyname)
      into v_unexpected
    from pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.policyname not in ('attachments_select_active_user', 'attachments_insert_writer',
                               'branding_select_active_user', 'branding_insert_writer');

    if v_unexpected is not null then
        raise exception 'W8-E aborted: unexpected policies on storage.objects: %', v_unexpected
            using errcode = '42501';
    end if;

    if (select count(*) from pg_policies p
        where p.schemaname = 'storage' and p.tablename = 'objects'
          and p.permissive = 'PERMISSIVE' and p.roles = array['authenticated']::name[]
          and ((p.policyname = 'branding_select_active_user' and p.cmd = 'SELECT')
            or (p.policyname = 'branding_insert_writer' and p.cmd = 'INSERT'))) <> 2 then
        raise exception 'W8-E aborted: branding policies were not installed as expected';
    end if;

    -- The attachments contract must be exactly as W8-B left it. This migration
    -- adds a bucket; it does not touch the old one.
    if (select count(*) from pg_policies p
        where p.schemaname = 'storage' and p.tablename = 'objects'
          and p.policyname in ('attachments_select_active_user', 'attachments_insert_writer')) <> 2 then
        raise exception 'W8-E aborted: the W8-B attachments policies are not intact';
    end if;

    select b.public, b.file_size_limit, b.allowed_mime_types
      into v_public, v_limit, v_mime
    from storage.buckets b
    where b.id = 'branding';

    if v_public is null then
        raise exception 'W8-E aborted: bucket "branding" was not created';
    end if;

    if v_public is not true
       or v_limit is distinct from 5242880
       or cardinality(v_mime) <> 4
       or v_mime && array['image/svg+xml', 'text/html', 'application/xhtml+xml',
                          'application/xml', 'text/xml', 'text/javascript',
                          'application/javascript', 'application/octet-stream',
                          'application/pdf'] then
        raise exception 'W8-E aborted: bucket controls on "branding" were not applied as expected';
    end if;
end;
$$;
