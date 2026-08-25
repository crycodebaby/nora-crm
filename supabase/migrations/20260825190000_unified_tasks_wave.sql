-- Nora CRM – Unified Tasks Wave
-- Additive/backfill migration. No remote apply in this commit.
--
-- Product decision (see docs/nora/06-decision-log.md, "2026-08-25 – Unified Tasks Wave"):
-- A task carries its own customer context (tasks.company_id), separate from
-- contacts.company_id. That context is set once (on create, or when the
-- task's contact/company context is deliberately changed) and is then
-- historically stable — it is NEVER re-derived automatically when the
-- linked contact is later reassigned to a different company.
--
-- Adds:
--   1. tasks.company_id (nullable) — historical customer context of a task.
--      tasks.contact_id becomes nullable, so a task may have company only,
--      contact only, or both. CHECK: at least one of the two must be set.
--   2. Backfill: existing tasks get company_id = contact.company_id where
--      the linked contact currently has a company. Tasks of unassigned
--      contacts stay company_id = null, contact_id unchanged.
--   3. tasks.contact_id FK changes from ON DELETE CASCADE to ON DELETE SET
--      NULL — deleting a contact must not delete a task that still has a
--      company context. A new BEFORE DELETE trigger on contacts removes
--      only the tasks that would otherwise become orphaned (no company and
--      no contact left), preserving today's behavior for those.
--   4. tasks.company_id FK: ON DELETE CASCADE (deleting a customer record
--      removes its customer-scoped tasks, consistent with contacts/deals).
--   5. nora_private.enforce_task_company_context() (BEFORE INSERT OR UPDATE
--      trigger): only runs when the task's context (contact_id/company_id)
--      is actually being set or changed — never on a routine field-only
--      update (text/due_date/done_date/type/sales_id). When contact_id is
--      set/changed: loads the contact's current company_id server-side and
--      either derives task.company_id from it (if not provided) or
--      validates the client-provided company_id matches it. Prevents a
--      client from combining company_id = A with a contact_id that belongs
--      to a different company B.
--   6. nora_private.delete_contact_only_tasks() (BEFORE DELETE trigger on
--      contacts) — see (3).
--   7. audit_task_changes extended to track company_id changes; audit_task_row
--      now reads the company context directly from tasks.company_id instead
--      of joining through contacts (more accurate: reflects the historical
--      context, not today's contact->company mapping).
--   8. merge_contacts: reassigning tasks from a merged-away contact to the
--      surviving contact is an identity consolidation, not a user-driven
--      context change — it explicitly opts out of the new context
--      validation via the nora.skip_task_context_check session flag, so a
--      merge cannot fail because of a stale historical company context.
--   9. Indexes: tasks(company_id), and a partial tasks(company_id, due_date)
--      index for open tasks, mirroring the existing contact_id/due_date
--      indexes.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

alter table public.tasks
    add column if not exists company_id bigint;

comment on column public.tasks.company_id is
    'Historical customer context of the task. Set on create (derived from contact_id''s company when not provided) or on a deliberate context change; never auto-synced when the linked contact later changes company. Nullable — a task may be contact-only.';

alter table public.tasks
    alter column contact_id drop not null;

comment on column public.tasks.contact_id is
    'Historical contact context of the task, nullable — a task may be company-only (e.g. "Rechnung prüfen"). At least one of company_id/contact_id must be set.';

-- ---------------------------------------------------------------------------
-- 2. Backfill (data migration, no data loss)
-- ---------------------------------------------------------------------------

update public.tasks t
set company_id = c.company_id
from public.contacts c
where t.contact_id = c.id
  and t.company_id is null
  and c.company_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Constraints
-- ---------------------------------------------------------------------------

alter table public.tasks
    add constraint tasks_company_id_fkey
        foreign key (company_id) references public.companies(id)
        on update cascade on delete cascade;

alter table public.tasks
    drop constraint if exists tasks_contact_id_fkey;

alter table public.tasks
    add constraint tasks_contact_id_fkey
        foreign key (contact_id) references public.contacts(id)
        on update cascade on delete set null;

alter table public.tasks
    add constraint tasks_company_or_contact_check
        check (company_id is not null or contact_id is not null);

-- ---------------------------------------------------------------------------
-- 4. Indexes
-- ---------------------------------------------------------------------------

create index if not exists tasks_company_id_idx
    on public.tasks (company_id);

create index if not exists tasks_company_id_due_date_open_idx
    on public.tasks (company_id, due_date)
    where done_date is null;

-- ---------------------------------------------------------------------------
-- 5. Context-validation trigger (historical semantic)
-- ---------------------------------------------------------------------------

create or replace function nora_private.enforce_task_company_context()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_contact_company_id bigint;
begin
    -- Routine field-only update (text/due_date/done_date/type/sales_id):
    -- the task's context is untouched, so its historical company_id must
    -- not be re-validated against the contact's *current* company.
    if tg_op = 'UPDATE'
       and new.contact_id is not distinct from old.contact_id
       and new.company_id is not distinct from old.company_id
    then
        return new;
    end if;

    -- Bulk identity-consolidation paths (contact merge) opt out explicitly;
    -- see merge_contacts().
    if coalesce(nullif(current_setting('nora.skip_task_context_check', true), ''), 'false') = 'true' then
        return new;
    end if;

    if new.contact_id is not null then
        select company_id into v_contact_company_id
        from public.contacts
        where id = new.contact_id;

        if not found then
            raise exception 'tasks.contact_id % does not reference an existing contact', new.contact_id
                using errcode = '23503';
        end if;

        if v_contact_company_id is not null then
            if new.company_id is null then
                new.company_id := v_contact_company_id;
            elsif new.company_id is distinct from v_contact_company_id then
                raise exception 'tasks.company_id (%) does not match the company of contact % (%)',
                    new.company_id, new.contact_id, v_contact_company_id
                    using errcode = '23514';
            end if;
        end if;
    end if;

    if new.company_id is null and new.contact_id is null then
        raise exception 'a task must have a company_id or a contact_id'
            using errcode = '23514';
    end if;

    return new;
end;
$$;

comment on function nora_private.enforce_task_company_context() is
    'Derives/validates tasks.company_id from the (server-loaded) contact.company_id whenever a task''s contact_id/company_id is set or changed. Skipped for routine field-only updates and for the explicit merge_contacts() bulk reassignment (nora.skip_task_context_check).';

create or replace trigger enforce_task_company_context_trigger
    before insert or update on public.tasks
    for each row execute function nora_private.enforce_task_company_context();

-- ---------------------------------------------------------------------------
-- 6. Contact delete: preserve company-scoped tasks, drop orphaned ones
-- ---------------------------------------------------------------------------

create or replace function nora_private.delete_contact_only_tasks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    -- Runs before the contact row (and the FK's ON DELETE SET NULL action)
    -- so that tasks with no company context are removed the same way a
    -- CASCADE would have removed them, while tasks that also carry a
    -- company_id survive with contact_id set to NULL by the FK action.
    delete from public.tasks
    where contact_id = old.id
      and company_id is null;

    return old;
end;
$$;

comment on function nora_private.delete_contact_only_tasks() is
    'Before a contact is deleted, deletes its tasks that have no company_id (would otherwise violate tasks_company_or_contact_check once contact_id is set to NULL by the FK action). Tasks with a company_id survive and keep that historical context.';

create or replace trigger delete_contact_only_tasks_before_contact_delete_trigger
    before delete on public.contacts
    for each row execute function nora_private.delete_contact_only_tasks();

-- ---------------------------------------------------------------------------
-- 7. Audit: track company_id, and use the task's own historical context
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION nora_private.audit_task_changes(
    p_old public.tasks,
    p_new public.tasks
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
    v jsonb := '{}'::jsonb;
    part jsonb;
BEGIN
    part := nora_private.audit_json_field(to_jsonb(p_old.text), to_jsonb(p_new.text), 'text');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('text', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.due_date), to_jsonb(p_new.due_date), 'due_date');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('due_date', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.done_date), to_jsonb(p_new.done_date), 'done_date');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('done_date', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.contact_id), to_jsonb(p_new.contact_id), 'contact_id');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('contact_id', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.company_id), to_jsonb(p_new.company_id), 'company_id');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('company_id', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.sales_id), to_jsonb(p_new.sales_id), 'sales_id');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('sales_id', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.type), to_jsonb(p_new.type), 'type');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('type', part); END IF;
    RETURN v;
