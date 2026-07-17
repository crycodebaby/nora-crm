-- Nora CRM v0.4b: RBAC (sales.role) and hardened RLS
-- Rollback: restore prior policies from migration history; DROP COLUMN sales.role only after
--           reverting policies that reference role functions.

-- ---------------------------------------------------------------------------
-- 1. sales.role column + least-privilege backfill
-- ---------------------------------------------------------------------------

alter table public.sales
    add column if not exists role text;

update public.sales
set role = case when administrator = true then 'admin' else 'viewer' end
where role is null;

alter table public.sales
    alter column role set default 'viewer';

alter table public.sales
    alter column role set not null;

alter table public.sales
    drop constraint if exists sales_role_check;

alter table public.sales
    add constraint sales_role_check
    check (role in ('admin', 'office', 'viewer'));

-- Enforce administrator mirror from role (existing rows)
update public.sales
set administrator = (role = 'admin');

-- ---------------------------------------------------------------------------
-- 2. Role helper functions (SECURITY DEFINER, fixed search_path)
-- ---------------------------------------------------------------------------

create or replace function public.nora_auth_uid()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

comment on function public.nora_auth_uid() is
    'SECURITY DEFINER wrapper for auth.uid(); Owner: postgres. EXECUTE: authenticated, service_role.';

revoke all on function public.nora_auth_uid() from public;
revoke all on function public.nora_auth_uid() from anon;
grant execute on function public.nora_auth_uid() to authenticated;
grant execute on function public.nora_auth_uid() to service_role;

create or replace function public.nora_is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.sales s
        where s.user_id = public.nora_auth_uid()
          and s.disabled = false
    );
$$;

comment on function public.nora_is_active_user() is
    'True when auth.uid() maps to a non-disabled sales profile. Owner: postgres. EXECUTE: authenticated, service_role.';

create or replace function public.current_nora_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select s.role
    from public.sales s
    where s.user_id = public.nora_auth_uid()
      and s.disabled = false
    limit 1;
$$;

comment on function public.current_nora_role() is
    'Returns admin|office|viewer for active user; NULL if disabled or no sales profile. Owner: postgres. EXECUTE: authenticated, service_role.';

