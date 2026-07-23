-- Nora CRM: correct plpgsql volatility declarations and drop unused locals.
--
-- Root causes (plpgsql_check / db lint):
-- 1) nora_private.audit_*_changes were IMMUTABLE but assign from expressions
--    that plpgsql_check classifies as STABLE (composite field access +
--    jsonb helpers in plpgsql). They do not read the DB or call VOLATILE
--    APIs, so STABLE is the minimal correct class. Not used in indexes.
-- 2) public.get_audit_storage_stats was STABLE but calls VOLATILE
--    pg_relation_size / pg_indexes_size. Admin RPC only → VOLATILE.
-- 3) public.get_avatar_for_email / get_domain_favicon declared unused locals.
--
-- No policy, grant, trigger, or audit output shape changes.

create or replace function nora_private.audit_company_changes(
    p_old public.companies,
    p_new public.companies
)
returns jsonb
language plpgsql
stable
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
stable
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
stable
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
stable
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

create or replace function public.get_audit_storage_stats()
returns jsonb
language plpgsql
volatile
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

create or replace function public.get_avatar_for_email(email text)
returns text
language plpgsql
set search_path to 'public'
as $$
declare
    email_hash text;
    gravatar_url text;
    gravatar_status int8;
    email_domain text;
begin
    email_hash = encode(extensions.digest(email, 'sha256'), 'hex');
    gravatar_url = concat('https://www.gravatar.com/avatar/', email_hash, '?d=404');

    select status from extensions.http_get(gravatar_url) into gravatar_status;

    if gravatar_status = 200 then
        return gravatar_url;
    end if;

    email_domain = split_part(email, '@', 2);
    return get_domain_favicon(email_domain);
exception
    when others then
        return 'ERROR';
end;
$$;

create or replace function public.get_domain_favicon(domain_name text)
returns text
language plpgsql
set search_path to 'public'
as $$
begin
    if exists (select from favicons_excluded_domains as fav where fav.domain = domain_name) then
        return null;
    end if;

    return concat(
        'https://favicon.show/',
        (regexp_matches(domain_name, '^(?:https?:\/\/)?(?:[^@\/\n]+@)?(?:www\.)?([^:\/?\n]+)', 'i'))[1]
    );
end;
$$;
