-- Nora User Lifecycle W6-A (2026-09-06): session-authorization finalization.
--
-- W5 bound RLS authorization to a live auth.sessions row. Three accepted
-- defense-in-depth weaknesses remained (docs/nora/17 A.2), all reproduced
-- locally against GoTrue 2.196 / PostgREST 16 before this migration:
--   1. a JWT naming ANOTHER user's live session passed the existence check
--      (no session.user_id = JWT.sub binding);
--   2. a malformed session_id claim (not a uuid, JSON null, number, array)
--      collapsed to the "no claim" compatibility path and was allowed;
--   3. when postgres could not read auth.sessions the helper logged a
--      WARNING and answered "live" (fail-open).
--
-- Contract after W6-A (nora_private.jwt_session_claim / jwt_session_is_live):
--
--   claim state   | meaning                                        | result
--   --------------+------------------------------------------------+---------
--   present       | session_id is a uuid string                    | live only if auth.sessions has a row with
--                 |                                                | id = session_id AND user_id = JWT sub;
--                 |                                                | no sub, no row, other owner, or ANY error
--                 |                                                | while looking it up  -> DENY
--   malformed     | session_id key exists but is not a uuid string | DENY
--                 | (bad string, JSON null, number, object, array, |
--                 | claims not parseable as a JSON object)         |
--   absent        | no session_id key at all                       | DENY when a JWT was transported by
--                 |                                                | PostgREST (request.jwt.claims is set);
--                 |                                                | compatibility TRUE only when NO JWT was
--                 |                                                | transported at all (SQL fixtures using the
--                 |                                                | legacy request.jwt.claim.* GUCs, psql,
--                 |                                                | trigger contexts of GoTrue/pg_cron)
--
-- Why the absent path is safe: PostgREST >= 9 sets exactly one GUC for the
-- JWT, request.jwt.claims (proven on the local v16.1 stack; the legacy
-- per-claim GUCs are never populated by the API). Every GoTrue-issued user
-- token carries session_id (proven, 2.196). So a transported JWT that
-- authenticates a user (sub) but names no session can never be a genuine
-- browser token, and denying it costs nothing. Tokens without sub (anon key,
-- service_role key) never reached the data anyway: is_active_user() /
-- current_role() require a sales row for the sub, and service_role bypasses
-- RLS; the executors check safe_auth_role() and never consult the session.
-- The remaining compatibility path (no JWT transported) is unreachable
-- through the API: nothing a client sends can populate request.jwt.claim.*.
--
-- Fail-closed prerequisite: with this contract, losing postgres' SELECT on
-- auth.sessions would deny every browser request instead of silently
-- degrading. The migration therefore refuses to install when the privilege
-- or a real lookup is missing (section 0), installs a postgres-internal
-- health primitive for later diagnosis (section 3), and self-tests the
-- contract before committing (section 4). The WARNING text
-- 'session binding DENIED' is the log search key.
--
-- Unchanged: nora_private.is_active_user() and current_role() bodies (they
-- already call jwt_session_is_live()); has_role / is_admin / can_write; every
-- policy, view and RPC; all grants of existing objects; service_role paths.
-- No table, column, trigger or Edge Function changes. No Hard Delete (W6-B).
-- Forward-only and replay-safe (CREATE OR REPLACE, revoke -> explicit grant).

-- ---------------------------------------------------------------------------
-- 0. Hard gate: the fail-closed binding must be verifiable on this platform
-- ---------------------------------------------------------------------------
do $$
declare
    v_dummy integer;
