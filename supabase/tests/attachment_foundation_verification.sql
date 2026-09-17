-- Nora W8-C S1 — attachment schema foundation: database contract verification
--
-- Self-contained and rollback-safe: every fixture is created inside a DO block
-- that terminates with ROLLBACK_W8C_S1_TEST, so the block's subtransaction
-- undoes it. Safe at any point after a fresh `npx supabase db reset --local`.
--
-- Usage (local only):
--   docker exec -i supabase_db_atomic-crm-demo psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/attachment_foundation_verification.sql
--
-- What it proves:
--   1. table shape: columns, types, nullability, created_at default, primary key,
--      and the absence of columns S1 deliberately does not have (uploaded_by,
--      updated_at, status/deleted_at/archived_at/provider/bucket/metadata)
--   2. declarative access contract: RLS enabled, exactly three policies
--      (SELECT/INSERT/DELETE), no UPDATE policy, no ALL policy, and the exact
--      table privilege matrix for anon / authenticated / service_role
--   3. owner invariant: contact-only PASS, deal-only PASS, neither FAIL, both FAIL
--   4. storage identity: non-empty accepted, duplicate rejected by the DATABASE,
--      empty / whitespace-only / over-long rejected
--   5. file metadata: file_name and mime_type invariants; byte_size NULL, 0 and
--      positive accepted, negative rejected
--   6. cascade: contact_note, deal_note, contact, deal and company deletion all
--      remove the attachment METADATA ROW. No physical storage object is
--      deleted anywhere in S1 — there is no such path yet (W8-B removed the old
--      one, S2 designs the new one). A passing cascade test says nothing about
--      a binary object.
--   7. behavioural role matrix with API claim transport (request.jwt.claims) and
--      live sessions: admin / office / viewer / disabled-with-valid-JWT /
--      active-office-WITHOUT-a-live-session / anon, plus a control proving that
--      the last one is denied by the session binding itself and not by
--      sales.role or sales.disabled
--   8. scope: the table is empty (no backfill), the legacy note JSON arrays are
--      untouched, and the only trigger on it is the W8-C S2A1 capture hook
--      (20260917120000) — no consumer, no physical storage delete path
--   9. no GUC or role leak
--
-- NOT proven here (out of S1 scope by design): physical storage deletion,
-- application wiring, uploaded_by attribution, legacy migration.

\set ON_ERROR_STOP on

\echo '=== W8-C S1: attachment foundation verification ==='

-- ---------------------------------------------------------------------------
-- 1. Table shape
-- ---------------------------------------------------------------------------
do $$
declare
    r          record;
    v_extra    text;
    v_failures text[] := '{}';
