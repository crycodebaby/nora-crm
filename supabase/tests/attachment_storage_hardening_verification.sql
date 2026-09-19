-- Nora W8-B — attachment storage hardening: database contract verification
--
-- Self-contained: seeds throwaway identities, sessions and CRM rows inside one
-- DO block and rolls everything back (ROLLBACK_W8B_TEST). Safe on a fresh
-- `npx supabase db reset --local`, at any point after it.
--
-- Usage (local only):
--   docker exec -i supabase_db_atomic-crm-demo psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/attachment_storage_hardening_verification.sql
--
-- Companion: supabase/tests/attachment_storage_policy_verification.mjs proves
-- the same contract through the real Storage API with real GoTrue sessions
-- (role matrix, T10, MIME/size enforcement, public-read residual).
--
-- What it proves:
--   1. bucket `attachments`: still public, 50 MiB limit, exact MIME allowlist
--   2. storage.objects: RLS on, exactly two attachment policies (SELECT for
--      active users, INSERT for writers), no UPDATE/DELETE policy, the three
--      legacy bucket-only policies are gone
--   3. SQL-level policy matrix with API claim transport (request.jwt.claims)
--      and live sessions: anon / disabled / viewer / office / admin
--   4. delete path removed: no cleanup triggers on contact_notes/deal_notes,
--      no cleanup_note_attachments / get_note_attachments_function_url, no
--      public function referencing delete_note_attachments; pg_net untouched
--   5. regression: note attachment update, note delete, contact/deal/company
--      cascade deletes succeed under API-style request headers and enqueue no
--      pg_net HTTP request
--   6. no GUC leak

\set ON_ERROR_STOP on

\echo '=== W8-B: attachment storage hardening verification ==='

-- ---------------------------------------------------------------------------
-- 1.–2. Declarative contract
-- ---------------------------------------------------------------------------
do $$
declare
    v_bucket record;
    v_expected text[] := array[
        'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain', 'text/csv'
    ];
begin
    select * into v_bucket from storage.buckets where id = 'attachments';
    if not found then raise exception 'FAIL: bucket attachments missing'; end if;
    if not v_bucket.public then
        raise exception 'FAIL: bucket attachments must stay public in W8-B (public read is W8-E)';
    end if;
    if v_bucket.file_size_limit is distinct from 52428800 then
        raise exception 'FAIL: file_size_limit = %, expected 52428800', v_bucket.file_size_limit;
    end if;
    if not (v_bucket.allowed_mime_types @> v_expected and v_bucket.allowed_mime_types <@ v_expected) then
        raise exception 'FAIL: allowed_mime_types = %', v_bucket.allowed_mime_types;
    end if;
    raise notice 'OK  1. bucket controls (public, 50 MiB, 9 MIME types)';

    if not (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass) then
        raise exception 'FAIL: RLS disabled on storage.objects';
    end if;
    if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
               and policyname in ('Attachments 1mt4rzk_0', 'Attachments 1mt4rzk_1', 'Attachments 1mt4rzk_3')) then
        raise exception 'FAIL: legacy bucket-only attachment policies still installed';
    end if;
    if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects') <> 2 then
        raise exception 'FAIL: storage.objects must carry exactly the two W8-B policies';
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'attachments_select_active_user' and cmd = 'SELECT' and permissive = 'PERMISSIVE'
                   and roles = array['authenticated']::name[]
                   and qual like '%bucket_id = ''attachments''%' and qual like '%nora_private.is_active_user()%') then
        raise exception 'FAIL: attachments_select_active_user not as expected';
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'attachments_insert_writer' and cmd = 'INSERT' and permissive = 'PERMISSIVE'
                   and roles = array['authenticated']::name[]
                   and with_check like '%bucket_id = ''attachments''%' and with_check like '%nora_private.can_write()%') then
        raise exception 'FAIL: attachments_insert_writer not as expected';
    end if;
    if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
               and cmd in ('UPDATE', 'DELETE', 'ALL')) then
        raise exception 'FAIL: storage.objects must not carry UPDATE/DELETE/ALL policies';
    end if;
    raise notice 'OK  2. storage.objects policies (SELECT active, INSERT writer, no UPDATE/DELETE)';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Delete path removed
