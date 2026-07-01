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
  sales_count int;
begin
  select count(id) into sales_count
  from public.sales;

  insert into public.sales (first_name, last_name, email, user_id, administrator)
  values (
    coalesce(new.raw_user_meta_data ->> 'first_name', new.raw_user_meta_data -> 'custom_claims' ->> 'first_name', 'Pending'),
    coalesce(new.raw_user_meta_data ->> 'last_name', new.raw_user_meta_data -> 'custom_claims' ->> 'last_name', 'Pending'),
    new.email,
    new.id,
    case when sales_count > 0 then FALSE else TRUE end
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

CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  return exists (
    select 1 from public.sales where user_id = auth.uid() and administrator = true
  );
end;
$$;

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
    SET "search_path" TO 'public'
    AS $$
declare
    v_id uuid := gen_random_uuid();
    v_actor uuid := auth.uid();
begin
    insert into public.audit_events (
        id, actor_id, event_type, entity_type, entity_id,
        company_id, contact_id, deal_id, checklist_run_id, checklist_run_item_id,
        old_data, new_data, metadata
    )
    values (
        v_id, v_actor, p_event_type, p_entity_type, p_entity_id,
        p_company_id, p_contact_id, p_deal_id, p_checklist_run_id, p_checklist_run_item_id,
        p_old_data, p_new_data, p_metadata
    );
    return v_id;
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

CREATE OR REPLACE FUNCTION "public"."audit_deal_stage_change"() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
    if tg_op = 'UPDATE' and old.stage is distinct from new.stage then
        perform public.insert_audit_event(
            'deal.stage_changed', 'deal', public.nora_entity_uuid('deal', new.id),
            new.company_id, null, new.id, null, null,
            jsonb_build_object('stage', old.stage),
            jsonb_build_object('stage', new.stage), null
        );
    end if;
    return new;
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
