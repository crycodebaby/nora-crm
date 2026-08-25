-- Nora CRM – Kunden-/Ansprechpartner-Erfassung (Customer & Contact Workflow Wave)
-- Additive only. No remote apply in this commit.
--
-- Adds:
--   1. companies.customer_kind ('business' | 'individual') — Unternehmen/Selbstständig vs. Privatperson
--   2. contacts.is_primary — Hauptansprechpartner, max. 1 pro Kunde (partial unique index)
--   3. companies.links_jsonb / contacts.links_jsonb — generalisiertes Link-Modell (Website, LinkedIn, ...)
--      replacing the LinkedIn-only companies.linkedin_url / contacts.linkedin_url / companies.website /
--      companies.context_links as the UI-facing source of truth. Old columns are kept (deprecated,
--      read-only from the UI going forward) so no stored data is lost — see docs/nora/06-decision-log.md.
--   4. companies.email_jsonb / companies.phone_jsonb — multi email/phone with types, mirroring the
--      existing contacts.email_jsonb / contacts.phone_jsonb shape. companies.phone_number is kept
--      (deprecated) and backfilled into phone_jsonb.
--   5. RPC public.create_customer_with_contact — atomic company (+ optional contact) create.
--   6. RPC public.set_primary_contact — atomic primary-contact switch.
--   7. audit_company_changes / audit_contact_changes extended to track the new fields.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

alter table public.companies
    add column if not exists customer_kind text not null default 'business';

alter table public.companies
    add constraint companies_customer_kind_check
        check (customer_kind in ('business', 'individual'));

alter table public.companies
    add column if not exists links_jsonb jsonb not null default '[]'::jsonb;

alter table public.companies
    add column if not exists email_jsonb jsonb not null default '[]'::jsonb;

alter table public.companies
    add column if not exists phone_jsonb jsonb not null default '[]'::jsonb;

alter table public.contacts
    add column if not exists is_primary boolean not null default false;

alter table public.contacts
    add column if not exists links_jsonb jsonb not null default '[]'::jsonb;

comment on column public.companies.customer_kind is
    'Unternehmen/Selbstständig (business) vs. Privatperson (individual). Drives create/edit form mode.';
comment on column public.companies.links_jsonb is
    'Generalisiertes Link-Modell: [{"url","type","label"?}]. type in (website,linkedin,instagram,facebook,google,portal,other). Ersetzt linkedin_url/website/context_links als UI-Quelle.';
comment on column public.companies.email_jsonb is
    'Mehrere Firmen-E-Mail-Adressen: [{"email","type"}]. type wie contacts.email_jsonb (Work/Home/Other/...).';
comment on column public.companies.phone_jsonb is
    'Mehrere Firmen-Telefonnummern: [{"number","type"}]. Ersetzt companies.phone_number als UI-Quelle.';
comment on column public.contacts.is_primary is
    'Hauptansprechpartner des zugeordneten Kunden. Max. 1 pro company_id (siehe uq_contacts_one_primary_per_company).';
comment on column public.contacts.links_jsonb is
    'Generalisiertes Link-Modell: [{"url","type","label"?}]. Ersetzt linkedin_url als UI-Quelle.';

-- ---------------------------------------------------------------------------
-- 2. Backfill (data migration, no data loss)
-- ---------------------------------------------------------------------------

-- 2a. contacts.linkedin_url -> contacts.links_jsonb
update public.contacts
set links_jsonb = links_jsonb || jsonb_build_array(
    jsonb_build_object('url', linkedin_url, 'type', 'linkedin')
)
where linkedin_url is not null
  and btrim(linkedin_url) <> ''
  and not (links_jsonb @> jsonb_build_array(jsonb_build_object('url', linkedin_url, 'type', 'linkedin')));

