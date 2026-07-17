-- Nora CRM v0.4c.2: Google Calendar OAuth, encrypted tokens, manual read-only sync
-- Replaces GUC link path with nora_calendar_linker capability.

-- ---------------------------------------------------------------------------
-- 1. nora_calendar_linker (CRM link columns only)
-- ---------------------------------------------------------------------------

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'nora_calendar_linker') then
        create role nora_calendar_linker
            nosuperuser nobypassrls noinherit nocreaterole nocreatedb nologin;
    end if;
end
$$;

grant nora_calendar_linker to postgres;

grant usage on schema public to nora_calendar_linker;
grant create on schema public to nora_calendar_linker;

comment on role nora_calendar_linker is
    'NOLOGIN capability: UPDATE only CRM link columns on google_calendar_events via internal SECURITY DEFINER.';

-- ---------------------------------------------------------------------------
-- 2. OAuth state + secrets schema updates
-- ---------------------------------------------------------------------------

alter table nora_private.google_oauth_states
    add column if not exists pkce_verifier text;

comment on column nora_private.google_oauth_states.pkce_verifier is
    'Short-lived PKCE verifier (service_role only, deleted on consume). Never logged.';

alter table nora_private.google_calendar_oauth_secrets
    add column if not exists nonce text,
    add column if not exists rotated_at timestamptz;

comment on column nora_private.google_calendar_oauth_secrets.nonce is
    'AES-GCM nonce (base64). Required for decryption.';

-- ---------------------------------------------------------------------------
-- 3. OAuth state RPCs (PKCE + atomic consume by state hash)
-- ---------------------------------------------------------------------------

drop function if exists public.store_google_oauth_state(uuid, text, timestamptz);
drop function if exists public.consume_google_oauth_state(uuid, text);

create or replace function public.store_google_oauth_state(
    p_user_id uuid,
    p_state_hash text,
    p_expires_at timestamptz,
    p_pkce_verifier text
)
returns uuid
language sql
security definer
set search_path = ''
as $$
    insert into nora_private.google_oauth_states (
        user_id, state_hash, expires_at, pkce_verifier
    )
    values (p_user_id, p_state_hash, p_expires_at, p_pkce_verifier)
    returning id;
$$;

alter function public.store_google_oauth_state(uuid, text, timestamptz, text) owner to postgres;

revoke all on function public.store_google_oauth_state(uuid, text, timestamptz, text) from public;
revoke all on function public.store_google_oauth_state(uuid, text, timestamptz, text) from anon;
revoke all on function public.store_google_oauth_state(uuid, text, timestamptz, text) from authenticated;
grant execute on function public.store_google_oauth_state(uuid, text, timestamptz, text) to service_role;

