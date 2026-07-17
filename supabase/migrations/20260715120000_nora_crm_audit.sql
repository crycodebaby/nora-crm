-- Nora CRM v0.3l: Vollständiger CRM-Audit-Verlauf
-- Spezifikation: docs/nora/13-crm-audit-retention.md (created with this wave)

-- ---------------------------------------------------------------------------
-- 1. Extend audit_events (no parallel table)
-- ---------------------------------------------------------------------------

alter table public.audit_events
    add column if not exists actor_sales_id bigint,
    add column if not exists actor_name_snapshot text,
    add column if not exists actor_role_snapshot text,
    add column if not exists source text not null default 'user',
    add column if not exists retention_class text not null default 'crm_change',
    add column if not exists request_id text,
    add column if not exists task_id bigint,
    add column if not exists note_id bigint;

alter table public.audit_events
    add constraint audit_events_source_check
        check (source in ('user', 'system', 'edge_function', 'migration', 'demo'));

alter table public.audit_events
    add constraint audit_events_retention_class_check
        check (retention_class in (
            'crm_change', 'security', 'user_management', 'checklist', 'integration', 'system'
        ));

create index if not exists audit_events_actor_sales_created_idx
    on public.audit_events (actor_sales_id, created_at desc);

create index if not exists audit_events_event_type_created_idx
    on public.audit_events (event_type, created_at desc);

create index if not exists audit_events_contact_created_idx
    on public.audit_events (contact_id, created_at desc);

create index if not exists audit_events_task_created_idx
    on public.audit_events (task_id, created_at desc)
    where task_id is not null;

comment on column public.audit_events.actor_sales_id is
    'Snapshot: sales.id at event time.';
comment on column public.audit_events.actor_name_snapshot is
    'Snapshot: display name at event time.';
comment on column public.audit_events.actor_role_snapshot is
    'Snapshot: sales.role at event time.';
comment on column public.audit_events.source is
    'Origin: user | system | edge_function | migration | demo';

-- ---------------------------------------------------------------------------
-- 2. nora_audit_writer capability (append-only INSERT only)
-- ---------------------------------------------------------------------------

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'nora_audit_writer') then
        create role nora_audit_writer
            nosuperuser nobypassrls noinherit nocreaterole nocreatedb nologin;
    end if;
end
$$;

grant nora_audit_writer to postgres;

grant usage on schema public to nora_audit_writer;
grant usage on schema nora_private to nora_audit_writer;
grant create on schema nora_private to nora_audit_writer;
grant insert on table public.audit_events to nora_audit_writer;
grant select on table public.sales to nora_audit_writer;
grant select on table public.companies to nora_audit_writer;
grant select on table public.deals to nora_audit_writer;

comment on role nora_audit_writer is
    'NOLOGIN capability: INSERT-only writer for audit_events via nora_private.write_audit_event.';

-- ---------------------------------------------------------------------------
-- 3. Actor resolution + compact change builder
-- ---------------------------------------------------------------------------

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
begin
    v_uid := nora_private.safe_auth_uid();

    if v_uid is null then
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

revoke all on function nora_private.resolve_audit_actor() from public;
revoke all on function nora_private.resolve_audit_actor() from anon;
revoke all on function nora_private.resolve_audit_actor() from authenticated;
grant execute on function nora_private.resolve_audit_actor() to postgres;
grant execute on function nora_private.resolve_audit_actor() to nora_audit_writer;