-- 2b. companies.linkedin_url -> companies.links_jsonb
update public.companies
set links_jsonb = links_jsonb || jsonb_build_array(
    jsonb_build_object('url', linkedin_url, 'type', 'linkedin')
)
where linkedin_url is not null
  and btrim(linkedin_url) <> ''
  and not (links_jsonb @> jsonb_build_array(jsonb_build_object('url', linkedin_url, 'type', 'linkedin')));

-- 2c. companies.website -> companies.links_jsonb
update public.companies
set links_jsonb = links_jsonb || jsonb_build_array(
    jsonb_build_object('url', website::text, 'type', 'website')
)
where website is not null
  and btrim(website::text) <> ''
  and not (links_jsonb @> jsonb_build_array(jsonb_build_object('url', website::text, 'type', 'website')));

-- 2d. companies.context_links (json array of url strings) -> companies.links_jsonb (type "other")
update public.companies c
set links_jsonb = c.links_jsonb || coalesce((
    select jsonb_agg(jsonb_build_object('url', elem, 'type', 'other'))
    from json_array_elements_text(c.context_links) as elem
    where btrim(elem) <> ''
      and not (c.links_jsonb @> jsonb_build_array(jsonb_build_object('url', elem, 'type', 'other')))
), '[]'::jsonb)
where c.context_links is not null
  and json_typeof(c.context_links) = 'array'
  and json_array_length(c.context_links) > 0;

-- 2e. companies.phone_number -> companies.phone_jsonb (type "Central" — Zentrale)
update public.companies
set phone_jsonb = jsonb_build_array(jsonb_build_object('number', phone_number, 'type', 'Central'))
where phone_number is not null
  and btrim(phone_number) <> ''
  and jsonb_array_length(phone_jsonb) = 0;

-- 2f. Backfill one Hauptansprechpartner per company: oldest contact (by id) where none is primary yet.
with candidate as (
    select distinct on (company_id) id, company_id
    from public.contacts
    where company_id is not null
    order by company_id, id asc
),
already_primary as (
    select distinct company_id
    from public.contacts
    where is_primary and company_id is not null
)
update public.contacts t
set is_primary = true
from candidate
where t.id = candidate.id
  and candidate.company_id not in (select company_id from already_primary);

-- ---------------------------------------------------------------------------
-- 3. Integrity: at most one primary contact per company
-- ---------------------------------------------------------------------------

create unique index if not exists uq_contacts_one_primary_per_company
    on public.contacts (company_id)
    where is_primary and company_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Audit change-tracking: include new fields
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 5. RPC: create_customer_with_contact
-- ---------------------------------------------------------------------------
-- Atomically creates one company row and, optionally, either
--   (a) a brand-new contact row (p_contact provided) marked as primary, or
--   (b) a relink of an existing contact (p_existing_contact_id provided) to the
--       new company, marked as primary ("Kundenakte aus bestehendem Kontakt").
-- customer_number / case_number stay server-assigned (existing triggers).
-- Row INSERT/UPDATE audit events fire automatically via the existing
-- audit_company_row / audit_contact_row triggers — no manual audit write here.

