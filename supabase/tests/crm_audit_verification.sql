-- Nora CRM v0.3l: CRM audit verification
-- Run after rbac_rls_setup.sql with admin/office/viewer test users

\set ON_ERROR_STOP on

\echo '=== CRM Audit v0.3l verification ==='

-- Minimal NOBYPASSRLS test role (same pattern as rbac_rls_setup.sql)
do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'nora_rls_test') then
        create role nora_rls_test
            nosuperuser nobypassrls noinherit nologin;
        grant authenticated to nora_rls_test;
        grant nora_rls_test to postgres;
        grant usage on schema public to nora_rls_test;
        grant usage on schema nora_private to nora_rls_test;
        grant all on all tables in schema public to nora_rls_test;
        grant execute on all functions in schema public to nora_rls_test;
        grant execute on all functions in schema nora_private to nora_rls_test;
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Capability: nora_audit_writer
-- ---------------------------------------------------------------------------

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'nora_audit_writer') then
        raise exception 'nora_audit_writer role missing';
    end if;
    if exists (
        select 1 from pg_roles
        where rolname = 'nora_audit_writer' and (rolcanlogin or rolbypassrls)
    ) then
        raise exception 'nora_audit_writer must be NOLOGIN NOBYPASSRLS';
    end if;
    if pg_has_role('authenticated', 'nora_audit_writer', 'member') then
        raise exception 'authenticated must not be member of nora_audit_writer';
    end if;
    if has_function_privilege('authenticated', 'nora_private.write_audit_event(text, text, uuid, bigint, bigint, bigint, uuid, uuid, bigint, bigint, jsonb, jsonb, text, text, text, text)', 'EXECUTE') then
        raise exception 'authenticated must not EXECUTE write_audit_event';
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Company audit
-- ---------------------------------------------------------------------------

do $$
declare
    v_company_id bigint;
    v_count int;
    v_meta jsonb;
begin
    insert into public.companies (name, customer_number, city)
    values ('Audit Test GmbH', 'KD-999901', 'Düsseldorf')
    returning id into v_company_id;

    select count(*) into v_count
    from public.audit_events
    where event_type = 'company.created' and company_id = v_company_id;
    if v_count <> 1 then
        raise exception 'company.created expected 1, got %', v_count;
    end if;

    update public.companies set city = 'Neuss' where id = v_company_id;

    select metadata into v_meta
    from public.audit_events
    where event_type = 'company.updated' and company_id = v_company_id
    order by created_at desc limit 1;

    if v_meta -> 'changes' -> 'city' ->> 'new' <> 'Neuss' then
        raise exception 'company.updated missing city change';
    end if;

    if v_meta -> 'changes' ? 'customer_number' then
        raise exception 'customer_number must not appear in changes';
    end if;

    delete from public.companies where id = v_company_id;

    select count(*) into v_count
    from public.audit_events where company_id = v_company_id;
    if v_count < 2 then
        raise exception 'audit rows must survive company delete, got %', v_count;
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Deal status + archive
-- ---------------------------------------------------------------------------

do $$
declare
    v_company_id bigint;
    v_deal_id bigint;
    v_count int;
begin
    insert into public.companies (name, customer_number, city)
    values ('Audit Deal Co', 'KD-999902', 'Neuss')
    returning id into v_company_id;

    insert into public.deals (name, stage, company_id, case_number)
    values ('Audit Deal', 'opportunity', v_company_id, 'VG-9999-000001')
    returning id into v_deal_id;

    update public.deals set stage = 'proposal-sent' where id = v_deal_id;

    select count(*) into v_count
    from public.audit_events
    where deal_id = v_deal_id and event_type = 'deal.status_changed';
    if v_count <> 1 then
        raise exception 'deal.status_changed expected 1, got %', v_count;
    end if;

    update public.deals set archived_at = now() where id = v_deal_id;
    select count(*) into v_count
    from public.audit_events
    where deal_id = v_deal_id and event_type = 'deal.archived';
    if v_count <> 1 then
        raise exception 'deal.archived expected 1, got %', v_count;
    end if;

    update public.deals set archived_at = null where id = v_deal_id;
    select count(*) into v_count
    from public.audit_events
    where deal_id = v_deal_id and event_type = 'deal.restored';
    if v_count <> 1 then
        raise exception 'deal.restored expected 1, got %', v_count;
    end if;

    delete from public.deals where id = v_deal_id;
    delete from public.companies where id = v_company_id;
    select count(*) into v_count from public.audit_events where deal_id = v_deal_id;
    if v_count < 4 then
        raise exception 'audit must survive deal delete';
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Task lifecycle
-- ---------------------------------------------------------------------------

