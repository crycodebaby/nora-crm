-- Nora CRM: W8-C S2A2.1 Central Attachment Liveness Resolver Foundation (2026-09-18)
--
-- Answers ONE question, read-only, inside the database:
--
--   "Is this storage key still referenced by any registered Nora surface?"
--
--   nora_private.attachment_storage_key_liveness(p_storage_key) -> 'live' | 'dead' | 'unknown'
--
-- plus two pure classification helpers and the queue vocabulary state
-- 'skipped_live'. That is the entire capability.
--
-- WHAT THIS MIGRATION DOES NOT DO (deliberately, so a reviewer does not look
-- for it):
--   * no claim / lease / stale-lease recovery / ack / fail / retry scheduling,
--     no attempt_count behaviour, no service_role RPC surface (S2A2.2),
--   * no queue consumer, no worker, no cron, no Edge Function, no HTTP, no
--     pg_net, no Storage API call, no network action of any kind,
--   * no physical storage deletion and no orphan cleanup — not one byte in the
--     bucket is touched, now or as a deferred effect,
--   * no queue row is written or transitioned. 'skipped_live' is VOCABULARY
--     ONLY; nothing in this migration (or anywhere yet) produces it,
--   * no dual-write, no S3 write guard, no backfill, no read switch, no legacy
--     write retirement, no bucket cutover, no signed URLs (S3 / S2B / W8-E),
--   * no new grant for any API role on any table, and no new index.
--
-- THE RESULT IS AN OBSERVATION, NEVER A PERMISSION
-- -----------------------------------------------
-- The resolver reports what one statement snapshot shows. 'dead' means "no
-- registered surface referenced the key when this statement looked"; it is NOT
-- a deletion authorization. A consumer (S2A2.2) must still serialize against
-- concurrent re-referencing before it acts on it.
--
-- TRI-STATE, FAIL-CLOSED
-- ----------------------
--   live     at least one registered surface PROVES the key is referenced.
--            LIVE dominates UNKNOWN.
--   dead     every registered surface was inspected, none proves the key live,
--            and no semantic ambiguity was met.
--   unknown  no live proof, but at least one registered value could not be
--            classified safely (malformed / unexpected shape, a
--            bucket-looking URL outside the canonical form, a canonical URL on
--            a non-allowlisted origin carrying this key, or an unregistered
--            storage-looking value in the configuration residue).
--
-- Execution failures are NOT 'unknown'. There is deliberately no
-- `exception when others` anywhere: schema drift, a missing object or a coding
-- bug raises and aborts the caller. An error is never a verdict.
--
-- REFERENCE REGISTRY v1 (hard-coded on purpose — no registry table, no dynamic
-- SQL; a new reference-bearing column must be added here explicitly and is
-- caught by the catalog completeness guard of the verification suite)
-- ------------------------------------------------------------------------
--   S1   public.attachments.storage_key            exact equality
--   S2   public.contact_notes.attachments (jsonb[]) unnest -> file-value helper
--   S3   public.deal_notes.attachments    (jsonb[]) unnest -> file-value helper
--   S4   public.companies.logo                      file-value helper
--   S5   public.configuration.config ->> lightModeLogo / darkModeLogo
--        JSON string -> URL helper (URL-ONLY branding logos exist in
--        Production and carry no `path`), object -> file-value helper
--   S5r  residual configuration (config minus those two keys): any
--        storage-looking value there (storage URL marker, attachments/
--        path segment) or the candidate key verbatim is an unregistered
--        reference -> unknown (tripwire only, never live)
--   S6   public.contacts.avatar                     file-value helper
--   S7   public.sales.avatar                        file-value helper
--
-- EXCLUDED on purpose: audit_events.old_data / new_data / metadata (historical
-- evidence never keeps bytes alive), idempotency_records.result,
-- operation_errors.technical_context,
-- sales_account_deletion_tickets.eligibility_snapshot, free-text and user-link
-- fields, auth-owned data, and storage.objects itself (liveness is about
-- REFERENCES, not about whether an object exists in the bucket).

-- ---------------------------------------------------------------------------
-- 0. Preconditions (fail-closed)
--
-- Requires a runner that stops at the first error (supabase db push /
-- apply_migration; psql only with -v ON_ERROR_STOP=1).
-- ---------------------------------------------------------------------------
do $$
declare
    r            record;
    v_failures   text[] := '{}';
    v_cols       text[];
    v_literals   text[];
    v_def        text;
    v_bypass     boolean;
