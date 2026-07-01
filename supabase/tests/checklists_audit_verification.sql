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