begin
    if current_user <> 'postgres' then
        raise exception 'W6-A: migration must run as postgres (current_user = %)', current_user;
    end if;

    if not has_table_privilege('postgres', 'auth.sessions', 'SELECT') then
        raise exception 'W6-A gate: postgres cannot SELECT auth.sessions — a fail-closed session binding would deny every employee. Restore the privilege before applying this migration.';
    end if;

    -- A real lookup, not only the catalog: RLS on auth.sessions, a missing
    -- column or a broken schema would surface here instead of after release.
    begin
        select 1 into v_dummy
        from auth.sessions s
        where s.id = gen_random_uuid() and s.user_id = gen_random_uuid();
    exception when others then
        raise exception 'W6-A gate: probe lookup on auth.sessions failed (% / %) — refusing to install the fail-closed binding', sqlstate, sqlerrm;
    end;

    raise notice 'W6-A gate: postgres can read auth.sessions — proceeding';
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Claim state — one place that reads the session claim
-- ---------------------------------------------------------------------------
-- Sources, in order:
--   request.jwt.claim.session_id  legacy per-claim GUC (SQL fixtures only;
--                                 PostgREST >= 9 never sets it)
--   request.jwt.claims            the JSON the API sets for every JWT
-- jwt_transported = request.jwt.claims is set, i.e. a JWT reached this
-- request through PostgREST. Nothing a client sends can set request.jwt.*
-- other than through its verified JWT.

create or replace function nora_private.jwt_session_claim(
    out claim_state text,
    out session_id uuid,
    out jwt_transported boolean
)
returns record
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_legacy text;
    v_claims_text text;
    v_claims jsonb;
    v_raw jsonb;
    v_text text;
begin
    claim_state := 'absent';
    session_id := null;

    v_legacy := nullif(current_setting('request.jwt.claim.session_id', true), '');
    v_claims_text := nullif(current_setting('request.jwt.claims', true), '');
    jwt_transported := v_claims_text is not null;

    if v_legacy is not null then
        v_text := v_legacy;
    elsif v_claims_text is not null then
        begin
            v_claims := v_claims_text::jsonb;
        exception when others then
            -- a transported claim set that cannot be read is not "no claim"
            claim_state := 'malformed';
            return;
        end;

        if jsonb_typeof(v_claims) <> 'object' then
            claim_state := 'malformed';
            return;
        end if;

        if not (v_claims ? 'session_id') then
            return; -- absent
        end if;

        v_raw := v_claims -> 'session_id';
        if jsonb_typeof(v_raw) <> 'string' then
            -- JSON null, number, boolean, object, array: present but unusable
            claim_state := 'malformed';
            return;
        end if;
        v_text := v_raw #>> '{}';
    else
        return; -- absent, and no JWT transported at all
    end if;

    begin
        session_id := v_text::uuid;
        claim_state := 'present';
    exception when others then
        claim_state := 'malformed';
        session_id := null;
    end;
end;
$$;

alter function nora_private.jwt_session_claim() owner to postgres;

comment on function nora_private.jwt_session_claim() is
    'W6-A: classifies the session_id claim of the current request — claim_state absent|present|malformed, session_id (only when present), jwt_transported (request.jwt.claims is set, i.e. PostgREST carried a JWT). Reads request.jwt.claim.session_id (legacy fixture GUC) before request.jwt.claims. Internal, not API-exposed.';

revoke all on function nora_private.jwt_session_claim() from public;
revoke all on function nora_private.jwt_session_claim() from anon;
revoke all on function nora_private.jwt_session_claim() from authenticated;
revoke all on function nora_private.jwt_session_claim() from service_role;
grant execute on function nora_private.jwt_session_claim() to postgres;

-- Kept for compatibility with existing suites: the session id when the claim
-- is present and well-formed, NULL otherwise. Callers must not derive
-- "no claim" from NULL any more — use jwt_session_claim() for that.
create or replace function nora_private.safe_auth_session_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
    select c.session_id from nora_private.jwt_session_claim() c;
$$;

comment on function nora_private.safe_auth_session_id() is
    'W5/W6-A: the session_id claim of the current JWT as uuid when present and well-formed, NULL when absent OR malformed. Do not use NULL to detect absence — see jwt_session_claim(). Internal, not API-exposed.';

-- ---------------------------------------------------------------------------
-- 2. Session liveness — owner-bound, fail-closed
-- ---------------------------------------------------------------------------
create or replace function nora_private.jwt_session_is_live()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_claim record;
    v_sub uuid;
