-- Nora User Lifecycle W4 (2026-09-06): controlled change of an employee's
-- login email (Supabase Auth identity) without letting public.sales.email and
-- auth.users.email drift, without touching the access state, and without
-- leaving old invitation / password links usable.
--
-- Why (proven against the real local stack, see docs/nora/06-decision-log.md
-- "2026-09-06 – User Lifecycle W4"):
--   * Today an Auth email update (Admin API) fails with
--     P0001 "sales.email is immutable for direct updates": GoTrue's own
--     UPDATE fires on_auth_user_updated -> handle_update_user, which writes
--     public.sales.email and is refused by prevent_sales_privilege_escalation.
--     Nothing changes (fail closed), but no supported path can change a login
--     email at all.
--   * GoTrue keeps outstanding invitation / password-setup links in
--     auth.one_time_tokens. An admin email change does not touch them: after
--     A -> B the link that was mailed to A still activates the account under B.
--   * A user-initiated GoTrue email change (PUT /auth/v1/user) would, once the
--     trigger no longer refuses it, silently rewrite sales.email without an
--     administrator and without audit.
--
-- What this migration does (forward-only, replay-safe):
--   1. role nora_identity_manager               NOLOGIN capability owner that may
--                                              change sales.email and nothing else
--   2. nora_private.sales_email_change_tickets  one short-lived ticket per employee,
--                                              written only by the executor RPC
--   3. public.prepare_sales_email_change        service_role-only guard + ticket
--   4. public.cancel_sales_email_change         service_role-only ticket removal
--   5. nora_private.guard_auth_email_change     BEFORE UPDATE OF email ON auth.users:
--                                              refuses every email change without a
--                                              matching ticket; with one, it writes
--                                              sales.email, deletes the user's
--                                              one-time tokens and the audit row —
--                                              all inside GoTrue's own transaction
--   6. handle_update_user                       no longer writes email (names only)
--   7. prevent_sales_privilege_escalation       identity-manager branch (email only)
--   8. resolve_audit_actor                      honours the pinned actor also in a
--                                              JWT-less database session (GoTrue)
--   9. uq__sales__email                         one login email = one employee
--
-- Trust boundary:
--   browser (authenticated JWT)
--     -> users Edge Function verifies the JWT, checks the admin role
--     -> supabaseAdmin (service_role) calls prepare_sales_email_change(actor, …)
--        which refuses non-service_role callers, non-admin actors, self changes,
--        unchanged / invalid / already-used addresses and inconsistent identities,
--        then writes the ticket
--     -> supabaseAdmin calls the GoTrue Admin API (email = new)
--     -> GoTrue's UPDATE auth.users fires guard_auth_email_change, which only
--        proceeds with a live ticket for exactly this user and this address
--   A browser cannot execute either RPC, cannot write the ticket table, cannot
--   update sales.email (trigger), and cannot make GoTrue change an email without
--   a ticket. The Auth identity and the Nora identity change in ONE Postgres
--   transaction (GoTrue and public.sales share the database), so neither side
--   can end up with the new address alone.
--
-- Compatible with Postgres 15 (local) and 17 (Production). Requires the
-- extensions.citext type used by public.sales.email and auth.one_time_tokens
-- (GoTrue >= 2.150; Production: proven present, read-only).

-- ---------------------------------------------------------------------------
-- 1. Dedicated NOLOGIN capability owner for login-email changes
-- ---------------------------------------------------------------------------

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'nora_identity_manager') then
        create role nora_identity_manager
            nosuperuser nobypassrls noinherit nocreaterole nocreatedb nologin;
    end if;
end
$$;

grant nora_identity_manager to postgres;

grant usage on schema public to nora_identity_manager;
grant usage on schema nora_private to nora_identity_manager;
-- Function ownership inside nora_private requires CREATE on the schema (same as nora_role_manager).
grant create on schema nora_private to nora_identity_manager;
grant select on table public.sales to nora_identity_manager;
grant update (email) on table public.sales to nora_identity_manager;

