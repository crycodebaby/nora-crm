-- Nora Application Backbone – Foundation Wave 3: Error Observatory Core
-- Additive only. No remote apply in this commit.
--
-- Separates failed business operations (operation_errors) from successful
-- change history (audit_events). Client INSERT is forbidden; writes go through
-- SECURITY DEFINER RPCs with auth.uid() actor resolution and allowlisted metadata.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
-- No FK to deals/companies/contacts: resource_id is a soft reference so rows
-- survive archive/delete of the business entity. Actor columns are soft UUIDs
-- (no auth.users FK) so errors survive user deletion.

create table if not exists public.operation_errors (
    id uuid primary key default gen_random_uuid(),
    public_ref text not null,
    -- Wave 3: every persisted error MUST correlate to one Manager execute UUID.
    -- Non-operation diagnostics would need a deliberate later migration/model.
    operation_id uuid not null,
    operation_type text not null,
    resource_type text,
    resource_id text,
    -- Always set from safe_auth_uid() inside record RPC (never client-supplied).
    actor_user_id uuid not null,
    source text not null,
    safe_error_code text,
    technical_error_code text,
    technical_context jsonb not null default '{}'::jsonb,
    frontend_version text,
    occurred_at timestamptz not null default now(),
    reported_by_user_at timestamptz,
    reported_by_user_id uuid,
    resolved_at timestamptz,
    resolved_by uuid,
    resolution_note text,
    constraint operation_errors_public_ref_format_check
        check (public_ref ~ '^NORA-E[0-9A-HJKMNP-TV-Z]{8}$'),
    constraint operation_errors_source_check
        check (source in ('frontend', 'edge_function', 'system')),
    constraint operation_errors_operation_type_check
        check (
            char_length(operation_type) between 1 and 64
            and operation_type ~ '^[a-z][a-z0-9_.]*$'
        ),
    constraint operation_errors_resource_type_check
        check (
            resource_type is null
            or (
                char_length(resource_type) between 1 and 64
                and resource_type ~ '^[a-z][a-z0-9_]*$'
            )
        ),
    constraint operation_errors_resource_id_len_check
        check (resource_id is null or char_length(resource_id) <= 64),
    constraint operation_errors_safe_error_code_len_check
        check (safe_error_code is null or char_length(safe_error_code) <= 64),
    constraint operation_errors_technical_error_code_len_check
        check (
            technical_error_code is null
            or char_length(technical_error_code) <= 64
        ),
    constraint operation_errors_frontend_version_len_check
        check (frontend_version is null or char_length(frontend_version) <= 64),
    constraint operation_errors_resolution_note_len_check
        check (resolution_note is null or char_length(resolution_note) <= 500),
    constraint operation_errors_technical_context_object_check
        check (jsonb_typeof(technical_context) = 'object')
);

create unique index if not exists operation_errors_public_ref_uidx
    on public.operation_errors (public_ref);

-- Dedupe: one persisted error row per Manager execute attempt (idempotent retry).
create unique index if not exists operation_errors_operation_id_uidx
    on public.operation_errors (operation_id);

create index if not exists operation_errors_occurred_at_idx
    on public.operation_errors (occurred_at desc);

create index if not exists operation_errors_actor_occurred_idx
    on public.operation_errors (actor_user_id, occurred_at desc)
    where actor_user_id is not null;

create index if not exists operation_errors_unresolved_idx
    on public.operation_errors (occurred_at desc)
    where resolved_at is null;

comment on table public.operation_errors is
    'Error Observatory: failed fachliche Operationen. Separated from audit_events (successful changes). Soft resource refs; no client INSERT.';

comment on column public.operation_errors.public_ref is
    'Human-readable IT reference (NORA-E########). Server-generated; not sequential.';

comment on column public.operation_errors.operation_id is
    'Correlation UUID only — never used for auth/RLS.';

comment on column public.operation_errors.actor_user_id is
    'Set exclusively from nora_private.safe_auth_uid() inside record RPC.';

comment on column public.operation_errors.technical_context is
    'Allowlisted technical metadata only (http_status, postgrest_code, sqlstate, edge_function).';

-- ---------------------------------------------------------------------------
-- 2. RLS / Grants (table)
-- ---------------------------------------------------------------------------

alter table public.operation_errors enable row level security;

revoke all on table public.operation_errors from public;
revoke all on table public.operation_errors from anon;
revoke all on table public.operation_errors from authenticated;

