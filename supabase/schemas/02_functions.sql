--
-- Functions
-- This file declares all PL/pgSQL functions in the public schema.
--

CREATE OR REPLACE FUNCTION "public"."get_avatar_for_email"("email" "text") RETURNS "text"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare email_hash text;
declare gravatar_url text;
declare gravatar_status int8;
declare email_domain text;

begin
    -- Try to fetch a gravatar image
    email_hash = encode(extensions.digest(email, 'sha256'), 'hex');
    gravatar_url = concat('https://www.gravatar.com/avatar/', email_hash, '?d=404');

    select status from extensions.http_get(gravatar_url) into gravatar_status;

    if gravatar_status = 200 then
        return gravatar_url;
    end if;

    -- Fallback to email's domain favicon if not excluded
    email_domain = split_part(email, '@', 2);
    return get_domain_favicon(email_domain);
exception
    when others then
        return 'ERROR';
end;
$$;

CREATE OR REPLACE FUNCTION "public"."get_domain_favicon"("domain_name" "text") RETURNS "text"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
    if exists (select from favicons_excluded_domains as fav where fav.domain = domain_name) then
        return null;
    end if;

    return concat(
        'https://favicon.show/',
        (regexp_matches(domain_name, '^(?:https?:\/\/)?(?:[^@\/\n]+@)?(?:www\.)?([^:\/?\n]+)', 'i'))[1]
    );
end;
$$;

CREATE OR REPLACE FUNCTION "public"."get_user_id_by_email"("email" "text") RETURNS TABLE("id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
BEGIN
  RETURN QUERY SELECT au.id FROM auth.users au WHERE au.email = $1;
END;
$_$;

CREATE OR REPLACE FUNCTION "public"."handle_company_saved"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare company_logo text;

begin
    if new.logo is not null then
        return new;
    end if;

    company_logo = get_domain_favicon(new.website);
    if company_logo is null then
        return new;
    end if;

    new.logo = concat('{"src":"', company_logo, '","title":"Company favicon"}');
    return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."handle_contact_note_created_or_updated"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  update public.contacts set last_seen = new.date where contacts.id = new.contact_id and contacts.last_seen < new.date;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."handle_contact_saved"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$declare contact_avatar text;
declare emails_length int8;
declare item jsonb;

begin
    if new.avatar is not null then
        return new;
    end if;

    select coalesce(jsonb_array_length(new.email_jsonb), 0) into emails_length;

    if emails_length = 0 then
        return new;
    end if;

    for item in select jsonb_array_elements(new.email_jsonb)
    loop
        select public.get_avatar_for_email(item->>'email') into contact_avatar;
        if (contact_avatar is not null) then
            exit;
        end if;
    end loop;

    if contact_avatar is null then
        return new;
    end if;

    new.avatar = concat('{"src":"', contact_avatar, '"}');
    return new;
end;$$;

CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_role text;
begin
  v_role := nora_private.resolve_first_signup_role();

  insert into public.sales (first_name, last_name, email, user_id, role, administrator)
  values (
    coalesce(new.raw_user_meta_data ->> 'first_name', new.raw_user_meta_data -> 'custom_claims' ->> 'first_name', 'Pending'),
    coalesce(new.raw_user_meta_data ->> 'last_name', new.raw_user_meta_data -> 'custom_claims' ->> 'last_name', 'Pending'),
    new.email,
    new.id,
    v_role,
    (v_role = 'admin')
  );
  return new;
end;
$$;

create or replace function public.handle_update_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.sales
  set
    first_name = coalesce(new.raw_user_meta_data ->> 'first_name', new.raw_user_meta_data -> 'custom_claims' ->> 'first_name', 'Pending'),
    last_name = coalesce(new.raw_user_meta_data ->> 'last_name', new.raw_user_meta_data -> 'custom_claims' ->> 'last_name', 'Pending')
  where user_id = new.id;

  return new;
end;
$$;

-- v0.4b.1: is_admin() moved to nora_private.is_admin() — not exposed in public schema.
-- Public RPCs: set_sales_access_by_executor (service_role only), start_checklist_run_from_template.

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

  -- 1b. Preserve self_contact_id: if the loser was the representing person
  --     of one or more customer records, the winner takes over that role —
  --     otherwise the merge would silently orphan the name-sync anchor.
  UPDATE companies SET self_contact_id = winner_id WHERE self_contact_id = loser_id;

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

  -- 6. Delete loser contact (self_contact_id already repointed in step 1b,
  --    so guard_self_contact_delete() no longer blocks this)
  DELETE FROM contacts WHERE id = loser_id;

  RETURN winner_id;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."lowercase_email_jsonb"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.email_jsonb IS NOT NULL THEN
    NEW.email_jsonb = COALESCE((
      SELECT jsonb_agg(
        jsonb_set(elem, '{email}', to_jsonb(LOWER(elem->>'email')))
      )
      FROM jsonb_array_elements(NEW.email_jsonb) AS elem
    ), '[]'::jsonb);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."set_sales_id_default"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.sales_id IS NULL THEN
    SELECT id INTO NEW.sales_id FROM sales WHERE user_id = auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."format_customer_number"(seq bigint) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
    select 'KD-' || lpad(seq::text, 6, '0');
$$;

CREATE OR REPLACE FUNCTION "public"."format_case_number"(p_year integer, seq bigint) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
    select 'VG-' || p_year::text || '-' || lpad(seq::text, 6, '0');
$$;

CREATE OR REPLACE FUNCTION "public"."next_customer_number"() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
    v_seq bigint;
begin
    insert into public.number_counters (counter_key, year, last_value)
    values ('customer', 0, 1)
    on conflict (counter_key, year)
    do update set last_value = public.number_counters.last_value + 1
    returning last_value into v_seq;

    return public.format_customer_number(v_seq);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."next_case_number"(p_at timestamp with time zone DEFAULT now()) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
    v_year integer;
    v_seq bigint;
begin
    v_year := extract(year from coalesce(p_at, now()))::integer;

    insert into public.number_counters (counter_key, year, last_value)
    values ('deal_case', v_year, 1)
    on conflict (counter_key, year)
    do update set last_value = public.number_counters.last_value + 1
    returning last_value into v_seq;

    return public.format_case_number(v_year, v_seq);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."assign_customer_number"() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
    new.customer_number := public.next_customer_number();
    return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."assign_case_number"() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
    new.case_number := public.next_case_number(coalesce(new.created_at, now()));
    return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."prevent_customer_number_change"() RETURNS trigger
    LANGUAGE plpgsql
    SET "search_path" TO 'public'
    AS $$
begin
    if tg_op = 'UPDATE' then
        if old.customer_number is not null
            and new.customer_number is distinct from old.customer_number then
            raise exception 'customer_number is immutable';
        end if;
    end if;
    return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."prevent_case_number_change"() RETURNS trigger
    LANGUAGE plpgsql
    SET "search_path" TO 'public'
    AS $$
begin
    if tg_op = 'UPDATE' then
        if old.case_number is not null
            and new.case_number is distinct from old.case_number then
            raise exception 'case_number is immutable';
        end if;
    end if;
    return new;
end;
$$;

-- Nora CRM v0.3d2: checklists, snippets, audit

CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS trigger
    LANGUAGE plpgsql
    SET "search_path" TO 'public'
    AS $$
begin
    new.updated_at := now();
    return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."nora_entity_uuid"("p_entity_type" text, "p_id" bigint) RETURNS uuid
    LANGUAGE sql IMMUTABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
    select extensions.uuid_generate_v5(
        '6ba7b811-9dad-11d1-80b4-00c04fd430c8'::uuid,
        p_entity_type || ':' || p_id::text
    );
$$;

CREATE OR REPLACE FUNCTION "public"."insert_audit_event"(
    "p_event_type" text,
    "p_entity_type" text,
    "p_entity_id" uuid,
    "p_company_id" bigint DEFAULT NULL::bigint,
    "p_contact_id" bigint DEFAULT NULL::bigint,
    "p_deal_id" bigint DEFAULT NULL::bigint,
    "p_checklist_run_id" uuid DEFAULT NULL::uuid,
    "p_checklist_run_item_id" uuid DEFAULT NULL::uuid,
    "p_old_data" jsonb DEFAULT NULL::jsonb,
    "p_new_data" jsonb DEFAULT NULL::jsonb,
    "p_metadata" jsonb DEFAULT NULL::jsonb
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
    v_changes jsonb := '{}'::jsonb;
    v_key text;
    v_retention text := 'checklist';
    v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
    if p_event_type like 'checklist.%' or p_event_type like 'snippet.%' then
        v_retention := case
            when p_event_type like 'snippet.%' then 'crm_change'
            else 'checklist'
        end;
    elsif p_event_type like 'user.%' then
        v_retention := 'user_management';
    else
        v_retention := 'crm_change';
    end if;

    if p_old_data is not null or p_new_data is not null then
        for v_key in
            select key from (
                select jsonb_object_keys(coalesce(p_old_data, '{}'::jsonb)) as key
                union
                select jsonb_object_keys(coalesce(p_new_data, '{}'::jsonb)) as key
            ) keys
        loop
            v_changes := v_changes || jsonb_build_object(
                v_key,
                jsonb_build_object(
                    'old', p_old_data -> v_key,
                    'new', p_new_data -> v_key
                )
            );
        end loop;
    end if;

    return nora_private.write_audit_event(
        p_event_type,
        p_entity_type,
        p_entity_id,
        p_company_id,
        p_contact_id,
        p_deal_id,
        p_checklist_run_id,
        p_checklist_run_item_id,
        null,
        null,
        v_changes,
        v_meta,
        v_retention,
        'user',
        null,
        null
    );
end;
$$;

CREATE OR REPLACE FUNCTION "public"."set_checklist_run_defaults"() RETURNS trigger
    LANGUAGE plpgsql
    SET "search_path" TO 'public'
    AS $$
begin
    if new.started_by is null then
        new.started_by := auth.uid();
    end if;
    if new.company_id is null and new.deal_id is not null then
        select d.company_id into new.company_id from public.deals d where d.id = new.deal_id;
    end if;
    return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."prevent_audit_mutation"() RETURNS trigger
    LANGUAGE plpgsql
    SET "search_path" TO 'public'
    AS $$
begin
    raise exception 'audit_events is append-only';
end;
$$;

CREATE OR REPLACE FUNCTION "public"."audit_checklist_run_changes"() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
    v_event_type text;
begin
    if tg_op = 'INSERT' then
        perform public.insert_audit_event(
            'checklist.run_started', 'checklist_run', new.id,
            new.company_id, new.contact_id, new.deal_id, new.id, null, null,
            jsonb_build_object('status', new.status, 'template_id', new.template_id, 'service_area_code', new.service_area_code),
            null
        );
        return new;
    end if;
    if tg_op = 'UPDATE' and old.status is distinct from new.status then
        v_event_type := case
            when new.status = 'completed' then 'checklist.run_completed'
            when new.status = 'cancelled' then 'checklist.run_cancelled'
            else 'checklist.run_status_changed'
        end;
        perform public.insert_audit_event(
            v_event_type, 'checklist_run', new.id,
            new.company_id, new.contact_id, new.deal_id, new.id, null,
            jsonb_build_object('status', old.status),
            jsonb_build_object('status', new.status), null
        );
    end if;
    return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."audit_checklist_run_item_changes"() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
    v_run public.checklist_runs%rowtype;
begin
    select * into v_run from public.checklist_runs where id = coalesce(new.checklist_run_id, old.checklist_run_id);
    if tg_op = 'UPDATE' and old.is_checked is distinct from new.is_checked then
        perform public.insert_audit_event(
            case when new.is_checked then 'checklist.item_checked' else 'checklist.item_unchecked' end,
            'checklist_run_item', new.id,
            v_run.company_id, v_run.contact_id, v_run.deal_id, new.checklist_run_id, new.id,
            jsonb_build_object('is_checked', old.is_checked, 'label', old.label_snapshot),
            jsonb_build_object('is_checked', new.is_checked, 'label', new.label_snapshot), null
        );
    elsif tg_op = 'UPDATE' and old.note is distinct from new.note then
        perform public.insert_audit_event(
            'checklist.item_note_changed', 'checklist_run_item', new.id,
            v_run.company_id, v_run.contact_id, v_run.deal_id, new.checklist_run_id, new.id,
            jsonb_build_object('note', old.note),
            jsonb_build_object('note', new.note), null
        );
    end if;
    return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."audit_saved_text_snippet_changes"() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
    if tg_op = 'INSERT' then
        perform public.insert_audit_event(
            'snippet.created', 'saved_text_snippet', new.id,
            null, null, null, null, null, null,
            jsonb_build_object('kind', new.kind, 'service_area_code', new.service_area_code, 'text', new.text),
            null
        );
        return new;
    end if;
    if tg_op = 'UPDATE' and old.is_active = true and new.is_active = false then
        perform public.insert_audit_event(
            'snippet.deactivated', 'saved_text_snippet', new.id,
            null, null, null, null, null,
            jsonb_build_object('is_active', old.is_active),
            jsonb_build_object('is_active', new.is_active), null
        );
    end if;
    return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."start_checklist_run_from_template"(
    "p_template_code" text,
    "p_deal_id" bigint,
    "p_contact_id" bigint DEFAULT NULL::bigint
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
    v_template public.checklist_templates%rowtype;
    v_deal public.deals%rowtype;
    v_run_id uuid;
    v_active_items int;
    v_lock_key1 int;
    v_lock_key2 int;
begin
    if auth.uid() is null then
        raise exception 'not authenticated' using errcode = '28000';
    end if;

    select * into v_template from public.checklist_templates where code = p_template_code;
    if not found then
        raise exception 'checklist template not found: %', p_template_code using errcode = 'P0002';
    end if;
    if not v_template.is_active then
        raise exception 'checklist template is inactive: %', p_template_code using errcode = 'P0001';
    end if;

    select * into v_deal from public.deals where id = p_deal_id;
    if not found then
        raise exception 'deal not found: %', p_deal_id using errcode = 'P0002';
    end if;

    if p_contact_id is not null then
        if not exists (select 1 from public.contacts c where c.id = p_contact_id) then
            raise exception 'contact not found: %', p_contact_id using errcode = 'P0002';
        end if;
        if not exists (
            select 1 from public.contacts c
            where c.id = p_contact_id
              and (
                  (v_deal.contact_ids is not null and p_contact_id = any (v_deal.contact_ids))
                  or (v_deal.company_id is not null and c.company_id = v_deal.company_id)
              )
        ) then
            raise exception 'contact % is not linked to deal %', p_contact_id, p_deal_id using errcode = 'P0001';
        end if;
    end if;

    select count(*)::int into v_active_items
    from public.checklist_template_items i
    where i.template_id = v_template.id and i.is_active = true;

    if v_active_items = 0 then
        raise exception 'checklist template has no active items: %', p_template_code using errcode = 'P0001';
    end if;

    v_lock_key1 := hashtext('nora_checklist_run');
    v_lock_key2 := hashtext(p_deal_id::text || ':' || v_template.id::text);
    perform pg_advisory_xact_lock(v_lock_key1, v_lock_key2);

    select r.id into v_run_id
    from public.checklist_runs r
    where r.deal_id = p_deal_id and r.template_id = v_template.id and r.status = 'open'
    limit 1;

    if v_run_id is not null then
        return v_run_id;
    end if;

    begin
        insert into public.checklist_runs (
            template_id, deal_id, company_id, contact_id, service_area_code, status, started_by
        )
        values (
            v_template.id, p_deal_id, v_deal.company_id, p_contact_id,
            v_template.service_area_code, 'open', auth.uid()
        )
        returning id into v_run_id;

        insert into public.checklist_run_items (
            checklist_run_id, template_item_id, label_snapshot, is_required, sort_index
        )
        select v_run_id, i.id, i.label, i.is_required, i.sort_index
        from public.checklist_template_items i
        where i.template_id = v_template.id and i.is_active = true
        order by i.sort_index, i.id;

        return v_run_id;
    exception
        when unique_violation then
            select r.id into v_run_id
            from public.checklist_runs r
            where r.deal_id = p_deal_id and r.template_id = v_template.id and r.status = 'open'
            limit 1;
            if v_run_id is null then
                raise;
            end if;
            return v_run_id;
    end;
end;
$$;

-- v0.4b.2 RBAC final hardening (see migration 20260714150000)

CREATE OR REPLACE FUNCTION nora_private.resolve_first_signup_role()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    sales_count int;
BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock(89142421, 1);
    SELECT count(*)::int INTO sales_count FROM public.sales;
    IF sales_count > 0 THEN
        RETURN 'viewer';
    END IF;
    RETURN 'admin';
END;
$$;

CREATE OR REPLACE FUNCTION nora_private.apply_sales_role_change(
    p_sale_id bigint,
    p_role text,
    p_disabled boolean DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_role IS NULL OR p_role NOT IN ('admin', 'office', 'viewer') THEN
        RAISE EXCEPTION 'invalid role: %', p_role USING ERRCODE = '22023';
    END IF;

    UPDATE public.sales
    SET
        role = p_role,
        disabled = coalesce(p_disabled, disabled)
    WHERE id = p_sale_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'sales profile not found: %', p_sale_id USING ERRCODE = 'P0002';
    END IF;
END;
$$;

ALTER FUNCTION nora_private.apply_sales_role_change(bigint, text, boolean) OWNER TO nora_role_manager;

create or replace function public.prevent_sales_privilege_escalation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if current_user = 'nora_role_manager' then
        if tg_op = 'UPDATE' then
            if new.id is distinct from old.id then
                raise exception 'sales.id is immutable';
            end if;
            if new.user_id is distinct from old.user_id then
                raise exception 'sales.user_id is immutable';
            end if;
            if new.email is distinct from old.email then
                raise exception 'sales.email is immutable for role manager';
            end if;
            if new.first_name is distinct from old.first_name
                or new.last_name is distinct from old.last_name
                or new.avatar is distinct from old.avatar then
                raise exception 'role manager may only change role and disabled';
            end if;
        end if;
        return new;
    end if;

    -- W4: the identity manager may change the login email and nothing else.
    if current_user = 'nora_identity_manager' then
        if tg_op = 'UPDATE' then
            if new.id is distinct from old.id then
                raise exception 'sales.id is immutable';
            end if;
            if new.user_id is distinct from old.user_id then
                raise exception 'sales.user_id is immutable';
            end if;
            if new.role is distinct from old.role
                or new.administrator is distinct from old.administrator
                or new.disabled is distinct from old.disabled
                or new.first_name is distinct from old.first_name
                or new.last_name is distinct from old.last_name
                or new.avatar is distinct from old.avatar then
                raise exception 'identity manager may only change email';
            end if;
        end if;
        return new;
    end if;

    if tg_op = 'UPDATE' then
        if new.id is distinct from old.id then
            raise exception 'sales.id is immutable';
        end if;
        if new.user_id is distinct from old.user_id then
            raise exception 'sales.user_id is immutable';
        end if;
        if new.email is distinct from old.email then
            raise exception 'sales.email is immutable for direct updates';
        end if;
        if new.role is distinct from old.role then
            raise exception 'sales.role is immutable for direct updates';
        end if;
        if new.administrator is distinct from old.administrator then
            raise exception 'sales.administrator is immutable for direct updates';
        end if;
        if new.disabled is distinct from old.disabled then
            raise exception 'sales.disabled is immutable for direct updates';
        end if;
    end if;

    return new;
end;
$$;

-- Nora CRM: JWT role reader (legacy GUC + request.jwt.claims JSON)
CREATE OR REPLACE FUNCTION nora_private.safe_auth_role()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role text;
    v_claims text;
BEGIN
    v_role := nullif(current_setting('request.jwt.claim.role', true), '');

    IF v_role IS NULL THEN
        v_claims := nullif(current_setting('request.jwt.claims', true), '');

        IF v_claims IS NOT NULL THEN
            BEGIN
                v_role := nullif(v_claims::jsonb ->> 'role', '');
            EXCEPTION
                WHEN invalid_text_representation THEN
                    RETURN NULL;
            END;
        END IF;
    END IF;

    RETURN v_role;
END;
$$;

-- User Lifecycle W2 hardening (2026-09-05): a disabled employee may stay
-- referenced by existing records but may not be newly assigned as the
-- responsible employee (companies/contacts/deals/tasks). See migration
-- 20260905150000_nora_lifecycle_active_assignment.sql.
CREATE OR REPLACE FUNCTION nora_private.guard_active_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_disabled boolean;
BEGIN
    IF new.sales_id IS NULL THEN
        RETURN new;
    END IF;
    IF tg_op = 'UPDATE' AND new.sales_id IS NOT DISTINCT FROM old.sales_id THEN
        RETURN new;
    END IF;

    SELECT s.disabled INTO v_disabled
    FROM public.sales s
    WHERE s.id = new.sales_id;

    IF v_disabled THEN
        RAISE EXCEPTION 'Dieser Mitarbeiter ist deaktiviert und kann nicht neu zugewiesen werden'
            USING ERRCODE = '23514', DETAIL = 'NORA_EMPLOYEE_NOT_ASSIGNABLE';
    END IF;

    RETURN new;
END;
$$;

ALTER FUNCTION nora_private.guard_active_assignment() OWNER TO postgres;

-- public.set_sales_role_by_admin (legacy lifecycle RPC) was dropped in User
-- Lifecycle W2 (migration 20260905120000). The single executor is
-- public.set_sales_access_by_executor below.

-- ---------------------------------------------------------------------------
-- Nora User Lifecycle W1 (2026-09-04): single executor + access invariants
-- (see migration 20260904220000_nora_lifecycle_single_executor.sql)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION nora_private.active_admin_count(
    p_exclude_sale_id bigint DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT count(*)::integer
    FROM public.sales s
    WHERE s.role = 'admin'
      AND s.disabled = false
      AND (p_exclude_sale_id IS NULL OR s.id <> p_exclude_sale_id);
$$;

ALTER FUNCTION nora_private.active_admin_count(bigint) OWNER TO postgres;

CREATE OR REPLACE FUNCTION nora_private.guard_last_active_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_remaining integer;
BEGIN
    IF NOT (old.role = 'admin' AND old.disabled = false) THEN
        RETURN new;
    END IF;
    IF new.role = 'admin' AND new.disabled = false THEN
        RETURN new;
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(89142421, 2);

    v_remaining := nora_private.active_admin_count(old.id);
    IF v_remaining < 1 THEN
        RAISE EXCEPTION 'at least one active administrator must remain'
            USING ERRCODE = '23514',
                  DETAIL = 'NORA_LAST_ACTIVE_ADMIN_REQUIRED';
    END IF;

    RETURN new;
END;
$$;

ALTER FUNCTION nora_private.guard_last_active_admin() OWNER TO postgres;

-- Nora User Lifecycle W3 (2026-09-05): the executor pins the verified actor and the
-- operation id for the audit trigger (migration 20260905180000).
create or replace function nora_private.pin_audit_context(
    p_actor_user_id uuid,
    p_operation_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
    perform set_config('nora.audit_actor_user_id', coalesce(p_actor_user_id::text, ''), true);
    perform set_config('nora.operation_id', coalesce(lower(p_operation_id::text), ''), true);
end;
$$;

alter function nora_private.pin_audit_context(uuid, uuid) owner to postgres;

create or replace function public.set_sales_access_by_executor(
    p_actor_user_id uuid,
    p_sale_id bigint,
    p_role text default null,
    p_disabled boolean default null,
    p_operation_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_actor public.sales%rowtype;
    v_target public.sales%rowtype;
    v_next_role text;
    v_next_disabled boolean;
begin
    -- Trust boundary: only the privileged server executor may call this.
    if coalesce(nora_private.safe_auth_role(), '') <> 'service_role' then
        raise exception 'forbidden'
            using errcode = '42501', detail = 'NORA_PERMISSION_DENIED';
    end if;

    if p_actor_user_id is null then
        raise exception 'actor required' using errcode = '22023';
    end if;
    if p_role is not null and p_role not in ('admin', 'office', 'viewer') then
        raise exception 'invalid role: %', p_role using errcode = '22023';
    end if;
    if p_role is null and p_disabled is null then
        raise exception 'nothing to change' using errcode = '22023';
    end if;

    -- The actor parameter never creates privilege: it must name an existing,
    -- active administrator or the call is refused before any write.
    select * into v_actor from public.sales where user_id = p_actor_user_id;
    if not found or v_actor.role <> 'admin' or v_actor.disabled then
        raise exception 'forbidden'
            using errcode = '42501', detail = 'NORA_PERMISSION_DENIED';
    end if;

    select * into v_target from public.sales where id = p_sale_id for update;
    if not found then
        raise exception 'sales profile not found: %', p_sale_id
            using errcode = 'P0002';
    end if;

    v_next_role := coalesce(p_role, v_target.role);
    v_next_disabled := coalesce(p_disabled, v_target.disabled);

    -- Self guard: an administrator must not demote or disable themselves
    -- through the normal lifecycle path. Re-applying the current values is
    -- not a change and stays allowed (idempotent re-sync).
    if v_target.user_id = p_actor_user_id
       and (
           v_next_role is distinct from v_target.role
           or v_next_disabled is distinct from v_target.disabled
       )
    then
        raise exception 'administrators cannot change their own role or access'
            using errcode = '42501', detail = 'NORA_SELF_ACCESS_CHANGE_FORBIDDEN';
    end if;

    -- W3: the audit trigger on public.sales fires inside apply_sales_role_change
    -- (same transaction). Pin the verified actor and the operation id for it,
    -- then clear both again so nothing outlives this call.
    perform nora_private.pin_audit_context(p_actor_user_id, p_operation_id);
    perform nora_private.apply_sales_role_change(p_sale_id, v_next_role, v_next_disabled);
    perform nora_private.pin_audit_context(null, null);

    select * into v_target from public.sales where id = p_sale_id;

    return jsonb_build_object(
        'id', v_target.id,
        'user_id', v_target.user_id,
        'role', v_target.role,
        'disabled', v_target.disabled
    );
end;
$$;

alter function public.set_sales_access_by_executor(uuid, bigint, text, boolean, uuid) owner to postgres;

create or replace function public.record_employee_admin_event(
    p_actor_user_id uuid,
    p_sale_id bigint,
    p_event_type text,
    p_operation_id uuid default null,
    p_metadata jsonb default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_actor public.sales%rowtype;
    v_target public.sales%rowtype;
    v_meta jsonb;
    v_role text;
    v_key text;
    v_id uuid;
begin
    -- Trust boundary: only the privileged server executor may call this.
    if coalesce(nora_private.safe_auth_role(), '') <> 'service_role' then
        raise exception 'forbidden'
            using errcode = '42501', detail = 'NORA_PERMISSION_DENIED';
    end if;

    if p_actor_user_id is null then
        raise exception 'actor required' using errcode = '22023';
    end if;
    if p_sale_id is null then
        raise exception 'target required' using errcode = '22023';
    end if;
    if p_event_type is null or p_event_type not in (
        'user.invited',
        'user.invitation_resent',
        'user.password_setup_requested'
    ) then
        raise exception 'unsupported employee event type: %', coalesce(p_event_type, '<null>')
            using errcode = '22023';
    end if;

    -- Same actor rule as the lifecycle executor: an existing, active admin.
    select * into v_actor from public.sales where user_id = p_actor_user_id;
    if not found or v_actor.role <> 'admin' or v_actor.disabled then
        raise exception 'forbidden'
            using errcode = '42501', detail = 'NORA_PERMISSION_DENIED';
    end if;

    select * into v_target from public.sales where id = p_sale_id;
    if not found then
        raise exception 'sales profile not found: %', p_sale_id
            using errcode = 'P0002';
    end if;

    -- Allowlisted caller metadata: only "role" (for user.invited).
    if p_metadata is not null then
        if jsonb_typeof(p_metadata) <> 'object' then
            raise exception 'metadata must be an object' using errcode = '22023';
        end if;
        for v_key in select jsonb_object_keys(p_metadata) loop
            if v_key <> 'role' then
                raise exception 'metadata key not allowed: %', v_key using errcode = '22023';
            end if;
        end loop;
        v_role := p_metadata ->> 'role';
        if v_role is not null and v_role not in ('admin', 'office', 'viewer') then
            raise exception 'invalid role: %', v_role using errcode = '22023';
        end if;
    end if;

    v_meta := jsonb_build_object(
        'sale_id', v_target.id,
        'actor_sale_id', v_actor.id
    );

    if p_event_type = 'user.invited' then
        v_meta := v_meta || jsonb_build_object(
            'invitee_sale_id', v_target.id,
            'invitee_email', v_target.email,
            'role', coalesce(v_role, v_target.role)
        );
    else
        v_meta := v_meta || jsonb_build_object(
            'employee_sale_id', v_target.id,
            'employee_email', v_target.email
        );
    end if;

    perform nora_private.pin_audit_context(p_actor_user_id, p_operation_id);
    v_id := nora_private.write_audit_event(
        p_event_type := p_event_type,
        p_entity_type := 'sales',
        p_entity_id := public.nora_entity_uuid('sales', v_target.id),
        p_metadata := v_meta,
        p_retention_class := 'user_management',
        p_source := 'user'
    );
    perform nora_private.pin_audit_context(null, null);

    return v_id;
end;
$$;

alter function public.record_employee_admin_event(uuid, bigint, text, uuid, jsonb) owner to postgres;

-- Nora CRM v0.3l: CRM audit writer, diff builders, entity triggers, read RPCs
-- Role nora_audit_writer is created in migration 20260715120000_nora_crm_audit.sql

-- W3: actor bridge for the privileged server path (migration 20260905180000).
create or replace function nora_private.resolve_audit_actor()
returns table (
    actor_auth_id uuid,
    actor_sales_id bigint,
    actor_name text,
    actor_role text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_uid uuid;
    v_sale public.sales%rowtype;
    v_pinned text;
    v_pinned_uid uuid;
begin
    v_uid := nora_private.safe_auth_uid();

    if v_uid is null then
        -- W3: privileged server path (service_role) with a verified human actor
        -- pinned by the executor. W4: also a JWT-less database session
        -- (GoTrue applying a ticketed email change).
        -- W4: also a JWT-less database session (GoTrue applying a ticketed email change).
        if coalesce(nora_private.safe_auth_role(), '') in ('service_role', '') then
            begin
                v_pinned := nullif(btrim(current_setting('nora.audit_actor_user_id', true)), '');
            exception
                when others then
                    v_pinned := null;
            end;

            if v_pinned is not null then
                begin
                    v_pinned_uid := v_pinned::uuid;
                exception
                    when others then
                        raise exception 'audit actor context is not a uuid'
                            using errcode = '22023', detail = 'NORA_AUDIT_ACTOR_INVALID';
                end;

                select * into v_sale
                from public.sales s
                where s.user_id = v_pinned_uid
                limit 1;

                if not found then
                    raise exception 'audit actor does not resolve to an employee'
                        using errcode = '42501', detail = 'NORA_AUDIT_ACTOR_INVALID';
                end if;

                return query select
                    v_pinned_uid,
                    v_sale.id,
                    trim(v_sale.first_name || ' ' || v_sale.last_name),
                    v_sale.role;
                return;
            end if;
        end if;

        -- Genuine automation (no verified human): System stays valid.
        return query select null::uuid, null::bigint, 'System'::text, null::text;
        return;
    end if;

    select * into v_sale
    from public.sales s
    where s.user_id = v_uid
      and s.disabled = false
    limit 1;

    if not found then
        return query select v_uid, null::bigint, 'Unbekannter Benutzer'::text, null::text;
        return;
    end if;

    return query select
        v_uid,
        v_sale.id,
        trim(v_sale.first_name || ' ' || v_sale.last_name),
        v_sale.role;
end;
$$;

alter function nora_private.resolve_audit_actor() owner to postgres;

CREATE OR REPLACE FUNCTION nora_private.audit_json_field(p_old jsonb, p_new jsonb, p_key text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_old IS NOT DISTINCT FROM p_new THEN null
        ELSE jsonb_build_object('old', p_old, 'new', p_new)
    END;
$$;

ALTER FUNCTION nora_private.audit_json_field(jsonb, jsonb, text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION nora_private.current_operation_id()
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
    v_raw text;
    v_headers jsonb;
    v_uuid uuid;
BEGIN
    -- GUC wins over HTTP header
    BEGIN
        v_raw := nullif(btrim(current_setting('nora.operation_id', true)), '');
    EXCEPTION
        WHEN others THEN
            v_raw := null;
    END;

    IF v_raw IS NULL THEN
        BEGIN
            v_headers := coalesce(
                nullif(current_setting('request.headers', true), '')::jsonb,
                '{}'::jsonb
            );
            v_raw := nullif(btrim(v_headers ->> 'x-nora-operation-id'), '');
        EXCEPTION
            WHEN others THEN
                v_raw := null;
        END;
    END IF;

    IF v_raw IS NULL THEN
        RETURN null;
    END IF;

    BEGIN
        v_uuid := v_raw::uuid;
        RETURN lower(v_uuid::text);
    EXCEPTION
        WHEN invalid_text_representation THEN
            RETURN null;
        WHEN others THEN
            RETURN null;
    END;
END;
$$;

ALTER FUNCTION nora_private.current_operation_id() OWNER TO postgres;

CREATE OR REPLACE FUNCTION nora_private.write_audit_event(
    p_event_type text, p_entity_type text, p_entity_id uuid,
    p_company_id bigint DEFAULT null, p_contact_id bigint DEFAULT null, p_deal_id bigint DEFAULT null,
    p_checklist_run_id uuid DEFAULT null, p_checklist_run_item_id uuid DEFAULT null,
    p_task_id bigint DEFAULT null, p_note_id bigint DEFAULT null,
    p_changes jsonb DEFAULT null, p_metadata jsonb DEFAULT null,
    p_retention_class text DEFAULT 'crm_change', p_source text DEFAULT 'user',
    p_customer_number text DEFAULT null, p_case_number text DEFAULT null
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid := gen_random_uuid();
    v_actor record;
    v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
    v_request_id text;
BEGIN
    SELECT * INTO v_actor FROM nora_private.resolve_audit_actor() r LIMIT 1;
    IF p_changes IS NOT NULL AND p_changes <> '{}'::jsonb THEN
        v_meta := v_meta || jsonb_build_object('changes', p_changes);
    END IF;
    IF p_customer_number IS NOT NULL THEN
        v_meta := v_meta || jsonb_build_object('customer_number', p_customer_number);
    END IF;
    IF p_case_number IS NOT NULL THEN
        v_meta := v_meta || jsonb_build_object('case_number', p_case_number);
    END IF;
    BEGIN
        v_request_id := nora_private.current_operation_id();
    EXCEPTION
        WHEN others THEN
            v_request_id := null;
    END;
    INSERT INTO public.audit_events (
        id, actor_id, actor_sales_id, actor_name_snapshot, actor_role_snapshot,
        source, retention_class, event_type, entity_type, entity_id,
        company_id, contact_id, deal_id, checklist_run_id, checklist_run_item_id,
        task_id, note_id, old_data, new_data, metadata, request_id
    ) VALUES (
        v_id, v_actor.actor_auth_id, v_actor.actor_sales_id, v_actor.actor_name, v_actor.actor_role,
        coalesce(p_source, 'user'), coalesce(p_retention_class, 'crm_change'),
        p_event_type, p_entity_type, p_entity_id,
        p_company_id, p_contact_id, p_deal_id, p_checklist_run_id, p_checklist_run_item_id,
        p_task_id, p_note_id, null, null, v_meta, v_request_id
    );
    RETURN v_id;
END;
$$;

ALTER FUNCTION nora_private.write_audit_event(
    text, text, uuid, bigint, bigint, bigint, uuid, uuid, bigint, bigint,
    jsonb, jsonb, text, text, text, text
) OWNER TO nora_audit_writer;

-- Whitelist diff builders

CREATE OR REPLACE FUNCTION nora_private.audit_company_changes(
    p_old public.companies,
    p_new public.companies
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
    part := nora_private.audit_json_field(to_jsonb(p_old.name), to_jsonb(p_new.name), 'name');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('name', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.address), to_jsonb(p_new.address), 'address');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('address', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.phone_number), to_jsonb(p_new.phone_number), 'phone_number');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('phone_number', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.website), to_jsonb(p_new.website), 'website');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('website', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.sales_id), to_jsonb(p_new.sales_id), 'sales_id');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('sales_id', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.sector), to_jsonb(p_new.sector), 'sector');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('sector', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.city), to_jsonb(p_new.city), 'city');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('city', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.zipcode), to_jsonb(p_new.zipcode), 'zipcode');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('zipcode', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.state_abbr), to_jsonb(p_new.state_abbr), 'state_abbr');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('state_abbr', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.country), to_jsonb(p_new.country), 'country');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('country', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.description), to_jsonb(p_new.description), 'description');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('description', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.customer_kind), to_jsonb(p_new.customer_kind), 'customer_kind');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('customer_kind', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.links_jsonb), to_jsonb(p_new.links_jsonb), 'links_jsonb');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('links_jsonb', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.email_jsonb), to_jsonb(p_new.email_jsonb), 'email_jsonb');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('email_jsonb', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.phone_jsonb), to_jsonb(p_new.phone_jsonb), 'phone_jsonb');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('phone_jsonb', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.self_contact_id), to_jsonb(p_new.self_contact_id), 'self_contact_id');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('self_contact_id', part); END IF;
    RETURN v;
