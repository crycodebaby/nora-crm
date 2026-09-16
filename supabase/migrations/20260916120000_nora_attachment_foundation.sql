-- Nora CRM: W8-C S1 Attachment Schema Foundation (2026-09-16)
--
-- The smallest additive slice of the attachment foundation: one new metadata
-- table `public.attachments` with its ownership invariant, its storage identity
-- invariant, RLS and an explicit privilege matrix.
--
-- WHAT THIS MIGRATION DOES NOT DO (deliberately, so a reviewer does not look
-- for it):
--   * no application wiring — after this migration NOTHING in src/** reads or
--     writes public.attachments; contact_notes.attachments / deal_notes.attachments
--     stay the only live attachment representation,
--   * no backfill — the table is EMPTY after the migration. Migrating the 31
--     legacy note attachments is a later slice (S4),
--   * no deletion queue, no trigger, no pg_net, no Edge Function, no worker (S2),
--   * no change to storage.objects, to the `attachments` bucket, its public
--     flag, its MIME allowlist or its file_size_limit — W8-B stays untouched,
--   * no uploaded_by / created_by column (P-2 deferred): an employee reference
--     would widen hard-delete semantics, lifecycle reference integrity and the
--     deletion preview for no current product requirement. Additive later.
--
-- OWNERSHIP MODEL
-- ---------------
-- One attachment belongs to exactly ONE note — a contact note or a deal note,
-- never both, never neither (`attachments_owner_check`). The two foreign keys
-- are ON DELETE CASCADE.
--
--   CASCADE here removes the attachment METADATA ROW and nothing else.
--   S1 has no physical storage delete path at all. A deleted note still
--   leaves its binary object in the bucket (accepted limitation since W8-B,
--   17-known-issues H). Never describe this cascade as "the file is deleted".
--   S2 builds the physical deletion on top of this row delete.
--
-- STORAGE IDENTITY
-- ----------------
-- `storage_key` is the durable, provider-neutral object identity: no src, no
-- public URL, no signed URL, no hostname, no bucket, no provider name is
-- persisted here. The column carries a UNIQUE constraint — one storage object
-- has exactly one attachment identity. That is supported by the P-1 Production
-- census (2026-09-16): 31 legacy note attachments, 31 resolvable and 31
-- DISTINCT storage keys, 0 duplicates, 0 path/src conflicts, 0 unresolvable
-- elements, 31/31 with a non-empty MIME type. The same census is why
-- `mime_type` can be NOT NULL.
-- No format constraint is placed on storage_key: today's keys are flat
-- (`0.<digits>` legacy, `<uuid>.<ext>` since W8-B), but the invariant is
-- identity, not today's layout — W8-E may choose a different key layout.
--
-- MIME
-- ----
-- `mime_type` records what was DECLARED at upload time. It is not a content
-- check: no magic-byte verification, no virus scan, no content sniffing
-- happens anywhere in Nora. The upload allowlist (nine types) belongs to the
-- bucket policy (W8-B, 22-security-and-access.md 6.5) and is deliberately NOT
-- duplicated as an entity invariant here.
--
-- ACCESS MODEL (RLS + grants, both gates)
-- ---------------------------------------
--   SELECT  nora_private.is_active_user()   (any active employee, live session)
--   INSERT  nora_private.can_write()        (office/admin)
--   DELETE  nora_private.can_write()        (office/admin)  <- see note below
--   UPDATE  no policy, no privilege         (attachment metadata is immutable)
--
-- DELETE = can_write() is INTENTIONAL and is NOT privilege widening. Today an
-- office user can already remove an attachment from a note by UPDATE-ing the
-- note's `attachments` array (note UPDATE is can_write()). Deleting the
-- attachment row is the modelled equivalent of exactly that existing
-- capability. Office still may NOT delete the note itself (note DELETE stays
-- is_admin()). Do not "correct" this to is_admin() without re-reading this
-- paragraph.

-- ---------------------------------------------------------------------------
-- 0. Preconditions (fail-closed)
--
-- Requires a runner that stops at the first error (supabase db push /
-- apply_migration; psql only with -v ON_ERROR_STOP=1).
-- ---------------------------------------------------------------------------
do $$
declare
    v_missing text;
begin
    -- The privilege contract of this migration is grantor specific: schema
    -- public's default privileges are hardened for creator `postgres`
    -- (20260907120000), and every relation in public must be owned by postgres
    -- (22-security-and-access.md 6.3 — a security assumption, not a formality).
    if current_user <> 'postgres' then
        raise exception 'NORA_ATTACHMENT_FOUNDATION: expected migration creator postgres, got %', current_user
            using errcode = '42501';
    end if;

    if to_regclass('public.attachments') is not null then
        raise exception 'NORA_ATTACHMENT_FOUNDATION: public.attachments already exists'
            using errcode = '42P07',
                  hint = 'This migration is additive and creates the table once. Investigate where the existing object came from instead of re-running it.';
    end if;

    -- Owner tables must exist with the expected key type; the FKs below depend
    -- on both notes tables carrying a bigint primary key.
    select string_agg(t.expected, ', ')
      into v_missing
    from (values ('public.contact_notes'), ('public.deal_notes')) t(expected)
    where to_regclass(t.expected) is null;

    if v_missing is not null then
        raise exception 'NORA_ATTACHMENT_FOUNDATION: missing owner tables: %', v_missing
            using errcode = 'P0002';
    end if;

    select string_agg(format('%s.%s is %s', x.tbl, x.col, x.typ), ', ')
      into v_missing
    from (
        select c.relname::text as tbl, a.attname::text as col, format_type(a.atttypid, a.atttypmod) as typ
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid and a.attname = 'id'
        where n.nspname = 'public' and c.relname in ('contact_notes', 'deal_notes')
    ) x
    where x.typ <> 'bigint';

    if v_missing is not null then
        raise exception 'NORA_ATTACHMENT_FOUNDATION: unexpected note id type: %', v_missing
            using errcode = '42804';
    end if;

    -- Both note tables must have a primary key on id (FK target requirement).
    if (select count(*)
        from pg_constraint con
        join pg_class c on c.oid = con.conrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname in ('contact_notes', 'deal_notes')
          and con.contype = 'p'
          and con.conkey = array[(select a.attnum from pg_attribute a
                                  where a.attrelid = c.oid and a.attname = 'id')]) <> 2 then
        raise exception 'NORA_ATTACHMENT_FOUNDATION: contact_notes/deal_notes do not both carry a primary key on id'
            using errcode = '42704';
    end if;

    -- The canonical authorization helpers are consumed, never duplicated.
    if to_regprocedure('nora_private.is_active_user()') is null
       or to_regprocedure('nora_private.can_write()') is null then
        raise exception 'NORA_ATTACHMENT_FOUNDATION: nora_private.is_active_user() / can_write() missing'
            using errcode = '42883';
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
create table public.attachments (
    id bigint generated by default as identity primary key,
    contact_note_id bigint,
    deal_note_id bigint,
    storage_key text not null,
    file_name text not null,
    mime_type text not null,
    byte_size bigint,
    created_at timestamp with time zone not null default now(),

    -- exactly one owner: never both, never neither
    constraint attachments_owner_check
        check (num_nonnulls(contact_note_id, deal_note_id) = 1),

    constraint attachments_storage_key_check
        check (btrim(storage_key) <> '' and char_length(storage_key) <= 512),

    constraint attachments_file_name_check
        check (btrim(file_name) <> '' and char_length(file_name) <= 255),

    constraint attachments_mime_type_check
        check (btrim(mime_type) <> '' and char_length(mime_type) <= 255),

    -- nullable on purpose: legacy metadata carries no authoritative size, and
    -- no size is ever fabricated. The 50 MiB bucket limit is a bucket policy
    -- (W8-B), not an entity invariant.
    constraint attachments_byte_size_check
        check (byte_size is null or byte_size >= 0)
);

-- One storage object = one attachment identity. P-1 proved 31/31 distinct keys
-- in Production, so this holds for the later S4 legacy migration as well.
create unique index uq__attachments__storage_key
    on public.attachments using btree (storage_key);

create index attachments_contact_note_id_idx
    on public.attachments using btree (contact_note_id);

create index attachments_deal_note_id_idx
    on public.attachments using btree (deal_note_id);

-- Foreign keys: same delete semantics as the existing note -> parent edges.
-- CASCADE removes the METADATA ROW only (no physical storage delete in S1).
alter table public.attachments
    add constraint attachments_contact_note_id_fkey
    foreign key (contact_note_id) references public.contact_notes(id)
    on update cascade on delete cascade;

alter table public.attachments
    add constraint attachments_deal_note_id_fkey
    foreign key (deal_note_id) references public.deal_notes(id)
    on update cascade on delete cascade;

comment on table public.attachments is
    'W8-C S1 (2026-09-16): provider-neutral attachment metadata. Exactly one owner note (contact note XOR deal note). Rows are conceptually immutable — replace or remove, never mutate (no updated_at, no UPDATE policy, no UPDATE privilege). Deleting a row (directly or by cascade) removes METADATA ONLY; S1 has no physical storage delete path, so binary objects stay in the bucket (accepted limitation since W8-B). Not wired into the application yet and empty after the migration: the legacy JSON arrays contact_notes.attachments / deal_notes.attachments remain the live representation until later slices.';

comment on column public.attachments.contact_note_id is
    'Owner contact note. Exactly one of contact_note_id / deal_note_id is set (attachments_owner_check).';
comment on column public.attachments.deal_note_id is
    'Owner deal note. Exactly one of contact_note_id / deal_note_id is set (attachments_owner_check).';
comment on column public.attachments.storage_key is
    'Durable, provider-neutral storage object identity — never a src, public URL, signed URL, hostname, bucket or provider name. UNIQUE: one storage object has one attachment identity. No format constraint on purpose: legacy keys are flat "0.<digits>", current ones "<uuid>.<ext>", and W8-E may choose another layout.';
comment on column public.attachments.file_name is
    'Human-facing original display name. Never the storage identity and never a storage path; storage_key is never derived from it.';
comment on column public.attachments.mime_type is
    'MIME type DECLARED at upload time. No content, magic-byte or malware verification takes place. The upload allowlist lives in the bucket policy (W8-B), not here.';
comment on column public.attachments.byte_size is
    'Optional size in bytes; NULL for metadata without an authoritative size (legacy). Never fabricated, never negative.';

-- ---------------------------------------------------------------------------
-- 2. RLS
--
-- SELECT = is_active_user(), INSERT = can_write(), DELETE = can_write(),
-- no UPDATE policy and no ALL policy.
--
-- On DELETE = can_write(): office already removes an attachment reference today
-- by UPDATE-ing the note's attachments array (note UPDATE is can_write()).
-- This is the modelled equivalent of that existing capability, NOT privilege
-- widening: office still cannot delete the note itself (note DELETE is
-- is_admin()).
-- ---------------------------------------------------------------------------
alter table public.attachments enable row level security;

create policy "attachments_select_active_user"
    on public.attachments
    for select
    to authenticated
    using (nora_private.is_active_user());

create policy "attachments_insert_writer"
    on public.attachments
    for insert
    to authenticated
    with check (nora_private.can_write());

create policy "attachments_delete_writer"
    on public.attachments
    for delete
    to authenticated
    using (nora_private.can_write());

-- ---------------------------------------------------------------------------
-- 3. Grants
--
-- RLS policy and SQL privilege are two separate gates; both are set explicitly.
-- `revoke all` first (03-data-model-guardrails.md, Migrationsregel), even though
-- the hardened default privileges of schema public (20260907120000) already hand
-- a new table nothing.
--
-- `authenticated` gets exactly what its policies express: SELECT, INSERT,
-- DELETE — no UPDATE. `anon` gets nothing. `service_role` gets nothing: there is
-- no traced, deployed backend caller for attachment metadata (a new service_role
-- write path needs its own justification, target matrix entry and assertion).
-- No MAINTAIN is ever named in DDL (PG15 local / PG17 Production).
-- ---------------------------------------------------------------------------
revoke all on table public.attachments from anon, authenticated, service_role;
grant select, insert, delete on table public.attachments to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Postconditions (fail-closed)
-- ---------------------------------------------------------------------------
do $$
declare
    r          record;
    v_priv     text;
    v_role     text;
    v_expected boolean;
    v_actual   boolean;
    v_failures text[] := '{}';
    v_policies text;
    v_dangerous text[] := case when current_setting('server_version_num')::int >= 170000
                               then array['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']
                               else array['TRUNCATE','REFERENCES','TRIGGER']
                          end;
begin
    -- 4a. table shape
    if to_regclass('public.attachments') is null then
        raise exception 'NORA_ATTACHMENT_FOUNDATION aborted: public.attachments was not created';
    end if;

    if pg_get_userbyid((select relowner from pg_class where oid = 'public.attachments'::regclass)) <> 'postgres' then
        v_failures := array_append(v_failures, 'public.attachments is not owned by postgres');
    end if;

    for r in
        select * from (values
            ('id',              'bigint',                     false),
            ('contact_note_id', 'bigint',                     true),
            ('deal_note_id',    'bigint',                     true),
            ('storage_key',     'text',                       false),
            ('file_name',       'text',                       false),
            ('mime_type',       'text',                       false),
            ('byte_size',       'bigint',                     true),
            ('created_at',      'timestamp with time zone',   false)
        ) as t(col, typ, nullable)
    loop
        if not exists (
            select 1 from pg_attribute a
            where a.attrelid = 'public.attachments'::regclass
              and a.attname = r.col and a.attnum > 0 and not a.attisdropped
              and format_type(a.atttypid, a.atttypmod) = r.typ
              and a.attnotnull = (not r.nullable::boolean)
        ) then
            v_failures := v_failures || format('column %s is not %s %s', r.col, r.typ,
                case when r.nullable::boolean then 'NULL' else 'NOT NULL' end);
        end if;
    end loop;

    -- no column beyond the agreed S1 contract (no uploaded_by, no lifecycle fields)
    select string_agg(a.attname, ', ' order by a.attname) into v_policies
    from pg_attribute a
    where a.attrelid = 'public.attachments'::regclass and a.attnum > 0 and not a.attisdropped
      and a.attname not in ('id','contact_note_id','deal_note_id','storage_key','file_name',
                            'mime_type','byte_size','created_at');
    if v_policies is not null then
        v_failures := v_failures || format('unexpected columns on public.attachments: %s', v_policies);
    end if;

    if not exists (select 1 from pg_attrdef d
                   join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
                   where d.adrelid = 'public.attachments'::regclass and a.attname = 'created_at'
                     and pg_get_expr(d.adbin, d.adrelid) like 'now()%') then
        v_failures := array_append(v_failures, 'created_at has no now() default');
    end if;

    -- 4b. constraints
    for r in
        select * from (values
            ('attachments_owner_check',        'c'),
            ('attachments_storage_key_check',  'c'),
            ('attachments_file_name_check',    'c'),
            ('attachments_mime_type_check',    'c'),
            ('attachments_byte_size_check',    'c'),
            ('attachments_contact_note_id_fkey', 'f'),
            ('attachments_deal_note_id_fkey',    'f')
        ) as t(conname, contype)
    loop
        if not exists (select 1 from pg_constraint con
                       where con.conrelid = 'public.attachments'::regclass
                         and con.conname = r.conname and con.contype = r.contype::"char") then
            v_failures := v_failures || format('missing constraint %s (%s)', r.conname, r.contype);
        end if;
    end loop;

    if (select count(*) from pg_constraint con
        where con.conrelid = 'public.attachments'::regclass and con.contype = 'f'
          and con.confdeltype = 'c') <> 2 then
        v_failures := array_append(v_failures, 'both note foreign keys must be ON DELETE CASCADE');
    end if;

    if not exists (select 1 from pg_index i
                   join pg_class c on c.oid = i.indexrelid
                   where i.indrelid = 'public.attachments'::regclass
                     and i.indisunique
                     and c.relname = 'uq__attachments__storage_key') then
        v_failures := array_append(v_failures, 'missing UNIQUE index on storage_key');
    end if;

    -- 4c. RLS: enabled, exactly three policies, no UPDATE and no ALL policy
    if not (select c.relrowsecurity from pg_class c where c.oid = 'public.attachments'::regclass) then
        v_failures := array_append(v_failures, 'row level security is not enabled on public.attachments');
    end if;

    select string_agg(format('%s (%s)', p.policyname, p.cmd), ', ' order by p.policyname)
      into v_policies
    from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'attachments'
      and (p.policyname, p.cmd) not in (('attachments_select_active_user', 'SELECT'),
                                        ('attachments_insert_writer', 'INSERT'),
                                        ('attachments_delete_writer', 'DELETE'));
    if v_policies is not null then
        v_failures := v_failures || format('unexpected policies on public.attachments: %s', v_policies);
    end if;

    if (select count(*) from pg_policies p
        where p.schemaname = 'public' and p.tablename = 'attachments'
          and p.permissive = 'PERMISSIVE'
          and p.roles = array['authenticated']::name[]) <> 3 then
        v_failures := array_append(v_failures, 'the three attachment policies were not installed as expected');
    end if;

    -- 4d. privileges: both gates, exactly
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

    -- 4e. the table must be empty: S1 performs no backfill
    if (select count(*) from public.attachments) <> 0 then
        v_failures := array_append(v_failures, 'public.attachments is not empty (S1 performs no backfill)');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'NORA_ATTACHMENT_FOUNDATION aborted:\n%', array_to_string(v_failures, E'\n');
    end if;

    raise notice 'NORA_ATTACHMENT_FOUNDATION: public.attachments created, RLS + privilege matrix verified (pg %)',
        current_setting('server_version_num');
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. PostgREST schema cache
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';