begin
    if to_regclass('public.attachments') is null then
        raise exception 'FAIL: public.attachments does not exist';
    end if;

    if pg_get_userbyid((select relowner from pg_class where oid = 'public.attachments'::regclass)) <> 'postgres' then
        v_failures := array_append(v_failures, 'public.attachments is not owned by postgres');
    end if;

    for r in
        select * from (values
            ('id',              'bigint',                   false),
            ('contact_note_id', 'bigint',                   true),
            ('deal_note_id',    'bigint',                   true),
            ('storage_key',     'text',                     false),
            ('file_name',       'text',                     false),
            ('mime_type',       'text',                     false),
            ('byte_size',       'bigint',                   true),
            ('created_at',      'timestamp with time zone', false)
        ) as t(col, typ, nullable)
    loop
        if not exists (
            select 1 from pg_attribute a
            where a.attrelid = 'public.attachments'::regclass
              and a.attname = r.col and a.attnum > 0 and not a.attisdropped
              and format_type(a.atttypid, a.atttypmod) = r.typ
              and a.attnotnull = (not r.nullable)
        ) then
            v_failures := v_failures || format('column %s is not %s %s', r.col, r.typ,
                case when r.nullable then 'NULL' else 'NOT NULL' end);
        end if;
    end loop;

    -- S1 has exactly these eight columns: no uploaded_by/created_by/sales_id
    -- (P-2 deferred), no updated_at (metadata is immutable), no generic
    -- lifecycle or provider columns.
    select string_agg(a.attname, ', ' order by a.attname) into v_extra
    from pg_attribute a
    where a.attrelid = 'public.attachments'::regclass and a.attnum > 0 and not a.attisdropped
      and a.attname not in ('id','contact_note_id','deal_note_id','storage_key','file_name',
                            'mime_type','byte_size','created_at');
    if v_extra is not null then
        v_failures := v_failures || format('unexpected columns: %s', v_extra);
    end if;

    if not exists (select 1 from pg_attrdef d
                   join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
                   where d.adrelid = 'public.attachments'::regclass and a.attname = 'created_at'
                     and pg_get_expr(d.adbin, d.adrelid) like 'now()%') then
        v_failures := array_append(v_failures, 'created_at has no now() default');
    end if;

    if not exists (select 1 from pg_constraint con
                   where con.conrelid = 'public.attachments'::regclass and con.contype = 'p') then
        v_failures := array_append(v_failures, 'no primary key');
    end if;

    for r in
        select * from (values
            ('attachments_owner_check',          'c'),
            ('attachments_storage_key_check',    'c'),
            ('attachments_file_name_check',      'c'),
            ('attachments_mime_type_check',      'c'),
            ('attachments_byte_size_check',      'c'),
            ('attachments_contact_note_id_fkey', 'f'),
            ('attachments_deal_note_id_fkey',    'f')
        ) as t(conname, contype)
    loop
        if not exists (select 1 from pg_constraint con
                       where con.conrelid = 'public.attachments'::regclass
                         and con.conname = r.conname and con.contype = r.contype::"char") then
            v_failures := v_failures || format('missing constraint %s', r.conname);
        end if;
    end loop;

    -- both owner foreign keys must be ON DELETE CASCADE and point at the notes
    if not exists (select 1 from pg_constraint con
                   where con.conname = 'attachments_contact_note_id_fkey'
                     and con.confrelid = 'public.contact_notes'::regclass and con.confdeltype = 'c') then
        v_failures := array_append(v_failures, 'attachments_contact_note_id_fkey is not ON DELETE CASCADE to contact_notes');
    end if;
    if not exists (select 1 from pg_constraint con
                   where con.conname = 'attachments_deal_note_id_fkey'
                     and con.confrelid = 'public.deal_notes'::regclass and con.confdeltype = 'c') then
        v_failures := array_append(v_failures, 'attachments_deal_note_id_fkey is not ON DELETE CASCADE to deal_notes');
    end if;

    if not exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
                   where i.indrelid = 'public.attachments'::regclass and i.indisunique
                     and c.relname = 'uq__attachments__storage_key') then
        v_failures := array_append(v_failures, 'missing UNIQUE index uq__attachments__storage_key');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL: table shape:\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  1. table shape: 8 columns, owner/storage/file/mime/size checks, 2 CASCADE FKs, UNIQUE(storage_key)';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Declarative access contract (RLS + privileges are two separate gates)
-- ---------------------------------------------------------------------------
do $$
declare
    r           record;
    v_priv      text;
    v_role      text;
    v_expected  boolean;
    v_actual    boolean;
    v_unexpected text;
    v_failures  text[] := '{}';
    v_dangerous text[] := case when current_setting('server_version_num')::int >= 170000
                               then array['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']
                               else array['TRUNCATE','REFERENCES','TRIGGER']
                          end;
