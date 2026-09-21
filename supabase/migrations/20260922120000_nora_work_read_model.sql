-- Nora CRM: W-A Universal Work Model v1 — Read-Model Proof (2026-09-22)
--
-- The first server-side Work Application Query. It proves that the frozen Work
-- Contract (docs/nora/25-universal-work-model.md, FROZEN 2026-09-21) can be
-- projected over a real carrier, actor-correctly, without a new persistence.
--
-- WHAT THIS MIGRATION INSTALLS — and nothing else:
--   1. nora_private.current_sales_id()  the session -> employee resolver that
--      21.2 names as the known implementation prerequisite (nora_private knew
--      safe_auth_uid / current_role / is_admin / can_write / has_role /
--      is_active_user, but no auth.uid() -> sales.id resolver).
--   2. public.get_work_items(...)       the Work Application Query.
--
-- WHAT IT DOES NOT DO (20.1 / 20.2, D-56): no table, no column, no view, no
-- index, no trigger, no policy, no backfill, no data cleanup, no write path of
-- any kind, no change to public.tasks, no change to set_sales_id_default().
-- D-53 stays resolved as "no new index for W-A": the existing partial index
-- tasks_due_date_open_idx already covers the default access path, and a need
-- beyond it is not evidenced.
--
-- ACTOR (10.1, D-26 — frozen)
--   The actor comes exclusively from the authenticated session. It is never an
--   RPC argument, never a client value, never a GUC. The resolver deliberately
--   does NOT reuse nora_private.resolve_audit_actor(): that helper may consume
--   the externally supplied nora.audit_actor_user_id GUC (an Edge-Function
--   audit affordance), which is incompatible with the Work actor contract.
--   current_sales_id() mirrors nora_private.current_role() one-for-one:
--   safe_auth_uid() -> public.sales.user_id (UNIQUE), sales.disabled = false,
--   and jwt_session_is_live(). Anything else resolves to NULL, and the public
--   RPC turns NULL into 42501 / NORA_PERMISSION_DENIED — the existing Nora
--   permission code, not a new Work error taxonomy (18.2, 03 §6).
--
-- SECURITY BOUNDARY (21.5, D-57 — decided here, in the implementation review)
--   public.get_work_items is SECURITY INVOKER. The Work Query therefore reads
--   public.tasks under the EXISTING RLS policy "Tasks select active"
--   (is_active_user()) instead of reimplementing authorization inside a
--   privileged function. 25 §21.5 names the collision explicitly: a SECURITY
--   DEFINER application query would bypass is_active_user() and ENLARGE the
--   surface the open security wave (17 A) has to inspect. W-A must not enlarge
--   it. Consequences, accepted deliberately:
--     * the RPC runs with the caller's privileges, so the caller needs SELECT
--       on public.tasks (authenticated already holds it) and EXECUTE on
--       public.nora_entity_uuid (already granted, SECURITY INVOKER, IMMUTABLE);
--     * holder names come from public.sales_identities, the established
--       privileged read view for historical identities (19 §7) — it is
--       security_invoker = false and gated by is_active_user(), so a
--       deactivated employee stays resolvable as a holder while a dead session
--       resolves nothing;
--     * nora_private.current_sales_id() is SECURITY DEFINER because the
--       identity join itself must be able to read public.sales and to call
--       jwt_session_is_live() (postgres-only EXECUTE). It is the ONLY
--       privileged element of W-A, it takes no argument, and it can answer
--       exactly one question: "which employee is this session?".
--   Team scope is not a second predicate: "Team = everything the actor may see
--   according to Nora security" (15, D-38) is literally today's RLS state, so
--   scope = 'team' adds NO holder predicate and lets RLS answer.
--
-- GRANTS (22 §6.3, 03 §4): a new FUNCTION is born with PUBLIC EXECUTE. Both
-- functions therefore carry their own explicit revoke from public / anon /
-- authenticated / service_role followed by exactly one grant to authenticated.
-- No service_role EXECUTE: W-A has no backend caller (22 §6.3).
--
-- OUTPUT (21.3): the envelope carries data / limit / scope / state_scope /
-- next_cursor; each Work row carries exactly the 16 contract fields. No
-- allowed_actions and no carrier_capabilities substitute (13.3, D-33), no
-- context.case / context.deal and no deal heuristic (14.3, D-36), no raw
-- tasks column. context.customer and context.contact are ALWAYS present and
-- explicitly null when absent (14.2, D-34) — never omitted, never guessed,
-- never resolved from the contact. due_precision is the constant 'unknown'
-- (7.6, D-19); no clock heuristic infers 'day' or 'instant'.
--
-- SORT / PAGINATION (21.4, D-52): ORDER BY due_at ASC NULLS LAST, work_id ASC,
-- keyset over the whole sort tuple, never OFFSET. The cursor predicate is
-- NULL-aware on purpose: a row-value comparison (due_at, work_id) > (...)
-- silently drops the NULLS LAST tail, so the untimed work would never paginate.
--
-- Forward-only and replay-safe (CREATE OR REPLACE, revoke -> explicit grant).
-- Fail-closed: sections 0 and 1 refuse to install against an unexpected
-- architecture, and section 4 refuses to commit an installation that does not
-- match the contract.