comment on role nora_identity_manager is
    'W4: NOLOGIN capability owner for sales.email updates via apply_sales_email_change only. May not change any other sales column.';

-- RLS on public.sales is role-based (current_user), mirror the role-manager policies.
drop policy if exists "Sales select identity manager" on public.sales;
create policy "Sales select identity manager" on public.sales
    for select using (current_user = 'nora_identity_manager');

drop policy if exists "Sales update by identity manager" on public.sales;
create policy "Sales update by identity manager" on public.sales
    for update using (current_user = 'nora_identity_manager')
    with check (current_user = 'nora_identity_manager');

-- ---------------------------------------------------------------------------
-- 2. Ticket table (internal, never API-exposed)
-- ---------------------------------------------------------------------------
-- One ticket per employee. A ticket says: "the verified administrator
-- <actor_user_id> has asked, in request <operation_id>, to move employee
-- <sale_id> (Auth user <user_id>) from <old_email> to <new_email>". It is
-- consumed by the auth.users trigger and expires quickly if GoTrue never
-- applies the change.

create table if not exists nora_private.sales_email_change_tickets (
    id uuid primary key default gen_random_uuid(),
    -- No foreign key on purpose (W2 rule: every FK on sales.id is NO ACTION and
    -- counted by the reference-integrity suite; a ticket is a two-minute intent,
    -- validated against the live sales row when it is consumed).
    sale_id bigint not null unique,
    user_id uuid not null,
    old_email extensions.citext not null,
    new_email extensions.citext not null,
    actor_user_id uuid not null,
    operation_id uuid,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    constraint sales_email_change_tickets_distinct_check check (old_email <> new_email)
);

alter table nora_private.sales_email_change_tickets enable row level security;

revoke all on table nora_private.sales_email_change_tickets from public;
revoke all on table nora_private.sales_email_change_tickets from anon;
revoke all on table nora_private.sales_email_change_tickets from authenticated;
revoke all on table nora_private.sales_email_change_tickets from service_role;

comment on table nora_private.sales_email_change_tickets is
    'W4: short-lived intent records for controlled login-email changes. Written only by prepare_sales_email_change (service_role RPC, verified admin actor), consumed by guard_auth_email_change inside GoTrue''s UPDATE. Not API-exposed.';

-- ---------------------------------------------------------------------------
-- 3. Normalisation (the provider contract, encoded once)
-- ---------------------------------------------------------------------------
-- GoTrue (proven locally, v2.196): refuses surrounding whitespace, stores the
-- address lower-cased, and reports a duplicate as SQLSTATE 23505. Nora
-- therefore trims and lower-cases BEFORE the provider sees the address and
-- checks uniqueness itself (public.sales.email is citext: case-insensitive).

create or replace function nora_private.normalize_login_email(p_email text)
returns extensions.citext
language plpgsql
immutable
set search_path = ''
as $$
declare
    v text;
begin
    v := lower(btrim(coalesce(p_email, '')));
    if v = '' or char_length(v) > 255
       or v !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    then
        raise exception 'invalid login email'
            using errcode = '22023', detail = 'NORA_EMAIL_INVALID';
    end if;
    return v::extensions.citext;
end;
$$;

alter function nora_private.normalize_login_email(text) owner to postgres;

revoke all on function nora_private.normalize_login_email(text) from public;
revoke all on function nora_private.normalize_login_email(text) from anon;
revoke all on function nora_private.normalize_login_email(text) from authenticated;
revoke all on function nora_private.normalize_login_email(text) from service_role;
grant execute on function nora_private.normalize_login_email(text) to postgres;

comment on function nora_private.normalize_login_email(text) is
    'W4: canonical login email = lower(btrim(x)), 1..255 chars, one @, a dot in the domain. Raises NORA_EMAIL_INVALID. Mirrors what GoTrue stores.';

-- ---------------------------------------------------------------------------
-- 4. Internal application of the email (owner = nora_identity_manager)
-- ---------------------------------------------------------------------------

