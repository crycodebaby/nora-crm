-- Nora CRM: Operation Status Contract v1 — execution disposition (2026-08-29).
--
-- Adds a minimal, additive `_meta.disposition` ("executed" | "replayed")
-- to the JSONB result already returned by the three idempotent RPCs from the
-- Idempotency Wave (20260829120000_nora_idempotency_core.sql) — see
-- docs/nora/06-decision-log.md "Operation Status Contract Wave".
--
-- No signature change (CREATE OR REPLACE on the exact existing argument
-- lists — no DROP needed, unlike the Idempotency Wave migration which added
-- a trailing parameter). Existing business fields (company_id, contact_id,
-- deal_id, task_id) are untouched in shape and value.
--
-- Contract:
-- - p_idempotency_key IS NULL (legacy/non-idempotent caller): result is
--   returned exactly as before this migration — NO `_meta` key at all.
--   Execution disposition is only ever reported when idempotency protection
--   was actually requested; it must never be inferred/assumed otherwise.
-- - p_idempotency_key set, no prior record (fresh write): `_meta.disposition
--   = "executed"`.
-- - p_idempotency_key set, matching prior record (replay): `_meta.disposition
--   = "replayed"` — overrides whatever disposition was stored on the
--   original attempt's persisted result via jsonb `||` (right-hand-side
--   wins on the `_meta` key), so a replay always reports "replayed" even
--   though the stored row itself was written as "executed".
-- - `_meta` is transport metadata only — never a business field, never
--   persisted as a domain column, never referenced by RLS/business logic.
--
-- idempotency_check/idempotency_persist themselves are unchanged: the
-- disposition is entirely decided by the calling RPC (which already knows
-- whether it took the early "v_replay is not null" branch or the normal
-- write branch), not by the shared helpers.

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

comment on function public.create_customer_with_contact(jsonb, jsonb, bigint, bigint, boolean, uuid) is
    'Atomically creates a company and (optionally) a new/existing/self contact. p_self_contact_id links an existing contact as the representing person WITHOUT touching its company_id/is_primary. p_mark_self additionally marks a new/existing contact as self for customer_kind=business (always true for individual). Actor from safe_auth_uid(); requires can_write() (office/admin) — rejection carries DETAIL=NORA_PERMISSION_DENIED (Error Contract Wave, 2026-08-28). Optional p_idempotency_key: same key + same request replays the stored result (no second write); same key + different request raises DETAIL=NORA_IDEMPOTENCY_CONFLICT; null (default) preserves pre-wave behavior (Idempotency Wave, 2026-08-29). When p_idempotency_key is set, the returned jsonb carries _meta.disposition = "executed" | "replayed" (Operation Status Contract Wave, 2026-08-29); omitted entirely when p_idempotency_key is null.';

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

comment on function public.create_quick_capture_case(jsonb, bigint, jsonb, bigint, bigint, jsonb, boolean, uuid) is
    'Quick Capture Application Command: Kunde + Kontakt + Vorgang atomically in one transaction. Validates that an existing contact paired with an existing company is already part of its effective contact context (DETAIL=NORA_CONTACT_NOT_IN_CUSTOMER_CONTEXT on rejection). Task creation stays a separate, best-effort step after this call succeeds — see public.create_quick_capture_task for its own idempotency scope under the same key. Actor from safe_auth_uid(); requires can_write() (office/admin) — rejection carries DETAIL=NORA_PERMISSION_DENIED (Error Contract Wave, 2026-08-28). Optional p_idempotency_key covers exactly this Core scope (company+contact+deal); same key + same request replays; same key + different request raises DETAIL=NORA_IDEMPOTENCY_CONFLICT; null (default) preserves pre-wave behavior (Idempotency Wave, 2026-08-29). When p_idempotency_key is set, the returned jsonb carries _meta.disposition = "executed" | "replayed" (Operation Status Contract Wave, 2026-08-29); omitted entirely when p_idempotency_key is null.';

create or replace function public.create_quick_capture_task(
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

comment on function public.create_quick_capture_task(bigint, bigint, text, text, date, bigint, uuid) is
    'Quick Capture follow-up task creation — deliberately a separate RPC/transaction from create_quick_capture_case (best-effort semantics: a failed task must never roll back an already-committed Core write). Optional p_idempotency_key should reuse the SAME key as the paired create_quick_capture_case call but is checked under its own scope (quick_capture_case.task); same key + same request replays the existing task (no duplicate); same key + different request raises DETAIL=NORA_IDEMPOTENCY_CONFLICT; a technically failed attempt (no committed row) leaves the key freely retriable. Actor from safe_auth_uid(); requires can_write() (Idempotency Wave, 2026-08-29). When p_idempotency_key is set, the returned jsonb carries _meta.disposition = "executed" | "replayed" (Operation Status Contract Wave, 2026-08-29); omitted entirely when p_idempotency_key is null.';
