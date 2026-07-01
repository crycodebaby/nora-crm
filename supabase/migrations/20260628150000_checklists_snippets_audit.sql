-- Nora CRM v0.3d2: Checklisten, Textbausteine, Audit (append-only)
-- Spezifikation: docs/nora/10-checklists-snippets-audit.md

create extension if not exists "uuid-ossp" with schema "extensions";

-- ---------------------------------------------------------------------------
-- Helper: updated_at
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path to public
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Helper: stable UUID for bigint PK entities (deals, companies, contacts)
-- ---------------------------------------------------------------------------

create or replace function public.nora_entity_uuid(p_entity_type text, p_id bigint)
returns uuid
language sql
immutable
set search_path to public, extensions
as $$
    select extensions.uuid_generate_v5(
        '6ba7b811-9dad-11d1-80b4-00c04fd430c8'::uuid,
        p_entity_type || ':' || p_id::text
    );
$$;

-- ---------------------------------------------------------------------------
-- Helper: audit insert (SECURITY DEFINER — clients must not forge events)
-- ---------------------------------------------------------------------------

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
set search_path to public
as $$
declare
    v_id uuid := gen_random_uuid();
    v_actor uuid := auth.uid();
begin
    insert into public.audit_events (
        id,
        actor_id,
        event_type,
        entity_type,
        entity_id,
        company_id,
        contact_id,
        deal_id,
        checklist_run_id,
        checklist_run_item_id,
        old_data,
        new_data,
        metadata
    )
    values (
        v_id,
        v_actor,
        p_event_type,
        p_entity_type,
        p_entity_id,
        p_company_id,
        p_contact_id,
        p_deal_id,
        p_checklist_run_id,
        p_checklist_run_item_id,
        p_old_data,
        p_new_data,
        p_metadata
    );

    return v_id;
end;
$$;

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
-- Tables
-- ---------------------------------------------------------------------------

create table public.checklist_templates (
    id uuid primary key default gen_random_uuid(),
    code text not null,
    name text not null,
    service_area_code text not null,
    description text,
    is_active boolean not null default true,
    version integer not null default 1,
    created_by uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint checklist_templates_code_key unique (code),
    constraint checklist_templates_service_area_code_check
        check (service_area_code in ('FENS', 'HAUS', 'IMMO')),
    constraint checklist_templates_version_check check (version >= 1)
);

create table public.checklist_template_items (
    id uuid primary key default gen_random_uuid(),
    template_id uuid not null references public.checklist_templates (id) on delete restrict,
    label text not null,
    description text,
    is_required boolean not null default false,
    sort_index integer not null default 0,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint checklist_template_items_sort_index_check check (sort_index >= 0)
);

create table public.checklist_runs (
    id uuid primary key default gen_random_uuid(),
    template_id uuid not null references public.checklist_templates (id) on delete restrict,
    deal_id bigint not null references public.deals (id) on delete restrict,
    company_id bigint references public.companies (id) on delete restrict,
    contact_id bigint references public.contacts (id) on delete set null,
    service_area_code text not null,
    status text not null default 'open',
    started_by uuid,
    completed_by uuid,
    started_at timestamptz not null default now(),
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint checklist_runs_service_area_code_check
        check (service_area_code in ('FENS', 'HAUS', 'IMMO')),
    constraint checklist_runs_status_check
        check (status in ('open', 'completed', 'cancelled'))
);

create unique index uq_checklist_runs_one_open_per_deal_template
    on public.checklist_runs (deal_id, template_id)
    where status = 'open';

create table public.checklist_run_items (
    id uuid primary key default gen_random_uuid(),
    checklist_run_id uuid not null references public.checklist_runs (id) on delete restrict,
    template_item_id uuid references public.checklist_template_items (id) on delete set null,
    label_snapshot text not null,
    is_required boolean not null default false,
    is_checked boolean not null default false,
    checked_by uuid,
    checked_at timestamptz,
    note text,
    sort_index integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint checklist_run_items_sort_index_check check (sort_index >= 0)
);