do $$
declare
    v_company_id bigint;
    v_contact_id bigint;
    v_task_id bigint;
    v_count int;
begin
    insert into public.companies (name) values ('Task Audit Co') returning id into v_company_id;
    insert into public.contacts (first_name, last_name, company_id)
    values ('Task', 'Holder', v_company_id) returning id into v_contact_id;

    insert into public.tasks (contact_id, type, text, due_date)
    values (v_contact_id, 'call', 'Anrufen', current_date + 1)
    returning id into v_task_id;

    select count(*) into v_count from public.audit_events
    where task_id = v_task_id and event_type = 'task.created';
    if v_count <> 1 then raise exception 'task.created expected 1, got %', v_count; end if;

    update public.tasks set text = 'Zurückrufen' where id = v_task_id;
    select count(*) into v_count from public.audit_events
    where task_id = v_task_id and event_type = 'task.updated';
    if v_count <> 1 then raise exception 'task.updated expected 1, got %', v_count; end if;

    update public.tasks set done_date = now() where id = v_task_id;
    select count(*) into v_count from public.audit_events
    where task_id = v_task_id and event_type = 'task.completed';
    if v_count <> 1 then raise exception 'task.completed expected 1, got %', v_count; end if;

    update public.tasks set done_date = null where id = v_task_id;
    select count(*) into v_count from public.audit_events
    where task_id = v_task_id and event_type = 'task.reopened';
    if v_count <> 1 then raise exception 'task.reopened expected 1, got %', v_count; end if;

    delete from public.tasks where id = v_task_id;
    select count(*) into v_count from public.audit_events where task_id = v_task_id;
    if v_count < 4 then raise exception 'task audit must survive delete, got %', v_count; end if;

    delete from public.contacts where id = v_contact_id;
    delete from public.companies where id = v_company_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Note audit (no full text, preview <= 80, hash)
-- ---------------------------------------------------------------------------

do $$
declare
    v_company_id bigint;
    v_contact_id bigint;
    v_deal_id bigint;
    v_cn_id bigint;
    v_dn_id bigint;
    v_count int;
    v_long text := repeat('X', 200);
    v_meta jsonb;
    v_preview text;
