-- Nora CRM: Atomic Contact Primary Intent (2026-09-08)
--
-- "This contact should be the Hauptansprechpartner of this customer" is a
-- business TRANSITION, not a raw contacts.is_primary column write. A real
-- Production incident (2026-09-07) proved the gap: the contact form wrote
-- is_primary = true directly, the partial unique index
-- uq_contacts_one_primary_per_company correctly refused a second primary
-- (23505), and the office user saw the generic "Die Daten konnten gerade
-- nicht geladen werden." — see docs/nora/06-decision-log.md
-- "2026-09-08 – Atomic Contact Primary Intent".
--
-- This migration adds the authoritative application command surface:
--
--   public.create_contact(p_contact, p_primary_intent, p_expected_primary_contact_id, p_idempotency_key)
--   public.update_contact(p_contact_id, p_patch, p_primary_intent, p_expected_primary_contact_id)
--
-- Both run the contact write AND the primary-contact transition in ONE
-- transaction, serialize the transition per customer with a row lock on
-- public.companies (deterministic id order when two customers are involved),
-- verify the primary the user actually observed (stale-UI protection,
-- DETAIL = NORA_PRIMARY_CONTACT_CHANGED), and translate a residual
-- uq_contacts_one_primary_per_company hit into
-- DETAIL = NORA_PRIMARY_CONTACT_ALREADY_EXISTS. The unique index stays the
-- final defense; the lock is the normal coordination mechanism.
--
-- One private helper owns the "demote previous primary" step for every
-- caller — nora_private.prepare_primary_contact_slot — and the existing
-- public.set_primary_contact is refactored onto it (same signature, same
-- grants, same "no expected-primary verification" contract).
--
-- Security contract (Security Hardening Wave 1, 17-known-issues A.8):
-- every new public function gets its own explicit revoke from
-- public/anon/authenticated/service_role before the single grant to
-- authenticated. service_role gets NO EXECUTE — no deployed backend path
-- calls these commands. Table ACLs are untouched.
--
-- Additive: no table/column change, no history rewrite. supabase/schemas/
-- 02_functions.sql is kept in sync in the same commit.

-- ---------------------------------------------------------------------------
-- 1. Deterministic customer row locking
-- ---------------------------------------------------------------------------

create or replace function nora_private.lock_companies_for_primary_transition(
    p_company_ids bigint[]
)
returns void
language plpgsql
set search_path = ''
as $$
declare
    v_expected int;
    v_locked int;
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

    -- Ascending id order for every caller => no lock-order inversion between
    -- two transactions that touch the same pair of customers.
    select count(*) into v_locked
    from (
        select c.id
        from public.companies c
        where c.id = any(p_company_ids)
        order by c.id
        for update
    ) locked;

    if v_locked <> v_expected then
        raise exception 'customer not found for primary-contact transition'
            using errcode = 'P0002';
    end if;
end;
$$;

alter function nora_private.lock_companies_for_primary_transition(bigint[]) owner to postgres;

comment on function nora_private.lock_companies_for_primary_transition(bigint[]) is
    'Atomic Contact Primary Intent (2026-09-08): takes FOR UPDATE row locks on the given customers in ascending id order so every primary-contact transition on a customer is serialized and two-customer moves never deadlock. Raises P0002 when a customer id does not exist. Internal — callers are the SECURITY DEFINER contact commands.';

revoke all on function nora_private.lock_companies_for_primary_transition(bigint[]) from public;
revoke all on function nora_private.lock_companies_for_primary_transition(bigint[]) from anon;
revoke all on function nora_private.lock_companies_for_primary_transition(bigint[]) from authenticated;
revoke all on function nora_private.lock_companies_for_primary_transition(bigint[]) from service_role;