begin
    if not (select c.relrowsecurity from pg_class c where c.oid = 'public.attachments'::regclass) then
        v_failures := array_append(v_failures, 'RLS is not enabled on public.attachments');
    end if;

    select string_agg(format('%s (%s, roles=%s)', p.policyname, p.cmd, p.roles::text), ', ' order by p.policyname)
      into v_unexpected
    from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'attachments'
      and (p.policyname, p.cmd) not in (('attachments_select_active_user', 'SELECT'),
                                        ('attachments_insert_writer', 'INSERT'),
                                        ('attachments_delete_writer', 'DELETE'));
    if v_unexpected is not null then
        v_failures := v_failures || format('unexpected policies: %s', v_unexpected);
    end if;

    -- explicit: no UPDATE policy and no ALL policy may ever appear here
    if exists (select 1 from pg_policies p
               where p.schemaname = 'public' and p.tablename = 'attachments'
                 and p.cmd in ('UPDATE', 'ALL')) then
        v_failures := array_append(v_failures, 'an UPDATE or ALL policy exists on public.attachments');
    end if;

    if (select count(*) from pg_policies p
        where p.schemaname = 'public' and p.tablename = 'attachments'
          and p.permissive = 'PERMISSIVE' and p.roles = array['authenticated']::name[]) <> 3 then
        v_failures := array_append(v_failures, 'expected exactly three PERMISSIVE policies to authenticated');
    end if;

    -- helper functions: consumed, not copied
    if (select count(*) from pg_policies p
        where p.schemaname = 'public' and p.tablename = 'attachments'
          and (coalesce(p.qual, '') || coalesce(p.with_check, '')) like '%nora_private.%') <> 3 then
        v_failures := array_append(v_failures, 'the policies do not all use the canonical nora_private helpers');
    end if;

    for r in
        select * from (values
            ('authenticated', 'SELECT,INSERT,DELETE'),
            ('anon',          ''),
            ('service_role',  '')
        ) as t(grantee, privs)
    loop
        foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE'] loop
            v_expected := (v_priv = any (string_to_array(r.privs, ',')));
            v_actual   := has_table_privilege(r.grantee, 'public.attachments', v_priv);
            if v_actual is distinct from v_expected then
                v_failures := v_failures || format('%s on public.attachments: %s expected=%s actual=%s',
                    r.grantee, v_priv, v_expected, v_actual);
            end if;
        end loop;
    end loop;

    foreach v_role in array array['anon','authenticated','service_role'] loop
        foreach v_priv in array v_dangerous loop
            if has_table_privilege(v_role, 'public.attachments', v_priv) then
                v_failures := v_failures || format('%s holds %s on public.attachments', v_role, v_priv);
            end if;
        end loop;
    end loop;

    -- the identity sequence must not need or hand out a privilege either
    foreach v_role in array array['anon','authenticated','service_role'] loop
        if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relkind = 'S' and c.relname like 'attachments_id_%'
                     and (has_sequence_privilege(v_role, c.oid, 'USAGE')
                       or has_sequence_privilege(v_role, c.oid, 'SELECT')
                       or has_sequence_privilege(v_role, c.oid, 'UPDATE'))) then
            v_failures := v_failures || format('%s holds a privilege on the attachments identity sequence', v_role);
        end if;
    end loop;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL: access contract:\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  2. RLS on, exactly SELECT/INSERT/DELETE policies, no UPDATE/ALL policy, privilege matrix exact';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3.–6. Invariants and cascades (as postgres, everything rolled back)
-- ---------------------------------------------------------------------------
do $$
declare
    v_sales    bigint;
    v_user     uuid := gen_random_uuid();
    v_company  bigint; v_contact bigint; v_deal bigint;
    v_cnote    bigint; v_dnote bigint;
    v_a1       bigint;
    v_n        bigint;
    v_state    text;