create or replace function nora_private.audit_json_field(
    p_old jsonb,
    p_new jsonb,
    p_key text
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
    select case
        when p_old is not distinct from p_new then null
        else jsonb_build_object('old', p_old, 'new', p_new)
    end;
$$;

alter function nora_private.audit_json_field(jsonb, jsonb, text) owner to postgres;

-- ---------------------------------------------------------------------------
-- 4. Core audit writer (owner = nora_audit_writer)
-- ---------------------------------------------------------------------------

create or replace function nora_private.write_audit_event(
    p_event_type text,
    p_entity_type text,
    p_entity_id uuid,
    p_company_id bigint default null,
    p_contact_id bigint default null,
    p_deal_id bigint default null,
    p_checklist_run_id uuid default null,
    p_checklist_run_item_id uuid default null,
    p_task_id bigint default null,
    p_note_id bigint default null,
    p_changes jsonb default null,
    p_metadata jsonb default null,
    p_retention_class text default 'crm_change',
    p_source text default 'user',
    p_customer_number text default null,
    p_case_number text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid := gen_random_uuid();
    v_actor record;
    v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
    select * into v_actor from nora_private.resolve_audit_actor() r limit 1;

    if p_changes is not null and p_changes <> '{}'::jsonb then
        v_meta := v_meta || jsonb_build_object('changes', p_changes);
    end if;

    if p_customer_number is not null then
        v_meta := v_meta || jsonb_build_object('customer_number', p_customer_number);
    end if;

    if p_case_number is not null then
        v_meta := v_meta || jsonb_build_object('case_number', p_case_number);
    end if;

    insert into public.audit_events (
        id,
        actor_id,
        actor_sales_id,
        actor_name_snapshot,
        actor_role_snapshot,
        source,
        retention_class,
        event_type,
        entity_type,
        entity_id,
        company_id,
        contact_id,
        deal_id,
        checklist_run_id,
        checklist_run_item_id,
        task_id,
        note_id,
        old_data,
        new_data,
        metadata
    )
    values (
        v_id,
        v_actor.actor_auth_id,
        v_actor.actor_sales_id,
        v_actor.actor_name,
        v_actor.actor_role,
        coalesce(p_source, 'user'),
        coalesce(p_retention_class, 'crm_change'),
        p_event_type,
        p_entity_type,
        p_entity_id,
        p_company_id,
        p_contact_id,
        p_deal_id,
        p_checklist_run_id,
        p_checklist_run_item_id,
        p_task_id,
        p_note_id,
        null,
        null,
        v_meta
    );

    return v_id;
end;
$$;

alter function nora_private.write_audit_event(
    text, text, uuid, bigint, bigint, bigint, uuid, uuid, bigint, bigint,
    jsonb, jsonb, text, text, text, text
) owner to nora_audit_writer;

revoke all on function nora_private.write_audit_event(
    text, text, uuid, bigint, bigint, bigint, uuid, uuid, bigint, bigint,
    jsonb, jsonb, text, text, text, text
) from public;
revoke all on function nora_private.write_audit_event(
    text, text, uuid, bigint, bigint, bigint, uuid, uuid, bigint, bigint,
    jsonb, jsonb, text, text, text, text
) from anon;
revoke all on function nora_private.write_audit_event(
    text, text, uuid, bigint, bigint, bigint, uuid, uuid, bigint, bigint,
    jsonb, jsonb, text, text, text, text
) from authenticated;
revoke all on function nora_private.write_audit_event(
    text, text, uuid, bigint, bigint, bigint, uuid, uuid, bigint, bigint,
    jsonb, jsonb, text, text, text, text
) from service_role;
grant execute on function nora_private.write_audit_event(
    text, text, uuid, bigint, bigint, bigint, uuid, uuid, bigint, bigint,
    jsonb, jsonb, text, text, text, text
) to postgres;

-- Backward-compatible wrapper for existing checklist triggers
create or replace function public.insert_audit_event(
    p_event_type text,
    p_entity_type text,
    p_entity_id uuid,
    p_company_id bigint default null,
    p_contact_id bigint default null,
    p_deal_id bigint default null,
    p_checklist_run_id uuid default null,
    p_checklist_run_item_id uuid default null,
    p_old_data jsonb default null,
    p_new_data jsonb default null,
    p_metadata jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_changes jsonb := '{}'::jsonb;
    v_key text;
    v_retention text := 'checklist';
    v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
    if p_event_type like 'checklist.%' or p_event_type like 'snippet.%' then
        v_retention := case
            when p_event_type like 'snippet.%' then 'crm_change'
            else 'checklist'
        end;
    elsif p_event_type like 'user.%' then
        v_retention := 'user_management';
    else
        v_retention := 'crm_change';
    end if;

    if p_old_data is not null or p_new_data is not null then
        for v_key in
            select key from (
                select jsonb_object_keys(coalesce(p_old_data, '{}'::jsonb)) as key
                union
                select jsonb_object_keys(coalesce(p_new_data, '{}'::jsonb)) as key
            ) keys
        loop
            v_changes := v_changes || jsonb_build_object(
                v_key,
                jsonb_build_object(
                    'old', p_old_data -> v_key,
                    'new', p_new_data -> v_key
                )
            );
        end loop;
    end if;

    return nora_private.write_audit_event(
        p_event_type,
        p_entity_type,
        p_entity_id,
        p_company_id,
        p_contact_id,
        p_deal_id,
        p_checklist_run_id,
        p_checklist_run_item_id,
        null,
        null,
        v_changes,
        v_meta,
        v_retention,
        'user',
        null,
        null
    );
end;
$$;

alter function public.insert_audit_event(
    text, text, uuid, bigint, bigint, bigint, uuid, uuid, jsonb, jsonb, jsonb
) owner to postgres;

revoke all on function public.insert_audit_event(
    text, text, uuid, bigint, bigint, bigint, uuid, uuid, jsonb, jsonb, jsonb
) from public;
revoke all on function public.insert_audit_event(
    text, text, uuid, bigint, bigint, bigint, uuid, uuid, jsonb, jsonb, jsonb
) from anon;
revoke all on function public.insert_audit_event(
    text, text, uuid, bigint, bigint, bigint, uuid, uuid, jsonb, jsonb, jsonb
) from authenticated;
grant execute on function public.insert_audit_event(
    text, text, uuid, bigint, bigint, bigint, uuid, uuid, jsonb, jsonb, jsonb
) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Whitelist diff builders
-- ---------------------------------------------------------------------------

create or replace function nora_private.audit_company_changes(
    p_old public.companies,
    p_new public.companies
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
    v jsonb := '{}'::jsonb;
    part jsonb;
begin
    part := nora_private.audit_json_field(to_jsonb(p_old.name), to_jsonb(p_new.name), 'name');
    if part is not null then v := v || jsonb_build_object('name', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.address), to_jsonb(p_new.address), 'address');
    if part is not null then v := v || jsonb_build_object('address', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.phone_number), to_jsonb(p_new.phone_number), 'phone_number');
    if part is not null then v := v || jsonb_build_object('phone_number', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.website), to_jsonb(p_new.website), 'website');
    if part is not null then v := v || jsonb_build_object('website', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.sales_id), to_jsonb(p_new.sales_id), 'sales_id');
    if part is not null then v := v || jsonb_build_object('sales_id', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.sector), to_jsonb(p_new.sector), 'sector');
    if part is not null then v := v || jsonb_build_object('sector', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.city), to_jsonb(p_new.city), 'city');
    if part is not null then v := v || jsonb_build_object('city', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.zipcode), to_jsonb(p_new.zipcode), 'zipcode');
    if part is not null then v := v || jsonb_build_object('zipcode', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.state_abbr), to_jsonb(p_new.state_abbr), 'state_abbr');
    if part is not null then v := v || jsonb_build_object('state_abbr', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.country), to_jsonb(p_new.country), 'country');
    if part is not null then v := v || jsonb_build_object('country', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.description), to_jsonb(p_new.description), 'description');
    if part is not null then v := v || jsonb_build_object('description', part); end if;
    return v;
