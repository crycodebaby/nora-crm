-- Nora CRM Security Closure (2026-09-27): signup admission guard.
--
-- PROBLEM
-- Until this migration public.handle_new_user() turned EVERY new auth.users row
-- into an ACTIVE employee. The full chain, reproduced against a local stack on
-- 2026-09-27:
--
--     POST /auth/v1/signup  (anon publishable key, no invitation)
--       -> auth.users row
--       -> handle_new_user() inserts public.sales (role 'viewer', disabled false)
--       -> nora_private.is_active_user() is TRUE for that identity
--       -> every "… select active" RLS policy (companies, contacts, deals,
--          notes, tasks, tags, configuration) and the storage policy
--          attachments_select_active_user let it read the shared CRM dataset.
--
-- Disabling self-signup in the Supabase dashboard (production: disable_signup =
-- true, verified read-only 2026-09-27) removes the reachable route, but it is a
-- single external toggle in a dashboard — it is not an invariant of this
-- database and it does not survive a project restore, a new provider being
-- switched on, or an operator mistake. This migration adds the invariant.
--
-- INVARIANT
-- An auth identity becomes an ACTIVE employee only when its admission can be
-- proven. Exactly two admissions exist:
--
--   1. BOOTSTRAP — public.sales is empty. The first identity on a fresh stack
--      becomes the active administrator. This is the existing, deliberate
--      first-user semantics (decision "RBAC/RLS v0.4b", docs 22): it is how a
--      local, demo and e2e stack comes up (e2e/helpers/e2eState.ts
--      ensureE2eAdmin creates the canonical admin on a pristine stack and lets
--      this trigger assign the role). It is unchanged.
--
--   2. INVITATION — GoTrue stamps auth.users.invited_at when, and only when,
--      the admin invite endpoint is used. In Nora that is
--      supabaseAdmin.auth.admin.inviteUserByEmail() in the service-role-only
--      `users` Edge Function, reachable solely for an admin sales row. No
--      self-service route and no authenticated client can set invited_at.
--
-- Anything else — a direct /auth/v1/signup, a user added by hand in the
-- Supabase dashboard, a future SSO provider — is admitted FAIL CLOSED. The
-- sales row is still created, so one auth identity still maps to exactly one
-- employee row and an administrator can see and act on it, but it is created
-- with disabled = true. nora_private.is_active_user() is then false and every
-- CRM and storage policy denies the identity. The account can still
-- authenticate; it just cannot read or write any business data.
--
-- MEASURED GoTrue BEHAVIOUR THIS DEPENDS ON
-- Probed against the local stack on 2026-09-27 with a temporary AFTER INSERT
-- trigger on auth.users, across all three creation paths:
--
--     path                              invited_at visible in the INSERT?
--     POST /auth/v1/invite              NO  -> stamped ~12 ms later by UPDATE
--     POST /auth/v1/signup              NO  -> stays NULL forever
--     POST /auth/v1/admin/users         NO  -> stays NULL forever
--
-- GoTrue inserts the auth.users row FIRST and stamps invited_at in a follow-up
-- UPDATE. Testing new.invited_at inside the AFTER INSERT trigger therefore
-- proves nothing and would have disabled every legitimately invited employee.
-- Admission is consequently split across the two auth triggers that already
-- exist: on_auth_user_created fails closed, and on_auth_user_updated releases
-- the account at the NULL -> NOT NULL invited_at transition, which is GoTrue's
-- own record of the admin invite.
--
-- WHY THE RELEASE GOES THROUGH THE EXECUTOR
-- public.sales.disabled is immutable for direct updates
-- (public.prevent_sales_privilege_escalation): only nora_role_manager may
-- change role/disabled, and only through nora_private.apply_sales_role_change.
-- The release respects that single-executor rule instead of working around it,
-- so this migration introduces no second authority over employee access.
--
-- NOT CHANGED
-- nora_private.resolve_first_signup_role() keeps its exact contract and its
-- advisory lock; it remains the documented "exactly one first admin under
-- concurrency" boundary (supabase/tests/rbac_rls_first_admin_parallel.sql).
-- This migration reuses its answer rather than adding a second count: the
-- resolver returns 'admin' only for the bootstrap identity, so "bootstrap" and
-- "active" are decided by the same advisory-locked read.

-- ---------------------------------------------------------------------------
-- 1. handle_new_user: fail closed unless this is the bootstrap identity
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_role      text;
    v_bootstrap boolean;
begin
    -- Advisory-locked: returns 'admin' only while public.sales is still empty.
    v_role := nora_private.resolve_first_signup_role();
    v_bootstrap := (v_role = 'admin');

    -- Admission: the bootstrap identity is active, everyone else is created
    -- disabled and is released only by the invite transition below.
    insert into public.sales (first_name, last_name, email, user_id, role, administrator, disabled)
    values (
        coalesce(new.raw_user_meta_data ->> 'first_name', new.raw_user_meta_data -> 'custom_claims' ->> 'first_name', 'Pending'),
        coalesce(new.raw_user_meta_data ->> 'last_name', new.raw_user_meta_data -> 'custom_claims' ->> 'last_name', 'Pending'),
        new.email,
        new.id,
        v_role,
        v_bootstrap,
        not v_bootstrap
    );

    return new;
end;
$$;

alter function public.handle_new_user() owner to postgres;

comment on function public.handle_new_user() is
    'Creates the public.sales row for a new auth identity. Active only for the bootstrap identity (empty public.sales); every other identity is created disabled = true and is released only by handle_update_user() at the invited_at transition. Security Closure 2026-09-27.';

-- ---------------------------------------------------------------------------
-- 2. handle_update_user: release the admission when GoTrue stamps the invite
-- ---------------------------------------------------------------------------

create or replace function public.handle_update_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_sale_id  bigint;
    v_role     text;
    v_disabled boolean;
begin
    update public.sales
    set
        first_name = coalesce(new.raw_user_meta_data ->> 'first_name', new.raw_user_meta_data -> 'custom_claims' ->> 'first_name', 'Pending'),
        last_name  = coalesce(new.raw_user_meta_data ->> 'last_name', new.raw_user_meta_data -> 'custom_claims' ->> 'last_name', 'Pending')
    where user_id = new.id;

    -- Admission release. invited_at goes NULL -> NOT NULL exactly once, when an
    -- administrator invited this address through the `users` Edge Function; no
    -- client-reachable route can set it. Only a still-fail-closed row is
    -- released, so a deliberate later deactivation by an administrator is never
    -- undone by a subsequent auth.users update.
    if old.invited_at is null and new.invited_at is not null then
        select s.id, s.role, s.disabled
          into v_sale_id, v_role, v_disabled
          from public.sales s
         where s.user_id = new.id;

        if found and v_disabled then
            -- sales.disabled is immutable for direct updates; the single
            -- executor (owner nora_role_manager) is the only writer.
            perform nora_private.apply_sales_role_change(v_sale_id, v_role, false);
        end if;
    end if;

    return new;
end;
$$;

alter function public.handle_update_user() owner to postgres;

comment on function public.handle_update_user() is
    'Syncs name metadata from auth.users to public.sales and releases the fail-closed signup admission when GoTrue stamps invited_at, through nora_private.apply_sales_role_change. Security Closure 2026-09-27.';