begin
    v_claim := nora_private.jwt_session_claim();

    if v_claim.claim_state = 'malformed' then
        return false;
    end if;

    if v_claim.claim_state = 'absent' then
        -- A JWT that PostgREST transported without a session claim is never a
        -- GoTrue browser token: deny. Without any transported JWT (fixtures
        -- with the legacy GUCs, psql, internal trigger contexts) there is
        -- nothing to bind to: pre-W5 behaviour.
        return not v_claim.jwt_transported;
    end if;

    -- present: the session must exist AND belong to the authenticated subject.
    v_sub := nora_private.safe_auth_uid();
    if v_sub is null then
        return false;
    end if;

    begin
        return exists (
            select 1
            from auth.sessions s
            where s.id = v_claim.session_id
              and s.user_id = v_sub
        );
    exception when others then
        -- W6-A fail-closed: a session that cannot be verified is not live.
        raise warning 'nora_private.jwt_session_is_live: session binding DENIED — auth.sessions not verifiable (% %)', sqlstate, sqlerrm;
        return false;
    end;
end;
$$;

alter function nora_private.jwt_session_is_live() owner to postgres;

comment on function nora_private.jwt_session_is_live() is
    'W6-A: true only when the current JWT names a session (session_id) that exists in auth.sessions AND belongs to the JWT sub. Malformed claim -> false. Absent claim -> false when PostgREST transported a JWT (request.jwt.claims), true only when no JWT was transported at all (fixtures/internal). Any lookup failure -> WARNING "session binding DENIED" and false (fail-closed). Internal, not API-exposed.';

revoke all on function nora_private.jwt_session_is_live() from public;
revoke all on function nora_private.jwt_session_is_live() from anon;
revoke all on function nora_private.jwt_session_is_live() from authenticated;
revoke all on function nora_private.jwt_session_is_live() from service_role;
grant execute on function nora_private.jwt_session_is_live() to postgres;

-- is_active_user() and current_role() keep their W5 bodies: both already
-- evaluate jwt_session_is_live(); has_role/is_admin/can_write build on them.

-- ---------------------------------------------------------------------------
-- 3. Privilege health primitive (postgres-internal, no session data)
-- ---------------------------------------------------------------------------
-- Answers "can the fail-closed binding still be evaluated on this database?"
-- in one call for the SQL suites, the release runbook (read-only execute_sql)
-- and an incident where every employee suddenly sees no data. Exposes no
-- session ids, no user ids, no counts. Not an RPC: an administrator's browser
-- session could not authorize a call while the binding is broken, and the
-- Edge Function does not need it — postgres-only.

create or replace function nora_private.session_binding_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_readable boolean := has_table_privilege('postgres', 'auth.sessions', 'SELECT');
    v_deletable boolean := has_table_privilege('postgres', 'auth.sessions', 'DELETE')
                           and has_table_privilege('postgres', 'auth.refresh_tokens', 'DELETE');
    v_probe text := 'ok';
    v_dummy integer;
    v_src text;
    v_fail_closed boolean;
begin
    begin
        select 1 into v_dummy
        from auth.sessions s
        where s.id = gen_random_uuid() and s.user_id = gen_random_uuid();
    exception when others then
        v_probe := sqlstate;
    end;

    select p.prosrc into v_src
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'nora_private' and p.proname = 'jwt_session_is_live';

    v_fail_closed := v_src like '%W6-A fail-closed%'
                     and v_src not like '%session binding inactive%';

    return jsonb_build_object(
        'mode', case when v_fail_closed then 'fail_closed' else 'unknown' end,
        'auth_sessions_readable', v_readable,
        'auth_sessions_deletable', v_deletable,
        'lookup_probe', v_probe,
        'healthy', v_readable and v_deletable and v_probe = 'ok' and v_fail_closed,
        'checked_at', now()
    );
end;
$$;

alter function nora_private.session_binding_health() owner to postgres;

comment on function nora_private.session_binding_health() is
    'W6-A: privilege health of the session-bound authorization — auth.sessions readable/deletable by postgres, a real lookup probe, and whether the installed jwt_session_is_live() is the fail-closed W6-A version. healthy = all true. No session data. postgres-only (suites, runbook, incident diagnosis); not API-exposed.';

