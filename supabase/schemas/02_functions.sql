--
-- Functions
-- This file declares all PL/pgSQL functions in the public schema.
--

CREATE OR REPLACE FUNCTION "public"."cleanup_note_attachments"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
    DECLARE
      payload jsonb;
      request_headers jsonb;
      auth_header text;
    BEGIN
      request_headers := coalesce(
        nullif(current_setting('request.headers', true), '')::jsonb,
        '{}'::jsonb
      );
      auth_header := request_headers ->> 'authorization';

      IF auth_header IS NULL OR auth_header = '' THEN
        IF TG_OP = 'DELETE' THEN
          RETURN OLD;
        END IF;

        RETURN NEW;
      END IF;

      payload := jsonb_build_object(
        'old_record', OLD,
        'record', NEW,
        'type', TG_OP
      );

      PERFORM net.http_post(
        url := public.get_note_attachments_function_url(),
        body := payload,
        params := '{}'::jsonb,
        headers := jsonb_build_object(
          'Content-Type',
          'application/json',
          'Authorization',
          auth_header
        ),
        timeout_milliseconds := 10000
      );

      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      END IF;

      RETURN NEW;
    END;
    $$;

CREATE OR REPLACE FUNCTION "public"."get_avatar_for_email"("email" "text") RETURNS "text"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare email_hash text;
declare gravatar_url text;
declare gravatar_status int8;
declare email_domain text;
declare favicon_url text;
declare domain_status int8;

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
declare domain_status int8;

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

CREATE OR REPLACE FUNCTION "public"."get_note_attachments_function_url"() RETURNS "text"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
    DECLARE
      issuer text;
      function_url text;
    BEGIN
      issuer := coalesce(
        nullif(current_setting('request.jwt.claim.iss', true), ''),
        (
          coalesce(
            nullif(current_setting('request.jwt.claims', true), ''),
            '{}'
          )::jsonb ->> 'iss'
        )
      );
      issuer := nullif(issuer, '');
      IF issuer IS NOT NULL THEN
        issuer := rtrim(issuer, '/');
        IF right(issuer, 8) = '/auth/v1' THEN
          function_url :=
            left(issuer, length(issuer) - 8) || '/functions/v1/delete_note_attachments';

          IF function_url LIKE 'http://127.0.0.1:%' THEN
            RETURN replace(
              function_url,
              'http://127.0.0.1:',
              'http://host.docker.internal:'
            );
          END IF;

          IF function_url LIKE 'http://localhost:%' THEN
            RETURN replace(
              function_url,
              'http://localhost:',
              'http://host.docker.internal:'
            );
          END IF;

          RETURN function_url;
        END IF;
      END IF;

      RETURN 'http://host.docker.internal:54321/functions/v1/delete_note_attachments';
    END;
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

CREATE OR REPLACE FUNCTION "public"."handle_update_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  update public.sales
  set
    first_name = coalesce(new.raw_user_meta_data ->> 'first_name', new.raw_user_meta_data -> 'custom_claims' ->> 'first_name', 'Pending'),
    last_name = coalesce(new.raw_user_meta_data ->> 'last_name', new.raw_user_meta_data -> 'custom_claims' ->> 'last_name', 'Pending'),
    email = new.email
  where user_id = new.id;

  return new;
end;
$$;

-- v0.4b.1: is_admin() moved to nora_private.is_admin() — not exposed in public schema.
-- Public RPCs: set_sales_role_by_admin, start_checklist_run_from_template.

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

  -- 1. Reassign tasks from loser to winner
  UPDATE tasks SET contact_id = winner_id WHERE contact_id = loser_id;

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

CREATE OR REPLACE FUNCTION public.prevent_sales_privilege_escalation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF current_user = 'nora_role_manager' THEN
        IF tg_op = 'UPDATE' THEN
            IF new.id IS DISTINCT FROM old.id THEN
                RAISE EXCEPTION 'sales.id is immutable';
            END IF;
            IF new.user_id IS DISTINCT FROM old.user_id THEN
                RAISE EXCEPTION 'sales.user_id is immutable';
            END IF;
            IF new.email IS DISTINCT FROM old.email THEN
                RAISE EXCEPTION 'sales.email is immutable for role manager';
            END IF;
            IF new.first_name IS DISTINCT FROM old.first_name
                OR new.last_name IS DISTINCT FROM old.last_name
                OR new.avatar IS DISTINCT FROM old.avatar THEN
                RAISE EXCEPTION 'role manager may only change role and disabled';
            END IF;
        END IF;
        RETURN NEW;
    END IF;

    IF tg_op = 'UPDATE' THEN
        IF new.id IS DISTINCT FROM old.id THEN
            RAISE EXCEPTION 'sales.id is immutable';
        END IF;
        IF new.user_id IS DISTINCT FROM old.user_id THEN
            RAISE EXCEPTION 'sales.user_id is immutable';
        END IF;
        IF new.email IS DISTINCT FROM old.email THEN
            RAISE EXCEPTION 'sales.email is immutable for direct updates';
        END IF;
        IF new.role IS DISTINCT FROM old.role THEN
            RAISE EXCEPTION 'sales.role is immutable for direct updates';
        END IF;
        IF new.administrator IS DISTINCT FROM old.administrator THEN
            RAISE EXCEPTION 'sales.administrator is immutable for direct updates';
        END IF;
        IF new.disabled IS DISTINCT FROM old.disabled THEN
            RAISE EXCEPTION 'sales.disabled is immutable for direct updates';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_sales_role_by_admin(
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

    IF coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
        IF NOT nora_private.is_admin() THEN
            RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.sales WHERE id = p_sale_id) THEN
        RAISE EXCEPTION 'sales profile not found: %', p_sale_id USING ERRCODE = 'P0002';
    END IF;

    PERFORM nora_private.apply_sales_role_change(p_sale_id, p_role, p_disabled);
