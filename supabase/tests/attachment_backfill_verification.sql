-- Nora W8-C S4 — historical attachment backfill: single-session verification.
--
-- Rollback-safe, with ONE deliberate exception: almost every fixture lives
-- inside an explicit transaction that ends with ROLLBACK, the helpers live in
-- pg_temp (gone at disconnect), and the statements outside those transactions
-- are read-only shape / security checks. Section 7b-7e is the exception - it
-- MUST run in autocommit to observe the runner's own error (see its header) -
-- so it commits its fixtures and removes them again explicitly. Section 12
-- re-asserts globally that nothing survived either way.
--
-- IT RUNS THE REAL ARTIFACTS, it does not re-implement them:
--   * the runner and the preflight are invoked with \i from the maintenance
--     directory, so a mutation of either file turns these checks RED
--   * every consistency assertion calls pg_temp.attachment_backfill_findings()
--     from the canonical verifier file - there is no second classification here
--
-- PREREQUISITES (local only, after `npx supabase db reset --local`, outside the
-- RBAC setup -> teardown window):
--
--   docker cp supabase/maintenance/attachment_backfill `
--             supabase_db_atomic-crm-demo:/tmp/nora_s4
--   Get-Content -Raw `
--       supabase/tests/attachment_backfill_consistency_verification.sql, `
--       supabase/tests/attachment_backfill_verification.sql |
--     docker exec -i supabase_db_atomic-crm-demo psql -U postgres -d postgres `
--       -v ON_ERROR_STOP=1 -f -
--
--   The verifier file must come first: it defines the classification function
--   this suite measures with. Override the copied directory with
--   -v s4dir=<path inside the container> if you copied it elsewhere.
--
-- WHAT IT PROVES
--   1. S4 adds no durable database object: no function, no table (and in
--      particular no checkpoint / progress table), no trigger; S3A and S3B are
--      untouched
--   2. security: no API role gains anything; authenticated keeps SELECT-only on
--      public.attachments; nobody but postgres reaches the reconcile core
--   3. EMPTY backfill is INSERT-only and the metadata contract holds:
--      storage_key = path, file_name = title, mime_type = type, byte_size NULL,
--      created_at = row creation time (never an invented upload time), owner
--      XOR; no DELETE, no queue row, no note UPDATE, no audit event, no Storage
--      write, no HTTP request
--   4. scale 0 / 1 / 5 / 20: n elements cost exactly n inserts
--   5. a mixed corpus changes only the EMPTY notes - an EXACT note keeps its
--      row version and is never reconciled
--   6. resume and idempotency without any checkpoint: progress is derived from
--      durable state, and a complete second run is NO_CANDIDATE with zero work
--   7. fail closed. PARTIAL, EXTRA, METADATA_MISMATCH and a row under an
--      emptied note are never selected, never repaired and never turned into a
--      deletion intent; invalid grammar and a duplicate key inside one note are
--      refused by grammar v1 itself; a key another note already owns ends in a
--      clean 23505 - and every one of those refusals hands the client ZERO
--      rows even though its report statement still executes, measured as rows
--      received (:ROW_COUNT), against a success in the same session that hands
--      back exactly one
--   8. the verifier: the blocking set is exactly the twelve S5-gate classes,
--      each goes non-zero on its own injected drift, and STORAGE_OBJECT_MISSING
--      is INFO that never turns the verdict RED
--   9. queue: pending / claimed / failed_retryable / done are reported as a
--      conflict; skipped_live / failed_terminal / no row admit the projection;
--      no queue row is ever modified
--  10. the preflight: GO on a clean historical corpus (even with every storage
--      object missing) and a fail-closed STOP on drift
--  11. isolation: REPEATABLE READ and SERIALIZABLE fail closed
--  12. the read-only CLASSIFICATION: the verifier's pg_temp helper is
--      session-local and has no durable twin, a verifier-shaped CREATE FUNCTION
--      is refused inside BEGIN TRANSACTION READ ONLY (25006), 00_preflight.sql
--      and 20_report.sql both run to completion inside one, and a session
--      without the helper stores no verdict and so can never answer GO
-- 12e. the CENSUS CONTRACT: a helper that exists but does not deliver the
--      canonical thirteen classes - none, too few, renamed, duplicated, one too
--      many, or a blocking class turned non-blocking - is refused before a
--      single count is consumed, so an incomplete classification never becomes
--      GO, not even in a session that just held one
--  13. nothing was left behind
--
-- NOT proven here: real multi-session races, the one-note-per-payload boundary,
-- and the operator result contract across SEPARATE CLIENT PROCESSES - sections
-- 3-9 let the runner share the enclosing test transaction, and a single psql
-- session cannot show that a later connection is irrelevant. All three are
-- proven by attachment_backfill_concurrency_runner.ps1, which feeds the same
-- file to psql in autocommit from separate processes (scenario S1 covers the
-- result contract and the session contract). The runner's post-lock
-- PARTIAL / EXTRA / ROW_FOR_EMPTY_NOTE refusals are defensive: a single session
-- cannot make a note drift between its own lock and its own re-check, and no
-- deployed path writes public.attachments directly (S3A). They are reachable
-- only through the harness, and the structural guarantee stands on its own -
-- reconcile is called only when the note owns ZERO rows, so REMOVE is empty and
-- a DELETE is impossible (asserted by the write counters below).

\set ON_ERROR_STOP on

\if :{?s4dir}
\else
\set s4dir '/tmp/nora_s4'
\endif
\set runner :s4dir '/10_backfill_one_note.sql'
\set preflight :s4dir '/00_preflight.sql'
\set report :s4dir '/20_report.sql'

\echo '=== W8-C S4: historical attachment backfill verification ==='

do $$
begin
    if to_regprocedure('pg_temp.attachment_backfill_findings()') is null then
        raise exception 'run supabase/tests/attachment_backfill_consistency_verification.sql first, in the same session';
    end if;
end;
$$;

-- session-scoped (NOT on commit drop): it has to survive the fixture rollbacks
create temp table s4_probe_err (label text primary key, state text, msg text);

-- ---------------------------------------------------------------------------
-- Session helpers (pg_temp - gone at disconnect)
-- ---------------------------------------------------------------------------
create function pg_temp.s4_el(p_key text, p_title text default 'datei.pdf', p_type text default 'application/pdf')
returns jsonb language sql immutable as $$
    select jsonb_build_object('path', p_key, 'title', p_title, 'type', p_type)
$$;

create function pg_temp.s4_arr(p_prefix text, p_n int)
returns jsonb[] language sql immutable as $$
    select coalesce(array_agg(pg_temp.s4_el(p_prefix || i::text || '.pdf', 'Datei ' || i::text) order by i), '{}'::jsonb[])
      from generate_series(1, p_n) as g(i)
$$;

create function pg_temp.s4_note(p_table text, p_parent bigint)
returns bigint language plpgsql as $$
declare v_id bigint;
begin
    if p_table = 'contact_notes' then
        insert into public.contact_notes (contact_id, text, date) values (p_parent, 'S4', now()) returning id into v_id;
    else
        insert into public.deal_notes (deal_id, text, date) values (p_parent, 'S4', now()) returning id into v_id;
    end if;
    return v_id;
end;
$$;

-- LEGACY (pre-S3B) state: the array is planted with the projection trigger off,
-- so the note carries attachments and owns NO row - exactly what S4 must find.
create function pg_temp.s4_plant_legacy(p_table text, p_id bigint, p_arr jsonb[])
returns void language plpgsql as $$
declare v_trg text := case p_table when 'contact_notes' then 'project_contact_note_attachments_after_update_trigger'
                                   else 'project_deal_note_attachments_after_update_trigger' end;
begin
    execute format('alter table public.%I disable trigger %I', p_table, v_trg);
    execute format('update public.%I set attachments = $1 where id = $2', p_table) using p_arr, p_id;
    execute format('alter table public.%I enable trigger %I', p_table, v_trg);
end;
$$;

-- rows planted without admission, so this session holds no key lock for them
create function pg_temp.s4_plant_rows(p_table text, p_id bigint, p_arr jsonb[])
returns void language plpgsql as $$
begin
    alter table public.attachments disable trigger guard_attachment_reference_admission_after_insert_trigger;
    insert into public.attachments (contact_note_id, deal_note_id, storage_key, file_name, mime_type)
    select case when p_table = 'contact_notes' then p_id end,
           case when p_table = 'deal_notes' then p_id end,
           r.storage_key, r.file_name, r.mime_type
      from nora_private.note_attachment_reference_rows(p_arr) as r;
    alter table public.attachments enable trigger guard_attachment_reference_admission_after_insert_trigger;
end;
$$;

create function pg_temp.s4_keys(p_table text, p_id bigint)
returns text language sql as $$
    select coalesce(string_agg(a.storage_key, ',' order by a.storage_key collate "C"), '')
      from public.attachments a
     where (p_table = 'contact_notes' and a.contact_note_id = p_id)
        or (p_table = 'deal_notes' and a.deal_note_id = p_id)
$$;

-- [attachment ins, del, upd, queue writes, contact_notes writes, deal_notes
--  writes, audit inserts, storage objects, http requests]
create function pg_temp.s4_counters()
returns bigint[] language sql volatile as $$
    select array[
        coalesce((select s.n_tup_ins from pg_stat_xact_user_tables s where s.relid = 'public.attachments'::regclass), 0),
        coalesce((select s.n_tup_del from pg_stat_xact_user_tables s where s.relid = 'public.attachments'::regclass), 0),
        coalesce((select s.n_tup_upd from pg_stat_xact_user_tables s where s.relid = 'public.attachments'::regclass), 0),
        coalesce((select s.n_tup_ins + s.n_tup_upd + s.n_tup_del from pg_stat_xact_user_tables s
                   where s.relid = 'nora_private.attachment_storage_deletion_queue'::regclass), 0),
        coalesce((select s.n_tup_ins + s.n_tup_upd + s.n_tup_del from pg_stat_xact_user_tables s
                   where s.relid = 'public.contact_notes'::regclass), 0),
        coalesce((select s.n_tup_ins + s.n_tup_upd + s.n_tup_del from pg_stat_xact_user_tables s
                   where s.relid = 'public.deal_notes'::regclass), 0),
        coalesce((select s.n_tup_ins from pg_stat_xact_user_tables s where s.relid = 'public.audit_events'::regclass), 0),
        (select count(*) from storage.objects),
        (select count(*) from net.http_request_queue)]::bigint[]