-- ---------------------------------------------------------------------------
-- 0. Hard gate: the fail-closed session binding must be evaluable here
-- ---------------------------------------------------------------------------
-- current_sales_id() depends on nora_private.jwt_session_is_live(), which is
-- fail-closed since W6-A: if postgres cannot read auth.sessions, every employee
-- is denied. Installing a session-bound Work resolver on a platform where that
-- cannot be verified would ship a dead read model. Same gate, same wording as
-- migration 20260906210000 — deliberately not weakened.
do $$
declare
    v_dummy integer;
begin
    if current_user <> 'postgres' then
        raise exception 'W-A: migration must run as postgres (current_user = %)', current_user;
    end if;

    if not has_table_privilege('postgres', 'auth.sessions', 'SELECT') then
        raise exception 'W-A gate: postgres cannot SELECT auth.sessions — the session-bound Work actor resolver would deny every employee. Restore the privilege before applying this migration.';
    end if;

    begin
        select 1 into v_dummy
        from auth.sessions s
        where s.id = gen_random_uuid() and s.user_id = gen_random_uuid();
    exception when others then
        raise exception 'W-A gate: probe lookup on auth.sessions failed (% / %) — refusing to install a session-bound Work actor resolver', sqlstate, sqlerrm;
    end;

    raise notice 'W-A gate: postgres can read auth.sessions — proceeding';
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Preconditions: the frozen architecture must actually be present
-- ---------------------------------------------------------------------------
do $$
declare
    v_failures text[] := '{}';
    r          record;
    v_cols     text;
    v_oid      oid;
    v_args     text;