begin
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'w8c-s1-owner@nora.test', 'x', now(),
            '{"provider":"email","providers":["email"]}', '{"first_name":"Ole","last_name":"Owner"}', now(), now());
    select id into v_sales from public.sales where user_id = v_user;

    insert into public.companies (name, sales_id) values ('W8-C Kunde', v_sales) returning id into v_company;
    insert into public.contacts (first_name, last_name, company_id, sales_id)
        values ('Kon', 'Takt', v_company, v_sales) returning id into v_contact;
    insert into public.deals (name, company_id, stage, sales_id)
        values ('W8-C Vorgang', v_company, 'opportunity', v_sales) returning id into v_deal;
    insert into public.contact_notes (contact_id, text, date, sales_id)
        values (v_contact, 'Notiz', now(), v_sales) returning id into v_cnote;
    insert into public.deal_notes (deal_id, text, date, sales_id)
        values (v_deal, 'Notiz', now(), v_sales) returning id into v_dnote;

    -- ---- 3. owner invariant ------------------------------------------------
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
        values (v_cnote, 'w8c-s1-contact.pdf', 'plan.pdf', 'application/pdf') returning id into v_a1;
    if v_a1 is null then raise exception 'FAIL: contact-note-owned attachment was not accepted'; end if;

    insert into public.attachments (deal_note_id, storage_key, file_name, mime_type, byte_size)
        values (v_dnote, 'w8c-s1-deal.pdf', 'angebot.pdf', 'application/pdf', 1234);

    v_state := 'accepted';
    begin
        insert into public.attachments (storage_key, file_name, mime_type)
            values ('w8c-s1-noowner.pdf', 'x.pdf', 'application/pdf');
    exception when check_violation then v_state := 'rejected';
    end;
    if v_state <> 'rejected' then raise exception 'FAIL: an attachment without an owner was accepted'; end if;

    v_state := 'accepted';
    begin
        insert into public.attachments (contact_note_id, deal_note_id, storage_key, file_name, mime_type)
            values (v_cnote, v_dnote, 'w8c-s1-twoowners.pdf', 'x.pdf', 'application/pdf');
    exception when check_violation then v_state := 'rejected';
    end;
    if v_state <> 'rejected' then raise exception 'FAIL: an attachment with two owners was accepted'; end if;
    raise notice 'OK  3. owner invariant: contact-only PASS, deal-only PASS, neither FAIL, both FAIL';

    -- ---- 4. storage identity ----------------------------------------------
    v_state := 'accepted';
    begin
        insert into public.attachments (deal_note_id, storage_key, file_name, mime_type)
            values (v_dnote, 'w8c-s1-contact.pdf', 'kopie.pdf', 'application/pdf');
    exception when unique_violation then v_state := 'rejected';
    end;
    if v_state <> 'rejected' then
        raise exception 'FAIL: a duplicate storage_key was accepted (the DB invariant is missing)';
    end if;

    foreach v_state in array array['', '   ']
    loop
        declare v_inner text := 'accepted';
        begin
            begin
                insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
                    values (v_cnote, v_state, 'x.pdf', 'application/pdf');
            exception when check_violation then v_inner := 'rejected';
            end;
            if v_inner <> 'rejected' then
                raise exception 'FAIL: storage_key "%" was accepted', v_state;
            end if;
        end;
    end loop;

    v_state := 'accepted';
    begin
        insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
            values (v_cnote, repeat('k', 513), 'x.pdf', 'application/pdf');
    exception when check_violation then v_state := 'rejected';
    end;
    if v_state <> 'rejected' then raise exception 'FAIL: an unbounded storage_key was accepted'; end if;

    v_state := 'accepted';
    begin
        insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
            values (v_cnote, null, 'x.pdf', 'application/pdf');
    exception when not_null_violation then v_state := 'rejected';
    end;
    if v_state <> 'rejected' then raise exception 'FAIL: a NULL storage_key was accepted'; end if;

    -- today's two real key layouts must both remain valid: the invariant is
    -- identity, not a format (W8-E may choose another layout)
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
        values (v_cnote, '0.8262106278726917.pdf', 'legacy.pdf', 'application/pdf');
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
        values (v_cnote, gen_random_uuid()::text || '.pdf', 'neu.pdf', 'application/pdf');
    raise notice 'OK  4. storage identity: unique enforced by the database, empty/blank/over-long/NULL rejected, legacy + UUID layouts accepted';

    -- ---- 5. file metadata --------------------------------------------------
    foreach v_state in array array['file_name', 'mime_type']
    loop
        declare v_inner text := 'accepted';
        begin
            begin
                execute format(
                    'insert into public.attachments (contact_note_id, storage_key, file_name, mime_type) values (%L, %L, %L, %L)',
                    v_cnote, 'w8c-s1-empty-' || v_state || '.pdf',
                    case when v_state = 'file_name' then '  ' else 'x.pdf' end,
                    case when v_state = 'mime_type' then '' else 'application/pdf' end);
            exception when check_violation then v_inner := 'rejected';
            end;
            if v_inner <> 'rejected' then raise exception 'FAIL: an empty % was accepted', v_state; end if;

            v_inner := 'accepted';
            begin
                execute format(
                    'insert into public.attachments (contact_note_id, storage_key, file_name, mime_type) values (%L, %L, %s, %s)',
                    v_cnote, 'w8c-s1-null-' || v_state || '.pdf',
                    case when v_state = 'file_name' then 'null' else quote_literal('x.pdf') end,
                    case when v_state = 'mime_type' then 'null' else quote_literal('application/pdf') end);
            exception when not_null_violation then v_inner := 'rejected';
            end;
            if v_inner <> 'rejected' then raise exception 'FAIL: a NULL % was accepted', v_state; end if;
        end;
    end loop;

    -- byte_size: NULL (legacy, never fabricated), 0 and positive accepted
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type, byte_size)
        values (v_cnote, 'w8c-s1-size-null.pdf', 'a.pdf', 'application/pdf', null);
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type, byte_size)
        values (v_cnote, 'w8c-s1-size-zero.pdf', 'b.pdf', 'application/pdf', 0);
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type, byte_size)
        values (v_cnote, 'w8c-s1-size-big.pdf', 'c.pdf', 'application/pdf', 52428800);

    v_state := 'accepted';
    begin
        insert into public.attachments (contact_note_id, storage_key, file_name, mime_type, byte_size)
            values (v_cnote, 'w8c-s1-size-negative.pdf', 'd.pdf', 'application/pdf', -1);
    exception when check_violation then v_state := 'rejected';
    end;
    if v_state <> 'rejected' then raise exception 'FAIL: a negative byte_size was accepted'; end if;
    raise notice 'OK  5. file metadata: file_name/mime_type non-empty NOT NULL, byte_size NULL/0/positive accepted, negative rejected';

    -- ---- 6. cascade: METADATA ROW only ------------------------------------
    -- Every deletion below removes attachment metadata. S1 has NO physical
    -- storage delete path, so no binary object is touched by any of it.
    delete from public.contact_notes where id = v_cnote;
    if exists (select 1 from public.attachments where contact_note_id = v_cnote) then
        raise exception 'FAIL: contact note deletion left attachment metadata behind';
    end if;
    delete from public.deal_notes where id = v_dnote;
    if exists (select 1 from public.attachments where deal_note_id = v_dnote) then
        raise exception 'FAIL: deal note deletion left attachment metadata behind';
    end if;

    -- contact -> contact_notes -> attachments
    insert into public.contact_notes (contact_id, text, date, sales_id)
        values (v_contact, 'Notiz 2', now(), v_sales) returning id into v_cnote;
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
        values (v_cnote, 'w8c-s1-cascade-contact.pdf', 'e.pdf', 'application/pdf');
    delete from public.contacts where id = v_contact;
    if exists (select 1 from public.attachments where storage_key = 'w8c-s1-cascade-contact.pdf') then
        raise exception 'FAIL: contact deletion did not cascade into attachment metadata';
    end if;

    -- deal -> deal_notes -> attachments
    insert into public.deal_notes (deal_id, text, date, sales_id)
        values (v_deal, 'Notiz 2', now(), v_sales) returning id into v_dnote;
    insert into public.attachments (deal_note_id, storage_key, file_name, mime_type)
        values (v_dnote, 'w8c-s1-cascade-deal.pdf', 'f.pdf', 'application/pdf');
    delete from public.deals where id = v_deal;
    if exists (select 1 from public.attachments where storage_key = 'w8c-s1-cascade-deal.pdf') then
        raise exception 'FAIL: deal deletion did not cascade into attachment metadata';
    end if;

    -- company -> contacts -> contact_notes -> attachments, and
    -- company -> deals -> deal_notes -> attachments (both edges exist today)
    insert into public.contacts (first_name, last_name, company_id, sales_id)
        values ('Kas', 'Kade', v_company, v_sales) returning id into v_contact;
    insert into public.contact_notes (contact_id, text, date, sales_id)
        values (v_contact, 'Notiz 3', now(), v_sales) returning id into v_cnote;
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
        values (v_cnote, 'w8c-s1-cascade-company-contact.pdf', 'g.pdf', 'application/pdf');
    insert into public.deals (name, company_id, stage, sales_id)
        values ('W8-C Vorgang 2', v_company, 'opportunity', v_sales) returning id into v_deal;
    insert into public.deal_notes (deal_id, text, date, sales_id)
        values (v_deal, 'Notiz 3', now(), v_sales) returning id into v_dnote;
    insert into public.attachments (deal_note_id, storage_key, file_name, mime_type)
        values (v_dnote, 'w8c-s1-cascade-company-deal.pdf', 'h.pdf', 'application/pdf');

    update public.companies set self_contact_id = null where id = v_company;
    delete from public.companies where id = v_company;
    select count(*) into v_n from public.attachments
        where storage_key in ('w8c-s1-cascade-company-contact.pdf', 'w8c-s1-cascade-company-deal.pdf');
    if v_n <> 0 then
        raise exception 'FAIL: company deletion did not cascade into attachment metadata (% row(s) left)', v_n;
    end if;
    raise notice 'OK  6. cascade removes attachment METADATA rows via contact_note / deal_note / contact / deal / company (no physical storage delete exists in S1)';

    raise exception 'ROLLBACK_W8C_S1_TEST';