$$;

create function pg_temp.s4_mark()
returns void language sql volatile as $$
    select set_config('nora.s4_test_counters', array_to_string(pg_temp.s4_counters(), ','), false)::void
$$;

create function pg_temp.s4_since()
returns text language sql volatile as $$
    select format('ins=%s del=%s upd=%s queue=%s cnotes=%s dnotes=%s audit=%s storage=%s http=%s',
                  c[1] - b[1], c[2] - b[2], c[3] - b[3], c[4] - b[4], c[5] - b[5],
                  c[6] - b[6], c[7] - b[7], c[8] - b[8], c[9] - b[9])
      from (select string_to_array(current_setting('nora.s4_test_counters'), ',')::bigint[] as b,
                   pg_temp.s4_counters() as c) s
$$;

create function pg_temp.s4_quiet()
returns text language sql volatile as $$
    select 'ins=0 del=0 upd=0 queue=0 cnotes=0 dnotes=0 audit=0 storage=0 http=0'
$$;

create function pg_temp.s4_outcome()
returns text language sql stable as $$
    select coalesce(current_setting('nora.s4_backfill_outcome', true), '<unset>')
$$;

create function pg_temp.s4_class(p_class text)
returns bigint language sql stable as $$
    select f.finding_count from pg_temp.attachment_backfill_findings() f where f.problem_class = p_class
$$;

create function pg_temp.s4_verdict()
returns text language sql stable as $$
    select case when count(*) filter (where f.blocking and f.finding_count > 0) = 0 then 'GREEN' else 'RED' end
      from pg_temp.attachment_backfill_findings() f
$$;

-- INJECT -> measure with the REAL verifier -> undo. The inner block is a
-- subtransaction: raising at its end rolls the injection back, and the handler
-- hands the measurement out through the message.
create function pg_temp.s4_probe(p_sql text)
returns text language plpgsql as $$
declare v_res text;
begin
    begin
        execute p_sql;
        select string_agg(f.problem_class || '=' || f.finding_count::text, ',' order by f.problem_class)
          into v_res
          from pg_temp.attachment_backfill_findings() f
         where f.finding_count > 0;
        raise exception using errcode = 'P0001', message = 'S4PROBE:' || coalesce(v_res, '<none>');
    exception when sqlstate 'P0001' then
        if sqlerrm not like 'S4PROBE:%' then
            raise;
        end if;
        return substr(sqlerrm, 9);
    end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. S4 adds no durable database object
-- ---------------------------------------------------------------------------
do $$
declare
    v_failures text[] := '{}';
    v_names    text;
begin
    select string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname || '.' || p.proname) into v_names
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'nora_private')
       and (p.proname ~* 'backfill' or p.proname ~* '(^|_)s4(_|$)');
    if v_names is not null then
        v_failures := v_failures || format('1a S4 created database function(s): %s', v_names);
    end if;

    select string_agg(n.nspname || '.' || c.relname, ', ' order by n.nspname || '.' || c.relname) into v_names
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public', 'nora_private')
       and c.relkind in ('r', 'v', 'm', 'p')
       and (c.relname ~* 'backfill' or c.relname ~* '(^|_)s4(_|$)'
            or c.relname ~* 'checkpoint' or c.relname ~* 'progress');
    if v_names is not null then
        v_failures := v_failures || format('1b S4 created a table/view (no checkpoint table is allowed): %s', v_names);
    end if;

    select string_agg(t.tgname, ', ' order by t.tgname) into v_names
      from pg_trigger t where not t.tgisinternal and (t.tgname ~* 'backfill' or t.tgname ~* '(^|_)s4(_|$)');
    if v_names is not null then
        v_failures := v_failures || format('1c S4 created trigger(s): %s', v_names);
    end if;

    select string_agg(t.tgname, ', ' order by t.tgname) into v_names
      from pg_trigger t
     where not t.tgisinternal and t.tgfoid = to_regprocedure('nora_private.project_note_attachments()');
    if v_names is distinct from
           'project_contact_note_attachments_after_insert_trigger, project_contact_note_attachments_after_update_trigger, '
        || 'project_deal_note_attachments_after_insert_trigger, project_deal_note_attachments_after_update_trigger' then
        v_failures := v_failures || format('1d the S3B projection triggers changed: %s', coalesce(v_names, '<none>'));
    end if;
    select string_agg(t.tgname, ', ' order by t.tgname) into v_names
      from pg_trigger t where t.tgrelid = 'public.attachments'::regclass and not t.tgisinternal;
    if v_names is distinct from 'enqueue_attachment_storage_deletion_after_delete_trigger, '
                             || 'guard_attachment_reference_admission_after_insert_trigger, '
                             || 'guard_attachment_storage_key_immutable_before_update_trigger' then
        v_failures := v_failures || format('1e the S3A triggers on public.attachments changed: %s', coalesce(v_names, '<none>'));
    end if;

    if not exists (select 1 from pg_proc p
                   where p.oid = to_regprocedure('nora_private.reconcile_note_attachments(bigint,bigint,jsonb[])')
                     and not p.prosecdef and p.provolatile = 'v'
                     and pg_get_userbyid(p.proowner) = 'postgres'
                     and p.proconfig = array['search_path=""', 'row_security=off']) then
        v_failures := array_append(v_failures, '1f the reconcile core is missing or changed');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (no schema change):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  1. S4 introduces no database object: no function, no table (no checkpoint table), no trigger; S3A/S3B objects unchanged';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Security boundary: no API role gains anything
-- ---------------------------------------------------------------------------
do $$
declare
    r          record;
    v_role     text;
    v_state    text;
    v_failures text[] := '{}';
begin
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
        v_state := 'no error';
        begin
            execute format('set local role %I', v_role);
            execute 'select nora_private.reconcile_note_attachments(1, null, null)';
        exception when others then
            v_state := sqlstate;
        end;
        reset role;
        if v_state <> '42501' then
            v_failures := v_failures || format('2a %s can reach the reconcile core: %s', v_role, v_state);
        end if;
    end loop;

    for r in select * from (values ('authenticated', 'SELECT'), ('anon', ''), ('service_role', '')) as t(grantee, privs) loop
        if (select string_agg(pr, ',' order by pr)
              from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) pr
             where has_table_privilege(r.grantee, 'public.attachments', pr)) is distinct from nullif(r.privs, '') then
            v_failures := v_failures || format('2b %s privileges on public.attachments are not %s',
                                               r.grantee, coalesce(nullif(r.privs, ''), 'none'));
        end if;
    end loop;

    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
        if has_schema_privilege(v_role, 'nora_private', 'CREATE')
           or has_table_privilege(v_role, 'nora_private.attachment_storage_deletion_queue', 'SELECT') then
            v_failures := v_failures || format('2c %s reaches the deletion queue', v_role);
        end if;
    end loop;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (security):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  2. security: anon / authenticated / service_role cannot call the core (42501); public.attachments stays SELECT-only for authenticated; the queue stays unreachable';
end;
$$;

-- ---------------------------------------------------------------------------
-- Rolled-back fixture transaction (READ COMMITTED) for sections 3-9
-- ---------------------------------------------------------------------------
begin;

create temp table s4_ctx (key text primary key, value bigint) on commit drop;
create temp table s4_log (id bigserial, step text, outcome text) on commit drop;

do $$
declare v_company bigint; v_contact bigint; v_deal bigint;
begin
    insert into public.companies (name) values ('W8-C S4 Kunde') returning id into v_company;
    insert into public.contacts (first_name, last_name, company_id)
        values ('Back', 'Fill', v_company) returning id into v_contact;
    insert into public.deals (name, company_id, stage)
        values ('W8-C S4 Vorgang', v_company, 'opportunity') returning id into v_deal;
    insert into s4_ctx values ('company', v_company), ('contact', v_contact), ('deal', v_deal);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. One EMPTY contact note: the metadata contract and INSERT-only work
-- ---------------------------------------------------------------------------
do $$
declare v_id bigint;
begin
    v_id := pg_temp.s4_note('contact_notes', (select value from s4_ctx where key = 'contact'));
    -- the second element carries the canonical public src of its own path, the
    -- shape historical notes actually have: grammar v1 accepts it, and the
    -- storage key still comes from `path`, never from `src`
    perform pg_temp.s4_plant_legacy('contact_notes', v_id,
        array[pg_temp.s4_el('s4-a1.pdf', 'Angebot.pdf', 'application/pdf'),
              pg_temp.s4_el('s4-a2.png', 'Foto.png', 'image/png')
                || jsonb_build_object('src', 'http://127.0.0.1:54321/storage/v1/object/public/attachments/s4-a2.png')]);
    insert into s4_ctx values ('n_meta', v_id),
                              ('t0', floor(extract(epoch from clock_timestamp()))::bigint);
    if pg_temp.s4_keys('contact_notes', v_id) <> '' then
        raise exception 'FAIL 3 precondition: the legacy fixture is already projected';
    end if;
    perform pg_temp.s4_mark();
end;
$$;

\i :runner

do $$
declare
    v_id       bigint := (select value from s4_ctx where key = 'n_meta');
    v_diff     text := pg_temp.s4_since();
    v_failures text[] := '{}';
begin
    insert into s4_log (step, outcome) values ('3 meta', pg_temp.s4_outcome());

    -- outcome|note_table|note_id|row_count - row_count is the MEASURED insert
    -- delta, so '2' here is the runner reporting what it actually wrote
    if pg_temp.s4_outcome() <> 'BACKFILLED|contact_notes|' || v_id || '|2' then
        v_failures := v_failures || format('3a outcome %s', pg_temp.s4_outcome());
    end if;
    if v_diff <> 'ins=2 del=0 upd=0 queue=0 cnotes=0 dnotes=0 audit=0 storage=0 http=0' then
        v_failures := v_failures || format('3b the backfill wrote more than the two rows: %s', v_diff);
    end if;
    if not exists (select 1 from public.attachments a
                    where a.storage_key = 's4-a1.pdf' and a.file_name = 'Angebot.pdf'
                      and a.mime_type = 'application/pdf' and a.byte_size is null
                      and a.contact_note_id = v_id and a.deal_note_id is null
                      and a.created_at >= to_timestamp((select value from s4_ctx where key = 't0'))
                      and a.created_at <= clock_timestamp())
       or not exists (select 1 from public.attachments a
                    where a.storage_key = 's4-a2.png' and a.file_name = 'Foto.png'
                      and a.mime_type = 'image/png' and a.byte_size is null
                      and a.contact_note_id = v_id and a.deal_note_id is null) then
        v_failures := array_append(v_failures,
            '3c the projected metadata does not follow path/title/type, byte_size NULL, owner XOR or created_at = row creation time');
    end if;
    if exists (select 1 from public.audit_events e
                where e.event_type in ('contact_note.updated', 'deal_note.updated') and e.note_id = v_id) then
        v_failures := array_append(v_failures, '3d the backfill produced a note audit event');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (metadata):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  3. EMPTY contact note: BACKFILLED, %, storage_key=path / file_name=title / mime_type=type / byte_size NULL / owner XOR / created_at generated, no note UPDATE, no audit event', v_diff;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Scale 0 / 1 / 5 / 20 on deal notes: n elements cost exactly n inserts