END;
$$;

ALTER FUNCTION nora_private.audit_company_changes(public.companies, public.companies) OWNER TO postgres;

CREATE OR REPLACE FUNCTION nora_private.audit_contact_changes(
    p_old public.contacts,
    p_new public.contacts
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
    part := nora_private.audit_json_field(to_jsonb(p_old.first_name), to_jsonb(p_new.first_name), 'first_name');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('first_name', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.last_name), to_jsonb(p_new.last_name), 'last_name');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('last_name', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.company_id), to_jsonb(p_new.company_id), 'company_id');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('company_id', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.phone_jsonb), to_jsonb(p_new.phone_jsonb), 'phone_jsonb');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('phone_jsonb', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.email_jsonb), to_jsonb(p_new.email_jsonb), 'email_jsonb');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('email_jsonb', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.title), to_jsonb(p_new.title), 'title');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('title', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.sales_id), to_jsonb(p_new.sales_id), 'sales_id');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('sales_id', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.status), to_jsonb(p_new.status), 'status');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('status', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.is_primary), to_jsonb(p_new.is_primary), 'is_primary');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('is_primary', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.links_jsonb), to_jsonb(p_new.links_jsonb), 'links_jsonb');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('links_jsonb', part); END IF;
    RETURN v;
END;
$$;

ALTER FUNCTION nora_private.audit_contact_changes(public.contacts, public.contacts) OWNER TO postgres;

CREATE OR REPLACE FUNCTION nora_private.audit_deal_changes(
    p_old public.deals,
    p_new public.deals
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
    part := nora_private.audit_json_field(to_jsonb(p_old.name), to_jsonb(p_new.name), 'name');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('name', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.company_id), to_jsonb(p_new.company_id), 'company_id');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('company_id', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.contact_ids), to_jsonb(p_new.contact_ids), 'contact_ids');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('contact_ids', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.stage), to_jsonb(p_new.stage), 'stage');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('stage', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.category), to_jsonb(p_new.category), 'category');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('category', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.amount), to_jsonb(p_new.amount), 'amount');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('amount', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.expected_closing_date), to_jsonb(p_new.expected_closing_date), 'expected_closing_date');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('expected_closing_date', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.sales_id), to_jsonb(p_new.sales_id), 'sales_id');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('sales_id', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.archived_at), to_jsonb(p_new.archived_at), 'archived_at');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('archived_at', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.description), to_jsonb(p_new.description), 'description');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('description', part); END IF;
    RETURN v;
END;
$$;

ALTER FUNCTION nora_private.audit_deal_changes(public.deals, public.deals) OWNER TO postgres;

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

