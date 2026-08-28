-- Error Contract Wave (2026-08-28)
-- See docs/nora/06-decision-log.md "2026-08-28 – Error Contract Wave" for
-- the full decision, the local Postgres -> PostgREST round-trip proof, and
-- rationale.
--
-- Additive only: does NOT edit the already-applied-to-production
-- 20260826120000_self_contact_and_quick_capture_case.sql. Every function
-- below is CREATE OR REPLACE against its existing signature — same
-- behavior, same MESSAGE text (kept verbatim or only minimally adjusted),
-- with one addition: `USING ... DETAIL = 'NORA_<CODE>'` carrying the
-- stable, machine-readable Nora Error Code.
--
-- Contract:
--   MESSAGE  = human / diagnostic / freely re-wordable, never canonical
--   ERRCODE  = PostgreSQL/SQLSTATE semantics, not Nora business identity
--   DETAIL   = the one stable Nora Error Code (see
--              src/components/atomic-crm/domain/noraErrorCodes.ts)
--
-- Guardrail: no new business error becomes part of the stable contract by
-- having its human MESSAGE text parsed. A NoraErrorCode is assigned
-- explicitly via DETAIL at the RAISE site, never derived from wording.

-- ---------------------------------------------------------------------------
-- 1. nora_private.create_customer_with_contact_core
--    - Individual Name Invariant (CREATE path): DETAIL =
--      NORA_INDIVIDUAL_NAME_REQUIRED
--    - Private Customer TOCTOU: the client-side pre-check
--      (findExistingPrivateCustomerRecord) can miss a private customer
--      record created by a concurrent request between the check and this
--      write. The three self_contact_id-setting statements below are the
--      only statements in this function that can hit
--      uq_companies_self_contact_individual (23505) — wrapping the whole
--      body in one exception handler and discriminating by constraint name
--      via GET STACKED DIAGNOSTICS is simpler than wrapping each statement
--      individually and equally safe: any OTHER unique violation (e.g.
--      uq_contacts_one_primary_per_company) is re-raised completely
--      unchanged, never mistranslated into this business code.
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
    v_constraint_name text;
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

-- ---------------------------------------------------------------------------
-- 2. nora_private.enforce_task_company_context — effective-contact-context
--    rejection now carries DETAIL = NORA_CONTACT_NOT_IN_CUSTOMER_CONTEXT
--    (same code as create_quick_capture_case below, different SQLSTATE —
--    proves Human Message / SQLSTATE Independence, see acceptance test).
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
                using errcode = '23514', detail = 'NORA_CONTACT_NOT_IN_CUSTOMER_CONTEXT';
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
    'Derives/validates tasks.company_id from the effective contact context (contacts.company_id OR companies.self_contact_id — see nora_private.is_effective_contact_of_company) whenever a task''s contact_id/company_id is set or changed. Skipped for routine field-only updates and for the explicit merge_contacts() bulk reassignment (nora.skip_task_context_check). Effective-contact-context rejection carries DETAIL=NORA_CONTACT_NOT_IN_CUSTOMER_CONTEXT (Error Contract Wave, 2026-08-28).';

-- ---------------------------------------------------------------------------
-- 3. nora_private.sync_individual_company_name — rename-path Individual
--    Name Invariant now carries DETAIL = NORA_INDIVIDUAL_NAME_REQUIRED
--    (same code as the CREATE-path guard above, different origin/SQLSTATE
--    context — same fachliche Bedeutung).
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
            using errcode = '23514', detail = 'NORA_INDIVIDUAL_NAME_REQUIRED';
    end if;

    update public.companies
    set name = v_name
    where self_contact_id = new.id
      and customer_kind = 'individual';
    return new;
end;
$$;

comment on function nora_private.sync_individual_company_name() is
    'Keeps companies.name in lockstep with the representing contact''s name for customer_kind=individual customer records, so contacts stays the single canonical source for natural-person data. Rejects a rename that would blank both first_name and last_name for a contact representing an individual customer record (DETAIL=NORA_INDIVIDUAL_NAME_REQUIRED, Error Contract Wave, 2026-08-28).';

-- ---------------------------------------------------------------------------
-- 4. nora_private.guard_self_contact_delete — DETAIL =
--    NORA_SELF_CONTACT_DELETE_BLOCKED
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
            using errcode = '23503', detail = 'NORA_SELF_CONTACT_DELETE_BLOCKED';
    end if;
    return old;
end;
$$;

comment on function nora_private.guard_self_contact_delete() is
    'Blocks deleting a contact that is self_contact_id of an individual customer record. Business self_contact_id keeps ON DELETE SET NULL (the FK action). DETAIL=NORA_SELF_CONTACT_DELETE_BLOCKED (Error Contract Wave, 2026-08-28).';

-- ---------------------------------------------------------------------------
-- 5. public.create_customer_with_contact — permission rejection now
--    carries DETAIL = NORA_PERMISSION_DENIED.
-- ---------------------------------------------------------------------------

create or replace function public.create_customer_with_contact(
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
        raise exception 'insufficient privileges' using errcode = '42501', detail = 'NORA_PERMISSION_DENIED';
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

comment on function public.create_customer_with_contact(jsonb, jsonb, bigint, bigint, boolean) is
    'Atomically creates a company and (optionally) a new/existing/self contact. p_self_contact_id links an existing contact as the representing person WITHOUT touching its company_id/is_primary. p_mark_self additionally marks a new/existing contact as self for customer_kind=business (always true for individual). Actor from safe_auth_uid(); requires can_write() (office/admin) — rejection carries DETAIL=NORA_PERMISSION_DENIED (Error Contract Wave, 2026-08-28).';

-- ---------------------------------------------------------------------------
-- 6. public.create_quick_capture_case — permission rejection and effective-
--    contact-context rejection now carry DETAIL codes.
-- ---------------------------------------------------------------------------

create or replace function public.create_quick_capture_case(
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
        raise exception 'insufficient privileges' using errcode = '42501', detail = 'NORA_PERMISSION_DENIED';
    end if;
    if p_deal is null then
        raise exception 'p_deal required' using errcode = '22023';
    end if;

    if p_existing_company_id is not null and p_existing_contact_id is not null then
        if not nora_private.is_effective_contact_of_company(p_existing_contact_id, p_existing_company_id) then
            raise exception 'contact % is not part of the effective contact context of company %',
                p_existing_contact_id, p_existing_company_id
                using errcode = '42501', detail = 'NORA_CONTACT_NOT_IN_CUSTOMER_CONTEXT';
        end if;
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

comment on function public.create_quick_capture_case(jsonb, bigint, jsonb, bigint, bigint, jsonb, boolean) is
    'Quick Capture Application Command: Kunde + Kontakt + Vorgang atomically in one transaction. Validates that an existing contact paired with an existing company is already part of its effective contact context (DETAIL=NORA_CONTACT_NOT_IN_CUSTOMER_CONTEXT on rejection). Task creation stays a separate, best-effort step after this call succeeds. Actor from safe_auth_uid(); requires can_write() (office/admin) — rejection carries DETAIL=NORA_PERMISSION_DENIED (Error Contract Wave, 2026-08-28).';