-- ---------------------------------------------------------------------------
do $$
declare
    v_id       bigint;
    v_failures text[] := '{}';
begin
    v_id := pg_temp.s4_note('deal_notes', (select value from s4_ctx where key = 'deal'));
    perform pg_temp.s4_plant_legacy('deal_notes', v_id, null);
    if exists (select 1 from public.deal_notes n where n.id = v_id and coalesce(cardinality(n.attachments), 0) > 0) then
        v_failures := array_append(v_failures, '4a a NULL array looks like a candidate');
    end if;
    perform pg_temp.s4_plant_legacy('deal_notes', v_id, '{}'::jsonb[]);
    if exists (select 1 from public.deal_notes n where n.id = v_id and coalesce(cardinality(n.attachments), 0) > 0) then
        v_failures := array_append(v_failures, '4a an empty array looks like a candidate');
    end if;
    insert into s4_ctx values ('n_zero', v_id);

    v_id := pg_temp.s4_note('deal_notes', (select value from s4_ctx where key = 'deal'));
    perform pg_temp.s4_plant_legacy('deal_notes', v_id, pg_temp.s4_arr('s4-one-', 1));
    insert into s4_ctx values ('n_one', v_id);
    v_id := pg_temp.s4_note('deal_notes', (select value from s4_ctx where key = 'deal'));
    perform pg_temp.s4_plant_legacy('deal_notes', v_id, pg_temp.s4_arr('s4-five-', 5));
    insert into s4_ctx values ('n_five', v_id);
    v_id := pg_temp.s4_note('deal_notes', (select value from s4_ctx where key = 'deal'));
    perform pg_temp.s4_plant_legacy('deal_notes', v_id, pg_temp.s4_arr('s4-twenty-', 20));
    insert into s4_ctx values ('n_twenty', v_id);

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (scale fixture):\n%', array_to_string(v_failures, E'\n');
    end if;
    perform pg_temp.s4_mark();
end;
$$;

\i :runner
\i :runner
\i :runner
\i :runner

do $$
declare
    v_diff     text := pg_temp.s4_since();
    v_failures text[] := '{}';
begin
    insert into s4_log (step, outcome) values ('4 scale', pg_temp.s4_outcome());
    if pg_temp.s4_outcome() not like 'NO_CANDIDATE|%' then
        v_failures := v_failures || format('4b the fourth pass did not report NO_CANDIDATE: %s', pg_temp.s4_outcome());
    end if;
    if v_diff <> 'ins=26 del=0 upd=0 queue=0 cnotes=0 dnotes=0 audit=0 storage=0 http=0' then
        v_failures := v_failures || format('4c 1/5/20 attachments did not cost exactly 26 inserts: %s', v_diff);
    end if;
    if pg_temp.s4_keys('deal_notes', (select value from s4_ctx where key = 'n_zero')) <> ''
       or (select count(*) from public.attachments where deal_note_id = (select value from s4_ctx where key = 'n_one')) <> 1
       or (select count(*) from public.attachments where deal_note_id = (select value from s4_ctx where key = 'n_five')) <> 5
       or (select count(*) from public.attachments where deal_note_id = (select value from s4_ctx where key = 'n_twenty')) <> 20 then
        v_failures := array_append(v_failures, '4d the per-note row counts are not 0 / 1 / 5 / 20');
    end if;
    if pg_temp.s4_class('BACKFILL_CANDIDATE_REMAINING') <> 0 then
        v_failures := array_append(v_failures, '4e the verifier still sees a backfill candidate');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (scale):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  4. scale on deal notes: 0 elements is no candidate; 1 / 5 / 20 elements cost exactly n inserts (%); fourth pass NO_CANDIDATE', v_diff;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Mixed corpus: EXACT notes are never touched, only EMPTY ones change
-- ---------------------------------------------------------------------------
do $$
declare v_exact bigint; v_empty bigint;
begin
    v_exact := pg_temp.s4_note('contact_notes', (select value from s4_ctx where key = 'contact'));
    perform pg_temp.s4_plant_legacy('contact_notes', v_exact, array[pg_temp.s4_el('s4-exact.pdf')]);
    perform pg_temp.s4_plant_rows('contact_notes', v_exact, array[pg_temp.s4_el('s4-exact.pdf')]);
    v_empty := pg_temp.s4_note('contact_notes', (select value from s4_ctx where key = 'contact'));
    perform pg_temp.s4_plant_legacy('contact_notes', v_empty, array[pg_temp.s4_el('s4-mix.pdf')]);
    insert into s4_ctx values ('n_exact', v_exact), ('n_empty', v_empty);
    perform set_config('nora.s4_test_xmin',
        (select a.xmin::text from public.attachments a where a.storage_key = 's4-exact.pdf'), false);
    perform pg_temp.s4_mark();
end;
$$;

\i :runner
\i :runner

do $$
declare
    v_diff     text := pg_temp.s4_since();
    v_failures text[] := '{}';
begin
    insert into s4_log (step, outcome) values ('5 mixed', pg_temp.s4_outcome());
    if pg_temp.s4_outcome() not like 'NO_CANDIDATE|%' then
        v_failures := v_failures || format('5a the second pass is not NO_CANDIDATE: %s', pg_temp.s4_outcome());
    end if;
    if v_diff <> 'ins=1 del=0 upd=0 queue=0 cnotes=0 dnotes=0 audit=0 storage=0 http=0' then
        v_failures := v_failures || format('5b a mixed corpus did more than one insert: %s', v_diff);
    end if;
    if (select a.xmin::text from public.attachments a where a.storage_key = 's4-exact.pdf')
       is distinct from current_setting('nora.s4_test_xmin') then
        v_failures := array_append(v_failures, '5c the EXACT note''s row was rewritten');
    end if;
    if pg_temp.s4_keys('contact_notes', (select value from s4_ctx where key = 'n_empty')) <> 's4-mix.pdf' then
        v_failures := array_append(v_failures, '5d the EMPTY note was not backfilled');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (mixed corpus):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  5. mixed corpus: only the EMPTY note changed (%), the EXACT note kept its row version and was never reconciled', v_diff;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Resume and idempotency without any checkpoint
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.s4_mark(); end; $$;

\i :runner

do $$
declare v_failures text[] := '{}';
begin
    insert into s4_log (step, outcome) values ('6 idempotent', pg_temp.s4_outcome());
    if pg_temp.s4_outcome() not like 'NO_CANDIDATE|%' then
        v_failures := v_failures || format('6a a complete second run is not NO_CANDIDATE: %s', pg_temp.s4_outcome());
    end if;
    if pg_temp.s4_since() <> pg_temp.s4_quiet() then
        v_failures := v_failures || format('6b a complete second run wrote something: %s', pg_temp.s4_since());
    end if;
    if pg_temp.s4_class('BACKFILL_CANDIDATE_REMAINING') <> 0 or pg_temp.s4_class('JSON_KEY_WITHOUT_ROW') <> 0 then
        v_failures := array_append(v_failures, '6c the verifier does not agree that the corpus is drained');
    end if;
    if (select count(*) from s4_log) <> 4 then
        v_failures := v_failures || format('6d expected four recorded passes, got %s', (select count(*) from s4_log));
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (idempotency):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  6. resume / idempotency: the corpus drained across interrupted passes with no checkpoint table (progress is derived from durable state); a complete second run is NO_CANDIDATE and writes nothing';
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Fail closed
--
-- 7a-7c: PARTIAL, EXTRA and METADATA_MISMATCH notes already OWN a row, so the
-- candidate predicate never picks them up. That is the refusal: the runner
-- leaves them alone, repairs nothing, deletes nothing and captures no deletion
-- intent - and the preflight (section 10) is what stops the operator.
-- ---------------------------------------------------------------------------
do $$
declare
    v_partial bigint;
    v_extra   bigint;
    v_mism    bigint;
begin
    v_partial := pg_temp.s4_note('contact_notes', (select value from s4_ctx where key = 'contact'));
    perform pg_temp.s4_plant_legacy('contact_notes', v_partial,
        array[pg_temp.s4_el('s4-part1.pdf'), pg_temp.s4_el('s4-part2.pdf')]);
    perform pg_temp.s4_plant_rows('contact_notes', v_partial, array[pg_temp.s4_el('s4-part1.pdf')]);

    v_extra := pg_temp.s4_note('contact_notes', (select value from s4_ctx where key = 'contact'));
    perform pg_temp.s4_plant_legacy('contact_notes', v_extra, array[pg_temp.s4_el('s4-extra-ok.pdf')]);
    perform pg_temp.s4_plant_rows('contact_notes', v_extra,
        array[pg_temp.s4_el('s4-extra-ok.pdf'), pg_temp.s4_el('s4-extra-ghost.pdf')]);

    v_mism := pg_temp.s4_note('contact_notes', (select value from s4_ctx where key = 'contact'));
    perform pg_temp.s4_plant_legacy('contact_notes', v_mism, array[pg_temp.s4_el('s4-mm.pdf', 'Neu.pdf')]);
    perform pg_temp.s4_plant_rows('contact_notes', v_mism, array[pg_temp.s4_el('s4-mm.pdf', 'Alt.pdf')]);

    insert into s4_ctx values ('n_partial', v_partial), ('n_extra', v_extra), ('n_mismatch', v_mism);
    perform pg_temp.s4_mark();
end;
$$;

\i :runner

do $$
declare
    v_failures text[] := '{}';