begin
    insert into public.companies (name) values ('Note Audit Co') returning id into v_company_id;
    insert into public.contacts (first_name, last_name, company_id)
    values ('Note', 'Holder', v_company_id) returning id into v_contact_id;
    insert into public.deals (name, company_id, stage, category)
    values ('Note Deal', v_company_id, 'neue-anfrage', 'fensterservice') returning id into v_deal_id;

    insert into public.contact_notes (contact_id, text, date)
    values (v_contact_id, v_long, now()) returning id into v_cn_id;

    select metadata into v_meta from public.audit_events
    where event_type = 'contact_note.created' and note_id = v_cn_id
    order by created_at desc limit 1;

    if coalesce(v_meta -> 'changes' ->> 'content_changed', 'false') not in ('true', 't') then
        raise exception 'contact_note.created missing content_changed';
    end if;
    if (v_meta -> 'changes' ->> 'new_length')::int <> 200 then
        raise exception 'contact_note wrong new_length';
    end if;
    v_preview := v_meta -> 'changes' ->> 'new_preview';
    if length(v_preview) > 80 then
        raise exception 'contact_note preview exceeds 80 chars: %', length(v_preview);
    end if;
    if v_meta::text ilike '%' || repeat('X', 100) || '%' then
        raise exception 'contact_note must not store full note text';
    end if;
    if v_meta -> 'changes' ->> 'new_hash' is null then
        raise exception 'contact_note missing new_hash';
    end if;

    update public.contact_notes set text = 'Kurz' where id = v_cn_id;
    delete from public.contact_notes where id = v_cn_id;

    select count(*) into v_count from public.audit_events
    where event_type in ('contact_note.created', 'contact_note.updated', 'contact_note.deleted')
      and note_id = v_cn_id;
    if v_count <> 3 then raise exception 'contact_note lifecycle expected 3 events, got %', v_count; end if;

    insert into public.deal_notes (deal_id, text, date)
    values (v_deal_id, v_long, now()) returning id into v_dn_id;

    update public.deal_notes set text = 'Geändert' where id = v_dn_id;
    delete from public.deal_notes where id = v_dn_id;

    select count(*) into v_count from public.audit_events
    where event_type in ('deal_note.created', 'deal_note.updated', 'deal_note.deleted')
      and note_id = v_dn_id;
    if v_count <> 3 then raise exception 'deal_note lifecycle expected 3 events, got %', v_count; end if;

    delete from public.deals where id = v_deal_id;
    delete from public.contacts where id = v_contact_id;
    delete from public.companies where id = v_company_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- User privilege audit
-- ---------------------------------------------------------------------------

do $$
declare
    v_sale_id bigint;
    v_uid uuid := gen_random_uuid();
    v_count int;
    v_before int;
begin
    insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, recovery_sent_at, last_sign_in_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token
    )
    values (
        '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
        'audit-user-' || v_uid::text || '@nora.test', crypt('password', gen_salt('bf')),
        now(), now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
        '', '', '', ''
    );

    select id into v_sale_id from public.sales where user_id = v_uid;
    if v_sale_id is null then
        insert into public.sales (first_name, last_name, email, user_id, role, administrator, disabled)
        values ('Audit', 'User', 'audit-user-' || v_uid::text || '@nora.test', v_uid, 'viewer', false, false)
        returning id into v_sale_id;
    else
        perform nora_private.apply_sales_role_change(v_sale_id, 'viewer', false);
    end if;

    select count(*) into v_before from public.audit_events
    where (metadata ->> 'sale_id')::bigint = v_sale_id;

    perform nora_private.apply_sales_role_change(v_sale_id, 'office', false);
    select count(*) into v_count from public.audit_events
    where event_type = 'user.role_changed' and (metadata ->> 'sale_id')::bigint = v_sale_id;
    if v_count <> v_before + 1 then raise exception 'user.role_changed expected %, got %', v_before + 1, v_count; end if;

    perform nora_private.apply_sales_role_change(v_sale_id, 'office', true);
    select count(*) into v_count from public.audit_events
    where event_type = 'user.disabled' and (metadata ->> 'sale_id')::bigint = v_sale_id;
    if v_count <> 1 then raise exception 'user.disabled expected 1, got %', v_count; end if;

    perform nora_private.apply_sales_role_change(v_sale_id, 'office', false);
    select count(*) into v_count from public.audit_events
    where event_type = 'user.enabled' and (metadata ->> 'sale_id')::bigint = v_sale_id;
    if v_count <> 1 then raise exception 'user.enabled expected 1, got %', v_count; end if;

    delete from public.sales where id = v_sale_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Canonical status code (no new deal.stage_changed)
-- ---------------------------------------------------------------------------

do $$
declare
    v_company_id bigint;
    v_deal_id bigint;
    v_count int;
