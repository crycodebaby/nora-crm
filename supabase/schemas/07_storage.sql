--
-- Storage
-- This file declares the attachments bucket controls and storage policies.
-- Current state after `20260915120000_nora_attachment_storage_hardening.sql`
-- (W8-B); migrations are authoritative.
--

-- Bucket (created in 20240730075029_init_db.sql). Stays public until W8-E and
-- the policies below do NOT make it private: storage-api serves a known object
-- key of a public bucket without login and without RLS —
-- /object/public/attachments/<key>, GET /object/attachments/<key> and
-- /object/info/... (metadata) need no credentials at all;
-- /object/authenticated/attachments/<key> only needs the public anon key.
-- Known-object download stays residual risk T1. The policies below protect
-- LIST, signed URL creation and authorization of Storage API mutations
-- (upload, signed upload URLs, TUS, upsert/overwrite, move, copy, delete).
update storage.buckets
set file_size_limit = 52428800, -- 50 MiB
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

-- SELECT/LIST: active Nora employees (live, owner-bound session)
create policy "attachments_select_active_user" on storage.objects for select to authenticated
    using (bucket_id = 'attachments' and nora_private.is_active_user());

-- INSERT: office/admin (can_write implies an active employee)
create policy "attachments_insert_writer" on storage.objects for insert to authenticated
    with check (bucket_id = 'attachments' and nora_private.can_write());

-- No UPDATE and no DELETE policy: no overwrite/upsert, no browser deletion.
-- Physical cleanup of note attachments is W8-C; orphans are accepted until then.
