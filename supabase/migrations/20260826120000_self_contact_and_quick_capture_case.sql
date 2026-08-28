-- Self Contact Wave (2026-08-26)
-- See docs/nora/06-decision-log.md "2026-08-26 – Self Contact Wave" for the
-- full decision, alternatives considered, and rationale.
--
-- Adds companies.self_contact_id: a directed company -> contact reference,
-- decoupled from contacts.company_id, expressing "this natural person
-- represents this customer record" without reassigning an existing
-- employer/Ansprechpartner relationship (the "Freddie stays at Firma A and
-- becomes a customer himself" scenario).

-- ---------------------------------------------------------------------------
-- 1. Schema: companies.self_contact_id
-- ---------------------------------------------------------------------------

alter table public.companies
    add column self_contact_id bigint references public.contacts(id) on delete set null;

comment on column public.companies.self_contact_id is
    'The natural person (contacts row) who represents this customer record — the private customer themselves for customer_kind=individual, or the representing person behind a business for customer_kind=business. Independent of contacts.company_id: a contact can remain the Ansprechpartner of a different company while being self_contact_id here. This is a CRM assignment, not a verified legal ownership/representation claim.';

-- Uniqueness only for individual customers: one person has at most one
-- Privatkundenakte. The same person MAY be self_contact_id of several
-- business customer records (e.g. owner of multiple Selbstständigkeiten).
create unique index uq_companies_self_contact_individual
    on public.companies (self_contact_id)
    where customer_kind = 'individual' and self_contact_id is not null;

-- Backfill: existing individual companies get their current primary contact
-- as self_contact_id (matches the RPC's pre-existing "individual always has
-- exactly one is_primary contact" behavior).
update public.companies c
set self_contact_id = sub.contact_id
from (
    select distinct on (company_id) company_id, id as contact_id
    from public.contacts
    where is_primary = true
    order by company_id, id
) sub
where c.id = sub.company_id
  and c.customer_kind = 'individual'
  and c.self_contact_id is null;

-- ---------------------------------------------------------------------------
-- 2. Effective Contact Context — single shared private helper
-- ---------------------------------------------------------------------------

create or replace function nora_private.is_effective_contact_of_company(
    p_contact_id bigint,
    p_company_id bigint
)
returns boolean
language sql
stable
set search_path = ''
as $$
    select exists (
        select 1 from public.contacts c
        where c.id = p_contact_id and c.company_id = p_company_id
    ) or exists (
        select 1 from public.companies co
        where co.id = p_company_id and co.self_contact_id = p_contact_id
    );
$$;

comment on function nora_private.is_effective_contact_of_company(bigint, bigint) is
    'Authoritative "does this contact belong to this customer record" rule: contact.company_id = company.id OR company.self_contact_id = contact.id. Single source of truth shared by enforce_task_company_context() and create_quick_capture_case() — do not reimplement this invariant separately.';

-- ---------------------------------------------------------------------------
-- 3. Privatperson: contacts stays canonical, companies.name is a controlled
--    derivation for customer_kind = individual
-- ---------------------------------------------------------------------------

create or replace function nora_private.sync_individual_company_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_name text;
begin
    v_name := trim(both ' ' from coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, ''));

    if v_name = '' and exists (
        select 1 from public.companies
        where self_contact_id = new.id and customer_kind = 'individual'
    ) then
        raise exception 'Privatkundenakte benoetigt einen Vor- oder Nachnamen (companies.name darf nicht leer werden)'
            using errcode = '23514';
    end if;

    update public.companies
    set name = v_name
    where self_contact_id = new.id
      and customer_kind = 'individual';
    return new;
end;
$$;

comment on function nora_private.sync_individual_company_name() is
    'Keeps companies.name in lockstep with the representing contact''s name for customer_kind=individual customer records, so contacts stays the single canonical source for natural-person data and companies.name never becomes a second, independently-editable identity. Rejects a rename that would blank both first_name and last_name for a contact representing an individual customer record (companies.name must never become an empty display name).';

drop trigger if exists sync_individual_company_name_trigger on public.contacts;
create trigger sync_individual_company_name_trigger
    after update of first_name, last_name on public.contacts
    for each row execute function nora_private.sync_individual_company_name();

-- ---------------------------------------------------------------------------
-- 4. Individual invariant: customer_kind='individual' => self_contact_id set
--    Deferred constraint trigger — checked at COMMIT so the RPC's two-step
--    "insert company, then link/set self_contact_id" flow within one
--    transaction is never blocked mid-transaction.
--    Fires only on INSERT and on UPDATE OF customer_kind/self_contact_id —
--    NOT on every unrelated field edit — so a pre-existing legacy row that
--    (rarely) has no resolvable contact isn't retroactively locked out of
--    unrelated edits. See docs/nora/06-decision-log.md for the documented
--    residual gap this leaves (a legacy individual company with zero
--    contacts stays self_contact_id IS NULL until deliberately fixed).
-- ---------------------------------------------------------------------------

create or replace function nora_private.check_individual_company_has_self_contact()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    -- Deferred constraint triggers execute with the OLD/NEW row values
    -- captured at the time of the *originating* statement, not a live
    -- re-fetch — so a multi-statement flow (INSERT company, THEN UPDATE
    -- self_contact_id, both inside the RPC's single transaction) would see
    -- the INSERT event's stale NEW.self_contact_id = NULL at commit time
    -- even though the row was fixed up moments later. Re-querying the
    -- row's *current* state at execution time (which for a deferred
    -- trigger is at COMMIT, after every statement in the transaction has
    -- already run) is what makes this genuinely transaction-final.
    v_customer_kind text;
    v_self_contact_id bigint;
begin
    select customer_kind, self_contact_id into v_customer_kind, v_self_contact_id
    from public.companies where id = new.id;

    if v_customer_kind = 'individual' and v_self_contact_id is null then
        raise exception 'Privatkundenakte % benoetigt eine repraesentierende Person (self_contact_id)', new.id
            using errcode = '23514';
    end if;
    return new;
end;
$$;

drop trigger if exists check_individual_company_has_self_contact_trigger on public.companies;
create constraint trigger check_individual_company_has_self_contact_trigger
    after insert or update of customer_kind, self_contact_id on public.companies
    deferrable initially deferred
    for each row execute function nora_private.check_individual_company_has_self_contact();

-- ---------------------------------------------------------------------------
-- 5. Self Contact delete guard (individual only — business self_contact_id
--    keeps the existing ON DELETE SET NULL, the business name is
--    independent)
-- ---------------------------------------------------------------------------

create or replace function nora_private.guard_self_contact_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if exists (
        select 1 from public.companies
        where self_contact_id = old.id and customer_kind = 'individual'
    ) then
        raise exception 'Person hinter einer Privatkundenakte kann nicht geloescht werden — zuerst die Kundenakte anpassen'
            using errcode = '23503';
    end if;
    return old;
end;
$$;

comment on function nora_private.guard_self_contact_delete() is
    'Blocks deleting a contact that is self_contact_id of an individual customer record — deleting it would orphan the name-sync anchor and leave a personless Privatkundenakte. Business self_contact_id keeps ON DELETE SET NULL (the FK action) since the company name is independent there.';

drop trigger if exists guard_self_contact_delete_trigger on public.contacts;
create trigger guard_self_contact_delete_trigger
    before delete on public.contacts
    for each row execute function nora_private.guard_self_contact_delete();

-- ---------------------------------------------------------------------------
-- 6. Unified Tasks: Self Contact is a valid task customer context
-- ---------------------------------------------------------------------------

create or replace function nora_private.enforce_task_company_context()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_contact_company_id bigint;
begin
    if tg_op = 'UPDATE'
       and new.contact_id is not distinct from old.contact_id
       and new.company_id is not distinct from old.company_id
    then
        return new;
    end if;

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

        if new.company_id is null then
            new.company_id := v_contact_company_id;
        elsif new.company_id is distinct from v_contact_company_id
              and not nora_private.is_effective_contact_of_company(new.contact_id, new.company_id) then
            raise exception 'tasks.company_id (%) does not match the effective contact context of contact % (%)',
                new.company_id, new.contact_id, v_contact_company_id
                using errcode = '23514';
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
    'Derives/validates tasks.company_id from the effective contact context (contacts.company_id OR companies.self_contact_id — see nora_private.is_effective_contact_of_company) whenever a task''s contact_id/company_id is set or changed. Skipped for routine field-only updates and for the explicit merge_contacts() bulk reassignment (nora.skip_task_context_check).';

-- ---------------------------------------------------------------------------
-- 7. merge_contacts: preserve self_contact_id across a contact merge
-- ---------------------------------------------------------------------------

create or replace function "public"."merge_contacts"("loser_id" bigint, "winner_id" bigint) returns bigint
    language "plpgsql"
    set "search_path" to 'public'
    as $$
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

-- ---------------------------------------------------------------------------
-- 8. Audit: track self_contact_id changes on companies
-- ---------------------------------------------------------------------------

create or replace function nora_private.audit_company_changes(
    p_old public.companies,
    p_new public.companies
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
    v jsonb := '{}'::jsonb;
    part jsonb;
begin
    part := nora_private.audit_json_field(to_jsonb(p_old.name), to_jsonb(p_new.name), 'name');
    if part is not null then v := v || jsonb_build_object('name', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.address), to_jsonb(p_new.address), 'address');
    if part is not null then v := v || jsonb_build_object('address', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.phone_number), to_jsonb(p_new.phone_number), 'phone_number');
    if part is not null then v := v || jsonb_build_object('phone_number', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.website), to_jsonb(p_new.website), 'website');
    if part is not null then v := v || jsonb_build_object('website', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.sales_id), to_jsonb(p_new.sales_id), 'sales_id');
    if part is not null then v := v || jsonb_build_object('sales_id', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.sector), to_jsonb(p_new.sector), 'sector');
    if part is not null then v := v || jsonb_build_object('sector', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.city), to_jsonb(p_new.city), 'city');
    if part is not null then v := v || jsonb_build_object('city', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.zipcode), to_jsonb(p_new.zipcode), 'zipcode');
    if part is not null then v := v || jsonb_build_object('zipcode', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.state_abbr), to_jsonb(p_new.state_abbr), 'state_abbr');
    if part is not null then v := v || jsonb_build_object('state_abbr', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.country), to_jsonb(p_new.country), 'country');
    if part is not null then v := v || jsonb_build_object('country', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.description), to_jsonb(p_new.description), 'description');
    if part is not null then v := v || jsonb_build_object('description', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.customer_kind), to_jsonb(p_new.customer_kind), 'customer_kind');
    if part is not null then v := v || jsonb_build_object('customer_kind', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.links_jsonb), to_jsonb(p_new.links_jsonb), 'links_jsonb');
    if part is not null then v := v || jsonb_build_object('links_jsonb', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.email_jsonb), to_jsonb(p_new.email_jsonb), 'email_jsonb');
    if part is not null then v := v || jsonb_build_object('email_jsonb', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.phone_jsonb), to_jsonb(p_new.phone_jsonb), 'phone_jsonb');
    if part is not null then v := v || jsonb_build_object('phone_jsonb', part); end if;
    part := nora_private.audit_json_field(to_jsonb(p_old.self_contact_id), to_jsonb(p_new.self_contact_id), 'self_contact_id');
    if part is not null then v := v || jsonb_build_object('self_contact_id', part); end if;
    return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Shared core: extract customer+contact creation logic so