begin
    if pg_temp.s4_outcome() not like 'NO_CANDIDATE|%' then
        v_failures := v_failures || format('7a drifted notes were picked up: %s', pg_temp.s4_outcome());
    end if;
    if pg_temp.s4_since() <> pg_temp.s4_quiet() then
        v_failures := v_failures || format('7a the pass over drifted notes wrote something: %s', pg_temp.s4_since());
    end if;
    -- nothing repaired, nothing deleted, and above all: no deletion intent
    if pg_temp.s4_keys('contact_notes', (select value from s4_ctx where key = 'n_partial')) <> 's4-part1.pdf'
       or pg_temp.s4_keys('contact_notes', (select value from s4_ctx where key = 'n_extra'))
          <> 's4-extra-ghost.pdf,s4-extra-ok.pdf'
       or (select a.file_name from public.attachments a where a.storage_key = 's4-mm.pdf') <> 'Alt.pdf' then
        v_failures := array_append(v_failures, '7a a drifted note was modified');
    end if;
    if exists (select 1 from nora_private.attachment_storage_deletion_queue) then
        v_failures := array_append(v_failures, '7a drift produced a deletion intent');
    end if;
    -- the verifier names all three, so the preflight will STOP
    if pg_temp.s4_class('JSON_KEY_WITHOUT_ROW') <> 1
       or pg_temp.s4_class('ROW_WITHOUT_JSON_KEY') <> 1
       or pg_temp.s4_class('METADATA_MISMATCH') <> 1 then
        v_failures := v_failures || format('7a the verifier does not report all three (PARTIAL=%s EXTRA=%s MISMATCH=%s)',
                                           pg_temp.s4_class('JSON_KEY_WITHOUT_ROW'),
                                           pg_temp.s4_class('ROW_WITHOUT_JSON_KEY'),
                                           pg_temp.s4_class('METADATA_MISMATCH'));
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (drift):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  7a. PARTIAL / EXTRA / METADATA_MISMATCH: never selected, never repaired, no DELETE and no deletion intent; the verifier reports each one';
end;
$$;

-- 7b-7e (invalid grammar, duplicate key in one note, key owned by another note,
-- active deletion intent) need to observe the RUNNER'S OWN ERROR and therefore
-- run in autocommit, after this transaction is rolled back. See the section of
-- that name below section 9.
--
-- Undo 7a's drift so section 8 starts from a clean corpus.
do $$
begin
    perform pg_temp.s4_plant_legacy('contact_notes', (select value from s4_ctx where key = 'n_partial'), null);
    delete from public.attachments where contact_note_id = (select value from s4_ctx where key = 'n_partial');
    perform pg_temp.s4_plant_legacy('contact_notes', (select value from s4_ctx where key = 'n_extra'), null);
    delete from public.attachments where contact_note_id = (select value from s4_ctx where key = 'n_extra');
    perform pg_temp.s4_plant_legacy('contact_notes', (select value from s4_ctx where key = 'n_mismatch'), null);
    delete from public.attachments where contact_note_id = (select value from s4_ctx where key = 'n_mismatch');
    delete from nora_private.attachment_storage_deletion_queue;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. The verifier itself: every blocking class RED on its own drift
-- ---------------------------------------------------------------------------
do $$
declare
    v_set      text;
    v_res      text;
    v_note     text := (select value::text from s4_ctx where key = 'n_meta');
    v_deal     text := (select value::text from s4_ctx where key = 'n_one');
    v_failures text[] := '{}';
begin
    select string_agg(f.problem_class || '=' || f.finding_count::text, ',' order by f.problem_class) into v_set
      from pg_temp.attachment_backfill_findings() f where f.blocking and f.finding_count > 0;
    if v_set is not null then
        raise exception 'FAIL 8 precondition: the corpus is not clean: %', v_set;
    end if;

    -- the blocking set IS the S5 gate: exactly these twelve, no more, no fewer
    select string_agg(f.problem_class, ',' order by f.problem_class) into v_set
      from pg_temp.attachment_backfill_findings() f where f.blocking;
    if v_set <> 'BACKFILL_CANDIDATE_REMAINING,BYTE_SIZE_NOT_NULL,CROSS_SOURCE_KEY,DUPLICATE_KEY_ACROSS_NOTES,'
              || 'DUPLICATE_KEY_IN_NOTE,INVALID_GRAMMAR,JSON_KEY_WITHOUT_ROW,METADATA_MISMATCH,QUEUE_CONFLICT,'
              || 'ROW_FOR_EMPTY_NOTE,ROW_WITHOUT_JSON_KEY,WRONG_OWNER' then
        v_failures := v_failures || format('8a the blocking class set is not the S5 gate: %s', v_set);
    end if;
    select string_agg(f.problem_class, ',' order by f.problem_class) into v_set
      from pg_temp.attachment_backfill_findings() f where not f.blocking;
    if v_set <> 'STORAGE_OBJECT_MISSING' then
        v_failures := v_failures || format('8a the INFO class set is not exactly STORAGE_OBJECT_MISSING: %s', v_set);
    end if;

    -- one injection per class; the probe rolls each one back again
    v_res := pg_temp.s4_probe(format(
        'alter table public.contact_notes disable trigger project_contact_note_attachments_after_update_trigger; '
        || 'update public.contact_notes set attachments = array[''{"title":"x"}''::jsonb] where id = %s', v_note));
    if v_res not like '%INVALID_GRAMMAR=1%' then v_failures := v_failures || format('8b INVALID_GRAMMAR: %s', v_res); end if;

    v_res := pg_temp.s4_probe(format(
        'alter table public.contact_notes disable trigger project_contact_note_attachments_after_update_trigger; '
        || 'update public.contact_notes set attachments = array[pg_temp.s4_el(''s4-p.pdf''), pg_temp.s4_el(''s4-p.pdf'')] '
        || 'where id = %s', v_note));
    if v_res not like '%DUPLICATE_KEY_IN_NOTE=1%' then v_failures := v_failures || format('8c DUPLICATE_KEY_IN_NOTE: %s', v_res); end if;

    v_res := pg_temp.s4_probe(format(
        'alter table public.deal_notes disable trigger project_deal_note_attachments_after_update_trigger; '
        || 'update public.deal_notes set attachments = array[pg_temp.s4_el(''s4-a1.pdf'', ''Angebot.pdf'')] where id = %s', v_deal));
    if v_res not like '%DUPLICATE_KEY_ACROSS_NOTES=1%' then v_failures := v_failures || format('8d DUPLICATE_KEY_ACROSS_NOTES: %s', v_res); end if;

    v_res := pg_temp.s4_probe(format(
        'delete from public.attachments where contact_note_id = %s and storage_key = ''s4-a2.png''', v_note));
    if v_res not like '%JSON_KEY_WITHOUT_ROW=1%' then v_failures := v_failures || format('8e JSON_KEY_WITHOUT_ROW: %s', v_res); end if;

    v_res := pg_temp.s4_probe(format(
        'insert into public.attachments (contact_note_id, storage_key, file_name, mime_type) '
        || 'values (%s, ''s4-ghost.pdf'', ''g.pdf'', ''application/pdf'')', v_note));
    if v_res not like '%ROW_WITHOUT_JSON_KEY=1%' then v_failures := v_failures || format('8f ROW_WITHOUT_JSON_KEY: %s', v_res); end if;

    v_res := pg_temp.s4_probe(format(
        'update public.attachments set contact_note_id = null, deal_note_id = %s '
        || 'where contact_note_id = %s and storage_key = ''s4-a2.png''', v_deal, v_note));
    if v_res not like '%WRONG_OWNER=1%' then v_failures := v_failures || format('8g WRONG_OWNER: %s', v_res); end if;

    v_res := pg_temp.s4_probe(format(
        'update public.attachments set file_name = ''anders.pdf'' where contact_note_id = %s and storage_key = ''s4-a1.pdf''', v_note));
    if v_res not like '%METADATA_MISMATCH=1%' then v_failures := v_failures || format('8h METADATA_MISMATCH: %s', v_res); end if;

    v_res := pg_temp.s4_probe(format(
        'alter table public.contact_notes disable trigger project_contact_note_attachments_after_update_trigger; '
        || 'update public.contact_notes set attachments = null where id = %s', v_note));
    if v_res not like '%ROW_FOR_EMPTY_NOTE=2%' then v_failures := v_failures || format('8i ROW_FOR_EMPTY_NOTE: %s', v_res); end if;

    v_res := pg_temp.s4_probe(
        'insert into nora_private.attachment_storage_deletion_queue (storage_key) values (''s4-a1.pdf'')');
    if v_res not like '%QUEUE_CONFLICT=1%' then v_failures := v_failures || format('8j QUEUE_CONFLICT: %s', v_res); end if;

    v_res := pg_temp.s4_probe('update public.attachments set byte_size = 4711 where storage_key = ''s4-a1.pdf''');
    if v_res not like '%BYTE_SIZE_NOT_NULL=1%' then v_failures := v_failures || format('8k BYTE_SIZE_NOT_NULL: %s', v_res); end if;

    v_res := pg_temp.s4_probe(format(
        'update public.companies set logo = jsonb_build_object(''path'', ''s4-a1.pdf'') where id = %s',
        (select value from s4_ctx where key = 'company')));
    if v_res not like '%CROSS_SOURCE_KEY=1%' then v_failures := v_failures || format('8l CROSS_SOURCE_KEY (companies.logo): %s', v_res); end if;

    v_res := pg_temp.s4_probe(format(
        'update public.contacts set avatar = jsonb_build_object(''path'', ''s4-a1.pdf'') where id = %s',
        (select value from s4_ctx where key = 'contact')));
    if v_res not like '%CROSS_SOURCE_KEY=1%' then v_failures := v_failures || format('8l CROSS_SOURCE_KEY (contacts.avatar): %s', v_res); end if;

    v_res := pg_temp.s4_probe(format('delete from public.attachments where contact_note_id = %s', v_note));
    if v_res not like '%BACKFILL_CANDIDATE_REMAINING=1%' then v_failures := v_failures || format('8m BACKFILL_CANDIDATE_REMAINING: %s', v_res); end if;

    -- every injection was undone
    select string_agg(f.problem_class || '=' || f.finding_count::text, ',' order by f.problem_class) into v_set
      from pg_temp.attachment_backfill_findings() f where f.blocking and f.finding_count > 0;
    if v_set is not null then
        v_failures := v_failures || format('8n an injection leaked: %s', v_set);
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (verifier coverage):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  8. verifier coverage: the blocking set is exactly the twelve S5-gate classes plus INFO STORAGE_OBJECT_MISSING; each of the twelve goes non-zero on its own injected drift and back to zero when it is undone';
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Queue states and the Storage INFO class
-- ---------------------------------------------------------------------------
do $$
declare
    r          record;
    v_id       bigint;
    v_key      text;
    v_job      text;
    v_failures text[] := '{}';