create or replace function nora_private.apply_sales_email_change(
    p_sale_id bigint,
    p_email extensions.citext
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.sales
    set email = p_email
    where id = p_sale_id;

    if not found then
        raise exception 'sales profile not found: %', p_sale_id using errcode = 'P0002';
    end if;
end;
$$;

alter function nora_private.apply_sales_email_change(bigint, extensions.citext) owner to nora_identity_manager;

revoke all on function nora_private.apply_sales_email_change(bigint, extensions.citext) from public;
revoke all on function nora_private.apply_sales_email_change(bigint, extensions.citext) from anon;
revoke all on function nora_private.apply_sales_email_change(bigint, extensions.citext) from authenticated;
revoke all on function nora_private.apply_sales_email_change(bigint, extensions.citext) from service_role;
grant execute on function nora_private.apply_sales_email_change(bigint, extensions.citext) to postgres;

comment on function nora_private.apply_sales_email_change(bigint, extensions.citext) is
    'W4 internal: updates sales.email as nora_identity_manager. Called only by guard_auth_email_change inside GoTrue''s transaction. Not callable via Data API.';

-- ---------------------------------------------------------------------------
-- 5. Privilege trigger: identity-manager branch (email only)
-- ---------------------------------------------------------------------------

create or replace function public.prevent_sales_privilege_escalation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if current_user = 'nora_role_manager' then
        if tg_op = 'UPDATE' then
            if new.id is distinct from old.id then
                raise exception 'sales.id is immutable';
            end if;
            if new.user_id is distinct from old.user_id then
                raise exception 'sales.user_id is immutable';
            end if;
            if new.email is distinct from old.email then
                raise exception 'sales.email is immutable for role manager';
            end if;
            if new.first_name is distinct from old.first_name
                or new.last_name is distinct from old.last_name
                or new.avatar is distinct from old.avatar then
                raise exception 'role manager may only change role and disabled';
            end if;
        end if;
        return new;
    end if;

    -- W4: the identity manager may change the login email and nothing else.
    if current_user = 'nora_identity_manager' then
        if tg_op = 'UPDATE' then
            if new.id is distinct from old.id then
                raise exception 'sales.id is immutable';
            end if;
            if new.user_id is distinct from old.user_id then
                raise exception 'sales.user_id is immutable';
            end if;
            if new.role is distinct from old.role
                or new.administrator is distinct from old.administrator
                or new.disabled is distinct from old.disabled
                or new.first_name is distinct from old.first_name
                or new.last_name is distinct from old.last_name
                or new.avatar is distinct from old.avatar then
                raise exception 'identity manager may only change email';
            end if;
        end if;
        return new;
    end if;

    if tg_op = 'UPDATE' then
        if new.id is distinct from old.id then
            raise exception 'sales.id is immutable';
        end if;
        if new.user_id is distinct from old.user_id then
            raise exception 'sales.user_id is immutable';
        end if;
        if new.email is distinct from old.email then
            raise exception 'sales.email is immutable for direct updates';
        end if;
        if new.role is distinct from old.role then
            raise exception 'sales.role is immutable for direct updates';
        end if;
        if new.administrator is distinct from old.administrator then
            raise exception 'sales.administrator is immutable for direct updates';
        end if;
        if new.disabled is distinct from old.disabled then
            raise exception 'sales.disabled is immutable for direct updates';
        end if;
    end if;

    return new;
end;
$$;

comment on function public.prevent_sales_privilege_escalation() is
    'Blocks direct privilege field updates; only nora_role_manager (via apply_sales_role_change) may change role/disabled, only nora_identity_manager (via apply_sales_email_change, W4) may change email.';

-- ---------------------------------------------------------------------------
-- 6. Executor RPC: guards, then the ticket (service_role only)
-- ---------------------------------------------------------------------------
-- Nothing about the employee changes here. The RPC only decides whether the
-- change is allowed and records the intent for the auth.users trigger.

create or replace function public.prepare_sales_email_change(
    p_actor_user_id uuid,
    p_sale_id bigint,
    p_new_email text,
    p_operation_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_actor public.sales%rowtype;
    v_target public.sales%rowtype;
    v_auth_email text;
    v_auth_confirmed boolean;
    v_auth_banned boolean;
    v_new extensions.citext;
    v_ticket_id uuid;
begin
    -- Trust boundary: only the privileged server executor may call this.
    if coalesce(nora_private.safe_auth_role(), '') <> 'service_role' then
        raise exception 'forbidden'
            using errcode = '42501', detail = 'NORA_PERMISSION_DENIED';
    end if;

    if p_actor_user_id is null then
        raise exception 'actor required' using errcode = '22023';
    end if;
    if p_sale_id is null then
        raise exception 'target required' using errcode = '22023';
    end if;

    -- The actor parameter never creates privilege: an existing, active admin.
    select * into v_actor from public.sales where user_id = p_actor_user_id;
    if not found or v_actor.role <> 'admin' or v_actor.disabled then
        raise exception 'forbidden'
            using errcode = '42501', detail = 'NORA_PERMISSION_DENIED';
    end if;

    v_new := nora_private.normalize_login_email(p_new_email);

    select * into v_target from public.sales where id = p_sale_id for update;
    if not found then
        raise exception 'sales profile not found: %', p_sale_id
            using errcode = 'P0002';
    end if;

    -- Self guard: an administrator does not change their own login identity
    -- through the lifecycle path (a typo would lock out the only admin).
    if v_target.user_id = p_actor_user_id then
        raise exception 'administrators cannot change their own login email'
            using errcode = '42501', detail = 'NORA_SELF_EMAIL_CHANGE_FORBIDDEN';
    end if;

    -- Identity must be resolvable and consistent before it is moved.
    select u.email,
           (u.email_confirmed_at is not null),
           (u.banned_until is not null and u.banned_until > now())
      into v_auth_email, v_auth_confirmed, v_auth_banned
      from auth.users u
     where u.id = v_target.user_id;
    if not found then
        raise exception 'auth identity missing for sales %', p_sale_id
            using errcode = 'P0002', detail = 'NORA_EMPLOYEE_AUTH_NOT_FOUND';
    end if;
    if lower(btrim(coalesce(v_auth_email, ''))) <> lower(btrim(v_target.email::text)) then
        raise exception 'auth email and sales email differ for sales %', p_sale_id
            using errcode = '23514', detail = 'NORA_EMPLOYEE_IDENTITY_INCONSISTENT';
    end if;

    if v_target.email = v_new then
        raise exception 'login email unchanged'
            using errcode = '22023', detail = 'NORA_EMAIL_UNCHANGED';
    end if;

    -- Uniqueness across both identity stores (provider-equivalent normalisation).
    if exists (select 1 from public.sales s where s.email = v_new and s.id <> v_target.id)
       or exists (select 1 from auth.users u where lower(u.email) = v_new::text and u.id <> v_target.user_id)
    then
        raise exception 'login email already in use'
            using errcode = '23505', detail = 'NORA_EMAIL_ALREADY_IN_USE';
    end if;

    -- Housekeeping, then exactly one live ticket for this employee.
    delete from nora_private.sales_email_change_tickets where expires_at <= now();
    delete from nora_private.sales_email_change_tickets where sale_id = v_target.id;

    insert into nora_private.sales_email_change_tickets
        (sale_id, user_id, old_email, new_email, actor_user_id, operation_id, expires_at)
    values
        (v_target.id, v_target.user_id, v_target.email, v_new, p_actor_user_id, p_operation_id, now() + interval '2 minutes')
    returning id into v_ticket_id;

    return jsonb_build_object(
        'ticket_id', v_ticket_id,
        'sale_id', v_target.id,
        'user_id', v_target.user_id,
        'old_email', v_target.email::text,
        'new_email', v_new::text,
        'role', v_target.role,
        'disabled', v_target.disabled,
        'auth_confirmed', v_auth_confirmed,
        'auth_banned', v_auth_banned
    );
end;
$$;

alter function public.prepare_sales_email_change(uuid, bigint, text, uuid) owner to postgres;

comment on function public.prepare_sales_email_change(uuid, bigint, text, uuid) is
    'W4 lifecycle executor step 1: service_role only. p_actor_user_id must be an active admin (verified by the users Edge Function from the caller JWT). Validates and normalises the address, refuses self changes (NORA_SELF_EMAIL_CHANGE_FORBIDDEN), unchanged (NORA_EMAIL_UNCHANGED), used (NORA_EMAIL_ALREADY_IN_USE), invalid (NORA_EMAIL_INVALID) addresses and inconsistent identities (NORA_EMPLOYEE_AUTH_NOT_FOUND / NORA_EMPLOYEE_IDENTITY_INCONSISTENT), then writes the ticket guard_auth_email_change consumes. Changes nothing about the employee itself.';

revoke all on function public.prepare_sales_email_change(uuid, bigint, text, uuid) from public;
revoke all on function public.prepare_sales_email_change(uuid, bigint, text, uuid) from anon;
revoke all on function public.prepare_sales_email_change(uuid, bigint, text, uuid) from authenticated;
grant execute on function public.prepare_sales_email_change(uuid, bigint, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Ticket removal after a refused / failed provider call (service_role only)
-- ---------------------------------------------------------------------------
-- Returns true when a live ticket was removed, false when none existed — the
-- latter after a successful change means "the trigger consumed it".

create or replace function public.cancel_sales_email_change(p_ticket_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_deleted integer;
begin
    if coalesce(nora_private.safe_auth_role(), '') <> 'service_role' then
        raise exception 'forbidden'
            using errcode = '42501', detail = 'NORA_PERMISSION_DENIED';
    end if;
    if p_ticket_id is null then
        raise exception 'ticket required' using errcode = '22023';
    end if;

    delete from nora_private.sales_email_change_tickets where id = p_ticket_id;
    get diagnostics v_deleted = row_count;
    return v_deleted > 0;
end;
$$;

alter function public.cancel_sales_email_change(uuid) owner to postgres;

comment on function public.cancel_sales_email_change(uuid) is
    'W4 lifecycle executor: service_role only. Removes an unconsumed email-change ticket after the provider refused or failed. Returns false when the ticket no longer exists (consumed or expired).';

revoke all on function public.cancel_sales_email_change(uuid) from public;
revoke all on function public.cancel_sales_email_change(uuid) from anon;
revoke all on function public.cancel_sales_email_change(uuid) from authenticated;
grant execute on function public.cancel_sales_email_change(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 8. Actor bridge: honour the pinned actor also without any JWT
-- ---------------------------------------------------------------------------
-- The W4 audit row is written inside GoTrue's own database session, which
-- carries no JWT claims at all (safe_auth_role() IS NULL). Such a session can
-- only be a direct database client (GoTrue, migrations, psql) — PostgREST
-- always stamps a role claim, anon included — so a pinned actor there is as
-- trustworthy as under service_role. Everything else is unchanged: a JWT sub
-- always wins, an unpinned session stays "System", and a pinned id that names
-- no employee still fails hard.

create or replace function nora_private.resolve_audit_actor()
returns table (
    actor_auth_id uuid,
    actor_sales_id bigint,
    actor_name text,
    actor_role text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_uid uuid;
    v_sale public.sales%rowtype;
    v_pinned text;
    v_pinned_uid uuid;
begin
    v_uid := nora_private.safe_auth_uid();

    if v_uid is null then
        -- W3: privileged server path (service_role) with a verified human actor
        -- pinned by the executor. W4: also a JWT-less database session
        -- (GoTrue applying a ticketed email change).
        if coalesce(nora_private.safe_auth_role(), '') in ('service_role', '') then
            begin
                v_pinned := nullif(btrim(current_setting('nora.audit_actor_user_id', true)), '');
            exception
                when others then
                    v_pinned := null;
            end;

            if v_pinned is not null then
                begin
                    v_pinned_uid := v_pinned::uuid;
                exception
                    when others then
                        raise exception 'audit actor context is not a uuid'
                            using errcode = '22023', detail = 'NORA_AUDIT_ACTOR_INVALID';
                end;

                select * into v_sale
                from public.sales s
                where s.user_id = v_pinned_uid
                limit 1;

                if not found then
                    raise exception 'audit actor does not resolve to an employee'
                        using errcode = '42501', detail = 'NORA_AUDIT_ACTOR_INVALID';
                end if;

                return query select
                    v_pinned_uid,
                    v_sale.id,
                    trim(v_sale.first_name || ' ' || v_sale.last_name),
                    v_sale.role;
                return;
            end if;
        end if;

        -- Genuine automation (no verified human): System stays valid.
        return query select null::uuid, null::bigint, 'System'::text, null::text;
        return;
    end if;

    select * into v_sale
    from public.sales s
    where s.user_id = v_uid
      and s.disabled = false
    limit 1;

    if not found then
        return query select v_uid, null::bigint, 'Unbekannter Benutzer'::text, null::text;
        return;
    end if;

    return query select
        v_uid,
        v_sale.id,
        trim(v_sale.first_name || ' ' || v_sale.last_name),
        v_sale.role;
end;
$$;

alter function nora_private.resolve_audit_actor() owner to postgres;

comment on function nora_private.resolve_audit_actor() is
    'Audit actor snapshots: JWT sub (browser) or, under service_role or in a JWT-less database session (W4: GoTrue applying a ticketed email change), the verified human pinned in the transaction-local GUC nora.audit_actor_user_id by the lifecycle executor. Unpinned writes stay "System". A pinned id that names no employee raises NORA_AUDIT_ACTOR_INVALID.';

revoke all on function nora_private.resolve_audit_actor() from public;
revoke all on function nora_private.resolve_audit_actor() from anon;
revoke all on function nora_private.resolve_audit_actor() from authenticated;
revoke all on function nora_private.resolve_audit_actor() from service_role;
grant execute on function nora_private.resolve_audit_actor() to postgres;
grant execute on function nora_private.resolve_audit_actor() to nora_audit_writer;

-- ---------------------------------------------------------------------------
-- 9. The guard on auth.users: ticket or refusal; with a ticket everything at once
-- ---------------------------------------------------------------------------

create or replace function nora_private.guard_auth_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_ticket nora_private.sales_email_change_tickets%rowtype;
    v_sale public.sales%rowtype;
    v_actor public.sales%rowtype;
begin
    if old.email is not distinct from new.email then
        return new;
    end if;

    select * into v_ticket
      from nora_private.sales_email_change_tickets t
     where t.user_id = new.id
       and t.expires_at > now()
       and t.new_email = new.email::extensions.citext
     for update;

    if not found then
        raise exception 'login email changes are only possible through the Nora lifecycle executor'
            using errcode = '42501', detail = 'NORA_EMAIL_CHANGE_NOT_AUTHORIZED';
    end if;

    select * into v_sale from public.sales where id = v_ticket.sale_id for update;
    if not found or v_sale.user_id <> new.id then
        raise exception 'email change ticket does not match the employee'
            using errcode = '23514', detail = 'NORA_EMPLOYEE_IDENTITY_INCONSISTENT';
    end if;
    if v_sale.email <> v_ticket.old_email
       or lower(btrim(coalesce(old.email, ''))) <> lower(btrim(v_ticket.old_email::text)) then
        raise exception 'identity moved since the ticket was written'
            using errcode = '23514', detail = 'NORA_EMPLOYEE_IDENTITY_INCONSISTENT';
    end if;

    -- The actor is re-checked at apply time: still an existing, active admin.
    select * into v_actor from public.sales where user_id = v_ticket.actor_user_id;
    if not found or v_actor.role <> 'admin' or v_actor.disabled then
        raise exception 'email change actor is no longer an active administrator'
            using errcode = '42501', detail = 'NORA_PERMISSION_DENIED';
    end if;

    -- (a) Nora identity follows the Auth identity — same transaction.
    perform nora_private.apply_sales_email_change(v_sale.id, new.email::extensions.citext);

    -- (b) Links mailed to the old address stop working: GoTrue keeps every
    --     outstanding invitation / password-setup token in one_time_tokens.
    delete from auth.one_time_tokens where user_id = new.id;

    -- (c) The ticket is single-use.
    delete from nora_private.sales_email_change_tickets where id = v_ticket.id;

    -- (d) Durable business record, attributed to the verified administrator,
    --     correlated with the request, only when (a)-(c) commit with it.
    perform nora_private.pin_audit_context(v_ticket.actor_user_id, v_ticket.operation_id);
    perform nora_private.write_audit_event(
        p_event_type := 'user.email_changed',
        p_entity_type := 'sales',
        p_entity_id := public.nora_entity_uuid('sales', v_sale.id),
        p_changes := jsonb_build_object(
            'email',
            jsonb_build_object('old', v_ticket.old_email::text, 'new', new.email)
        ),
        p_metadata := jsonb_build_object(
            'sale_id', v_sale.id,
            'employee_sale_id', v_sale.id,
            'actor_sale_id', v_actor.id,
            'disabled', v_sale.disabled,
            'role', v_sale.role
        ),
        p_retention_class := 'user_management',
        p_source := 'user'
    );
    perform nora_private.pin_audit_context(null, null);

    return new;
end;
$$;

alter function nora_private.guard_auth_email_change() owner to postgres;

comment on function nora_private.guard_auth_email_change() is
    'W4: BEFORE UPDATE OF email ON auth.users. Refuses any email change without a live ticket for this user and address (NORA_EMAIL_CHANGE_NOT_AUTHORIZED). With a ticket: writes sales.email (as nora_identity_manager), deletes the user''s auth.one_time_tokens (old invitation / password links), consumes the ticket and writes user.email_changed with the pinned admin actor — all in GoTrue''s transaction. Access state (sales.disabled, banned_until, role) is never touched.';

revoke all on function nora_private.guard_auth_email_change() from public;
revoke all on function nora_private.guard_auth_email_change() from anon;
revoke all on function nora_private.guard_auth_email_change() from authenticated;
revoke all on function nora_private.guard_auth_email_change() from service_role;

drop trigger if exists guard_auth_email_change_trigger on auth.users;

create trigger guard_auth_email_change_trigger
    before update of email on auth.users
    for each row
    when (old.email is distinct from new.email)
    execute function nora_private.guard_auth_email_change();

-- ---------------------------------------------------------------------------
-- 10. Auth -> sales name sync no longer touches the email
-- ---------------------------------------------------------------------------
-- The email is owned by the guard above (one writer). Names keep flowing from
-- user_metadata as before.

create or replace function public.handle_update_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.sales
  set
    first_name = coalesce(new.raw_user_meta_data ->> 'first_name', new.raw_user_meta_data -> 'custom_claims' ->> 'first_name', 'Pending'),
    last_name = coalesce(new.raw_user_meta_data ->> 'last_name', new.raw_user_meta_data -> 'custom_claims' ->> 'last_name', 'Pending')
  where user_id = new.id;

  return new;
end;
$$;

comment on function public.handle_update_user() is
    'Auth -> sales sync for first_name/last_name from user_metadata. Since W4 it does not write sales.email: the login email changes only through the ticketed guard_auth_email_change.';

-- ---------------------------------------------------------------------------
-- 11. One login email = one employee
-- ---------------------------------------------------------------------------
-- public.sales.email is citext, so the index is case-insensitive. Production
-- was preflighted read-only (no duplicates under lower(btrim(...))).

create unique index if not exists uq__sales__email on public.sales using btree (email);