--    create_customer_with_contact and create_quick_capture_case do not
--    duplicate it. Supports two customer paths (new company / existing
--    company by id) and three contact paths (new / existing-reassign /
--    self, mutually exclusive).
-- ---------------------------------------------------------------------------

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
        -- Unlike the fresh-company paths above (where no other contact can
        -- possibly already be primary), a new contact for an EXISTING
        -- company (p_existing_company_id) may need to coexist with an
        -- already-primary contact. Hardcoding is_primary=true here would
        -- violate uq_contacts_one_primary_per_company whenever that
        -- happens (e.g. Quick Capture adding a second contact to a
        -- customer that already has one) — so the caller controls it via
        -- p_contact_is_primary (default true, matching the original
        -- always-primary behavior for a brand-new company with no prior
        -- contacts), and any previous primary is explicitly demoted first.
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
                using errcode = '23514';
        end if;

        update public.companies set name = v_derived_name where id = v_company_id;
    end if;

    return query select v_company_id, v_contact_id;
end;
$$;

comment on function nora_private.create_customer_with_contact_core(jsonb, bigint, jsonb, bigint, bigint, boolean, boolean) is
    'Shared core write used by both public.create_customer_with_contact and public.create_quick_capture_case — do not duplicate this logic. Not SECURITY DEFINER itself; callers (both SECURITY DEFINER, can_write()-gated) are the only intended entry points. For customer_kind=individual, companies.name is authoritatively derived from the representing contact''s first_name/last_name whenever self_contact_id is established here — a blank/whitespace-only name is rejected, and any client-supplied p_company.name is overridden (Falle 28, 03-data-model-guardrails.md).';