CREATE OR REPLACE FUNCTION nora_private.audit_note_content_meta(
    p_old_text text,
    p_new_text text
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT jsonb_build_object(
        'content_changed', true,
        'old_length', coalesce(length(p_old_text), 0),
        'new_length', coalesce(length(p_new_text), 0),
        'old_preview', left(coalesce(p_old_text, ''), 80),
        'new_preview', left(coalesce(p_new_text, ''), 80),
        'old_hash', md5(coalesce(p_old_text, '')),
        'new_hash', md5(coalesce(p_new_text, ''))
    );
$$;

ALTER FUNCTION nora_private.audit_note_content_meta(text, text) OWNER TO postgres;

-- Entity audit trigger functions (triggers defined in 04_triggers.sql)

CREATE OR REPLACE FUNCTION public.audit_company_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_changes jsonb;
    v_event text;
    v_cn text;
BEGIN
    IF tg_op = 'INSERT' THEN
        PERFORM nora_private.write_audit_event(
            p_event_type := 'company.created',
            p_entity_type := 'company',
            p_entity_id := public.nora_entity_uuid('company', new.id),
            p_company_id := new.id,
            p_customer_number := new.customer_number
        );
        RETURN new;
    END IF;

    IF tg_op = 'UPDATE' THEN
        v_changes := nora_private.audit_company_changes(old, new);
        IF v_changes = '{}'::jsonb THEN
            RETURN new;
        END IF;
        v_event := 'company.updated';
        v_cn := new.customer_number;
        PERFORM nora_private.write_audit_event(
            p_event_type := v_event,
            p_entity_type := 'company',
            p_entity_id := public.nora_entity_uuid('company', new.id),
            p_company_id := new.id,
            p_changes := v_changes,
            p_customer_number := v_cn
        );
        RETURN new;
    END IF;

    IF tg_op = 'DELETE' THEN
        PERFORM nora_private.write_audit_event(
            p_event_type := 'company.deleted',
            p_entity_type := 'company',
            p_entity_id := public.nora_entity_uuid('company', old.id),
            p_company_id := old.id,
            p_retention_class := 'security',
            p_customer_number := old.customer_number
        );
        RETURN old;
    END IF;

    RETURN coalesce(new, old);
END;
$$;

ALTER FUNCTION public.audit_company_row() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.audit_contact_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_changes jsonb;
    v_cn text;
BEGIN
    IF tg_op = 'INSERT' THEN
        SELECT c.customer_number INTO v_cn
        FROM public.companies c WHERE c.id = new.company_id;
        PERFORM nora_private.write_audit_event(
            p_event_type := 'contact.created',
            p_entity_type := 'contact',
            p_entity_id := public.nora_entity_uuid('contact', new.id),
            p_company_id := new.company_id,
            p_contact_id := new.id,
            p_customer_number := v_cn
        );
        RETURN new;
    END IF;

    IF tg_op = 'UPDATE' THEN
        v_changes := nora_private.audit_contact_changes(old, new);
        IF v_changes = '{}'::jsonb THEN
            RETURN new;
        END IF;
        SELECT c.customer_number INTO v_cn
        FROM public.companies c WHERE c.id = new.company_id;
        PERFORM nora_private.write_audit_event(
            p_event_type := 'contact.updated',
            p_entity_type := 'contact',
            p_entity_id := public.nora_entity_uuid('contact', new.id),
            p_company_id := new.company_id,
            p_contact_id := new.id,
            p_changes := v_changes,
            p_customer_number := v_cn
        );
        RETURN new;
    END IF;

    IF tg_op = 'DELETE' THEN
        SELECT c.customer_number INTO v_cn
        FROM public.companies c WHERE c.id = old.company_id;
        PERFORM nora_private.write_audit_event(
            p_event_type := 'contact.deleted',
            p_entity_type := 'contact',
            p_entity_id := public.nora_entity_uuid('contact', old.id),
            p_company_id := old.company_id,
            p_contact_id := old.id,
            p_retention_class := 'security',
            p_customer_number := v_cn
        );
        RETURN old;
    END IF;

    RETURN coalesce(new, old);
END;
$$;

ALTER FUNCTION public.audit_contact_row() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.audit_deal_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_changes jsonb;
    v_event text;
    v_cn text;
BEGIN
    IF tg_op = 'INSERT' THEN
        SELECT c.customer_number INTO v_cn
        FROM public.companies c WHERE c.id = new.company_id;
        PERFORM nora_private.write_audit_event(
            p_event_type := 'deal.created',
            p_entity_type := 'deal',
            p_entity_id := public.nora_entity_uuid('deal', new.id),
            p_company_id := new.company_id,
            p_deal_id := new.id,
            p_customer_number := v_cn,
            p_case_number := new.case_number
        );
        RETURN new;
    END IF;

    IF tg_op = 'UPDATE' THEN
        IF old.archived_at IS NULL AND new.archived_at IS NOT NULL THEN
            SELECT c.customer_number INTO v_cn FROM public.companies c WHERE c.id = new.company_id;
            PERFORM nora_private.write_audit_event(
                p_event_type := 'deal.archived',
                p_entity_type := 'deal',
                p_entity_id := public.nora_entity_uuid('deal', new.id),
                p_company_id := new.company_id,
                p_deal_id := new.id,
                p_customer_number := v_cn,
                p_case_number := new.case_number
            );
            RETURN new;
        END IF;

        IF old.archived_at IS NOT NULL AND new.archived_at IS NULL THEN
            SELECT c.customer_number INTO v_cn FROM public.companies c WHERE c.id = new.company_id;
            PERFORM nora_private.write_audit_event(
                p_event_type := 'deal.restored',
                p_entity_type := 'deal',
                p_entity_id := public.nora_entity_uuid('deal', new.id),
                p_company_id := new.company_id,
                p_deal_id := new.id,
                p_customer_number := v_cn,
                p_case_number := new.case_number
            );
            RETURN new;
        END IF;

        v_changes := nora_private.audit_deal_changes(old, new);
        IF v_changes = '{}'::jsonb THEN
            RETURN new;
        END IF;

        IF v_changes ? 'stage' AND (SELECT count(*) FROM jsonb_object_keys(v_changes)) = 1 THEN
            v_event := 'deal.status_changed';
        ELSE
            v_event := 'deal.updated';
        END IF;

        SELECT c.customer_number INTO v_cn FROM public.companies c WHERE c.id = new.company_id;
        PERFORM nora_private.write_audit_event(
            p_event_type := v_event,
            p_entity_type := 'deal',
            p_entity_id := public.nora_entity_uuid('deal', new.id),
            p_company_id := new.company_id,
            p_deal_id := new.id,
            p_changes := v_changes,
            p_customer_number := v_cn,
            p_case_number := new.case_number
        );
        RETURN new;
    END IF;

    IF tg_op = 'DELETE' THEN
        SELECT c.customer_number INTO v_cn FROM public.companies c WHERE c.id = old.company_id;
        PERFORM nora_private.write_audit_event(
            p_event_type := 'deal.deleted',
            p_entity_type := 'deal',
            p_entity_id := public.nora_entity_uuid('deal', old.id),
            p_company_id := old.company_id,
            p_deal_id := old.id,
            p_retention_class := 'security',
            p_customer_number := v_cn,
            p_case_number := old.case_number
        );
        RETURN old;
    END IF;

    RETURN coalesce(new, old);
END;
$$;

ALTER FUNCTION public.audit_deal_row() OWNER TO postgres;

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

-- Self Contact Wave (2026-08-26): single shared "does this contact belong
-- to this customer record" rule — used by enforce_task_company_context()
-- and create_quick_capture_case(). Do not reimplement this invariant
-- separately.
CREATE OR REPLACE FUNCTION nora_private.is_effective_contact_of_company(
    p_contact_id bigint,
    p_company_id bigint
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.contacts c
        WHERE c.id = p_contact_id AND c.company_id = p_company_id
    ) OR EXISTS (
        SELECT 1 FROM public.companies co
        WHERE co.id = p_company_id AND co.self_contact_id = p_contact_id
    );
$$;

COMMENT ON FUNCTION nora_private.is_effective_contact_of_company(bigint, bigint) IS
    'Authoritative "does this contact belong to this customer record" rule: contact.company_id = company.id OR company.self_contact_id = contact.id.';

CREATE OR REPLACE FUNCTION nora_private.enforce_task_company_context()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_contact_company_id bigint;
BEGIN
    -- Routine field-only update (text/due_date/done_date/type/sales_id):
    -- the task's context is untouched, so its historical company_id must
    -- not be re-validated against the contact's *current* company.
    IF tg_op = 'UPDATE'
       AND new.contact_id IS NOT DISTINCT FROM old.contact_id
       AND new.company_id IS NOT DISTINCT FROM old.company_id
    THEN
        RETURN new;
    END IF;

    -- Bulk identity-consolidation paths (contact merge) opt out explicitly;
    -- see merge_contacts().
    IF coalesce(nullif(current_setting('nora.skip_task_context_check', true), ''), 'false') = 'true' THEN
        RETURN new;
    END IF;

    IF new.contact_id IS NOT NULL THEN
        SELECT company_id INTO v_contact_company_id
        FROM public.contacts
        WHERE id = new.contact_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'tasks.contact_id % does not reference an existing contact', new.contact_id
                USING ERRCODE = '23503';
        END IF;

        IF new.company_id IS NULL THEN
            new.company_id := v_contact_company_id;
        ELSIF new.company_id IS DISTINCT FROM v_contact_company_id
              AND NOT nora_private.is_effective_contact_of_company(new.contact_id, new.company_id) THEN
            RAISE EXCEPTION 'tasks.company_id (%) does not match the effective contact context of contact % (%)',
                new.company_id, new.contact_id, v_contact_company_id
                USING ERRCODE = '23514', DETAIL = 'NORA_CONTACT_NOT_IN_CUSTOMER_CONTEXT';
        END IF;
    END IF;

    IF new.company_id IS NULL AND new.contact_id IS NULL THEN
        RAISE EXCEPTION 'a task must have a company_id or a contact_id'
            USING ERRCODE = '23514';
    END IF;

    RETURN new;
END;
$$;

COMMENT ON FUNCTION nora_private.enforce_task_company_context() IS
    'Derives/validates tasks.company_id from the effective contact context (contacts.company_id OR companies.self_contact_id — see nora_private.is_effective_contact_of_company) whenever a task''s contact_id/company_id is set or changed. Skipped for routine field-only updates and for the explicit merge_contacts() bulk reassignment (nora.skip_task_context_check). Effective-contact-context rejection carries DETAIL=NORA_CONTACT_NOT_IN_CUSTOMER_CONTEXT (Error Contract Wave, 2026-08-28).';

CREATE OR REPLACE FUNCTION nora_private.delete_contact_only_tasks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- Runs before the contact row (and the FK's ON DELETE SET NULL action)
    -- so that tasks with no company context are removed the same way a
    -- CASCADE would have removed them, while tasks that also carry a
    -- company_id survive with contact_id set to NULL by the FK action.
    DELETE FROM public.tasks
    WHERE contact_id = old.id
      AND company_id IS NULL;

    RETURN old;
END;
$$;

COMMENT ON FUNCTION nora_private.delete_contact_only_tasks() IS
    'Before a contact is deleted, deletes its tasks that have no company_id (would otherwise violate tasks_company_or_contact_check once contact_id is set to NULL by the FK action). Tasks with a company_id survive and keep that historical context.';

-- Self Contact Wave (2026-08-26)

CREATE OR REPLACE FUNCTION nora_private.sync_individual_company_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_name text;
BEGIN
    v_name := trim(both ' ' from coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, ''));

    IF v_name = '' AND EXISTS (
        SELECT 1 FROM public.companies
        WHERE self_contact_id = new.id AND customer_kind = 'individual'
    ) THEN
        RAISE EXCEPTION 'Privatkundenakte benoetigt einen Vor- oder Nachnamen (companies.name darf nicht leer werden)'
            USING ERRCODE = '23514', DETAIL = 'NORA_INDIVIDUAL_NAME_REQUIRED';
    END IF;

    UPDATE public.companies
    SET name = v_name
    WHERE self_contact_id = new.id
      AND customer_kind = 'individual';
    RETURN new;
END;
$$;

COMMENT ON FUNCTION nora_private.sync_individual_company_name() IS
    'Keeps companies.name in lockstep with the representing contact''s name for customer_kind=individual customer records, so contacts stays the single canonical source for natural-person data. Rejects a rename that would blank both first_name and last_name for a contact representing an individual customer record (DETAIL=NORA_INDIVIDUAL_NAME_REQUIRED, Error Contract Wave, 2026-08-28).';

CREATE OR REPLACE FUNCTION nora_private.check_individual_company_has_self_contact()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    -- Deferred constraint trigger: re-query the row's current state instead
    -- of trusting the captured NEW values, since a multi-statement flow
    -- (insert company, then update self_contact_id) within one transaction
    -- would otherwise see a stale NEW.self_contact_id = NULL from the
    -- INSERT event at commit time.
    v_customer_kind text;
    v_self_contact_id bigint;
BEGIN
    SELECT customer_kind, self_contact_id INTO v_customer_kind, v_self_contact_id
    FROM public.companies WHERE id = new.id;

    IF v_customer_kind = 'individual' AND v_self_contact_id IS NULL THEN
        RAISE EXCEPTION 'Privatkundenakte % benoetigt eine repraesentierende Person (self_contact_id)', new.id
            USING ERRCODE = '23514';
    END IF;
    RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION nora_private.guard_self_contact_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.companies
        WHERE self_contact_id = old.id AND customer_kind = 'individual'
    ) THEN
        RAISE EXCEPTION 'Person hinter einer Privatkundenakte kann nicht geloescht werden — zuerst die Kundenakte anpassen'
            USING ERRCODE = '23503', DETAIL = 'NORA_SELF_CONTACT_DELETE_BLOCKED';
    END IF;
    RETURN old;
END;
$$;

COMMENT ON FUNCTION nora_private.guard_self_contact_delete() IS
    'Blocks deleting a contact that is self_contact_id of an individual customer record. Business self_contact_id keeps ON DELETE SET NULL (the FK action). DETAIL=NORA_SELF_CONTACT_DELETE_BLOCKED (Error Contract Wave, 2026-08-28).';

CREATE OR REPLACE FUNCTION public.audit_contact_note_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_company_id bigint;
    v_meta jsonb;
BEGIN
    SELECT ct.company_id INTO v_company_id FROM public.contacts ct WHERE ct.id = coalesce(new.contact_id, old.contact_id);

    IF tg_op = 'INSERT' THEN
        PERFORM nora_private.write_audit_event(
            p_event_type := 'contact_note.created',
            p_entity_type := 'contact_note',
            p_entity_id := public.nora_entity_uuid('contact_note', new.id),
            p_company_id := v_company_id,
            p_contact_id := new.contact_id,
            p_note_id := new.id,
            p_changes := nora_private.audit_note_content_meta(null, new.text)
        );
        RETURN new;
    END IF;

    IF tg_op = 'UPDATE' THEN
        IF old.text IS NOT DISTINCT FROM new.text THEN
            RETURN new;
        END IF;
        v_meta := nora_private.audit_note_content_meta(old.text, new.text);
        PERFORM nora_private.write_audit_event(
            p_event_type := 'contact_note.updated',
            p_entity_type := 'contact_note',
            p_entity_id := public.nora_entity_uuid('contact_note', new.id),
            p_company_id := v_company_id,
            p_contact_id := new.contact_id,
            p_note_id := new.id,
            p_changes := v_meta
        );
        RETURN new;
    END IF;

    IF tg_op = 'DELETE' THEN
        PERFORM nora_private.write_audit_event(
            p_event_type := 'contact_note.deleted',
            p_entity_type := 'contact_note',
            p_entity_id := public.nora_entity_uuid('contact_note', old.id),
            p_company_id := v_company_id,
            p_contact_id := old.contact_id,
            p_note_id := old.id,
            p_changes := nora_private.audit_note_content_meta(old.text, null),
            p_retention_class := 'security'
        );
        RETURN old;
    END IF;

    RETURN coalesce(new, old);
END;
$$;

ALTER FUNCTION public.audit_contact_note_row() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.audit_deal_note_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_deal public.deals%rowtype;
    v_meta jsonb;
BEGIN
    SELECT * INTO v_deal FROM public.deals d WHERE d.id = coalesce(new.deal_id, old.deal_id);

    IF tg_op = 'INSERT' THEN
        PERFORM nora_private.write_audit_event(
            p_event_type := 'deal_note.created',
            p_entity_type := 'deal_note',
            p_entity_id := public.nora_entity_uuid('deal_note', new.id),
            p_company_id := v_deal.company_id,
            p_deal_id := new.deal_id,
            p_note_id := new.id,
            p_changes := nora_private.audit_note_content_meta(null, new.text),
            p_case_number := v_deal.case_number
        );
        RETURN new;
    END IF;

    IF tg_op = 'UPDATE' THEN
        IF old.text IS NOT DISTINCT FROM new.text THEN
            RETURN new;
        END IF;
        v_meta := nora_private.audit_note_content_meta(old.text, new.text);
        PERFORM nora_private.write_audit_event(
            p_event_type := 'deal_note.updated',
            p_entity_type := 'deal_note',
            p_entity_id := public.nora_entity_uuid('deal_note', new.id),
            p_company_id := v_deal.company_id,
            p_deal_id := new.deal_id,
            p_note_id := new.id,
            p_changes := v_meta,
            p_case_number := v_deal.case_number
        );
        RETURN new;
    END IF;

    IF tg_op = 'DELETE' THEN
        PERFORM nora_private.write_audit_event(
            p_event_type := 'deal_note.deleted',
            p_entity_type := 'deal_note',
            p_entity_id := public.nora_entity_uuid('deal_note', old.id),
            p_company_id := v_deal.company_id,
            p_deal_id := old.deal_id,
            p_note_id := old.id,
            p_changes := nora_private.audit_note_content_meta(old.text, null),
            p_retention_class := 'security',
            p_case_number := v_deal.case_number
        );
        RETURN old;
    END IF;

    RETURN coalesce(new, old);
END;
$$;

ALTER FUNCTION public.audit_deal_note_row() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.audit_sales_privilege_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF tg_op = 'UPDATE' THEN
        IF old.role IS DISTINCT FROM new.role THEN
            PERFORM nora_private.write_audit_event(
                p_event_type := 'user.role_changed',
                p_entity_type := 'sales',
                p_entity_id := public.nora_entity_uuid('sales', new.id),
                p_changes := jsonb_build_object(
                    'role',
                    jsonb_build_object('old', old.role, 'new', new.role)
                ),
                p_metadata := jsonb_build_object('sale_id', new.id),
                p_retention_class := 'user_management'
            );
        END IF;

        IF old.disabled IS DISTINCT FROM new.disabled THEN
            PERFORM nora_private.write_audit_event(
                p_event_type := CASE WHEN new.disabled THEN 'user.disabled' ELSE 'user.enabled' END,
                p_entity_type := 'sales',
                p_entity_id := public.nora_entity_uuid('sales', new.id),
                p_changes := jsonb_build_object(
                    'disabled',
                    jsonb_build_object('old', old.disabled, 'new', new.disabled)
                ),
                p_metadata := jsonb_build_object('sale_id', new.id),
                p_retention_class := 'user_management'
            );
        END IF;
    END IF;

    RETURN new;
END;
$$;

ALTER FUNCTION public.audit_sales_privilege_change() OWNER TO postgres;

-- Read RPCs (sanitized for office, full for admin)