-- ---------------------------------------------------------------------------
do $$
begin
    -- The removed cleanup triggers were on_{contact,deal}_notes_*_delete_note_attachments.
    -- The pattern is anchored on that name: the W8-C S3B projection triggers
    -- (project_*_note_attachments_*) are a different, database-only mechanism
    -- and are verified in attachment_note_projection_verification.sql.
    if exists (select 1 from pg_trigger t
               where not t.tgisinternal
                 and t.tgrelid in ('public.contact_notes'::regclass, 'public.deal_notes'::regclass)
                 and (t.tgname like '%delete\_note\_attachments%'
                      or pg_get_triggerdef(t.oid) like '%cleanup_note_attachments%')) then
        raise exception 'FAIL: attachment cleanup trigger still installed';
    end if;
    if to_regprocedure('public.cleanup_note_attachments()') is not null
       or to_regprocedure('public.get_note_attachments_function_url()') is not null
       or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where p.proname in ('cleanup_note_attachments', 'get_note_attachments_function_url')) then
        raise exception 'FAIL: attachment cleanup functions still installed';
    end if;
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname in ('public', 'nora_private')
                 and p.prosrc like '%delete_note_attachments%') then
        raise exception 'FAIL: a function still references the delete_note_attachments Edge Function';
    end if;
    if not exists (select 1 from pg_extension where extname = 'pg_net') then
        raise exception 'FAIL: pg_net must stay installed (unrelated infrastructure)';
    end if;
    raise notice 'OK  4. delete path removed (triggers, functions, references); pg_net untouched';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. + 5. Behaviour with seeded identities and sessions (rolled back)
-- ---------------------------------------------------------------------------
do $$
declare
    v_admin uuid := gen_random_uuid();
    v_office uuid := gen_random_uuid();
    v_viewer uuid := gen_random_uuid();
    v_disabled uuid := gen_random_uuid();
    v_a bigint; v_o bigint; v_v bigint; v_d bigint;
    v_company bigint; v_contact bigint; v_deal bigint;
    v_cnote bigint; v_dnote bigint;
    v_queue_before bigint;
    v_n bigint;
    v_ok boolean;
    v_row record;
    v_attachment jsonb := jsonb_build_object(
        'src', 'http://127.0.0.1:54321/storage/v1/object/public/attachments/0.8262106278726917.pdf',
        'path', '0.8262106278726917.pdf', 'title', 'legacy.pdf', 'type', 'application/pdf');
    -- W8-C S3B: every note write is projected into public.attachments, where a
    -- storage key belongs to exactly one note and a removed key cannot be
    -- re-referenced (S3A admission). Each note therefore gets its own key,
    -- and each element keeps path and src consistent (S3B grammar).
    c_src_base constant text := 'http://127.0.0.1:54321/storage/v1/object/public/attachments/';