begin
    for r in
        select * from (values ('pending', true), ('claimed', true), ('failed_retryable', true), ('done', true),
                              ('skipped_live', false), ('failed_terminal', false), ('none', false)) as t(label, blocks)
    loop
        v_key := 's4-q-' || r.label || '.pdf';
        if r.label = 'pending' then
            insert into nora_private.attachment_storage_deletion_queue (storage_key) values (v_key);
        elsif r.label = 'claimed' then
            insert into nora_private.attachment_storage_deletion_queue (storage_key, state, attempt_count, claimed_at, claimed_by)
                values (v_key, 'claimed', 1, now(), gen_random_uuid()::text);
        elsif r.label = 'failed_retryable' then
            insert into nora_private.attachment_storage_deletion_queue (storage_key, state, attempt_count, last_error_code, last_error_at)
                values (v_key, 'failed_retryable', 1, 'NORA_ATTACHMENT_LEASE_EXPIRED', now());
        elsif r.label in ('done', 'skipped_live', 'failed_terminal') then
            insert into nora_private.attachment_storage_deletion_queue (storage_key, state, completed_at)
                values (v_key, r.label, now());
        end if;

        v_id := pg_temp.s4_note('contact_notes', (select value from s4_ctx where key = 'contact'));
        perform pg_temp.s4_plant_legacy('contact_notes', v_id, array[pg_temp.s4_el(v_key)]);
        -- the PRE-EXISTING job, identified by id: the test's own cleanup below
        -- deletes an attachment row and that legitimately captures a NEW intent
        select string_agg(format('%s/%s/%s/%s', q.id, q.state, q.attempt_count, coalesce(q.claimed_by, '-')), ',')
          into v_job
          from nora_private.attachment_storage_deletion_queue q where q.storage_key = v_key;

        if pg_temp.s4_class('QUEUE_CONFLICT') <> (case when r.blocks then 1 else 0 end) then
            v_failures := v_failures || format('9a %s: QUEUE_CONFLICT = %s, expected %s', r.label,
                                               pg_temp.s4_class('QUEUE_CONFLICT'),
                                               case when r.blocks then 1 else 0 end);
        end if;

        if not r.blocks then
            -- an allowed queue history must not stand in the way of the projection
            perform nora_private.reconcile_note_attachments(v_id, null, array[pg_temp.s4_el(v_key)]);
            if pg_temp.s4_keys('contact_notes', v_id) <> v_key then
                v_failures := v_failures || format('9a %s: an allowed queue history blocked the projection', r.label);
            end if;
            delete from public.attachments where contact_note_id = v_id;
        end if;
        perform pg_temp.s4_plant_legacy('contact_notes', v_id, null);

        if v_job is not null
           and (select string_agg(format('%s/%s/%s/%s', q.id, q.state, q.attempt_count, coalesce(q.claimed_by, '-')), ',')
                  from nora_private.attachment_storage_deletion_queue q
                 where q.storage_key = v_key
                   and q.id <= (select max(split_part(j, '/', 1)::bigint) from unnest(string_to_array(v_job, ',')) j))
               is distinct from v_job then
            v_failures := v_failures || format('9a %s: the pre-existing queue row changed', r.label);
        end if;
        delete from nora_private.attachment_storage_deletion_queue;
    end loop;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (queue):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  9a. queue: pending / claimed / failed_retryable / done are reported as QUEUE_CONFLICT; skipped_live / failed_terminal / no row admit the projection; no queue row is ever modified';
end;
$$;

do $$
declare
    v_missing  bigint;
    v_failures text[] := '{}';
begin
    v_missing := pg_temp.s4_class('STORAGE_OBJECT_MISSING');
    if v_missing = 0 then
        v_failures := array_append(v_failures, '9b no desired key is missing its object - the INFO class is untested here');
    end if;
    if pg_temp.s4_verdict() <> 'GREEN' then
        v_failures := v_failures || format('9b missing storage objects turned the verdict %s', pg_temp.s4_verdict());
    end if;

    -- an object that DOES exist is not counted. The row is only rolled back
    -- with the surrounding transaction: storage refuses a direct DELETE, and S4
    -- never deletes a Storage object anyway.
    insert into storage.objects (bucket_id, name) values ('attachments', 's4-a1.pdf');
    if pg_temp.s4_class('STORAGE_OBJECT_MISSING') >= v_missing then
        v_failures := array_append(v_failures, '9b planting the object did not reduce STORAGE_OBJECT_MISSING');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (storage INFO):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  9b. STORAGE_OBJECT_MISSING is INFO: % desired key(s) have no object and the verdict is still GREEN; an object that exists is not counted', v_missing;
end;
$$;

rollback;

-- ---------------------------------------------------------------------------
-- 7b-7e. Fail closed, in the PRODUCTION EXECUTION SHAPE (autocommit).
--
-- WHY NOT INSIDE THE FIXTURE TRANSACTION: the runner payload is arm -> work ->
-- report. If the work statement fails inside an explicit transaction, the
-- report statement hits an already-aborted transaction and psql records 25P02
-- instead of the refusal under test. In autocommit - exactly how an operator
-- runs it - the work statement's error IS the last error, and the report
-- statement then returns ZERO ROWS because the arm statement already committed
-- an empty variable. So this section proves two things at once: the refusal is
-- the documented SQLSTATE, and a FAILURE CAN NEVER SURFACE AS AN OUTCOME ROW.
--
-- The fixtures are therefore committed and removed again explicitly; section 12
-- re-asserts globally that nothing survived.
-- ---------------------------------------------------------------------------
\echo '--- 7b-7e. refusals in autocommit ---'

do $$
declare v_co bigint; v_ct bigint;
begin
    insert into public.companies (name) values ('W8-C S4 Fehlerprobe') returning id into v_co;
    insert into public.contacts (first_name, last_name, company_id)
        values ('Fehl', 'Probe', v_co) returning id into v_ct;
    perform set_config('nora.s4_probe_contact', v_ct::text, false);
    if exists (select 1 from public.contact_notes where coalesce(cardinality(attachments), 0) > 0)
       or exists (select 1 from public.deal_notes where coalesce(cardinality(attachments), 0) > 0) then
        raise exception 'FAIL 7b precondition: a foreign candidate would be picked instead of this fixture';
    end if;
end;
$$;

-- 7b invalid grammar: the note IS a candidate, and grammar v1 itself refuses it
do $$
declare v_id bigint;
begin
    v_id := pg_temp.s4_note('contact_notes', current_setting('nora.s4_probe_contact')::bigint);
    perform pg_temp.s4_plant_legacy('contact_notes', v_id,
        array['{"src":"https://example.com/import/x.pdf","title":"import.pdf"}'::jsonb]);
    perform set_config('nora.s4_probe_note', v_id::text, false);
end;
$$;

-- :ROW_COUNT is captured FIRST and is the load-bearing assertion of this
-- section: it is how many rows the LAST statement of the payload - the report
-- SELECT - actually handed back, observed from the client, not inferred from a
-- session variable. In this shape (autocommit, ON_ERROR_STOP off) the report
-- statement still RUNS after the work statement failed, so a report filter that
-- ever synthesised an outcome would show up here as 1. Section 7f supplies the
-- positive control that proves a captured 0 means something.
\set ON_ERROR_STOP off
\i :runner
\set rows :ROW_COUNT
\set st :LAST_ERROR_SQLSTATE
\set ms :LAST_ERROR_MESSAGE
\set ON_ERROR_STOP on
delete from s4_probe_err where label = 'INVALID_JSON';
insert into s4_probe_err values ('INVALID_JSON', :'st', :'ms');
insert into s4_probe_err values ('INVALID_JSON_ROWS', :'rows', '');
insert into s4_probe_err values ('INVALID_JSON_OUT', coalesce(current_setting('nora.s4_backfill_outcome', true), '<unset>'),
                                 pg_temp.s4_keys('contact_notes', current_setting('nora.s4_probe_note')::bigint));

-- 7c the same key twice in one note
do $$
declare v_id bigint;
begin
    perform pg_temp.s4_plant_legacy('contact_notes', current_setting('nora.s4_probe_note')::bigint, null);
    v_id := pg_temp.s4_note('contact_notes', current_setting('nora.s4_probe_contact')::bigint);
    perform pg_temp.s4_plant_legacy('contact_notes', v_id,
        array[pg_temp.s4_el('s4-dup.pdf'), pg_temp.s4_el('s4-dup.pdf')]);
    perform set_config('nora.s4_probe_note', v_id::text, false);
end;
$$;

\set ON_ERROR_STOP off
\i :runner
\set rows :ROW_COUNT
\set st :LAST_ERROR_SQLSTATE
\set ms :LAST_ERROR_MESSAGE
\set ON_ERROR_STOP on
delete from s4_probe_err where label = 'DUPLICATE_IN_NOTE';
insert into s4_probe_err values ('DUPLICATE_IN_NOTE', :'st', :'ms');
insert into s4_probe_err values ('DUPLICATE_IN_NOTE_ROWS', :'rows', '');
insert into s4_probe_err values ('DUPLICATE_IN_NOTE_OUT', coalesce(current_setting('nora.s4_backfill_outcome', true), '<unset>'),
                                 pg_temp.s4_keys('contact_notes', current_setting('nora.s4_probe_note')::bigint));

-- 7d a key another note already owns: a clean 23505, nothing half-written
do $$
declare v_owner bigint; v_id bigint;
begin
    perform pg_temp.s4_plant_legacy('contact_notes', current_setting('nora.s4_probe_note')::bigint, null);
    -- the owner is projected normally, so it owns the row and is no candidate
    v_owner := pg_temp.s4_note('contact_notes', current_setting('nora.s4_probe_contact')::bigint);
    update public.contact_notes set attachments = array[pg_temp.s4_el('s4-taken.pdf')] where id = v_owner;
    v_id := pg_temp.s4_note('contact_notes', current_setting('nora.s4_probe_contact')::bigint);
    perform pg_temp.s4_plant_legacy('contact_notes', v_id, array[pg_temp.s4_el('s4-taken.pdf')]);
    perform set_config('nora.s4_probe_note', v_id::text, false);
    perform set_config('nora.s4_probe_owner', v_owner::text, false);