begin
    -- 1a. public.tasks is the Work Carrier and has exactly the eight columns
    --     the contract inventories (4.2). A ninth column would mean a carrier
    --     the frozen projection was never reviewed against.
    select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attname)
      into v_cols
      from pg_attribute a
     where a.attrelid = 'public.tasks'::regclass and a.attnum > 0 and not a.attisdropped;
    if v_cols is distinct from
        'company_id bigint, contact_id bigint, done_date timestamp with time zone, due_date timestamp with time zone, '
     || 'id bigint, sales_id bigint, text text, type text' then
        v_failures := v_failures || format('public.tasks is not the reviewed eight-column Work Carrier: %s', coalesce(v_cols, '<none>'));
    end if;

    -- 1b. the context invariant the Work Contract relies on (14)
    if not exists (
        select 1 from pg_constraint c
         where c.conrelid = 'public.tasks'::regclass
           and c.conname = 'tasks_company_or_contact_check'
           and c.contype = 'c' and c.convalidated
    ) then
        v_failures := array_append(v_failures, 'tasks_company_or_contact_check is missing or not validated');
    end if;

    -- 1c. RLS is what the INVOKER query relies on for Team scope (15, D-38)
    if not (select c.relrowsecurity from pg_class c where c.oid = 'public.tasks'::regclass) then
        v_failures := array_append(v_failures, 'row level security is disabled on public.tasks');
    end if;
    if not exists (
        select 1 from pg_policy p
         where p.polrelid = 'public.tasks'::regclass
           and p.polname = 'Tasks select active' and p.polcmd = 'r'
    ) then
        v_failures := array_append(v_failures, 'the SELECT policy "Tasks select active" is missing on public.tasks');
    end if;

    -- 1d. the security helpers the resolver is built from
    for r in
        select * from (values
            ('nora_private.safe_auth_uid()'),
            ('nora_private.jwt_session_is_live()'),
            ('nora_private.is_active_user()')
        ) as t(sig)
    loop
        v_oid := to_regprocedure(r.sig);
        if v_oid is null then
            v_failures := v_failures || format('%s does not exist', r.sig);
            continue;
        end if;
        if not (select p.prosecdef from pg_proc p where p.oid = v_oid)
           or (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = v_oid) <> 'postgres'
           or (select coalesce(array_to_string(p.proconfig, ','), '') from pg_proc p where p.oid = v_oid) <> 'search_path=""' then
            v_failures := v_failures || format('%s is not a postgres-owned SECURITY DEFINER with search_path = ''''', r.sig);
        end if;
    end loop;

    -- 1e. the Work identity mechanism (21.3, D-51) — no new ID world
    v_oid := to_regprocedure('public.nora_entity_uuid(text,bigint)');
    if v_oid is null then
        v_failures := array_append(v_failures, 'public.nora_entity_uuid(text,bigint) does not exist');
    elsif (select p.provolatile from pg_proc p where p.oid = v_oid) <> 'i' then
        v_failures := array_append(v_failures, 'public.nora_entity_uuid(text,bigint) is not IMMUTABLE');
    elsif not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
        v_failures := array_append(v_failures, 'authenticated cannot EXECUTE public.nora_entity_uuid — the SECURITY INVOKER Work Query could not build work_id');
    end if;

    -- 1f. holder identity source (9, 19 §7): sales_identities, not sales_directory
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relname = 'sales_identities' and c.relkind = 'v') then
        v_failures := array_append(v_failures, 'the view public.sales_identities does not exist');
    else
        if coalesce((select option_value from pg_options_to_table(
                        (select c.reloptions from pg_class c where c.oid = 'public.sales_identities'::regclass))
                     where option_name = 'security_invoker'), 'false') <> 'false' then
            v_failures := array_append(v_failures, 'public.sales_identities is no longer security_invoker = false — holder resolution was reviewed against the privileged projection');
        end if;
        if not has_table_privilege('authenticated', 'public.sales_identities', 'SELECT') then
            v_failures := array_append(v_failures, 'authenticated cannot SELECT public.sales_identities');
        end if;
    end if;

    -- 1g. the identity join the resolver assumes is single-valued (21.2)
    if not exists (
        select 1 from pg_index i
         where i.indrelid = 'public.sales'::regclass and i.indisunique and i.indnatts = 1
           and (select a.attname from pg_attribute a
                 where a.attrelid = 'public.sales'::regclass and a.attnum = i.indkey[0]) = 'user_id'
    ) then
        v_failures := array_append(v_failures, 'public.sales.user_id is not unique — the session -> employee resolver would be ambiguous');
    end if;

    -- 1h. the reads the SECURITY INVOKER query performs as the caller
    if not has_table_privilege('authenticated', 'public.tasks', 'SELECT') then
        v_failures := array_append(v_failures, 'authenticated cannot SELECT public.tasks');
    end if;
    if not has_schema_privilege('authenticated', 'nora_private', 'USAGE') then
        v_failures := array_append(v_failures, 'authenticated has no USAGE on schema nora_private');
    end if;

    -- 1i. never silently overwrite an unexpected architecture
    for r in
        select p.oid, n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where (n.nspname = 'public' and p.proname = 'get_work_items')
            or (n.nspname = 'nora_private' and p.proname = 'current_sales_id')
    loop
        v_args := case
            when r.proname = 'get_work_items'
                then 'p_scope text, p_state_scope text, p_limit integer, p_cursor_due_at timestamp with time zone, p_cursor_work_id uuid'
            else '' end;
        if r.args is distinct from v_args then
            v_failures := v_failures || format(
                'an incompatible %I.%I(%s) already exists — W-A refuses to overwrite an architecture it did not review',
                r.nspname, r.proname, r.args);
        end if;
    end loop;

    if cardinality(v_failures) > 0 then
        raise exception E'W-A preconditions not met:\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'W-A preconditions: frozen architecture present — proceeding';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Actor resolution — session -> Nora employee
-- ---------------------------------------------------------------------------
-- Deliberately the exact shape of nora_private.current_role(): same identity
-- source, same activity condition, same session binding. It answers one
-- question and takes no argument, so there is no parameter through which a
-- caller could name a different employee (10.1, D-26).
create or replace function nora_private.current_sales_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
    select s.id
    from public.sales s
    where s.user_id = nora_private.safe_auth_uid()
      and s.disabled = false
      and nora_private.jwt_session_is_live()
    limit 1;
$$;

alter function nora_private.current_sales_id() owner to postgres;

comment on function nora_private.current_sales_id() is
    'W-A (2026-09-22): the Nora employee (public.sales.id) behind the current authenticated session, or NULL. Identity source is nora_private.safe_auth_uid() joined on the UNIQUE public.sales.user_id; the employee must not be disabled and nora_private.jwt_session_is_live() must hold. Never accepts an actor argument and never reads nora.audit_actor_user_id — that GUC belongs to resolve_audit_actor() and is incompatible with the Work actor contract (docs/nora/25 §10.1). Callers turn NULL into DETAIL = NORA_PERMISSION_DENIED. Internal, not API-exposed.';

revoke all on function nora_private.current_sales_id() from public;
revoke all on function nora_private.current_sales_id() from anon;
revoke all on function nora_private.current_sales_id() from authenticated;
revoke all on function nora_private.current_sales_id() from service_role;
grant execute on function nora_private.current_sales_id() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The Work Application Query
-- ---------------------------------------------------------------------------
create or replace function public.get_work_items(
    p_scope text default 'mine',
    p_state_scope text default 'open',
    p_limit integer default 50,
    p_cursor_due_at timestamptz default null,
    p_cursor_work_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
    -- An omitted argument and an explicit JSON null both mean the documented
    -- default; only a value outside the closed vocabulary is "unknown".
    v_scope       text    := coalesce(p_scope, 'mine');
    v_state_scope text    := coalesce(p_state_scope, 'open');
    v_limit       integer := least(greatest(coalesce(p_limit, 50), 1), 200);
    v_actor       bigint;
    -- The business day is Europe/Berlin, server-side, evaluated once per call
    -- so every row of one page is judged against the same day (7, D-18).
    v_today       date    := (now() at time zone 'Europe/Berlin')::date;
    v_rows        jsonb;
    v_has_more    boolean;
    v_tail        jsonb;
begin
    -- Authorization first: an unresolvable actor learns nothing about the
    -- parameter vocabulary.
    v_actor := nora_private.current_sales_id();
    if v_actor is null then
        raise exception 'forbidden'
            using errcode = '42501', detail = 'NORA_PERMISSION_DENIED';
    end if;

    if v_scope not in ('mine', 'team') then
        raise exception 'unknown work scope: %', v_scope
            using errcode = '22023';
    end if;

    if v_state_scope not in ('open', 'done', 'all') then
        raise exception 'unknown work state scope: %', v_state_scope
            using errcode = '22023';
    end if;

    -- A half cursor is a client defect, never "start from the beginning":
    -- silently restarting would hand the consumer duplicate rows. The reverse
    -- (NULL due_at, non-null work_id) IS valid — it is a position inside the
    -- NULLS LAST tail.
    if p_cursor_due_at is not null and p_cursor_work_id is null then
        raise exception 'malformed work cursor: p_cursor_due_at without p_cursor_work_id'
            using errcode = '22023';
    end if;

    with base as (
        select
            public.nora_entity_uuid('task', t.id) as work_id,
            t.text       as raw_title,
            t.type       as work_type,
            t.due_date   as due_at,
            t.done_date  as done_date,
            t.sales_id   as holder_id,
            t.company_id as customer_id,
            t.contact_id as contact_id
        from public.tasks t
        where (
                  v_state_scope = 'all'
               or (v_state_scope = 'open' and t.done_date is null)
               or (v_state_scope = 'done' and t.done_date is not null)
              )
          -- 'team' adds no predicate: RLS already answers "what may this actor
          -- see" (15, D-38). 'mine' filters on the holder, and a NULL holder is
          -- never mine.
          and (v_scope = 'team' or t.sales_id = v_actor)
    ),
    -- One extra row decides whether a next page exists, so the final page
    -- always reports next_cursor = null instead of a cursor onto nothing.
    windowed as (
        select b.*,
               row_number() over (order by b.due_at asc nulls last, b.work_id asc) as rn
        from base b
        where p_cursor_work_id is null
           or case
                when p_cursor_due_at is null
                    then (
                        b.due_at is null
                        and b.work_id > p_cursor_work_id
                    )
                else (
                        b.due_at is null
                     or b.due_at > p_cursor_due_at
                     or (
                            b.due_at = p_cursor_due_at
                        and b.work_id > p_cursor_work_id
                        )
                )
              end
        order by b.due_at asc nulls last, b.work_id asc
        limit v_limit + 1
    ),
    emitted as (
        select w.* from windowed w where w.rn <= v_limit
    ),
    projected as (
        select
            e.rn,
            e.due_at,
            e.work_id,
            jsonb_build_object(
                'work_id',        e.work_id,
                'carrier',        'task'::text,
                'title',          case when e.raw_title is null or btrim(e.raw_title) = ''
                                       then null else e.raw_title end,
                'work_type',      e.work_type,
                'validity',       case when e.raw_title is null or btrim(e.raw_title) = ''
                                       then 'incomplete'::text else 'valid'::text end,
                'invalid_reason', case when e.raw_title is null or btrim(e.raw_title) = ''
                                       then 'missing_title'::text else null end,
                'state',          case when e.done_date is null then 'open'::text else 'done'::text end,
                'context',        jsonb_build_object(
                                      'customer', e.customer_id,
                                      'contact',  e.contact_id
                                  ),
                'holder',         case when e.holder_id is null then null
                                       else jsonb_build_object(
                                                'sales_id',     e.holder_id,
                                                'display_name', nullif(btrim(
                                                    coalesce(si.first_name, '') || ' ' || coalesce(si.last_name, '')
                                                ), '')
                                            )
                                  end,
                'is_mine',        e.holder_id is not null and e.holder_id = v_actor,
                'is_unassigned',  e.holder_id is null,
                'due_at',         e.due_at,
                'due_precision',  'unknown'::text,
                'actionable',     e.done_date is null
                                  and not (e.raw_title is null or btrim(e.raw_title) = ''),
                'overdue',        coalesce((e.due_at at time zone 'Europe/Berlin')::date < v_today, false),
                'due_today',      coalesce((e.due_at at time zone 'Europe/Berlin')::date = v_today, false)
            ) as item
        from emitted e
        left join public.sales_identities si on si.id = e.holder_id
    )
    select
        coalesce(jsonb_agg(p.item order by p.rn), '[]'::jsonb),
        (select count(*) from windowed) > v_limit,
        (select jsonb_build_object('due_at', x.due_at, 'work_id', x.work_id)
           from projected x order by x.rn desc limit 1)
    into v_rows, v_has_more, v_tail
    from projected p;

    return jsonb_build_object(
        'data',        v_rows,
        'limit',       v_limit,
        'scope',       v_scope,
        'state_scope', v_state_scope,
        'next_cursor', case when v_has_more then v_tail else null end
    );
end;
$$;

alter function public.get_work_items(text, text, integer, timestamptz, uuid) owner to postgres;

comment on function public.get_work_items(text, text, integer, timestamptz, uuid) is
    'W-A (2026-09-22): the Work Application Query of Universal Work Model v1 (docs/nora/25 §21.3). SECURITY INVOKER — public.tasks is read under the existing RLS policy "Tasks select active", so the query never widens the authorization surface. The actor comes from nora_private.current_sales_id() (session only, never an argument); an unresolvable actor raises 42501 with DETAIL = NORA_PERMISSION_DENIED. p_scope mine|team (mine = holder is the actor; team = everything Nora security shows the actor), p_state_scope open|done|all (default open — the Arbeitskorb default scope, validity-independent), p_limit clamped to [1,200], keyset cursor (p_cursor_due_at, p_cursor_work_id) over the total order due_at ASC NULLS LAST, work_id ASC; a NULL p_cursor_due_at with a non-null p_cursor_work_id is a position inside the NULLS LAST tail, the reverse is malformed (22023). An unknown scope value raises 22023. Returns {data, limit, scope, state_scope, next_cursor}; every row carries exactly work_id, carrier, title, work_type, validity, invalid_reason, state, context{customer,contact}, holder{sales_id,display_name}, is_mine, is_unassigned, due_at, due_precision, actionable, overdue, due_today. due_precision is always "unknown" (§7.6) and overdue/due_today follow the Europe/Berlin business-day rule server-side. No allowed_actions, no carrier_capabilities, no deal/case context, no write.';

revoke all on function public.get_work_items(text, text, integer, timestamptz, uuid) from public;
revoke all on function public.get_work_items(text, text, integer, timestamptz, uuid) from anon;
revoke all on function public.get_work_items(text, text, integer, timestamptz, uuid) from authenticated;
revoke all on function public.get_work_items(text, text, integer, timestamptz, uuid) from service_role;
grant execute on function public.get_work_items(text, text, integer, timestamptz, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Terminal assertions — the installation must match the contract
-- ---------------------------------------------------------------------------
do $$
declare
    v_failures text[] := '{}';
    r          record;
    v_oid      oid;
    v_names    text;
begin
    -- 4a. function form: volatility, INVOKER/DEFINER split, search_path, owner
    for r in
        select * from (values
            ('nora_private.current_sales_id()',                           'sql',     's', true,  'bigint'),
            ('public.get_work_items(text,text,integer,timestamptz,uuid)', 'plpgsql', 's', false, 'jsonb')
        ) as t(sig, lang, volat, secdef, rettype)
    loop
        v_oid := to_regprocedure(r.sig);
        if v_oid is null then
            v_failures := v_failures || format('%s was not created', r.sig);
            continue;
        end if;
        if (select l.lanname from pg_proc p join pg_language l on l.oid = p.prolang where p.oid = v_oid) <> r.lang
           or (select p.provolatile from pg_proc p where p.oid = v_oid) <> r.volat
           or (select p.prosecdef from pg_proc p where p.oid = v_oid) <> r.secdef
           or (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = v_oid) <> 'postgres'
           or (select coalesce(array_to_string(p.proconfig, ','), '') from pg_proc p where p.oid = v_oid) <> 'search_path=""'
           or (select pg_catalog.format_type(p.prorettype, null) from pg_proc p where p.oid = v_oid) <> r.rettype then
            v_failures := v_failures || format(
                '%s does not have the contracted form (language %s, STABLE, security definer = %s, owner postgres, search_path = '''', returns %s)',
                r.sig, r.lang, r.secdef, r.rettype);
        end if;
    end loop;

    -- 4b. privilege boundary: authenticated only, on both objects.
    --     A new function is born with PUBLIC EXECUTE (22 §6.3) — assert that
    --     the PUBLIC entry is actually gone, not merely that anon "cannot".
    for r in
        select * from (values
            ('nora_private.current_sales_id()'),
            ('public.get_work_items(text,text,integer,timestamptz,uuid)')
        ) as t(sig)
    loop
        v_oid := to_regprocedure(r.sig);
        if v_oid is null then continue; end if;
        if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
            v_failures := v_failures || format('authenticated cannot EXECUTE %s', r.sig);
        end if;
        if has_function_privilege('anon', v_oid, 'EXECUTE') then
            v_failures := v_failures || format('anon can EXECUTE %s', r.sig);
        end if;
        if has_function_privilege('service_role', v_oid, 'EXECUTE') then
            v_failures := v_failures || format('service_role can EXECUTE %s', r.sig);
        end if;
        if exists (select 1 from pg_proc p, unnest(p.proacl) a where p.oid = v_oid and a::text like '=%') then
            v_failures := v_failures || format('PUBLIC still holds EXECUTE on %s', r.sig);
        end if;
        if (select p.proacl is null from pg_proc p where p.oid = v_oid) then
            v_failures := v_failures || format('%s still carries the default NULL ACL (no explicit revoke took effect)', r.sig);
        end if;
    end loop;

    -- 4c. public.tasks was not touched: shape, triggers, policies, indexes
    if (select count(*) from pg_attribute a
         where a.attrelid = 'public.tasks'::regclass and a.attnum > 0 and not a.attisdropped) <> 8 then
        v_failures := array_append(v_failures, 'public.tasks no longer has exactly eight columns');
    end if;
    select string_agg(t.tgname, ', ' order by t.tgname) into v_names
      from pg_trigger t where t.tgrelid = 'public.tasks'::regclass and not t.tgisinternal;
    if v_names is distinct from 'audit_task_row_trigger, enforce_task_company_context_trigger, '
                             || 'guard_active_assignment_trigger, set_task_sales_id_trigger' then
        v_failures := v_failures || format('the trigger inventory of public.tasks changed: %s', coalesce(v_names, '<none>'));
    end if;
    select string_agg(p.polname, ', ' order by p.polname) into v_names
      from pg_policy p where p.polrelid = 'public.tasks'::regclass;
    if v_names is distinct from 'Tasks delete admin, Tasks insert writers, Tasks select active, Tasks update writers' then
        v_failures := v_failures || format('the policy inventory of public.tasks changed: %s', coalesce(v_names, '<none>'));
    end if;
    select string_agg(i.indexrelid::regclass::text, ', ' order by i.indexrelid::regclass::text) into v_names
      from pg_index i where i.indrelid = 'public.tasks'::regclass;
    if v_names is distinct from 'tasks_company_id_due_date_open_idx, tasks_company_id_idx, tasks_contact_id_idx, '
                             || 'tasks_due_date_open_idx, tasks_pkey, tasks_sales_id_idx' then
        v_failures := v_failures || format('the index inventory of public.tasks changed (W-A adds no index, D-53): %s', coalesce(v_names, '<none>'));
    end if;

    -- 4d. the shared assignment default was not touched (9.1, D-25). It is
    --     shared between set_task_sales_id_trigger and set_deal_sales_id_trigger,
    --     so a change here would silently alter case creation as well.
    select p.prosrc into v_names from pg_proc p where p.oid = to_regprocedure('public.set_sales_id_default()');
    if v_names is null
       or position('new.sales_id is null' in v_names) = 0
       or position('auth.uid()' in v_names) = 0 then
        v_failures := array_append(v_failures, 'public.set_sales_id_default() is no longer the session-derived "only when NULL" default — W-A must never change it');
    end if;

    -- 4e. W-A created no relation of its own (D-1: Work is a contract over an
    --     existing carrier, never a new persistence)
    if exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname in ('public', 'nora_private')
           and c.relkind in ('r', 'v', 'm', 'p', 'f')
           and c.relname in ('work_items', 'work', 'work_read_model', 'get_work_items')
    ) then
        v_failures := array_append(v_failures, 'W-A created a relation — Work is a contract over an existing carrier, never a new persistence (D-1)');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'W-A installation does not match the contract:\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'W-A: work read model installed — nora_private.current_sales_id() + public.get_work_items()';
end;
$$;