create or replace function public.has_nora_role(p_allowed text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(public.current_nora_role() = any (p_allowed), false);
$$;

comment on function public.has_nora_role(text[]) is
    'Role membership test for RLS; false when disabled or missing profile. Owner: postgres. EXECUTE: authenticated, service_role.';

create or replace function public.nora_can_write()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select public.has_nora_role(array['admin', 'office']);
$$;

comment on function public.nora_can_write() is
    'Shorthand for office/admin write access. Owner: postgres. EXECUTE: authenticated, service_role.';

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select public.has_nora_role(array['admin']);
$$;

comment on function public.is_admin() is
    'Admin role check; replaces legacy administrator-only lookup. Owner: postgres. EXECUTE: authenticated, service_role.';

revoke all on function public.nora_is_active_user() from public;
revoke all on function public.nora_is_active_user() from anon;
grant execute on function public.nora_is_active_user() to authenticated;
grant execute on function public.nora_is_active_user() to service_role;

revoke all on function public.current_nora_role() from public;
revoke all on function public.current_nora_role() from anon;
grant execute on function public.current_nora_role() to authenticated;
grant execute on function public.current_nora_role() to service_role;

revoke all on function public.has_nora_role(text[]) from public;
revoke all on function public.has_nora_role(text[]) from anon;
grant execute on function public.has_nora_role(text[]) to authenticated;
grant execute on function public.has_nora_role(text[]) to service_role;

revoke all on function public.nora_can_write() from public;
revoke all on function public.nora_can_write() from anon;
grant execute on function public.nora_can_write() to authenticated;
grant execute on function public.nora_can_write() to service_role;

revoke all on function public.is_admin() from public;
revoke all on function public.is_admin() from anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_admin() to service_role;

create or replace function public.set_sales_id_default()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if new.sales_id is null then
        select id into new.sales_id
        from public.sales
        where user_id = public.nora_auth_uid();
    end if;
    return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. administrator sync + privilege immutability triggers
-- ---------------------------------------------------------------------------

create or replace function public.sync_sales_administrator_from_role()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    new.administrator := (new.role = 'admin');
    return new;
end;
$$;

drop trigger if exists sync_sales_administrator_from_role_trigger on public.sales;

create trigger sync_sales_administrator_from_role_trigger
    before insert or update of role on public.sales
    for each row
    execute function public.sync_sales_administrator_from_role();

create or replace function public.prevent_sales_privilege_escalation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if current_setting('nora.allow_sales_privilege_change', true) = 'on' then
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

drop trigger if exists prevent_sales_privilege_escalation_trigger on public.sales;

create trigger prevent_sales_privilege_escalation_trigger
    before update on public.sales
    for each row
    execute function public.prevent_sales_privilege_escalation();

-- ---------------------------------------------------------------------------
-- 4. Admin-only role management RPC
-- ---------------------------------------------------------------------------

create or replace function public.set_sales_role_by_admin(
    p_sale_id bigint,
    p_role text,
    p_disabled boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if p_role is null or p_role not in ('admin', 'office', 'viewer') then
        raise exception 'invalid role: %', p_role using errcode = '22023';
    end if;

    -- SECURITY DEFINER runs as owner (postgres); never authorize via current_user.
    if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
        if not public.has_nora_role(array['admin']) then
            raise exception 'forbidden' using errcode = '42501';
        end if;
    end if;

    if not exists (select 1 from public.sales where id = p_sale_id) then
        raise exception 'sales profile not found: %', p_sale_id using errcode = 'P0002';
    end if;

    perform set_config('nora.allow_sales_privilege_change', 'on', true);

    update public.sales
    set
        role = p_role,
        disabled = coalesce(p_disabled, disabled)
    where id = p_sale_id;
end;
$$;

comment on function public.set_sales_role_by_admin(bigint, text, boolean) is
    'Admin/service_role only: set role and optional disabled flag. Syncs administrator via trigger.';

revoke all on function public.set_sales_role_by_admin(bigint, text, boolean) from public;
revoke all on function public.set_sales_role_by_admin(bigint, text, boolean) from anon;
grant execute on function public.set_sales_role_by_admin(bigint, text, boolean) to authenticated;
grant execute on function public.set_sales_role_by_admin(bigint, text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 5. System field protection triggers
-- ---------------------------------------------------------------------------

create or replace function public.prevent_companies_system_field_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if tg_op = 'UPDATE' then
        if old.id is distinct from new.id then
            raise exception 'companies.id is immutable';
        end if;
        if old.created_at is distinct from new.created_at then
            raise exception 'companies.created_at is immutable';
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists prevent_companies_system_field_change_trigger on public.companies;

create trigger prevent_companies_system_field_change_trigger
    before update on public.companies
    for each row
    execute function public.prevent_companies_system_field_change();

create or replace function public.prevent_deals_system_field_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if tg_op = 'UPDATE' then
        if old.id is distinct from new.id then
            raise exception 'deals.id is immutable';
        end if;
        if old.created_at is distinct from new.created_at then
            raise exception 'deals.created_at is immutable';
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists prevent_deals_system_field_change_trigger on public.deals;

create trigger prevent_deals_system_field_change_trigger
    before update on public.deals
    for each row
    execute function public.prevent_deals_system_field_change();

create or replace function public.prevent_checklist_run_item_snapshot_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if tg_op = 'UPDATE' then
        if old.id is distinct from new.id then
            raise exception 'checklist_run_items.id is immutable';
        end if;
        if old.checklist_run_id is distinct from new.checklist_run_id then
            raise exception 'checklist_run_items.checklist_run_id is immutable';
        end if;
        if old.template_item_id is distinct from new.template_item_id then
            raise exception 'checklist_run_items.template_item_id is immutable';
        end if;
        if old.label_snapshot is distinct from new.label_snapshot then
            raise exception 'checklist_run_items.label_snapshot is immutable';
        end if;
        if old.is_required is distinct from new.is_required then
            raise exception 'checklist_run_items.is_required is immutable';
        end if;
        if old.sort_index is distinct from new.sort_index then
            raise exception 'checklist_run_items.sort_index is immutable';
        end if;
        if old.created_at is distinct from new.created_at then
            raise exception 'checklist_run_items.created_at is immutable';
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists prevent_checklist_run_item_snapshot_change_trigger on public.checklist_run_items;

create trigger prevent_checklist_run_item_snapshot_change_trigger
    before update on public.checklist_run_items
    for each row
    execute function public.prevent_checklist_run_item_snapshot_change();

create or replace function public.enforce_checklist_item_checked_by()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if tg_op = 'UPDATE' and old.is_checked is distinct from new.is_checked then
        if new.is_checked then
            new.checked_by := public.nora_auth_uid();
            new.checked_at := now();
        else
            new.checked_by := null;
            new.checked_at := null;
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists enforce_checklist_item_checked_by_trigger on public.checklist_run_items;

create trigger enforce_checklist_item_checked_by_trigger
    before update on public.checklist_run_items
    for each row
    execute function public.enforce_checklist_item_checked_by();

-- ---------------------------------------------------------------------------
-- 6. handle_new_user: least privilege for new signups
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
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

-- ---------------------------------------------------------------------------
-- 7. start_checklist_run_from_template: office/admin only
-- ---------------------------------------------------------------------------

create or replace function public.start_checklist_run_from_template(
    p_template_code text,
    p_deal_id bigint,
    p_contact_id bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_template public.checklist_templates%rowtype;
    v_deal public.deals%rowtype;
    v_run_id uuid;
    v_active_items int;
    v_lock_key1 int;
    v_lock_key2 int;
begin
    if public.nora_auth_uid() is null then
        raise exception 'not authenticated' using errcode = '28000';
    end if;

    if not public.has_nora_role(array['admin', 'office']) then
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

    v_lock_key1 := hashtext('nora_checklist_run');
    v_lock_key2 := hashtext(p_deal_id::text || ':' || v_template.id::text);
    perform pg_advisory_xact_lock(v_lock_key1, v_lock_key2);

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
            v_template.service_area_code, 'open', public.nora_auth_uid()
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

-- ---------------------------------------------------------------------------
-- 8. Replace RLS policies
-- ---------------------------------------------------------------------------

-- Companies
drop policy if exists "Enable read access for authenticated users" on public.companies;
drop policy if exists "Enable insert for authenticated users only" on public.companies;
drop policy if exists "Enable update for authenticated users only" on public.companies;
drop policy if exists "Company Delete Policy" on public.companies;

create policy "Companies select active" on public.companies
    for select to authenticated
    using (public.nora_is_active_user());

create policy "Companies insert writers" on public.companies
    for insert to authenticated
    with check (public.nora_can_write());

create policy "Companies update writers" on public.companies
    for update to authenticated
    using (public.nora_can_write())
    with check (public.nora_can_write());

create policy "Companies delete admin" on public.companies
    for delete to authenticated
    using (public.is_admin());

-- Contacts
drop policy if exists "Enable read access for authenticated users" on public.contacts;
drop policy if exists "Enable insert for authenticated users only" on public.contacts;
drop policy if exists "Enable update for authenticated users only" on public.contacts;
drop policy if exists "Contact Delete Policy" on public.contacts;

create policy "Contacts select active" on public.contacts
    for select to authenticated
    using (public.nora_is_active_user());

create policy "Contacts insert writers" on public.contacts
    for insert to authenticated
    with check (public.nora_can_write());

create policy "Contacts update writers" on public.contacts
    for update to authenticated
    using (public.nora_can_write())
    with check (public.nora_can_write());

create policy "Contacts delete admin" on public.contacts
    for delete to authenticated
    using (public.is_admin());

-- Contact notes
drop policy if exists "Enable read access for authenticated users" on public.contact_notes;
drop policy if exists "Enable insert for authenticated users only" on public.contact_notes;
drop policy if exists "Contact Notes Update policy" on public.contact_notes;
drop policy if exists "Contact Notes Delete Policy" on public.contact_notes;

create policy "Contact notes select active" on public.contact_notes
    for select to authenticated
    using (public.nora_is_active_user());

create policy "Contact notes insert writers" on public.contact_notes
    for insert to authenticated
    with check (public.nora_can_write());

create policy "Contact notes update writers" on public.contact_notes
    for update to authenticated
    using (public.nora_can_write())
    with check (public.nora_can_write());

create policy "Contact notes delete admin" on public.contact_notes
    for delete to authenticated
    using (public.is_admin());

-- Deals
drop policy if exists "Enable read access for authenticated users" on public.deals;
drop policy if exists "Enable insert for authenticated users only" on public.deals;
drop policy if exists "Enable update for authenticated users only" on public.deals;
drop policy if exists "Deals Delete Policy" on public.deals;

create policy "Deals select active" on public.deals
    for select to authenticated
    using (public.nora_is_active_user());

create policy "Deals insert writers" on public.deals
    for insert to authenticated
    with check (public.nora_can_write());

create policy "Deals update writers" on public.deals
    for update to authenticated
    using (public.nora_can_write())
    with check (public.nora_can_write());

create policy "Deals delete admin" on public.deals
    for delete to authenticated
    using (public.is_admin());

-- Deal notes
drop policy if exists "Enable read access for authenticated users" on public.deal_notes;
drop policy if exists "Enable insert for authenticated users only" on public.deal_notes;
drop policy if exists "Deal Notes Update Policy" on public.deal_notes;
drop policy if exists "Deal Notes Delete Policy" on public.deal_notes;

create policy "Deal notes select active" on public.deal_notes
    for select to authenticated
    using (public.nora_is_active_user());

create policy "Deal notes insert writers" on public.deal_notes
    for insert to authenticated
    with check (public.nora_can_write());

create policy "Deal notes update writers" on public.deal_notes
    for update to authenticated
    using (public.nora_can_write())
    with check (public.nora_can_write());

create policy "Deal notes delete admin" on public.deal_notes
    for delete to authenticated
    using (public.is_admin());

-- Tasks
drop policy if exists "Enable read access for authenticated users" on public.tasks;
drop policy if exists "Enable insert for authenticated users only" on public.tasks;
drop policy if exists "Task Update Policy" on public.tasks;
drop policy if exists "Task Delete Policy" on public.tasks;

create policy "Tasks select active" on public.tasks
    for select to authenticated
    using (public.nora_is_active_user());

create policy "Tasks insert writers" on public.tasks
    for insert to authenticated
    with check (public.nora_can_write());

create policy "Tasks update writers" on public.tasks
    for update to authenticated
    using (public.nora_can_write())
    with check (public.nora_can_write());

create policy "Tasks delete admin" on public.tasks
    for delete to authenticated
    using (public.is_admin());

-- Tags
drop policy if exists "Enable read access for authenticated users" on public.tags;
drop policy if exists "Enable insert for authenticated users only" on public.tags;
drop policy if exists "Enable update for authenticated users only" on public.tags;
drop policy if exists "Enable delete for authenticated users only" on public.tags;

create policy "Tags select active" on public.tags
    for select to authenticated
    using (public.nora_is_active_user());

create policy "Tags insert writers" on public.tags
    for insert to authenticated
    with check (public.nora_can_write());

create policy "Tags update writers" on public.tags
    for update to authenticated
    using (public.nora_can_write())
    with check (public.nora_can_write());

create policy "Tags delete admin" on public.tags
    for delete to authenticated
    using (public.is_admin());

-- Sales
drop policy if exists "Enable read access for authenticated users" on public.sales;

create policy "Sales select active" on public.sales
    for select to authenticated
    using (public.nora_is_active_user());

create policy "Sales update own profile" on public.sales
    for update to authenticated
    using (public.nora_is_active_user() and user_id = public.nora_auth_uid())
    with check (public.nora_is_active_user() and user_id = public.nora_auth_uid());

-- Configuration
drop policy if exists "Enable read for authenticated" on public.configuration;
drop policy if exists "Enable insert for admins" on public.configuration;
drop policy if exists "Enable update for admins" on public.configuration;

create policy "Configuration select active" on public.configuration
    for select to authenticated
    using (public.nora_is_active_user());

create policy "Configuration insert admin" on public.configuration
    for insert to authenticated
    with check (public.is_admin());

create policy "Configuration update admin" on public.configuration
    for update to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- Favicons excluded domains
drop policy if exists "Enable access for authenticated users only" on public.favicons_excluded_domains;

create policy "Favicons select active" on public.favicons_excluded_domains
    for select to authenticated
    using (public.nora_is_active_user());

create policy "Favicons insert admin" on public.favicons_excluded_domains
    for insert to authenticated
    with check (public.is_admin());

create policy "Favicons update admin" on public.favicons_excluded_domains
    for update to authenticated
    using (public.is_admin())
    with check (public.is_admin());

create policy "Favicons delete admin" on public.favicons_excluded_domains
    for delete to authenticated
    using (public.is_admin());

-- Checklists
drop policy if exists "Checklist templates read" on public.checklist_templates;
drop policy if exists "Checklist templates insert admin" on public.checklist_templates;
drop policy if exists "Checklist templates update admin" on public.checklist_templates;

create policy "Checklist templates select active" on public.checklist_templates
    for select to authenticated
    using (public.nora_is_active_user());

create policy "Checklist templates insert admin" on public.checklist_templates
    for insert to authenticated
    with check (public.is_admin());

create policy "Checklist templates update admin" on public.checklist_templates
    for update to authenticated
    using (public.is_admin())
    with check (public.is_admin());

drop policy if exists "Checklist template items read" on public.checklist_template_items;
drop policy if exists "Checklist template items insert admin" on public.checklist_template_items;
drop policy if exists "Checklist template items update admin" on public.checklist_template_items;

create policy "Checklist template items select active" on public.checklist_template_items
    for select to authenticated
    using (public.nora_is_active_user());

create policy "Checklist template items insert admin" on public.checklist_template_items
    for insert to authenticated
    with check (public.is_admin());

create policy "Checklist template items update admin" on public.checklist_template_items
    for update to authenticated
    using (public.is_admin())
    with check (public.is_admin());

drop policy if exists "Checklist runs read" on public.checklist_runs;
drop policy if exists "Checklist runs insert" on public.checklist_runs;
drop policy if exists "Checklist runs update" on public.checklist_runs;

create policy "Checklist runs select active" on public.checklist_runs
    for select to authenticated
    using (public.nora_is_active_user());

create policy "Checklist runs insert writers" on public.checklist_runs
    for insert to authenticated
    with check (public.nora_can_write());

create policy "Checklist runs update writers" on public.checklist_runs
    for update to authenticated
    using (public.nora_can_write())
    with check (public.nora_can_write());

drop policy if exists "Checklist run items read" on public.checklist_run_items;
drop policy if exists "Checklist run items insert" on public.checklist_run_items;
drop policy if exists "Checklist run items update" on public.checklist_run_items;

create policy "Checklist run items select active" on public.checklist_run_items
    for select to authenticated
    using (public.nora_is_active_user());

create policy "Checklist run items insert writers" on public.checklist_run_items
    for insert to authenticated
    with check (public.nora_can_write());

create policy "Checklist run items update writers" on public.checklist_run_items
    for update to authenticated
    using (public.nora_can_write())
    with check (public.nora_can_write());

drop policy if exists "Saved text snippets read" on public.saved_text_snippets;
drop policy if exists "Saved text snippets insert" on public.saved_text_snippets;
drop policy if exists "Saved text snippets update" on public.saved_text_snippets;

create policy "Saved text snippets select active" on public.saved_text_snippets
    for select to authenticated
    using (public.nora_is_active_user());

create policy "Saved text snippets insert writers" on public.saved_text_snippets
    for insert to authenticated
    with check (public.nora_can_write());

create policy "Saved text snippets update writers" on public.saved_text_snippets
    for update to authenticated
    using (
        public.is_admin()
        or (
            public.has_nora_role(array['office'])
            and created_by = public.nora_auth_uid()
        )
    )
    with check (
        public.is_admin()
        or (
            public.has_nora_role(array['office'])
            and created_by = public.nora_auth_uid()
        )
    );

-- Audit events
drop policy if exists "Audit events read" on public.audit_events;

create policy "Audit events read admin office" on public.audit_events
    for select to authenticated
    using (public.has_nora_role(array['admin', 'office']));