END;
$$;

ALTER FUNCTION nora_private.audit_task_changes(public.tasks, public.tasks) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.audit_task_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_changes jsonb;
    v_event text;
BEGIN
    IF tg_op = 'INSERT' THEN
        PERFORM nora_private.write_audit_event(
            p_event_type := 'task.created',
            p_entity_type := 'task',
            p_entity_id := public.nora_entity_uuid('task', new.id),
            p_company_id := new.company_id,
            p_contact_id := new.contact_id,
            p_task_id := new.id
        );
        RETURN new;
    END IF;

    IF tg_op = 'UPDATE' THEN
        IF old.done_date IS NULL AND new.done_date IS NOT NULL THEN
            v_event := 'task.completed';
        ELSIF old.done_date IS NOT NULL AND new.done_date IS NULL THEN
            v_event := 'task.reopened';
        ELSE
            v_event := 'task.updated';
        END IF;

        v_changes := nora_private.audit_task_changes(old, new);
        IF v_event = 'task.updated' AND v_changes = '{}'::jsonb THEN
            RETURN new;
        END IF;

        PERFORM nora_private.write_audit_event(
            p_event_type := v_event,
            p_entity_type := 'task',
            p_entity_id := public.nora_entity_uuid('task', new.id),
            p_company_id := new.company_id,
            p_contact_id := new.contact_id,
            p_task_id := new.id,
            p_changes := CASE WHEN v_event = 'task.updated' THEN v_changes ELSE null END
        );
        RETURN new;
    END IF;

    IF tg_op = 'DELETE' THEN
        PERFORM nora_private.write_audit_event(
            p_event_type := 'task.deleted',
            p_entity_type := 'task',
            p_entity_id := public.nora_entity_uuid('task', old.id),
            p_company_id := old.company_id,
            p_contact_id := old.contact_id,
            p_task_id := old.id,
            p_retention_class := 'security'
        );
        RETURN old;
    END IF;

    RETURN coalesce(new, old);