END;
$$;

-- Nora CRM v0.3l: CRM audit writer, diff builders, entity triggers, read RPCs
-- Role nora_audit_writer is created in migration 20260715120000_nora_crm_audit.sql

CREATE OR REPLACE FUNCTION nora_private.resolve_audit_actor()
RETURNS TABLE (
    actor_auth_id uuid,
    actor_sales_id bigint,
    actor_name text,
    actor_role text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid;
    v_sale public.sales%rowtype;
BEGIN
    v_uid := nora_private.safe_auth_uid();
    IF v_uid IS NULL THEN
        RETURN QUERY SELECT null::uuid, null::bigint, 'System'::text, null::text;
        RETURN;
    END IF;
    SELECT * INTO v_sale FROM public.sales s
    WHERE s.user_id = v_uid AND s.disabled = false LIMIT 1;
    IF NOT FOUND THEN
        RETURN QUERY SELECT v_uid, null::bigint, 'Unbekannter Benutzer'::text, null::text;
        RETURN;
    END IF;
    RETURN QUERY SELECT v_uid, v_sale.id, trim(v_sale.first_name || ' ' || v_sale.last_name), v_sale.role;
END;
$$;

ALTER FUNCTION nora_private.resolve_audit_actor() OWNER TO postgres;

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
    INSERT INTO public.audit_events (
        id, actor_id, actor_sales_id, actor_name_snapshot, actor_role_snapshot,
        source, retention_class, event_type, entity_type, entity_id,
        company_id, contact_id, deal_id, checklist_run_id, checklist_run_item_id,
        task_id, note_id, old_data, new_data, metadata
    ) VALUES (
        v_id, v_actor.actor_auth_id, v_actor.actor_sales_id, v_actor.actor_name, v_actor.actor_role,
        coalesce(p_source, 'user'), coalesce(p_retention_class, 'crm_change'),
        p_event_type, p_entity_type, p_entity_id,
        p_company_id, p_contact_id, p_deal_id, p_checklist_run_id, p_checklist_run_item_id,
        p_task_id, p_note_id, null, null, v_meta
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
IMMUTABLE
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
IMMUTABLE
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
IMMUTABLE
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
IMMUTABLE
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
    v_company_id bigint;
    v_deal_id bigint;
    v_cn text;
BEGIN
    IF tg_op = 'INSERT' THEN
        SELECT ct.company_id INTO v_company_id FROM public.contacts ct WHERE ct.id = new.contact_id;
        PERFORM nora_private.write_audit_event(
            p_event_type := 'task.created',
            p_entity_type := 'task',
            p_entity_id := public.nora_entity_uuid('task', new.id),
            p_company_id := v_company_id,
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

        SELECT ct.company_id INTO v_company_id FROM public.contacts ct WHERE ct.id = new.contact_id;
        PERFORM nora_private.write_audit_event(
            p_event_type := v_event,
            p_entity_type := 'task',
            p_entity_id := public.nora_entity_uuid('task', new.id),
            p_company_id := v_company_id,
            p_contact_id := new.contact_id,
            p_task_id := new.id,
            p_changes := CASE WHEN v_event = 'task.updated' THEN v_changes ELSE null END
        );
        RETURN new;
    END IF;

    IF tg_op = 'DELETE' THEN
        SELECT ct.company_id INTO v_company_id FROM public.contacts ct WHERE ct.id = old.contact_id;
        PERFORM nora_private.write_audit_event(
            p_event_type := 'task.deleted',
            p_entity_type := 'task',
            p_entity_id := public.nora_entity_uuid('task', old.id),
            p_company_id := v_company_id,
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
STABLE
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