revoke all on function nora_private.session_binding_health() from public;
revoke all on function nora_private.session_binding_health() from anon;
revoke all on function nora_private.session_binding_health() from authenticated;
revoke all on function nora_private.session_binding_health() from service_role;
grant execute on function nora_private.session_binding_health() to postgres;

-- ---------------------------------------------------------------------------
-- 4. Self-test before commit (transaction-local settings, no rows written)
-- ---------------------------------------------------------------------------
do $$
declare
    v_health jsonb;
    v_sub uuid := gen_random_uuid();
    c record;
begin
    v_health := nora_private.session_binding_health();
    if (v_health ->> 'healthy')::boolean is not true then
        raise exception 'W6-A self-test: session binding not healthy: %', v_health;
    end if;

    -- legacy fixture GUCs, no session claim -> compatibility (not transported)
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', v_sub::text, true);
    perform set_config('request.jwt.claim.session_id', '', true);
    c := nora_private.jwt_session_claim();
    if c.claim_state <> 'absent' or c.jwt_transported or not nora_private.jwt_session_is_live() then
        raise exception 'W6-A self-test: untransported absent claim must stay compatible (%)', c;
    end if;

    -- legacy malformed -> deny
    perform set_config('request.jwt.claim.session_id', 'not-a-uuid', true);
    if nora_private.jwt_session_is_live() then
        raise exception 'W6-A self-test: malformed legacy claim must be denied';
    end if;

    -- legacy present, no such session -> deny (must not raise)
    perform set_config('request.jwt.claim.session_id', gen_random_uuid()::text, true);
    if nora_private.jwt_session_is_live() then
        raise exception 'W6-A self-test: ghost session must be denied';
    end if;
    perform set_config('request.jwt.claim.session_id', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);

    -- transported JWT (request.jwt.claims) without session claim -> deny
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_sub::text)::text, true);
    c := nora_private.jwt_session_claim();
    if c.claim_state <> 'absent' or not c.jwt_transported or nora_private.jwt_session_is_live() then
        raise exception 'W6-A self-test: transported JWT without session claim must be denied (%)', c;
    end if;

    -- transported JSON null / number / bad string -> malformed -> deny
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_sub::text, 'session_id', null)::text, true);
    if (nora_private.jwt_session_claim()).claim_state <> 'malformed' or nora_private.jwt_session_is_live() then
        raise exception 'W6-A self-test: JSON null session claim must be malformed/denied';
    end if;
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_sub::text, 'session_id', 42)::text, true);
    if (nora_private.jwt_session_claim()).claim_state <> 'malformed' or nora_private.jwt_session_is_live() then
        raise exception 'W6-A self-test: numeric session claim must be malformed/denied';
    end if;
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_sub::text, 'session_id', 'nope')::text, true);
    if (nora_private.jwt_session_claim()).claim_state <> 'malformed' or nora_private.jwt_session_is_live() then
        raise exception 'W6-A self-test: bad string session claim must be malformed/denied';
    end if;
    perform set_config('request.jwt.claims', '{not-json', true);
    if (nora_private.jwt_session_claim()).claim_state <> 'malformed' or nora_private.jwt_session_is_live() then
        raise exception 'W6-A self-test: unparseable claims must be malformed/denied';
    end if;

    perform set_config('request.jwt.claims', '', true);

    if has_function_privilege('anon', 'nora_private.jwt_session_is_live()', 'EXECUTE')
       or has_function_privilege('authenticated', 'nora_private.jwt_session_is_live()', 'EXECUTE')
       or has_function_privilege('service_role', 'nora_private.jwt_session_is_live()', 'EXECUTE')
       or has_function_privilege('authenticated', 'nora_private.jwt_session_claim()', 'EXECUTE')
       or has_function_privilege('service_role', 'nora_private.session_binding_health()', 'EXECUTE') then
        raise exception 'W6-A self-test: internal helpers must not be API-executable';
    end if;

    raise notice 'W6-A self-test passed: fail-closed, owner-bound session binding installed';
end;
$$;