-- Authenticated may SELECT only via RLS (admin diagnose). No INSERT/UPDATE/DELETE.
grant select on table public.operation_errors to authenticated;
grant all on table public.operation_errors to service_role;

drop policy if exists "Operation errors read admin only" on public.operation_errors;
create policy "Operation errors read admin only"
    on public.operation_errors
    for select
    to authenticated
    using (nora_private.is_admin());

-- No INSERT/UPDATE/DELETE policies for authenticated/anon — table writes only via DEFINER RPCs.

-- ---------------------------------------------------------------------------
-- 3. Helpers (private)
-- ---------------------------------------------------------------------------

create or replace function nora_private.generate_operation_error_public_ref()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
    -- Crockford base32 without I,L,O,U — collision-resistant, non-sequential.
    v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    v_bytes bytea;
    v_ref text;
    v_idx int;
    v_val int;
begin
    -- 16 random bytes from UUID hex; no pgcrypto dependency beyond gen_random_uuid.
    v_bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    v_ref := 'NORA-E';
    v_idx := 0;
    while v_idx < 8 loop
        v_val := get_byte(v_bytes, v_idx) % 32;
        v_ref := v_ref || substr(v_alphabet, v_val + 1, 1);
        v_idx := v_idx + 1;
    end loop;
    return v_ref;
end;
$$;

alter function nora_private.generate_operation_error_public_ref() owner to postgres;

comment on function nora_private.generate_operation_error_public_ref() is
    'Generates NORA-E + 8 Crockford chars from random bytes. Not sequential.';

revoke all on function nora_private.generate_operation_error_public_ref() from public;
revoke all on function nora_private.generate_operation_error_public_ref() from anon;
revoke all on function nora_private.generate_operation_error_public_ref() from authenticated;
revoke all on function nora_private.generate_operation_error_public_ref() from service_role;
grant execute on function nora_private.generate_operation_error_public_ref() to postgres;

