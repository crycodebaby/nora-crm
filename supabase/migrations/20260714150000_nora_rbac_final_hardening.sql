-- Nora CRM v0.4b.2: RBAC final hardening
-- - Replace GUC privilege token with nora_role_manager NOLOGIN capability
-- - Parallel-safe first admin via advisory xact lock
-- - sales_directory view for reduced team data exposure
-- - Tighten public.sales SELECT to own row + admin only

-- ---------------------------------------------------------------------------
-- 1. Dedicated NOLOGIN role for controlled privilege changes
-- ---------------------------------------------------------------------------

create role nora_role_manager nosuperuser nobypassrls noinherit nocreaterole nocreatedb nologin;

grant nora_role_manager to postgres;

grant usage on schema public to nora_role_manager;
grant usage on schema nora_private to nora_role_manager;
grant create on schema nora_private to nora_role_manager;
grant update on table public.sales to nora_role_manager;
grant select on table public.sales to nora_role_manager;

comment on role nora_role_manager is
    'NOLOGIN capability owner for sales role/disabled updates via apply_sales_role_change only.';

-- ---------------------------------------------------------------------------
-- 2. Internal privilege application (owner = nora_role_manager)
-- ---------------------------------------------------------------------------

create or replace function nora_private.apply_sales_role_change(
    p_sale_id bigint,
    p_role text,
    p_disabled boolean default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if p_role is null or p_role not in ('admin', 'office', 'viewer') then
        raise exception 'invalid role: %', p_role using errcode = '22023';
    end if;

    update public.sales
    set
        role = p_role,
        disabled = coalesce(p_disabled, disabled)
    where id = p_sale_id;

    if not found then
        raise exception 'sales profile not found: %', p_sale_id using errcode = 'P0002';
    end if;
end;
$$;

alter function nora_private.apply_sales_role_change(bigint, text, boolean) owner to nora_role_manager;

comment on function nora_private.apply_sales_role_change(bigint, text, boolean) is
    'Internal: updates sales.role/disabled as nora_role_manager. Not callable via Data API.';

revoke all on function nora_private.apply_sales_role_change(bigint, text, boolean) from public;
revoke all on function nora_private.apply_sales_role_change(bigint, text, boolean) from anon;
revoke all on function nora_private.apply_sales_role_change(bigint, text, boolean) from authenticated;
revoke all on function nora_private.apply_sales_role_change(bigint, text, boolean) from service_role;
grant execute on function nora_private.apply_sales_role_change(bigint, text, boolean) to postgres;

-- ---------------------------------------------------------------------------
-- 3. Harden privilege trigger (owner capability, no GUC)
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
    'Blocks direct privilege field updates; only nora_role_manager (via apply_sales_role_change) may change role/disabled.';

-- ---------------------------------------------------------------------------
-- 4. Public RPC: set_sales_role_by_admin (delegates to capability owner)
-- ---------------------------------------------------------------------------

create or replace function public.set_sales_role_by_admin(
    p_sale_id bigint,
    p_role text,
    p_disabled boolean default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if p_role is null or p_role not in ('admin', 'office', 'viewer') then
        raise exception 'invalid role: %', p_role using errcode = '22023';
    end if;

    if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
        if not nora_private.is_admin() then
            raise exception 'forbidden' using errcode = '42501';
        end if;
    end if;

    if not exists (select 1 from public.sales where id = p_sale_id) then
        raise exception 'sales profile not found: %', p_sale_id using errcode = 'P0002';
    end if;

    perform nora_private.apply_sales_role_change(p_sale_id, p_role, p_disabled);
end;
$$;

comment on function public.set_sales_role_by_admin(bigint, text, boolean) is
    'Admin/service_role only: set role and optional disabled via nora_role_manager capability. PostgREST: yes.';

-- ---------------------------------------------------------------------------
-- 5. Parallel-safe first admin on signup
-- ---------------------------------------------------------------------------

create or replace function nora_private.resolve_first_signup_role()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    sales_count int;
begin
    perform pg_catalog.pg_advisory_xact_lock(89142421, 1);
    select count(*)::int into sales_count from public.sales;
    if sales_count > 0 then
        return 'viewer';
    end if;
    return 'admin';
end;
$$;

comment on function nora_private.resolve_first_signup_role() is
    'Transaction-local advisory lock + count; first signup admin, subsequent viewer.';

revoke all on function nora_private.resolve_first_signup_role() from public;
revoke all on function nora_private.resolve_first_signup_role() from anon;
revoke all on function nora_private.resolve_first_signup_role() from authenticated;
revoke all on function nora_private.resolve_first_signup_role() from service_role;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_role text;
begin
    v_role := nora_private.resolve_first_signup_role();

    insert into public.sales (first_name, last_name, email, user_id, role, administrator)
    values (
        coalesce(new.raw_user_meta_data ->> 'first_name', new.raw_user_meta_data -> 'custom_claims' ->> 'first_name', 'Pending'),
        coalesce(new.raw_user_meta_data ->> 'last_name', new.raw_user_meta_data -> 'custom_claims' ->> 'last_name', 'Pending'),
        new.email,
        new.id,
        v_role,
        (v_role = 'admin')
    );
    return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. sales_directory - reduced team exposure
-- ---------------------------------------------------------------------------

create or replace view public.sales_directory
with (security_invoker = false)
as
select
    s.id,
    s.first_name,
    s.last_name,
    s.avatar
from public.sales s
where s.disabled = false
  and nora_private.is_active_user();

comment on view public.sales_directory is
    'Active team directory; caller must be active (is_active_user). No role/email/user_id.';

alter view public.sales_directory set (security_invoker = false);

-- ---------------------------------------------------------------------------
-- 7. RLS: tightened sales SELECT
-- ---------------------------------------------------------------------------

drop policy if exists "Sales select active" on public.sales;

create policy "Sales select own or admin" on public.sales
    for select to authenticated
    using (
        nora_private.is_active_user()
        and (user_id = auth.uid() or nora_private.is_admin())
    );

create policy "Sales select role manager" on public.sales
    for select
    using (current_user = 'nora_role_manager');

create policy "Sales update by role manager" on public.sales
    for update
    using (current_user = 'nora_role_manager')
    with check (current_user = 'nora_role_manager');

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------

revoke all on table public.sales_directory from public;
revoke all on table public.sales_directory from anon;
grant select on table public.sales_directory to authenticated;
grant select on table public.sales_directory to service_role;