create table public.saved_text_snippets (
    id uuid primary key default gen_random_uuid(),
    service_area_code text not null,
    kind text not null,
    text text not null,
    shortcut text,
    is_active boolean not null default true,
    created_by uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    usage_count integer not null default 0,
    constraint saved_text_snippets_service_area_code_check
        check (service_area_code in ('FENS', 'HAUS', 'IMMO')),
    constraint saved_text_snippets_kind_check
        check (kind in ('checklist_item', 'task_text', 'note_text', 'issue_text')),
    constraint saved_text_snippets_usage_count_check check (usage_count >= 0)
);

create table public.audit_events (
    id uuid primary key default gen_random_uuid(),
    actor_id uuid,
    event_type text not null,
    entity_type text not null,
    entity_id uuid not null,
    company_id bigint references public.companies (id) on delete set null,
    contact_id bigint references public.contacts (id) on delete set null,
    deal_id bigint references public.deals (id) on delete set null,
    checklist_run_id uuid references public.checklist_runs (id) on delete set null,
    checklist_run_item_id uuid references public.checklist_run_items (id) on delete set null,
    old_data jsonb,
    new_data jsonb,
    metadata jsonb,
    created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index checklist_templates_service_area_active_idx
    on public.checklist_templates (service_area_code, is_active);

create index checklist_template_items_template_sort_idx
    on public.checklist_template_items (template_id, sort_index);

create index checklist_runs_deal_status_idx
    on public.checklist_runs (deal_id, status);

create index checklist_runs_company_id_idx
    on public.checklist_runs (company_id);

create index checklist_runs_service_area_status_idx
    on public.checklist_runs (service_area_code, status);

create index checklist_run_items_run_sort_idx
    on public.checklist_run_items (checklist_run_id, sort_index);

create index saved_text_snippets_area_kind_active_idx
    on public.saved_text_snippets (service_area_code, kind, is_active);

create index audit_events_entity_created_idx
    on public.audit_events (entity_type, entity_id, created_at desc);

create index audit_events_company_created_idx
    on public.audit_events (company_id, created_at desc);

create index audit_events_deal_created_idx
    on public.audit_events (deal_id, created_at desc);

create index audit_events_checklist_run_created_idx
    on public.audit_events (checklist_run_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create trigger set_checklist_templates_updated_at
    before update on public.checklist_templates
    for each row execute function public.set_updated_at();

create trigger set_checklist_template_items_updated_at
    before update on public.checklist_template_items
    for each row execute function public.set_updated_at();

create trigger set_checklist_runs_updated_at
    before update on public.checklist_runs
    for each row execute function public.set_updated_at();

create trigger set_checklist_run_items_updated_at
    before update on public.checklist_run_items
    for each row execute function public.set_updated_at();

create trigger set_saved_text_snippets_updated_at
    before update on public.saved_text_snippets
    for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Checklist run defaults (company_id, started_by)
-- ---------------------------------------------------------------------------

create or replace function public.set_checklist_run_defaults()
returns trigger
language plpgsql
set search_path to public
as $$
begin
    if new.started_by is null then
        new.started_by := auth.uid();
    end if;

    if new.company_id is null and new.deal_id is not null then
        select d.company_id
        into new.company_id
        from public.deals d
        where d.id = new.deal_id;
    end if;

    return new;
end;
$$;

create trigger set_checklist_run_defaults_trigger
    before insert on public.checklist_runs
    for each row execute function public.set_checklist_run_defaults();

-- ---------------------------------------------------------------------------
-- Audit: append-only guard
-- ---------------------------------------------------------------------------

create or replace function public.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path to public
as $$
begin
    raise exception 'audit_events is append-only';
end;
$$;

create trigger prevent_audit_events_update
    before update on public.audit_events
    for each row execute function public.prevent_audit_mutation();

create trigger prevent_audit_events_delete
    before delete on public.audit_events
    for each row execute function public.prevent_audit_mutation();

-- ---------------------------------------------------------------------------
-- Audit: deal stage changes
-- ---------------------------------------------------------------------------

create or replace function public.audit_deal_stage_change()
returns trigger
language plpgsql
security definer
set search_path to public
as $$
begin
    if tg_op = 'UPDATE' and old.stage is distinct from new.stage then
        perform public.insert_audit_event(
            'deal.stage_changed',
            'deal',
            public.nora_entity_uuid('deal', new.id),
            new.company_id,
            null,
            new.id,
            null,
            null,
            jsonb_build_object('stage', old.stage),
            jsonb_build_object('stage', new.stage),
            null
        );
    end if;

    return new;
end;
$$;

create trigger audit_deal_stage_change_trigger
    after update of stage on public.deals
    for each row execute function public.audit_deal_stage_change();

-- ---------------------------------------------------------------------------
-- Audit: checklist runs
-- ---------------------------------------------------------------------------

create or replace function public.audit_checklist_run_changes()
returns trigger
language plpgsql
security definer
set search_path to public
as $$
declare
    v_event_type text;
begin
    if tg_op = 'INSERT' then
        perform public.insert_audit_event(
            'checklist.run_started',
            'checklist_run',
            new.id,
            new.company_id,
            new.contact_id,
            new.deal_id,
            new.id,
            null,
            null,
            jsonb_build_object(
                'status', new.status,
                'template_id', new.template_id,
                'service_area_code', new.service_area_code
            ),
            null
        );
        return new;
    end if;

    if tg_op = 'UPDATE' and old.status is distinct from new.status then
        if new.status = 'completed' then
            v_event_type := 'checklist.run_completed';
        elsif new.status = 'cancelled' then
            v_event_type := 'checklist.run_cancelled';
        else
            v_event_type := 'checklist.run_status_changed';
        end if;

        perform public.insert_audit_event(
            v_event_type,
            'checklist_run',
            new.id,
            new.company_id,
            new.contact_id,
            new.deal_id,
            new.id,
            null,
            jsonb_build_object('status', old.status),
            jsonb_build_object('status', new.status),
            null
        );
    end if;

    return new;
end;
$$;

create trigger audit_checklist_run_changes_trigger
    after insert or update on public.checklist_runs
    for each row execute function public.audit_checklist_run_changes();

-- ---------------------------------------------------------------------------
-- Audit: checklist run items
-- ---------------------------------------------------------------------------

create or replace function public.audit_checklist_run_item_changes()
returns trigger
language plpgsql
security definer
set search_path to public
as $$
declare
    v_run public.checklist_runs%rowtype;
    v_event_type text;
begin
    select * into v_run from public.checklist_runs where id = coalesce(new.checklist_run_id, old.checklist_run_id);

    if tg_op = 'UPDATE' and old.is_checked is distinct from new.is_checked then
        v_event_type := case when new.is_checked then 'checklist.item_checked' else 'checklist.item_unchecked' end;

        perform public.insert_audit_event(
            v_event_type,
            'checklist_run_item',
            new.id,
            v_run.company_id,
            v_run.contact_id,
            v_run.deal_id,
            new.checklist_run_id,
            new.id,
            jsonb_build_object('is_checked', old.is_checked, 'label', old.label_snapshot),
            jsonb_build_object('is_checked', new.is_checked, 'label', new.label_snapshot),
            null
        );
    elsif tg_op = 'UPDATE' and old.note is distinct from new.note then
        perform public.insert_audit_event(
            'checklist.item_note_changed',
            'checklist_run_item',
            new.id,
            v_run.company_id,
            v_run.contact_id,
            v_run.deal_id,
            new.checklist_run_id,
            new.id,
            jsonb_build_object('note', old.note),
            jsonb_build_object('note', new.note),
            null
        );
    end if;

    return new;
end;
$$;

create trigger audit_checklist_run_item_changes_trigger
    after update on public.checklist_run_items
    for each row execute function public.audit_checklist_run_item_changes();

-- ---------------------------------------------------------------------------
-- Audit: saved text snippets
-- ---------------------------------------------------------------------------

create or replace function public.audit_saved_text_snippet_changes()
returns trigger
language plpgsql
security definer
set search_path to public
as $$
begin
    if tg_op = 'INSERT' then
        perform public.insert_audit_event(
            'snippet.created',
            'saved_text_snippet',
            new.id,
            null,
            null,
            null,
            null,
            null,
            null,
            jsonb_build_object(
                'kind', new.kind,
                'service_area_code', new.service_area_code,
                'text', new.text
            ),
            null
        );
        return new;
    end if;

    if tg_op = 'UPDATE' and old.is_active = true and new.is_active = false then
        perform public.insert_audit_event(
            'snippet.deactivated',
            'saved_text_snippet',
            new.id,
            null,
            null,
            null,
            null,
            null,
            jsonb_build_object('is_active', old.is_active),
            jsonb_build_object('is_active', new.is_active),
            null
        );
    end if;

    return new;
end;
$$;

create trigger audit_saved_text_snippet_changes_trigger
    after insert or update on public.saved_text_snippets
    for each row execute function public.audit_saved_text_snippet_changes();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.checklist_templates enable row level security;
alter table public.checklist_template_items enable row level security;
alter table public.checklist_runs enable row level security;
alter table public.checklist_run_items enable row level security;
alter table public.saved_text_snippets enable row level security;
alter table public.audit_events enable row level security;

-- Templates: read all authenticated; write admin only; no delete
create policy "Checklist templates read" on public.checklist_templates
    for select to authenticated using (true);

create policy "Checklist templates insert admin" on public.checklist_templates
    for insert to authenticated with check (public.is_admin());

create policy "Checklist templates update admin" on public.checklist_templates
    for update to authenticated
    using (public.is_admin()) with check (public.is_admin());

-- Template items: read all; write admin only; no delete
create policy "Checklist template items read" on public.checklist_template_items
    for select to authenticated using (true);

create policy "Checklist template items insert admin" on public.checklist_template_items
    for insert to authenticated with check (public.is_admin());

create policy "Checklist template items update admin" on public.checklist_template_items
    for update to authenticated
    using (public.is_admin()) with check (public.is_admin());

-- Runs: full use except delete
create policy "Checklist runs read" on public.checklist_runs
    for select to authenticated using (true);

create policy "Checklist runs insert" on public.checklist_runs
    for insert to authenticated with check (true);

create policy "Checklist runs update" on public.checklist_runs
    for update to authenticated using (true) with check (true);

-- Run items: full use except delete
create policy "Checklist run items read" on public.checklist_run_items
    for select to authenticated using (true);

create policy "Checklist run items insert" on public.checklist_run_items
    for insert to authenticated with check (true);

create policy "Checklist run items update" on public.checklist_run_items
    for update to authenticated using (true) with check (true);

-- Snippets: read/write authenticated; no delete (deactivate via update)
create policy "Saved text snippets read" on public.saved_text_snippets
    for select to authenticated using (true);

create policy "Saved text snippets insert" on public.saved_text_snippets
    for insert to authenticated with check (true);

create policy "Saved text snippets update" on public.saved_text_snippets
    for update to authenticated using (true) with check (true);

-- Audit: read only for authenticated
create policy "Audit events read" on public.audit_events
    for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant all on table public.checklist_templates to anon;
grant all on table public.checklist_templates to authenticated;
grant all on table public.checklist_templates to service_role;

grant all on table public.checklist_template_items to anon;
grant all on table public.checklist_template_items to authenticated;
grant all on table public.checklist_template_items to service_role;

grant all on table public.checklist_runs to anon;
grant all on table public.checklist_runs to authenticated;
grant all on table public.checklist_runs to service_role;

grant all on table public.checklist_run_items to anon;
grant all on table public.checklist_run_items to authenticated;
grant all on table public.checklist_run_items to service_role;

grant all on table public.saved_text_snippets to anon;
grant all on table public.saved_text_snippets to authenticated;
grant all on table public.saved_text_snippets to service_role;

grant select on table public.audit_events to anon;
grant select on table public.audit_events to authenticated;
grant all on table public.audit_events to service_role;

grant all on function public.set_updated_at() to anon;
grant all on function public.set_updated_at() to authenticated;
grant all on function public.set_updated_at() to service_role;

grant all on function public.nora_entity_uuid(text, bigint) to anon;
grant all on function public.nora_entity_uuid(text, bigint) to authenticated;
grant all on function public.nora_entity_uuid(text, bigint) to service_role;

grant all on function public.set_checklist_run_defaults() to anon;
grant all on function public.set_checklist_run_defaults() to authenticated;
grant all on function public.set_checklist_run_defaults() to service_role;

grant all on function public.prevent_audit_mutation() to anon;
grant all on function public.prevent_audit_mutation() to authenticated;
grant all on function public.prevent_audit_mutation() to service_role;

grant all on function public.audit_deal_stage_change() to anon;
grant all on function public.audit_deal_stage_change() to authenticated;
grant all on function public.audit_deal_stage_change() to service_role;

grant all on function public.audit_checklist_run_changes() to anon;
grant all on function public.audit_checklist_run_changes() to authenticated;
grant all on function public.audit_checklist_run_changes() to service_role;

grant all on function public.audit_checklist_run_item_changes() to anon;
grant all on function public.audit_checklist_run_item_changes() to authenticated;
grant all on function public.audit_checklist_run_item_changes() to service_role;

grant all on function public.audit_saved_text_snippet_changes() to anon;
grant all on function public.audit_saved_text_snippet_changes() to authenticated;
grant all on function public.audit_saved_text_snippet_changes() to service_role;

-- ---------------------------------------------------------------------------
-- Seed: FENS_PRODUCTION_RELEASE (9 Punkte)
-- ---------------------------------------------------------------------------

insert into public.checklist_templates (
    id,
    code,
    name,
    service_area_code,
    description,
    is_active,
    version
)
values (
    'a0000001-0001-4001-8001-000000000001'::uuid,
    'FENS_PRODUCTION_RELEASE',
    'Produktionsfreigabe Fenster',
    'FENS',
    'Interne Qualitäts- und Freigabecheckliste vor Herstellerproduktion (Fensterservice).',
    true,
    1
)
on conflict (code) do nothing;

insert into public.checklist_template_items (
    id,
    template_id,
    label,
    is_required,
    sort_index,
    is_active
)
values
    (
        'b0000001-0001-4001-8001-000000000001'::uuid,
        'a0000001-0001-4001-8001-000000000001'::uuid,
        'Maße geprüft',
        true,
        1,
        true
    ),
    (
        'b0000001-0001-4001-8001-000000000002'::uuid,
        'a0000001-0001-4001-8001-000000000001'::uuid,
        'Anschlagrichtung geprüft',
        true,
        2,
        true
    ),
    (
        'b0000001-0001-4001-8001-000000000003'::uuid,
        'a0000001-0001-4001-8001-000000000001'::uuid,
        'Farbe innen/außen geprüft',
        true,
        3,
        true
    ),
    (
        'b0000001-0001-4001-8001-000000000004'::uuid,
        'a0000001-0001-4001-8001-000000000001'::uuid,
        'Glasart geprüft',
        true,
        4,
        true
    ),
    (
        'b0000001-0001-4001-8001-000000000005'::uuid,
        'a0000001-0001-4001-8001-000000000001'::uuid,
        'Zusatzoptionen geprüft',
        true,
        5,
        true
    ),
    (
        'b0000001-0001-4001-8001-000000000006'::uuid,
        'a0000001-0001-4001-8001-000000000001'::uuid,
        'Lieferadresse geprüft',
        true,
        6,
        true
    ),
    (
        'b0000001-0001-4001-8001-000000000007'::uuid,
        'a0000001-0001-4001-8001-000000000001'::uuid,
        'Rechnungsbetrag geprüft',
        true,
        7,
        true
    ),
    (
        'b0000001-0001-4001-8001-000000000008'::uuid,
        'a0000001-0001-4001-8001-000000000001'::uuid,
        'Vorkasse bezahlt',
        false,
        8,
        true
    ),
    (
        'b0000001-0001-4001-8001-000000000009'::uuid,
        'a0000001-0001-4001-8001-000000000001'::uuid,
        'Produktion freigegeben',
        true,
        9,
        true
    )
on conflict (id) do nothing;