-- ---------------------------------------------------------------------------
-- 2. The one authoritative primary-contact transition core
-- ---------------------------------------------------------------------------
-- Prepares the "primary slot" of one customer for p_target_contact_id:
--   * (re)locks the customer row (idempotent within the transaction),
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

    perform nora_private.lock_companies_for_primary_transition(array[p_company_id]);

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
        'p_contact', (p_contact - 'first_seen' - 'last_seen'),
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
            perform nora_private.lock_companies_for_primary_transition(array[v_company_id]);
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
    'Atomic Contact Primary Intent (2026-09-08): creates one contact and applies the explicit Hauptansprechpartner intent (keep | make_primary) in ONE transaction. make_primary locks the customer, verifies the primary the user observed (p_expected_primary_contact_id, NULL = none; mismatch → DETAIL = NORA_PRIMARY_CONTACT_CHANGED), demotes the previous holder and inserts the new contact in its final is_primary = true state (audit: one contact.updated for the demoted holder, one contact.created with is_primary = true). Writable fields are allowlisted; is_primary is never read from p_contact. Residual uq_contacts_one_primary_per_company hit → DETAIL = NORA_PRIMARY_CONTACT_ALREADY_EXISTS. Optional p_idempotency_key (scope contact.create, first_seen/last_seen excluded from the fingerprint): replay returns the stored result with _meta.disposition = "replayed", a different request under the same key raises DETAIL = NORA_IDEMPOTENCY_CONFLICT. Actor from safe_auth_uid(); requires can_write() (DETAIL = NORA_PERMISSION_DENIED). Returns {contact_id, contact, demoted_contact_id, _meta?}.';

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
        -- Lock order: customers (ascending) first, then the contact row. The
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
            perform nora_private.lock_companies_for_primary_transition(v_lock_ids);

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
    'Atomically makes p_contact_id the sole Hauptansprechpartner of its company (no observed-holder verification — callers that know which holder the user saw use create_contact/update_contact with make_primary). Since 2026-09-08 implemented on nora_private.prepare_primary_contact_slot (customer row lock + single demote rule). Requires can_write() (office/admin) — rejection carries DETAIL = NORA_PERMISSION_DENIED.';

-- Grants intentionally unchanged (authenticated + service_role, as released
-- 2026-08-25) — re-stated explicitly so this migration is self-describing.
revoke all on function public.set_primary_contact(bigint) from public;
revoke all on function public.set_primary_contact(bigint) from anon;
grant execute on function public.set_primary_contact(bigint) to authenticated;
grant execute on function public.set_primary_contact(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Self-check: privilege matrix of the new surface + invariant present
-- ---------------------------------------------------------------------------

do $$
declare
    r record;
    v_failures text[] := '{}';
begin
    if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_contacts_one_primary_per_company') then
        v_failures := v_failures || 'uq_contacts_one_primary_per_company is missing';
    end if;

    for r in
        select * from (values
            ('public.create_contact(jsonb, text, bigint, uuid)', 'anon', false),
            ('public.create_contact(jsonb, text, bigint, uuid)', 'authenticated', true),
            ('public.create_contact(jsonb, text, bigint, uuid)', 'service_role', false),
            ('public.update_contact(bigint, jsonb, text, bigint)', 'anon', false),
            ('public.update_contact(bigint, jsonb, text, bigint)', 'authenticated', true),
            ('public.update_contact(bigint, jsonb, text, bigint)', 'service_role', false),
            ('public.set_primary_contact(bigint)', 'anon', false),
            ('public.set_primary_contact(bigint)', 'authenticated', true),
            ('nora_private.prepare_primary_contact_slot(bigint, bigint, bigint, boolean)', 'anon', false),
            ('nora_private.prepare_primary_contact_slot(bigint, bigint, bigint, boolean)', 'authenticated', false),
            ('nora_private.prepare_primary_contact_slot(bigint, bigint, bigint, boolean)', 'service_role', false),
            ('nora_private.lock_companies_for_primary_transition(bigint[])', 'authenticated', false)
        ) as t(fn, role_name, expected)
    loop
        if has_function_privilege(r.role_name, r.fn, 'EXECUTE') <> r.expected then
            v_failures := v_failures || format('%s EXECUTE on %s expected %s', r.role_name, r.fn, r.expected);
        end if;
    end loop;

    -- PUBLIC must not hold EXECUTE on the new public commands (A.8: the
    -- built-in default would grant it; the explicit revoke above removes it).
    for r in
        select p.proname, p.proacl
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('create_contact', 'update_contact')
    loop
        if r.proacl is null or exists (
            select 1 from aclexplode(r.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'
        ) then
            v_failures := v_failures || format('PUBLIC can execute public.%s', r.proname);
        end if;
    end loop;

    if cardinality(v_failures) > 0 then
        raise exception E'NORA_ATOMIC_CONTACT_PRIMARY_INTENT self-check failed:\n%', array_to_string(v_failures, E'\n');
    end if;

    raise notice 'NORA_ATOMIC_CONTACT_PRIMARY_INTENT: privilege matrix verified';
end
$$;