create or replace function nora_private.sanitize_operation_error_context(
    p_context jsonb
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
    v_in jsonb := coalesce(p_context, '{}'::jsonb);
    v_out jsonb := '{}'::jsonb;
    v_key text;
    v_val jsonb;
    v_text text;
    v_num numeric;
    v_allowed text[] := array[
        'http_status',
        'postgrest_code',
        'sqlstate',
        'edge_function'
    ];
begin
    if jsonb_typeof(v_in) is distinct from 'object' then
        return '{}'::jsonb;
    end if;

    foreach v_key in array v_allowed loop
        if not (v_in ? v_key) then
            continue;
        end if;
        v_val := v_in -> v_key;

        if v_key = 'http_status' then
            if jsonb_typeof(v_val) = 'number' then
                v_num := (v_val #>> '{}')::numeric;
                if v_num = trunc(v_num) and v_num between 100 and 599 then
                    v_out := v_out || jsonb_build_object(v_key, v_num::int);
                end if;
            elsif jsonb_typeof(v_val) = 'string' then
                begin
                    v_num := nullif(btrim(v_val #>> '{}'), '')::numeric;
                    if v_num = trunc(v_num) and v_num between 100 and 599 then
                        v_out := v_out || jsonb_build_object(v_key, v_num::int);
                    end if;
                exception
                    when others then
                        null;
                end;
            end if;
        else
            if jsonb_typeof(v_val) is distinct from 'string' then
                continue;
            end if;
            v_text := left(btrim(v_val #>> '{}'), 64);
            if v_text = '' then
                continue;
            end if;
            -- Reject obvious secret/payload markers
            if v_text ~* '(bearer|authorization|password|refresh_token|service_role|eyJ)' then
                continue;
            end if;
            if v_key = 'sqlstate' and v_text !~ '^[0-9A-Z]{5}$' then
                continue;
            end if;
            if v_key = 'postgrest_code' and v_text !~ '^[A-Z0-9_]{2,32}$' then
                continue;
            end if;
            if v_key = 'edge_function' and v_text !~ '^[a-z0-9_-]{1,64}$' then
                continue;
            end if;
            v_out := v_out || jsonb_build_object(v_key, v_text);
        end if;
    end loop;

    return v_out;
end;
$$;

alter function nora_private.sanitize_operation_error_context(jsonb) owner to postgres;

revoke all on function nora_private.sanitize_operation_error_context(jsonb) from public;
revoke all on function nora_private.sanitize_operation_error_context(jsonb) from anon;
revoke all on function nora_private.sanitize_operation_error_context(jsonb) from authenticated;
revoke all on function nora_private.sanitize_operation_error_context(jsonb) from service_role;
grant execute on function nora_private.sanitize_operation_error_context(jsonb) to postgres;

-- ---------------------------------------------------------------------------
-- 4. record_operation_error (public RPC)
-- ---------------------------------------------------------------------------

create or replace function public.record_operation_error(
    p_operation_type text,
    p_operation_id uuid,
    p_resource_type text default null,
    p_resource_id text default null,
    p_source text default 'frontend',
    p_safe_error_code text default null,
    p_technical_error_code text default null,
    p_technical_context jsonb default '{}'::jsonb,
    p_frontend_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid;
    v_id uuid;
    v_ref text;
    v_context jsonb;
    v_source text;
    v_op_type text;
    v_res_type text;
    v_res_id text;
    v_safe text;
    v_tech text;
    v_fe text;
    v_attempt int := 0;
begin
    v_actor := nora_private.safe_auth_uid();
    if v_actor is null then
        raise exception 'not authenticated' using errcode = '28000';
    end if;

    -- operation_id is correlation only — never trusted for auth (actor = JWT).
    if p_operation_id is null then
        raise exception 'operation_id required' using errcode = '22023';
    end if;

    v_op_type := nullif(btrim(coalesce(p_operation_type, '')), '');
    if v_op_type is null
       or char_length(v_op_type) > 64
       or v_op_type !~ '^[a-z][a-z0-9_.]*$'
    then
        raise exception 'invalid operation_type' using errcode = '22023';
    end if;

    v_source := coalesce(nullif(btrim(p_source), ''), 'frontend');
    if v_source not in ('frontend', 'edge_function', 'system') then
        raise exception 'invalid source' using errcode = '22023';
    end if;

    v_res_type := nullif(btrim(coalesce(p_resource_type, '')), '');
    if v_res_type is not null
       and (
           char_length(v_res_type) > 64
           or v_res_type !~ '^[a-z][a-z0-9_]*$'
       )
    then
        raise exception 'invalid resource_type' using errcode = '22023';
    end if;

    v_res_id := nullif(btrim(coalesce(p_resource_id, '')), '');
    if v_res_id is not null then
        v_res_id := left(v_res_id, 64);
    end if;

    v_safe := nullif(btrim(coalesce(p_safe_error_code, '')), '');
    if v_safe is not null then
        v_safe := left(v_safe, 64);
        if v_safe !~ '^[a-z][a-z0-9_]*$' then
            v_safe := null;
        end if;
    end if;

    v_tech := nullif(btrim(coalesce(p_technical_error_code, '')), '');
    if v_tech is not null then
        v_tech := left(v_tech, 64);
        if v_tech !~ '^[A-Za-z0-9_.-]{1,64}$' then
            v_tech := null;
        end if;
    end if;

    v_fe := nullif(btrim(coalesce(p_frontend_version, '')), '');
    if v_fe is not null then
        v_fe := left(v_fe, 64);
        if v_fe ~* '(bearer|password|service_role|eyJ)' then
            v_fe := null;
        end if;
    end if;

    v_context := nora_private.sanitize_operation_error_context(p_technical_context);

    -- Idempotent dedupe for the same Manager operation_id (React rerender / double submit).
    select oe.id, oe.public_ref
    into v_id, v_ref
    from public.operation_errors oe
    where oe.operation_id = p_operation_id
    limit 1;

    if v_id is not null then
        return jsonb_build_object(
            'error_id', v_id,
            'public_ref', v_ref
        );
    end if;

    while v_attempt < 8 loop
        v_attempt := v_attempt + 1;
        begin
            v_ref := nora_private.generate_operation_error_public_ref();
            insert into public.operation_errors (
                public_ref,
                operation_id,
                operation_type,
                resource_type,
                resource_id,
                actor_user_id,
                source,
                safe_error_code,
                technical_error_code,
                technical_context,
                frontend_version
            )
            values (
                v_ref,
                p_operation_id,
                v_op_type,
                v_res_type,
                v_res_id,
                v_actor,
                v_source,
                v_safe,
                v_tech,
                v_context,
                v_fe
            )
            returning id into v_id;

            return jsonb_build_object(
                'error_id', v_id,
                'public_ref', v_ref
            );
        exception
            when unique_violation then
                -- Same operation_id raced → return existing
                select oe.id, oe.public_ref
                into v_id, v_ref
                from public.operation_errors oe
                where oe.operation_id = p_operation_id
                limit 1;
                if v_id is not null then
                    return jsonb_build_object(
                        'error_id', v_id,
                        'public_ref', v_ref
                    );
                end if;
                -- public_ref collision → retry (never overwrite another row)
                if v_attempt >= 8 then
                    raise;
                end if;
        end;
    end loop;

    raise exception 'failed to allocate public_ref' using errcode = 'P0001';
end;
$$;

alter function public.record_operation_error(
    text, uuid, text, text, text, text, text, jsonb, text
) owner to postgres;

comment on function public.record_operation_error(
    text, uuid, text, text, text, text, text, jsonb, text
) is
    'Error Observatory: persist a failed business operation. Actor from safe_auth_uid(). Allowlisted technical_context. Idempotent on operation_id.';

revoke all on function public.record_operation_error(
    text, uuid, text, text, text, text, text, jsonb, text
) from public;
revoke all on function public.record_operation_error(
    text, uuid, text, text, text, text, text, jsonb, text
) from anon;
grant execute on function public.record_operation_error(
    text, uuid, text, text, text, text, text, jsonb, text
) to authenticated;
grant execute on function public.record_operation_error(
    text, uuid, text, text, text, text, text, jsonb, text
) to service_role;

-- ---------------------------------------------------------------------------
-- 5. report_operation_error (public RPC) — „An IT melden“
-- ---------------------------------------------------------------------------

create or replace function public.report_operation_error(
    p_error_id uuid default null,
    p_public_ref text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid;
    v_row public.operation_errors%rowtype;
    v_ref text;
begin
    v_actor := nora_private.safe_auth_uid();
    if v_actor is null then
        raise exception 'not authenticated' using errcode = '28000';
    end if;

    if p_error_id is null and p_public_ref is null then
        raise exception 'error_id or public_ref required' using errcode = '22023';
    end if;

    v_ref := nullif(btrim(coalesce(p_public_ref, '')), '');
    if v_ref is not null then
        v_ref := upper(v_ref);
        if v_ref !~ '^NORA-E[0-9A-HJKMNP-TV-Z]{8}$' then
            raise exception 'invalid public_ref' using errcode = '22023';
        end if;
    end if;

    -- Exact lookup contract:
    -- - one identifier → resolve that identifier
    -- - both supplied → both must resolve to the SAME row (no loose OR)
    if p_error_id is not null and v_ref is not null then
        select *
        into v_row
        from public.operation_errors oe
        where oe.id = p_error_id
          and oe.public_ref = v_ref;
    elsif p_error_id is not null then
        select *
        into v_row
        from public.operation_errors oe
        where oe.id = p_error_id;
    else
        select *
        into v_row
        from public.operation_errors oe
        where oe.public_ref = v_ref;
    end if;

    if not found then
        raise exception 'operation error not found' using errcode = 'P0002';
    end if;

    -- Only the original actor may mark as reported.
    -- public_ref / error_id are NOT authorization tokens.
    if v_row.actor_user_id is distinct from v_actor then
        raise exception 'forbidden' using errcode = '42501';
    end if;

    if v_row.reported_by_user_at is not null then
        return jsonb_build_object(
            'error_id', v_row.id,
            'public_ref', v_row.public_ref,
            'reported_by_user_at', v_row.reported_by_user_at,
            'already_reported', true
        );
    end if;

    update public.operation_errors
    set
        reported_by_user_at = now(),
        reported_by_user_id = v_actor
    where id = v_row.id
    returning * into v_row;

    return jsonb_build_object(
        'error_id', v_row.id,
        'public_ref', v_row.public_ref,
        'reported_by_user_at', v_row.reported_by_user_at,
        'already_reported', false
    );
end;
$$;

alter function public.report_operation_error(uuid, text) owner to postgres;

comment on function public.report_operation_error(uuid, text) is
    'Marks an operation_errors row as reported to IT. Actor from JWT; only own errors; idempotent.';

revoke all on function public.report_operation_error(uuid, text) from public;
revoke all on function public.report_operation_error(uuid, text) from anon;
grant execute on function public.report_operation_error(uuid, text) to authenticated;
grant execute on function public.report_operation_error(uuid, text) to service_role;
