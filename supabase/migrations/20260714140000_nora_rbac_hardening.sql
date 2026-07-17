-- Nora CRM v0.4b.1: RBAC function hardening for production push
-- - nora_private schema for internal RLS helpers (not exposed via Data API)
-- - search_path = '' on SECURITY DEFINER functions
-- - auth.uid() instead of nora_auth_uid
-- - GUC privilege token for sales role changes
-- - anon table grant cleanup on protected tables

-- ---------------------------------------------------------------------------
-- 1. Internal schema (not in PostgREST / Data API schemas)
-- ---------------------------------------------------------------------------

create schema if not exists nora_private;

revoke all on schema nora_private from public;
revoke all on schema nora_private from anon;
revoke all on schema nora_private from authenticated;

comment on schema nora_private is
    'Internal RBAC/RLS helpers — not exposed via Supabase Data API. EXECUTE granted to authenticated for RLS policy evaluation only.';

-- ---------------------------------------------------------------------------
-- 2. Internal role helpers (SECURITY DEFINER, empty search_path)
-- ---------------------------------------------------------------------------

-- auth.uid() throws on malformed JWT sub; internal helpers use safe_auth_uid().
create or replace function nora_private.safe_auth_uid()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_sub text;
begin
    v_sub := nullif(current_setting('request.jwt.claim.sub', true), '');
    if v_sub is null then
        return null;
    end if;
    begin
        return v_sub::uuid;
    exception
        when invalid_text_representation then
            return null;
    end;
end;
$$;

comment on function nora_private.safe_auth_uid() is
    'Internal JWT sub reader; returns NULL on missing/invalid sub (no cast exception). Not exposed via Data API.';

revoke all on function nora_private.safe_auth_uid() from public;
revoke all on function nora_private.safe_auth_uid() from anon;
grant execute on function nora_private.safe_auth_uid() to authenticated;
grant execute on function nora_private.safe_auth_uid() to service_role;

create or replace function nora_private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.sales s
        where s.user_id = nora_private.safe_auth_uid()
          and s.disabled = false
    );
$$;

comment on function nora_private.is_active_user() is
    'True when auth.uid() maps to a non-disabled sales profile. SECURITY DEFINER; Owner: postgres.';

create or replace function nora_private.current_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select s.role
    from public.sales s
    where s.user_id = nora_private.safe_auth_uid()
      and s.disabled = false
    limit 1;
$$;

comment on function nora_private.current_role() is
    'Returns admin|office|viewer for active user; NULL if disabled or missing profile. SECURITY DEFINER; Owner: postgres.';