begin
    insert into public.companies (name) values ('Status Code Co') returning id into v_company_id;
    insert into public.deals (name, company_id, stage, category)
    values ('Status Deal', v_company_id, 'opportunity', 'fensterservice') returning id into v_deal_id;

    update public.deals set stage = 'proposal-sent' where id = v_deal_id;

    select count(*) into v_count from public.audit_events
    where deal_id = v_deal_id and event_type = 'deal.stage_changed'
      and created_at > now() - interval '1 minute';
    if v_count > 0 then raise exception 'new triggers must not write deal.stage_changed'; end if;

    select count(*) into v_count from public.audit_events
    where deal_id = v_deal_id and event_type = 'deal.status_changed';
    if v_count <> 1 then raise exception 'deal.status_changed expected 1, got %', v_count; end if;

    delete from public.deals where id = v_deal_id;
    delete from public.companies where id = v_company_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC access: viewer/disabled denied, office no global, pagination, invalid type
-- ---------------------------------------------------------------------------

do $$
declare
    v_viewer uuid := 'c1000000-0000-4000-8000-000000000003';
    v_office uuid := 'c1000000-0000-4000-8000-000000000002';
    v_disabled uuid := 'c1000000-0000-4000-8000-000000000004';
    v_admin uuid := 'c1000000-0000-4000-8000-000000000001';
    v_company_id bigint;
    v_result jsonb;
    v_len int;
begin
    insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, recovery_sent_at, last_sign_in_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token
    )
    select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
        u.email, crypt('password', gen_salt('bf')), now(), now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
        '', '', '', ''
    from (values
        (v_viewer, 'crm-audit-viewer@nora.test'),
        (v_office, 'crm-audit-office@nora.test'),
        (v_disabled, 'crm-audit-disabled@nora.test'),
        (v_admin, 'crm-audit-admin@nora.test')
    ) as u(id, email)
    on conflict (id) do nothing;

    begin
        insert into public.sales (first_name, last_name, email, user_id, role, administrator, disabled)
        values ('CRM', 'Viewer', 'crm-audit-viewer@nora.test', v_viewer, 'viewer', false, false);
    exception when unique_violation then
        perform nora_private.apply_sales_role_change(
            (select id from public.sales where user_id = v_viewer), 'viewer', false);
    end;
    begin
        insert into public.sales (first_name, last_name, email, user_id, role, administrator, disabled)
        values ('CRM', 'Office', 'crm-audit-office@nora.test', v_office, 'office', false, false);
    exception when unique_violation then
        perform nora_private.apply_sales_role_change(
            (select id from public.sales where user_id = v_office), 'office', false);
    end;
    begin
        insert into public.sales (first_name, last_name, email, user_id, role, administrator, disabled)
        values ('CRM', 'Disabled', 'crm-audit-disabled@nora.test', v_disabled, 'office', false, true);
    exception when unique_violation then
        perform nora_private.apply_sales_role_change(
            (select id from public.sales where user_id = v_disabled), 'office', true);
    end;
    begin
        insert into public.sales (first_name, last_name, email, user_id, role, administrator, disabled)
        values ('CRM', 'Admin', 'crm-audit-admin@nora.test', v_admin, 'admin', true, false);
    exception when unique_violation then
        perform nora_private.apply_sales_role_change(
            (select id from public.sales where user_id = v_admin), 'admin', false);
    end;

    insert into public.companies (name) values ('RPC Audit Co') returning id into v_company_id;

    set local role nora_rls_test;
    set local role authenticated;

    perform set_config('request.jwt.claim.sub', v_viewer::text, true);
    if nora_private.current_role() is distinct from 'viewer' then
        raise exception 'test setup: expected viewer role, got %', nora_private.current_role();
    end if;
    begin
        perform public.get_entity_audit_events('company', v_company_id, 5, null);
        raise exception 'viewer must not call get_entity_audit_events';
    exception when others then
        if sqlerrm not like '%forbidden%' then raise; end if;
    end;

    perform set_config('request.jwt.claim.sub', v_disabled::text, true);
    if nora_private.is_active_user() then
        raise exception 'test setup: disabled user must not be active';
    end if;
    begin
        perform public.get_entity_audit_events('company', v_company_id, 5, null);
        raise exception 'disabled user must not call get_entity_audit_events';
    exception when others then
        if sqlerrm not like '%forbidden%' then raise; end if;
    end;

    perform set_config('request.jwt.claim.sub', v_office::text, true);
    begin
        perform public.get_global_audit_events(10, null, null, null, null, null, null, null);
        raise exception 'office must not call get_global_audit_events';
    exception when others then
        if sqlerrm not like '%forbidden%' then raise; end if;
    end;

    v_result := public.get_entity_audit_events('company', v_company_id, 5, null);
    if v_result -> 'data' is null then
        raise exception 'office get_entity_audit_events must return data';
    end if;

    begin
        perform public.get_entity_audit_events('hack_table', v_company_id, 5, null);
        raise exception 'invalid entity_type must be rejected';
    exception when others then
        if sqlerrm not like '%invalid entity_type%' then raise; end if;
    end;

    perform set_config('request.jwt.claim.sub', v_admin::text, true);
    v_result := public.get_global_audit_events(500, null, null, null, null, null, null, null);
    v_len := jsonb_array_length(v_result -> 'data');
    if (v_result ->> 'limit')::int > 200 then
        raise exception 'global audit limit must be capped at 200';
    end if;
    if v_len > 200 then
        raise exception 'global audit returned more than hard limit';
    end if;

    perform public.get_audit_storage_stats();

    reset role;
    delete from public.companies where id = v_company_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- No secrets in metadata sample
