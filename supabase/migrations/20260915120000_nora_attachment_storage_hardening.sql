-- Nora CRM: W8-B Attachment Immediate Security Hardening (2026-09-15)
--
-- Smallest durable slice that closes the immediate storage risks of the
-- shared `attachments` bucket (note attachments, company logos, branding
-- logos). It deliberately does NOT start the W8-C attachment foundation: no
-- attachments table, no attachment ids, no deletion queue, no private bucket.
--
-- 1. Storage API policies on storage.objects for bucket `attachments`
--    Before: bucket-only policies `to authenticated` (no role, no active-user,
--    no session check) for SELECT, INSERT and DELETE — a viewer could upload,
--    a deactivated employee with a still valid JWT could read/upload/delete,
--    and delete + re-insert under the same key allowed content substitution.
--    After:
--      SELECT  authenticated AND nora_private.is_active_user()
--      INSERT  authenticated AND nora_private.can_write()   (office/admin;
--              can_write -> has_role -> current_role already requires
--              sales.disabled = false and a live, owner-bound session)
--      UPDATE  no policy (no overwrite / upsert contract)
--      DELETE  no policy (physical deletion is W8-C; orphans are accepted)
--    Only the three policies proven from `20240730075029_init_db.sql` and
--    `supabase/schemas/07_storage.sql` are dropped. Unknown policies are never
--    dropped: permissive policies are OR-combined, so a foreign permissive
--    policy would silently re-open the bucket. The precondition block therefore
--    aborts the migration BEFORE the first mutation if storage.objects carries
--    any policy other than the three legacy policies or the two W8-B target
--    policies, and the postcondition block re-checks the final policy set
--    (Production release gate P2). The precondition does not depend on the
--    runner wrapping the file in one transaction, but it does require the
--    runner to stop at the first error (psql: -v ON_ERROR_STOP=1).
--
--    The bucket stays PUBLIC and these policies do NOT make it private.
--    storage-api serves a known object key of a public bucket without login
--    and without consulting RLS: /object/public/attachments/<key>,
--    GET /object/attachments/<key> and /object/info/... (metadata) need no
--    credentials at all; /object/authenticated/attachments/<key> only needs the
--    public anon key. Known-object download stays residual risk T1 until W8-E. What these policies protect: LIST, signed URL creation, and
--    authorization of Storage API mutations (upload, signed upload URLs, TUS,
--    upsert/overwrite, move, copy, delete).
--
-- 2. Bucket controls, managed in the repository instead of the dashboard
--    (same mechanism the bucket was created with: storage.buckets row):
--      file_size_limit     52428800 bytes (50 MiB, = supabase/config.toml
--                          [storage] file_size_limit)
--      allowed_mime_types  JPEG, PNG, WebP, GIF, PDF, DOCX, XLSX, TXT, CSV
--    Not allowed: SVG, HTML, XHTML, XML, JavaScript, macro-enabled or legacy
--    Office formats, HEIC/HEIF, and untyped uploads (application/octet-stream).
--    The allowlist is a baseline; the Production MIME distribution (release
--    gate P3) is not verified yet. Existing objects are not touched.
--
-- 3. Removal of the unsafe attachment delete path
--    AFTER DELETE/UPDATE triggers -> public.cleanup_note_attachments()
--    -> pg_net -> Edge Function delete_note_attachments (service_role remove
--    of client-controlled paths). The Edge Function source is removed from the
--    repository in the same change. Note and cascade deletes keep working;
--    storage objects of deleted notes remain as accepted orphans until W8-C.
--    pg_net itself is left installed (unrelated infrastructure).
--
-- Not in scope: storage schema default privileges (17 H), public read (W8-E),
-- legacy object keys and JSON paths (unchanged, still readable).

-- ---------------------------------------------------------------------------
-- 0. Preconditions (fail-closed)
-- ---------------------------------------------------------------------------
do $$
declare
    v_unexpected text;