END;
$$;

ALTER FUNCTION public.audit_task_row() OWNER TO postgres;

-- ---------------------------------------------------------------------------
-- 8. merge_contacts: opt out of context validation for the bulk reassignment
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."merge_contacts"("loser_id" bigint, "winner_id" bigint) RETURNS bigint
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  winner_contact contacts%ROWTYPE;
  loser_contact contacts%ROWTYPE;
  deal_record RECORD;
  merged_emails jsonb;
  merged_phones jsonb;
  merged_tags bigint[];
  winner_emails jsonb;
  loser_emails jsonb;
  winner_phones jsonb;
  loser_phones jsonb;
  email_map jsonb;
  phone_map jsonb;
BEGIN
  -- Fetch both contacts
  SELECT * INTO winner_contact FROM contacts WHERE id = winner_id;
  SELECT * INTO loser_contact FROM contacts WHERE id = loser_id;

  IF winner_contact IS NULL OR loser_contact IS NULL THEN
    RAISE EXCEPTION 'Contact not found';
  END IF;

  -- 1. Reassign tasks from loser to winner. This is identity consolidation
  --    (the two rows represent the same real contact), not a user picking a
  --    different contact for a task — so it must not re-validate/derive
  --    tasks.company_id against the winner's current company. A task's
  --    historical company context survives the merge unchanged.
  PERFORM set_config('nora.skip_task_context_check', 'true', true);
  UPDATE tasks SET contact_id = winner_id WHERE contact_id = loser_id;
  PERFORM set_config('nora.skip_task_context_check', '', true);

  -- 2. Reassign contact notes from loser to winner
  UPDATE contact_notes SET contact_id = winner_id WHERE contact_id = loser_id;

  -- 3. Update deals - replace loser with winner in contact_ids array
  FOR deal_record IN
    SELECT id, contact_ids
    FROM deals
    WHERE contact_ids @> ARRAY[loser_id]
  LOOP
    UPDATE deals
    SET contact_ids = (
      SELECT ARRAY(
        SELECT DISTINCT unnest(
          array_remove(deal_record.contact_ids, loser_id) || ARRAY[winner_id]
        )
      )
    )
    WHERE id = deal_record.id;
  END LOOP;

  -- 4. Merge contact data

  -- Get email arrays
  winner_emails := COALESCE(winner_contact.email_jsonb, '[]'::jsonb);
  loser_emails := COALESCE(loser_contact.email_jsonb, '[]'::jsonb);

  -- Merge emails with deduplication by email address
  -- Build a map of email -> email object, then convert back to array
  email_map := '{}'::jsonb;

  -- Add winner emails to map
  IF jsonb_array_length(winner_emails) > 0 THEN
    FOR i IN 0..jsonb_array_length(winner_emails)-1 LOOP
      email_map := email_map || jsonb_build_object(
        winner_emails->i->>'email',
        winner_emails->i
      );
    END LOOP;
  END IF;

  -- Add loser emails to map (won't overwrite existing keys)
  IF jsonb_array_length(loser_emails) > 0 THEN
    FOR i IN 0..jsonb_array_length(loser_emails)-1 LOOP
      IF NOT email_map ? (loser_emails->i->>'email') THEN
        email_map := email_map || jsonb_build_object(
          loser_emails->i->>'email',
          loser_emails->i
        );
      END IF;
    END LOOP;
  END IF;

  -- Convert map back to array
  merged_emails := (SELECT jsonb_agg(value) FROM jsonb_each(email_map));
  merged_emails := COALESCE(merged_emails, '[]'::jsonb);

  -- Get phone arrays
  winner_phones := COALESCE(winner_contact.phone_jsonb, '[]'::jsonb);
  loser_phones := COALESCE(loser_contact.phone_jsonb, '[]'::jsonb);

  -- Merge phones with deduplication by number
  phone_map := '{}'::jsonb;

  -- Add winner phones to map
  IF jsonb_array_length(winner_phones) > 0 THEN
    FOR i IN 0..jsonb_array_length(winner_phones)-1 LOOP
      phone_map := phone_map || jsonb_build_object(
        winner_phones->i->>'number',
        winner_phones->i
      );
    END LOOP;
  END IF;

  -- Add loser phones to map (won't overwrite existing keys)
  IF jsonb_array_length(loser_phones) > 0 THEN
    FOR i IN 0..jsonb_array_length(loser_phones)-1 LOOP
      IF NOT phone_map ? (loser_phones->i->>'number') THEN
        phone_map := phone_map || jsonb_build_object(
          loser_phones->i->>'number',
          loser_phones->i
        );
      END IF;
    END LOOP;
  END IF;

  -- Convert map back to array
  merged_phones := (SELECT jsonb_agg(value) FROM jsonb_each(phone_map));
  merged_phones := COALESCE(merged_phones, '[]'::jsonb);

  -- Merge tags (remove duplicates)
  merged_tags := ARRAY(
    SELECT DISTINCT unnest(
      COALESCE(winner_contact.tags, ARRAY[]::bigint[]) ||
      COALESCE(loser_contact.tags, ARRAY[]::bigint[])
    )
  );

  -- 5. Update winner with merged data
  UPDATE contacts SET
    avatar = COALESCE(winner_contact.avatar, loser_contact.avatar),
    gender = COALESCE(winner_contact.gender, loser_contact.gender),
    first_name = COALESCE(winner_contact.first_name, loser_contact.first_name),
    last_name = COALESCE(winner_contact.last_name, loser_contact.last_name),
    title = COALESCE(winner_contact.title, loser_contact.title),
    company_id = COALESCE(winner_contact.company_id, loser_contact.company_id),
    email_jsonb = merged_emails,
    phone_jsonb = merged_phones,
    linkedin_url = COALESCE(winner_contact.linkedin_url, loser_contact.linkedin_url),
    background = COALESCE(winner_contact.background, loser_contact.background),
    has_newsletter = COALESCE(winner_contact.has_newsletter, loser_contact.has_newsletter),
    first_seen = LEAST(COALESCE(winner_contact.first_seen, loser_contact.first_seen), COALESCE(loser_contact.first_seen, winner_contact.first_seen)),
    last_seen = GREATEST(COALESCE(winner_contact.last_seen, loser_contact.last_seen), COALESCE(loser_contact.last_seen, winner_contact.last_seen)),
    sales_id = COALESCE(winner_contact.sales_id, loser_contact.sales_id),
    tags = merged_tags
  WHERE id = winner_id;

  -- 6. Delete loser contact
  DELETE FROM contacts WHERE id = loser_id;

  RETURN winner_id;
END;
$$;
