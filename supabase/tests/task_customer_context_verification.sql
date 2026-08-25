-- Nora CRM Unified Tasks Wave verification — run after: npx supabase db reset --local
-- Usage: psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/task_customer_context_verification.sql
-- (or: docker exec supabase_db_atomic-crm-demo psql -U postgres -d postgres -f - < this file)

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1. Schema shape
-- ---------------------------------------------------------------------------
do $$
begin
    if not exists (
        select 1 from information_schema.columns
        where table_name = 'tasks' and column_name = 'company_id'
    ) then
        raise exception 'tasks.company_id missing';
    end if;

    if exists (
        select 1 from information_schema.columns
        where table_name = 'tasks' and column_name = 'contact_id' and is_nullable = 'NO'
    ) then
        raise exception 'tasks.contact_id must be nullable';
    end if;

    if not exists (
        select 1 from pg_constraint where conname = 'tasks_company_or_contact_check'
    ) then
        raise exception 'tasks_company_or_contact_check missing';
    end if;

    if not exists (
        select 1 from pg_constraint c
        join pg_class t on t.oid = c.conrelid
        where t.relname = 'tasks' and c.conname = 'tasks_company_id_fkey'
          and c.confdeltype = 'c' -- cascade
    ) then
        raise exception 'tasks_company_id_fkey must be ON DELETE CASCADE';
    end if;

    if not exists (
        select 1 from pg_constraint c
        join pg_class t on t.oid = c.conrelid
        where t.relname = 'tasks' and c.conname = 'tasks_contact_id_fkey'
          and c.confdeltype = 'n' -- set null
    ) then
        raise exception 'tasks_contact_id_fkey must be ON DELETE SET NULL';
    end if;

    if not exists (select 1 from pg_indexes where indexname = 'tasks_company_id_idx') then
        raise exception 'tasks_company_id_idx missing';
    end if;

    if not exists (select 1 from pg_indexes where indexname = 'tasks_company_id_due_date_open_idx') then
        raise exception 'tasks_company_id_due_date_open_idx missing';
    end if;

    if not exists (
        select 1 from pg_trigger where tgname = 'enforce_task_company_context_trigger'
    ) then
        raise exception 'enforce_task_company_context_trigger missing';
    end if;

    if not exists (
        select 1 from pg_trigger where tgname = 'delete_contact_only_tasks_before_contact_delete_trigger'
    ) then
        raise exception 'delete_contact_only_tasks_before_contact_delete_trigger missing';
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Fixtures + behavioral tests as an authenticated office user
-- ---------------------------------------------------------------------------
do $$
declare
    v_office_user uuid := 'a0000000-0000-4000-8000-000000000198';
    v_admin_user uuid := 'a0000000-0000-4000-8000-000000000199';
    v_viewer_user uuid := 'a0000000-0000-4000-8000-000000000197';
    v_office_sale_id bigint;
    v_admin_sale_id bigint;
    v_viewer_sale_id bigint;

    v_company_a bigint;
    v_company_b bigint;
    v_company_c bigint;
    v_company_throwaway bigint;
    v_contact_x bigint; -- belongs to company A
    v_contact_y bigint; -- belongs to company B
    v_contact_z bigint; -- unassigned
    v_contact_loser bigint;
    v_contact_winner bigint;

    v_task_id bigint;
    v_task_company_only bigint;
    v_task_contact_only bigint;
    v_task_both bigint;
    v_task_orphan_candidate bigint;
    v_task_survivor bigint;
    v_task_throwaway bigint;
    v_task_loser bigint;

    v_before_count bigint;
    v_after_count bigint;
    v_company_id bigint;
    v_contact_id bigint;
    v_failed boolean;
    v_error_msg text;