end;
$$;

alter function nora_private.audit_company_changes(public.companies, public.companies) owner to postgres;

create or replace function nora_private.audit_contact_changes(
    p_old public.contacts,
    p_new public.contacts
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
    v jsonb := '{}'::jsonb;
    part jsonb;
begin
    part := nora_private.audit_json_field(to_jsonb(p_old.first_name), to_jsonb(p_new.first_name), 'first_name');
    if part is not null then v := v || jsonb_build_object('first_name', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.last_name), to_jsonb(p_new.last_name), 'last_name');
    if part is not null then v := v || jsonb_build_object('last_name', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.company_id), to_jsonb(p_new.company_id), 'company_id');
    if part is not null then v := v || jsonb_build_object('company_id', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.phone_jsonb), to_jsonb(p_new.phone_jsonb), 'phone_jsonb');
    if part is not null then v := v || jsonb_build_object('phone_jsonb', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.email_jsonb), to_jsonb(p_new.email_jsonb), 'email_jsonb');
    if part is not null then v := v || jsonb_build_object('email_jsonb', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.title), to_jsonb(p_new.title), 'title');
    if part is not null then v := v || jsonb_build_object('title', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.sales_id), to_jsonb(p_new.sales_id), 'sales_id');
    if part is not null then v := v || jsonb_build_object('sales_id', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.status), to_jsonb(p_new.status), 'status');
    if part is not null then v := v || jsonb_build_object('status', part); end if;
    return v;
end;
$$;

alter function nora_private.audit_contact_changes(public.contacts, public.contacts) owner to postgres;

create or replace function nora_private.audit_deal_changes(
    p_old public.deals,
    p_new public.deals
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
    v jsonb := '{}'::jsonb;
    part jsonb;
begin
    part := nora_private.audit_json_field(to_jsonb(p_old.name), to_jsonb(p_new.name), 'name');
    if part is not null then v := v || jsonb_build_object('name', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.company_id), to_jsonb(p_new.company_id), 'company_id');
    if part is not null then v := v || jsonb_build_object('company_id', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.contact_ids), to_jsonb(p_new.contact_ids), 'contact_ids');
    if part is not null then v := v || jsonb_build_object('contact_ids', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.stage), to_jsonb(p_new.stage), 'stage');
    if part is not null then v := v || jsonb_build_object('stage', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.category), to_jsonb(p_new.category), 'category');
    if part is not null then v := v || jsonb_build_object('category', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.amount), to_jsonb(p_new.amount), 'amount');
    if part is not null then v := v || jsonb_build_object('amount', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.expected_closing_date), to_jsonb(p_new.expected_closing_date), 'expected_closing_date');
    if part is not null then v := v || jsonb_build_object('expected_closing_date', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.sales_id), to_jsonb(p_new.sales_id), 'sales_id');
    if part is not null then v := v || jsonb_build_object('sales_id', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.archived_at), to_jsonb(p_new.archived_at), 'archived_at');
    if part is not null then v := v || jsonb_build_object('archived_at', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.description), to_jsonb(p_new.description), 'description');
    if part is not null then v := v || jsonb_build_object('description', part); end if;
    return v;
end;
$$;

alter function nora_private.audit_deal_changes(public.deals, public.deals) owner to postgres;