begin
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values
      (v_admin,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'w8b-admin@nora.test',    'x', now(), '{"provider":"email","providers":["email"]}', '{"first_name":"Ada","last_name":"Admin"}',    now(), now()),
      (v_office,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'w8b-office@nora.test',   'x', now(), '{"provider":"email","providers":["email"]}', '{"first_name":"Olaf","last_name":"Office"}',  now(), now()),
      (v_viewer,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'w8b-viewer@nora.test',   'x', now(), '{"provider":"email","providers":["email"]}', '{"first_name":"Vera","last_name":"Viewer"}',  now(), now()),
      (v_disabled, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'w8b-disabled@nora.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{"first_name":"Dirk","last_name":"Disabled"}', now(), now());
    select id into v_a from public.sales where user_id = v_admin;
    select id into v_o from public.sales where user_id = v_office;
    select id into v_v from public.sales where user_id = v_viewer;
    select id into v_d from public.sales where user_id = v_disabled;
    perform nora_private.apply_sales_role_change(v_a, 'admin', false);
    perform nora_private.apply_sales_role_change(v_o, 'office', false);
    perform nora_private.apply_sales_role_change(v_v, 'viewer', false);
    perform nora_private.apply_sales_role_change(v_d, 'office', true);

    -- fixture session id = user id (suite convention)
    insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
      (v_admin, v_admin, now(), now(), 'aal1'), (v_office, v_office, now(), now(), 'aal1'),
      (v_viewer, v_viewer, now(), now(), 'aal1'), (v_disabled, v_disabled, now(), now(), 'aal1');

    insert into storage.objects (bucket_id, name, metadata)
    values ('attachments', 'w8b-sql-fixture.txt', '{"mimetype":"text/plain","size":1}');

    -- ---- 3. SQL-level policy matrix, API claim transport
    for v_row in select * from (values
        ('anon',     null::uuid,  'anon',          false, false),
        ('disabled', v_disabled,  'authenticated', false, false),
        ('viewer',   v_viewer,    'authenticated', true,  false),
        ('office',   v_office,    'authenticated', true,  true),
        ('admin',    v_admin,     'authenticated', true,  true)
    ) as t(label, uid, api_role, reads, writes) loop
        perform set_config('request.jwt.claims',
            case when v_row.uid is null then json_build_object('role', 'anon')::text
                 else json_build_object('role', 'authenticated', 'sub', v_row.uid::text, 'session_id', v_row.uid::text)::text end,
            true);
        if v_row.api_role = 'anon' then set local role anon; else set local role authenticated; end if;

        v_ok := exists (select 1 from storage.objects where bucket_id = 'attachments' and name = 'w8b-sql-fixture.txt');
        if v_ok <> v_row.reads then raise exception 'FAIL: % SELECT storage.objects = %', v_row.label, v_ok; end if;

        v_ok := true;
        begin
            insert into storage.objects (bucket_id, name) values ('attachments', 'w8b-sql-insert-' || v_row.label || '.txt');
        exception when others then
            if sqlstate = '42501' then v_ok := false; else raise; end if;
        end;
        if v_ok <> v_row.writes then raise exception 'FAIL: % INSERT storage.objects = %', v_row.label, v_ok; end if;

        update storage.objects set metadata = '{"mimetype":"text/html"}' where bucket_id = 'attachments' and name = 'w8b-sql-fixture.txt';
        get diagnostics v_n = row_count;
        if v_n <> 0 then raise exception 'FAIL: % UPDATE storage.objects affected % row(s)', v_row.label, v_n; end if;

        -- storage.protect_delete blocks direct SQL deletes regardless of RLS;
        -- the Storage API path (which sets storage.allow_delete_query) is proven
        -- in attachment_storage_policy_verification.mjs. Here: RLS filters to 0 rows.
        perform set_config('storage.allow_delete_query', 'true', true);
        delete from storage.objects where bucket_id = 'attachments' and name = 'w8b-sql-fixture.txt';
        get diagnostics v_n = row_count;
        perform set_config('storage.allow_delete_query', '', true);
        if v_n <> 0 then raise exception 'FAIL: % DELETE storage.objects affected % row(s)', v_row.label, v_n; end if;

        reset role;
    end loop;
    perform set_config('request.jwt.claims', '', true);
    raise notice 'OK  3. SQL policy matrix (anon / disabled / viewer / office / admin)';

    -- ---- 5. note and cascade regressions under API-style request headers
    insert into public.companies (name, sales_id) values ('W8-B Kunde', v_o) returning id into v_company;
    insert into public.contacts (first_name, last_name, company_id, sales_id) values ('Kon', 'Takt', v_company, v_o) returning id into v_contact;
    insert into public.deals (name, company_id, stage, sales_id) values ('W8-B Vorgang', v_company, 'opportunity', v_o) returning id into v_deal;

    select count(*) into v_queue_before from net.http_request_queue;

    -- office: note with attachment, attachment list edited, attachment removed
    perform set_config('request.headers', json_build_object('authorization', 'Bearer w8b-fixture')::text, true);
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_office::text, 'session_id', v_office::text)::text, true);
    set local role authenticated;
    insert into public.contact_notes (contact_id, text, date, attachments)
    values (v_contact, 'mit Anhang', now(), array[v_attachment,
            v_attachment || jsonb_build_object('path', 'w8b-second.pdf', 'src', c_src_base || 'w8b-second.pdf')])
    returning id into v_cnote;
    insert into public.deal_notes (deal_id, text, date, attachments)
    values (v_deal, 'mit Anhang', now(), array[v_attachment || jsonb_build_object('path', 'w8b-deal.pdf', 'src', c_src_base || 'w8b-deal.pdf')])
    returning id into v_dnote;
    update public.contact_notes set attachments = array[v_attachment] where id = v_cnote;
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'FAIL: office attachment list update'; end if;
    update public.deal_notes set attachments = null where id = v_dnote;
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'FAIL: office attachment removal'; end if;
    reset role;

    -- admin: note deletes, then cascades
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_admin::text, 'session_id', v_admin::text)::text, true);
    set local role authenticated;
    delete from public.contact_notes where id = v_cnote;
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'FAIL: admin contact note delete'; end if;
    delete from public.deal_notes where id = v_dnote;
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'FAIL: admin deal note delete'; end if;

    insert into public.contact_notes (contact_id, text, date, attachments)
        values (v_contact, 'cascade', now(), array[v_attachment || jsonb_build_object('path', 'w8b-cascade-contact.pdf', 'src', c_src_base || 'w8b-cascade-contact.pdf')]);
    insert into public.deal_notes (deal_id, text, date, attachments)
        values (v_deal, 'cascade', now(), array[v_attachment || jsonb_build_object('path', 'w8b-cascade-deal.pdf', 'src', c_src_base || 'w8b-cascade-deal.pdf')]);
    delete from public.contacts where id = v_contact;
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'FAIL: admin contact delete (cascade to notes)'; end if;
    delete from public.deals where id = v_deal;
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'FAIL: admin deal delete (cascade to notes)'; end if;
    reset role;

    if exists (select 1 from public.contact_notes where contact_id = v_contact)
       or exists (select 1 from public.deal_notes where deal_id = v_deal) then
        raise exception 'FAIL: cascaded notes survived';
    end if;

    -- company cascade (as postgres: the admin company delete path is covered elsewhere)
    insert into public.contacts (first_name, last_name, company_id, sales_id) values ('Kas', 'Kade', v_company, v_o) returning id into v_contact;
    insert into public.contact_notes (contact_id, text, date, attachments)
        values (v_contact, 'company cascade', now(), array[v_attachment || jsonb_build_object('path', 'w8b-company-cascade.pdf', 'src', c_src_base || 'w8b-company-cascade.pdf')]);
    delete from public.companies where id = v_company;
    if exists (select 1 from public.contact_notes where contact_id = v_contact) then
        raise exception 'FAIL: company cascade left notes behind';
    end if;

    if (select count(*) from net.http_request_queue) <> v_queue_before then
        raise exception 'FAIL: note update/delete enqueued a pg_net HTTP request';
    end if;
    perform set_config('request.headers', '', true);
    perform set_config('request.jwt.claims', '', true);
    raise notice 'OK  5. note attachment update/remove, note delete, contact/deal/company cascades; no HTTP enqueued';

    raise notice 'W8-B behaviour suite passed (rolled back)';
    raise exception 'ROLLBACK_W8B_TEST';
exception
    when others then
        if sqlerrm = 'ROLLBACK_W8B_TEST' then
            return;
        end if;
        raise;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. No leak
-- ---------------------------------------------------------------------------
do $$
begin
    if coalesce(current_setting('request.jwt.claims', true), '') <> ''
       or coalesce(current_setting('request.headers', true), '') <> ''
       or coalesce(current_setting('storage.allow_delete_query', true), '') <> '' then
        raise exception 'FAIL: context leaked out of the suite';
    end if;
    if exists (select 1 from storage.objects where name like 'w8b-sql-%')
       or exists (select 1 from auth.users where email like 'w8b-%@nora.test' and email in
                  ('w8b-admin@nora.test', 'w8b-office@nora.test', 'w8b-viewer@nora.test', 'w8b-disabled@nora.test')) then
        raise exception 'FAIL: fixtures survived the rollback';
    end if;
    raise notice 'OK  6. no leak, fixtures rolled back';
end;
$$;

\echo '=== W8-B: all checks passed ==='
select 'attachment_storage_hardening_verification: OK' as result;