CREATE OR REPLACE FUNCTION public.get_entity_audit_events(
    p_entity_type text,
    p_entity_id bigint,
    p_limit integer DEFAULT 20,
    p_before timestamptz DEFAULT null
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
    v_role text;
    v_rows jsonb;
BEGIN
    IF p_entity_type IS NULL OR p_entity_id IS NULL THEN
        RAISE EXCEPTION 'entity_type and entity_id required' USING errcode = '22023';
    END IF;

    IF p_entity_type NOT IN ('company', 'contact', 'deal') THEN
        RAISE EXCEPTION 'invalid entity_type: %', p_entity_type USING errcode = '22023';
    END IF;

    v_role := nora_private.current_role();
    IF v_role IS NULL OR v_role = 'viewer' THEN
        RAISE EXCEPTION 'forbidden' USING errcode = '42501';
    END IF;

    SELECT coalesce(jsonb_agg(row_to_json(q)::jsonb ORDER BY q.created_at DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
        SELECT
            ae.id,
            ae.created_at,
            ae.event_type,
            ae.entity_type,
            ae.actor_name_snapshot,
            ae.actor_role_snapshot,
            ae.source,
            ae.metadata,
            ae.company_id,
            ae.contact_id,
            ae.deal_id,
            ae.task_id,
            ae.note_id
        FROM public.audit_events ae
        WHERE (
            CASE p_entity_type
                WHEN 'company' THEN ae.company_id = p_entity_id
                WHEN 'contact' THEN ae.contact_id = p_entity_id
                WHEN 'deal' THEN ae.deal_id = p_entity_id
            END
        )
        AND (p_before IS NULL OR ae.created_at < p_before)
        ORDER BY ae.created_at DESC
        LIMIT v_limit
    ) q;

    RETURN jsonb_build_object('data', v_rows, 'limit', v_limit);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_global_audit_events(
    p_limit integer DEFAULT 50,
    p_before timestamptz DEFAULT null,
    p_entity_type text DEFAULT null,
    p_event_type text DEFAULT null,
    p_actor_sales_id bigint DEFAULT null,
    p_from timestamptz DEFAULT null,
    p_to timestamptz DEFAULT null,
    p_business_number text DEFAULT null
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
    v_rows jsonb;
BEGIN
    IF NOT nora_private.is_admin() THEN
        RAISE EXCEPTION 'forbidden' USING errcode = '42501';
    END IF;

    SELECT coalesce(jsonb_agg(row_to_json(q)::jsonb ORDER BY q.created_at DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
        SELECT
            ae.id,
            ae.created_at,
            ae.event_type,
            ae.entity_type,
            ae.actor_id,
            ae.actor_sales_id,
            ae.actor_name_snapshot,
            ae.actor_role_snapshot,
            ae.source,
            ae.retention_class,
            ae.metadata,
            ae.company_id,
            ae.contact_id,
            ae.deal_id,
            ae.task_id,
            ae.note_id
        FROM public.audit_events ae
        WHERE (p_before IS NULL OR ae.created_at < p_before)
          AND (p_entity_type IS NULL OR ae.entity_type = p_entity_type)
          AND (p_event_type IS NULL OR ae.event_type = p_event_type)
          AND (p_actor_sales_id IS NULL OR ae.actor_sales_id = p_actor_sales_id)
          AND (p_from IS NULL OR ae.created_at >= p_from)
          AND (p_to IS NULL OR ae.created_at <= p_to)
          AND (
              p_business_number IS NULL
              OR ae.metadata ->> 'customer_number' ILIKE p_business_number
              OR ae.metadata ->> 'case_number' ILIKE p_business_number
          )
        ORDER BY ae.created_at DESC
        LIMIT v_limit
    ) q;

    RETURN jsonb_build_object('data', v_rows, 'limit', v_limit);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_audit_storage_stats()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_count bigint;
    v_oldest timestamptz;
    v_newest timestamptz;
    v_last_30 bigint;
    v_table_bytes bigint;
    v_index_bytes bigint;
    v_avg_meta numeric;
BEGIN
    IF NOT nora_private.is_admin() THEN
        RAISE EXCEPTION 'forbidden' USING errcode = '42501';
    END IF;

    SELECT count(*), min(created_at), max(created_at)
    INTO v_count, v_oldest, v_newest
    FROM public.audit_events;

    SELECT count(*) INTO v_last_30
    FROM public.audit_events
    WHERE created_at >= now() - interval '30 days';

    SELECT
        pg_catalog.pg_relation_size('public.audit_events'::regclass),
        pg_catalog.pg_indexes_size('public.audit_events'::regclass)
    INTO v_table_bytes, v_index_bytes;

    SELECT avg(pg_catalog.pg_column_size(metadata)) INTO v_avg_meta
    FROM public.audit_events;

    RETURN jsonb_build_object(
        'event_count', v_count,
        'oldest_event', v_oldest,
        'newest_event', v_newest,
        'events_last_30_days', v_last_30,
        'table_bytes', v_table_bytes,
        'index_bytes', v_index_bytes,
        'total_bytes', v_table_bytes + v_index_bytes,
        'avg_metadata_bytes', round(coalesce(v_avg_meta, 0)),
        'growth_hint',
            CASE
                WHEN v_count < 10000 THEN 'unauffaellig'
                WHEN v_count < 100000 THEN 'wachstum_beobachten'
                ELSE 'archivierungsplanung_erforderlich'
            END,
        'projection_note',
            'Schaetzung: bei gleichbleibendem Tempo ~' ||
            round(v_last_30::numeric * 12)::text ||
            ' Ereignisse/Jahr (nur Indikator, keine Garantie).'
    );
END;
$$;


-- Foundation Wave 3: Error Observatory
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

-- ---------------------------------------------------------------------------
-- Customer & Contact Workflow Wave (2026-08-25)
-- ---------------------------------------------------------------------------

-- Self Contact Wave (2026-08-26): shared core write, used by both
-- create_customer_with_contact and create_quick_capture_case. Not
-- SECURITY DEFINER itself — callers (both SECURITY DEFINER,
-- can_write()-gated) are the only intended entry points.
create or replace function nora_private.create_customer_with_contact_core(
    p_company jsonb,
    p_existing_company_id bigint,
    p_contact jsonb,
    p_existing_contact_id bigint,
    p_self_contact_id bigint,
    p_mark_self boolean,
    p_contact_is_primary boolean default true
)
returns table(company_id bigint, contact_id bigint)
language plpgsql
set search_path = ''
as $$
declare
    v_company_id bigint;
    v_contact_id bigint;
    v_customer_kind text;
    v_name text;
    v_count int;
    v_self_contact_touched boolean := false;
    v_derived_name text;
    v_constraint_name text;
    v_source_company_id bigint;
    v_locked_source_company_id bigint;
    v_lock_attempt int := 0;
begin
    <<main>>
    begin
    v_count :=
        (case when p_company is not null then 1 else 0 end) +
        (case when p_existing_company_id is not null then 1 else 0 end);
    if v_count <> 1 then
        raise exception 'exactly one of p_company or p_existing_company_id is required' using errcode = '22023';
    end if;

    v_count :=
        (case when p_contact is not null then 1 else 0 end) +
        (case when p_existing_contact_id is not null then 1 else 0 end) +
        (case when p_self_contact_id is not null then 1 else 0 end);
    if v_count > 1 then
        raise exception 'p_contact, p_existing_contact_id and p_self_contact_id are mutually exclusive' using errcode = '22023';
    end if;

    if p_existing_company_id is not null then
        select id, customer_kind into v_company_id, v_customer_kind
        from public.companies
        where id = p_existing_company_id;

        if v_company_id is null then
            raise exception 'existing company not found: %', p_existing_company_id using errcode = 'P0002';
        end if;
    else
        v_name := nullif(btrim(coalesce(p_company->>'name', '')), '');
        if v_name is null then
            raise exception 'company name required' using errcode = '22023';
        end if;
        v_customer_kind := coalesce(nullif(p_company->>'customer_kind', ''), 'business');

        if v_customer_kind = 'individual'
           and p_contact is null and p_existing_contact_id is null and p_self_contact_id is null
        then
            raise exception 'a Privatkundenakte requires a representing contact' using errcode = '22023';
        end if;

        insert into public.companies (
            name, customer_kind, sector, size, address, zipcode, city, state_abbr, country,
            description, revenue, tax_identifier, sales_id, links_jsonb, email_jsonb, phone_jsonb
        ) values (
            v_name,
            v_customer_kind,
            nullif(p_company->>'sector', ''),
            nullif(p_company->>'size', '')::smallint,
            nullif(p_company->>'address', ''),
            nullif(p_company->>'zipcode', ''),
            nullif(p_company->>'city', ''),
            nullif(p_company->>'state_abbr', ''),
            nullif(p_company->>'country', ''),
            nullif(p_company->>'description', ''),
            nullif(p_company->>'revenue', ''),
            nullif(p_company->>'tax_identifier', ''),
            nullif(p_company->>'sales_id', '')::bigint,
            coalesce(p_company->'links_jsonb', '[]'::jsonb),
            coalesce(p_company->'email_jsonb', '[]'::jsonb),
            coalesce(p_company->'phone_jsonb', '[]'::jsonb)
        )
        returning id into v_company_id;
    end if;

    -- Transition lock before any contact row (Atomic Contact Primary Intent
    -- blocker fix, 2026-09-08). Every contact write below either demotes the
    -- current Hauptansprechpartner (UPDATE public.contacts) or inserts/moves a
    -- contact whose company_id FK makes Postgres take a KEY SHARE lock on the
    -- customer row. Before this fix the core ran contact-row-first ->
    -- customer-row-second, the exact inverse of
    -- nora_private.prepare_primary_contact_slot, so Quick Capture on an
    -- EXISTING customer deadlocked (40P01) against a concurrent
    -- create_contact/update_contact/set_primary_contact on the same customer --
    -- and its unserialized demote+insert could also leak a raw 23505. The same
    -- helper and the same ascending id order are used everywhere: one lock
    -- discipline for every path that writes both public.companies and
    -- public.contacts. Do not reorder.
    -- A contact that is MOVED here (p_existing_contact_id) also key-shares its
    -- CURRENT customer, so that row is locked too. Its customer is read without
    -- a lock first; if it moved concurrently before we hold the contact row,
    -- the additional customer is locked and the read repeated (bounded) -- the
    -- pattern public.update_contact uses.
    loop
        v_lock_attempt := v_lock_attempt + 1;

        v_source_company_id := null;
        if p_existing_contact_id is not null then
            select c.company_id into v_source_company_id
            from public.contacts c
            where c.id = p_existing_contact_id;
        end if;

        perform nora_private.lock_customers_for_primary_transition(
            array_remove(array[v_company_id, v_source_company_id], null)
        );

        exit when p_existing_contact_id is null;

        select c.company_id into v_locked_source_company_id
        from public.contacts c
        where c.id = p_existing_contact_id
        for update;

        exit when v_locked_source_company_id is not distinct from v_source_company_id;
        if v_lock_attempt >= 3 then
            raise exception 'contact % moved concurrently; retry', p_existing_contact_id
                using errcode = '40001';
        end if;
    end loop;

    if p_self_contact_id is not null then
        if not exists (select 1 from public.contacts where id = p_self_contact_id) then
            raise exception 'contact not found: %', p_self_contact_id using errcode = 'P0002';
        end if;
        update public.companies set self_contact_id = p_self_contact_id where id = v_company_id;
        v_contact_id := p_self_contact_id;
        v_self_contact_touched := true;
    elsif p_existing_contact_id is not null then
        update public.contacts
        set company_id = v_company_id,
            is_primary = true
        where id = p_existing_contact_id
        returning id into v_contact_id;

        if v_contact_id is null then
            raise exception 'existing contact not found: %', p_existing_contact_id using errcode = 'P0002';
        end if;

        if v_customer_kind = 'individual' or p_mark_self then
            update public.companies set self_contact_id = v_contact_id where id = v_company_id;
            v_self_contact_touched := true;
        end if;
    elsif p_contact is not null then
        -- A new contact for an EXISTING company may need to coexist with an
        -- already-primary contact — hardcoding is_primary=true would
        -- violate uq_contacts_one_primary_per_company in that case (e.g.
        -- Quick Capture adding a second contact to a customer that already
        -- has one). p_contact_is_primary defaults to true (matching the
        -- original always-primary behavior for a brand-new company with no
        -- prior contacts); any previous primary is explicitly demoted first.
        if p_contact_is_primary then
            update public.contacts set is_primary = false
            where public.contacts.company_id = v_company_id and is_primary = true;
        end if;

        insert into public.contacts (
            first_name, last_name, gender, title, background, company_id, sales_id,
            is_primary, email_jsonb, phone_jsonb, links_jsonb
        ) values (
            nullif(p_contact->>'first_name', ''),
            nullif(p_contact->>'last_name', ''),
            nullif(p_contact->>'gender', ''),
            nullif(p_contact->>'title', ''),
            nullif(p_contact->>'background', ''),
            v_company_id,
            nullif(p_contact->>'sales_id', '')::bigint,
            coalesce(p_contact_is_primary, true),
            coalesce(p_contact->'email_jsonb', '[]'::jsonb),
            coalesce(p_contact->'phone_jsonb', '[]'::jsonb),
            coalesce(p_contact->'links_jsonb', '[]'::jsonb)
        )
        returning id into v_contact_id;

        if v_customer_kind = 'individual' or p_mark_self then
            update public.companies set self_contact_id = v_contact_id where id = v_company_id;
            v_self_contact_touched := true;
        end if;
    end if;

    -- Individual Name Invariant, CREATE-path (Final Release Candidate
    -- Verification, 2026-08-28): whenever this call establishes the self
    -- contact of an INDIVIDUAL customer record — regardless of which of the
    -- three paths above did it, and regardless of an existing vs. brand-new
    -- company — companies.name must be authoritatively derived from that
    -- contact's canonical name, never left as an independently-supplied
    -- p_company.name. A representing contact with no first_name/last_name
    -- (after trim) is rejected outright rather than producing a nameless
    -- Privatkundenakte. Mirrors nora_private.sync_individual_company_name()
    -- (the rename-path guard) so CREATE and rename share the same authority.
    if v_customer_kind = 'individual' and v_self_contact_touched then
        select trim(both ' ' from coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
        into v_derived_name
        from public.contacts
        where id = v_contact_id;

        if v_derived_name is null or v_derived_name = '' then
            raise exception 'Privatkundenakte benoetigt einen Vor- oder Nachnamen des repraesentierenden Kontakts'
                using errcode = '23514', detail = 'NORA_INDIVIDUAL_NAME_REQUIRED';
        end if;

        update public.companies set name = v_derived_name where id = v_company_id;
    end if;

    return query select v_company_id, v_contact_id;
    exception
        when unique_violation then
            get stacked diagnostics v_constraint_name = constraint_name;
            if v_constraint_name = 'uq_companies_self_contact_individual' then
                raise exception 'Für diese Person existiert bereits eine Privatkundenakte'
                    using errcode = '23505', detail = 'NORA_PRIVATE_CUSTOMER_ALREADY_EXISTS';
            end if;
            raise;
    end main;
end;
$$;

comment on function nora_private.create_customer_with_contact_core(jsonb, bigint, jsonb, bigint, bigint, boolean, boolean) is
    'Shared core write used by both public.create_customer_with_contact and public.create_quick_capture_case — do not duplicate this logic. For customer_kind=individual, companies.name is authoritatively derived from the representing contact''s first_name/last_name whenever self_contact_id is established here — a blank/whitespace-only name is rejected (DETAIL=NORA_INDIVIDUAL_NAME_REQUIRED), and any client-supplied p_company.name is overridden (Falle 28, 03-data-model-guardrails.md). A uq_companies_self_contact_individual race is translated to DETAIL=NORA_PRIVATE_CUSTOMER_ALREADY_EXISTS; any other unique violation is re-raised unchanged (Error Contract Wave, 2026-08-28).';

-- Idempotency Wave (2026-08-29): shared claim/replay helpers. Not SECURITY
-- DEFINER — only callable from within another SECURITY DEFINER function's
-- body (mirrors nora_private.create_customer_with_contact_core's existing
-- treatment). Advisory xact lock + unique-index backstop, same pattern as
-- start_checklist_run_from_template.
create function nora_private.idempotency_check(
    p_command text,
    p_idempotency_key uuid,
    p_fingerprint text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
    v_lock_key1 int;
    v_lock_key2 int;
    v_existing_fp text;
    v_existing_result jsonb;
begin
    if p_idempotency_key is null then
        return null;
    end if;

    v_lock_key1 := hashtext('nora_idempotency');
    v_lock_key2 := hashtext(p_command || ':' || p_idempotency_key::text);
    perform pg_advisory_xact_lock(v_lock_key1, v_lock_key2);

    select ir.request_fingerprint, ir.result
    into v_existing_fp, v_existing_result
    from nora_private.idempotency_records ir
    where ir.command = p_command
      and ir.idempotency_key = p_idempotency_key
      and ir.actor_id = nora_private.safe_auth_uid();

    if v_existing_fp is not null then
        if v_existing_fp <> p_fingerprint then
            raise exception 'idempotency key reused for a different request (command=%)', p_command
                using errcode = '23505', detail = 'NORA_IDEMPOTENCY_CONFLICT';
        end if;
        return v_existing_result;
    end if;

    return null;
end;
$$;

comment on function nora_private.idempotency_check(text, uuid, text) is
    'Idempotency Wave: takes the advisory xact lock for (command, idempotency_key) and returns the stored result on a matching replay, or NULL if no protection requested / no prior record. Raises DETAIL=NORA_IDEMPOTENCY_CONFLICT when the key is reused with a different request_fingerprint. Must be called after the caller''s own auth/can_write() checks — never before.';

revoke all on function nora_private.idempotency_check(text, uuid, text) from public;
revoke all on function nora_private.idempotency_check(text, uuid, text) from anon;
revoke all on function nora_private.idempotency_check(text, uuid, text) from authenticated;

create function nora_private.idempotency_persist(
    p_command text,
    p_idempotency_key uuid,
    p_fingerprint text,
    p_result jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
    v_existing_result jsonb;
begin
    if p_idempotency_key is null then
        return p_result;
    end if;

    begin
        insert into nora_private.idempotency_records (
            command, idempotency_key, actor_id, request_fingerprint, result
        ) values (
            p_command, p_idempotency_key, nora_private.safe_auth_uid(), p_fingerprint, p_result
        );
        return p_result;
    exception
        when unique_violation then
            select ir.result into v_existing_result
            from nora_private.idempotency_records ir
            where ir.command = p_command
              and ir.idempotency_key = p_idempotency_key
              and ir.actor_id = nora_private.safe_auth_uid();
            return coalesce(v_existing_result, p_result);
    end;
end;
$$;

comment on function nora_private.idempotency_persist(text, uuid, text, jsonb) is
    'Idempotency Wave: persists the claim + result for (command, idempotency_key, actor) in the same transaction as the caller''s business write. No-op passthrough when p_idempotency_key is null (old/non-idempotent callers).';

revoke all on function nora_private.idempotency_persist(text, uuid, text, jsonb) from public;
revoke all on function nora_private.idempotency_persist(text, uuid, text, jsonb) from anon;
revoke all on function nora_private.idempotency_persist(text, uuid, text, jsonb) from authenticated;

create or replace function public.create_customer_with_contact(
    p_company jsonb,
    p_contact jsonb default null,
    p_existing_contact_id bigint default null,
    p_self_contact_id bigint default null,
    p_mark_self boolean default false,
    p_idempotency_key uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_company_id bigint;
    v_contact_id bigint;
    v_fingerprint text;
    v_replay jsonb;
    v_result jsonb;
begin
    if nora_private.safe_auth_uid() is null then
        raise exception 'not authenticated' using errcode = '28000';
    end if;
    if not nora_private.can_write() then
        raise exception 'insufficient privileges' using errcode = '42501', detail = 'NORA_PERMISSION_DENIED';
    end if;
    if p_company is null then
        raise exception 'p_company required' using errcode = '22023';
    end if;

    v_fingerprint := md5(jsonb_build_object(
        'p_company', p_company,
        'p_contact', p_contact,
        'p_existing_contact_id', p_existing_contact_id,
        'p_self_contact_id', p_self_contact_id,
        'p_mark_self', p_mark_self
    )::text);

    v_replay := nora_private.idempotency_check('create_customer_with_contact', p_idempotency_key, v_fingerprint);
    if v_replay is not null then
        return v_replay || jsonb_build_object('_meta', jsonb_build_object('disposition', 'replayed'));
    end if;

    select core.company_id, core.contact_id
    into v_company_id, v_contact_id
    from nora_private.create_customer_with_contact_core(
        p_company, null, p_contact, p_existing_contact_id, p_self_contact_id, p_mark_self, true
    ) as core;

    v_result := jsonb_build_object('company_id', v_company_id, 'contact_id', v_contact_id);
    if p_idempotency_key is not null then
        v_result := v_result || jsonb_build_object('_meta', jsonb_build_object('disposition', 'executed'));
    end if;
    return nora_private.idempotency_persist('create_customer_with_contact', p_idempotency_key, v_fingerprint, v_result);
end;
$$;

alter function public.create_customer_with_contact(jsonb, jsonb, bigint, bigint, boolean, uuid) owner to postgres;

comment on function public.create_customer_with_contact(jsonb, jsonb, bigint, bigint, boolean, uuid) is
    'Atomically creates a company and (optionally) a new/existing/self contact. p_self_contact_id links an existing contact as the representing person WITHOUT touching its company_id/is_primary. p_mark_self additionally marks a new/existing contact as self for customer_kind=business (always true for individual). Actor from safe_auth_uid(); requires can_write() (office/admin) — rejection carries DETAIL=NORA_PERMISSION_DENIED (Error Contract Wave, 2026-08-28). Optional p_idempotency_key: same key + same request replays the stored result (no second write); same key + different request raises DETAIL=NORA_IDEMPOTENCY_CONFLICT; null (default) preserves pre-wave behavior (Idempotency Wave, 2026-08-29). When p_idempotency_key is set, the returned jsonb carries _meta.disposition = "executed" | "replayed" (Operation Status Contract Wave, 2026-08-29); omitted entirely when p_idempotency_key is null.';

revoke all on function public.create_customer_with_contact(jsonb, jsonb, bigint, bigint, boolean, uuid) from public;
revoke all on function public.create_customer_with_contact(jsonb, jsonb, bigint, bigint, boolean, uuid) from anon;
grant execute on function public.create_customer_with_contact(jsonb, jsonb, bigint, bigint, boolean, uuid) to authenticated;
grant execute on function public.create_customer_with_contact(jsonb, jsonb, bigint, bigint, boolean, uuid) to service_role;

-- Self Contact Wave (2026-08-26): Quick Capture Application Command RPC.
create or replace function public.create_quick_capture_case(
    p_company jsonb default null,
    p_existing_company_id bigint default null,
    p_contact jsonb default null,
    p_existing_contact_id bigint default null,
    p_self_contact_id bigint default null,
    p_deal jsonb default null,
    p_contact_is_primary boolean default true,
    p_idempotency_key uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_company_id bigint;
    v_contact_id bigint;
    v_deal_id bigint;
    v_deal_name text;
    v_core_existing_contact_id bigint;
    v_reference_contact_id bigint;
    v_fingerprint text;
    v_replay jsonb;
    v_result jsonb;
begin
    if nora_private.safe_auth_uid() is null then
        raise exception 'not authenticated' using errcode = '28000';
    end if;
    if not nora_private.can_write() then
        raise exception 'insufficient privileges' using errcode = '42501', detail = 'NORA_PERMISSION_DENIED';
    end if;
    if p_deal is null then
        raise exception 'p_deal required' using errcode = '22023';
    end if;

    v_fingerprint := md5(jsonb_build_object(
        'p_company', p_company,
        'p_existing_company_id', p_existing_company_id,
        'p_contact', p_contact,
        'p_existing_contact_id', p_existing_contact_id,
        'p_self_contact_id', p_self_contact_id,
        'p_deal', p_deal,
        'p_contact_is_primary', p_contact_is_primary
    )::text);

    v_replay := nora_private.idempotency_check('quick_capture_case.core', p_idempotency_key, v_fingerprint);
    if v_replay is not null then
        return v_replay || jsonb_build_object('_meta', jsonb_build_object('disposition', 'replayed'));
    end if;

    if p_existing_company_id is not null and p_existing_contact_id is not null then
        if not nora_private.is_effective_contact_of_company(p_existing_contact_id, p_existing_company_id) then
            raise exception 'contact % is not part of the effective contact context of company %',
                p_existing_contact_id, p_existing_company_id
                using errcode = '42501', detail = 'NORA_CONTACT_NOT_IN_CUSTOMER_CONTEXT';
        end if;
        -- Already effective — reference as-is, no company_id/is_primary
        -- mutation (picking an existing contact of an already-established
        -- customer record must not silently promote/demote who is primary).
        v_reference_contact_id := p_existing_contact_id;
    else
        v_core_existing_contact_id := p_existing_contact_id;
    end if;

    select core.company_id, core.contact_id
    into v_company_id, v_contact_id
    from nora_private.create_customer_with_contact_core(
        p_company, p_existing_company_id, p_contact, v_core_existing_contact_id, p_self_contact_id, false, p_contact_is_primary
    ) as core;

    if v_reference_contact_id is not null then
        v_contact_id := v_reference_contact_id;
    end if;

    v_deal_name := nullif(btrim(coalesce(p_deal->>'name', '')), '');
    if v_deal_name is null then
        raise exception 'deal name required' using errcode = '22023';
    end if;

    insert into public.deals (
        name, company_id, contact_ids, category, stage, description, amount,
        expected_closing_date, sales_id, index
    ) values (
        v_deal_name,
        v_company_id,
        case when v_contact_id is not null then array[v_contact_id] else array[]::bigint[] end,
        nullif(p_deal->>'category', ''),
        coalesce(nullif(p_deal->>'stage', ''), 'neue-anfrage'),
        nullif(p_deal->>'description', ''),
        coalesce(nullif(p_deal->>'amount', '')::bigint, 0),
        nullif(p_deal->>'expected_closing_date', '')::date,
        nullif(p_deal->>'sales_id', '')::bigint,
        0
    )
    returning id into v_deal_id;

    v_result := jsonb_build_object('company_id', v_company_id, 'contact_id', v_contact_id, 'deal_id', v_deal_id);
    if p_idempotency_key is not null then
        v_result := v_result || jsonb_build_object('_meta', jsonb_build_object('disposition', 'executed'));
    end if;
    return nora_private.idempotency_persist('quick_capture_case.core', p_idempotency_key, v_fingerprint, v_result);
end;
$$;

alter function public.create_quick_capture_case(jsonb, bigint, jsonb, bigint, bigint, jsonb, boolean, uuid) owner to postgres;

comment on function public.create_quick_capture_case(jsonb, bigint, jsonb, bigint, bigint, jsonb, boolean, uuid) is
    'Quick Capture Application Command: Kunde + Kontakt + Vorgang atomically in one transaction. Validates that an existing contact paired with an existing company is already part of its effective contact context (DETAIL=NORA_CONTACT_NOT_IN_CUSTOMER_CONTEXT on rejection). Task creation stays a separate, best-effort step after this call succeeds — see public.create_quick_capture_task for its own idempotency scope under the same key. Actor from safe_auth_uid(); requires can_write() (office/admin) — rejection carries DETAIL=NORA_PERMISSION_DENIED (Error Contract Wave, 2026-08-28). Optional p_idempotency_key covers exactly this Core scope (company+contact+deal); same key + same request replays; same key + different request raises DETAIL=NORA_IDEMPOTENCY_CONFLICT; null (default) preserves pre-wave behavior (Idempotency Wave, 2026-08-29). When p_idempotency_key is set, the returned jsonb carries _meta.disposition = "executed" | "replayed" (Operation Status Contract Wave, 2026-08-29); omitted entirely when p_idempotency_key is null.';

revoke all on function public.create_quick_capture_case(jsonb, bigint, jsonb, bigint, bigint, jsonb, boolean, uuid) from public;
revoke all on function public.create_quick_capture_case(jsonb, bigint, jsonb, bigint, bigint, jsonb, boolean, uuid) from anon;
grant execute on function public.create_quick_capture_case(jsonb, bigint, jsonb, bigint, bigint, jsonb, boolean, uuid) to authenticated;
grant execute on function public.create_quick_capture_case(jsonb, bigint, jsonb, bigint, bigint, jsonb, boolean, uuid) to service_role;

-- Idempotency Wave (2026-08-29): Quick Capture follow-up task creation —
-- deliberately a separate RPC/transaction from create_quick_capture_case
-- (existing best-effort semantics: a failed task must never roll back an
-- already-committed Core write). Own idempotency scope
-- ('quick_capture_case.task') under the SAME idempotency_key as the paired
-- Core call.
create function public.create_quick_capture_task(
    p_company_id bigint,
    p_contact_id bigint default null,
    p_type text default null,
    p_text text default null,
    p_due_date date default null,
    p_sales_id bigint default null,
    p_idempotency_key uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_task_id bigint;
    v_fingerprint text;
    v_replay jsonb;
    v_result jsonb;
begin
    if nora_private.safe_auth_uid() is null then
        raise exception 'not authenticated' using errcode = '28000';
    end if;
    if not nora_private.can_write() then
        raise exception 'insufficient privileges' using errcode = '42501', detail = 'NORA_PERMISSION_DENIED';
    end if;
    if p_company_id is null and p_contact_id is null then
        raise exception 'p_company_id or p_contact_id required' using errcode = '22023';
    end if;

    v_fingerprint := md5(jsonb_build_object(
        'p_company_id', p_company_id,
        'p_contact_id', p_contact_id,
        'p_type', p_type,
        'p_text', p_text,
        'p_due_date', p_due_date,
        'p_sales_id', p_sales_id
    )::text);

    v_replay := nora_private.idempotency_check('quick_capture_case.task', p_idempotency_key, v_fingerprint);
    if v_replay is not null then
        return v_replay || jsonb_build_object('_meta', jsonb_build_object('disposition', 'replayed'));
    end if;

    insert into public.tasks (
        contact_id, company_id, type, text, due_date, sales_id
    ) values (
        p_contact_id, p_company_id, p_type, p_text, p_due_date, p_sales_id
    )
    returning id into v_task_id;

    v_result := jsonb_build_object('task_id', v_task_id);
    if p_idempotency_key is not null then
        v_result := v_result || jsonb_build_object('_meta', jsonb_build_object('disposition', 'executed'));
    end if;
    return nora_private.idempotency_persist('quick_capture_case.task', p_idempotency_key, v_fingerprint, v_result);
end;
$$;

alter function public.create_quick_capture_task(bigint, bigint, text, text, date, bigint, uuid) owner to postgres;

comment on function public.create_quick_capture_task(bigint, bigint, text, text, date, bigint, uuid) is
    'Quick Capture follow-up task creation — deliberately a separate RPC/transaction from create_quick_capture_case (best-effort semantics: a failed task must never roll back an already-committed Core write). Optional p_idempotency_key should reuse the SAME key as the paired create_quick_capture_case call but is checked under its own scope (quick_capture_case.task); same key + same request replays the existing task (no duplicate); same key + different request raises DETAIL=NORA_IDEMPOTENCY_CONFLICT; a technically failed attempt (no committed row) leaves the key freely retriable. Actor from safe_auth_uid(); requires can_write() (Idempotency Wave, 2026-08-29). When p_idempotency_key is set, the returned jsonb carries _meta.disposition = "executed" | "replayed" (Operation Status Contract Wave, 2026-08-29); omitted entirely when p_idempotency_key is null.';

revoke all on function public.create_quick_capture_task(bigint, bigint, text, text, date, bigint, uuid) from public;
revoke all on function public.create_quick_capture_task(bigint, bigint, text, text, date, bigint, uuid) from anon;
grant execute on function public.create_quick_capture_task(bigint, bigint, text, text, date, bigint, uuid) to authenticated;
grant execute on function public.create_quick_capture_task(bigint, bigint, text, text, date, bigint, uuid) to service_role;

-- ===========================================================================
-- Atomic Contact Primary Intent (2026-09-08) — migration
-- 20260908120000_nora_atomic_contact_primary_intent.sql (kept in sync).
-- Hauptansprechpartner is a business transition, not a raw is_primary write:
-- create_contact / update_contact + the shared private transition core;
-- set_primary_contact is re-defined below on the same core.
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- 1. Deterministic customer row locking
-- ---------------------------------------------------------------------------

create or replace function nora_private.lock_customers_for_primary_transition(
    p_company_ids bigint[]
)
returns void
language plpgsql
set search_path = ''
as $$
declare
    v_expected int;
    v_found int;
    r record;
begin
    if p_company_ids is null then
        return;
    end if;

    select count(distinct id) into v_expected
    from unnest(p_company_ids) as t(id)
    where id is not null;

    if v_expected = 0 then
        return;
    end if;

    -- Ascending customer-id order for every caller => two transactions that
    -- touch the same pair of customers can never take the pair in opposite
    -- order.
    for r in
        select distinct id
        from unnest(p_company_ids) as t(id)
        where id is not null
        order by id
    loop
        perform pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtext('nora_primary_contact'),
            pg_catalog.hashtext(r.id::text)
        );
    end loop;

    -- The customer must exist. This is a plain read: the serialization above
    -- is the mutex, and public.contacts.company_id's foreign key remains the
    -- integrity guarantee.
    select count(distinct c.id) into v_found
    from public.companies c
    where c.id = any(p_company_ids);

    if v_found <> v_expected then
        raise exception 'customer not found for primary-contact transition'
            using errcode = 'P0002';
    end if;
end;
$$;

alter function nora_private.lock_customers_for_primary_transition(bigint[]) owner to postgres;

comment on function nora_private.lock_customers_for_primary_transition(bigint[]) is
    'Atomic Contact Primary Intent (2026-09-08, second blocker fix): serializes primary-contact transitions PER CUSTOMER with a transaction-scoped advisory lock (namespace nora_primary_contact), taken in ascending customer-id order so two-customer moves cannot invert. Deliberately NOT a public.companies row lock: the customer row is also locked, unavoidably contact-row-FIRST, by the sync_individual_company_name trigger and by contacts.company_id foreign-key KEY SHARE probes, so a row-lock mutex here is a lock-order cycle by construction. Callers must take these locks BEFORE locking or writing any contact row. Raises P0002 when a customer id does not exist. Internal - callers are the SECURITY DEFINER contact commands.';

revoke all on function nora_private.lock_customers_for_primary_transition(bigint[]) from public;
revoke all on function nora_private.lock_customers_for_primary_transition(bigint[]) from anon;
revoke all on function nora_private.lock_customers_for_primary_transition(bigint[]) from authenticated;
revoke all on function nora_private.lock_customers_for_primary_transition(bigint[]) from service_role;

-- The row-lock helper of the first blocker fix is superseded and removed so no
-- caller can accidentally reintroduce the customer-row-lock mutex.
drop function if exists nora_private.lock_companies_for_primary_transition(bigint[]);

-- ---------------------------------------------------------------------------
-- 2. The one authoritative primary-contact transition core
-- ---------------------------------------------------------------------------
-- Prepares the "primary slot" of one customer for p_target_contact_id:
--   * takes the customer's transition lock (idempotent within the txn),
--   * reads the ACTUAL current primary under that lock,
--   * returns NULL without touching anything when the target already holds it,
--   * with p_verify_expected: refuses (NORA_PRIMARY_CONTACT_CHANGED) when the
--     actual holder differs from the holder the caller observed
--     (p_expected_primary_contact_id NULL = "the user observed no primary"),
--   * demotes the previous holder and returns its id.
-- The caller then writes the target in its FINAL state (INSERT ... is_primary
-- = true, or UPDATE ... is_primary = true) inside the same transaction.
-- p_target_contact_id may be NULL for a contact that does not exist yet.

create or replace function nora_private.prepare_primary_contact_slot(
    p_company_id bigint,
    p_target_contact_id bigint,
    p_expected_primary_contact_id bigint,
    p_verify_expected boolean
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
    v_actual_primary_id bigint;
begin
    if p_company_id is null then
        raise exception 'a primary contact requires a customer' using errcode = '22023';
    end if;

    perform nora_private.lock_customers_for_primary_transition(array[p_company_id]);

    select c.id into v_actual_primary_id
    from public.contacts c
    where c.company_id = p_company_id
      and c.is_primary
    order by c.id
    limit 1
    for update;

    if v_actual_primary_id is not null
       and p_target_contact_id is not null
       and v_actual_primary_id = p_target_contact_id then
        -- Already the primary: nothing to demote, nothing to verify — the
        -- user's intent is satisfied (this is what makes a retried
        -- make_primary naturally idempotent).
        return null;
    end if;

    if p_verify_expected
       and v_actual_primary_id is distinct from p_expected_primary_contact_id then
        raise exception 'primary contact of customer % changed since the form was loaded', p_company_id
            using errcode = 'P0001', detail = 'NORA_PRIMARY_CONTACT_CHANGED';
    end if;

    if v_actual_primary_id is not null then
        update public.contacts
        set is_primary = false
        where id = v_actual_primary_id;
        return v_actual_primary_id;
    end if;

    return null;
end;
$$;

alter function nora_private.prepare_primary_contact_slot(bigint, bigint, bigint, boolean) owner to postgres;

comment on function nora_private.prepare_primary_contact_slot(bigint, bigint, bigint, boolean) is
    'Atomic Contact Primary Intent (2026-09-08): the single implementation of "demote the previous Hauptansprechpartner so the target can take the slot". Locks the customer row, re-reads the actual holder under the lock, is a no-op when the target already holds the slot, optionally verifies the holder the user observed (DETAIL = NORA_PRIMARY_CONTACT_CHANGED on mismatch), demotes the previous holder and returns its id (NULL when nothing was demoted). Callers establish auth/can_write() themselves and write the target in its final state inside the same transaction. Do not reimplement this step elsewhere.';

revoke all on function nora_private.prepare_primary_contact_slot(bigint, bigint, bigint, boolean) from public;
revoke all on function nora_private.prepare_primary_contact_slot(bigint, bigint, bigint, boolean) from anon;
revoke all on function nora_private.prepare_primary_contact_slot(bigint, bigint, bigint, boolean) from authenticated;
revoke all on function nora_private.prepare_primary_contact_slot(bigint, bigint, bigint, boolean) from service_role;

-- ---------------------------------------------------------------------------
-- 3. Shared payload helpers (explicit allowlist — never a generic row mutation)
-- ---------------------------------------------------------------------------

-- JSON null and a missing key both become SQL NULL; only real JSON values pass.
create or replace function nora_private.contact_payload_jsonb(p_payload jsonb, p_key text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
    select case
        when p_payload is null or not (p_payload ? p_key) then null
        when jsonb_typeof(p_payload -> p_key) = 'null' then null
        else p_payload -> p_key
    end;
$$;

alter function nora_private.contact_payload_jsonb(jsonb, text) owner to postgres;
revoke all on function nora_private.contact_payload_jsonb(jsonb, text) from public;
revoke all on function nora_private.contact_payload_jsonb(jsonb, text) from anon;
revoke all on function nora_private.contact_payload_jsonb(jsonb, text) from authenticated;
revoke all on function nora_private.contact_payload_jsonb(jsonb, text) from service_role;

create or replace function nora_private.contact_payload_tags(p_payload jsonb, p_key text)
returns bigint[]
language sql
immutable
set search_path = ''
as $$
    select case
        when jsonb_typeof(nora_private.contact_payload_jsonb(p_payload, p_key)) = 'array' then
            coalesce(
                (select array_agg(t.value::bigint order by t.ordinality)
                 from jsonb_array_elements_text(p_payload -> p_key) with ordinality as t(value, ordinality)),
                '{}'::bigint[]
            )
        else null
    end;
$$;

alter function nora_private.contact_payload_tags(jsonb, text) owner to postgres;
revoke all on function nora_private.contact_payload_tags(jsonb, text) from public;
revoke all on function nora_private.contact_payload_tags(jsonb, text) from anon;
revoke all on function nora_private.contact_payload_tags(jsonb, text) from authenticated;
revoke all on function nora_private.contact_payload_tags(jsonb, text) from service_role;

create or replace function nora_private.assert_contact_primary_intent(p_intent text, p_for_create boolean)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
    if p_intent is null or p_intent not in ('keep', 'make_primary', 'clear') then
        raise exception 'unknown primary intent' using errcode = '22023';
    end if;
    if p_for_create and p_intent = 'clear' then
        raise exception 'a new contact cannot clear a primary it never held' using errcode = '22023';
    end if;
end;
$$;

alter function nora_private.assert_contact_primary_intent(text, boolean) owner to postgres;
revoke all on function nora_private.assert_contact_primary_intent(text, boolean) from public;
revoke all on function nora_private.assert_contact_primary_intent(text, boolean) from anon;
revoke all on function nora_private.assert_contact_primary_intent(text, boolean) from authenticated;
revoke all on function nora_private.assert_contact_primary_intent(text, boolean) from service_role;

-- ---------------------------------------------------------------------------
-- 4. public.create_contact — one atomic CREATE with explicit primary intent
-- ---------------------------------------------------------------------------
-- p_primary_intent: 'keep' (ordinary, non-primary contact) | 'make_primary'.
-- p_expected_primary_contact_id: the current Hauptansprechpartner the user
--   saw in the form for the target customer (NULL = "none"). Verified under
--   the customer lock for 'make_primary'; ignored for 'keep'.
-- p_idempotency_key: same key + same request replays the stored result (no
--   second INSERT, _meta.disposition = "replayed"); same key + different
--   request raises DETAIL = NORA_IDEMPOTENCY_CONFLICT. The volatile
--   first_seen/last_seen client timestamps are excluded from the fingerprint
--   so a genuine retry of the same form submit is recognized as such.
-- Writable fields are allowlisted; is_primary is NEVER read from p_contact —
-- only the intent moves it. Unknown keys (view columns, UI helpers) are
-- ignored.

-- Atomic Contact Primary Intent blocker fix (2026-09-08): the idempotency
-- fingerprint of public.create_contact must describe the BUSINESS request the
-- RPC actually executes, not the raw client JSON. Two submits that differ only
-- in keys create_contact ignores anyway (view columns such as company_name, UI
-- helper fields) are the same request and must replay; a difference in any
-- writable field must still raise NORA_IDEMPOTENCY_CONFLICT. first_seen and
-- last_seen stay excluded on purpose (volatile client timestamps that default
-- to now()). jsonb normalizes key order, so this projection is canonical.
create or replace function nora_private.contact_create_fingerprint_payload(p_contact jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
    select jsonb_build_object(
        'first_name',     p_contact->>'first_name',
        'last_name',      p_contact->>'last_name',
        'gender',         p_contact->>'gender',
        'title',          p_contact->>'title',
        'background',     p_contact->>'background',
        'avatar',         nora_private.contact_payload_jsonb(p_contact, 'avatar'),
        'has_newsletter', nullif(p_contact->>'has_newsletter', '')::boolean,
        'status',         p_contact->>'status',
        'tags',           nora_private.contact_payload_tags(p_contact, 'tags'),
        'company_id',     nullif(p_contact->>'company_id', '')::bigint,
        'sales_id',       nullif(p_contact->>'sales_id', '')::bigint,
        'linkedin_url',   p_contact->>'linkedin_url',
        'email_jsonb',    nora_private.contact_payload_jsonb(p_contact, 'email_jsonb'),
        'phone_jsonb',    nora_private.contact_payload_jsonb(p_contact, 'phone_jsonb'),
        'links_jsonb',    coalesce(nora_private.contact_payload_jsonb(p_contact, 'links_jsonb'), '[]'::jsonb)
    );
$$;

alter function nora_private.contact_create_fingerprint_payload(jsonb) owner to postgres;

comment on function nora_private.contact_create_fingerprint_payload(jsonb) is
    'Atomic Contact Primary Intent (2026-09-08): canonical, allowlisted projection of a create_contact payload - exactly the writable fields public.create_contact consumes, minus the volatile first_seen/last_seen. Used for the idempotency fingerprint so unknown/ignored client keys cannot turn one business request into an idempotency conflict.';

revoke all on function nora_private.contact_create_fingerprint_payload(jsonb) from public;
revoke all on function nora_private.contact_create_fingerprint_payload(jsonb) from anon;
revoke all on function nora_private.contact_create_fingerprint_payload(jsonb) from authenticated;
revoke all on function nora_private.contact_create_fingerprint_payload(jsonb) from service_role;

create or replace function public.create_contact(
    p_contact jsonb,
    p_primary_intent text default 'keep',
    p_expected_primary_contact_id bigint default null,
    p_idempotency_key uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_company_id bigint;
    v_is_primary boolean := false;
    v_demoted_contact_id bigint;
    v_row public.contacts;
    v_fingerprint text;
    v_replay jsonb;
    v_result jsonb;
    v_constraint_name text;
begin
    if nora_private.safe_auth_uid() is null then
        raise exception 'not authenticated' using errcode = '28000';
    end if;
    if not nora_private.can_write() then
        raise exception 'insufficient privileges' using errcode = '42501', detail = 'NORA_PERMISSION_DENIED';
    end if;
    if p_contact is null or jsonb_typeof(p_contact) <> 'object' then
        raise exception 'p_contact required' using errcode = '22023';
    end if;
    perform nora_private.assert_contact_primary_intent(p_primary_intent, true);

    v_company_id := nullif(p_contact->>'company_id', '')::bigint;
    if p_primary_intent = 'make_primary' and v_company_id is null then
        raise exception 'a primary contact requires a customer' using errcode = '22023';
    end if;

    v_fingerprint := md5(jsonb_build_object(
        'p_contact', nora_private.contact_create_fingerprint_payload(p_contact),
        'p_primary_intent', p_primary_intent,
        'p_expected_primary_contact_id', p_expected_primary_contact_id
    )::text);

    v_replay := nora_private.idempotency_check('contact.create', p_idempotency_key, v_fingerprint);
    if v_replay is not null then
        return v_replay || jsonb_build_object('_meta', jsonb_build_object('disposition', 'replayed'));
    end if;

    <<main>>
    begin
        if p_primary_intent = 'make_primary' then
            v_demoted_contact_id := nora_private.prepare_primary_contact_slot(
                v_company_id, null, p_expected_primary_contact_id, true
            );
            v_is_primary := true;
        elsif v_company_id is not null then
            -- Ordinary contact: still lock the customer so a concurrent
            -- make_primary cannot interleave with this insert.
            perform nora_private.lock_customers_for_primary_transition(array[v_company_id]);
        end if;

        insert into public.contacts (
            first_name, last_name, gender, title, background, avatar,
            first_seen, last_seen, has_newsletter, status, tags,
            company_id, sales_id, linkedin_url, email_jsonb, phone_jsonb, links_jsonb,
            is_primary
        ) values (
            p_contact->>'first_name',
            p_contact->>'last_name',
            p_contact->>'gender',
            p_contact->>'title',
            p_contact->>'background',
            nora_private.contact_payload_jsonb(p_contact, 'avatar'),
            coalesce(nullif(p_contact->>'first_seen', '')::timestamptz, now()),
            coalesce(nullif(p_contact->>'last_seen', '')::timestamptz, now()),
            nullif(p_contact->>'has_newsletter', '')::boolean,
            p_contact->>'status',
            nora_private.contact_payload_tags(p_contact, 'tags'),
            v_company_id,
            nullif(p_contact->>'sales_id', '')::bigint,
            p_contact->>'linkedin_url',
            nora_private.contact_payload_jsonb(p_contact, 'email_jsonb'),
            nora_private.contact_payload_jsonb(p_contact, 'phone_jsonb'),
            coalesce(nora_private.contact_payload_jsonb(p_contact, 'links_jsonb'), '[]'::jsonb),
            v_is_primary
        )
        returning * into v_row;
    exception
        when unique_violation then
            get stacked diagnostics v_constraint_name = constraint_name;
            if v_constraint_name = 'uq_contacts_one_primary_per_company' then
                raise exception 'customer % already has a primary contact', v_company_id
                    using errcode = '23505', detail = 'NORA_PRIMARY_CONTACT_ALREADY_EXISTS';
            end if;
            raise;
    end main;

    v_result := jsonb_build_object(
        'contact_id', v_row.id,
        'contact', to_jsonb(v_row),
        'demoted_contact_id', v_demoted_contact_id
    );
    if p_idempotency_key is not null then
        v_result := v_result || jsonb_build_object('_meta', jsonb_build_object('disposition', 'executed'));
    end if;
    return nora_private.idempotency_persist('contact.create', p_idempotency_key, v_fingerprint, v_result);
end;
$$;

alter function public.create_contact(jsonb, text, bigint, uuid) owner to postgres;

comment on function public.create_contact(jsonb, text, bigint, uuid) is
    'Atomic Contact Primary Intent (2026-09-08): creates one contact and applies the explicit Hauptansprechpartner intent (keep | make_primary) in ONE transaction. make_primary takes the per-customer transition lock, verifies the primary the user observed (p_expected_primary_contact_id, NULL = none; mismatch → DETAIL = NORA_PRIMARY_CONTACT_CHANGED), demotes the previous holder and inserts the new contact in its final is_primary = true state (audit: one contact.updated for the demoted holder, one contact.created with is_primary = true). Writable fields are allowlisted; is_primary is never read from p_contact. Residual uq_contacts_one_primary_per_company hit → DETAIL = NORA_PRIMARY_CONTACT_ALREADY_EXISTS. Optional p_idempotency_key (scope contact.create, first_seen/last_seen excluded from the fingerprint): replay returns the stored result with _meta.disposition = "replayed", a different request under the same key raises DETAIL = NORA_IDEMPOTENCY_CONFLICT. Actor from safe_auth_uid(); requires can_write() (DETAIL = NORA_PERMISSION_DENIED). Returns {contact_id, contact, demoted_contact_id, _meta?}.';

revoke all on function public.create_contact(jsonb, text, bigint, uuid) from public;
revoke all on function public.create_contact(jsonb, text, bigint, uuid) from anon;
revoke all on function public.create_contact(jsonb, text, bigint, uuid) from authenticated;
revoke all on function public.create_contact(jsonb, text, bigint, uuid) from service_role;
grant execute on function public.create_contact(jsonb, text, bigint, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. public.update_contact — one atomic UPDATE with explicit primary intent
-- ---------------------------------------------------------------------------
-- p_patch: only the keys present are applied (allowlist below); a present
--   key with JSON null clears the column. is_primary is never read from the
--   patch. Unknown keys are ignored.
-- Intent resolution against the TARGET customer (after applying company_id
-- from the patch):
--   keep         → is_primary unchanged for the same customer; forced to
--                  false when the contact moves to another customer or
--                  loses its customer (a primary flag never travels silently)
--   make_primary → lock target customer, verify observed holder, demote it,
--                  set is_primary = true (no-op when already primary)
--   clear        → is_primary = false
-- company_id NULL always implies is_primary = false; make_primary without a
-- customer is rejected. Customers are locked in ascending id order (old and
-- new) BEFORE the contact row, so a concurrent make_primary on either
-- customer serializes with this move instead of deadlocking.
-- Updates are naturally idempotent (a retry re-applies the same final
-- state; a retried make_primary sees the target already primary and does
-- nothing), so no idempotency key is needed here.

create or replace function public.update_contact(
    p_contact_id bigint,
    p_patch jsonb,
    p_primary_intent text default 'keep',
    p_expected_primary_contact_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_old public.contacts;
    v_new public.contacts;
    v_pre_company_id bigint;
    v_target_company_id bigint;
    v_company_changed boolean;
    v_is_primary boolean;
    v_demoted_contact_id bigint;
    v_lock_ids bigint[];
    v_attempt int := 0;
    v_constraint_name text;
begin
    if nora_private.safe_auth_uid() is null then
        raise exception 'not authenticated' using errcode = '28000';
    end if;
    if not nora_private.can_write() then
        raise exception 'insufficient privileges' using errcode = '42501', detail = 'NORA_PERMISSION_DENIED';
    end if;
    if p_contact_id is null then
        raise exception 'p_contact_id required' using errcode = '22023';
    end if;
    if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
        raise exception 'p_patch required' using errcode = '22023';
    end if;
    perform nora_private.assert_contact_primary_intent(p_primary_intent, false);

    <<main>>
    begin
        -- Order: the customers' transition locks (ascending id) first, then
        -- the contact row. The
        -- contact's current customer is read without a lock first; if it
        -- moved concurrently before we hold its row, the additional customer
        -- is locked and the read repeated (bounded).
        loop
            v_attempt := v_attempt + 1;
            select c.company_id into v_pre_company_id from public.contacts c where c.id = p_contact_id;
            if not found then
                raise exception 'contact not found: %', p_contact_id using errcode = 'P0002';
            end if;

            v_target_company_id := case
                when p_patch ? 'company_id' then nullif(p_patch->>'company_id', '')::bigint
                else v_pre_company_id
            end;

            v_lock_ids := array_remove(array[v_pre_company_id, v_target_company_id], null);
            perform nora_private.lock_customers_for_primary_transition(v_lock_ids);

            select * into v_old from public.contacts c where c.id = p_contact_id for update;
            if not found then
                raise exception 'contact not found: %', p_contact_id using errcode = 'P0002';
            end if;

            exit when v_old.company_id is not distinct from v_pre_company_id;
            if v_attempt >= 3 then
                raise exception 'contact % moved concurrently; retry', p_contact_id using errcode = '40001';
            end if;
        end loop;

        if not (p_patch ? 'company_id') then
            v_target_company_id := v_old.company_id;
        end if;
        v_company_changed := v_target_company_id is distinct from v_old.company_id;

        if v_target_company_id is null then
            if p_primary_intent = 'make_primary' then
                raise exception 'a primary contact requires a customer' using errcode = '22023';
            end if;
            v_is_primary := false;
        elsif p_primary_intent = 'make_primary' then
            v_demoted_contact_id := nora_private.prepare_primary_contact_slot(
                v_target_company_id, p_contact_id, p_expected_primary_contact_id, true
            );
            v_is_primary := true;
        elsif p_primary_intent = 'clear' then
            v_is_primary := false;
        else
            v_is_primary := case when v_company_changed then false else v_old.is_primary end;
        end if;

        update public.contacts c
        set first_name    = case when p_patch ? 'first_name'    then p_patch->>'first_name'    else c.first_name end,
            last_name     = case when p_patch ? 'last_name'     then p_patch->>'last_name'     else c.last_name end,
            gender        = case when p_patch ? 'gender'        then p_patch->>'gender'        else c.gender end,
            title         = case when p_patch ? 'title'         then p_patch->>'title'         else c.title end,
            background    = case when p_patch ? 'background'    then p_patch->>'background'    else c.background end,
            avatar        = case when p_patch ? 'avatar'        then nora_private.contact_payload_jsonb(p_patch, 'avatar') else c.avatar end,
            first_seen    = case when p_patch ? 'first_seen'    then nullif(p_patch->>'first_seen', '')::timestamptz else c.first_seen end,
            last_seen     = case when p_patch ? 'last_seen'     then nullif(p_patch->>'last_seen', '')::timestamptz  else c.last_seen end,
            has_newsletter = case when p_patch ? 'has_newsletter' then nullif(p_patch->>'has_newsletter', '')::boolean else c.has_newsletter end,
            status        = case when p_patch ? 'status'        then p_patch->>'status'        else c.status end,
            tags          = case when p_patch ? 'tags'          then nora_private.contact_payload_tags(p_patch, 'tags') else c.tags end,
            company_id    = v_target_company_id,
            sales_id      = case when p_patch ? 'sales_id'      then nullif(p_patch->>'sales_id', '')::bigint else c.sales_id end,
            linkedin_url  = case when p_patch ? 'linkedin_url'  then p_patch->>'linkedin_url'  else c.linkedin_url end,
            email_jsonb   = case when p_patch ? 'email_jsonb'   then nora_private.contact_payload_jsonb(p_patch, 'email_jsonb') else c.email_jsonb end,
            phone_jsonb   = case when p_patch ? 'phone_jsonb'   then nora_private.contact_payload_jsonb(p_patch, 'phone_jsonb') else c.phone_jsonb end,
            links_jsonb   = case when p_patch ? 'links_jsonb'   then coalesce(nora_private.contact_payload_jsonb(p_patch, 'links_jsonb'), '[]'::jsonb) else c.links_jsonb end,
            is_primary    = v_is_primary
        where c.id = p_contact_id
        returning * into v_new;
    exception
        when unique_violation then
            get stacked diagnostics v_constraint_name = constraint_name;
            if v_constraint_name = 'uq_contacts_one_primary_per_company' then
                raise exception 'customer % already has a primary contact', v_target_company_id
                    using errcode = '23505', detail = 'NORA_PRIMARY_CONTACT_ALREADY_EXISTS';
            end if;
            raise;
    end main;

    return jsonb_build_object(
        'contact_id', v_new.id,
        'contact', to_jsonb(v_new),
        'demoted_contact_id', v_demoted_contact_id
    );
end;
$$;

alter function public.update_contact(bigint, jsonb, text, bigint) owner to postgres;

comment on function public.update_contact(bigint, jsonb, text, bigint) is
    'Atomic Contact Primary Intent (2026-09-08): updates one contact (allowlisted keys of p_patch; present key = applied, JSON null = cleared, unknown keys ignored, is_primary never read from the patch) and applies the explicit Hauptansprechpartner intent (keep | make_primary | clear) against the TARGET customer in ONE transaction. Locks old and new customer in ascending id order before the contact row. keep: primary flag unchanged for the same customer, forced to false on a customer move or when the customer is removed; make_primary: verifies the observed holder (p_expected_primary_contact_id, NULL = none; mismatch → DETAIL = NORA_PRIMARY_CONTACT_CHANGED), demotes it and sets the contact primary (no-op when already primary — naturally idempotent); clear: is_primary = false. company_id NULL always yields is_primary = false. Residual uq_contacts_one_primary_per_company hit → DETAIL = NORA_PRIMARY_CONTACT_ALREADY_EXISTS. Actor from safe_auth_uid(); requires can_write() (DETAIL = NORA_PERMISSION_DENIED). Returns {contact_id, contact, demoted_contact_id}.';

revoke all on function public.update_contact(bigint, jsonb, text, bigint) from public;
revoke all on function public.update_contact(bigint, jsonb, text, bigint) from anon;
revoke all on function public.update_contact(bigint, jsonb, text, bigint) from authenticated;
revoke all on function public.update_contact(bigint, jsonb, text, bigint) from service_role;
grant execute on function public.update_contact(bigint, jsonb, text, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. public.set_primary_contact — same signature, same grants, same contract
--    (no observed-holder verification), now on the shared transition core
--    so the demote/promote rule has exactly one implementation.
-- ---------------------------------------------------------------------------

create or replace function public.set_primary_contact(p_contact_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_company_id bigint;
begin
    if nora_private.safe_auth_uid() is null then
        raise exception 'not authenticated' using errcode = '28000';
    end if;
    if not nora_private.can_write() then
        raise exception 'insufficient privileges' using errcode = '42501', detail = 'NORA_PERMISSION_DENIED';
    end if;

    select company_id into v_company_id from public.contacts where id = p_contact_id;
    if not found then
        raise exception 'contact not found: %', p_contact_id using errcode = 'P0002';
    end if;
    if v_company_id is null then
        raise exception 'contact has no company: %', p_contact_id using errcode = '22023';
    end if;

    perform nora_private.prepare_primary_contact_slot(v_company_id, p_contact_id, null, false);

    update public.contacts
    set is_primary = true
    where id = p_contact_id
      and not is_primary;
end;
$$;

alter function public.set_primary_contact(bigint) owner to postgres;

comment on function public.set_primary_contact(bigint) is
    'Atomically makes p_contact_id the sole Hauptansprechpartner of its company (no observed-holder verification — callers that know which holder the user saw use create_contact/update_contact with make_primary). Since 2026-09-08 implemented on nora_private.prepare_primary_contact_slot (per-customer transition lock + single demote rule). Requires can_write() (office/admin) — rejection carries DETAIL = NORA_PERMISSION_DENIED.';

-- Grants intentionally unchanged (authenticated + service_role, as released
-- 2026-08-25) — re-stated explicitly so this migration is self-describing.
revoke all on function public.set_primary_contact(bigint) from public;
revoke all on function public.set_primary_contact(bigint) from anon;
grant execute on function public.set_primary_contact(bigint) to authenticated;
grant execute on function public.set_primary_contact(bigint) to service_role;


-- ---------------------------------------------------------------------------
-- Nora User Lifecycle W4 (2026-09-06): controlled login-email change
-- (migration 20260906120000_nora_lifecycle_email_change.sql)
-- ---------------------------------------------------------------------------

create or replace function nora_private.normalize_login_email(p_email text)
returns extensions.citext
language plpgsql
immutable
set search_path = ''
as $$
declare
    v text;
begin
    v := lower(btrim(coalesce(p_email, '')));
    if v = '' or char_length(v) > 255
       or v !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    then
        raise exception 'invalid login email'
            using errcode = '22023', detail = 'NORA_EMAIL_INVALID';
    end if;
    return v::extensions.citext;
end;
$$;

alter function nora_private.normalize_login_email(text) owner to postgres;

revoke all on function nora_private.normalize_login_email(text) from public;
revoke all on function nora_private.normalize_login_email(text) from anon;
revoke all on function nora_private.normalize_login_email(text) from authenticated;
revoke all on function nora_private.normalize_login_email(text) from service_role;
grant execute on function nora_private.normalize_login_email(text) to postgres;

comment on function nora_private.normalize_login_email(text) is
    'W4: canonical login email = lower(btrim(x)), 1..255 chars, one @, a dot in the domain. Raises NORA_EMAIL_INVALID. Mirrors what GoTrue stores.';

create or replace function nora_private.apply_sales_email_change(
    p_sale_id bigint,
    p_email extensions.citext
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.sales
    set email = p_email
    where id = p_sale_id;

    if not found then
        raise exception 'sales profile not found: %', p_sale_id using errcode = 'P0002';
    end if;
end;
$$;

alter function nora_private.apply_sales_email_change(bigint, extensions.citext) owner to nora_identity_manager;

revoke all on function nora_private.apply_sales_email_change(bigint, extensions.citext) from public;
revoke all on function nora_private.apply_sales_email_change(bigint, extensions.citext) from anon;
revoke all on function nora_private.apply_sales_email_change(bigint, extensions.citext) from authenticated;
revoke all on function nora_private.apply_sales_email_change(bigint, extensions.citext) from service_role;
grant execute on function nora_private.apply_sales_email_change(bigint, extensions.citext) to postgres;

comment on function nora_private.apply_sales_email_change(bigint, extensions.citext) is
    'W4 internal: updates sales.email as nora_identity_manager. Called only by guard_auth_email_change inside GoTrue''s transaction. Not callable via Data API.';

create or replace function public.prepare_sales_email_change(
    p_actor_user_id uuid,
    p_sale_id bigint,
    p_new_email text,
    p_operation_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_actor public.sales%rowtype;
    v_target public.sales%rowtype;
    v_auth_email text;
    v_auth_confirmed boolean;
    v_auth_banned boolean;
    v_new extensions.citext;
    v_ticket_id uuid;
begin
    -- Trust boundary: only the privileged server executor may call this.
    if coalesce(nora_private.safe_auth_role(), '') <> 'service_role' then
        raise exception 'forbidden'
            using errcode = '42501', detail = 'NORA_PERMISSION_DENIED';
    end if;

    if p_actor_user_id is null then
        raise exception 'actor required' using errcode = '22023';
    end if;
    if p_sale_id is null then
        raise exception 'target required' using errcode = '22023';
    end if;

    -- The actor parameter never creates privilege: an existing, active admin.
    select * into v_actor from public.sales where user_id = p_actor_user_id;
    if not found or v_actor.role <> 'admin' or v_actor.disabled then
        raise exception 'forbidden'
            using errcode = '42501', detail = 'NORA_PERMISSION_DENIED';
    end if;

    v_new := nora_private.normalize_login_email(p_new_email);

    select * into v_target from public.sales where id = p_sale_id for update;
    if not found then
        raise exception 'sales profile not found: %', p_sale_id
            using errcode = 'P0002';
    end if;

    -- Self guard: an administrator does not change their own login identity
    -- through the lifecycle path (a typo would lock out the only admin).
    if v_target.user_id = p_actor_user_id then
        raise exception 'administrators cannot change their own login email'
            using errcode = '42501', detail = 'NORA_SELF_EMAIL_CHANGE_FORBIDDEN';
    end if;

    -- Identity must be resolvable and consistent before it is moved.
    select u.email,
           (u.email_confirmed_at is not null),
           (u.banned_until is not null and u.banned_until > now())
      into v_auth_email, v_auth_confirmed, v_auth_banned
      from auth.users u
     where u.id = v_target.user_id;
    if not found then
        raise exception 'auth identity missing for sales %', p_sale_id
            using errcode = 'P0002', detail = 'NORA_EMPLOYEE_AUTH_NOT_FOUND';
    end if;
    if lower(btrim(coalesce(v_auth_email, ''))) <> lower(btrim(v_target.email::text)) then
        raise exception 'auth email and sales email differ for sales %', p_sale_id
            using errcode = '23514', detail = 'NORA_EMPLOYEE_IDENTITY_INCONSISTENT';
    end if;

    if v_target.email = v_new then
        raise exception 'login email unchanged'
            using errcode = '22023', detail = 'NORA_EMAIL_UNCHANGED';
    end if;

    -- Uniqueness across both identity stores (provider-equivalent normalisation).
    if exists (select 1 from public.sales s where s.email = v_new and s.id <> v_target.id)
       or exists (select 1 from auth.users u where lower(u.email) = v_new::text and u.id <> v_target.user_id)
    then
        raise exception 'login email already in use'
            using errcode = '23505', detail = 'NORA_EMAIL_ALREADY_IN_USE';
    end if;

    -- Housekeeping, then exactly one live ticket for this employee.
    delete from nora_private.sales_email_change_tickets where expires_at <= now();
    delete from nora_private.sales_email_change_tickets where sale_id = v_target.id;

    insert into nora_private.sales_email_change_tickets
        (sale_id, user_id, old_email, new_email, actor_user_id, operation_id, expires_at)
    values
        (v_target.id, v_target.user_id, v_target.email, v_new, p_actor_user_id, p_operation_id, now() + interval '2 minutes')
    returning id into v_ticket_id;

    return jsonb_build_object(
        'ticket_id', v_ticket_id,
        'sale_id', v_target.id,
        'user_id', v_target.user_id,
        'old_email', v_target.email::text,
        'new_email', v_new::text,
        'role', v_target.role,
        'disabled', v_target.disabled,
        'auth_confirmed', v_auth_confirmed,
        'auth_banned', v_auth_banned
    );
end;
$$;

alter function public.prepare_sales_email_change(uuid, bigint, text, uuid) owner to postgres;

comment on function public.prepare_sales_email_change(uuid, bigint, text, uuid) is
    'W4 lifecycle executor step 1: service_role only. p_actor_user_id must be an active admin (verified by the users Edge Function from the caller JWT). Validates and normalises the address, refuses self changes (NORA_SELF_EMAIL_CHANGE_FORBIDDEN), unchanged (NORA_EMAIL_UNCHANGED), used (NORA_EMAIL_ALREADY_IN_USE), invalid (NORA_EMAIL_INVALID) addresses and inconsistent identities (NORA_EMPLOYEE_AUTH_NOT_FOUND / NORA_EMPLOYEE_IDENTITY_INCONSISTENT), then writes the ticket guard_auth_email_change consumes. Changes nothing about the employee itself.';

revoke all on function public.prepare_sales_email_change(uuid, bigint, text, uuid) from public;
revoke all on function public.prepare_sales_email_change(uuid, bigint, text, uuid) from anon;
revoke all on function public.prepare_sales_email_change(uuid, bigint, text, uuid) from authenticated;
grant execute on function public.prepare_sales_email_change(uuid, bigint, text, uuid) to service_role;

create or replace function public.cancel_sales_email_change(p_ticket_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_deleted integer;
begin
    if coalesce(nora_private.safe_auth_role(), '') <> 'service_role' then
        raise exception 'forbidden'
            using errcode = '42501', detail = 'NORA_PERMISSION_DENIED';
    end if;
    if p_ticket_id is null then
        raise exception 'ticket required' using errcode = '22023';
    end if;

    delete from nora_private.sales_email_change_tickets where id = p_ticket_id;
    get diagnostics v_deleted = row_count;
    return v_deleted > 0;
end;
$$;

alter function public.cancel_sales_email_change(uuid) owner to postgres;

comment on function public.cancel_sales_email_change(uuid) is
    'W4 lifecycle executor: service_role only. Removes an unconsumed email-change ticket after the provider refused or failed. Returns false when the ticket no longer exists (consumed or expired).';

revoke all on function public.cancel_sales_email_change(uuid) from public;
revoke all on function public.cancel_sales_email_change(uuid) from anon;
revoke all on function public.cancel_sales_email_change(uuid) from authenticated;
grant execute on function public.cancel_sales_email_change(uuid) to service_role;

create or replace function nora_private.guard_auth_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_ticket nora_private.sales_email_change_tickets%rowtype;
    v_sale public.sales%rowtype;
    v_actor public.sales%rowtype;
begin
    if old.email is not distinct from new.email then
        return new;
    end if;

    select * into v_ticket
      from nora_private.sales_email_change_tickets t
     where t.user_id = new.id
       and t.expires_at > now()
       and t.new_email = new.email::extensions.citext
     for update;

    if not found then
        raise exception 'login email changes are only possible through the Nora lifecycle executor'
            using errcode = '42501', detail = 'NORA_EMAIL_CHANGE_NOT_AUTHORIZED';
    end if;

    select * into v_sale from public.sales where id = v_ticket.sale_id for update;
    if not found or v_sale.user_id <> new.id then
        raise exception 'email change ticket does not match the employee'
            using errcode = '23514', detail = 'NORA_EMPLOYEE_IDENTITY_INCONSISTENT';
    end if;
    if v_sale.email <> v_ticket.old_email
       or lower(btrim(coalesce(old.email, ''))) <> lower(btrim(v_ticket.old_email::text)) then
        raise exception 'identity moved since the ticket was written'
            using errcode = '23514', detail = 'NORA_EMPLOYEE_IDENTITY_INCONSISTENT';
    end if;

    -- The actor is re-checked at apply time: still an existing, active admin.
    select * into v_actor from public.sales where user_id = v_ticket.actor_user_id;
    if not found or v_actor.role <> 'admin' or v_actor.disabled then
        raise exception 'email change actor is no longer an active administrator'
            using errcode = '42501', detail = 'NORA_PERMISSION_DENIED';
    end if;

    -- (a) Nora identity follows the Auth identity — same transaction.
    perform nora_private.apply_sales_email_change(v_sale.id, new.email::extensions.citext);

    -- (b) Links mailed to the old address stop working: GoTrue keeps every
    --     outstanding invitation / password-setup token in one_time_tokens.
    delete from auth.one_time_tokens where user_id = new.id;

    -- (c) The ticket is single-use.
    delete from nora_private.sales_email_change_tickets where id = v_ticket.id;

    -- (d) Durable business record, attributed to the verified administrator,
    --     correlated with the request, only when (a)-(c) commit with it.
    perform nora_private.pin_audit_context(v_ticket.actor_user_id, v_ticket.operation_id);
    perform nora_private.write_audit_event(
        p_event_type := 'user.email_changed',
        p_entity_type := 'sales',
        p_entity_id := public.nora_entity_uuid('sales', v_sale.id),
        p_changes := jsonb_build_object(
            'email',
            jsonb_build_object('old', v_ticket.old_email::text, 'new', new.email)
        ),
        p_metadata := jsonb_build_object(
            'sale_id', v_sale.id,
            'employee_sale_id', v_sale.id,
            'actor_sale_id', v_actor.id,
            'disabled', v_sale.disabled,
            'role', v_sale.role
        ),
        p_retention_class := 'user_management',
        p_source := 'user'
    );
    perform nora_private.pin_audit_context(null, null);

    return new;
end;
$$;

alter function nora_private.guard_auth_email_change() owner to postgres;

comment on function nora_private.guard_auth_email_change() is
    'W4: BEFORE UPDATE OF email ON auth.users. Refuses any email change without a live ticket for this user and address (NORA_EMAIL_CHANGE_NOT_AUTHORIZED). With a ticket: writes sales.email (as nora_identity_manager), deletes the user''s auth.one_time_tokens (old invitation / password links), consumes the ticket and writes user.email_changed with the pinned admin actor — all in GoTrue''s transaction. Access state (sales.disabled, banned_until, role) is never touched.';

revoke all on function nora_private.guard_auth_email_change() from public;
revoke all on function nora_private.guard_auth_email_change() from anon;
revoke all on function nora_private.guard_auth_email_change() from authenticated;
revoke all on function nora_private.guard_auth_email_change() from service_role;

-- Nora CRM W8-C S2A1 (2026-09-17): attachment deletion capture.
-- SECURITY DEFINER is required, not stylistic: the deleting caller is
-- `authenticated` and holds no privilege on the private outbox.
-- DATABASE WORK ONLY - this function must never gain an HTTP call, a pg_net
-- call, a Storage API call or an Edge Function invocation. That construction
-- (trigger -> pg_net -> Edge Function -> service_role remove of a
-- client-controlled path) was removed by W8-B and is not coming back.
create or replace function nora_private.enqueue_attachment_storage_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    -- OLD.storage_key is trusted input: persisted under the S1 invariants and
    -- never supplied by the deleting statement.
    --
    -- The conflict target is stated EXPLICITLY. A bare `on conflict do nothing`
    -- arbitrates over EVERY unique index including the primary key, so a PK
    -- conflict (possible because `id` is `generated BY DEFAULT as identity`)
    -- would be silently swallowed and the deletion intent lost while the
    -- business DELETE committed. Naming the partial index's columns and
    -- predicate narrows suppression to the one conflict that means "already
    -- captured": duplicate ACTIVE storage_key -> NO-OP; every other insertion
    -- failure propagates and rolls the deletion back. Capture is fail-closed,
    -- and there is deliberately no `exception when others` here.
    insert into nora_private.attachment_storage_deletion_queue (storage_key)
    values (old.storage_key)
    on conflict (storage_key) where state in ('pending', 'claimed', 'failed_retryable')
    do nothing;

    return old;
end;
$$;

alter function nora_private.enqueue_attachment_storage_deletion() owner to postgres;

comment on function nora_private.enqueue_attachment_storage_deletion() is
    'W8-C S2A1: AFTER DELETE row trigger on public.attachments. Captures OLD.storage_key as a pending deletion INTENT in nora_private.attachment_storage_deletion_queue. Database work only - no HTTP, no pg_net, no Storage API, no Edge Function, no network. A repeated intent while an active job exists is a NO-OP; any other failure aborts the deletion (fail-closed capture).';

revoke all on function nora_private.enqueue_attachment_storage_deletion() from public;
revoke all on function nora_private.enqueue_attachment_storage_deletion() from anon;
revoke all on function nora_private.enqueue_attachment_storage_deletion() from authenticated;
revoke all on function nora_private.enqueue_attachment_storage_deletion() from service_role;

-- Nora CRM W8-C S2A2.1 (2026-09-18): central attachment liveness resolver.
-- Read-only reference observation: live | dead | unknown for one storage key.
-- No consumer, no queue write, no Storage call, no network. 'dead' is an
-- observation, never a deletion permission. Execution errors propagate; there
-- is deliberately no `exception when others`.
-- ---------------------------------------------------------------------------
-- W8-C S2A2.1 (2026-09-18) (a) URL helper
--
-- Classifies ONE URL against ONE candidate key: 'live' | 'none' | 'unknown'.
-- Reads no table. The parser may PROVE liveness; it never nominates an object
-- for deletion — 'none' only means "this value does not reference the key".
--
-- Canonical form (and the ONLY form that can prove 'live'):
--   ^(https?://[^/?#\s]+)/storage/v1/object/public/attachments/([A-Za-z0-9._-]{1,512})$
--   key not '.' / '..'
-- No normalization, no percent-decoding, no trimming, no case folding.
--
-- Origin allowlist v1 (exact string match, nothing speculative):
--   https://kixxroxtfzbcbzctohex.supabase.co   Production project
--   http://127.0.0.1:54321                     local Supabase stack
--
-- STABLE (not IMMUTABLE) on purpose: no index or generated column may ever
-- depend on this classification, which is a contract that will evolve.
-- ---------------------------------------------------------------------------
create or replace function nora_private.attachment_url_liveness(p_url text, p_storage_key text)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
    v_match text[];
    v_lower text;
begin
    -- nothing there, or an inline / in-browser object: never a bucket reference
    if p_url is null or btrim(p_url) = '' then
        return 'none';
    end if;

    v_lower := lower(p_url);
    if left(v_lower, 5) in ('data:', 'blob:') then
        return 'none';
    end if;

    -- The canonical public-bucket URL. PostgreSQL regex bounds stop at 255,
    -- so the 512-character key limit is checked separately.
    v_match := regexp_match(p_url,
        '^(https?://[^/?#\s]+)/storage/v1/object/public/attachments/([A-Za-z0-9._-]+)$');
    if v_match is not null
       and char_length(v_match[2]) <= 512
       and v_match[2] not in ('.', '..') then
        if v_match[2] is distinct from p_storage_key then
            return 'none';
        end if;
        if v_match[1] in ('https://kixxroxtfzbcbzctohex.supabase.co', 'http://127.0.0.1:54321') then
            return 'live';
        end if;
        -- same key, canonical shape, but an origin this contract does not
        -- know: cannot prove live, must not claim dead
        return 'unknown';
    end if;

    -- Not canonical. Anything that still LOOKS like a storage reference is
    -- fail-closed: sign/, authenticated/, render/image/, query, fragment,
    -- percent-encoding, duplicate or embedded slashes, empty key, '..',
    -- relative form, padding, case mutation.
    if v_lower ~ 'storage(/|%2f)+v1'
       or (position('attachments' in v_lower) > 0 and v_lower ~ '(^|/|%2f)object(/|%2f)') then
        -- a storage URL that names no attachments bucket in any spelling and
        -- carries no encoding is clearly a different bucket
        if position('attachments' in v_lower) = 0 and position('%' in v_lower) = 0 then
            return 'none';
        end if;
        return 'unknown';
    end if;

    -- an ordinary foreign URL (favicon service, website, ...)
    return 'none';
end;
$$;

alter function nora_private.attachment_url_liveness(text, text) owner to postgres;

comment on function nora_private.attachment_url_liveness(text, text) is
    'W8-C S2A2.1: classifies one URL against one candidate storage key -> live | none | unknown. Only the canonical public attachments URL on an allowlisted origin (Production project, local stack) can prove live; the same canonical URL on another origin carrying the key is unknown; any other storage-looking attachments value (sign/authenticated/render paths, query, fragment, percent-encoding, extra slashes, padding, relative form) is unknown; data:, blob:, blank and ordinary foreign URLs are none. Reads no table. Never nominates an object for deletion.';

revoke all on function nora_private.attachment_url_liveness(text, text) from public;
revoke all on function nora_private.attachment_url_liveness(text, text) from anon;
revoke all on function nora_private.attachment_url_liveness(text, text) from authenticated;
revoke all on function nora_private.attachment_url_liveness(text, text) from service_role;

-- ---------------------------------------------------------------------------
-- W8-C S2A2.1 (2026-09-18) (b) File-value helper (RAFile-like object: { path?, src?, ... })
--
--   path ABSENT     field absent, JSON null, or blank string
--   path USABLE     JSON string, non-blank, <= 512 chars, already trimmed,
--                   no '://', not starting with '/'
--   path MALFORMED  anything else
--   src             absent / JSON null -> none; string -> URL helper;
--                   any other JSON type -> unknown
--
--   USABLE    path = key -> live; otherwise the src verdict decides
--             (a local src naming a SECOND key keeps that key live too —
--             the value references both, neither is silently dropped;
--             a foreign-origin or malformed src -> unknown)
--   ABSENT    src fallback
--   MALFORMED a src proving the key live -> live; otherwise unknown
--   {}        none
--   SQL NULL / JSON null   none (no file reference at all)
--   any other non-object JSON (string, number, boolean, array) -> unknown
-- ---------------------------------------------------------------------------
create or replace function nora_private.attachment_file_value_liveness(p_value jsonb, p_storage_key text)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
    v_path       jsonb;
    v_path_text  text;
    v_path_state text;
    v_src        jsonb;
    v_src_state  text;
begin
    -- SQL NULL and JSON null both mean "no file reference": the same
    -- absence semantics as a JSON-null path / src / branding key.
    if p_value is null or jsonb_typeof(p_value) = 'null' then
        return 'none';
    end if;

    if jsonb_typeof(p_value) <> 'object' then
        return 'unknown';
    end if;

    v_path := p_value -> 'path';
    if v_path is null or jsonb_typeof(v_path) = 'null' then
        v_path_state := 'absent';
    elsif jsonb_typeof(v_path) = 'string' then
        v_path_text := v_path #>> '{}';
        if btrim(v_path_text) = '' then
            v_path_state := 'absent';
        elsif char_length(v_path_text) <= 512
              and v_path_text = btrim(v_path_text)
              and position('://' in v_path_text) = 0
              and left(v_path_text, 1) <> '/' then
            v_path_state := 'usable';
        else
            v_path_state := 'malformed';
        end if;
    else
        v_path_state := 'malformed';
    end if;

    v_src := p_value -> 'src';
    if v_src is null or jsonb_typeof(v_src) = 'null' then
        v_src_state := 'none';
    elsif jsonb_typeof(v_src) = 'string' then
        v_src_state := nora_private.attachment_url_liveness(v_src #>> '{}', p_storage_key);
    else
        v_src_state := 'unknown';
    end if;

    if v_path_state = 'usable' then
        if v_path_text = p_storage_key then
            return 'live';
        end if;
        -- the path names another key; the src may still reference this one
        return v_src_state;
    elsif v_path_state = 'absent' then
        return v_src_state;
    end if;

    -- malformed path: only a src that PROVES the key live is conclusive
    if v_src_state = 'live' then
        return 'live';
    end if;
    return 'unknown';
end;
$$;

alter function nora_private.attachment_file_value_liveness(jsonb, text) owner to postgres;

comment on function nora_private.attachment_file_value_liveness(jsonb, text) is
    'W8-C S2A2.1: classifies one RAFile-like JSON value ({path?, src?}) against one candidate storage key -> live | none | unknown. A usable path equal to the key proves live; a src is classified by attachment_url_liveness and can prove a SECOND key live when it names a different local key than the path; absent path falls back to src; a malformed path or non-null non-object JSON is unknown unless a src proves live; {}, JSON null and SQL NULL are none. Reads no table.';

revoke all on function nora_private.attachment_file_value_liveness(jsonb, text) from public;
revoke all on function nora_private.attachment_file_value_liveness(jsonb, text) from anon;
revoke all on function nora_private.attachment_file_value_liveness(jsonb, text) from authenticated;
revoke all on function nora_private.attachment_file_value_liveness(jsonb, text) from service_role;

-- ---------------------------------------------------------------------------
-- W8-C S2A2.1 (2026-09-18) (c) The central resolver
--
-- SECURITY DEFINER is required for COMPLETE visibility, not for privilege: it
-- must see every row of every registered table independent of RLS and of the
-- caller, otherwise it would report a false 'dead'. It is not an API: EXECUTE
-- is revoked from every API role (authenticated holds USAGE on nora_private,
-- so the revoke is load-bearing).
--
-- `set row_security = off` makes that visibility FAIL-CLOSED: if a later
-- drift (FORCE ROW LEVEL SECURITY, an ownership change, a lost BYPASSRLS)
-- would let a policy filter any registered table, PostgreSQL raises 42501
-- instead of silently returning fewer rows — a filtered read is a false
-- 'dead', an error is not a verdict.
-- ---------------------------------------------------------------------------
create or replace function nora_private.attachment_storage_key_liveness(p_storage_key text)
returns text
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
declare
    v_live        boolean;
    v_unknown     boolean;
    v_any_unknown boolean := false;
    v_key_json    text;
begin
    -- Queue-domain input contract. The key is compared EXACTLY as given; a
    -- padded but non-blank key is valid and is never trimmed.
    if p_storage_key is null
       or btrim(p_storage_key) = ''
       or char_length(p_storage_key) > 512 then
        raise exception 'NORA_ATTACHMENT_LIVENESS_INVALID_KEY: storage key must be non-blank text of at most 512 characters'
            using errcode = '22023';
    end if;

    -- S1 public.attachments.storage_key (UNIQUE-indexed identity)
    if exists (select 1 from public.attachments a where a.storage_key = p_storage_key) then
        return 'live';
    end if;

    -- S2 public.contact_notes.attachments (jsonb[])
    select coalesce(bool_or(s.v = 'live'), false), coalesce(bool_or(s.v = 'unknown'), false)
      into v_live, v_unknown
      from (select nora_private.attachment_file_value_liveness(e.item, p_storage_key) as v
              from public.contact_notes n
              cross join lateral unnest(n.attachments) as e(item)) as s;
    if v_live then
        return 'live';
    end if;
    v_any_unknown := v_any_unknown or v_unknown;

    -- S3 public.deal_notes.attachments (jsonb[])
    select coalesce(bool_or(s.v = 'live'), false), coalesce(bool_or(s.v = 'unknown'), false)
      into v_live, v_unknown
      from (select nora_private.attachment_file_value_liveness(e.item, p_storage_key) as v
              from public.deal_notes n
              cross join lateral unnest(n.attachments) as e(item)) as s;
    if v_live then
        return 'live';
    end if;
    v_any_unknown := v_any_unknown or v_unknown;

    -- S4 public.companies.logo
    select coalesce(bool_or(s.v = 'live'), false), coalesce(bool_or(s.v = 'unknown'), false)
      into v_live, v_unknown
      from (select nora_private.attachment_file_value_liveness(c.logo, p_storage_key) as v
              from public.companies c) as s;
    if v_live then
        return 'live';
    end if;
    v_any_unknown := v_any_unknown or v_unknown;

    -- S5 public.configuration.config -> lightModeLogo / darkModeLogo.
    -- Production stores these as URL-ONLY JSON strings; only the URL helper
    -- finds them. A non-object config is an unexpected shape -> unknown.
    select coalesce(bool_or(s.v = 'live'), false), coalesce(bool_or(s.v = 'unknown'), false)
      into v_live, v_unknown
      from (select case
                       when jsonb_typeof(c.config) is distinct from 'object' then 'unknown'
                       when k.item is null or jsonb_typeof(k.item) = 'null' then 'none'
                       when jsonb_typeof(k.item) = 'string'
                           then nora_private.attachment_url_liveness(k.item #>> '{}', p_storage_key)
                       when jsonb_typeof(k.item) = 'object'
                           then nora_private.attachment_file_value_liveness(k.item, p_storage_key)
                       else 'unknown'
                   end as v
              from public.configuration c
              cross join lateral (values (c.config -> 'lightModeLogo'),
                                         (c.config -> 'darkModeLogo')) as k(item)) as s;
    if v_live then
        return 'live';
    end if;
    v_any_unknown := v_any_unknown or v_unknown;

    -- S6 public.contacts.avatar
    select coalesce(bool_or(s.v = 'live'), false), coalesce(bool_or(s.v = 'unknown'), false)
      into v_live, v_unknown
      from (select nora_private.attachment_file_value_liveness(c.avatar, p_storage_key) as v
              from public.contacts c) as s;
    if v_live then
        return 'live';
    end if;
    v_any_unknown := v_any_unknown or v_unknown;

    -- S7 public.sales.avatar
    select coalesce(bool_or(s.v = 'live'), false), coalesce(bool_or(s.v = 'unknown'), false)
      into v_live, v_unknown
      from (select nora_private.attachment_file_value_liveness(sa.avatar, p_storage_key) as v
              from public.sales sa) as s;
    if v_live then
        return 'live';
    end if;
    v_any_unknown := v_any_unknown or v_unknown;

    -- S5r residual configuration tripwire: after removing the two registered
    -- branding keys, any storage-looking text left in config is a reference
    -- this contract does not know -> fail closed. Detection only; it never
    -- registers anything and never proves live. It trips on
    --   * a storage URL marker            storage/v1 (any case, %2F)
    --   * a bucket path segment           attachments/ or attachments%2F,
    --                                      which also covers the relative
    --                                      object/public/attachments/<key>
    --   * the historic combined marker     'attachments' + /object/
    --   * the candidate key itself          verbatim anywhere in the residue
    --                                      (bare key, {"path": key}, any
    --                                      other unregistered shape).
    -- The candidate is matched in its JSON-escaped spelling, exactly as it
    -- appears in the serialized residue, and case-sensitively like a key.
    v_key_json := to_jsonb(p_storage_key)::text;
    v_key_json := substr(v_key_json, 2, char_length(v_key_json) - 2);

    select coalesce(bool_or(
               case
                   when jsonb_typeof(c.config) is distinct from 'object' then true
                   else lower((c.config - 'lightModeLogo' - 'darkModeLogo')::text) ~ 'storage(/|%2f)+v1'
                        or lower((c.config - 'lightModeLogo' - 'darkModeLogo')::text) ~ 'attachments(/|%2f)'
                        or (position('attachments' in lower((c.config - 'lightModeLogo' - 'darkModeLogo')::text)) > 0
                            and lower((c.config - 'lightModeLogo' - 'darkModeLogo')::text) ~ '(/|%2f)object(/|%2f)')
                        or position(v_key_json in (c.config - 'lightModeLogo' - 'darkModeLogo')::text) > 0
               end), false)
      into v_unknown
      from public.configuration c;
    v_any_unknown := v_any_unknown or v_unknown;

    if v_any_unknown then
        return 'unknown';
    end if;
    return 'dead';
end;
$$;

alter function nora_private.attachment_storage_key_liveness(text) owner to postgres;

comment on function nora_private.attachment_storage_key_liveness(text) is
    'W8-C S2A2.1: central attachment liveness resolver -> live | dead | unknown for one storage key, over the hard-coded reference registry v1 (public.attachments.storage_key; contact_notes/deal_notes.attachments jsonb[]; companies.logo; configuration.config lightModeLogo/darkModeLogo incl. URL-only strings plus a residual tripwire on storage markers, attachments/ path segments and the candidate key verbatim; contacts.avatar; sales.avatar). LIVE dominates UNKNOWN; DEAD only when every surface was inspected without live proof or ambiguity. A statement-snapshot OBSERVATION, never a deletion permission. Audit snapshots and storage.objects do not participate. Invalid key (NULL, blank, > 512 chars) raises 22023 NORA_ATTACHMENT_LIVENESS_INVALID_KEY; execution errors propagate and are never mapped to unknown. SECURITY DEFINER for complete RLS-independent visibility, with row_security = off so that any RLS-filtered read raises instead of hiding rows; no API role may execute it.';

revoke all on function nora_private.attachment_storage_key_liveness(text) from public;
revoke all on function nora_private.attachment_storage_key_liveness(text) from anon;
revoke all on function nora_private.attachment_storage_key_liveness(text) from authenticated;
revoke all on function nora_private.attachment_storage_key_liveness(text) from service_role;

-- Nora CRM W8-C S2A2.2 (2026-09-18): attachment deletion queue execution contract.
-- Migration: 20260918180000_nora_attachment_deletion_queue_execution.sql
-- DB-only: claim under a server-minted lease, stale-lease recovery, bounded
-- attempts with deterministic backoff, lease-guarded liveness inspection and
-- failure. postgres only - no API role may execute any of these functions.
-- No Storage call, no network, no path to done, no new queue state. The lease
-- fences QUEUE mutations only; it does not fence an external Storage request
-- that a future worker has already started (S3 / S2B close that).
-- ---------------------------------------------------------------------------
-- W8-C S2A2.2 (2026-09-18) (a) DB-owned constants
--
-- One definition each; every lease, budget and backoff decision below reads
-- them. STABLE (not IMMUTABLE) on purpose: no index or generated column may
-- ever bake one of these values in. Changed only by a migration.
-- ---------------------------------------------------------------------------

-- Lease TTL. Comfortably longer than the longest run of a future external
-- worker (an Edge Function is bounded at roughly 400 s), so a lease should
-- only expire when its holder is dead. S2B re-validates this against the
-- platform it actually runs on.
create or replace function nora_private.attachment_deletion_lease_ttl()
returns interval
language sql
stable
security invoker
set search_path = ''
as $$
    select interval '10 minutes';
$$;

alter function nora_private.attachment_deletion_lease_ttl() owner to postgres;

comment on function nora_private.attachment_deletion_lease_ttl() is
    'W8-C S2A2.2: the single authoritative lease TTL of the attachment deletion queue (10 minutes). A lease is valid while claimed_at > now() - ttl and stale once claimed_at <= now() - ttl (the exact boundary is expired). Changed only by migration.';

revoke all on function nora_private.attachment_deletion_lease_ttl() from public;
revoke all on function nora_private.attachment_deletion_lease_ttl() from anon;
revoke all on function nora_private.attachment_deletion_lease_ttl() from authenticated;
revoke all on function nora_private.attachment_deletion_lease_ttl() from service_role;

-- Attempt budget, global across all failure causes. attempt_count grows at
-- CLAIM, so a worker that crashes after claiming still consumes budget.
create or replace function nora_private.attachment_deletion_max_attempts()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
    select 5;
$$;

alter function nora_private.attachment_deletion_max_attempts() owner to postgres;

comment on function nora_private.attachment_deletion_max_attempts() is
    'W8-C S2A2.2: attempt budget of an attachment deletion job (5), shared by every failure cause. attempt_count increments at claim; a failure or lease expiry at attempt_count >= 5 ends the job as failed_terminal with its real cause code.';

revoke all on function nora_private.attachment_deletion_max_attempts() from public;
revoke all on function nora_private.attachment_deletion_max_attempts() from anon;
revoke all on function nora_private.attachment_deletion_max_attempts() from authenticated;
revoke all on function nora_private.attachment_deletion_max_attempts() from service_role;

-- Deterministic exponential backoff, no jitter: 15 min x 2^(n-1), capped at
-- 6 hours. The exponent is clamped before multiplying so no attempt count can
-- overflow the interval; with a budget of 5 the cap is dormant.
create or replace function nora_private.attachment_deletion_retry_delay(p_attempt_count integer)
returns interval
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
    if p_attempt_count is null or p_attempt_count < 1 then
        raise exception 'attachment deletion retry delay: attempt count must be >= 1, got %', p_attempt_count
            using errcode = '22023', detail = 'NORA_ATTACHMENT_INVALID_ARGUMENT';
    end if;

    return least(interval '15 minutes' * power(2, least(p_attempt_count - 1, 5)),
                 interval '6 hours');
end;
$$;

alter function nora_private.attachment_deletion_retry_delay(integer) owner to postgres;

comment on function nora_private.attachment_deletion_retry_delay(integer) is
    'W8-C S2A2.2: retry delay after the n-th attempt failed: 15 min x 2^(n-1), capped at 6 hours (15 / 30 / 60 / 120 / 240 min for attempts 1-5). Deterministic, no jitter. n < 1 or NULL raises 22023 NORA_ATTACHMENT_INVALID_ARGUMENT.';

revoke all on function nora_private.attachment_deletion_retry_delay(integer) from public;
revoke all on function nora_private.attachment_deletion_retry_delay(integer) from anon;
revoke all on function nora_private.attachment_deletion_retry_delay(integer) from authenticated;
revoke all on function nora_private.attachment_deletion_retry_delay(integer) from service_role;

-- ---------------------------------------------------------------------------
-- W8-C S2A2.2 (2026-09-18) (b) Claim (with stale-lease recovery)
--
-- SECURITY INVOKER, callable by postgres only. Every execution path runs as
-- postgres (a test, or a future S2B definer wrapper owned by postgres); if
-- EXECUTE ever leaked to an API role, the call would still fail on the queue,
-- which grants that role nothing. row_security = off turns any RLS-visibility
-- drift on the queue into an error instead of silently hiding claimed rows
-- from recovery.
--
-- 1. Recovery: at most 25 expired leases (claimed_at <= now() - ttl), oldest
--    first, SKIP LOCKED. claimed -> failed_retryable (+ backoff) or, with the
--    budget spent, failed_terminal; code NORA_ATTACHMENT_LEASE_EXPIRED.
--    Recovery never increments attempt_count.
-- 2. Selection: the oldest due job (pending / failed_retryable,
--    available_at <= now(), ordered by available_at, id), SKIP LOCKED, one row.
--    A just-recovered row is never due in the same call (its backoff is >= 15
--    minutes).
-- 3. Claim: state claimed, attempt_count + 1, claimed_at = now(), claimed_by =
--    a fresh server-minted UUID token. The caller supplies nothing. Earlier
--    error fields are kept as history.
--
-- No work returns zero rows, never an exception.
-- ---------------------------------------------------------------------------
create or replace function nora_private.attachment_deletion_claim_next()
returns table (
    job_id           bigint,
    storage_key      text,
    lease_token      text,
    attempt_count    integer,
    claimed_at       timestamptz,
    lease_expires_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = ''
set row_security = off
as $$
declare
    v_ttl constant interval := nora_private.attachment_deletion_lease_ttl();
    v_max constant integer  := nora_private.attachment_deletion_max_attempts();
    v_id  bigint;
begin
    -- 1. stale-lease recovery (bounded, never blocks on a lock)
    with stale as (
        select q.id
          from nora_private.attachment_storage_deletion_queue q
         where q.state = 'claimed'
           and q.claimed_at <= now() - v_ttl
         order by q.claimed_at, q.id
         limit 25
         for update skip locked
    )
    update nora_private.attachment_storage_deletion_queue q
       set state           = case when q.attempt_count < v_max then 'failed_retryable' else 'failed_terminal' end,
           available_at    = case when q.attempt_count < v_max
                                  then now() + nora_private.attachment_deletion_retry_delay(q.attempt_count)
                                  else q.available_at end,
           completed_at    = case when q.attempt_count < v_max then null else now() end,
           claimed_at      = null,
           claimed_by      = null,
           last_error_code = 'NORA_ATTACHMENT_LEASE_EXPIRED',
           last_error_at   = now()
      from stale
     where q.id = stale.id;

    -- 2. the next due job
    select q.id
      into v_id
      from nora_private.attachment_storage_deletion_queue q
     where q.state in ('pending', 'failed_retryable')
       and q.available_at <= now()
     order by q.available_at, q.id
     limit 1
     for update skip locked;

    if v_id is null then
        return;
    end if;

    -- 3. the claim: a fresh, server-minted lease token per claim
    return query
    update nora_private.attachment_storage_deletion_queue q
       set state         = 'claimed',
           attempt_count = q.attempt_count + 1,
           claimed_at    = now(),
           claimed_by    = gen_random_uuid()::text
     where q.id = v_id
       and q.state in ('pending', 'failed_retryable')
    returning q.id, q.storage_key, q.claimed_by, q.attempt_count, q.claimed_at, q.claimed_at + v_ttl;
end;
$$;

alter function nora_private.attachment_deletion_claim_next() owner to postgres;

comment on function nora_private.attachment_deletion_claim_next() is
    'W8-C S2A2.2: claims the oldest due attachment deletion job (pending / failed_retryable, available_at <= now(), ordered by available_at, id, FOR UPDATE SKIP LOCKED) under a fresh server-minted lease token (gen_random_uuid) and increments attempt_count. First recovers at most 25 expired leases (claimed_at <= now() - lease_ttl) to failed_retryable with backoff, or failed_terminal once the attempt budget is spent, code NORA_ATTACHMENT_LEASE_EXPIRED, without incrementing attempt_count. Returns zero rows when there is no work. The lease fences queue mutations only, never an external side effect. postgres only - no API role may execute it.';

revoke all on function nora_private.attachment_deletion_claim_next() from public;
revoke all on function nora_private.attachment_deletion_claim_next() from anon;
revoke all on function nora_private.attachment_deletion_claim_next() from authenticated;
revoke all on function nora_private.attachment_deletion_claim_next() from service_role;

-- ---------------------------------------------------------------------------
-- W8-C S2A2.2 (2026-09-18) (c) Fail (lease-guarded)
--
-- ONE conditional UPDATE whose predicate is the full valid-lease rule:
--   id = p_job_id AND state = 'claimed' AND claimed_by = p_lease_token
--   AND claimed_at > now() - lease_ttl()
-- Zero matching rows - wrong token, expired lease, unknown id, non-claimed
-- row - raise 55000 NORA_ATTACHMENT_LEASE_LOST. A lost lease is never success
-- and never "last writer wins".
--
--   retryable and attempt_count < budget  -> failed_retryable, backoff
--   otherwise                             -> failed_terminal, completed_at
--
-- The supplied cause code is kept in both cases (no separate "max attempts"
-- code: state + attempt_count already say that).
-- ---------------------------------------------------------------------------
create or replace function nora_private.attachment_deletion_fail(
    p_job_id      bigint,
    p_lease_token text,
    p_error_code  text,
    p_retryable   boolean
)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
set row_security = off
as $$
declare
    v_ttl   constant interval := nora_private.attachment_deletion_lease_ttl();
    v_max   constant integer  := nora_private.attachment_deletion_max_attempts();
    v_state text;
begin
    if p_job_id is null
       or p_lease_token is null or btrim(p_lease_token) = ''
       or p_retryable is null
       or p_error_code is null
       or p_error_code !~ '^NORA_ATTACHMENT_[A-Z0-9_]{1,64}$' then
        raise exception 'attachment deletion fail: job id, lease token, retryable flag and a NORA_ATTACHMENT_* error code are required'
            using errcode = '22023', detail = 'NORA_ATTACHMENT_INVALID_ARGUMENT';
    end if;

    update nora_private.attachment_storage_deletion_queue q
       set state           = case when p_retryable and q.attempt_count < v_max
                                  then 'failed_retryable' else 'failed_terminal' end,
           available_at    = case when p_retryable and q.attempt_count < v_max
                                  then now() + nora_private.attachment_deletion_retry_delay(q.attempt_count)
                                  else q.available_at end,
           completed_at    = case when p_retryable and q.attempt_count < v_max
                                  then null else now() end,
           claimed_at      = null,
           claimed_by      = null,
           last_error_code = p_error_code,
           last_error_at   = now()
     where q.id = p_job_id
       and q.state = 'claimed'
       and q.claimed_by = p_lease_token
       and q.claimed_at > now() - v_ttl
    returning q.state into v_state;

    if v_state is null then
        raise exception 'attachment deletion lease lost: job % is not held by this lease token', p_job_id
            using errcode = '55000', detail = 'NORA_ATTACHMENT_LEASE_LOST';
    end if;

    return v_state;
end;
$$;

alter function nora_private.attachment_deletion_fail(bigint, text, text, boolean) owner to postgres;

comment on function nora_private.attachment_deletion_fail(bigint, text, text, boolean) is
    'W8-C S2A2.2: lease-guarded failure of an attachment deletion job, one conditional UPDATE on id + state claimed + lease token + claimed_at > now() - lease_ttl. Retryable below the attempt budget -> failed_retryable with backoff; otherwise failed_terminal with completed_at. The cause code (^NORA_ATTACHMENT_[A-Z0-9_]{1,64}$) is stored either way. A lost lease (wrong token, expired, unknown id, not claimed) raises 55000 NORA_ATTACHMENT_LEASE_LOST; invalid arguments raise 22023 NORA_ATTACHMENT_INVALID_ARGUMENT. Returns the resulting state. postgres only - no API role may execute it.';

revoke all on function nora_private.attachment_deletion_fail(bigint, text, text, boolean) from public;
revoke all on function nora_private.attachment_deletion_fail(bigint, text, text, boolean) from anon;
revoke all on function nora_private.attachment_deletion_fail(bigint, text, text, boolean) from authenticated;
revoke all on function nora_private.attachment_deletion_fail(bigint, text, text, boolean) from service_role;

-- ---------------------------------------------------------------------------
-- W8-C S2A2.2 (2026-09-18) (d) Inspect (lease-guarded liveness)
--
-- Locks the job under the full valid-lease rule, calls the S2A2.1 resolver
-- exactly once and maps its verdict:
--
--   live     claimed -> skipped_live: completed_at = now(), claim cleared,
--            attempt_count and error history kept. The intent is WITHDRAWN
--            because the key was observed live at this moment - not deleted,
--            not permanently safe from later orphaning.
--   unknown  fail(..., 'NORA_ATTACHMENT_LIVENESS_UNKNOWN', retryable): retry
--            with backoff, terminal once the budget is spent. Never done,
--            never skipped_live - UNKNOWN is fail-closed.
--   dead     NO WRITE. The row stays claimed with the same token, claimed_at
--            and attempt_count; the verdict goes back to the lease holder
--            only. DEAD is an observation, not a deletion permission, and it
--            is never persisted (it would be stale at once). If nothing acts
--            on it, the lease expires and ordinary recovery applies.
--
-- A resolver error propagates and aborts the caller's transaction, leaving the
-- job claimed and unchanged: an error is never a verdict.
-- ---------------------------------------------------------------------------
create or replace function nora_private.attachment_deletion_inspect(
    p_job_id      bigint,
    p_lease_token text
)
returns table (
    verdict   text,
    job_state text
)
language plpgsql
volatile
security invoker
set search_path = ''
set row_security = off
as $$
declare
    v_key     text;
    v_verdict text;
    v_state   text;
    v_rows    integer;
begin
    if p_job_id is null or p_lease_token is null or btrim(p_lease_token) = '' then
        raise exception 'attachment deletion inspect: job id and lease token are required'
            using errcode = '22023', detail = 'NORA_ATTACHMENT_INVALID_ARGUMENT';
    end if;

    select q.storage_key
      into v_key
      from nora_private.attachment_storage_deletion_queue q
     where q.id = p_job_id
       and q.state = 'claimed'
       and q.claimed_by = p_lease_token
       and q.claimed_at > now() - nora_private.attachment_deletion_lease_ttl()
       for update;

    if v_key is null then
        raise exception 'attachment deletion lease lost: job % is not held by this lease token', p_job_id
            using errcode = '55000', detail = 'NORA_ATTACHMENT_LEASE_LOST';
    end if;

    v_verdict := nora_private.attachment_storage_key_liveness(v_key);

    if v_verdict = 'live' then
        update nora_private.attachment_storage_deletion_queue q
           set state        = 'skipped_live',
               completed_at = now(),
               claimed_at   = null,
               claimed_by   = null
         where q.id = p_job_id
           and q.state = 'claimed'
           and q.claimed_by = p_lease_token;
        get diagnostics v_rows = row_count;
        if v_rows <> 1 then
            raise exception 'attachment deletion inspect: locked job % could not be withdrawn', p_job_id
                using errcode = 'XX000';
        end if;
        v_state := 'skipped_live';
    elsif v_verdict = 'unknown' then
        v_state := nora_private.attachment_deletion_fail(p_job_id, p_lease_token,
                                                         'NORA_ATTACHMENT_LIVENESS_UNKNOWN', true);
    elsif v_verdict = 'dead' then
        v_state := 'claimed';
    else
        raise exception 'attachment deletion inspect: unexpected liveness verdict %', coalesce(v_verdict, '<null>')
            using errcode = 'XX000';
    end if;

    verdict := v_verdict;
    job_state := v_state;
    return next;
end;
$$;

alter function nora_private.attachment_deletion_inspect(bigint, text) owner to postgres;

comment on function nora_private.attachment_deletion_inspect(bigint, text) is
    'W8-C S2A2.2: lease-guarded liveness inspection of a claimed attachment deletion job. Locks the job under the full valid-lease rule, calls nora_private.attachment_storage_key_liveness exactly once and returns (verdict, job_state): live -> skipped_live (intent withdrawn, completed_at set, attempt_count and error history kept); unknown -> attachment_deletion_fail with NORA_ATTACHMENT_LIVENESS_UNKNOWN (retry, or terminal at the budget); dead -> no write, the job stays claimed under the same lease. DEAD is an observation for the lease holder, never a deletion permission, and the lease fences queue mutations only, not an external Storage request. Resolver errors propagate. Lost lease 55000 NORA_ATTACHMENT_LEASE_LOST, invalid arguments 22023 NORA_ATTACHMENT_INVALID_ARGUMENT. postgres only - no API role may execute it.';

revoke all on function nora_private.attachment_deletion_inspect(bigint, text) from public;
revoke all on function nora_private.attachment_deletion_inspect(bigint, text) from anon;
revoke all on function nora_private.attachment_deletion_inspect(bigint, text) from authenticated;
revoke all on function nora_private.attachment_deletion_inspect(bigint, text) from service_role;