create or replace function public.consume_google_oauth_state(p_state_hash text)
returns table(user_id uuid, pkce_verifier text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_row nora_private.google_oauth_states%rowtype;
begin
    select * into v_row
    from nora_private.google_oauth_states s
    where s.state_hash = p_state_hash
      and s.expires_at > now()
    for update
    limit 1;

    if not found then
        return;
    end if;

    delete from nora_private.google_oauth_states where id = v_row.id;

    user_id := v_row.user_id;
    pkce_verifier := v_row.pkce_verifier;
    return next;
end;
$$;

alter function public.consume_google_oauth_state(text) owner to postgres;

revoke all on function public.consume_google_oauth_state(text) from public;
revoke all on function public.consume_google_oauth_state(text) from anon;
revoke all on function public.consume_google_oauth_state(text) from authenticated;
grant execute on function public.consume_google_oauth_state(text) to service_role;

create or replace function public.store_google_calendar_refresh_token(
    p_connection_id uuid,
    p_ciphertext text,
    p_nonce text,
    p_key_version text,
    p_preserve_existing boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if p_preserve_existing and exists (
        select 1 from nora_private.google_calendar_oauth_secrets s
        where s.connection_id = p_connection_id
    ) then
        return;
    end if;

    insert into nora_private.google_calendar_oauth_secrets (
        connection_id,
        refresh_token_ciphertext,
        nonce,
        encryption_key_id,
        updated_at
    )
    values (
        p_connection_id,
        p_ciphertext,
        p_nonce,
        p_key_version,
        now()
    )
    on conflict (connection_id) do update
    set
        refresh_token_ciphertext = excluded.refresh_token_ciphertext,
        nonce = excluded.nonce,
        encryption_key_id = excluded.encryption_key_id,
        updated_at = now();
end;
$$;

alter function public.store_google_calendar_refresh_token(uuid, text, text, text, boolean) owner to postgres;

revoke all on function public.store_google_calendar_refresh_token(uuid, text, text, text, boolean) from public;
revoke all on function public.store_google_calendar_refresh_token(uuid, text, text, text, boolean) from anon;
revoke all on function public.store_google_calendar_refresh_token(uuid, text, text, text, boolean) from authenticated;
grant execute on function public.store_google_calendar_refresh_token(uuid, text, text, text, boolean) to service_role;

create or replace function public.load_google_calendar_refresh_token(p_connection_id uuid)
returns table(
    refresh_token_ciphertext text,
    nonce text,
    encryption_key_id text
)
language sql
security definer
set search_path = ''
as $$
    select
        s.refresh_token_ciphertext,
        s.nonce,
        s.encryption_key_id
    from nora_private.google_calendar_oauth_secrets s
    where s.connection_id = p_connection_id;
$$;

alter function public.load_google_calendar_refresh_token(uuid) owner to postgres;

revoke all on function public.load_google_calendar_refresh_token(uuid) from public;
revoke all on function public.load_google_calendar_refresh_token(uuid) from anon;
revoke all on function public.load_google_calendar_refresh_token(uuid) from authenticated;
grant execute on function public.load_google_calendar_refresh_token(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Internal link updater (owner = nora_calendar_linker)
-- ---------------------------------------------------------------------------

create or replace function public.apply_google_calendar_event_links(
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
begin
    update public.google_calendar_events
    set
        company_id = coalesce(p_company_id, company_id),
        contact_id = coalesce(p_contact_id, contact_id),
        deal_id = coalesce(p_deal_id, deal_id)
    where id = p_event_id;

    if not found then
        raise exception 'calendar event not found: %', p_event_id using errcode = 'P0002';
    end if;

    return p_event_id;
end;
$$;

alter function public.apply_google_calendar_event_links(uuid, bigint, bigint, bigint)
    owner to nora_calendar_linker;

revoke all on function public.apply_google_calendar_event_links(uuid, bigint, bigint, bigint)
    from public;
revoke all on function public.apply_google_calendar_event_links(uuid, bigint, bigint, bigint)
    from anon;
revoke all on function public.apply_google_calendar_event_links(uuid, bigint, bigint, bigint)
    from authenticated;
grant execute on function public.apply_google_calendar_event_links(uuid, bigint, bigint, bigint)
    to postgres;

create or replace function public.clear_google_calendar_event_links(
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
begin
    update public.google_calendar_events
    set
        company_id = case when p_clear_company then null else company_id end,
        contact_id = case when p_clear_contact then null else contact_id end,
        deal_id = case when p_clear_deal then null else deal_id end
    where id = p_event_id;

    if not found then
        raise exception 'calendar event not found: %', p_event_id using errcode = 'P0002';
    end if;

    return p_event_id;
end;
$$;

alter function public.clear_google_calendar_event_links(uuid, boolean, boolean, boolean)
    owner to nora_calendar_linker;

revoke all on function public.clear_google_calendar_event_links(uuid, boolean, boolean, boolean)
    from public;
revoke all on function public.clear_google_calendar_event_links(uuid, boolean, boolean, boolean)
    from anon;
revoke all on function public.clear_google_calendar_event_links(uuid, boolean, boolean, boolean)
    from authenticated;
grant execute on function public.clear_google_calendar_event_links(uuid, boolean, boolean, boolean)
    to postgres;

-- Restrict linker updates to CRM columns only
create or replace function public.enforce_google_calendar_linker_column_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if current_user <> 'nora_calendar_linker' then
        return new;
    end if;

    if new.connection_id is distinct from old.connection_id
        or new.google_event_id is distinct from old.google_event_id
        or new.google_ical_uid is distinct from old.google_ical_uid
        or new.google_etag is distinct from old.google_etag
        or new.origin is distinct from old.origin
        or new.google_status is distinct from old.google_status
        or new.title_snapshot is distinct from old.title_snapshot
        or new.description_snapshot is distinct from old.description_snapshot
        or new.location_snapshot is distinct from old.location_snapshot
        or new.html_link is distinct from old.html_link
        or new.is_all_day is distinct from old.is_all_day
        or new.starts_at is distinct from old.starts_at
        or new.ends_at is distinct from old.ends_at
        or new.start_date is distinct from old.start_date
        or new.end_date is distinct from old.end_date
        or new.timezone is distinct from old.timezone
        or new.recurring_event_id is distinct from old.recurring_event_id
        or new.original_start_at is distinct from old.original_start_at
        or new.google_updated_at is distinct from old.google_updated_at
        or new.last_synced_at is distinct from old.last_synced_at
        or new.deleted_at is distinct from old.deleted_at
        or new.created_at is distinct from old.created_at
    then
        raise exception 'nora_calendar_linker may only update CRM link columns';
    end if;

    return new;
end;
$$;

alter function public.enforce_google_calendar_linker_column_scope() owner to postgres;

create trigger enforce_google_calendar_linker_column_scope_trigger
    before update on public.google_calendar_events
    for each row execute function public.enforce_google_calendar_linker_column_scope();

-- Remove GUC backdoor; allow linker role
create or replace function public.prevent_google_calendar_events_client_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if current_user in (
        'nora_calendar_writer',
        'nora_calendar_linker',
        'postgres',
        'service_role'
    ) then
        return coalesce(new, old);
    end if;
    raise exception 'google_calendar_events cache is read-only for application users';
end;
$$;

-- Link / unlink public RPCs delegate to internal linker
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

    perform public.apply_google_calendar_event_links(
        p_event_id,
        p_company_id,
        p_contact_id,
        p_deal_id
    );

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

    perform public.clear_google_calendar_event_links(
        p_event_id,
        p_clear_company,
        p_clear_contact,
        p_clear_deal
    );

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

-- ---------------------------------------------------------------------------
-- 5. RLS + grants for linker
-- ---------------------------------------------------------------------------

create policy "Google calendar events update calendar linker"
    on public.google_calendar_events
    for update to nora_calendar_linker
    using (true)
    with check (true);

create policy "Google calendar events read calendar linker"
    on public.google_calendar_events
    for select to nora_calendar_linker
    using (true);

grant select, update on table public.google_calendar_events to nora_calendar_linker;

-- Pilot: minimize description in cache (prefer empty)
comment on column public.google_calendar_events.description_snapshot is
    'Optional short plain-text snapshot. Pilot v0.4c.2: prefer NULL; max 500 chars.';

alter table public.google_calendar_events
    drop constraint if exists google_calendar_events_description_snapshot_len;

alter table public.google_calendar_events
    add constraint google_calendar_events_description_snapshot_len
        check (description_snapshot is null or length(description_snapshot) <= 500);