-- ---------------------------------------------------------------------------
-- 10. public.create_customer_with_contact — extended, backward compatible
--     PostgREST callers (named-JSON-arg calling convention): existing calls
--     with only p_company/p_contact/p_existing_contact_id keep working
--     unchanged thanks to the new params' defaults. The old 3-arg positional
--     overload is dropped (not left in place) to avoid an ambiguous PostgREST
--     overload for the same function name.
-- ---------------------------------------------------------------------------

drop function if exists public.create_customer_with_contact(jsonb, jsonb, bigint);

create function public.create_customer_with_contact(
    p_company jsonb,
    p_contact jsonb default null,
    p_existing_contact_id bigint default null,
    p_self_contact_id bigint default null,
    p_mark_self boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_company_id bigint;
    v_contact_id bigint;
begin
    if nora_private.safe_auth_uid() is null then
        raise exception 'not authenticated' using errcode = '28000';
    end if;
    if not nora_private.can_write() then
        raise exception 'insufficient privileges' using errcode = '42501';
    end if;
    if p_company is null then
        raise exception 'p_company required' using errcode = '22023';
    end if;

    select core.company_id, core.contact_id
    into v_company_id, v_contact_id
    from nora_private.create_customer_with_contact_core(
        p_company, null, p_contact, p_existing_contact_id, p_self_contact_id, p_mark_self, true
    ) as core;

    return jsonb_build_object('company_id', v_company_id, 'contact_id', v_contact_id);
end;
$$;

alter function public.create_customer_with_contact(jsonb, jsonb, bigint, bigint, boolean) owner to postgres;

comment on function public.create_customer_with_contact(jsonb, jsonb, bigint, bigint, boolean) is
    'Atomically creates a company and (optionally) a new/existing/self contact. p_self_contact_id links an existing contact as the representing person WITHOUT touching its company_id/is_primary (see companies.self_contact_id). p_mark_self additionally marks a new/existing contact as self for customer_kind=business (always true for individual). Actor from safe_auth_uid(); requires can_write() (office/admin).';

revoke all on function public.create_customer_with_contact(jsonb, jsonb, bigint, bigint, boolean) from public;
revoke all on function public.create_customer_with_contact(jsonb, jsonb, bigint, bigint, boolean) from anon;
grant execute on function public.create_customer_with_contact(jsonb, jsonb, bigint, bigint, boolean) to authenticated;
grant execute on function public.create_customer_with_contact(jsonb, jsonb, bigint, bigint, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 11. public.create_quick_capture_case — Application Command backing RPC.
--     Kunde + Kontakt + Vorgang in one transaction. Task stays a separate,
--     best-effort follow-up (existing, already-tested UX semantics —
--     unaffected by this RPC).
-- ---------------------------------------------------------------------------

create function public.create_quick_capture_case(
    p_company jsonb default null,
    p_existing_company_id bigint default null,
    p_contact jsonb default null,
    p_existing_contact_id bigint default null,
    p_self_contact_id bigint default null,
    p_deal jsonb default null,
    p_contact_is_primary boolean default true
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
begin
    if nora_private.safe_auth_uid() is null then
        raise exception 'not authenticated' using errcode = '28000';
    end if;
    if not nora_private.can_write() then
        raise exception 'insufficient privileges' using errcode = '42501';
    end if;
    if p_deal is null then
        raise exception 'p_deal required' using errcode = '22023';
    end if;

    -- Quick Capture must never silently reparent a pre-existing contact onto
    -- a pre-existing company it is not already part of the effective
    -- contact context of. A deliberate reparent is a separate future
    -- command, not something Quick Capture does implicitly.
    if p_existing_company_id is not null and p_existing_contact_id is not null then
        if not nora_private.is_effective_contact_of_company(p_existing_contact_id, p_existing_company_id) then
            raise exception 'contact % is not part of the effective contact context of company %',
                p_existing_contact_id, p_existing_company_id
                using errcode = '42501';
        end if;
        -- Already effective — reference as-is, no company_id/is_primary
        -- mutation. p_existing_contact_id's "reassign + force primary"
        -- semantics (used by create_customer_with_contact / CustomerCreateForm
        -- for a genuinely new attachment) does not apply here: picking an
        -- existing contact of an already-established customer record must
        -- not silently promote/demote who is primary.
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

    return jsonb_build_object('company_id', v_company_id, 'contact_id', v_contact_id, 'deal_id', v_deal_id);
end;
$$;

alter function public.create_quick_capture_case(jsonb, bigint, jsonb, bigint, bigint, jsonb, boolean) owner to postgres;

comment on function public.create_quick_capture_case(jsonb, bigint, jsonb, bigint, bigint, jsonb, boolean) is
    'Quick Capture Application Command: Kunde + Kontakt + Vorgang atomically in one transaction (exactly one of p_company/p_existing_company_id required). Validates that an existing contact paired with an existing company is already part of its effective contact context — never silently reparents a foreign contact. Task creation stays a separate, best-effort step after this call succeeds. Actor from safe_auth_uid(); requires can_write() (office/admin).';

revoke all on function public.create_quick_capture_case(jsonb, bigint, jsonb, bigint, bigint, jsonb, boolean) from public;
revoke all on function public.create_quick_capture_case(jsonb, bigint, jsonb, bigint, bigint, jsonb, boolean) from anon;
grant execute on function public.create_quick_capture_case(jsonb, bigint, jsonb, bigint, bigint, jsonb, boolean) to authenticated;
grant execute on function public.create_quick_capture_case(jsonb, bigint, jsonb, bigint, bigint, jsonb, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 12. companies_summary view: propagate self_contact_id, keep nb_contacts
--     aligned with the Effective Contact Context (regular company_id
--     contacts UNION self contact, no double counting). New column appended
--     at the end of the select list (existing "create or replace view can
--     only append columns" gotcha — see Decision Log 2026-08-25).
-- ---------------------------------------------------------------------------

create or replace view public.companies_summary with (security_invoker = on) as
select
    c.id,
    c.created_at,
    c.name,
    c.sector,
    c.size,
    c.linkedin_url,
    c.website,
    c.phone_number,
    c.address,
    c.zipcode,
    c.city,
    c.state_abbr,
    c.sales_id,
    c.context_links,
    c.country,
    c.description,
    c.revenue,
    c.tax_identifier,
    c.logo,
    count(distinct d.id) as nb_deals,
    count(distinct co.id)
        + case
            when c.self_contact_id is not null
                 and not exists (
                     select 1 from public.contacts sc
                     where sc.id = c.self_contact_id and sc.company_id = c.id
                 )
            then 1
            else 0
          end as nb_contacts,
    c.customer_number,
    c.customer_kind,
    c.links_jsonb,
    c.email_jsonb,
    c.phone_jsonb,
    c.self_contact_id
from public.companies c
    left join public.deals d on c.id = d.company_id
    left join public.contacts co on c.id = co.company_id
group by c.id;