end;
$$;

\set ON_ERROR_STOP off
\i :runner
\set rows :ROW_COUNT
\set st :LAST_ERROR_SQLSTATE
\set ms :LAST_ERROR_MESSAGE
\set ON_ERROR_STOP on
delete from s4_probe_err where label = 'KEY_TAKEN';
insert into s4_probe_err values ('KEY_TAKEN', :'st', :'ms');
insert into s4_probe_err values ('KEY_TAKEN_ROWS', :'rows', '');
insert into s4_probe_err values ('KEY_TAKEN_OUT', coalesce(current_setting('nora.s4_backfill_outcome', true), '<unset>'),
                                 pg_temp.s4_keys('contact_notes', current_setting('nora.s4_probe_note')::bigint));

-- 7e a candidate whose key carries an ACTIVE deletion intent: S3A admission
-- refuses the insert, the whole transaction rolls back, and the runner repairs
-- NOTHING in the queue
do $$
declare v_id bigint;
begin
    perform pg_temp.s4_plant_legacy('contact_notes', current_setting('nora.s4_probe_note')::bigint, null);
    v_id := pg_temp.s4_note('contact_notes', current_setting('nora.s4_probe_contact')::bigint);
    perform pg_temp.s4_plant_legacy('contact_notes', v_id, array[pg_temp.s4_el('s4-blocked.pdf')]);
    perform set_config('nora.s4_probe_note', v_id::text, false);
    insert into nora_private.attachment_storage_deletion_queue (storage_key) values ('s4-blocked.pdf');
    perform set_config('nora.s4_test_job',
        (select format('%s/%s/%s', q.id, q.state, q.attempt_count)
           from nora_private.attachment_storage_deletion_queue q where q.storage_key = 's4-blocked.pdf'), false);
end;
$$;

\set ON_ERROR_STOP off
\i :runner
\set rows :ROW_COUNT
\set st :LAST_ERROR_SQLSTATE
\set ms :LAST_ERROR_MESSAGE
\set ON_ERROR_STOP on
delete from s4_probe_err where label = 'QUEUE_BLOCKED';
insert into s4_probe_err values ('QUEUE_BLOCKED', :'st', :'ms');
insert into s4_probe_err values ('QUEUE_BLOCKED_ROWS', :'rows', '');
insert into s4_probe_err values ('QUEUE_BLOCKED_OUT', coalesce(current_setting('nora.s4_backfill_outcome', true), '<unset>'),
                                 pg_temp.s4_keys('contact_notes', current_setting('nora.s4_probe_note')::bigint));

do $$
declare
    v_failures text[] := '{}';
    r          record;
    v_label    text;
begin
    select * into r from s4_probe_err where label = 'INVALID_JSON';
    if r.state <> '22023' or r.msg not like '%note attachment reference rejected%' or r.msg not like '%element 1%' then
        v_failures := v_failures || format('7b invalid grammar was not refused by grammar v1: %s / %s', r.state, r.msg);
    end if;
    select * into r from s4_probe_err where label = 'DUPLICATE_IN_NOTE';
    if r.state <> '22023' or r.msg not like '%repeats the storage key%' then
        v_failures := v_failures || format('7c a duplicate key in one note was not refused: %s / %s', r.state, r.msg);
    end if;
    select * into r from s4_probe_err where label = 'KEY_TAKEN';
    if r.state <> '23505' or r.msg not like '%uq__attachments__storage_key%' then
        v_failures := v_failures || format('7d a key owned by another note did not end in a clean 23505: %s / %s', r.state, r.msg);
    end if;
    select * into r from s4_probe_err where label = 'QUEUE_BLOCKED';
    -- psql exposes the SQLSTATE and the MESSAGE, not the DETAIL that carries
    -- the canonical code NORA_ATTACHMENT_STORAGE_KEY_PENDING_DELETION
    if r.state <> '55000' or r.msg not like '%deletion intent%' then
        v_failures := v_failures || format('7e an active deletion intent did not refuse the backfill: %s / %s', r.state, r.msg);
    end if;

    -- F-1, THE RETURNED ROW ITSELF. Every refusal above ran in the one shape
    -- where the report statement still executes after the work statement
    -- failed, and each one handed the client ZERO rows. This is the operator
    -- contract observed where the operator observes it - not the session
    -- variable, not the NOTICE, not the exit code. A report statement that
    -- invented `NO_CANDIDATE|||0` out of an empty variable would surface here
    -- as 1 row, and a failure would then be indistinguishable from a drained
    -- corpus - the one confusion that stops a backfill early.
    foreach v_label in array array['INVALID_JSON_ROWS', 'DUPLICATE_IN_NOTE_ROWS', 'KEY_TAKEN_ROWS', 'QUEUE_BLOCKED_ROWS'] loop
        select * into r from s4_probe_err where label = v_label;
        if r.state is distinct from '0' then
            v_failures := v_failures || format('%s a FAILED invocation returned %s outcome row(s); it must return none', v_label, coalesce(r.state, '<not captured>'));
        end if;
    end loop;

    -- the same four, seen from the other side: the transport variable was left
    -- empty, which is WHY the report statement had nothing to return.
    foreach v_label in array array['INVALID_JSON_OUT', 'DUPLICATE_IN_NOTE_OUT', 'KEY_TAKEN_OUT', 'QUEUE_BLOCKED_OUT'] loop
        select * into r from s4_probe_err where label = v_label;
        if r.state <> '' then
            v_failures := v_failures || format('%s a failed invocation left a reportable outcome: %s', v_label, r.state);
        end if;
        if r.msg <> '' then
            v_failures := v_failures || format('%s a refused run left an attachment row behind: %s', v_label, r.msg);
        end if;
    end loop;

    -- the owner row of 7d survived untouched, and only 7e's deliberate intent exists
    if (select count(*) from public.attachments where storage_key = 's4-taken.pdf') <> 1
       or pg_temp.s4_keys('contact_notes', current_setting('nora.s4_probe_owner')::bigint) <> 's4-taken.pdf' then
        v_failures := array_append(v_failures, '7d the refused run disturbed the note that owns the key');
    end if;
    if (select format('%s/%s/%s', q.id, q.state, q.attempt_count)
          from nora_private.attachment_storage_deletion_queue q where q.storage_key = 's4-blocked.pdf')
       is distinct from current_setting('nora.s4_test_job') then
        v_failures := array_append(v_failures, '7e the runner repaired, retried or withdrew the queue row');
    end if;
    if (select count(*) from nora_private.attachment_storage_deletion_queue) <> 1 then
        v_failures := array_append(v_failures, '7b-e a refused run produced or removed a deletion intent');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (refusals):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  7b-e. in autocommit: invalid grammar (22023, element named), duplicate key in one note (22023), key owned by another note (23505 on uq__attachments__storage_key), active deletion intent (55000) — each rolls back completely, writes nothing, captures no intent, does not touch the queue, and each RETURNED EXACTLY ZERO ROWS to the client although its report statement did execute';
end;
$$;

-- 7f. THE STALE-OUTCOME TRAP: one session, a SUCCESS followed by a FAILURE.
--
-- This is the shape that makes a session-carried result dangerous, and the only
-- shape that exercises the runner's arm statement. A GUC write is transactional,
-- so the failing invocation's rollback would restore the PREVIOUS invocation's
-- committed outcome - and the report statement would hand the operator an older
-- note's BACKFILLED as if it were this one's. Neither a rolled-back fixture
-- transaction nor a fresh process can show this: both start from an empty
-- variable, so only a committed success followed by a failure in the SAME
-- session proves the arm statement is load-bearing.
do $$
declare v_id bigint;
begin
    perform pg_temp.s4_plant_legacy('contact_notes', current_setting('nora.s4_probe_note')::bigint, null);
    delete from nora_private.attachment_storage_deletion_queue;
    v_id := pg_temp.s4_note('contact_notes', current_setting('nora.s4_probe_contact')::bigint);
    perform pg_temp.s4_plant_legacy('contact_notes', v_id, array[pg_temp.s4_el('s4-ok.pdf')]);
    perform set_config('nora.s4_probe_note', v_id::text, false);
end;
$$;

\i :runner
\set rows :ROW_COUNT
delete from s4_probe_err where label = 'STALE_BEFORE';
insert into s4_probe_err values ('STALE_BEFORE', coalesce(current_setting('nora.s4_backfill_outcome', true), '<unset>'), :'rows');

do $$
declare v_id bigint;
begin
    v_id := pg_temp.s4_note('contact_notes', current_setting('nora.s4_probe_contact')::bigint);
    perform pg_temp.s4_plant_legacy('contact_notes', v_id, array[pg_temp.s4_el('s4-stale.pdf')]);
    insert into nora_private.attachment_storage_deletion_queue (storage_key) values ('s4-stale.pdf');
end;
$$;

\set ON_ERROR_STOP off
\i :runner
\set rows :ROW_COUNT
\set ON_ERROR_STOP on
delete from s4_probe_err where label = 'STALE_AFTER';
insert into s4_probe_err values ('STALE_AFTER', coalesce(current_setting('nora.s4_backfill_outcome', true), '<unset>'), :'rows');

do $$
declare
    r          record;
    v_failures text[] := '{}';
begin
    -- THE POSITIVE CONTROL. This success must hand back EXACTLY ONE row, which
    -- is what makes the zero counted after the failure - here and in 7b-7e -
    -- evidence rather than an artefact of a variable that is never set.
    select * into r from s4_probe_err where label = 'STALE_BEFORE';
    if r.state not like 'BACKFILLED|contact_notes|%|1' then
        v_failures := v_failures || format('7f the preceding success did not report itself: %s', r.state);
    end if;
    if r.msg is distinct from '1' then
        v_failures := v_failures || format('7f the succeeding invocation returned %s row(s) instead of exactly 1 - a counted 0 after a failure would prove nothing', coalesce(r.msg, '<not captured>'));
    end if;

    -- ... and the failure that follows it IN THE SAME SESSION hands back none.
    select * into r from s4_probe_err where label = 'STALE_AFTER';
    if r.state <> '' then
        v_failures := v_failures || format('7f a FAILED invocation re-served the previous invocation''s outcome: %s', r.state);
    end if;
    if r.msg is distinct from '0' then
        v_failures := v_failures || format('7f a FAILED invocation returned %s outcome row(s) after a committed success; it must return none', coalesce(r.msg, '<not captured>'));
    end if;
    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (stale outcome):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  7f. stale-outcome trap: a committed BACKFILLED returns exactly 1 row, and the failing invocation that follows it IN THE SAME SESSION returns 0 - measured as rows handed to the client, not as a session variable. The arm statement discards the earlier result before the work starts, so neither an older note''s success nor a fabricated NO_CANDIDATE can be read as this call''s answer';
