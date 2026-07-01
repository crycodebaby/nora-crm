-- Nora CRM v0.3d3: Atomarer Checklisten-Start aus Vorlage
-- Spezifikation: docs/nora/10-checklists-snippets-audit.md

create or replace function public.start_checklist_run_from_template(
    p_template_code text,
    p_deal_id bigint,
    p_contact_id bigint default null
)
returns uuid
language plpgsql
security definer
set search_path to public
as $$
declare
    v_template public.checklist_templates%rowtype;
    v_deal public.deals%rowtype;
    v_run_id uuid;
    v_active_items int;
    v_lock_key1 int;
    v_lock_key2 int;
begin
    if auth.uid() is null then
        raise exception 'not authenticated'
            using errcode = '28000';
    end if;

    select *
    into v_template
    from public.checklist_templates
    where code = p_template_code;

    if not found then
        raise exception 'checklist template not found: %', p_template_code
            using errcode = 'P0002';
    end if;

    if not v_template.is_active then
        raise exception 'checklist template is inactive: %', p_template_code
            using errcode = 'P0001';
    end if;

    select *
    into v_deal
    from public.deals
    where id = p_deal_id;

    if not found then
        raise exception 'deal not found: %', p_deal_id
            using errcode = 'P0002';
    end if;

    if p_contact_id is not null then
        if not exists (
            select 1 from public.contacts c where c.id = p_contact_id
        ) then
            raise exception 'contact not found: %', p_contact_id
                using errcode = 'P0002';
        end if;

        if not exists (
            select 1
            from public.contacts c
            where c.id = p_contact_id
              and (
                  (v_deal.contact_ids is not null and p_contact_id = any (v_deal.contact_ids))
                  or (v_deal.company_id is not null and c.company_id = v_deal.company_id)
              )
        ) then
            raise exception 'contact % is not linked to deal %', p_contact_id, p_deal_id
                using errcode = 'P0001';
        end if;
    end if;

    select count(*)::int
    into v_active_items
    from public.checklist_template_items i
    where i.template_id = v_template.id
      and i.is_active = true;

    if v_active_items = 0 then
        raise exception 'checklist template has no active items: %', p_template_code
            using errcode = 'P0001';
    end if;

    v_lock_key1 := hashtext('nora_checklist_run');
    v_lock_key2 := hashtext(p_deal_id::text || ':' || v_template.id::text);
    perform pg_advisory_xact_lock(v_lock_key1, v_lock_key2);

    select r.id
    into v_run_id
    from public.checklist_runs r
    where r.deal_id = p_deal_id
      and r.template_id = v_template.id
      and r.status = 'open'
    limit 1;

    if v_run_id is not null then
        return v_run_id;
    end if;

    begin
        insert into public.checklist_runs (
            template_id,
            deal_id,
            company_id,
            contact_id,
            service_area_code,
            status,
            started_by
        )
        values (
            v_template.id,
            p_deal_id,
            v_deal.company_id,
            p_contact_id,
            v_template.service_area_code,
            'open',
            auth.uid()
        )
        returning id into v_run_id;

        insert into public.checklist_run_items (
            checklist_run_id,
            template_item_id,
            label_snapshot,
            is_required,
            sort_index
        )
        select
            v_run_id,
            i.id,
            i.label,
            i.is_required,
            i.sort_index
        from public.checklist_template_items i
        where i.template_id = v_template.id
          and i.is_active = true
        order by i.sort_index, i.id;

        return v_run_id;
    exception
        when unique_violation then
            select r.id
            into v_run_id
            from public.checklist_runs r
            where r.deal_id = p_deal_id
              and r.template_id = v_template.id
              and r.status = 'open'
            limit 1;

            if v_run_id is null then
                raise;
            end if;

            return v_run_id;
    end;
end;
$$;

comment on function public.start_checklist_run_from_template(text, bigint, bigint) is
    'Starts an open checklist run from an active template for a deal. Idempotent: returns existing open run. Copies active template items with label_snapshot. Audit via checklist_runs INSERT trigger.';

revoke all on function public.start_checklist_run_from_template(text, bigint, bigint) from public;
revoke all on function public.start_checklist_run_from_template(text, bigint, bigint) from anon;
grant execute on function public.start_checklist_run_from_template(text, bigint, bigint) to authenticated;
grant execute on function public.start_checklist_run_from_template(text, bigint, bigint) to service_role;