create or replace function public.create_customer_with_contact(
    p_company jsonb,
    p_contact jsonb default null,
    p_existing_contact_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_company_id bigint;
    v_contact_id bigint;
    v_name text;
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
    if p_contact is not null and p_existing_contact_id is not null then
        raise exception 'p_contact and p_existing_contact_id are mutually exclusive' using errcode = '22023';
    end if;

    v_name := nullif(btrim(coalesce(p_company->>'name', '')), '');
    if v_name is null then
        raise exception 'company name required' using errcode = '22023';
    end if;

    insert into public.companies (
        name, customer_kind, sector, size, address, zipcode, city, state_abbr, country,
        description, revenue, tax_identifier, sales_id, links_jsonb, email_jsonb, phone_jsonb
    ) values (
        v_name,
        coalesce(nullif(p_company->>'customer_kind', ''), 'business'),
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

    if p_existing_contact_id is not null then
        update public.contacts
        set company_id = v_company_id,
            is_primary = true
        where id = p_existing_contact_id
        returning id into v_contact_id;

        if v_contact_id is null then
            raise exception 'existing contact not found: %', p_existing_contact_id using errcode = 'P0002';
        end if;
    elsif p_contact is not null then
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
            true,
            coalesce(p_contact->'email_jsonb', '[]'::jsonb),
            coalesce(p_contact->'phone_jsonb', '[]'::jsonb),
            coalesce(p_contact->'links_jsonb', '[]'::jsonb)
        )
        returning id into v_contact_id;
    end if;

    return jsonb_build_object('company_id', v_company_id, 'contact_id', v_contact_id);
end;
$$;

alter function public.create_customer_with_contact(jsonb, jsonb, bigint) owner to postgres;

comment on function public.create_customer_with_contact(jsonb, jsonb, bigint) is
    'Atomically creates a company and (optionally) a new or existing primary contact. Actor from safe_auth_uid(); requires can_write() (office/admin).';

revoke all on function public.create_customer_with_contact(jsonb, jsonb, bigint) from public;
revoke all on function public.create_customer_with_contact(jsonb, jsonb, bigint) from anon;
grant execute on function public.create_customer_with_contact(jsonb, jsonb, bigint) to authenticated;
grant execute on function public.create_customer_with_contact(jsonb, jsonb, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 6. RPC: set_primary_contact
-- ---------------------------------------------------------------------------
-- Atomically switches the Hauptansprechpartner for a contact's company:
-- unsets any other primary contact of the same company, then sets this one.

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
        raise exception 'insufficient privileges' using errcode = '42501';
    end if;

    select company_id into v_company_id from public.contacts where id = p_contact_id;
    if not found then
        raise exception 'contact not found: %', p_contact_id using errcode = 'P0002';
    end if;
    if v_company_id is null then
        raise exception 'contact has no company: %', p_contact_id using errcode = '22023';
    end if;

    update public.contacts
    set is_primary = false
    where company_id = v_company_id
      and is_primary
      and id <> p_contact_id;

    update public.contacts
    set is_primary = true
    where id = p_contact_id;
end;
$$;

alter function public.set_primary_contact(bigint) owner to postgres;

comment on function public.set_primary_contact(bigint) is
    'Atomically makes p_contact_id the sole Hauptansprechpartner of its company. Requires can_write() (office/admin).';

revoke all on function public.set_primary_contact(bigint) from public;
revoke all on function public.set_primary_contact(bigint) from anon;
grant execute on function public.set_primary_contact(bigint) to authenticated;
grant execute on function public.set_primary_contact(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Views: expose the new columns (companies_summary / contacts_summary are
--    what the dataProvider actually reads for getList/getOne on these two
--    resources — without this, the UI would silently never see the new
--    fields even though they exist on the base tables).
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
    count(distinct co.id) as nb_contacts,
    c.customer_number,
    c.customer_kind,
    c.links_jsonb,
    c.email_jsonb,
    c.phone_jsonb
from public.companies c
    left join public.deals d on c.id = d.company_id
    left join public.contacts co on c.id = co.company_id
group by c.id;

create or replace view public.contacts_summary with (security_invoker = on) as
select
    co.id,
    co.first_name,
    co.last_name,
    co.gender,
    co.title,
    co.background,
    co.avatar,
    co.first_seen,
    co.last_seen,
    co.has_newsletter,
    co.status,
    co.tags,
    co.company_id,
    co.sales_id,
    co.linkedin_url,
    co.email_jsonb,
    co.phone_jsonb,
    (jsonb_path_query_array(co.email_jsonb, '$[*]."email"'))::text as email_fts,
    (jsonb_path_query_array(co.phone_jsonb, '$[*]."number"'))::text as phone_fts,
    c.name as company_name,
    count(distinct t.id) filter (where t.done_date is null) as nb_tasks,
    co.links_jsonb,
    co.is_primary
from public.contacts co
    left join public.tasks t on co.id = t.contact_id
    left join public.companies c on co.company_id = c.id
group by co.id, c.name;