end;
$$;

-- remove the committed 7b-7f fixtures
do $$
begin
    update public.companies set self_contact_id = null where name = 'W8-C S4 Fehlerprobe';
    delete from public.companies where name = 'W8-C S4 Fehlerprobe';
    delete from nora_private.attachment_storage_deletion_queue where storage_key like 's4-%';
    if exists (select 1 from public.attachments) or exists (select 1 from nora_private.attachment_storage_deletion_queue) then
        raise exception 'FAIL 7b-f cleanup: the autocommit fixtures were not fully removed';
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. The preflight verdict: GO on a clean corpus, fail-closed STOP on drift
-- ---------------------------------------------------------------------------
\echo '--- 10. preflight GO / STOP ---'
begin;
do $$
declare v_company bigint; v_contact bigint; v_note bigint;
begin
    insert into public.companies (name) values ('W8-C S4 Preflight') returning id into v_company;
    insert into public.contacts (first_name, last_name, company_id)
        values ('Pre', 'Flight', v_company) returning id into v_contact;
    insert into public.contact_notes (contact_id, text, date) values (v_contact, 'S4', now()) returning id into v_note;
    alter table public.contact_notes disable trigger project_contact_note_attachments_after_update_trigger;
    update public.contact_notes
       set attachments = array[jsonb_build_object('path', 's4-pf.pdf', 'title', 'p.pdf', 'type', 'application/pdf')]
     where id = v_note;
    alter table public.contact_notes enable trigger project_contact_note_attachments_after_update_trigger;
    perform set_config('nora.s4_pf_note', v_note::text, false);
end;
$$;

\i :preflight

do $$
declare v jsonb := current_setting('nora.s4_preflight')::jsonb;
begin
    if (v ->> 'verdict') <> 'GO' or (v ->> 'candidates') <> '1' then
        raise exception 'FAIL 10a: a clean historical corpus did not produce GO with 1 candidate: %', v::text;
    end if;
    raise notice 'OK 10a. preflight GO on a clean historical corpus (1 candidate whose storage object is missing — INFO, not a STOP)';
end;
$$;

do $$
begin
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
    values (current_setting('nora.s4_pf_note')::bigint, 's4-pf-ghost.pdf', 'g.pdf', 'application/pdf');
end;
$$;

\set ON_ERROR_STOP off
savepoint s4reset;
do $$ begin raise exception using errcode = 'P0001', message = 'S4_NO_ERROR_YET'; end; $$;
rollback to savepoint s4reset;
savepoint s4try;
\i :preflight
\set st :LAST_ERROR_SQLSTATE
\set ms :LAST_ERROR_MESSAGE
rollback to savepoint s4try;
\set ON_ERROR_STOP on
delete from s4_probe_err where label = 'PREFLIGHT_STOP';
insert into s4_probe_err values ('PREFLIGHT_STOP', :'st', :'ms');

do $$
declare r record;
begin
    select * into r from s4_probe_err where label = 'PREFLIGHT_STOP';
    if r.state <> '55000' or r.msg not like '%S4 PREFLIGHT: STOP%' or r.msg not like '%ROW_WITHOUT_JSON_KEY%' then
        raise exception 'FAIL 10b: the preflight did not STOP on an unexplained row: % / %', r.state, r.msg;
    end if;
    raise notice 'OK 10b. preflight STOP: one unexplained row is enough, the reason is named, and the file fails closed (55000)';
end;
$$;
rollback;

-- ---------------------------------------------------------------------------
-- 11. Isolation: REPEATABLE READ and SERIALIZABLE fail closed
--
-- Also in autocommit, and for the same reason as 7b-7e: the session default is
-- switched so every implicit transaction - including the runner's mutating
-- statement - starts at the wrong isolation level, and the guard's own error is
-- the one psql records.
-- ---------------------------------------------------------------------------
\echo '--- 11. isolation ---'
\set ON_ERROR_STOP off
set session characteristics as transaction isolation level repeatable read;
\i :runner
\set st :LAST_ERROR_SQLSTATE
\set ms :LAST_ERROR_MESSAGE
set session characteristics as transaction isolation level read committed;
delete from s4_probe_err where label = 'RR';
insert into s4_probe_err values ('RR', :'st', :'ms');

set session characteristics as transaction isolation level serializable;
\i :runner
\set st :LAST_ERROR_SQLSTATE
\set ms :LAST_ERROR_MESSAGE
set session characteristics as transaction isolation level read committed;
\set ON_ERROR_STOP on
delete from s4_probe_err where label = 'SER';
insert into s4_probe_err values ('SER', :'st', :'ms');

do $$
declare rr record; ser record;
begin
    select * into rr from s4_probe_err where label = 'RR';
    select * into ser from s4_probe_err where label = 'SER';
    if rr.state <> '55000' or rr.msg not like '%READ COMMITTED%'
       or ser.state <> '55000' or ser.msg not like '%READ COMMITTED%' then
        raise exception 'FAIL 11: isolation is not fail-closed (RR % / %, SERIALIZABLE % / %)',
                        rr.state, rr.msg, ser.state, ser.msg;
    end if;
    raise notice 'OK 11. REPEATABLE READ and SERIALIZABLE both fail closed (55000 NORA_ATTACHMENT_READ_COMMITTED_REQUIRED) before any row is read';
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. The read-only CLASSIFICATION the operator docs now state (F-2)
--
-- "No durable or business-data mutation" and "strict SQL read-only" are two
-- different properties. The verifier has the first and not the second, and the
-- headers of the verifier, 00_preflight.sql, 20_report.sql and
-- supabase/maintenance/README.md all say exactly that. These checks are what
-- keeps those sentences true.
-- ---------------------------------------------------------------------------
\echo '--- 12. read-only classification ---'

-- 12a. a CREATE FUNCTION like the verifier's is refused in a READ ONLY
-- transaction. This is the executable proof behind "NOT strict SQL read-only".
\set ON_ERROR_STOP off
begin transaction read only;
create or replace function pg_temp.s4_ro_probe() returns integer language sql stable as 'select 1';
\set st :LAST_ERROR_SQLSTATE
\set ms :LAST_ERROR_MESSAGE
rollback;
\set ON_ERROR_STOP on
delete from s4_probe_err where label = 'RO_DDL';
insert into s4_probe_err values ('RO_DDL', :'st', :'ms');

-- 12b. 00_preflight.sql and 20_report.sql really are STRICT READ-ONLY: both run
-- to completion inside a READ ONLY transaction, with the helper still present.
begin transaction read only;
\i :preflight
\i :report
commit;

do $$
declare
    r          record;
    v_failures text[] := '{}';
    v_temp     text;
begin
    -- 12a
    select * into r from s4_probe_err where label = 'RO_DDL';
    if r.state <> '25006' or r.msg not like '%read-only transaction%' then
        v_failures := v_failures || format('12a CREATE FUNCTION was not refused in a READ ONLY transaction: %s / %s', r.state, r.msg);
    end if;

    -- 12b: the preflight ran READ ONLY and still produced a verdict
    if (current_setting('nora.s4_preflight')::jsonb ->> 'verdict') <> 'GO' then
        v_failures := array_append(v_failures, '12b the preflight did not reach GO inside a READ ONLY transaction');
    end if;

    -- 12c: the verifier's helper is session-local, and there is no durable twin
    select n.nspname into v_temp
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where p.oid = to_regprocedure('pg_temp.attachment_backfill_findings()');
    if v_temp is null or v_temp not like 'pg\_temp%' then
        v_failures := v_failures || format('12c the verifier helper is not a pg_temp function: %s', coalesce(v_temp, '<missing>'));
    end if;
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname in ('public', 'nora_private')
                  and p.proname = 'attachment_backfill_findings') then
        v_failures := array_append(v_failures, '12c a DURABLE attachment_backfill_findings() exists');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (read-only classification):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK 12. classification: the verifier creates a session-local pg_temp helper and is therefore NOT strict SQL read-only (CREATE FUNCTION in a READ ONLY transaction is 25006); 00_preflight.sql and 20_report.sql ARE strict read-only and both completed inside BEGIN TRANSACTION READ ONLY';
end;
$$;

-- 12d. a session WITHOUT the helper can never produce GO - not even a GO left
-- over from an earlier run in the same session, which is the stale-verdict trap
-- the preflight's arm statement exists to close. The GO from 12b is still in
-- this session's variable when the helper is dropped, so this is the real test,
-- not a contrived one. Run last: it removes the helper for good.
do $$
begin
    if (current_setting('nora.s4_preflight')::jsonb ->> 'verdict') <> 'GO' then
        raise exception 'FAIL 12d precondition: this session should still be holding 12b''s GO';
    end if;
end;
$$;
drop function pg_temp.attachment_backfill_findings();

\set ON_ERROR_STOP off
\i :preflight
\set st :LAST_ERROR_SQLSTATE
\set ms :LAST_ERROR_MESSAGE
\set ON_ERROR_STOP on
delete from s4_probe_err where label = 'NO_VERIFIER';
insert into s4_probe_err values ('NO_VERIFIER', :'st', :'ms');

do $$
declare
    r          record;
    v_failures text[] := '{}';
begin
    if to_regprocedure('pg_temp.attachment_backfill_findings()') is not null then
        v_failures := array_append(v_failures, '12d the helper survived the drop');
    end if;
    select * into r from s4_probe_err where label = 'NO_VERIFIER';
    if r.state <> '55000' or r.msg not like '%no verdict was produced in this session%' then
        v_failures := v_failures || format('12d the preflight did not fail closed without the verifier: %s / %s', r.state, r.msg);
    end if;
    -- the decisive one: 12b's GO was NOT re-served
    if coalesce(current_setting('nora.s4_preflight', true), '') <> '' then
        v_failures := v_failures || format('12d a stale verdict survived into an unclassified run: %s',
                                           current_setting('nora.s4_preflight', true));
    end if;
    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (session contract):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK 12d. a session without the verifier helper fails closed (55000 "no verdict was produced in this session"): the classification aborts, the arm statement has already discarded the GO this session held, and absence of a verdict is never GO';