create or replace function nora_private.audit_task_changes(
    p_old public.tasks,
    p_new public.tasks
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
    v jsonb := '{}'::jsonb;
    part jsonb;
begin
    part := nora_private.audit_json_field(to_jsonb(p_old.text), to_jsonb(p_new.text), 'text');
    if part is not null then v := v || jsonb_build_object('text', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.due_date), to_jsonb(p_new.due_date), 'due_date');
    if part is not null then v := v || jsonb_build_object('due_date', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.done_date), to_jsonb(p_new.done_date), 'done_date');
    if part is not null then v := v || jsonb_build_object('done_date', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.contact_id), to_jsonb(p_new.contact_id), 'contact_id');
    if part is not null then v := v || jsonb_build_object('contact_id', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.sales_id), to_jsonb(p_new.sales_id), 'sales_id');
    if part is not null then v := v || jsonb_build_object('sales_id', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.type), to_jsonb(p_new.type), 'type');
    if part is not null then v := v || jsonb_build_object('type', part); end if;
    return v;
end;
$$;

alter function nora_private.audit_task_changes(public.tasks, public.tasks) owner to postgres;

create or replace function nora_private.audit_note_content_meta(
    p_old_text text,
    p_new_text text
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
    select jsonb_build_object(
        'content_changed', true,
        'old_length', coalesce(length(p_old_text), 0),
        'new_length', coalesce(length(p_new_text), 0),
        'old_preview', left(coalesce(p_old_text, ''), 80),
        'new_preview', left(coalesce(p_new_text, ''), 80),
        'old_hash', md5(coalesce(p_old_text, '')),
        'new_hash', md5(coalesce(p_new_text, ''))
    );
$$;

alter function nora_private.audit_note_content_meta(text, text) owner to postgres;

-- ---------------------------------------------------------------------------
-- 6. Entity audit triggers
-- ---------------------------------------------------------------------------

create or replace function public.audit_company_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_changes jsonb;
    v_event text;
    v_cn text;
begin
    if tg_op = 'INSERT' then
        perform nora_private.write_audit_event(
            p_event_type := 'company.created',
            p_entity_type := 'company',
            p_entity_id := public.nora_entity_uuid('company', new.id),
            p_company_id := new.id,
            p_customer_number := new.customer_number
        );
        return new;
    end if;

    if tg_op = 'UPDATE' then
        v_changes := nora_private.audit_company_changes(old, new);
        if v_changes = '{}'::jsonb then
            return new;
        end if;
        v_event := 'company.updated';
        v_cn := new.customer_number;
        perform nora_private.write_audit_event(
            p_event_type := v_event,
            p_entity_type := 'company',
            p_entity_id := public.nora_entity_uuid('company', new.id),
            p_company_id := new.id,
            p_changes := v_changes,
            p_customer_number := v_cn
        );
        return new;
    end if;

    if tg_op = 'DELETE' then
        perform nora_private.write_audit_event(
            p_event_type := 'company.deleted',
            p_entity_type := 'company',
            p_entity_id := public.nora_entity_uuid('company', old.id),
            p_company_id := old.id,
            p_retention_class := 'security',
            p_customer_number := old.customer_number
        );
        return old;
    end if;

    return coalesce(new, old);
end;
$$;

alter function public.audit_company_row() owner to postgres;

drop trigger if exists audit_company_row_trigger on public.companies;
create trigger audit_company_row_trigger
    after insert or update or delete on public.companies
    for each row execute function public.audit_company_row();

create or replace function public.audit_contact_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_changes jsonb;
    v_cn text;
begin
    if tg_op = 'INSERT' then
        select c.customer_number into v_cn
        from public.companies c where c.id = new.company_id;
        perform nora_private.write_audit_event(
            p_event_type := 'contact.created',
            p_entity_type := 'contact',
            p_entity_id := public.nora_entity_uuid('contact', new.id),
            p_company_id := new.company_id,
            p_contact_id := new.id,
            p_customer_number := v_cn
        );
        return new;
    end if;

    if tg_op = 'UPDATE' then
        v_changes := nora_private.audit_contact_changes(old, new);
        if v_changes = '{}'::jsonb then
            return new;
        end if;
        select c.customer_number into v_cn
        from public.companies c where c.id = new.company_id;
        perform nora_private.write_audit_event(
            p_event_type := 'contact.updated',
            p_entity_type := 'contact',
            p_entity_id := public.nora_entity_uuid('contact', new.id),
            p_company_id := new.company_id,
            p_contact_id := new.id,
            p_changes := v_changes,
            p_customer_number := v_cn
        );
        return new;
    end if;

    if tg_op = 'DELETE' then
        select c.customer_number into v_cn
        from public.companies c where c.id = old.company_id;
        perform nora_private.write_audit_event(
            p_event_type := 'contact.deleted',
            p_entity_type := 'contact',
            p_entity_id := public.nora_entity_uuid('contact', old.id),
            p_company_id := old.company_id,
            p_contact_id := old.id,
            p_retention_class := 'security',
            p_customer_number := v_cn
        );
        return old;
    end if;

    return coalesce(new, old);
end;
$$;

alter function public.audit_contact_row() owner to postgres;

drop trigger if exists audit_contact_row_trigger on public.contacts;
create trigger audit_contact_row_trigger
    after insert or update or delete on public.contacts
    for each row execute function public.audit_contact_row();

-- Replace legacy deal stage-only trigger with comprehensive deal audit
drop trigger if exists audit_deal_stage_change_trigger on public.deals;

create or replace function public.audit_deal_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_changes jsonb;
    v_event text;
    v_cn text;
begin
    if tg_op = 'INSERT' then
        select c.customer_number into v_cn
        from public.companies c where c.id = new.company_id;
        perform nora_private.write_audit_event(
            p_event_type := 'deal.created',
            p_entity_type := 'deal',
            p_entity_id := public.nora_entity_uuid('deal', new.id),
            p_company_id := new.company_id,
            p_deal_id := new.id,
            p_customer_number := v_cn,
            p_case_number := new.case_number
        );
        return new;
    end if;

    if tg_op = 'UPDATE' then
        if old.archived_at is null and new.archived_at is not null then
            select c.customer_number into v_cn from public.companies c where c.id = new.company_id;
            perform nora_private.write_audit_event(
                p_event_type := 'deal.archived',
                p_entity_type := 'deal',
                p_entity_id := public.nora_entity_uuid('deal', new.id),
                p_company_id := new.company_id,
                p_deal_id := new.id,
                p_customer_number := v_cn,
                p_case_number := new.case_number
            );
            return new;
        end if;

        if old.archived_at is not null and new.archived_at is null then
            select c.customer_number into v_cn from public.companies c where c.id = new.company_id;
            perform nora_private.write_audit_event(
                p_event_type := 'deal.restored',
                p_entity_type := 'deal',
                p_entity_id := public.nora_entity_uuid('deal', new.id),
                p_company_id := new.company_id,
                p_deal_id := new.id,
                p_customer_number := v_cn,
                p_case_number := new.case_number
            );
            return new;
        end if;

        v_changes := nora_private.audit_deal_changes(old, new);
        if v_changes = '{}'::jsonb then
            return new;
        end if;

        if v_changes ? 'stage' and (select count(*) from jsonb_object_keys(v_changes)) = 1 then
            v_event := 'deal.status_changed';
        else
            v_event := 'deal.updated';
        end if;

        select c.customer_number into v_cn from public.companies c where c.id = new.company_id;
        perform nora_private.write_audit_event(
            p_event_type := v_event,
            p_entity_type := 'deal',
            p_entity_id := public.nora_entity_uuid('deal', new.id),
            p_company_id := new.company_id,
            p_deal_id := new.id,
            p_changes := v_changes,
            p_customer_number := v_cn,
            p_case_number := new.case_number
        );
        return new;
    end if;

    if tg_op = 'DELETE' then
        select c.customer_number into v_cn from public.companies c where c.id = old.company_id;
        perform nora_private.write_audit_event(
            p_event_type := 'deal.deleted',
            p_entity_type := 'deal',
            p_entity_id := public.nora_entity_uuid('deal', old.id),
            p_company_id := old.company_id,
            p_deal_id := old.id,
            p_retention_class := 'security',
            p_customer_number := v_cn,
            p_case_number := old.case_number
        );
        return old;
    end if;

    return coalesce(new, old);
end;
$$;

alter function public.audit_deal_row() owner to postgres;

drop trigger if exists audit_deal_row_trigger on public.deals;
create trigger audit_deal_row_trigger
    after insert or update or delete on public.deals
    for each row execute function public.audit_deal_row();

create or replace function public.audit_task_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_changes jsonb;
    v_event text;
    v_company_id bigint;
    v_deal_id bigint;
    v_cn text;
begin
    if tg_op = 'INSERT' then
        select ct.company_id into v_company_id from public.contacts ct where ct.id = new.contact_id;
        perform nora_private.write_audit_event(
            p_event_type := 'task.created',
            p_entity_type := 'task',
            p_entity_id := public.nora_entity_uuid('task', new.id),
            p_company_id := v_company_id,
            p_contact_id := new.contact_id,
            p_task_id := new.id
        );
        return new;
    end if;

    if tg_op = 'UPDATE' then
        if old.done_date is null and new.done_date is not null then
            v_event := 'task.completed';
        elsif old.done_date is not null and new.done_date is null then
            v_event := 'task.reopened';
        else
            v_event := 'task.updated';
        end if;

        v_changes := nora_private.audit_task_changes(old, new);
        if v_event = 'task.updated' and v_changes = '{}'::jsonb then
            return new;
        end if;

        select ct.company_id into v_company_id from public.contacts ct where ct.id = new.contact_id;
        perform nora_private.write_audit_event(
            p_event_type := v_event,
            p_entity_type := 'task',
            p_entity_id := public.nora_entity_uuid('task', new.id),
            p_company_id := v_company_id,
            p_contact_id := new.contact_id,
            p_task_id := new.id,
            p_changes := case when v_event = 'task.updated' then v_changes else null end
        );
        return new;
    end if;

    if tg_op = 'DELETE' then
        select ct.company_id into v_company_id from public.contacts ct where ct.id = old.contact_id;
        perform nora_private.write_audit_event(
            p_event_type := 'task.deleted',
            p_entity_type := 'task',
            p_entity_id := public.nora_entity_uuid('task', old.id),
            p_company_id := v_company_id,
            p_contact_id := old.contact_id,
            p_task_id := old.id,
            p_retention_class := 'security'
        );
        return old;
    end if;

    return coalesce(new, old);
end;
$$;

alter function public.audit_task_row() owner to postgres;

drop trigger if exists audit_task_row_trigger on public.tasks;
create trigger audit_task_row_trigger
    after insert or update or delete on public.tasks
    for each row execute function public.audit_task_row();

create or replace function public.audit_contact_note_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_company_id bigint;
    v_meta jsonb;
begin
    select ct.company_id into v_company_id from public.contacts ct where ct.id = coalesce(new.contact_id, old.contact_id);

    if tg_op = 'INSERT' then
        perform nora_private.write_audit_event(
            p_event_type := 'contact_note.created',
            p_entity_type := 'contact_note',
            p_entity_id := public.nora_entity_uuid('contact_note', new.id),
            p_company_id := v_company_id,
            p_contact_id := new.contact_id,
            p_note_id := new.id,
            p_changes := nora_private.audit_note_content_meta(null, new.text)
        );
        return new;
    end if;

    if tg_op = 'UPDATE' then
        if old.text is not distinct from new.text then
            return new;
        end if;
        v_meta := nora_private.audit_note_content_meta(old.text, new.text);
        perform nora_private.write_audit_event(
            p_event_type := 'contact_note.updated',
            p_entity_type := 'contact_note',
            p_entity_id := public.nora_entity_uuid('contact_note', new.id),
            p_company_id := v_company_id,
            p_contact_id := new.contact_id,
            p_note_id := new.id,
            p_changes := v_meta
        );
        return new;
    end if;

    if tg_op = 'DELETE' then
        perform nora_private.write_audit_event(
            p_event_type := 'contact_note.deleted',
            p_entity_type := 'contact_note',
            p_entity_id := public.nora_entity_uuid('contact_note', old.id),
            p_company_id := v_company_id,
            p_contact_id := old.contact_id,
            p_note_id := old.id,
            p_changes := nora_private.audit_note_content_meta(old.text, null),
            p_retention_class := 'security'
        );
        return old;
    end if;

    return coalesce(new, old);
end;
$$;

alter function public.audit_contact_note_row() owner to postgres;

drop trigger if exists audit_contact_note_row_trigger on public.contact_notes;
create trigger audit_contact_note_row_trigger
    after insert or update or delete on public.contact_notes
    for each row execute function public.audit_contact_note_row();

create or replace function public.audit_deal_note_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_deal public.deals%rowtype;
    v_meta jsonb;
begin
    select * into v_deal from public.deals d where d.id = coalesce(new.deal_id, old.deal_id);

    if tg_op = 'INSERT' then
        perform nora_private.write_audit_event(
            p_event_type := 'deal_note.created',
            p_entity_type := 'deal_note',
            p_entity_id := public.nora_entity_uuid('deal_note', new.id),
            p_company_id := v_deal.company_id,
            p_deal_id := new.deal_id,
            p_note_id := new.id,
            p_changes := nora_private.audit_note_content_meta(null, new.text),
            p_case_number := v_deal.case_number
        );
        return new;
    end if;

    if tg_op = 'UPDATE' then
        if old.text is not distinct from new.text then
            return new;
        end if;
        v_meta := nora_private.audit_note_content_meta(old.text, new.text);
        perform nora_private.write_audit_event(
            p_event_type := 'deal_note.updated',
            p_entity_type := 'deal_note',
            p_entity_id := public.nora_entity_uuid('deal_note', new.id),
            p_company_id := v_deal.company_id,
            p_deal_id := new.deal_id,
            p_note_id := new.id,
            p_changes := v_meta,
            p_case_number := v_deal.case_number
        );
        return new;
    end if;

    if tg_op = 'DELETE' then
        perform nora_private.write_audit_event(
            p_event_type := 'deal_note.deleted',
            p_entity_type := 'deal_note',
            p_entity_id := public.nora_entity_uuid('deal_note', old.id),
            p_company_id := v_deal.company_id,
            p_deal_id := old.deal_id,
            p_note_id := old.id,
            p_changes := nora_private.audit_note_content_meta(old.text, null),
            p_retention_class := 'security',
            p_case_number := v_deal.case_number
        );
        return old;
    end if;

    return coalesce(new, old);
end;
$$;

alter function public.audit_deal_note_row() owner to postgres;

drop trigger if exists audit_deal_note_row_trigger on public.deal_notes;
create trigger audit_deal_note_row_trigger
    after insert or update or delete on public.deal_notes
    for each row execute function public.audit_deal_note_row();

create or replace function public.audit_sales_privilege_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'UPDATE' then
        if old.role is distinct from new.role then
            perform nora_private.write_audit_event(
                p_event_type := 'user.role_changed',
                p_entity_type := 'sales',
                p_entity_id := public.nora_entity_uuid('sales', new.id),
                p_changes := jsonb_build_object(
                    'role',
                    jsonb_build_object('old', old.role, 'new', new.role)
                ),
                p_metadata := jsonb_build_object('sale_id', new.id),
                p_retention_class := 'user_management'
            );
        end if;

        if old.disabled is distinct from new.disabled then
            perform nora_private.write_audit_event(
                p_event_type := case when new.disabled then 'user.disabled' else 'user.enabled' end,
                p_entity_type := 'sales',
                p_entity_id := public.nora_entity_uuid('sales', new.id),
                p_changes := jsonb_build_object(
                    'disabled',
                    jsonb_build_object('old', old.disabled, 'new', new.disabled)
                ),
                p_metadata := jsonb_build_object('sale_id', new.id),
                p_retention_class := 'user_management'
            );
        end if;
    end if;

    return new;
end;
$$;

alter function public.audit_sales_privilege_change() owner to postgres;

drop trigger if exists audit_sales_privilege_change_trigger on public.sales;
create trigger audit_sales_privilege_change_trigger
    after update of role, disabled on public.sales
    for each row execute function public.audit_sales_privilege_change();

-- ---------------------------------------------------------------------------
-- 7. Read RPCs (sanitized for office, full for admin)
-- ---------------------------------------------------------------------------

create or replace function public.get_entity_audit_events(
    p_entity_type text,
    p_entity_id bigint,
    p_limit integer default 20,
    p_before timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
    v_role text;
    v_rows jsonb;
begin
    if p_entity_type is null or p_entity_id is null then
        raise exception 'entity_type and entity_id required' using errcode = '22023';
    end if;

    if p_entity_type not in ('company', 'contact', 'deal') then
        raise exception 'invalid entity_type: %', p_entity_type using errcode = '22023';
    end if;

    v_role := nora_private.current_role();
    if v_role is null or v_role = 'viewer' then
        raise exception 'forbidden' using errcode = '42501';
    end if;

    select coalesce(jsonb_agg(row_to_json(q)::jsonb order by q.created_at desc), '[]'::jsonb)
    into v_rows
    from (
        select
            ae.id,
            ae.created_at,
            ae.event_type,
            ae.entity_type,
            ae.actor_name_snapshot,
            ae.actor_role_snapshot,
            ae.source,
            ae.metadata,
            ae.company_id,
            ae.contact_id,
            ae.deal_id,
            ae.task_id,
            ae.note_id
        from public.audit_events ae
        where (
            case p_entity_type
                when 'company' then ae.company_id = p_entity_id
                when 'contact' then ae.contact_id = p_entity_id
                when 'deal' then ae.deal_id = p_entity_id
            end
        )
        and (p_before is null or ae.created_at < p_before)
        order by ae.created_at desc
        limit v_limit
    ) q;

    return jsonb_build_object('data', v_rows, 'limit', v_limit);
end;
$$;

comment on function public.get_entity_audit_events(text, bigint, integer, timestamptz) is
    'Admin/office: paginated audit history for one company, contact, or deal. No auth UUID in result.';

revoke all on function public.get_entity_audit_events(text, bigint, integer, timestamptz) from public;
revoke all on function public.get_entity_audit_events(text, bigint, integer, timestamptz) from anon;
grant execute on function public.get_entity_audit_events(text, bigint, integer, timestamptz) to authenticated;
grant execute on function public.get_entity_audit_events(text, bigint, integer, timestamptz) to service_role;

create or replace function public.get_global_audit_events(
    p_limit integer default 50,
    p_before timestamptz default null,
    p_entity_type text default null,
    p_event_type text default null,
    p_actor_sales_id bigint default null,
    p_from timestamptz default null,
    p_to timestamptz default null,
    p_business_number text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
    v_rows jsonb;
begin
    if not nora_private.is_admin() then
        raise exception 'forbidden' using errcode = '42501';
    end if;

    select coalesce(jsonb_agg(row_to_json(q)::jsonb order by q.created_at desc), '[]'::jsonb)
    into v_rows
    from (
        select
            ae.id,
            ae.created_at,
            ae.event_type,
            ae.entity_type,
            ae.actor_id,
            ae.actor_sales_id,
            ae.actor_name_snapshot,
            ae.actor_role_snapshot,
            ae.source,
            ae.retention_class,
            ae.metadata,
            ae.company_id,
            ae.contact_id,
            ae.deal_id,
            ae.task_id,
            ae.note_id
        from public.audit_events ae
        where (p_before is null or ae.created_at < p_before)
          and (p_entity_type is null or ae.entity_type = p_entity_type)
          and (p_event_type is null or ae.event_type = p_event_type)
          and (p_actor_sales_id is null or ae.actor_sales_id = p_actor_sales_id)
          and (p_from is null or ae.created_at >= p_from)
          and (p_to is null or ae.created_at <= p_to)
          and (
              p_business_number is null
              or ae.metadata ->> 'customer_number' ilike p_business_number
              or ae.metadata ->> 'case_number' ilike p_business_number
          )
        order by ae.created_at desc
        limit v_limit
    ) q;

    return jsonb_build_object('data', v_rows, 'limit', v_limit);
end;
$$;

comment on function public.get_global_audit_events(
    integer, timestamptz, text, text, bigint, timestamptz, timestamptz, text
) is 'Admin only: global paginated audit log with filters.';

revoke all on function public.get_global_audit_events(
    integer, timestamptz, text, text, bigint, timestamptz, timestamptz, text
) from public;
revoke all on function public.get_global_audit_events(
    integer, timestamptz, text, text, bigint, timestamptz, timestamptz, text
) from anon;
grant execute on function public.get_global_audit_events(
    integer, timestamptz, text, text, bigint, timestamptz, timestamptz, text
) to authenticated;
grant execute on function public.get_global_audit_events(
    integer, timestamptz, text, text, bigint, timestamptz, timestamptz, text
) to service_role;

create or replace function public.get_audit_storage_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_count bigint;
    v_oldest timestamptz;
    v_newest timestamptz;
    v_last_30 bigint;
    v_table_bytes bigint;
    v_index_bytes bigint;
    v_avg_meta numeric;
begin
    if not nora_private.is_admin() then
        raise exception 'forbidden' using errcode = '42501';
    end if;

    select count(*), min(created_at), max(created_at)
    into v_count, v_oldest, v_newest
    from public.audit_events;

    select count(*) into v_last_30
    from public.audit_events
    where created_at >= now() - interval '30 days';

    select
        pg_catalog.pg_relation_size('public.audit_events'::regclass),
        pg_catalog.pg_indexes_size('public.audit_events'::regclass)
    into v_table_bytes, v_index_bytes;

    select avg(pg_catalog.pg_column_size(metadata)) into v_avg_meta
    from public.audit_events;

    return jsonb_build_object(
        'event_count', v_count,
        'oldest_event', v_oldest,
        'newest_event', v_newest,
        'events_last_30_days', v_last_30,
        'table_bytes', v_table_bytes,
        'index_bytes', v_index_bytes,
        'total_bytes', v_table_bytes + v_index_bytes,
        'avg_metadata_bytes', round(coalesce(v_avg_meta, 0)),
        'growth_hint',
            case
                when v_count < 10000 then 'unauffaellig'
                when v_count < 100000 then 'wachstum_beobachten'
                else 'archivierungsplanung_erforderlich'
            end,
        'projection_note',
            'Schaetzung: bei gleichbleibendem Tempo ~' ||
            round(v_last_30::numeric * 12)::text ||
            ' Ereignisse/Jahr (nur Indikator, keine Garantie).'
    );
end;
$$;

comment on function public.get_audit_storage_stats() is
    'Admin only: audit_events storage and growth statistics.';

revoke all on function public.get_audit_storage_stats() from public;
revoke all on function public.get_audit_storage_stats() from anon;
grant execute on function public.get_audit_storage_stats() to authenticated;
grant execute on function public.get_audit_storage_stats() to service_role;

-- FK constraints removed: ON DELETE SET NULL would UPDATE audit rows (blocked by append-only).
-- Context IDs are historical snapshots; business numbers live in metadata.

alter table public.audit_events drop constraint if exists audit_events_company_id_fkey;
alter table public.audit_events drop constraint if exists audit_events_contact_id_fkey;
alter table public.audit_events drop constraint if exists audit_events_deal_id_fkey;
alter table public.audit_events drop constraint if exists audit_events_checklist_run_id_fkey;
alter table public.audit_events drop constraint if exists audit_events_checklist_run_item_id_fkey;

-- ---------------------------------------------------------------------------
-- 8. RLS: admin-only direct SELECT; office via RPC
-- ---------------------------------------------------------------------------

drop policy if exists "Audit events read admin office" on public.audit_events;

create policy "Audit events read admin only" on public.audit_events
    for select to authenticated
    using (nora_private.has_role(array['admin']));

-- Allow append-only INSERT only via nora_audit_writer capability (SECURITY DEFINER owner)
create policy "Audit events insert audit writer" on public.audit_events
    for insert to nora_audit_writer
    with check (true);

-- Revoke direct SELECT from office path is enforced by policy above.
