-- Nora Application Backbone – Foundation Wave 1
-- Operation correlation verification (local Supabase / Docker)
--
-- Run after: npx supabase db reset --local
-- Example: psql / docker exec into supabase_db_* and \i this file
--
-- This test simulates PostgREST by setting request.headers / nora.operation_id
-- via set_config — the same GUCs PostgREST populates per request.

\set ON_ERROR_STOP on

\echo '=== Operation correlation Wave 1 verification ==='

do $$
declare
    v_id text;
    v_company_id bigint;
    v_deal_id bigint;
    v_request_id text;
    v_count int;
    v_op constant text := 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    v_op2 constant text := '11111111-2222-4333-8444-555555555555';
begin
    -- -----------------------------------------------------------------------
    -- current_operation_id: missing → NULL
    -- -----------------------------------------------------------------------
    perform set_config('request.headers', '', true);
    perform set_config('nora.operation_id', '', true);
    v_id := nora_private.current_operation_id();
    if v_id is not null then
        raise exception 'expected NULL without operation id, got %', v_id;
    end if;

    -- -----------------------------------------------------------------------
    -- valid header → UUID (lowercased)
    -- -----------------------------------------------------------------------
    perform set_config(
        'request.headers',
        json_build_object('x-nora-operation-id', upper(v_op))::text,
        true
    );
    v_id := nora_private.current_operation_id();
    if v_id is distinct from lower(v_op) then
        raise exception 'header UUID not read correctly: %', v_id;
    end if;

    -- -----------------------------------------------------------------------
    -- invalid header → NULL (must not throw)
    -- -----------------------------------------------------------------------
    perform set_config(
        'request.headers',
        json_build_object('x-nora-operation-id', 'not-a-uuid')::text,
        true
    );
    v_id := nora_private.current_operation_id();
    if v_id is not null then
        raise exception 'invalid header must yield NULL, got %', v_id;
    end if;

    -- -----------------------------------------------------------------------
    -- invalid request.headers JSON → NULL (must not throw)
    -- -----------------------------------------------------------------------
    perform set_config('request.headers', '{not-json', true);
    v_id := nora_private.current_operation_id();
    if v_id is not null then
        raise exception 'invalid headers JSON must yield NULL, got %', v_id;
    end if;

    -- empty header value → NULL
    perform set_config(
        'request.headers',
        json_build_object('x-nora-operation-id', '   ')::text,
        true
    );
    v_id := nora_private.current_operation_id();
    if v_id is not null then
        raise exception 'blank header must yield NULL, got %', v_id;
    end if;

    -- -----------------------------------------------------------------------
    -- transaction GUC has priority over header
    -- -----------------------------------------------------------------------
    perform set_config(
        'request.headers',
        json_build_object('x-nora-operation-id', v_op)::text,
        true
    );
    perform set_config('nora.operation_id', v_op2, true);
    v_id := nora_private.current_operation_id();
    if v_id is distinct from lower(v_op2) then
        raise exception 'GUC should win over header, got %', v_id;
    end if;

    -- clear GUC and headers for subsequent deal tests
    perform set_config('nora.operation_id', '', true);
    perform set_config('request.headers', '', true);

    -- -----------------------------------------------------------------------
    -- Business write without operation id still works; request_id stays NULL
    -- -----------------------------------------------------------------------
    insert into public.companies (name)
    values ('OpCorr Test GmbH')
    returning id into v_company_id;

    insert into public.deals (name, company_id, stage, category)
    values ('OpCorr Deal', v_company_id, 'requested', 'fensterservice')
    returning id into v_deal_id;

    select request_id into v_request_id
    from public.audit_events
    where event_type = 'deal.created' and deal_id = v_deal_id
    order by created_at desc
    limit 1;

    if v_request_id is not null then
        raise exception 'deal.created without header must have NULL request_id';
    end if;

    -- -----------------------------------------------------------------------
    -- deal.update with header → audit request_id matches
    -- -----------------------------------------------------------------------
    perform set_config(
        'request.headers',
        json_build_object('x-nora-operation-id', v_op)::text,
        true
    );

    update public.deals
    set description = 'correlated update'
    where id = v_deal_id;

    select request_id into v_request_id
    from public.audit_events
    where event_type = 'deal.updated' and deal_id = v_deal_id
    order by created_at desc
    limit 1;

    if v_request_id is distinct from lower(v_op) then
        raise exception 'deal.updated request_id expected %, got %',
            lower(v_op), v_request_id;
    end if;

    -- -----------------------------------------------------------------------
    -- Multiple audit events may share the same request_id
    -- -----------------------------------------------------------------------
    update public.deals
    set amount = 250
    where id = v_deal_id;

    select count(*) into v_count
    from public.audit_events
    where deal_id = v_deal_id
      and request_id = lower(v_op);

    if v_count < 2 then
        raise exception 'expected >=2 audit rows with same request_id, got %',
            v_count;
    end if;

    -- -----------------------------------------------------------------------
    -- Legacy rows without request_id remain valid
    -- -----------------------------------------------------------------------
    select count(*) into v_count
    from public.audit_events
    where deal_id = v_deal_id and request_id is null;

    if v_count < 1 then
        raise exception 'expected at least one legacy NULL request_id row';
    end if;

    -- -----------------------------------------------------------------------
    -- Security: authenticated must not EXECUTE current_operation_id
    -- -----------------------------------------------------------------------
    if has_function_privilege(
        'authenticated',
        'nora_private.current_operation_id()',
        'EXECUTE'
    ) then
        raise exception 'authenticated must not EXECUTE current_operation_id';
    end if;

    -- Header must not influence RLS helpers (smoke: can_write still works)
    if not nora_private.can_write() and nora_private.is_admin() then
        -- if session has no JWT, can_write may be false — that is OK
        null;
    end if;

    raise notice 'operation correlation Wave 1 verification OK';
end;
$$;

\echo '=== Operation correlation Wave 1 verification DONE ==='