exception
    when others then
        if sqlerrm = 'ROLLBACK_W8C_S1_TEST' then
            return;
        end if;
        raise;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Behavioural role matrix (real claims + live sessions, rolled back)
--
-- Expected per role:
--   admin  / office : SELECT yes, INSERT yes, DELETE yes, UPDATE denied
--   viewer          : SELECT yes, INSERT denied, DELETE 0 rows, UPDATE denied
--   disabled (valid JWT) : SELECT 0 rows, INSERT denied, DELETE 0 rows
--   office WITHOUT a live owned session : SELECT 0 rows, INSERT denied,
--                     DELETE 0 rows  (see the session-binding control below)
--   anon            : no capability at all (no privilege)
--
-- Two different denial shapes are asserted on purpose:
--   * UPDATE is denied by the missing table PRIVILEGE -> 42501 error
--   * a DELETE/SELECT a role may issue but no row passes RLS -> 0 rows, no error
--
-- The "no session" row exists because public.attachments is a NEW security
-- surface: it must be shown that its authorization really rides on
-- nora_private.jwt_session_is_live() and not merely on sales.role /
-- sales.disabled. That employee is active (disabled = false) and office, and
-- its JWT claims are structurally valid — only the auth.sessions row is
-- missing. The control block after the loop then gives exactly that user a
-- live owned session and shows it becomes fully capable, so the denial is
-- attributable to the session binding and to nothing else.
-- ---------------------------------------------------------------------------
do $$
declare
    v_admin    uuid := gen_random_uuid();
    v_office   uuid := gen_random_uuid();
    v_viewer   uuid := gen_random_uuid();
    v_disabled uuid := gen_random_uuid();
    v_nosess   uuid := gen_random_uuid();
    v_a bigint; v_o bigint; v_v bigint; v_d bigint; v_ns bigint;
    v_company bigint; v_contact bigint; v_cnote bigint;
    v_seed bigint;
    v_row record;
    v_n bigint;
    v_ok boolean;
    v_failures text[] := '{}';
