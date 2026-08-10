-- Nora Application Backbone – Foundation Wave 1: Operation Correlation
-- Additive only. No remote apply in this commit.
--
-- Goals:
-- 1) nora_private.current_operation_id() reads transaction GUC or request header
-- 2) write_audit_event fills audit_events.request_id
-- 3) Partial index for non-null request_id
--
-- Correlation only — never auth / RLS / roles.
-- Soft correlation: missing/invalid → NULL; never abort business or audit writes.

-- ---------------------------------------------------------------------------
-- 1. current_operation_id()
-- ---------------------------------------------------------------------------
-- INVOKER (not SECURITY DEFINER): only reads session GUCs / request.headers.
-- No elevated table access. EXECUTE limited to postgres + nora_audit_writer.
-- write_audit_event (SECURITY DEFINER as nora_audit_writer) calls this helper.

create or replace function nora_private.current_operation_id()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
    v_raw text;
    v_headers jsonb;
    v_uuid uuid;
begin
    -- 1) Transaction-local override (Edge / RPC SQL sessions) wins over header
    begin
        v_raw := nullif(btrim(current_setting('nora.operation_id', true)), '');
    exception
        when others then
            v_raw := null;
    end;

    -- 2) PostgREST request headers JSON
    if v_raw is null then
        begin
            v_headers := coalesce(
                nullif(current_setting('request.headers', true), '')::jsonb,
                '{}'::jsonb
            );
            -- PostgREST lowercases header names
            v_raw := nullif(btrim(v_headers ->> 'x-nora-operation-id'), '');
        exception
            -- Covers invalid JSON, unexpected types, missing GUC, etc.
            when others then
                v_raw := null;
        end;
    end if;

    if v_raw is null then
        return null;
    end if;

    -- 3) Accept only valid UUID; never abort the business operation
    begin
        v_uuid := v_raw::uuid;
        return lower(v_uuid::text);
    exception
        when invalid_text_representation then
            return null;
        when others then
            return null;
    end;
end;
$$;

alter function nora_private.current_operation_id() owner to postgres;

comment on function nora_private.current_operation_id() is
    'Correlation helper (INVOKER): nora.operation_id GUC or request header x-nora-operation-id. Returns UUID text or NULL. Never used for auth/RLS.';

revoke all on function nora_private.current_operation_id() from public;
revoke all on function nora_private.current_operation_id() from anon;
revoke all on function nora_private.current_operation_id() from authenticated;
revoke all on function nora_private.current_operation_id() from service_role;
grant execute on function nora_private.current_operation_id() to postgres;
grant execute on function nora_private.current_operation_id() to nora_audit_writer;

-- ---------------------------------------------------------------------------
-- 2. write_audit_event – populate request_id
-- ---------------------------------------------------------------------------
-- Signature unchanged: existing triggers stay compatible.
-- request_id is additive only. Correlation failure → NULL, insert still proceeds.

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
    v_request_id text;
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

    -- Soft correlation: never let helper failure block the audit row
    begin
        v_request_id := nora_private.current_operation_id();
    exception
        when others then
            v_request_id := null;
    end;

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
        metadata,
        request_id
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
        v_meta,
        v_request_id
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

-- ---------------------------------------------------------------------------
-- 3. Partial index (non-unique: one operation may yield many audit rows)
-- ---------------------------------------------------------------------------

create index if not exists audit_events_request_id_idx
    on public.audit_events (request_id)
    where request_id is not null;