create or replace function nora_private.has_role(p_allowed text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(nora_private.current_role() = any (p_allowed), false);
$$;

comment on function nora_private.has_role(text[]) is
    'Role membership for RLS; false when disabled or missing profile. SECURITY DEFINER; Owner: postgres.';

create or replace function nora_private.can_write()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select nora_private.has_role(array['admin', 'office']);
$$;

comment on function nora_private.can_write() is
    'Shorthand for office/admin write access. SECURITY DEFINER; Owner: postgres.';

create or replace function nora_private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select nora_private.has_role(array['admin']);
$$;

comment on function nora_private.is_admin() is
    'Admin role check. SECURITY DEFINER; Owner: postgres.';

revoke all on function nora_private.is_active_user() from public;
revoke all on function nora_private.is_active_user() from anon;
grant execute on function nora_private.is_active_user() to authenticated;
grant execute on function nora_private.is_active_user() to service_role;

revoke all on function nora_private.current_role() from public;
revoke all on function nora_private.current_role() from anon;
grant execute on function nora_private.current_role() to authenticated;
grant execute on function nora_private.current_role() to service_role;

revoke all on function nora_private.has_role(text[]) from public;
revoke all on function nora_private.has_role(text[]) from anon;
grant execute on function nora_private.has_role(text[]) to authenticated;
grant execute on function nora_private.has_role(text[]) to service_role;

revoke all on function nora_private.can_write() from public;
revoke all on function nora_private.can_write() from anon;
grant execute on function nora_private.can_write() to authenticated;
grant execute on function nora_private.can_write() to service_role;

revoke all on function nora_private.is_admin() from public;
revoke all on function nora_private.is_admin() from anon;
grant execute on function nora_private.is_admin() to authenticated;
grant execute on function nora_private.is_admin() to service_role;

grant usage on schema nora_private to authenticated;
grant usage on schema nora_private to service_role;

-- ---------------------------------------------------------------------------
-- 3. Harden privilege GUC + sales immutability trigger
-- ---------------------------------------------------------------------------

create or replace function public.prevent_sales_privilege_escalation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if current_setting('nora.allow_sales_privilege_change', true) = 'on'
        and nullif(current_setting('nora.privilege_rpc_token', true), '') is not null then
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

-- ---------------------------------------------------------------------------
-- 4. Public RPC: set_sales_role_by_admin (hardened)
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
declare
    v_token text := gen_random_uuid()::text;
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

    perform set_config('nora.privilege_rpc_token', v_token, true);
    perform set_config('nora.allow_sales_privilege_change', 'on', true);

    begin
        update public.sales
        set
            role = p_role,
            disabled = coalesce(p_disabled, disabled)
        where id = p_sale_id;
    exception
        when others then
            perform set_config('nora.allow_sales_privilege_change', 'off', true);
            perform set_config('nora.privilege_rpc_token', '', true);
            raise;
    end;

    perform set_config('nora.allow_sales_privilege_change', 'off', true);
    perform set_config('nora.privilege_rpc_token', '', true);
end;
$$;

comment on function public.set_sales_role_by_admin(bigint, text, boolean) is
    'Admin/service_role only: set role and optional disabled flag. GUC token is transaction-local. PostgREST: yes.';

revoke all on function public.set_sales_role_by_admin(bigint, text, boolean) from public;
revoke all on function public.set_sales_role_by_admin(bigint, text, boolean) from anon;
grant execute on function public.set_sales_role_by_admin(bigint, text, boolean) to authenticated;
grant execute on function public.set_sales_role_by_admin(bigint, text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Other hardened functions (triggers + public RPCs)
-- ---------------------------------------------------------------------------

create or replace function public.set_sales_id_default()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.sales_id is null then
        select id into new.sales_id
        from public.sales
        where user_id = auth.uid();
    end if;
    return new;
end;
$$;

create or replace function public.sync_sales_administrator_from_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.administrator := (new.role = 'admin');
    return new;
end;
$$;

create or replace function public.enforce_checklist_item_checked_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if tg_op = 'UPDATE' and old.is_checked is distinct from new.is_checked then
        if new.is_checked then
            new.checked_by := auth.uid();
            new.checked_at := pg_catalog.now();
        else
            new.checked_by := null;
            new.checked_at := null;
        end if;
    end if;
    return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    sales_count int;
    v_role text;
begin
    select count(id) into sales_count from public.sales;

    if sales_count > 0 then
        v_role := 'viewer';
    else
        v_role := 'admin';
    end if;

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

create or replace function public.start_checklist_run_from_template(
    p_template_code text,
    p_deal_id bigint,
    p_contact_id bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_template public.checklist_templates%rowtype;
    v_deal public.deals%rowtype;
    v_run_id uuid;
    v_active_items int;
    v_lock_key1 int;
    v_lock_key2 int;
begin
    if auth.uid() is null then
        raise exception 'not authenticated' using errcode = '28000';
    end if;

    if not nora_private.has_role(array['admin', 'office']) then
        raise exception 'forbidden' using errcode = '42501';
    end if;

    select * into v_template from public.checklist_templates where code = p_template_code;
    if not found then
        raise exception 'checklist template not found: %', p_template_code using errcode = 'P0002';
    end if;
    if not v_template.is_active then
        raise exception 'checklist template is inactive: %', p_template_code using errcode = 'P0001';
    end if;

    select * into v_deal from public.deals where id = p_deal_id;
    if not found then
        raise exception 'deal not found: %', p_deal_id using errcode = 'P0002';
    end if;

    if p_contact_id is not null then
        if not exists (select 1 from public.contacts c where c.id = p_contact_id) then
            raise exception 'contact not found: %', p_contact_id using errcode = 'P0002';
        end if;
        if not exists (
            select 1 from public.contacts c
            where c.id = p_contact_id
              and (
                  (v_deal.contact_ids is not null and p_contact_id = any (v_deal.contact_ids))
                  or (v_deal.company_id is not null and c.company_id = v_deal.company_id)
              )
        ) then
            raise exception 'contact % is not linked to deal %', p_contact_id, p_deal_id using errcode = 'P0001';
        end if;
    end if;

    select count(*)::int into v_active_items
    from public.checklist_template_items i
    where i.template_id = v_template.id and i.is_active = true;

    if v_active_items = 0 then
        raise exception 'checklist template has no active items: %', p_template_code using errcode = 'P0001';
    end if;

    v_lock_key1 := pg_catalog.hashtext('nora_checklist_run');
    v_lock_key2 := pg_catalog.hashtext(p_deal_id::text || ':' || v_template.id::text);
    perform pg_catalog.pg_advisory_xact_lock(v_lock_key1, v_lock_key2);

    select r.id into v_run_id
    from public.checklist_runs r
    where r.deal_id = p_deal_id and r.template_id = v_template.id and r.status = 'open'
    limit 1;

    if v_run_id is not null then
        return v_run_id;
    end if;

    begin
        insert into public.checklist_runs (
            template_id, deal_id, company_id, contact_id, service_area_code, status, started_by
        )
        values (
            v_template.id, p_deal_id, v_deal.company_id, p_contact_id,
            v_template.service_area_code, 'open', auth.uid()
        )
        returning id into v_run_id;

        insert into public.checklist_run_items (
            checklist_run_id, template_item_id, label_snapshot, is_required, sort_index
        )
        select v_run_id, i.id, i.label, i.is_required, i.sort_index
        from public.checklist_template_items i
        where i.template_id = v_template.id and i.is_active = true
        order by i.sort_index, i.id;

        return v_run_id;
    exception
        when unique_violation then
            select r.id into v_run_id
            from public.checklist_runs r
            where r.deal_id = p_deal_id and r.template_id = v_template.id and r.status = 'open'
            limit 1;
            if v_run_id is null then
                raise;
            end if;
            return v_run_id;
    end;
end;
$$;

comment on function public.start_checklist_run_from_template(text, bigint, bigint) is
    'Start checklist run from template; office/admin only. PostgREST: yes.';

-- ---------------------------------------------------------------------------
-- 6. RLS policies → nora_private helpers
-- ---------------------------------------------------------------------------

-- Companies
drop policy if exists "Companies select active" on public.companies;
drop policy if exists "Companies insert writers" on public.companies;
drop policy if exists "Companies update writers" on public.companies;
drop policy if exists "Companies delete admin" on public.companies;

create policy "Companies select active" on public.companies
    for select to authenticated using (nora_private.is_active_user());
create policy "Companies insert writers" on public.companies
    for insert to authenticated with check (nora_private.can_write());
create policy "Companies update writers" on public.companies
    for update to authenticated using (nora_private.can_write()) with check (nora_private.can_write());
create policy "Companies delete admin" on public.companies
    for delete to authenticated using (nora_private.is_admin());

-- Contacts
drop policy if exists "Contacts select active" on public.contacts;
drop policy if exists "Contacts insert writers" on public.contacts;
drop policy if exists "Contacts update writers" on public.contacts;
drop policy if exists "Contacts delete admin" on public.contacts;

create policy "Contacts select active" on public.contacts
    for select to authenticated using (nora_private.is_active_user());
create policy "Contacts insert writers" on public.contacts
    for insert to authenticated with check (nora_private.can_write());
create policy "Contacts update writers" on public.contacts
    for update to authenticated using (nora_private.can_write()) with check (nora_private.can_write());
create policy "Contacts delete admin" on public.contacts
    for delete to authenticated using (nora_private.is_admin());

-- Contact notes
drop policy if exists "Contact notes select active" on public.contact_notes;
drop policy if exists "Contact notes insert writers" on public.contact_notes;
drop policy if exists "Contact notes update writers" on public.contact_notes;
drop policy if exists "Contact notes delete admin" on public.contact_notes;

create policy "Contact notes select active" on public.contact_notes
    for select to authenticated using (nora_private.is_active_user());
create policy "Contact notes insert writers" on public.contact_notes
    for insert to authenticated with check (nora_private.can_write());
create policy "Contact notes update writers" on public.contact_notes
    for update to authenticated using (nora_private.can_write()) with check (nora_private.can_write());
create policy "Contact notes delete admin" on public.contact_notes
    for delete to authenticated using (nora_private.is_admin());

-- Deals
drop policy if exists "Deals select active" on public.deals;
drop policy if exists "Deals insert writers" on public.deals;
drop policy if exists "Deals update writers" on public.deals;
drop policy if exists "Deals delete admin" on public.deals;

create policy "Deals select active" on public.deals
    for select to authenticated using (nora_private.is_active_user());
create policy "Deals insert writers" on public.deals
    for insert to authenticated with check (nora_private.can_write());
create policy "Deals update writers" on public.deals
    for update to authenticated using (nora_private.can_write()) with check (nora_private.can_write());
create policy "Deals delete admin" on public.deals
    for delete to authenticated using (nora_private.is_admin());

-- Deal notes
drop policy if exists "Deal notes select active" on public.deal_notes;
drop policy if exists "Deal notes insert writers" on public.deal_notes;
drop policy if exists "Deal notes update writers" on public.deal_notes;
drop policy if exists "Deal notes delete admin" on public.deal_notes;

create policy "Deal notes select active" on public.deal_notes
    for select to authenticated using (nora_private.is_active_user());
create policy "Deal notes insert writers" on public.deal_notes
    for insert to authenticated with check (nora_private.can_write());
create policy "Deal notes update writers" on public.deal_notes
    for update to authenticated using (nora_private.can_write()) with check (nora_private.can_write());
create policy "Deal notes delete admin" on public.deal_notes
    for delete to authenticated using (nora_private.is_admin());

-- Tasks
drop policy if exists "Tasks select active" on public.tasks;
drop policy if exists "Tasks insert writers" on public.tasks;
drop policy if exists "Tasks update writers" on public.tasks;
drop policy if exists "Tasks delete admin" on public.tasks;

create policy "Tasks select active" on public.tasks
    for select to authenticated using (nora_private.is_active_user());
create policy "Tasks insert writers" on public.tasks
    for insert to authenticated with check (nora_private.can_write());
create policy "Tasks update writers" on public.tasks
    for update to authenticated using (nora_private.can_write()) with check (nora_private.can_write());
create policy "Tasks delete admin" on public.tasks
    for delete to authenticated using (nora_private.is_admin());

-- Tags
drop policy if exists "Tags select active" on public.tags;
drop policy if exists "Tags insert writers" on public.tags;
drop policy if exists "Tags update writers" on public.tags;
drop policy if exists "Tags delete admin" on public.tags;

create policy "Tags select active" on public.tags
    for select to authenticated using (nora_private.is_active_user());
create policy "Tags insert writers" on public.tags
    for insert to authenticated with check (nora_private.can_write());
create policy "Tags update writers" on public.tags
    for update to authenticated using (nora_private.can_write()) with check (nora_private.can_write());
create policy "Tags delete admin" on public.tags
    for delete to authenticated using (nora_private.is_admin());

-- Sales
drop policy if exists "Sales select active" on public.sales;
drop policy if exists "Sales update own profile" on public.sales;

create policy "Sales select active" on public.sales
    for select to authenticated using (nora_private.is_active_user());
create policy "Sales update own profile" on public.sales
    for update to authenticated
    using (nora_private.is_active_user() and user_id = auth.uid())
    with check (nora_private.is_active_user() and user_id = auth.uid());

-- Configuration
drop policy if exists "Configuration select active" on public.configuration;
drop policy if exists "Configuration insert admin" on public.configuration;
drop policy if exists "Configuration update admin" on public.configuration;

create policy "Configuration select active" on public.configuration
    for select to authenticated using (nora_private.is_active_user());
create policy "Configuration insert admin" on public.configuration
    for insert to authenticated with check (nora_private.is_admin());
create policy "Configuration update admin" on public.configuration
    for update to authenticated using (nora_private.is_admin()) with check (nora_private.is_admin());

-- Favicons
drop policy if exists "Favicons select active" on public.favicons_excluded_domains;
drop policy if exists "Favicons insert admin" on public.favicons_excluded_domains;
drop policy if exists "Favicons update admin" on public.favicons_excluded_domains;
drop policy if exists "Favicons delete admin" on public.favicons_excluded_domains;

create policy "Favicons select active" on public.favicons_excluded_domains
    for select to authenticated using (nora_private.is_active_user());
create policy "Favicons insert admin" on public.favicons_excluded_domains
    for insert to authenticated with check (nora_private.is_admin());
create policy "Favicons update admin" on public.favicons_excluded_domains
    for update to authenticated using (nora_private.is_admin()) with check (nora_private.is_admin());
create policy "Favicons delete admin" on public.favicons_excluded_domains
    for delete to authenticated using (nora_private.is_admin());

-- Checklists
drop policy if exists "Checklist templates select active" on public.checklist_templates;
drop policy if exists "Checklist templates insert admin" on public.checklist_templates;
drop policy if exists "Checklist templates update admin" on public.checklist_templates;

create policy "Checklist templates select active" on public.checklist_templates
    for select to authenticated using (nora_private.is_active_user());
create policy "Checklist templates insert admin" on public.checklist_templates
    for insert to authenticated with check (nora_private.is_admin());
create policy "Checklist templates update admin" on public.checklist_templates
    for update to authenticated using (nora_private.is_admin()) with check (nora_private.is_admin());

drop policy if exists "Checklist template items select active" on public.checklist_template_items;
drop policy if exists "Checklist template items insert admin" on public.checklist_template_items;
drop policy if exists "Checklist template items update admin" on public.checklist_template_items;

create policy "Checklist template items select active" on public.checklist_template_items
    for select to authenticated using (nora_private.is_active_user());
create policy "Checklist template items insert admin" on public.checklist_template_items
    for insert to authenticated with check (nora_private.is_admin());
create policy "Checklist template items update admin" on public.checklist_template_items
    for update to authenticated using (nora_private.is_admin()) with check (nora_private.is_admin());

drop policy if exists "Checklist runs select active" on public.checklist_runs;
drop policy if exists "Checklist runs insert writers" on public.checklist_runs;
drop policy if exists "Checklist runs update writers" on public.checklist_runs;

create policy "Checklist runs select active" on public.checklist_runs
    for select to authenticated using (nora_private.is_active_user());
create policy "Checklist runs insert writers" on public.checklist_runs
    for insert to authenticated with check (nora_private.can_write());
create policy "Checklist runs update writers" on public.checklist_runs
    for update to authenticated using (nora_private.can_write()) with check (nora_private.can_write());

drop policy if exists "Checklist run items select active" on public.checklist_run_items;
drop policy if exists "Checklist run items insert writers" on public.checklist_run_items;
drop policy if exists "Checklist run items update writers" on public.checklist_run_items;

create policy "Checklist run items select active" on public.checklist_run_items
    for select to authenticated using (nora_private.is_active_user());
create policy "Checklist run items insert writers" on public.checklist_run_items
    for insert to authenticated with check (nora_private.can_write());
create policy "Checklist run items update writers" on public.checklist_run_items
    for update to authenticated using (nora_private.can_write()) with check (nora_private.can_write());

drop policy if exists "Saved text snippets select active" on public.saved_text_snippets;
drop policy if exists "Saved text snippets insert writers" on public.saved_text_snippets;
drop policy if exists "Saved text snippets update writers" on public.saved_text_snippets;

create policy "Saved text snippets select active" on public.saved_text_snippets
    for select to authenticated using (nora_private.is_active_user());
create policy "Saved text snippets insert writers" on public.saved_text_snippets
    for insert to authenticated with check (nora_private.can_write());
create policy "Saved text snippets update writers" on public.saved_text_snippets
    for update to authenticated
    using (
        nora_private.is_admin()
        or (nora_private.has_role(array['office']) and created_by = auth.uid())
    )
    with check (
        nora_private.is_admin()
        or (nora_private.has_role(array['office']) and created_by = auth.uid())
    );

drop policy if exists "Audit events read admin office" on public.audit_events;

create policy "Audit events read admin office" on public.audit_events
    for select to authenticated
    using (nora_private.has_role(array['admin', 'office']));

-- ---------------------------------------------------------------------------
-- 7. Drop deprecated public helpers (replaced by nora_private + auth.uid)
-- ---------------------------------------------------------------------------

drop function if exists public.nora_auth_uid();
drop function if exists public.nora_is_active_user();
drop function if exists public.current_nora_role();
drop function if exists public.has_nora_role(text[]);
drop function if exists public.nora_can_write();
drop function if exists public.is_admin();

-- ---------------------------------------------------------------------------
-- 8. Table grants: revoke anon on v0.4b-protected tables (RLS + grants)
-- ---------------------------------------------------------------------------

revoke all on table public.companies from anon;
revoke all on table public.contacts from anon;
revoke all on table public.contact_notes from anon;
revoke all on table public.deals from anon;
revoke all on table public.deal_notes from anon;
revoke all on table public.tasks from anon;
revoke all on table public.tags from anon;
revoke all on table public.sales from anon;
revoke all on table public.configuration from anon;
revoke all on table public.favicons_excluded_domains from anon;
revoke all on table public.checklist_templates from anon;
revoke all on table public.checklist_template_items from anon;
revoke all on table public.checklist_runs from anon;
revoke all on table public.checklist_run_items from anon;
revoke all on table public.saved_text_snippets from anon;
revoke all on table public.audit_events from anon;

grant select, insert, update, delete on table public.companies to authenticated;
grant select, insert, update, delete on table public.contacts to authenticated;
grant select, insert, update, delete on table public.contact_notes to authenticated;
grant select, insert, update, delete on table public.deals to authenticated;
grant select, insert, update, delete on table public.deal_notes to authenticated;
grant select, insert, update, delete on table public.tasks to authenticated;
grant select, insert, update, delete on table public.tags to authenticated;
grant select, update on table public.sales to authenticated;
grant select, insert, update on table public.configuration to authenticated;
grant select, insert, update, delete on table public.favicons_excluded_domains to authenticated;
grant select, insert, update on table public.checklist_templates to authenticated;
grant select, insert, update on table public.checklist_template_items to authenticated;
grant select, insert, update on table public.checklist_runs to authenticated;
grant select, insert, update on table public.checklist_run_items to authenticated;
grant select, insert, update on table public.saved_text_snippets to authenticated;
grant select on table public.audit_events to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Default privileges for future nora_private functions
-- ---------------------------------------------------------------------------

alter default privileges in schema nora_private
    revoke execute on functions from public;

alter default privileges in schema nora_private
    revoke execute on functions from anon;
