-- Nora CRM v0.4c.1: Google Calendar read-only foundation
-- Spec: docs/nora/14-google-calendar-readonly-implementation.md

-- ---------------------------------------------------------------------------
-- 1. nora_calendar_writer capability (cache writes only, no token access)
-- ---------------------------------------------------------------------------

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'nora_calendar_writer') then
        create role nora_calendar_writer
            nosuperuser nobypassrls noinherit nocreaterole nocreatedb nologin;
    end if;
end
$$;

grant nora_calendar_writer to postgres;

grant usage on schema public to nora_calendar_writer;
grant usage on schema nora_private to nora_calendar_writer;

comment on role nora_calendar_writer is
    'NOLOGIN capability: controlled INSERT/UPDATE/DELETE on google_calendar_* cache tables via Edge Functions / SECURITY DEFINER.';

-- ---------------------------------------------------------------------------
-- 2. google_calendar_connections (no tokens)
-- ---------------------------------------------------------------------------

create table public.google_calendar_connections (
    id uuid primary key default gen_random_uuid(),
    calendar_id text not null,
    calendar_name text,
    google_account_email text,
    status text not null default 'disconnected',
    scopes_granted text[] not null default '{}'::text[],
    connected_by uuid,
    connected_at timestamptz,
    disconnected_at timestamptz,
    last_sync_at timestamptz,
    last_sync_error text,
    sync_token text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint google_calendar_connections_status_check
        check (status in ('disconnected', 'connecting', 'connected', 'error', 'token_expired')),
    constraint google_calendar_connections_calendar_id_nonempty
        check (length(trim(calendar_id)) > 0)
);

create unique index google_calendar_connections_one_connected_idx
    on public.google_calendar_connections (status)
    where status = 'connected';

create index google_calendar_connections_status_idx
    on public.google_calendar_connections (status);

comment on table public.google_calendar_connections is
    'Singleton Google business calendar connection metadata. No OAuth tokens stored here.';

-- ---------------------------------------------------------------------------
-- 3. google_calendar_events (read-only cache + CRM links)
-- ---------------------------------------------------------------------------

create table public.google_calendar_events (
    id uuid primary key default gen_random_uuid(),
    connection_id uuid not null references public.google_calendar_connections (id) on delete restrict,
    google_event_id text not null,
    google_ical_uid text,
    google_etag text,
    origin text not null default 'google',
    google_status text,
    title_snapshot text,
    description_snapshot text,
    location_snapshot text,
    html_link text,
    is_all_day boolean not null default false,
    starts_at timestamptz,
    ends_at timestamptz,
    start_date date,
    end_date date,
    timezone text,
    recurring_event_id text,
    original_start_at timestamptz,
    google_updated_at timestamptz,
    company_id bigint references public.companies (id) on delete set null,
    contact_id bigint references public.contacts (id) on delete set null,
    deal_id bigint references public.deals (id) on delete set null,
    last_synced_at timestamptz,
    deleted_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint google_calendar_events_origin_check
        check (origin in ('google', 'nora')),
    constraint google_calendar_events_google_event_id_nonempty
        check (length(trim(google_event_id)) > 0),
    constraint google_calendar_events_description_snapshot_len
        check (description_snapshot is null or length(description_snapshot) <= 2000),
    constraint google_calendar_events_timing_check check (
        (
            is_all_day = true
            and starts_at is null
            and ends_at is null
            and start_date is not null
            and end_date is not null
        )
        or (
            is_all_day = false
            and starts_at is not null
            and ends_at is not null
            and start_date is null
            and end_date is null
        )
    ),
    constraint google_calendar_events_unique_per_connection
        unique (connection_id, google_event_id)
);

create index google_calendar_events_connection_starts_idx
    on public.google_calendar_events (connection_id, starts_at)
    where deleted_at is null and is_all_day = false;

create index google_calendar_events_connection_start_date_idx
    on public.google_calendar_events (connection_id, start_date)
    where deleted_at is null and is_all_day = true;

create index google_calendar_events_deal_id_idx
    on public.google_calendar_events (deal_id)
    where deal_id is not null;

create index google_calendar_events_company_id_idx
    on public.google_calendar_events (company_id)
    where company_id is not null;

comment on table public.google_calendar_events is
    'Google Calendar event cache + Nora CRM links. Google is system of record for event content.';

-- ---------------------------------------------------------------------------
-- 4. Encrypted refresh token storage (prepared — no tokens in v0.4c.1)
-- ---------------------------------------------------------------------------