end;
$$;

-- ---------------------------------------------------------------------------
-- 12e. THE CENSUS CONTRACT (R-2): a helper that EXISTS is not a helper that
-- CLASSIFIED.
--
-- 12d proved the gate survives a MISSING delegate. This proves it survives a
-- delegate that answers but answers wrong - the harder case, because every one
-- of these shapes reads as good news downstream: no class is blocking, so the
-- naive gate says GO. "Nothing was classified" must never be counted as
-- "nothing is wrong".
--
-- The helper is PRESENT in every case below (s4_census creates it), so the
-- existence check of 12d cannot be what fires here: only the census-shape
-- assertion can. These tests substitute a controlled census on purpose - they
-- do NOT reimplement classification, which stays the canonical verifier's job
-- and is exercised against the real thing in 8, 9, 10a and 10b.
-- ---------------------------------------------------------------------------
\echo '--- 12e. census contract ---'

create function pg_temp.s4_census(p_pairs text[]) returns void language plpgsql as $ce$
begin
    execute format($f$
        create or replace function pg_temp.attachment_backfill_findings()
        returns table (problem_class text, blocking boolean, finding_count bigint, evidence text)
        language sql stable as $b$
            select split_part(p, ':', 1), split_part(p, ':', 2)::boolean, 0::bigint, ''::text
              from unnest(%L::text[]) as t(p)
        $b$;$f$, p_pairs);
end;
$ce$;

-- the canonical contract, as the preflight states it
create function pg_temp.s4_canon() returns text[] language sql immutable as $$
    select array['INVALID_GRAMMAR:true', 'JSON_KEY_WITHOUT_ROW:true', 'ROW_WITHOUT_JSON_KEY:true',
                 'METADATA_MISMATCH:true', 'DUPLICATE_KEY_IN_NOTE:true', 'DUPLICATE_KEY_ACROSS_NOTES:true',
                 'WRONG_OWNER:true', 'ROW_FOR_EMPTY_NOTE:true', 'QUEUE_CONFLICT:true',
                 'BYTE_SIZE_NOT_NULL:true', 'CROSS_SOURCE_KEY:true', 'BACKFILL_CANDIDATE_REMAINING:true',
                 'STORAGE_OBJECT_MISSING:false']
$$;
-- replace one canonical pair with something else; '' drops it entirely
create function pg_temp.s4_swap(p_class text, p_with text) returns text[] language sql immutable as $$
    select coalesce(array_agg(x order by o), '{}')
      from (select case when split_part(p, ':', 1) = p_class then nullif(p_with, '') else p end as x,
                   ordinality as o
              from unnest(pg_temp.s4_canon()) with ordinality as t(p, ordinality)) s
     where x is not null
$$;

\set ON_ERROR_STOP off

-- A. zero rows: the classifier ran and said nothing at all
select pg_temp.s4_census('{}'::text[]);
\i :preflight
\set err :ERROR
\set st :LAST_ERROR_SQLSTATE
delete from s4_probe_err where label = 'CENSUS_ZERO';
insert into s4_probe_err values ('CENSUS_ZERO', :'err' || '/' || :'st', coalesce(nullif(current_setting('nora.s4_preflight', true), '')::jsonb ->> 'verdict', ''));

-- B. only the work class: the most plausible counterfeit - it reports what is
-- left to do and silently drops every class that could have said STOP
select pg_temp.s4_census(array['BACKFILL_CANDIDATE_REMAINING:true']);
\i :preflight
\set err :ERROR
delete from s4_probe_err where label = 'CENSUS_ONLY_WORK';
insert into s4_probe_err values ('CENSUS_ONLY_WORK', :'err', coalesce(nullif(current_setting('nora.s4_preflight', true), '')::jsonb ->> 'verdict', ''));

-- C. 12 of 13
select pg_temp.s4_census(pg_temp.s4_swap('QUEUE_CONFLICT', ''));
\i :preflight
\set err :ERROR
delete from s4_probe_err where label = 'CENSUS_SHORT';
insert into s4_probe_err values ('CENSUS_SHORT', :'err', coalesce(nullif(current_setting('nora.s4_preflight', true), '')::jsonb ->> 'verdict', ''));

-- D. 13 rows, one expected class replaced by an unknown one
select pg_temp.s4_census(pg_temp.s4_swap('QUEUE_CONFLICT', 'LOOKS_FINE_TO_ME:true'));
\i :preflight
\set err :ERROR
delete from s4_probe_err where label = 'CENSUS_UNKNOWN';
insert into s4_probe_err values ('CENSUS_UNKNOWN', :'err', coalesce(nullif(current_setting('nora.s4_preflight', true), '')::jsonb ->> 'verdict', ''));

-- E. 13 rows, but a duplicate has displaced one expected class
select pg_temp.s4_census(pg_temp.s4_swap('QUEUE_CONFLICT', 'WRONG_OWNER:true'));
\i :preflight
\set err :ERROR
delete from s4_probe_err where label = 'CENSUS_DUP';
insert into s4_probe_err values ('CENSUS_DUP', :'err', coalesce(nullif(current_setting('nora.s4_preflight', true), '')::jsonb ->> 'verdict', ''));

-- F. 14 rows: an unexpected extra class
select pg_temp.s4_census(pg_temp.s4_canon() || 'SOMETHING_NEW:true'::text);
\i :preflight
\set err :ERROR
delete from s4_probe_err where label = 'CENSUS_EXTRA';
insert into s4_probe_err values ('CENSUS_EXTRA', :'err', coalesce(nullif(current_setting('nora.s4_preflight', true), '')::jsonb ->> 'verdict', ''));

-- G. all thirteen names, but a BLOCKING class quietly turned non-blocking -
-- the shape that would let a real STOP class pass as INFO
select pg_temp.s4_census(pg_temp.s4_swap('QUEUE_CONFLICT', 'QUEUE_CONFLICT:false'));
\i :preflight
\set err :ERROR
delete from s4_probe_err where label = 'CENSUS_FLAG';
insert into s4_probe_err values ('CENSUS_FLAG', :'err', coalesce(nullif(current_setting('nora.s4_preflight', true), '')::jsonb ->> 'verdict', ''));

-- H. the contract itself is ACCEPTED: an all-zero census in the canonical shape
-- still reaches GO, so the assertion gates the shape and not the outcome
select pg_temp.s4_census(pg_temp.s4_canon());
\i :preflight
\set err :ERROR
delete from s4_probe_err where label = 'CENSUS_OK';
insert into s4_probe_err values ('CENSUS_OK', :'err', coalesce(nullif(current_setting('nora.s4_preflight', true), '')::jsonb ->> 'verdict', ''));

-- I. and that fresh GO does not survive the next invalid census either
select pg_temp.s4_census('{}'::text[]);
\i :preflight
\set err :ERROR
delete from s4_probe_err where label = 'CENSUS_AFTER_GO';
insert into s4_probe_err values ('CENSUS_AFTER_GO', :'err', coalesce(nullif(current_setting('nora.s4_preflight', true), '')::jsonb ->> 'verdict', ''));

\set ON_ERROR_STOP on

do $$
declare
    r          record;
    v_failures text[] := '{}';
    v_label    text;
begin
    -- the delegate was PRESENT for every case above; only the census-shape
    -- assertion can have refused them
    if to_regprocedure('pg_temp.attachment_backfill_findings()') is null then
        v_failures := array_append(v_failures, '12e the counterfeit helper was not installed - the cases below would be testing 12d, not the census contract');
    end if;

    select * into r from s4_probe_err where label = 'CENSUS_ZERO';
    if r.state <> 'true/55000' then
        v_failures := v_failures || format('12e a zero-row census did not fail closed with 55000: %s', r.state);
    end if;

    foreach v_label in array array['CENSUS_ZERO', 'CENSUS_ONLY_WORK', 'CENSUS_SHORT', 'CENSUS_UNKNOWN',
                                   'CENSUS_DUP', 'CENSUS_EXTRA', 'CENSUS_FLAG', 'CENSUS_AFTER_GO'] loop
        select * into r from s4_probe_err where label = v_label;
        if r.state not like 'true%' then
            v_failures := v_failures || format('12e %s: an invalid census did not raise', v_label);
        end if;
        if r.msg <> '' then
            v_failures := v_failures || format('12e %s: an INCOMPLETE CLASSIFICATION produced the verdict %s', v_label, r.msg);
        end if;
    end loop;

    select * into r from s4_probe_err where label = 'CENSUS_OK';
    if r.state <> 'false' or r.msg is distinct from 'GO' then
        v_failures := v_failures || format('12e the canonical 13-class census was rejected (%s / %s) - the assertion is over-strict', r.state, coalesce(r.msg, '<none>'));
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (census contract):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK 12e. census contract: a present-but-wrong classifier can never produce GO. Zero rows, only BACKFILL_CANDIDATE_REMAINING, 12 of 13, an unknown class, a duplicate displacing a class, a 14th class and a blocking class flipped to non-blocking each raise 55000 NORA_S4_CLASSIFICATION_CENSUS_INVALID and write NO verdict - including immediately after a GO. The canonical thirteen-class shape still reaches GO, so the gate checks the contract and not the answer';
end;
$$;

-- leave the session exactly as 12d left it: no helper, no verdict
drop function pg_temp.attachment_backfill_findings();
drop function pg_temp.s4_census(text[]);
drop function pg_temp.s4_swap(text, text);
drop function pg_temp.s4_canon();

-- ---------------------------------------------------------------------------
-- 13. Nothing was left behind
-- ---------------------------------------------------------------------------
do $$
declare v_failures text[] := '{}';
begin
    if exists (select 1 from public.attachments) then
        v_failures := array_append(v_failures, 'public.attachments is not empty');
    end if;
    if exists (select 1 from nora_private.attachment_storage_deletion_queue) then
        v_failures := array_append(v_failures, 'the deletion queue is not empty');
    end if;
    if exists (select 1 from public.companies where name like 'W8-C S4%') then
        v_failures := array_append(v_failures, 'a fixture customer survived');
    end if;
    if exists (select 1 from storage.objects where name like 's4-%') then
        v_failures := array_append(v_failures, 'a fixture storage object survived');
    end if;
    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (cleanliness):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK 13. every fixture is gone: no attachment row, no queue row, no customer, no storage object';
end;
$$;

\echo '=== W8-C S4 backfill verification: all checks passed ==='