-- ---------------------------------------------------------------------------

do $$
begin
    if exists (
        select 1 from public.audit_events ae
        where ae.metadata::text ~* '(password|oauth|bearer|service[_-]?role|api[_-]?key|secret|token)'
    ) then
        raise exception 'audit metadata must not contain secret-like keys/values';
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Office RPC / viewer denied / admin stats (existence)
-- ---------------------------------------------------------------------------

do $$
declare
    v_company_id bigint;
begin
    select id into v_company_id from public.companies limit 1;

    if not exists (
        select 1 from pg_proc
        where proname = 'get_entity_audit_events'
          and pronamespace = 'public'::regnamespace
    ) then
        raise exception 'get_entity_audit_events RPC missing';
    end if;

    if not exists (
        select 1 from pg_proc
        where proname = 'get_audit_storage_stats'
          and pronamespace = 'public'::regnamespace
    ) then
        raise exception 'get_audit_storage_stats RPC missing';
    end if;
end;
$$;

-- Append-only still enforced
do $$
begin
    begin
        update public.audit_events set event_type = 'hack' where false;
        raise exception 'audit_events must be append-only';
    exception when others then
        if sqlerrm not like '%append-only%' then
            raise;
        end if;
    end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Volatility + direct audit_*_changes / storage stats regression
-- ---------------------------------------------------------------------------

do $$
declare
    v_old_company public.companies;
    v_new_company public.companies;
    v_old_contact public.contacts;
    v_new_contact public.contacts;
    v_old_deal public.deals;
    v_new_deal public.deals;
    v_old_task public.tasks;
    v_new_task public.tasks;
    v_diff jsonb;
    v_stats jsonb;
    v_vol text;
    v_admin uuid;
