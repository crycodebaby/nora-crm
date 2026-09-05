-- Nora User Lifecycle W2 hardening (2026-09-05): active assignment is
-- authoritative below the UI.
--
-- Rule: a disabled employee may stay referenced by EXISTING records (history),
-- but may NOT be newly assigned as the responsible employee. The UI pickers
-- already exclude disabled employees (sales_directory); this trigger makes
-- the rule hold for every writer (PostgREST, service_role, SQL).
--
-- Covered (current responsibility):  companies.sales_id, contacts.sales_id,
--                                    deals.sales_id, tasks.sales_id
-- Deliberately NOT covered (historical authorship, never re-assigned by the
-- product): contact_notes.sales_id, deal_notes.sales_id.
--
-- Semantics: fires on INSERT and on UPDATE OF sales_id, and only rejects when
-- the value is set/changed to a disabled employee. An unrelated update of a
-- record that is still owned by a since-disabled employee stays allowed
-- (the trigger is not attached to other columns, and an unchanged sales_id
-- returns early). Moving away from a disabled employee is allowed.
--
-- Error contract: DETAIL = NORA_EMPLOYEE_NOT_ASSIGNABLE (MESSAGE free text).
-- A nonexistent employee id is left to the foreign key (23503).

create or replace function nora_private.guard_active_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_disabled boolean;
begin
    if new.sales_id is null then
        return new;
    end if;
    if tg_op = 'UPDATE' and new.sales_id is not distinct from old.sales_id then
        return new;
    end if;

    select s.disabled into v_disabled
    from public.sales s
    where s.id = new.sales_id;

    if v_disabled then
        raise exception 'Dieser Mitarbeiter ist deaktiviert und kann nicht neu zugewiesen werden'
            using errcode = '23514', detail = 'NORA_EMPLOYEE_NOT_ASSIGNABLE';
    end if;

    return new;
end;
$$;

alter function nora_private.guard_active_assignment() owner to postgres;

comment on function nora_private.guard_active_assignment() is
    'W2: refuses INSERT / UPDATE OF sales_id that newly assigns a disabled employee on companies, contacts, deals, tasks. Existing references and unrelated updates stay allowed. DETAIL = NORA_EMPLOYEE_NOT_ASSIGNABLE. SECURITY DEFINER so it can read sales.disabled regardless of the caller''s sales RLS.';

revoke all on function nora_private.guard_active_assignment() from public;
revoke all on function nora_private.guard_active_assignment() from anon;
revoke all on function nora_private.guard_active_assignment() from authenticated;
revoke all on function nora_private.guard_active_assignment() from service_role;

drop trigger if exists guard_active_assignment_trigger on public.companies;
create trigger guard_active_assignment_trigger
    before insert or update of sales_id on public.companies
    for each row execute function nora_private.guard_active_assignment();

drop trigger if exists guard_active_assignment_trigger on public.contacts;
create trigger guard_active_assignment_trigger
    before insert or update of sales_id on public.contacts
    for each row execute function nora_private.guard_active_assignment();

drop trigger if exists guard_active_assignment_trigger on public.deals;
create trigger guard_active_assignment_trigger
    before insert or update of sales_id on public.deals
    for each row execute function nora_private.guard_active_assignment();

drop trigger if exists guard_active_assignment_trigger on public.tasks;
create trigger guard_active_assignment_trigger
    before insert or update of sales_id on public.tasks
    for each row execute function nora_private.guard_active_assignment();

do $$
declare
    v_tbl text;
begin
    foreach v_tbl in array array['companies', 'contacts', 'deals', 'tasks']
    loop
        if not exists (
            select 1 from pg_trigger
            where tgrelid = ('public.' || v_tbl)::regclass
              and tgname = 'guard_active_assignment_trigger'
              and tgenabled <> 'D'
        ) then
            raise exception 'W2: guard_active_assignment_trigger missing on %', v_tbl;
        end if;
    end loop;
    if exists (
        select 1 from pg_trigger
        where tgrelid in ('public.contact_notes'::regclass, 'public.deal_notes'::regclass)
          and tgname = 'guard_active_assignment_trigger'
    ) then
        raise exception 'W2: historical authorship tables must not carry the assignment guard';
    end if;
end;
$$;