begin
    if not exists (select 1 from storage.buckets where id = 'attachments') then
        raise exception 'W8-B cannot be applied: storage bucket "attachments" does not exist'
            using errcode = 'P0002';
    end if;

    if not (select c.relrowsecurity from pg_class c where c.oid = 'storage.objects'::regclass) then
        raise exception 'W8-B cannot be applied: RLS is not enabled on storage.objects'
            using errcode = '42501';
    end if;

    if to_regprocedure('nora_private.is_active_user()') is null
       or to_regprocedure('nora_private.can_write()') is null then
        raise exception 'W8-B cannot be applied: nora_private.is_active_user() / can_write() missing'
            using errcode = '42883';
    end if;

    -- Unknown policies must be detected before any mutation. Tolerated: the
    -- three legacy policies this migration replaces, and the two W8-B target
    -- policies (controlled re-check; re-creating them still fails below).
    select string_agg(format('%I (%s)', p.policyname, p.cmd), ', ' order by p.policyname)
      into v_unexpected
    from pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.policyname not in ('Attachments 1mt4rzk_0', 'Attachments 1mt4rzk_1', 'Attachments 1mt4rzk_3',
                               'attachments_select_active_user', 'attachments_insert_writer');

    if v_unexpected is not null then
        raise exception 'W8-B cannot be applied: unexpected policies on storage.objects: %', v_unexpected
            using errcode = '42501',
                  hint = 'Permissive policies are OR-combined and would re-open the attachments bucket. Resolve them with an explicit Product Owner decision (release gate P2); this migration never drops unknown policies.';
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Storage API policies for bucket `attachments`
-- ---------------------------------------------------------------------------
drop policy if exists "Attachments 1mt4rzk_0" on storage.objects;
drop policy if exists "Attachments 1mt4rzk_1" on storage.objects;
drop policy if exists "Attachments 1mt4rzk_3" on storage.objects;

create policy "attachments_select_active_user"
    on storage.objects
    for select
    to authenticated
    using (
        bucket_id = 'attachments'
        and nora_private.is_active_user()
    );

create policy "attachments_insert_writer"
    on storage.objects
    for insert
    to authenticated
    with check (
        bucket_id = 'attachments'
        and nora_private.can_write()
    );

-- ---------------------------------------------------------------------------
-- 2. Bucket controls
-- ---------------------------------------------------------------------------
update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = array[
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain',
        'text/csv'
    ]
where id = 'attachments';

-- ---------------------------------------------------------------------------
-- 3. Remove the unsafe attachment delete path
-- ---------------------------------------------------------------------------
drop trigger if exists on_contact_notes_deleted_delete_note_attachments on public.contact_notes;
drop trigger if exists on_deal_notes_deleted_delete_note_attachments on public.deal_notes;
drop trigger if exists on_contact_notes_attachments_updated_delete_note_attachments on public.contact_notes;
drop trigger if exists on_deal_notes_attachments_updated_delete_note_attachments on public.deal_notes;

-- No CASCADE: an unexpected dependency must fail the migration.
drop function if exists public.cleanup_note_attachments();
drop function if exists public.get_note_attachments_function_url();

-- ---------------------------------------------------------------------------
-- 4. Postconditions (fail-closed)
-- ---------------------------------------------------------------------------
do $$
declare
    v_unexpected text;
    v_bucket record;
begin
    -- exactly the two W8-B policies on storage.objects, nothing else
    select string_agg(format('%I (%s)', p.policyname, p.cmd), ', ' order by p.policyname)
      into v_unexpected
    from pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.policyname not in ('attachments_select_active_user', 'attachments_insert_writer');

    if v_unexpected is not null then
        raise exception 'W8-B aborted: unexpected policies on storage.objects: %', v_unexpected
            using errcode = '42501',
                  hint = 'Permissive policies are OR-combined and would re-open the attachments bucket. Resolve them with an explicit Product Owner decision (release gate P2); this migration never drops unknown policies.';
    end if;

    if (select count(*) from pg_policies p
        where p.schemaname = 'storage' and p.tablename = 'objects'
          and p.permissive = 'PERMISSIVE' and p.roles = array['authenticated']::name[]
          and ((p.policyname = 'attachments_select_active_user' and p.cmd = 'SELECT')
            or (p.policyname = 'attachments_insert_writer' and p.cmd = 'INSERT'))) <> 2 then
        raise exception 'W8-B aborted: attachment policies were not installed as expected';
    end if;

    select b.public, b.file_size_limit, b.allowed_mime_types
      into v_bucket
    from storage.buckets b
    where b.id = 'attachments';

    if v_bucket.file_size_limit is distinct from 52428800
       or cardinality(v_bucket.allowed_mime_types) <> 9
       or v_bucket.allowed_mime_types && array['image/svg+xml', 'text/html', 'application/xhtml+xml',
                                               'application/xml', 'text/xml', 'text/javascript',
                                               'application/javascript', 'application/octet-stream'] then
        raise exception 'W8-B aborted: bucket controls on "attachments" were not applied as expected';
    end if;

    if exists (select 1 from pg_trigger t
               where not t.tgisinternal
                 and t.tgname in ('on_contact_notes_deleted_delete_note_attachments',
                                  'on_deal_notes_deleted_delete_note_attachments',
                                  'on_contact_notes_attachments_updated_delete_note_attachments',
                                  'on_deal_notes_attachments_updated_delete_note_attachments'))
       or to_regprocedure('public.cleanup_note_attachments()') is not null
       or to_regprocedure('public.get_note_attachments_function_url()') is not null then
        raise exception 'W8-B aborted: the attachment delete path is still installed';
    end if;
end;
$$;