begin
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values
      (v_admin,    '00000000-0000-0000-0000-000000000000','authenticated','authenticated','w8c-s1-admin@nora.test','x',now(),'{"provider":"email","providers":["email"]}','{"first_name":"Ada","last_name":"Admin"}',now(),now()),
      (v_office,   '00000000-0000-0000-0000-000000000000','authenticated','authenticated','w8c-s1-office@nora.test','x',now(),'{"provider":"email","providers":["email"]}','{"first_name":"Olaf","last_name":"Office"}',now(),now()),
      (v_viewer,   '00000000-0000-0000-0000-000000000000','authenticated','authenticated','w8c-s1-viewer@nora.test','x',now(),'{"provider":"email","providers":["email"]}','{"first_name":"Vera","last_name":"Viewer"}',now(),now()),
      (v_disabled, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','w8c-s1-disabled@nora.test','x',now(),'{"provider":"email","providers":["email"]}','{"first_name":"Dirk","last_name":"Disabled"}',now(),now()),
      (v_nosess,   '00000000-0000-0000-0000-000000000000','authenticated','authenticated','w8c-s1-nosession@nora.test','x',now(),'{"provider":"email","providers":["email"]}','{"first_name":"Nina","last_name":"Nosession"}',now(),now());

    select id into v_a from public.sales where user_id = v_admin;
    select id into v_o from public.sales where user_id = v_office;
    select id into v_v from public.sales where user_id = v_viewer;
    select id into v_d from public.sales where user_id = v_disabled;
    select id into v_ns from public.sales where user_id = v_nosess;
    perform nora_private.apply_sales_role_change(v_a, 'admin', false);
    perform nora_private.apply_sales_role_change(v_o, 'office', false);
    perform nora_private.apply_sales_role_change(v_v, 'viewer', false);
    perform nora_private.apply_sales_role_change(v_d, 'office', true);
    -- active office employee, exactly like v_office — the ONLY difference is
    -- that no auth.sessions row is created for it below (R-3).
    perform nora_private.apply_sales_role_change(v_ns, 'office', false);

    -- fixture session id = user id (suite convention, as in the W8-B suite).
    -- v_nosess deliberately gets NO session row: its JWT will name a session
    -- that does not exist, which is the W6-A "absent session" denial shape.
    insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
      (v_admin, v_admin, now(), now(), 'aal1'), (v_office, v_office, now(), now(), 'aal1'),
      (v_viewer, v_viewer, now(), now(), 'aal1'), (v_disabled, v_disabled, now(), now(), 'aal1');

    insert into public.companies (name, sales_id) values ('W8-C Matrix Kunde', v_o) returning id into v_company;
    insert into public.contacts (first_name, last_name, company_id, sales_id)
        values ('Mat', 'Rix', v_company, v_o) returning id into v_contact;
    insert into public.contact_notes (contact_id, text, date, sales_id)
        values (v_contact, 'Matrix', now(), v_o) returning id into v_cnote;

    for v_row in select * from (values
        ('anon',       null::uuid, 'anon',          false, false, false),
        ('disabled',   v_disabled, 'authenticated', false, false, false),
        ('no session', v_nosess,   'authenticated', false, false, false),
        ('viewer',   v_viewer,   'authenticated', true,  false, false),
        ('office',   v_office,   'authenticated', true,  true,  true),
        ('admin',    v_admin,    'authenticated', true,  true,  true)
    ) as t(label, uid, api_role, reads, writes, deletes) loop

        -- seeded as postgres so every role has a row it could see/delete
        insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
            values (v_cnote, 'w8c-s1-matrix-' || v_row.label || '.pdf', 'matrix.pdf', 'application/pdf')
            returning id into v_seed;

        perform set_config('request.jwt.claims',
            case when v_row.uid is null then json_build_object('role', 'anon')::text
                 else json_build_object('role', 'authenticated', 'sub', v_row.uid::text,
                                        'session_id', v_row.uid::text)::text end,
            true);
        if v_row.api_role = 'anon' then set local role anon; else set local role authenticated; end if;

        -- SELECT
        v_ok := true;
        begin
            select count(*) into v_n from public.attachments where id = v_seed;
            v_ok := (v_n = 1);
        exception when insufficient_privilege then v_ok := false;
        end;
        if v_ok <> v_row.reads then
            v_failures := v_failures || format('%s SELECT = %s (expected %s)', v_row.label, v_ok, v_row.reads);
        end if;

        -- INSERT
        v_ok := true;
        begin
            insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
                values (v_cnote, 'w8c-s1-insert-' || v_row.label || '.pdf', 'neu.pdf', 'application/pdf');
        exception when insufficient_privilege then v_ok := false;
        end;
        if v_ok <> v_row.writes then
            v_failures := v_failures || format('%s INSERT = %s (expected %s)', v_row.label, v_ok, v_row.writes);
        end if;

        -- UPDATE must be denied for every role: no privilege, no policy
        v_ok := true;
        begin
            update public.attachments set file_name = 'umbenannt.pdf' where id = v_seed;
            get diagnostics v_n = row_count;
            if v_n <> 0 then
                v_failures := v_failures || format('%s UPDATE changed %s row(s)', v_row.label, v_n);
            end if;
        exception when insufficient_privilege then v_ok := false;
        end;
        if v_ok then
            v_failures := v_failures || format('%s was not denied UPDATE by the table privilege', v_row.label);
        end if;

        -- DELETE
        v_ok := true;
        begin
            delete from public.attachments where id = v_seed;
            get diagnostics v_n = row_count;
            v_ok := (v_n = 1);
        exception when insufficient_privilege then v_ok := false;
        end;
        if v_ok <> v_row.deletes then
            v_failures := v_failures || format('%s DELETE = %s (expected %s)', v_row.label, v_ok, v_row.deletes);
        end if;

        reset role;
        delete from public.attachments where id = v_seed;
    end loop;

    -- ---- R-3 control: the SAME employee, now with a live owned session -----
    -- v_nosess was denied everything above. It is active, it is office, and its
    -- claims were structurally valid — so if giving it nothing but an
    -- auth.sessions row makes it fully capable, the denial can only have come
    -- from nora_private.jwt_session_is_live(). Without this control the "no
    -- session" row above would not prove WHICH gate denied it.
    insert into auth.sessions (id, user_id, created_at, updated_at, aal)
        values (v_nosess, v_nosess, now(), now(), 'aal1');
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
        values (v_cnote, 'w8c-s1-session-control.pdf', 'control.pdf', 'application/pdf')
        returning id into v_seed;

    perform set_config('request.jwt.claims',
        json_build_object('role', 'authenticated', 'sub', v_nosess::text,
                          'session_id', v_nosess::text)::text, true);
    set local role authenticated;

    select count(*) into v_n from public.attachments where id = v_seed;
    if v_n <> 1 then
        v_failures := array_append(v_failures,
            'session-binding control: office WITH a live session could not SELECT');
    end if;

    begin
        insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
            values (v_cnote, 'w8c-s1-session-control-insert.pdf', 'control2.pdf', 'application/pdf');
    exception when insufficient_privilege then
        v_failures := array_append(v_failures,
            'session-binding control: office WITH a live session was denied INSERT');
    end;

    delete from public.attachments where id = v_seed;
    get diagnostics v_n = row_count;
    if v_n <> 1 then
        v_failures := array_append(v_failures,
            'session-binding control: office WITH a live session could not DELETE');
    end if;

    reset role;

    perform set_config('request.jwt.claims', '', true);

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL: role matrix:\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  7. role matrix: admin/office read+insert+delete, viewer read-only, disabled JWT blind, active office WITHOUT a live session blind, anon without capability, UPDATE denied for all';
    raise notice 'OK  7b. session binding: the same active office employee is denied without an auth.sessions row and fully capable with one (jwt_session_is_live, not role/disabled)';

    raise exception 'ROLLBACK_W8C_S1_TEST';
exception
    when others then
        if sqlerrm = 'ROLLBACK_W8C_S1_TEST' then
            return;
        end if;
        raise;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Scope: S1 is metadata only
-- ---------------------------------------------------------------------------
do $$
declare
    v_failures text[] := '{}';
    v_extra    text;
begin
    if (select count(*) from public.attachments) <> 0 then
        v_failures := array_append(v_failures, 'public.attachments is not empty — S1 performs no backfill');
    end if;

    -- the legacy representation is untouched and still the live one
    if not exists (select 1 from pg_attribute a
                   where a.attrelid = 'public.contact_notes'::regclass and a.attname = 'attachments'
                     and not a.attisdropped)
       or not exists (select 1 from pg_attribute a
                      where a.attrelid = 'public.deal_notes'::regclass and a.attname = 'attachments'
                        and not a.attisdropped) then
        v_failures := array_append(v_failures, 'the legacy note attachment columns were changed by S1');
    end if;

    -- Deletion machinery: since W8-C S2A1 (20260917120000) exactly ONE trigger
    -- is expected here — the capture hook that writes a deletion INTENT into
    -- the private outbox. It is still true that S1 itself carries no deletion
    -- path; this assertion therefore no longer demands "no trigger", it demands
    -- "no trigger BEYOND the agreed capture hook". Anything else on this table
    -- is an unreviewed deletion path and must fail.
    select string_agg(t.tgname, ', ' order by t.tgname) into v_extra
    from pg_trigger t
    where t.tgrelid = 'public.attachments'::regclass and not t.tgisinternal
      and t.tgname <> 'enqueue_attachment_storage_deletion_after_delete_trigger';
    if v_extra is not null then
        v_failures := v_failures || format('unexpected trigger on public.attachments beyond the S2A1 capture hook: %s', v_extra);
    end if;

    -- The capture hook enqueues only. A CONSUMER (claim/ack/fail contract or a
    -- worker) is S2A2 and must NOT appear as a side effect of anything else.
    if exists (select 1 from pg_proc p
               join pg_namespace n on n.oid = p.pronamespace
               where p.proname ~ 'attachment.*(claim|ack|fail|drain|worker)'
                  or p.proname ~ '(claim|ack|fail|drain|worker).*attachment') then
        v_failures := array_append(v_failures, 'an attachment deletion consumer exists (S2A2 scope)');
    end if;

    -- S1 still performs no physical storage deletion, and the removed W8-B
    -- pg_net path stays removed.
    if to_regprocedure('public.cleanup_note_attachments()') is not null
       or to_regprocedure('public.get_note_attachments_function_url()') is not null then
        v_failures := array_append(v_failures, 'the removed W8-B pg_net delete path reappeared');
    end if;

    -- W8-B is untouched: still exactly its two storage policies, bucket public
    if (select count(*) from pg_policies p
        where p.schemaname = 'storage' and p.tablename = 'objects') <> 2 then
        v_failures := array_append(v_failures, 'the storage.objects policy set changed (W8-B must stay untouched)');
    end if;
    if not exists (select 1 from storage.buckets where id = 'attachments' and file_size_limit = 52428800
                     and cardinality(allowed_mime_types) = 9) then
        v_failures := array_append(v_failures, 'the attachments bucket controls changed (W8-B must stay untouched)');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL: scope:\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  8. metadata only: table empty, legacy note JSON untouched, only the S2A1 capture hook and no consumer, W8-B storage contract unchanged';
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. No leak
-- ---------------------------------------------------------------------------
do $$
begin
    if coalesce(current_setting('request.jwt.claims', true), '') <> ''
       or coalesce(current_setting('request.jwt.claim.sub', true), '') <> ''
       or coalesce(current_setting('request.jwt.claim.role', true), '') <> ''
       or coalesce(current_setting('request.jwt.claim.session_id', true), '') <> '' then
        raise exception 'FAIL: JWT context leaked out of the suite';
    end if;
    if current_user <> 'postgres' then
        raise exception 'FAIL: role leaked out of the suite (now %)', current_user;
    end if;
    if exists (select 1 from auth.users where email like 'w8c-s1-%@nora.test') then
        raise exception 'FAIL: fixtures survived the rollback';
    end if;
    raise notice 'OK  9. no GUC or role leak, fixtures rolled back';
end;
$$;

\echo '=== W8-C S1: all checks passed ==='
select 'attachment_foundation_verification: OK' as result;