begin
    if (
        select p.provolatile
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'nora_private'
          and p.proname = 'audit_company_changes'
    ) is distinct from 's' then
        raise exception 'audit_company_changes must be STABLE';
    end if;
    if (
        select p.provolatile
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'nora_private'
          and p.proname = 'audit_contact_changes'
    ) is distinct from 's' then
        raise exception 'audit_contact_changes must be STABLE';
    end if;
    if (
        select p.provolatile
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'nora_private'
          and p.proname = 'audit_deal_changes'
    ) is distinct from 's' then
        raise exception 'audit_deal_changes must be STABLE';
    end if;
    if (
        select p.provolatile
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'nora_private'
          and p.proname = 'audit_task_changes'
    ) is distinct from 's' then
        raise exception 'audit_task_changes must be STABLE';
    end if;

    select p.provolatile into v_vol
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_audit_storage_stats';
    if v_vol is distinct from 'v' then
        raise exception 'get_audit_storage_stats must be VOLATILE, got %', v_vol;
    end if;

    v_old_company.name := 'Alt';
    v_old_company.city := 'Düsseldorf';
    v_new_company := v_old_company;
    v_new_company.city := 'Neuss';
    v_diff := nora_private.audit_company_changes(v_old_company, v_new_company);
    if v_diff -> 'city' ->> 'old' is distinct from 'Düsseldorf'
       or v_diff -> 'city' ->> 'new' is distinct from 'Neuss'
       or v_diff ? 'name'
       or jsonb_typeof(v_diff) is distinct from 'object' then
        raise exception 'audit_company_changes regression failed: %', v_diff;
    end if;

    v_old_contact.first_name := 'Ada';
    v_old_contact.last_name := 'Lovelace';
    v_old_contact.status := 'cold';
    v_new_contact := v_old_contact;
    v_new_contact.status := 'warm';
    v_diff := nora_private.audit_contact_changes(v_old_contact, v_new_contact);
    if v_diff -> 'status' ->> 'old' is distinct from 'cold'
       or v_diff -> 'status' ->> 'new' is distinct from 'warm'
       or v_diff ? 'first_name' then
        raise exception 'audit_contact_changes regression failed: %', v_diff;
    end if;

    v_old_deal.name := 'Vorgang';
    v_old_deal.stage := 'opportunity';
    v_new_deal := v_old_deal;
    v_new_deal.stage := 'proposal-sent';
    v_diff := nora_private.audit_deal_changes(v_old_deal, v_new_deal);
    if v_diff -> 'stage' ->> 'old' is distinct from 'opportunity'
       or v_diff -> 'stage' ->> 'new' is distinct from 'proposal-sent'
       or v_diff ? 'name' then
        raise exception 'audit_deal_changes regression failed: %', v_diff;
    end if;

    v_old_task.text := 'Anrufen';
    v_old_task.type := 'call';
    v_new_task := v_old_task;
    v_new_task.text := 'Zurückrufen';
    v_diff := nora_private.audit_task_changes(v_old_task, v_new_task);
    if v_diff -> 'text' ->> 'old' is distinct from 'Anrufen'
       or v_diff -> 'text' ->> 'new' is distinct from 'Zurückrufen'
       or v_diff ? 'type' then
        raise exception 'audit_task_changes regression failed: %', v_diff;
    end if;

    -- Storage stats: VOLATILE class + admin-only shape (same keys as before).
    select user_id into v_admin
    from public.sales
    where administrator = true and disabled = false
    limit 1;
    if v_admin is null then
        raise exception 'admin sales user required for get_audit_storage_stats check';
    end if;
    perform set_config('request.jwt.claim.sub', v_admin::text, true);
    perform set_config(
        'request.jwt.claims',
        jsonb_build_object('sub', v_admin::text, 'role', 'authenticated')::text,
        true
    );
    set local role authenticated;

    v_stats := public.get_audit_storage_stats();
    reset role;

    if not (
        v_stats ? 'event_count'
        and v_stats ? 'events_last_30_days'
        and v_stats ? 'table_bytes'
        and v_stats ? 'index_bytes'
        and v_stats ? 'total_bytes'
        and v_stats ? 'avg_metadata_bytes'
        and v_stats ? 'growth_hint'
        and v_stats ? 'projection_note'
    ) then
        raise exception 'get_audit_storage_stats missing required keys: %', v_stats;
    end if;
    if (v_stats ->> 'total_bytes')::bigint
         is distinct from
       ((v_stats ->> 'table_bytes')::bigint + (v_stats ->> 'index_bytes')::bigint)
    then
        raise exception 'get_audit_storage_stats total_bytes mismatch';
    end if;
end;
$$;

\echo '=== CRM Audit verification OK ==='