begin
    -- Every function Nora creates must be owned by postgres
    -- (22-security-and-access.md 6.3); the definer's visibility depends on it.
    if current_user <> 'postgres' then
        raise exception 'NORA_ATTACHMENT_LIVENESS_RESOLVER: expected migration creator postgres, got %', current_user
            using errcode = '42501';
    end if;

    if to_regnamespace('nora_private') is null then
        raise exception 'NORA_ATTACHMENT_LIVENESS_RESOLVER: schema nora_private is missing'
            using errcode = '3F000';
    end if;

    if to_regclass('public.attachments') is null then
        raise exception 'NORA_ATTACHMENT_LIVENESS_RESOLVER: public.attachments is missing (W8-C S1 not applied)'
            using errcode = 'P0002';
    end if;

    if to_regclass('nora_private.attachment_storage_deletion_queue') is null then
        raise exception 'NORA_ATTACHMENT_LIVENESS_RESOLVER: the deletion queue is missing (W8-C S2A1 not applied)'
            using errcode = 'P0002';
    end if;

    if to_regprocedure('nora_private.enqueue_attachment_storage_deletion()') is null then
        raise exception 'NORA_ATTACHMENT_LIVENESS_RESOLVER: the S2A1 capture function is missing'
            using errcode = 'P0002';
    end if;

    -- The new functions are created exactly once.
    if exists (select 1 from pg_proc p
               join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'nora_private'
                 and p.proname in ('attachment_storage_key_liveness',
                                   'attachment_url_liveness',
                                   'attachment_file_value_liveness')) then
        raise exception 'NORA_ATTACHMENT_LIVENESS_RESOLVER: a liveness function already exists in nora_private'
            using errcode = '42723',
                  hint = 'This migration is additive and creates the resolver once. Investigate where the existing object came from instead of re-running it.';
    end if;

    -- Every registered surface must still have the shape the resolver reads.
    -- A different type would not fail loudly everywhere (a text column would
    -- happily compare), so the contract is pinned here.
    for r in
        select * from (values
            ('public.attachments',    'storage_key', 'text'),
            ('public.contact_notes',  'attachments', 'jsonb[]'),
            ('public.deal_notes',     'attachments', 'jsonb[]'),
            ('public.companies',      'logo',        'jsonb'),
            ('public.configuration',  'config',      'jsonb'),
            ('public.contacts',       'avatar',      'jsonb'),
            ('public.sales',          'avatar',      'jsonb')
        ) as t(rel, col, typ)
    loop
        if to_regclass(r.rel) is null
           or not exists (select 1 from pg_attribute a
                          where a.attrelid = to_regclass(r.rel)
                            and a.attname = r.col and a.attnum > 0 and not a.attisdropped
                            and format_type(a.atttypid, a.atttypmod) = r.typ) then
            v_failures := v_failures || format('registered surface %s.%s is missing or not %s', r.rel, r.col, r.typ);
        end if;
    end loop;

    -- The SECURITY DEFINER resolver must see EVERY row of every registered
    -- table, independent of RLS; a resolver that sees fewer rows reports a
    -- false 'dead'. postgres sees all rows if it bypasses RLS, or if it owns
    -- the table and the table does not FORCE row level security.
    select coalesce(bool_or(rolsuper or rolbypassrls), false) into v_bypass
    from pg_roles where rolname = 'postgres';

    if not v_bypass then
        for r in
            select c.oid::regclass::text as rel, pg_get_userbyid(c.relowner) as owner, c.relforcerowsecurity as forced
            from pg_class c
            where c.oid in ('public.attachments'::regclass, 'public.contact_notes'::regclass,
                            'public.deal_notes'::regclass, 'public.companies'::regclass,
                            'public.configuration'::regclass, 'public.contacts'::regclass,
                            'public.sales'::regclass)
        loop
            if r.owner <> 'postgres' or r.forced then
                v_failures := v_failures || format(
                    'postgres cannot see every row of %s (owner %s, force rls %s, no BYPASSRLS)',
                    r.rel, r.owner, r.forced);
            end if;
        end loop;
    end if;

    -- The two constraints being replaced must be exactly the S2A1 ones.
    -- Compared semantically (columns + state literals), not as deparsed text,
    -- so the check does not depend on the server version's deparse format.
    select pg_get_constraintdef(con.oid),
           (select array_agg(a.attname::text order by a.attname)
              from unnest(con.conkey) k join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k),
           (select array_agg(m[1] order by m[1])
              from regexp_matches(pg_get_constraintdef(con.oid), '''([a-z_]+)''::text', 'g') as m)
      into v_def, v_cols, v_literals
    from pg_constraint con
    where con.conrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
      and con.conname = 'attachment_storage_deletion_queue_state_check'
      and con.contype = 'c';

    if v_def is null
       or v_cols is distinct from array['state']
       or v_literals is distinct from array['claimed','done','failed_retryable','failed_terminal','pending']
       or position(' = ANY ' in v_def) = 0 then
        v_failures := v_failures || format('state_check is not the S2A1 definition: %s', coalesce(v_def, '<missing>'));
    end if;

    v_def := null; v_cols := null; v_literals := null;
    select pg_get_constraintdef(con.oid),
           (select array_agg(a.attname::text order by a.attname)
              from unnest(con.conkey) k join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k),
           (select array_agg(m[1] order by m[1])
              from regexp_matches(pg_get_constraintdef(con.oid), '''([a-z_]+)''::text', 'g') as m)
      into v_def, v_cols, v_literals
    from pg_constraint con
    where con.conrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
      and con.conname = 'attachment_storage_deletion_queue_completed_check'
      and con.contype = 'c';

    if v_def is null
       or v_cols is distinct from array['completed_at','state']
       or v_literals is distinct from array['done','failed_terminal']
       or position('completed_at IS NOT NULL' in v_def) = 0 then
        v_failures := v_failures || format('completed_check is not the S2A1 definition: %s', coalesce(v_def, '<missing>'));
    end if;

    if pg_get_userbyid((select relowner from pg_class
                        where oid = 'nora_private.attachment_storage_deletion_queue'::regclass)) <> 'postgres' then
        v_failures := array_append(v_failures, 'the queue is not owned by postgres');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'NORA_ATTACHMENT_LIVENESS_RESOLVER: precondition failed:\n%', array_to_string(v_failures, E'\n')
            using errcode = '55000';
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Queue vocabulary: 'skipped_live'
--
-- Terminal state: the deletion intent was withdrawn because the key was
-- observed LIVE under the liveness contract in force at that moment. It is NOT
-- "object deleted", NOT "object permanently safe from future orphaning", NOT
-- "S3 complete" and NOT a deletion authorization.
--
-- Vocabulary only: S2A2.1 transitions no row to it. Both constraints are
-- replaced under their SAME names. The partial index predicates are NOT
-- touched: the active unique index still covers pending/claimed/
-- failed_retryable only, and the due index pending/failed_retryable only, so a
-- skipped_live row never blocks a later active job for the same key and is
-- never due. claim_check / error_check / storage_key_check / attempt_count_check
-- are unchanged.
-- ---------------------------------------------------------------------------
alter table nora_private.attachment_storage_deletion_queue
    drop constraint attachment_storage_deletion_queue_state_check,
    add constraint attachment_storage_deletion_queue_state_check
        check (state in ('pending', 'claimed', 'failed_retryable', 'done', 'failed_terminal', 'skipped_live')),
    drop constraint attachment_storage_deletion_queue_completed_check,
    add constraint attachment_storage_deletion_queue_completed_check
        check ((state in ('done', 'failed_terminal', 'skipped_live')) = (completed_at is not null));

comment on table nora_private.attachment_storage_deletion_queue is
    'W8-C S2A1 (2026-09-17): durable capture of the intent to delete a storage object, written by the AFTER DELETE trigger on public.attachments. A row here is an INTENT, never a permission: nothing may delete an object before a consumer has proven the key is referenced nowhere (legacy note JSON arrays, company logos and the URL-only branding logos included). No direct grants for any API role - not reachable through PostgREST. W8-C S2A2.1 (2026-09-18) adds the read-only liveness resolver nora_private.attachment_storage_key_liveness(text) and the terminal vocabulary state skipped_live; there is still no consumer: no claim/ack/fail contract, no worker, no Storage call.';

comment on column nora_private.attachment_storage_deletion_queue.state is
    'pending | claimed | failed_retryable | done | failed_terminal | skipped_live. pending, claimed and failed_retryable are ACTIVE and carry the partial unique invariant on storage_key; done, failed_terminal and skipped_live are TERMINAL. skipped_live = the deletion intent was terminally withdrawn because the key was observed LIVE under the liveness contract in force at that moment - it is NOT a physical deletion, NOT a permanent guarantee against future orphaning and NOT a deletion authorization. S2A1 only ever produces pending; nothing produces skipped_live yet (S2A2.1 adds the vocabulary only).';

comment on column nora_private.attachment_storage_deletion_queue.completed_at is
    'Set exactly when the job reaches a terminal state (done / failed_terminal / skipped_live). skipped_live is terminal but records a WITHDRAWN intent, not a deletion. Terminal rows are RETAINED, never auto-purged: a queue that deletes its own evidence cannot be audited.';

-- ---------------------------------------------------------------------------
-- 2. URL helper
--
-- Classifies ONE URL against ONE candidate key: 'live' | 'none' | 'unknown'.
-- Reads no table. The parser may PROVE liveness; it never nominates an object
-- for deletion — 'none' only means "this value does not reference the key".
--
-- Canonical form (and the ONLY form that can prove 'live'):
--   ^(https?://[^/?#\s]+)/storage/v1/object/public/attachments/([A-Za-z0-9._-]{1,512})$
--   key not '.' / '..'
-- No normalization, no percent-decoding, no trimming, no case folding.
--
-- Origin allowlist v1 (exact string match, nothing speculative):
--   https://kixxroxtfzbcbzctohex.supabase.co   Production project
--   http://127.0.0.1:54321                     local Supabase stack
--
-- STABLE (not IMMUTABLE) on purpose: no index or generated column may ever
-- depend on this classification, which is a contract that will evolve.
-- ---------------------------------------------------------------------------
create function nora_private.attachment_url_liveness(p_url text, p_storage_key text)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
    v_match text[];
    v_lower text;
begin
    -- nothing there, or an inline / in-browser object: never a bucket reference
    if p_url is null or btrim(p_url) = '' then
        return 'none';
    end if;

    v_lower := lower(p_url);
    if left(v_lower, 5) in ('data:', 'blob:') then
        return 'none';
    end if;

    -- The canonical public-bucket URL. PostgreSQL regex bounds stop at 255,
    -- so the 512-character key limit is checked separately.
    v_match := regexp_match(p_url,
        '^(https?://[^/?#\s]+)/storage/v1/object/public/attachments/([A-Za-z0-9._-]+)$');
    if v_match is not null
       and char_length(v_match[2]) <= 512
       and v_match[2] not in ('.', '..') then
        if v_match[2] is distinct from p_storage_key then
            return 'none';
        end if;
        if v_match[1] in ('https://kixxroxtfzbcbzctohex.supabase.co', 'http://127.0.0.1:54321') then
            return 'live';
        end if;
        -- same key, canonical shape, but an origin this contract does not
        -- know: cannot prove live, must not claim dead
        return 'unknown';
    end if;

    -- Not canonical. Anything that still LOOKS like a storage reference is
    -- fail-closed: sign/, authenticated/, render/image/, query, fragment,
    -- percent-encoding, duplicate or embedded slashes, empty key, '..',
    -- relative form, padding, case mutation.
    if v_lower ~ 'storage(/|%2f)+v1'
       or (position('attachments' in v_lower) > 0 and v_lower ~ '(^|/|%2f)object(/|%2f)') then
        -- a storage URL that names no attachments bucket in any spelling and
        -- carries no encoding is clearly a different bucket
        if position('attachments' in v_lower) = 0 and position('%' in v_lower) = 0 then
            return 'none';
        end if;
        return 'unknown';
    end if;

    -- an ordinary foreign URL (favicon service, website, ...)
    return 'none';
end;
$$;

alter function nora_private.attachment_url_liveness(text, text) owner to postgres;

comment on function nora_private.attachment_url_liveness(text, text) is
    'W8-C S2A2.1: classifies one URL against one candidate storage key -> live | none | unknown. Only the canonical public attachments URL on an allowlisted origin (Production project, local stack) can prove live; the same canonical URL on another origin carrying the key is unknown; any other storage-looking attachments value (sign/authenticated/render paths, query, fragment, percent-encoding, extra slashes, padding, relative form) is unknown; data:, blob:, blank and ordinary foreign URLs are none. Reads no table. Never nominates an object for deletion.';

revoke all on function nora_private.attachment_url_liveness(text, text) from public;
revoke all on function nora_private.attachment_url_liveness(text, text) from anon;
revoke all on function nora_private.attachment_url_liveness(text, text) from authenticated;
revoke all on function nora_private.attachment_url_liveness(text, text) from service_role;

-- ---------------------------------------------------------------------------
-- 3. File-value helper (RAFile-like object: { path?, src?, ... })
--
--   path ABSENT     field absent, JSON null, or blank string
--   path USABLE     JSON string, non-blank, <= 512 chars, already trimmed,
--                   no '://', not starting with '/'
--   path MALFORMED  anything else
--   src             absent / JSON null -> none; string -> URL helper;
--                   any other JSON type -> unknown
--
--   USABLE    path = key -> live; otherwise the src verdict decides
--             (a local src naming a SECOND key keeps that key live too —
--             the value references both, neither is silently dropped;
--             a foreign-origin or malformed src -> unknown)
--   ABSENT    src fallback
--   MALFORMED a src proving the key live -> live; otherwise unknown
--   {}        none
--   SQL NULL / JSON null   none (no file reference at all)
--   any other non-object JSON (string, number, boolean, array) -> unknown
-- ---------------------------------------------------------------------------
create function nora_private.attachment_file_value_liveness(p_value jsonb, p_storage_key text)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
    v_path       jsonb;
    v_path_text  text;
    v_path_state text;
    v_src        jsonb;
    v_src_state  text;
begin
    -- SQL NULL and JSON null both mean "no file reference": the same
    -- absence semantics as a JSON-null path / src / branding key.
    if p_value is null or jsonb_typeof(p_value) = 'null' then
        return 'none';
    end if;

    if jsonb_typeof(p_value) <> 'object' then
        return 'unknown';
    end if;

    v_path := p_value -> 'path';
    if v_path is null or jsonb_typeof(v_path) = 'null' then
        v_path_state := 'absent';
    elsif jsonb_typeof(v_path) = 'string' then
        v_path_text := v_path #>> '{}';
        if btrim(v_path_text) = '' then
            v_path_state := 'absent';
        elsif char_length(v_path_text) <= 512
              and v_path_text = btrim(v_path_text)
              and position('://' in v_path_text) = 0
              and left(v_path_text, 1) <> '/' then
            v_path_state := 'usable';
        else
            v_path_state := 'malformed';
        end if;
    else
        v_path_state := 'malformed';
    end if;

    v_src := p_value -> 'src';
    if v_src is null or jsonb_typeof(v_src) = 'null' then
        v_src_state := 'none';
    elsif jsonb_typeof(v_src) = 'string' then
        v_src_state := nora_private.attachment_url_liveness(v_src #>> '{}', p_storage_key);
    else
        v_src_state := 'unknown';
    end if;

    if v_path_state = 'usable' then
        if v_path_text = p_storage_key then
            return 'live';
        end if;
        -- the path names another key; the src may still reference this one
        return v_src_state;
    elsif v_path_state = 'absent' then
        return v_src_state;
    end if;

    -- malformed path: only a src that PROVES the key live is conclusive
    if v_src_state = 'live' then
        return 'live';
    end if;
    return 'unknown';
end;
$$;

alter function nora_private.attachment_file_value_liveness(jsonb, text) owner to postgres;

comment on function nora_private.attachment_file_value_liveness(jsonb, text) is
    'W8-C S2A2.1: classifies one RAFile-like JSON value ({path?, src?}) against one candidate storage key -> live | none | unknown. A usable path equal to the key proves live; a src is classified by attachment_url_liveness and can prove a SECOND key live when it names a different local key than the path; absent path falls back to src; a malformed path or non-null non-object JSON is unknown unless a src proves live; {}, JSON null and SQL NULL are none. Reads no table.';

revoke all on function nora_private.attachment_file_value_liveness(jsonb, text) from public;
revoke all on function nora_private.attachment_file_value_liveness(jsonb, text) from anon;
revoke all on function nora_private.attachment_file_value_liveness(jsonb, text) from authenticated;
revoke all on function nora_private.attachment_file_value_liveness(jsonb, text) from service_role;

-- ---------------------------------------------------------------------------
-- 4. The central resolver
--
-- SECURITY DEFINER is required for COMPLETE visibility, not for privilege: it
-- must see every row of every registered table independent of RLS and of the
-- caller, otherwise it would report a false 'dead'. It is not an API: EXECUTE
-- is revoked from every API role (authenticated holds USAGE on nora_private,
-- so the revoke is load-bearing).
--
-- `set row_security = off` makes that visibility FAIL-CLOSED: if a later
-- drift (FORCE ROW LEVEL SECURITY, an ownership change, a lost BYPASSRLS)
-- would let a policy filter any registered table, PostgreSQL raises 42501
-- instead of silently returning fewer rows — a filtered read is a false
-- 'dead', an error is not a verdict.
-- ---------------------------------------------------------------------------
create function nora_private.attachment_storage_key_liveness(p_storage_key text)
returns text
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
declare
    v_live        boolean;
    v_unknown     boolean;
    v_any_unknown boolean := false;
    v_key_json    text;
begin
    -- Queue-domain input contract. The key is compared EXACTLY as given; a
    -- padded but non-blank key is valid and is never trimmed.
    if p_storage_key is null
       or btrim(p_storage_key) = ''
       or char_length(p_storage_key) > 512 then
        raise exception 'NORA_ATTACHMENT_LIVENESS_INVALID_KEY: storage key must be non-blank text of at most 512 characters'
            using errcode = '22023';
    end if;

    -- S1 public.attachments.storage_key (UNIQUE-indexed identity)
    if exists (select 1 from public.attachments a where a.storage_key = p_storage_key) then
        return 'live';
    end if;

    -- S2 public.contact_notes.attachments (jsonb[])
    select coalesce(bool_or(s.v = 'live'), false), coalesce(bool_or(s.v = 'unknown'), false)
      into v_live, v_unknown
      from (select nora_private.attachment_file_value_liveness(e.item, p_storage_key) as v
              from public.contact_notes n
              cross join lateral unnest(n.attachments) as e(item)) as s;
    if v_live then
        return 'live';
    end if;
    v_any_unknown := v_any_unknown or v_unknown;

    -- S3 public.deal_notes.attachments (jsonb[])
    select coalesce(bool_or(s.v = 'live'), false), coalesce(bool_or(s.v = 'unknown'), false)
      into v_live, v_unknown
      from (select nora_private.attachment_file_value_liveness(e.item, p_storage_key) as v
              from public.deal_notes n
              cross join lateral unnest(n.attachments) as e(item)) as s;
    if v_live then
        return 'live';
    end if;
    v_any_unknown := v_any_unknown or v_unknown;

    -- S4 public.companies.logo
    select coalesce(bool_or(s.v = 'live'), false), coalesce(bool_or(s.v = 'unknown'), false)
      into v_live, v_unknown
      from (select nora_private.attachment_file_value_liveness(c.logo, p_storage_key) as v
              from public.companies c) as s;
    if v_live then
        return 'live';
    end if;
    v_any_unknown := v_any_unknown or v_unknown;

    -- S5 public.configuration.config -> lightModeLogo / darkModeLogo.
    -- Production stores these as URL-ONLY JSON strings; only the URL helper
    -- finds them. A non-object config is an unexpected shape -> unknown.
    select coalesce(bool_or(s.v = 'live'), false), coalesce(bool_or(s.v = 'unknown'), false)
      into v_live, v_unknown
      from (select case
                       when jsonb_typeof(c.config) is distinct from 'object' then 'unknown'
                       when k.item is null or jsonb_typeof(k.item) = 'null' then 'none'
                       when jsonb_typeof(k.item) = 'string'
                           then nora_private.attachment_url_liveness(k.item #>> '{}', p_storage_key)
                       when jsonb_typeof(k.item) = 'object'
                           then nora_private.attachment_file_value_liveness(k.item, p_storage_key)
                       else 'unknown'
                   end as v
              from public.configuration c
              cross join lateral (values (c.config -> 'lightModeLogo'),
                                         (c.config -> 'darkModeLogo')) as k(item)) as s;
    if v_live then
        return 'live';
    end if;
    v_any_unknown := v_any_unknown or v_unknown;

    -- S6 public.contacts.avatar
    select coalesce(bool_or(s.v = 'live'), false), coalesce(bool_or(s.v = 'unknown'), false)
      into v_live, v_unknown
      from (select nora_private.attachment_file_value_liveness(c.avatar, p_storage_key) as v
              from public.contacts c) as s;
    if v_live then
        return 'live';
    end if;
    v_any_unknown := v_any_unknown or v_unknown;

    -- S7 public.sales.avatar
    select coalesce(bool_or(s.v = 'live'), false), coalesce(bool_or(s.v = 'unknown'), false)
      into v_live, v_unknown
      from (select nora_private.attachment_file_value_liveness(sa.avatar, p_storage_key) as v
              from public.sales sa) as s;
    if v_live then
        return 'live';
    end if;
    v_any_unknown := v_any_unknown or v_unknown;

    -- S5r residual configuration tripwire: after removing the two registered
    -- branding keys, any storage-looking text left in config is a reference
    -- this contract does not know -> fail closed. Detection only; it never
    -- registers anything and never proves live. It trips on
    --   * a storage URL marker            storage/v1 (any case, %2F)
    --   * a bucket path segment           attachments/ or attachments%2F,
    --                                      which also covers the relative
    --                                      object/public/attachments/<key>
    --   * the historic combined marker     'attachments' + /object/
    --   * the candidate key itself          verbatim anywhere in the residue
    --                                      (bare key, {"path": key}, any
    --                                      other unregistered shape).
    -- The candidate is matched in its JSON-escaped spelling, exactly as it
    -- appears in the serialized residue, and case-sensitively like a key.
    v_key_json := to_jsonb(p_storage_key)::text;
    v_key_json := substr(v_key_json, 2, char_length(v_key_json) - 2);

    select coalesce(bool_or(
               case
                   when jsonb_typeof(c.config) is distinct from 'object' then true
                   else lower((c.config - 'lightModeLogo' - 'darkModeLogo')::text) ~ 'storage(/|%2f)+v1'
                        or lower((c.config - 'lightModeLogo' - 'darkModeLogo')::text) ~ 'attachments(/|%2f)'
                        or (position('attachments' in lower((c.config - 'lightModeLogo' - 'darkModeLogo')::text)) > 0
                            and lower((c.config - 'lightModeLogo' - 'darkModeLogo')::text) ~ '(/|%2f)object(/|%2f)')
                        or position(v_key_json in (c.config - 'lightModeLogo' - 'darkModeLogo')::text) > 0
               end), false)
      into v_unknown
      from public.configuration c;
    v_any_unknown := v_any_unknown or v_unknown;

    if v_any_unknown then
        return 'unknown';
    end if;
    return 'dead';
end;
$$;

alter function nora_private.attachment_storage_key_liveness(text) owner to postgres;

comment on function nora_private.attachment_storage_key_liveness(text) is
    'W8-C S2A2.1: central attachment liveness resolver -> live | dead | unknown for one storage key, over the hard-coded reference registry v1 (public.attachments.storage_key; contact_notes/deal_notes.attachments jsonb[]; companies.logo; configuration.config lightModeLogo/darkModeLogo incl. URL-only strings plus a residual tripwire on storage markers, attachments/ path segments and the candidate key verbatim; contacts.avatar; sales.avatar). LIVE dominates UNKNOWN; DEAD only when every surface was inspected without live proof or ambiguity. A statement-snapshot OBSERVATION, never a deletion permission. Audit snapshots and storage.objects do not participate. Invalid key (NULL, blank, > 512 chars) raises 22023 NORA_ATTACHMENT_LIVENESS_INVALID_KEY; execution errors propagate and are never mapped to unknown. SECURITY DEFINER for complete RLS-independent visibility, with row_security = off so that any RLS-filtered read raises instead of hiding rows; no API role may execute it.';

revoke all on function nora_private.attachment_storage_key_liveness(text) from public;
revoke all on function nora_private.attachment_storage_key_liveness(text) from anon;
revoke all on function nora_private.attachment_storage_key_liveness(text) from authenticated;
revoke all on function nora_private.attachment_storage_key_liveness(text) from service_role;

-- ---------------------------------------------------------------------------
-- 5. Postconditions (fail-closed)
-- ---------------------------------------------------------------------------
do $$
declare
    r           record;
    v_role      text;
    v_priv      text;
    v_failures  text[] := '{}';
    v_cols      text[];
    v_literals  text[];
    v_def       text;
    v_smoke     text;
    v_all_privs text[] := case when current_setting('server_version_num')::int >= 170000
                               then array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']
                               else array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']
                          end;
begin
    -- 5a. the three functions: exact signature, return type, owner, security
    --     mode, volatility, exact settings (empty search_path everywhere;
    --     row_security = off on the definer resolver only)
    for r in
        select * from (values
            ('nora_private.attachment_storage_key_liveness(text)',          true,  array['search_path=""', 'row_security=off']),
            ('nora_private.attachment_url_liveness(text,text)',             false, array['search_path=""']),
            ('nora_private.attachment_file_value_liveness(jsonb,text)',     false, array['search_path=""'])
        ) as t(sig, definer, config)
    loop
        if to_regprocedure(r.sig) is null then
            v_failures := v_failures || format('%s was not created', r.sig);
            continue;
        end if;
        if not exists (select 1 from pg_proc p
                       where p.oid = to_regprocedure(r.sig)
                         and p.prorettype = 'text'::regtype
                         and not p.proretset
                         and p.prosecdef = r.definer
                         and p.provolatile = 's'
                         and pg_get_userbyid(p.proowner) = 'postgres'
                         and p.proconfig = r.config) then
            v_failures := v_failures || format('%s is not text / %s / STABLE / owner postgres / settings %s',
                r.sig, case when r.definer then 'SECURITY DEFINER' else 'SECURITY INVOKER' end, r.config);
        end if;
        foreach v_role in array array['public','anon','authenticated','service_role'] loop
            if has_function_privilege(v_role, r.sig, 'EXECUTE') then
                v_failures := v_failures || format('%s holds EXECUTE on %s', v_role, r.sig);
            end if;
        end loop;
    end loop;

    -- 5b. the replaced constraints admit skipped_live, and nothing else changed
    select pg_get_constraintdef(con.oid),
           (select array_agg(a.attname::text order by a.attname)
              from unnest(con.conkey) k join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k),
           (select array_agg(m[1] order by m[1])
              from regexp_matches(pg_get_constraintdef(con.oid), '''([a-z_]+)''::text', 'g') as m)
      into v_def, v_cols, v_literals
    from pg_constraint con
    where con.conrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
      and con.conname = 'attachment_storage_deletion_queue_state_check' and con.contype = 'c';
    if v_cols is distinct from array['state']
       or v_literals is distinct from array['claimed','done','failed_retryable','failed_terminal','pending','skipped_live'] then
        v_failures := v_failures || format('state_check does not admit exactly the six states: %s', coalesce(v_def, '<missing>'));
    end if;

    v_def := null; v_cols := null; v_literals := null;
    select pg_get_constraintdef(con.oid),
           (select array_agg(a.attname::text order by a.attname)
              from unnest(con.conkey) k join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k),
           (select array_agg(m[1] order by m[1])
              from regexp_matches(pg_get_constraintdef(con.oid), '''([a-z_]+)''::text', 'g') as m)
      into v_def, v_cols, v_literals
    from pg_constraint con
    where con.conrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
      and con.conname = 'attachment_storage_deletion_queue_completed_check' and con.contype = 'c';
    if v_cols is distinct from array['completed_at','state']
       or v_literals is distinct from array['done','failed_terminal','skipped_live']
       or position('completed_at IS NOT NULL' in coalesce(v_def, '')) = 0 then
        v_failures := v_failures || format('completed_check does not cover exactly the three terminal states: %s', coalesce(v_def, '<missing>'));
    end if;

    if (select count(*) from pg_constraint con
        where con.conrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
          and con.contype = 'c'
          and con.conname in ('attachment_storage_deletion_queue_state_check',
                              'attachment_storage_deletion_queue_storage_key_check',
                              'attachment_storage_deletion_queue_attempt_count_check',
                              'attachment_storage_deletion_queue_claim_check',
                              'attachment_storage_deletion_queue_completed_check',
                              'attachment_storage_deletion_queue_error_check')) <> 6
       or (select count(*) from pg_constraint con
           where con.conrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
             and con.contype = 'c') <> 6 then
        v_failures := array_append(v_failures, 'the queue does not carry exactly the six S2A1 check constraints');
    end if;

    -- 5c. index predicates unchanged: skipped_live is neither active nor due
    for r in
        select * from (values
            ('uq__attachment_deletion_queue__active_storage_key', true,
             array['claimed','failed_retryable','pending']),
            ('attachment_deletion_queue_due_idx', false,
             array['failed_retryable','pending'])
        ) as t(idx, uniq, states)
    loop
        if not exists (
            select 1 from pg_index i
            join pg_class c on c.oid = i.indexrelid
            where i.indrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
              and c.relname = r.idx
              and i.indisunique = r.uniq
              and i.indpred is not null
              and (select array_agg(m[1] order by m[1])
                     from regexp_matches(pg_get_expr(i.indpred, i.indrelid), '''([a-z_]+)''::text', 'g') as m)
                  = r.states
        ) then
            v_failures := v_failures || format('index %s changed (uniqueness or partial predicate)', r.idx);
        end if;
    end loop;

    -- 5d. queue access unchanged: no API role holds anything, RLS on, no policy
    foreach v_role in array array['anon','authenticated','service_role'] loop
        foreach v_priv in array v_all_privs loop
            if has_table_privilege(v_role, 'nora_private.attachment_storage_deletion_queue', v_priv) then
                v_failures := v_failures || format('%s holds %s on the queue', v_role, v_priv);
            end if;
        end loop;
    end loop;

    if exists (select 1
               from pg_class c, aclexplode(c.relacl) acl
               where c.oid = 'nora_private.attachment_storage_deletion_queue'::regclass
                 and pg_get_userbyid(acl.grantee) <> 'postgres') then
        v_failures := array_append(v_failures, 'the queue ACL names a grantee other than postgres');
    end if;

    if not (select c.relrowsecurity from pg_class c
            where c.oid = 'nora_private.attachment_storage_deletion_queue'::regclass) then
        v_failures := array_append(v_failures, 'row level security is not enabled on the queue');
    end if;

    if exists (select 1 from pg_policies p
               where p.schemaname = 'nora_private' and p.tablename = 'attachment_storage_deletion_queue') then
        v_failures := array_append(v_failures, 'the queue must carry no policy at all (deny-all by absence)');
    end if;

    -- 5e. no queue data written: nothing produces skipped_live
    if exists (select 1 from nora_private.attachment_storage_deletion_queue where state = 'skipped_live') then
        v_failures := array_append(v_failures, 'a skipped_live row exists - S2A2.1 is vocabulary only');
    end if;

    -- 5f. S1 privilege matrix on public.attachments unchanged; service_role
    --     gains no authority anywhere this migration touches
    for r in
        select * from (values
            ('authenticated', 'SELECT,INSERT,DELETE'),
            ('anon',          ''),
            ('service_role',  '')
        ) as t(grantee, privs)
    loop
        foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE'] loop
            if has_table_privilege(r.grantee, 'public.attachments', v_priv)
               is distinct from (v_priv = any (string_to_array(r.privs, ','))) then
                v_failures := v_failures || format('S1 regression: %s on public.attachments changed for %s',
                    v_priv, r.grantee);
            end if;
        end loop;
    end loop;

    -- 5g. smoke: the resolver runs end to end against the live data and returns
    --     a verdict. A key nobody can reference is never live.
    v_smoke := nora_private.attachment_storage_key_liveness('nora-w8c-s2a21-postcondition-' || gen_random_uuid()::text);
    if v_smoke not in ('dead', 'unknown') then
        v_failures := v_failures || format('resolver smoke returned %s for an unreferenced key', v_smoke);
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'NORA_ATTACHMENT_LIVENESS_RESOLVER aborted:\n%', array_to_string(v_failures, E'\n');
    end if;

    raise notice 'NORA_ATTACHMENT_LIVENESS_RESOLVER: resolver + 2 helpers installed, skipped_live vocabulary added, no consumer, no storage path (smoke %, pg %)',
        v_smoke, current_setting('server_version_num');
end;
$$;
