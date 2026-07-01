-- Nora CRM v0.3d2 verification — run after: npx supabase db reset --local
-- Usage: psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/checklists_audit_verification.sql

\set ON_ERROR_STOP on

do $$
declare
    v_template_count int;
    v_item_count int;
    v_required_count int;
    v_optional_count int;
begin
    select count(*) into v_template_count
    from public.checklist_templates
    where code = 'FENS_PRODUCTION_RELEASE';

    if v_template_count <> 1 then
        raise exception 'Expected 1 FENS_PRODUCTION_RELEASE template, got %', v_template_count;
    end if;

    select count(*) into v_item_count
    from public.checklist_template_items i
    join public.checklist_templates t on t.id = i.template_id
    where t.code = 'FENS_PRODUCTION_RELEASE';

    if v_item_count <> 9 then
        raise exception 'Expected 9 template items, got %', v_item_count;
    end if;

    select count(*) into v_required_count
    from public.checklist_template_items i
    join public.checklist_templates t on t.id = i.template_id
    where t.code = 'FENS_PRODUCTION_RELEASE' and i.is_required = true;

    select count(*) into v_optional_count
    from public.checklist_template_items i
    join public.checklist_templates t on t.id = i.template_id
    where t.code = 'FENS_PRODUCTION_RELEASE' and i.is_required = false;

    if v_required_count <> 8 then
        raise exception 'Expected 8 required items, got %', v_required_count;
    end if;

    if v_optional_count <> 1 then
        raise exception 'Expected 1 optional item (Vorkasse), got %', v_optional_count;
    end if;
end;
$$;

-- Invalid service_area_code must fail
do $$
begin
    begin
        insert into public.checklist_templates (code, name, service_area_code)
        values ('INVALID_TEST', 'Invalid', 'INVALID');
        raise exception 'Expected constraint failure for invalid service_area_code';
    exception
        when check_violation then
            null;
    end;
end;
$$;

-- audit_events append-only
do $$
begin
    begin
        update public.audit_events set event_type = 'hack' where false;
    exception
        when others then
            if sqlerrm not like '%append-only%' then
                raise;
            end if;
    end;

    begin
        delete from public.audit_events where false;
    exception
        when others then
            if sqlerrm not like '%append-only%' then
                raise;
            end if;
    end;
end;
$$;

-- RLS enabled
do $$
declare
    v_rls boolean;
begin
    select relrowsecurity into v_rls
    from pg_class
    where relname = 'audit_events' and relnamespace = 'public'::regnamespace;

    if not coalesce(v_rls, false) then
        raise exception 'RLS not enabled on audit_events';
    end if;
end;
$$;

select 'checklists_audit_verification: OK' as result;

-- ---------------------------------------------------------------------------
-- v0.3d3: start_checklist_run_from_template
-- ---------------------------------------------------------------------------

do $$
begin
    if not exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'start_checklist_run_from_template'
    ) then
        raise exception 'start_checklist_run_from_template function missing';
    end if;

    if not has_function_privilege(
        'authenticated',
        'public.start_checklist_run_from_template(text, bigint, bigint)',
        'EXECUTE'
    ) then
        raise exception 'authenticated must EXECUTE start_checklist_run_from_template';
    end if;

    if has_function_privilege(
        'anon',
        'public.start_checklist_run_from_template(text, bigint, bigint)',
        'EXECUTE'
    ) then
        raise exception 'anon must not EXECUTE start_checklist_run_from_template';
    end if;
end;
$$;

do $$
declare
    v_test_user uuid := 'a0000000-0000-4000-8000-000000000099';
    v_company_id bigint;
    v_deal_id bigint;
    v_run_id uuid;
    v_run_id2 uuid;
    v_item_count int;
    v_audit_count int;
    v_required_ok boolean;