create table nora_private.google_calendar_oauth_secrets (
    connection_id uuid primary key references public.google_calendar_connections (id) on delete cascade,
    refresh_token_ciphertext text not null,
    encryption_key_id text not null default 'v1',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

comment on table nora_private.google_calendar_oauth_secrets is
    'Encrypted OAuth refresh tokens. Accessible only via service_role / Edge Functions — never via Data API.';

revoke all on table nora_private.google_calendar_oauth_secrets from public;
revoke all on table nora_private.google_calendar_oauth_secrets from anon;
revoke all on table nora_private.google_calendar_oauth_secrets from authenticated;

-- OAuth CSRF state (short-lived, no tokens)
create table nora_private.google_oauth_states (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    state_hash text not null,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
);

create index google_oauth_states_expires_idx
    on nora_private.google_oauth_states (expires_at);

revoke all on table nora_private.google_oauth_states from public;
revoke all on table nora_private.google_oauth_states from anon;
revoke all on table nora_private.google_oauth_states from authenticated;

-- Edge Function OAuth state (service_role only — nora_private not exposed via PostgREST)
create or replace function public.store_google_oauth_state(
    p_user_id uuid,
    p_state_hash text,
    p_expires_at timestamptz
)
returns uuid
language sql
security definer
set search_path = ''
as $$
    insert into nora_private.google_oauth_states (user_id, state_hash, expires_at)
    values (p_user_id, p_state_hash, p_expires_at)
    returning id;
$$;

alter function public.store_google_oauth_state(uuid, text, timestamptz) owner to postgres;

revoke all on function public.store_google_oauth_state(uuid, text, timestamptz) from public;
revoke all on function public.store_google_oauth_state(uuid, text, timestamptz) from anon;
revoke all on function public.store_google_oauth_state(uuid, text, timestamptz) from authenticated;
grant execute on function public.store_google_oauth_state(uuid, text, timestamptz) to service_role;

create or replace function public.consume_google_oauth_state(
    p_user_id uuid,
    p_state_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
begin
    select s.id into v_id
    from nora_private.google_oauth_states s
    where s.user_id = p_user_id
      and s.state_hash = p_state_hash
      and s.expires_at > now()
    limit 1;

    if v_id is null then
        return false;
    end if;

    delete from nora_private.google_oauth_states where id = v_id;
    return true;
end;
$$;

alter function public.consume_google_oauth_state(uuid, text) owner to postgres;

revoke all on function public.consume_google_oauth_state(uuid, text) from public;
revoke all on function public.consume_google_oauth_state(uuid, text) from anon;
revoke all on function public.consume_google_oauth_state(uuid, text) from authenticated;
grant execute on function public.consume_google_oauth_state(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Allowlist + validation helpers
-- ---------------------------------------------------------------------------

create or replace function nora_private.allowed_google_calendar_ids()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(
        array(
            select jsonb_array_elements_text(
                coalesce(
                    (select c.config -> 'google_calendar' -> 'allowed_calendar_ids'
                     from public.configuration c
                     where c.id = 1),
                    '[]'::jsonb
                )
            )
        ),
        array[]::text[]
    );
$$;

alter function nora_private.allowed_google_calendar_ids() owner to postgres;

revoke all on function nora_private.allowed_google_calendar_ids() from public;
revoke all on function nora_private.allowed_google_calendar_ids() from anon;
revoke all on function nora_private.allowed_google_calendar_ids() from authenticated;
grant execute on function nora_private.allowed_google_calendar_ids() to postgres;
grant execute on function nora_private.allowed_google_calendar_ids() to nora_calendar_writer;

create or replace function nora_private.assert_allowed_calendar_id(p_calendar_id text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_allowed text[];
begin
    if p_calendar_id is null or length(trim(p_calendar_id)) = 0 then
        raise exception 'calendar_id required' using errcode = '22023';
    end if;

    v_allowed := nora_private.allowed_google_calendar_ids();

    if coalesce(array_length(v_allowed, 1), 0) = 0 then
        raise exception 'google calendar allowlist not configured' using errcode = 'P0001';
    end if;

    if not (trim(p_calendar_id) = any (v_allowed)) then
        raise exception 'calendar_id not in allowlist' using errcode = '42501';
    end if;
end;
$$;

alter function nora_private.assert_allowed_calendar_id(text) owner to postgres;

revoke all on function nora_private.assert_allowed_calendar_id(text) from public;
revoke all on function nora_private.assert_allowed_calendar_id(text) from anon;
revoke all on function nora_private.assert_allowed_calendar_id(text) from authenticated;
grant execute on function nora_private.assert_allowed_calendar_id(text) to postgres;
grant execute on function nora_private.assert_allowed_calendar_id(text) to nora_calendar_writer;

create or replace function public.enforce_google_calendar_connection_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op in ('INSERT', 'UPDATE') then
        perform nora_private.assert_allowed_calendar_id(new.calendar_id);

        if new.status = 'connected' and (
            tg_op = 'INSERT'
            or old.status is distinct from 'connected'
        ) then
            if exists (
                select 1
                from public.google_calendar_connections c
                where c.status = 'connected'
                  and c.id is distinct from new.id
            ) then
                raise exception 'only one connected google calendar allowed' using errcode = '23505';
            end if;
        end if;
    end if;

    return coalesce(new, old);
end;
$$;

alter function public.enforce_google_calendar_connection_rules() owner to postgres;

create trigger enforce_google_calendar_connection_rules_trigger
    before insert or update on public.google_calendar_connections
    for each row execute function public.enforce_google_calendar_connection_rules();

create or replace function public.set_google_calendar_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

create trigger set_google_calendar_connections_updated_at
    before update on public.google_calendar_connections
    for each row execute function public.set_google_calendar_updated_at();

create trigger set_google_calendar_events_updated_at
    before update on public.google_calendar_events
    for each row execute function public.set_google_calendar_updated_at();

-- Block direct client mutation of cache rows (defense in depth)
create or replace function public.prevent_google_calendar_events_client_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if current_user in ('nora_calendar_writer', 'postgres', 'service_role') then
        return coalesce(new, old);
    end if;
    if coalesce(current_setting('nora.calendar_link_update', true), '') = '1' then
        return coalesce(new, old);
    end if;
    raise exception 'google_calendar_events cache is read-only for application users';
end;
$$;

alter function public.prevent_google_calendar_events_client_mutation() owner to postgres;

create trigger prevent_google_calendar_events_client_mutation_trigger
    before insert or update or delete on public.google_calendar_events
    for each row execute function public.prevent_google_calendar_events_client_mutation();

-- ---------------------------------------------------------------------------
-- 6. Link / unlink RPCs (CRM associations only — no Google mutation)
-- ---------------------------------------------------------------------------

create or replace function public.link_google_calendar_event(
    p_event_id uuid,
    p_company_id bigint default null,
    p_contact_id bigint default null,
    p_deal_id bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_event public.google_calendar_events%rowtype;
begin
    if not nora_private.has_role(array['admin', 'office']) then
        raise exception 'forbidden' using errcode = '42501';
    end if;

    if p_company_id is null and p_contact_id is null and p_deal_id is null then
        raise exception 'at least one of company_id, contact_id, deal_id required' using errcode = '22023';
    end if;

    select * into v_event
    from public.google_calendar_events e
    where e.id = p_event_id
      and e.deleted_at is null;

    if not found then
        raise exception 'calendar event not found: %', p_event_id using errcode = 'P0002';
    end if;

    if p_company_id is not null and not exists (select 1 from public.companies c where c.id = p_company_id) then
        raise exception 'company not found: %', p_company_id using errcode = 'P0002';
    end if;

    if p_contact_id is not null and not exists (select 1 from public.contacts ct where ct.id = p_contact_id) then
        raise exception 'contact not found: %', p_contact_id using errcode = 'P0002';
    end if;

    if p_deal_id is not null and not exists (select 1 from public.deals d where d.id = p_deal_id) then
        raise exception 'deal not found: %', p_deal_id using errcode = 'P0002';
    end if;

    perform set_config('nora.calendar_link_update', '1', true);

    update public.google_calendar_events
    set
        company_id = coalesce(p_company_id, company_id),
        contact_id = coalesce(p_contact_id, contact_id),
        deal_id = coalesce(p_deal_id, deal_id)
    where id = p_event_id;

    perform set_config('nora.calendar_link_update', '', true);

    perform nora_private.write_audit_event(
        p_event_type := 'calendar.event_linked',
        p_entity_type := 'google_calendar_event',
        p_entity_id := p_event_id,
        p_company_id := coalesce(p_company_id, v_event.company_id),
        p_contact_id := coalesce(p_contact_id, v_event.contact_id),
        p_deal_id := coalesce(p_deal_id, v_event.deal_id),
        p_metadata := jsonb_build_object(
            'google_event_id', v_event.google_event_id,
            'origin', v_event.origin
        ),
        p_retention_class := 'integration'
    );

    return p_event_id;
end;
$$;

comment on function public.link_google_calendar_event(uuid, bigint, bigint, bigint) is
    'Admin/office: set CRM links on cached Google event. Does not modify Google.';

revoke all on function public.link_google_calendar_event(uuid, bigint, bigint, bigint) from public;
revoke all on function public.link_google_calendar_event(uuid, bigint, bigint, bigint) from anon;
grant execute on function public.link_google_calendar_event(uuid, bigint, bigint, bigint) to authenticated;
grant execute on function public.link_google_calendar_event(uuid, bigint, bigint, bigint) to service_role;

create or replace function public.unlink_google_calendar_event(
    p_event_id uuid,
    p_clear_company boolean default true,
    p_clear_contact boolean default true,
    p_clear_deal boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_event public.google_calendar_events%rowtype;
begin
    if not nora_private.has_role(array['admin', 'office']) then
        raise exception 'forbidden' using errcode = '42501';
    end if;

    select * into v_event
    from public.google_calendar_events e
    where e.id = p_event_id;

    if not found then
        raise exception 'calendar event not found: %', p_event_id using errcode = 'P0002';
    end if;

    perform set_config('nora.calendar_link_update', '1', true);

    update public.google_calendar_events
    set
        company_id = case when p_clear_company then null else company_id end,
        contact_id = case when p_clear_contact then null else contact_id end,
        deal_id = case when p_clear_deal then null else deal_id end
    where id = p_event_id;

    perform set_config('nora.calendar_link_update', '', true);

    perform nora_private.write_audit_event(
        p_event_type := 'calendar.event_unlinked',
        p_entity_type := 'google_calendar_event',
        p_entity_id := p_event_id,
        p_company_id := v_event.company_id,
        p_contact_id := v_event.contact_id,
        p_deal_id := v_event.deal_id,
        p_metadata := jsonb_build_object(
            'google_event_id', v_event.google_event_id,
            'origin', v_event.origin
        ),
        p_retention_class := 'integration'
    );

    return p_event_id;
end;
$$;

comment on function public.unlink_google_calendar_event(uuid, boolean, boolean, boolean) is
    'Admin/office: clear CRM links on cached Google event. Does not modify Google.';

revoke all on function public.unlink_google_calendar_event(uuid, boolean, boolean, boolean) from public;
revoke all on function public.unlink_google_calendar_event(uuid, boolean, boolean, boolean) from anon;
grant execute on function public.unlink_google_calendar_event(uuid, boolean, boolean, boolean) to authenticated;
grant execute on function public.unlink_google_calendar_event(uuid, boolean, boolean, boolean) to service_role;

-- Extend insert_audit_event retention for calendar.* codes
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
    elsif p_event_type like 'calendar.%' then
        v_retention := 'integration';
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

-- ---------------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------------

alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_events enable row level security;

create policy "Google calendar connections read admin"
    on public.google_calendar_connections
    for select to authenticated
    using (nora_private.is_admin());

create policy "Google calendar connections read calendar writer"
    on public.google_calendar_connections
    for select to nora_calendar_writer
    using (true);

create policy "Google calendar connections write calendar writer"
    on public.google_calendar_connections
    for insert to nora_calendar_writer
    with check (true);

create policy "Google calendar connections update calendar writer"
    on public.google_calendar_connections
    for update to nora_calendar_writer
    using (true)
    with check (true);

create policy "Google calendar events read active users"
    on public.google_calendar_events
    for select to authenticated
    using (nora_private.is_active_user());

create policy "Google calendar events read calendar writer"
    on public.google_calendar_events
    for select to nora_calendar_writer
    using (true);

create policy "Google calendar events insert calendar writer"
    on public.google_calendar_events
    for insert to nora_calendar_writer
    with check (true);

create policy "Google calendar events update calendar writer"
    on public.google_calendar_events
    for update to nora_calendar_writer
    using (true)
    with check (true);

create policy "Google calendar events delete calendar writer"
    on public.google_calendar_events
    for delete to nora_calendar_writer
    using (true);

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------

revoke all on table public.google_calendar_connections from anon;
revoke insert, update, delete on table public.google_calendar_connections from authenticated;
grant select on table public.google_calendar_connections to authenticated;
grant all on table public.google_calendar_connections to service_role;

revoke all on table public.google_calendar_events from anon;
revoke insert, update, delete on table public.google_calendar_events from authenticated;
grant select on table public.google_calendar_events to authenticated;
grant all on table public.google_calendar_events to service_role;

grant select, insert, update on table public.google_calendar_connections to nora_calendar_writer;
grant select, insert, update, delete on table public.google_calendar_events to nora_calendar_writer;

grant usage on schema nora_private to nora_calendar_writer;
grant select, insert, update, delete on table nora_private.google_oauth_states to nora_calendar_writer;
grant select, insert, update, delete on table nora_private.google_calendar_oauth_secrets to nora_calendar_writer;
grant execute on function nora_private.assert_allowed_calendar_id(text) to nora_calendar_writer;
grant execute on function nora_private.allowed_google_calendar_ids() to nora_calendar_writer;
grant execute on function nora_private.write_audit_event(
    text, text, uuid, bigint, bigint, bigint, uuid, uuid, bigint, bigint,
    jsonb, jsonb, text, text, text, text
) to nora_calendar_writer;