begin
    -- Fixture: office + admin + viewer auth users / sales rows
    insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        recovery_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
    )
    values
        ('00000000-0000-0000-0000-000000000000', v_office_user, 'authenticated', 'authenticated',
         'task-context-office@nora.test', crypt('password', gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
        ('00000000-0000-0000-0000-000000000000', v_admin_user, 'authenticated', 'authenticated',
         'task-context-admin@nora.test', crypt('password', gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
        ('00000000-0000-0000-0000-000000000000', v_viewer_user, 'authenticated', 'authenticated',
         'task-context-viewer@nora.test', crypt('password', gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '')
    on conflict (id) do nothing;

    begin
        insert into public.sales (first_name, last_name, email, user_id, role, administrator, disabled)
        values ('Office', 'TaskTester', 'task-context-office@nora.test', v_office_user, 'office', false, false)
        returning id into v_office_sale_id;
    exception
        when unique_violation then
            select id into v_office_sale_id from public.sales where user_id = v_office_user;
            perform nora_private.apply_sales_role_change(v_office_sale_id, 'office', false);
    end;

    begin
        insert into public.sales (first_name, last_name, email, user_id, role, administrator, disabled)
        values ('Admin', 'TaskTester', 'task-context-admin@nora.test', v_admin_user, 'admin', true, false)
        returning id into v_admin_sale_id;
    exception
        when unique_violation then
            select id into v_admin_sale_id from public.sales where user_id = v_admin_user;
            perform nora_private.apply_sales_role_change(v_admin_sale_id, 'admin', false);
    end;

    begin
        insert into public.sales (first_name, last_name, email, user_id, role, administrator, disabled)
        values ('Viewer', 'TaskTester', 'task-context-viewer@nora.test', v_viewer_user, 'viewer', false, false)
        returning id into v_viewer_sale_id;
    exception
        when unique_violation then
            select id into v_viewer_sale_id from public.sales where user_id = v_viewer_user;
            perform nora_private.apply_sales_role_change(v_viewer_sale_id, 'viewer', false);
    end;

    -- Act as office for fixture/company/contact setup
    perform set_config('request.jwt.claim.sub', v_office_user::text, true);
    execute 'set local role authenticated';

    insert into public.companies (name, sales_id) values ('Traum und Horror UG', v_office_sale_id) returning id into v_company_a;
    insert into public.companies (name, sales_id) values ('Kunde B GmbH', v_office_sale_id) returning id into v_company_b;
    insert into public.companies (name, sales_id) values ('Kunde C GmbH', v_office_sale_id) returning id into v_company_c;
    insert into public.companies (name, sales_id) values ('Throwaway GmbH', v_office_sale_id) returning id into v_company_throwaway;

    insert into public.contacts (first_name, last_name, company_id, sales_id) values ('Freddie', 'Krueger', v_company_a, v_office_sale_id) returning id into v_contact_x;
    insert into public.contacts (first_name, last_name, company_id, sales_id) values ('Yara', 'Yilmaz', v_company_b, v_office_sale_id) returning id into v_contact_y;
    insert into public.contacts (first_name, last_name, company_id, sales_id) values ('Zoe', 'Ziegler', null, v_office_sale_id) returning id into v_contact_z;

    -- -----------------------------------------------------------------------
    -- 2a. Company + contact: company_id auto-derived from contact_id
    -- -----------------------------------------------------------------------
    insert into public.tasks (text, due_date, contact_id, sales_id)
    values ('Angebot mit Freddie nachfassen', now(), v_contact_x, v_office_sale_id)
    returning id into v_task_both;

    select company_id into v_company_id from public.tasks where id = v_task_both;
    if v_company_id <> v_company_a then
        raise exception 'company_id was not derived from contact.company_id: got %, expected %', v_company_id, v_company_a;
    end if;

    -- -----------------------------------------------------------------------
    -- 2b. Company only (no contact) — regular business state
    -- -----------------------------------------------------------------------
    insert into public.tasks (text, due_date, company_id, sales_id)
    values ('Rechnung prüfen', now(), v_company_a, v_office_sale_id)
    returning id into v_task_company_only;

    if (select contact_id from public.tasks where id = v_task_company_only) is not null then
        raise exception 'company-only task must not have a contact_id';
    end if;

    -- -----------------------------------------------------------------------
    -- 2c. Contact only, contact has no company — still valid
    -- -----------------------------------------------------------------------
    insert into public.tasks (text, due_date, contact_id, sales_id)
    values ('Zoe zurückrufen', now(), v_contact_z, v_office_sale_id)
    returning id into v_task_contact_only;

    if (select company_id from public.tasks where id = v_task_contact_only) is not null then
        raise exception 'task of an unassigned contact must not get a company_id';
    end if;

    -- -----------------------------------------------------------------------
    -- 2d. Neither company nor contact — rejected
    -- -----------------------------------------------------------------------
    v_failed := false;
    begin
        insert into public.tasks (text, due_date, sales_id) values ('Invalid', now(), v_office_sale_id);
    exception
        when check_violation or others then
            v_failed := true;
    end;
    if not v_failed then
        raise exception 'a task with neither company_id nor contact_id must be rejected';
    end if;

    -- -----------------------------------------------------------------------
    -- 2e. Wrong combination on INSERT: company A + contact from company B
    -- -----------------------------------------------------------------------
    v_failed := false;
    begin
        insert into public.tasks (text, due_date, company_id, contact_id, sales_id)
        values ('Mismatch', now(), v_company_a, v_contact_y, v_office_sale_id);
    exception
        when others then
            v_failed := true;
    end;
    if not v_failed then
        raise exception 'a task combining company A with a contact of company B must be rejected on INSERT';
    end if;

    -- -----------------------------------------------------------------------
    -- 2f. Wrong combination on UPDATE: reassigning contact_id to a mismatched company
    -- -----------------------------------------------------------------------
    v_failed := false;
    begin
        update public.tasks set contact_id = v_contact_y where id = v_task_company_only; -- company_id stays A
    exception
        when others then
            v_failed := true;
    end;
    if not v_failed then
        raise exception 'changing contact_id to a contact of a different company than task.company_id must be rejected';
    end if;

    -- -----------------------------------------------------------------------
    -- 3. Historical semantic: contact moves to another company afterwards
    -- -----------------------------------------------------------------------
    update public.contacts set company_id = v_company_b where id = v_contact_x;

    select company_id, contact_id into v_company_id, v_contact_id from public.tasks where id = v_task_both;
    if v_company_id <> v_company_a or v_contact_id <> v_contact_x then
        raise exception 'historical task context must stay at company A / contact X after the contact moved, got company=% contact=%', v_company_id, v_contact_id;
    end if;

    -- Normal field-only update after the contact moved must still work
    update public.tasks set text = 'Angebot mit Freddie nachfassen (aktualisiert)' where id = v_task_both;
    update public.tasks set done_date = now() where id = v_task_both;
    update public.tasks set done_date = null where id = v_task_both;

    select company_id, contact_id into v_company_id, v_contact_id from public.tasks where id = v_task_both;
    if v_company_id <> v_company_a or v_contact_id <> v_contact_x then
        raise exception 'routine field update must not touch the historical task context';
    end if;

    -- put contact X back for the rest of the test
    update public.contacts set company_id = v_company_a where id = v_contact_x;

    -- -----------------------------------------------------------------------
    -- 4. Contact delete semantics
    -- -----------------------------------------------------------------------
    -- Deleting contacts/companies is admin-only (existing "Contacts delete
    -- admin" / "Companies delete admin" policies) — switch role for 4-6.
    perform set_config('request.jwt.claim.sub', v_admin_user::text, true);
    execute 'set local role authenticated';

    -- 4a. Contact-only task (no company) must be deleted along with the contact
    v_before_count := (select count(*) from public.tasks where contact_id = v_contact_z);
    if v_before_count <> 1 then
        raise exception 'expected exactly 1 fixture task for contact Z, got %', v_before_count;
    end if;

    delete from public.contacts where id = v_contact_z;

    if exists (select 1 from public.tasks where id = v_task_contact_only) then
        raise exception 'contact-only task must be deleted when its unassigned contact is deleted';
    end if;

    -- 4b. Task with company_id + contact_id survives contact delete, contact_id -> NULL
    delete from public.contacts where id = v_contact_x;

    select company_id, contact_id into v_company_id, v_contact_id from public.tasks where id = v_task_both;
    if v_company_id is distinct from v_company_a then
        raise exception 'task.company_id must survive the contact delete, got %', v_company_id;
    end if;
    if v_contact_id is not null then
        raise exception 'task.contact_id must become NULL after the contact is deleted, got %', v_contact_id;
    end if;

    -- -----------------------------------------------------------------------
    -- 5. Company delete semantics: company-scoped task cascades away
    -- -----------------------------------------------------------------------
    insert into public.tasks (text, due_date, company_id, sales_id)
    values ('Throwaway task', now(), v_company_throwaway, v_office_sale_id)
    returning id into v_task_throwaway;

    delete from public.companies where id = v_company_throwaway;

    if exists (select 1 from public.tasks where id = v_task_throwaway) then
        raise exception 'a company-scoped task must be deleted when its company is deleted (ON DELETE CASCADE)';
    end if;

    -- -----------------------------------------------------------------------
    -- 6. merge_contacts: historical company context survives the merge
    -- -----------------------------------------------------------------------
    insert into public.contacts (first_name, last_name, company_id, sales_id) values ('Loser', 'Contact', v_company_b, v_office_sale_id) returning id into v_contact_loser;
    insert into public.contacts (first_name, last_name, company_id, sales_id) values ('Winner', 'Contact', v_company_c, v_office_sale_id) returning id into v_contact_winner;

    -- Task historically tied to company A even though the loser contact is on company B today
    insert into public.tasks (text, due_date, company_id, contact_id, sales_id)
    values ('Historical task on loser contact', now(), v_company_a, null, v_office_sale_id)
    returning id into v_task_loser;
    -- Set contact_id directly at the SQL level, bypassing the normal insert-time
    -- derivation, to simulate a pre-existing historical mismatch the merge must tolerate.
    perform set_config('nora.skip_task_context_check', 'true', true);
    update public.tasks set contact_id = v_contact_loser where id = v_task_loser;
    perform set_config('nora.skip_task_context_check', '', true);

    perform public.merge_contacts(v_contact_loser, v_contact_winner);

    select company_id, contact_id into v_company_id, v_contact_id from public.tasks where id = v_task_loser;
    if v_contact_id <> v_contact_winner then
        raise exception 'merge_contacts must reassign contact_id to the winner, got %', v_contact_id;
    end if;
    if v_company_id is distinct from v_company_a then
        raise exception 'merge_contacts must not touch the task''s historical company_id, got % expected %', v_company_id, v_company_a;
    end if;

    if exists (select 1 from public.contacts where id = v_contact_loser) then
        raise exception 'merge_contacts must delete the loser contact';
    end if;

    -- -----------------------------------------------------------------------
    -- 7. Roles
    -- -----------------------------------------------------------------------
    -- viewer must not be able to write tasks
    perform set_config('request.jwt.claim.sub', v_viewer_user::text, true);
    execute 'set local role authenticated';

    v_failed := false;
    begin
        insert into public.tasks (text, due_date, company_id, sales_id)
        values ('Viewer should not create', now(), v_company_a, v_viewer_sale_id);
    exception
        when others then
            v_failed := true;
    end;
    if not v_failed then
        raise exception 'viewer role was able to insert a task — RLS gate is broken';
    end if;

    -- office can write (already exercised above) and cannot delete (existing "Tasks delete admin" policy)
    perform set_config('request.jwt.claim.sub', v_office_user::text, true);
    execute 'set local role authenticated';

    -- RLS silently filters out rows the policy denies for DELETE (0 rows
    -- affected, no exception) — assert the row survives, not that an
    -- exception was raised.
    delete from public.tasks where id = v_task_company_only;
    if not exists (select 1 from public.tasks where id = v_task_company_only) then
        raise exception 'office role was able to delete a task — existing "Tasks delete admin" policy is broken';
    end if;

    -- admin can delete
    perform set_config('request.jwt.claim.sub', v_admin_user::text, true);
    execute 'set local role authenticated';

    delete from public.tasks where id = v_task_company_only;
    if exists (select 1 from public.tasks where id = v_task_company_only) then
        raise exception 'admin role must be able to delete a task';
    end if;

    raise notice 'task_customer_context_verification: all checks passed';
end;
$$;
