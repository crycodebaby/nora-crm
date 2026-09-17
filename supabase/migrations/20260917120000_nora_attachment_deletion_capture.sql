-- Nora CRM: W8-C S2A1 Attachment Deletion Capture Foundation (2026-09-17)
--
-- The smallest durable slice of the physical attachment deletion path: when a
-- public.attachments metadata row disappears, a deletion INTENT is captured in
-- a private outbox. Nothing consumes it yet.
--
--   DELETE public.attachments row  ->  durable pending job in a private queue
--
-- That is the entire capability. S1 (20260916120000) created the metadata row
-- whose deletion is the hook; this migration attaches the hook.
--
-- WHAT THIS MIGRATION DOES NOT DO (deliberately, so a reviewer does not look
-- for it):
--   * no physical storage deletion — not one byte in the bucket is touched,
--     now or as a deferred effect. Enqueuing an intent is not deleting a file,
--     and a row in this queue is NOT a statement that the object may go,
--   * no worker, no Edge Function, no HTTP, no pg_net, no Storage API call,
--     no network action of any kind anywhere in this migration,
--   * no claim / ack / fail RPC — the queue has no consumer contract yet (S2A2),
--   * no live-reference resolver, no URL parser, no legacy JSON resolver. The
--     question "is this storage key still referenced anywhere?" is NOT answered
--     here and MUST be answered before anything ever deletes an object (S2A2),
--   * no new capability for service_role — it gains no privilege on the queue,
--     on public.attachments or on any business table,
--   * no change to storage.objects, to the `attachments` bucket or to W8-B,
--   * no dual-write, no backfill, no read switch, no legacy write retirement.
--
-- WHY THE QUEUE IS EMPTY IN PRODUCTION AFTER THIS MIGRATION
-- ---------------------------------------------------------
-- public.attachments is empty and unwired (S1): no code in src/** writes it.
-- No attachment row exists, therefore none can be deleted, therefore this
-- queue receives ZERO jobs in Production until a later slice starts writing
-- attachment rows. That is expected and is not a defect. Capture must exist
-- BEFORE the first write, otherwise deletions occurring during the wiring
-- slice would be lost forever — that ordering is the entire reason this slice
-- ships first.
--
-- IDEMPOTENCY MODEL: ACTIVE-JOB UNIQUENESS, NOT PERMANENT UNIQUENESS
-- ------------------------------------------------------------------
-- A permanent UNIQUE(storage_key) would be WRONG here. A storage key whose job
-- already completed may legitimately be referenced again later and deleted
-- again; a permanent unique index would silently swallow that second, valid
-- deletion intent and strand the object forever. The invariant is therefore
-- scoped to the ACTIVE states via a partial unique index: at most one active
-- job per storage key, while any number of historical terminal rows may exist.
--
-- STATE VOCABULARY
-- ----------------
-- The full vocabulary is established here so that S2A2 does not have to alter
-- a live table's check constraint, but S2A1 only ever PRODUCES 'pending':
--
--   pending           captured, waiting for a consumer            <- S2A1 writes this
--   claimed           leased by a worker                          (S2A2)
--   failed_retryable  transient failure, retry after available_at (S2A2)
--   done              object confirmed gone                       (S2A2)
--   failed_terminal   gave up, needs an operator                  (S2A2)
--
-- 'done' and 'failed_terminal' are terminal; the first three are ACTIVE and
-- carry the uniqueness invariant.
--
-- TRUST MODEL
-- -----------
-- The enqueued key is taken from OLD.storage_key — a value that already passed
-- the S1 entity invariants and was never supplied by the deleting caller in
-- this statement. No caller-supplied path, no client-controlled string and no
-- URL is ever parsed or trusted here. This is the explicit counter-design to
-- the pre-W8-B path (trigger -> pg_net -> Edge Function removing a
-- client-controlled path with service_role), which was removed and is not
-- being reactivated.

-- ---------------------------------------------------------------------------
-- 0. Preconditions (fail-closed)
--
-- Requires a runner that stops at the first error (supabase db push /
-- apply_migration; psql only with -v ON_ERROR_STOP=1).
-- ---------------------------------------------------------------------------
do $$
begin
    -- The privilege contract below is grantor specific (20260907120000), and
    -- every relation Nora creates must be owned by postgres
    -- (22-security-and-access.md 6.3 — a security assumption, not a formality).
    if current_user <> 'postgres' then
        raise exception 'NORA_ATTACHMENT_DELETION_CAPTURE: expected migration creator postgres, got %', current_user
            using errcode = '42501';
    end if;

    if to_regnamespace('nora_private') is null then
        raise exception 'NORA_ATTACHMENT_DELETION_CAPTURE: schema nora_private is missing'
            using errcode = '3F000';
    end if;

    -- The capture hook is the S1 metadata row deletion. Without that table
    -- there is nothing to hook onto.
    if to_regclass('public.attachments') is null then
        raise exception 'NORA_ATTACHMENT_DELETION_CAPTURE: public.attachments is missing (W8-C S1 not applied)'
            using errcode = 'P0002';
    end if;

    if to_regclass('nora_private.attachment_storage_deletion_queue') is not null then
        raise exception 'NORA_ATTACHMENT_DELETION_CAPTURE: nora_private.attachment_storage_deletion_queue already exists'
            using errcode = '42P07',
                  hint = 'This migration is additive and creates the queue once. Investigate where the existing object came from instead of re-running it.';
    end if;

    -- Both S1 foreign keys must still be ON DELETE CASCADE: the cascade is how
    -- a note/contact/deal/company deletion reaches the attachment row, and
    -- therefore how it reaches this capture trigger. If someone weakened them,
    -- capture would silently miss every cascaded deletion.
    if (select count(*) from pg_constraint con
        where con.conrelid = 'public.attachments'::regclass
          and con.contype = 'f'
          and con.confdeltype = 'c') <> 2 then
        raise exception 'NORA_ATTACHMENT_DELETION_CAPTURE: public.attachments must keep both note foreign keys ON DELETE CASCADE'
            using errcode = '42704',
                  hint = 'Cascaded note deletion is the main capture path. Do not relax these FKs.';
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. The private outbox
--
-- Operational infrastructure, not a business entity: it lives in nora_private,
-- which is not exposed through PostgREST (22-security-and-access.md 6.1), and
-- carries no grant for any API role. The precedent is
-- nora_private.idempotency_records / sales_email_change_tickets.
-- ---------------------------------------------------------------------------
create table nora_private.attachment_storage_deletion_queue (
    id bigint generated by default as identity primary key,

    -- The object identity to be removed LATER, by a consumer that must first
    -- prove the key is referenced nowhere. Same shape invariant as the S1
    -- entity column, restated as a backstop: this table must never carry a
    -- blank or absurdly long key even if reached by some other writer.
    storage_key text not null,

    state text not null default 'pending',

    -- Consumer bookkeeping. S2A1 never advances any of these; the columns exist
    -- so the consumer contract (S2A2) does not have to ALTER a live table.
    attempt_count integer not null default 0,
    available_at timestamptz not null default now(),
    claimed_at timestamptz,
    claimed_by text,
    last_error_code text,
    last_error_at timestamptz,

    created_at timestamptz not null default now(),
    completed_at timestamptz,

    constraint attachment_storage_deletion_queue_state_check
        check (state in ('pending', 'claimed', 'failed_retryable', 'done', 'failed_terminal')),

    constraint attachment_storage_deletion_queue_storage_key_check
        check (btrim(storage_key) <> '' and char_length(storage_key) <= 512),

    constraint attachment_storage_deletion_queue_attempt_count_check
        check (attempt_count >= 0),

    -- A lease is meaningful only while the job is claimed, and a lease always
    -- names both when and by whom. This keeps stale-claim recovery in S2A2
    -- unambiguous: a 'claimed' row always has a comparable claimed_at.
    constraint attachment_storage_deletion_queue_claim_check
        check (
            (state = 'claimed' and claimed_at is not null and claimed_by is not null)
            or (state <> 'claimed' and claimed_at is null and claimed_by is null)
        ),

    -- Terminal states are exactly the states that record a completion instant.
    constraint attachment_storage_deletion_queue_completed_check
        check ((state in ('done', 'failed_terminal')) = (completed_at is not null)),

    -- An error code and its timestamp are recorded together or not at all.
    constraint attachment_storage_deletion_queue_error_check
        check ((last_error_code is null) = (last_error_at is null))
);

-- THE idempotency invariant: at most one ACTIVE job per storage key.
-- Deliberately partial — a terminal row must never block a future, legitimate
-- deletion intent for the same key (see header).
create unique index uq__attachment_deletion_queue__active_storage_key
    on nora_private.attachment_storage_deletion_queue (storage_key)
    where state in ('pending', 'claimed', 'failed_retryable');

-- Drain order for the future consumer: oldest due work first.
--
-- SCOPE OF THIS INDEX, stated so the omission is read as a decision and not as
-- an oversight: it serves DUE, UNCLAIMED work only — 'pending' and
-- 'failed_retryable', ordered by available_at. It deliberately does NOT serve
-- stale-CLAIM recovery: a 'claimed' row whose lease expired is found by
-- claimed_at, which is a different access path and belongs to claim semantics
-- that do not exist yet. S2A2 chooses and adds that lease-recovery index when
-- it implements claiming; S2A1 adds no index for a consumer it does not have.
create index attachment_deletion_queue_due_idx
    on nora_private.attachment_storage_deletion_queue (available_at, id)
    where state in ('pending', 'failed_retryable');

comment on table nora_private.attachment_storage_deletion_queue is
    'W8-C S2A1 (2026-09-17): durable capture of the intent to delete a storage object, written by the AFTER DELETE trigger on public.attachments. A row here is an INTENT, never a permission: nothing may delete an object before a consumer has proven the key is referenced nowhere (legacy note JSON arrays, company logos and the URL-only branding logos included). No direct grants for any API role — not reachable through PostgREST. S2A1 has no consumer: no claim/ack/fail contract, no worker, no Storage call.';

comment on column nora_private.attachment_storage_deletion_queue.storage_key is
    'Provider-neutral object identity copied from the deleted attachment row (OLD.storage_key). Never a src, URL, hostname or bucket name, and never a caller-supplied path.';
comment on column nora_private.attachment_storage_deletion_queue.state is
    'pending | claimed | failed_retryable | done | failed_terminal. The first three are ACTIVE and carry the partial unique invariant on storage_key. S2A1 only ever produces pending.';
comment on column nora_private.attachment_storage_deletion_queue.attempt_count is
    'Consumer retry counter (S2A2). Always 0 in S2A1.';
comment on column nora_private.attachment_storage_deletion_queue.available_at is
    'Earliest instant a consumer may work this job (S2A2 backoff). Defaults to now(), i.e. immediately due.';
comment on column nora_private.attachment_storage_deletion_queue.claimed_at is
    'Lease start. Non-null exactly while state = claimed; the basis for stale-claim recovery in S2A2.';
comment on column nora_private.attachment_storage_deletion_queue.claimed_by is
    'Opaque consumer instance identifier holding the lease. Non-null exactly while state = claimed.';
comment on column nora_private.attachment_storage_deletion_queue.last_error_code is
    'Machine-readable failure code from the last consumer attempt (S2A2), never a free-text provider message.';
comment on column nora_private.attachment_storage_deletion_queue.completed_at is
    'Set exactly when the job reaches a terminal state (done / failed_terminal). Terminal rows are RETAINED, never auto-purged: a queue that deletes its own evidence cannot be audited.';

-- No API role gets anything. `revoke all` first, ausnahmslos
-- (22-security-and-access.md 6.2), even though the hardened default privileges
-- of nora_private already hand a new table nothing.
revoke all on table nora_private.attachment_storage_deletion_queue from public;
revoke all on table nora_private.attachment_storage_deletion_queue from anon;
revoke all on table nora_private.attachment_storage_deletion_queue from authenticated;
revoke all on table nora_private.attachment_storage_deletion_queue from service_role;

-- Defense in depth behind the missing grants: even if some future migration
-- grants a privilege by accident, RLS without a single policy denies every
-- non-owner row access. The SECURITY DEFINER writer below is unaffected
-- (it runs as the postgres owner, which bypasses RLS on its own table).
alter table nora_private.attachment_storage_deletion_queue enable row level security;

-- ---------------------------------------------------------------------------
-- 2. The capture trigger function
--
-- SECURITY DEFINER is REQUIRED, not stylistic: the deleting caller is
-- `authenticated` (office/admin) and holds no privilege whatsoever on
-- nora_private.attachment_storage_deletion_queue. Without a definer context the
-- capture would fail and, with it, every attachment deletion.
--
-- The body performs DATABASE WORK ONLY. It must never gain an HTTP call, a
-- pg_net call, a Storage API call or an Edge Function invocation — that is the
-- exact construction W8-B removed. A consumer outside the database does that
-- work later, after proving the key is dead.
-- ---------------------------------------------------------------------------
create function nora_private.enqueue_attachment_storage_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    -- OLD.storage_key is trusted input: it is the value that was persisted
    -- under the S1 invariants, not anything the deleting statement supplied.
    --
    -- The conflict target is stated EXPLICITLY, and that precision is the whole
    -- point. A bare `on conflict do nothing` arbitrates over EVERY unique index
    -- on the table, not just the intended one — including the primary key. Since
    -- `id` is `generated BY DEFAULT as identity`, an explicit-id insert leaves
    -- the identity sequence behind the maximum id, and the next capture would
    -- then raise a PK conflict that a bare clause would SILENTLY SWALLOW: the
    -- business DELETE would commit while the deletion intent vanished, stranding
    -- the storage object forever with nothing recording that it should go. That
    -- is the exact failure this queue exists to prevent.
    --
    -- Naming the partial index's columns and predicate narrows the suppression
    -- to the one conflict that genuinely means "already captured":
    --   * duplicate ACTIVE storage_key -> NO-OP, the business DELETE proceeds,
    --   * every OTHER insertion failure -> propagates and rolls the deletion
    --     back. Capture is fail-closed.
    --
    -- Deliberately NO `exception when others` here: swallowing is the defect.
    insert into nora_private.attachment_storage_deletion_queue (storage_key)
    values (old.storage_key)
    on conflict (storage_key) where state in ('pending', 'claimed', 'failed_retryable')
    do nothing;

    return old;
end;
$$;

alter function nora_private.enqueue_attachment_storage_deletion() owner to postgres;

comment on function nora_private.enqueue_attachment_storage_deletion() is
    'W8-C S2A1: AFTER DELETE row trigger on public.attachments. Captures OLD.storage_key as a pending deletion INTENT in nora_private.attachment_storage_deletion_queue. Database work only — no HTTP, no pg_net, no Storage API, no Edge Function, no network. A repeated intent while an active job exists is a NO-OP; any other failure aborts the deletion (fail-closed capture).';

-- A trigger-returning function is not exposed as a PostgREST RPC by engine
-- restriction (22-security-and-access.md 6.1), but the explicit revoke is the
-- project rule for a new sensible function and is not redundant bookkeeping.
revoke all on function nora_private.enqueue_attachment_storage_deletion() from public;
revoke all on function nora_private.enqueue_attachment_storage_deletion() from anon;
revoke all on function nora_private.enqueue_attachment_storage_deletion() from authenticated;
revoke all on function nora_private.enqueue_attachment_storage_deletion() from service_role;

-- ---------------------------------------------------------------------------
-- 3. The trigger
--
-- ONE trigger, AFTER DELETE, FOR EACH ROW, on public.attachments.
--
-- This single placement covers every metadata deletion path, because PostgreSQL
-- executes a referential ON DELETE CASCADE action as a real DELETE against the
-- child table, which fires that table's row triggers. Proven by the
-- verification suite for all six paths: direct delete, contact_note,
-- deal_note, contact -> contact_note, deal -> deal_note and
-- company -> contacts/deals -> notes.
--
-- The one row-delete path that does NOT fire a row trigger is TRUNCATE. No API
-- role holds TRUNCATE on public.attachments or on any of its ancestor tables
-- (Security Hardening Wave 1, verified in Production 2026-09-07), so this is
-- reachable only by a deliberate superuser act, not by the application.
-- ---------------------------------------------------------------------------
create trigger enqueue_attachment_storage_deletion_after_delete_trigger
    after delete on public.attachments
    for each row execute function nora_private.enqueue_attachment_storage_deletion();

-- ---------------------------------------------------------------------------
-- 4. Postconditions (fail-closed)
-- ---------------------------------------------------------------------------
do $$
declare
    r           record;
    v_priv      text;
    v_role      text;
    v_failures  text[] := '{}';
    v_unexpected text;
    v_all_privs text[] := case when current_setting('server_version_num')::int >= 170000
                               then array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']
                               else array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']
                          end;
begin
    -- 4a. queue shape
    if to_regclass('nora_private.attachment_storage_deletion_queue') is null then
        raise exception 'NORA_ATTACHMENT_DELETION_CAPTURE aborted: the queue table was not created';
    end if;

    if pg_get_userbyid((select relowner from pg_class
                        where oid = 'nora_private.attachment_storage_deletion_queue'::regclass)) <> 'postgres' then
        v_failures := array_append(v_failures, 'the queue table is not owned by postgres');
    end if;

    for r in
        select * from (values
            ('id',              'bigint',                     false),
            ('storage_key',     'text',                       false),
            ('state',           'text',                       false),
            ('attempt_count',   'integer',                    false),
            ('available_at',    'timestamp with time zone',   false),
            ('claimed_at',      'timestamp with time zone',   true),
            ('claimed_by',      'text',                       true),
            ('last_error_code', 'text',                       true),
            ('last_error_at',   'timestamp with time zone',   true),
            ('created_at',      'timestamp with time zone',   false),
            ('completed_at',    'timestamp with time zone',   true)
        ) as t(col, typ, nullable)
    loop
        if not exists (
            select 1 from pg_attribute a
            where a.attrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
              and a.attname = r.col and a.attnum > 0 and not a.attisdropped
              and format_type(a.atttypid, a.atttypmod) = r.typ
              and a.attnotnull = (not r.nullable::boolean)
        ) then
            v_failures := v_failures || format('queue column %s is not %s %s', r.col, r.typ,
                case when r.nullable::boolean then 'NULL' else 'NOT NULL' end);
        end if;
    end loop;

    select string_agg(a.attname, ', ' order by a.attname) into v_unexpected
    from pg_attribute a
    where a.attrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
      and a.attnum > 0 and not a.attisdropped
      and a.attname not in ('id','storage_key','state','attempt_count','available_at','claimed_at',
                            'claimed_by','last_error_code','last_error_at','created_at','completed_at');
    if v_unexpected is not null then
        v_failures := v_failures || format('unexpected columns on the queue: %s', v_unexpected);
    end if;

    -- 4b. the idempotency index must be UNIQUE and PARTIAL
    if not exists (
        select 1 from pg_index i
        join pg_class c on c.oid = i.indexrelid
        where i.indrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
          and c.relname = 'uq__attachment_deletion_queue__active_storage_key'
          and i.indisunique
          and i.indpred is not null
    ) then
        v_failures := array_append(v_failures,
            'the active-job index is missing, not unique, or not partial (a permanent UNIQUE would strand re-referenced keys)');
    end if;

    -- 4c. constraints
    for r in
        select * from (values
            ('attachment_storage_deletion_queue_state_check'),
            ('attachment_storage_deletion_queue_storage_key_check'),
            ('attachment_storage_deletion_queue_attempt_count_check'),
            ('attachment_storage_deletion_queue_claim_check'),
            ('attachment_storage_deletion_queue_completed_check'),
            ('attachment_storage_deletion_queue_error_check')
        ) as t(conname)
    loop
        if not exists (select 1 from pg_constraint con
                       where con.conrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
                         and con.conname = r.conname and con.contype = 'c') then
            v_failures := v_failures || format('missing check constraint %s', r.conname);
        end if;
    end loop;

    -- 4d. no API role holds ANY privilege on the queue, and RLS is on
    foreach v_role in array array['anon','authenticated','service_role'] loop
        foreach v_priv in array v_all_privs loop
            if has_table_privilege(v_role, 'nora_private.attachment_storage_deletion_queue', v_priv) then
                v_failures := v_failures || format('%s holds %s on the queue', v_role, v_priv);
            end if;
        end loop;
    end loop;

    if not (select c.relrowsecurity from pg_class c
            where c.oid = 'nora_private.attachment_storage_deletion_queue'::regclass) then
        v_failures := array_append(v_failures, 'row level security is not enabled on the queue');
    end if;

    if exists (select 1 from pg_policies p
               where p.schemaname = 'nora_private' and p.tablename = 'attachment_storage_deletion_queue') then
        v_failures := array_append(v_failures, 'the queue must carry no policy at all (deny-all by absence)');
    end if;

    -- 4e. the capture function: SECURITY DEFINER, owned by postgres, locked down
    if not exists (select 1 from pg_proc p
                   join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'nora_private'
                     and p.proname = 'enqueue_attachment_storage_deletion'
                     and p.prosecdef
                     and pg_get_userbyid(p.proowner) = 'postgres'
                     and p.proconfig @> array['search_path=""']) then
        v_failures := array_append(v_failures,
            'enqueue_attachment_storage_deletion is not SECURITY DEFINER / owned by postgres / search_path = ''''');
    end if;

    foreach v_role in array array['public','anon','authenticated','service_role'] loop
        if has_function_privilege(v_role, 'nora_private.enqueue_attachment_storage_deletion()', 'EXECUTE') then
            v_failures := v_failures || format('%s holds EXECUTE on enqueue_attachment_storage_deletion()', v_role);
        end if;
    end loop;

    -- 4f. exactly one trigger on public.attachments, AFTER DELETE, FOR EACH ROW
    select string_agg(t.tgname, ', ' order by t.tgname) into v_unexpected
    from pg_trigger t
    where t.tgrelid = 'public.attachments'::regclass
      and not t.tgisinternal
      and t.tgname <> 'enqueue_attachment_storage_deletion_after_delete_trigger';
    if v_unexpected is not null then
        v_failures := v_failures || format('unexpected triggers on public.attachments: %s', v_unexpected);
    end if;

    -- tgtype bit 0 = ROW, bit 3 = DELETE, bit 1 = BEFORE (must be unset => AFTER)
    if not exists (
        select 1 from pg_trigger t
        where t.tgrelid = 'public.attachments'::regclass
          and t.tgname = 'enqueue_attachment_storage_deletion_after_delete_trigger'
          and not t.tgisinternal
          and (t.tgtype & 1) = 1          -- FOR EACH ROW
          and (t.tgtype & 8) = 8          -- ON DELETE
          and (t.tgtype & 2) = 0          -- AFTER, not BEFORE
          and (t.tgtype & 4) = 0          -- not INSERT
          and (t.tgtype & 16) = 0         -- not UPDATE
    ) then
        v_failures := array_append(v_failures,
            'the capture trigger is not exactly AFTER DELETE FOR EACH ROW on public.attachments');
    end if;

    -- 4g. the queue is empty: S2A1 captures future deletions, it backfills nothing
    if (select count(*) from nora_private.attachment_storage_deletion_queue) <> 0 then
        v_failures := array_append(v_failures, 'the queue is not empty (S2A1 performs no backfill)');
    end if;

    -- 4h. S1 must be untouched: same privilege matrix on public.attachments
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

    if cardinality(v_failures) > 0 then
        raise exception E'NORA_ATTACHMENT_DELETION_CAPTURE aborted:\n%', array_to_string(v_failures, E'\n');
    end if;

    raise notice 'NORA_ATTACHMENT_DELETION_CAPTURE: private outbox + AFTER DELETE capture installed, no consumer, no storage path (pg %)',
        current_setting('server_version_num');
end;
$$;