begin
    perform set_config('request.jwt.claim.sub', v_test_user::text, true);
    execute 'set local role authenticated';

    insert into public.companies (name)
    values ('Checklist RPC Test Co')
    returning id into v_company_id;

    insert into public.deals (name, company_id, stage, category)
    values ('Checklist RPC Test Deal', v_company_id, 'angenommen', 'fensterservice')
    returning id into v_deal_id;

    v_run_id := public.start_checklist_run_from_template(
        'FENS_PRODUCTION_RELEASE',
        v_deal_id
    );

    if v_run_id is null then
        raise exception 'start_checklist_run_from_template returned null';
    end if;

    select count(*)::int
    into v_item_count
    from public.checklist_run_items
    where checklist_run_id = v_run_id;

    if v_item_count <> 9 then
        raise exception 'Expected 9 run items, got %', v_item_count;
    end if;

    if exists (
        select 1
        from public.checklist_run_items
        where checklist_run_id = v_run_id
          and (label_snapshot is null or label_snapshot = '')
    ) then
        raise exception 'label_snapshot must be set on all run items';
    end if;

    select exists (
        select 1
        from public.checklist_run_items ri
        join public.checklist_template_items ti on ti.id = ri.template_item_id
        where ri.checklist_run_id = v_run_id
          and ri.is_required = ti.is_required
          and ri.sort_index = ti.sort_index
        having count(*) = 9
    ) into v_required_ok;

    if not v_required_ok then
        raise exception 'is_required/sort_index not copied from template items';
    end if;

    select count(*)::int
    into v_audit_count
    from public.audit_events
    where checklist_run_id = v_run_id
      and event_type = 'checklist.run_started';

    if v_audit_count <> 1 then
        raise exception 'Expected 1 checklist.run_started audit, got %', v_audit_count;
    end if;

    v_run_id2 := public.start_checklist_run_from_template(
        'FENS_PRODUCTION_RELEASE',
        v_deal_id
    );

    if v_run_id2 is distinct from v_run_id then
        raise exception 'Idempotent call must return same run id';
    end if;

    select count(*)::int
    into v_item_count
    from public.checklist_run_items
    where checklist_run_id = v_run_id;

    if v_item_count <> 9 then
        raise exception 'Idempotent call duplicated items: %', v_item_count;
    end if;

    select count(*)::int
    into v_audit_count
    from public.audit_events
    where checklist_run_id = v_run_id
      and event_type = 'checklist.run_started';

    if v_audit_count <> 1 then
        raise exception 'Idempotent call must not duplicate audit, got %', v_audit_count;
    end if;

    begin
        perform public.start_checklist_run_from_template('UNKNOWN_TEMPLATE_X', v_deal_id);
        raise exception 'Expected error for unknown template';
    exception
        when others then
            if sqlerrm not like '%template not found%' then
                raise;
            end if;
    end;

    begin
        perform public.start_checklist_run_from_template('FENS_PRODUCTION_RELEASE', 999999999);
        raise exception 'Expected error for unknown deal';
    exception
        when others then
            if sqlerrm not like '%deal not found%' then
                raise;
            end if;
    end;

    raise exception 'ROLLBACK_TEST_DATA' using errcode = 'P0001';
exception
    when others then
        if sqlerrm not like '%ROLLBACK_TEST_DATA%' then
            raise;
        end if;
end;
$$;

do $$
begin
    perform set_config('request.jwt.claim.sub', '', true);
    execute 'set local role anon';

    begin
        perform public.start_checklist_run_from_template('FENS_PRODUCTION_RELEASE', 1);
        raise exception 'anon must not execute start_checklist_run_from_template';
    exception
        when insufficient_privilege then
            null;
        when others then
            if sqlerrm not like '%permission denied%'
                and sqlerrm not like '%not authenticated%' then
                raise;
            end if;
    end;

    perform set_config('role', 'postgres', true);
    reset role;
end;
$$;

select 'checklists_start_run_verification: OK' as result;
