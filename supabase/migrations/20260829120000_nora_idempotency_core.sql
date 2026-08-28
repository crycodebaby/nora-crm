-- Nora CRM: Idempotency Core Wave (2026-08-29).
--
-- Adds a minimal, additive idempotency contract for the two documented
-- retry-risk write commands, CreateQuickCaptureCase and
-- CreateCustomerFromContact — see docs/nora/06-decision-log.md
-- "Idempotency Wave" and docs/nora/16-current-state.md item 5.
--
-- idempotency_key != operation_id. operation_id (x-nora-operation-id header,
-- nora_private.current_operation_id()) stays a pure technical correlation id,
-- minted fresh per attempt, and is untouched by this migration.
-- idempotency_key is a client-owned business-write-intent id, passed as an
-- explicit RPC parameter (not a header — it gates business logic, unlike
-- operation_id) and stays stable across retries of the same intent.
--
-- Signature-change note: CREATE OR REPLACE FUNCTION cannot add a trailing
-- parameter without changing the argument-type list, which makes Postgres
-- create a second, overloaded function instead of replacing the first —
-- verified empirically against the local Supabase/PostgREST stack before
-- writing this migration: a naive CREATE OR REPLACE left two candidate
-- functions and broke every existing call with PGRST203 ("Could not choose
-- the best candidate function"). This migration therefore DROPs the old
-- signature before CREATEing the new one for both existing RPCs, confirmed
-- clean (old and new call shapes both resolve to exactly one function).
--
-- Quick Capture task boundary: the existing best-effort semantics (Core
-- can succeed even when the task fails, task creation stays outside the
-- Core transaction) are preserved. The task gets its own idempotency scope
-- (command = 'quick_capture_case.task') under the SAME client-supplied
-- idempotency_key as the core write (command = 'quick_capture_case.core'),
-- enforced via a new, separate RPC (public.create_quick_capture_task) with
-- its own transaction — not folded into create_quick_capture_case's
-- transaction, so a technically failed task attempt never rolls back an
-- already-committed Core write, and remains freely retriable (no
-- "task_attempted" flag — only a committed idempotency_records row counts
-- as done).

-- ---------------------------------------------------------------------------
-- 1. Persistence: nora_private.idempotency_records
-- ---------------------------------------------------------------------------

create table nora_private.idempotency_records (
    id uuid primary key default gen_random_uuid(),
    command text not null,
    idempotency_key uuid not null,
    actor_id uuid not null,
    request_fingerprint text not null,
    result jsonb not null,
    created_at timestamptz not null default now(),
    constraint idempotency_records_command_check
        check (command ~ '^[a-z][a-z0-9_.]*$'),
    constraint idempotency_records_result_object_check
        check (jsonb_typeof(result) = 'object')
);

create unique index uq_idempotency_records_scope
    on nora_private.idempotency_records (command, idempotency_key, actor_id);

create index idempotency_records_created_at_idx
    on nora_private.idempotency_records (created_at desc);

comment on table nora_private.idempotency_records is
    'Idempotency Wave (2026-08-29): claim + replay state for retry-safe write commands. No direct client grants — reachable only via nora_private.idempotency_check/idempotency_persist, called from SECURITY DEFINER RPCs. idempotency_key is not authentication, not authorization, not an operation_id.';

revoke all on table nora_private.idempotency_records from public;
revoke all on table nora_private.idempotency_records from anon;
revoke all on table nora_private.idempotency_records from authenticated;

-- ---------------------------------------------------------------------------
-- 2. Shared helpers: claim/replay + persist
--
-- Not SECURITY DEFINER themselves — only callable from within another
-- SECURITY DEFINER function's body in the same transaction (mirrors
-- nora_private.create_customer_with_contact_core's existing treatment).
-- Atomicity proof: pg_advisory_xact_lock serializes concurrent callers with
-- the same (command, idempotency_key) for the lifetime of the transaction
-- (auto-released on commit or rollback); the unique index on
-- (command, idempotency_key, actor_id) is the atomic backstop for the
-- narrow window a lock alone cannot cover, exactly like the proven
-- start_checklist_run_from_template pattern (advisory lock + SELECT +
-- INSERT + unique_violation fallback).
-- ---------------------------------------------------------------------------

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
            -- Same (command, key, actor) raced under the advisory lock in a
            -- narrow window — never overwrite, always return the winner's
            -- already-committed result.
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

-- ---------------------------------------------------------------------------
-- 3. public.create_customer_with_contact — add p_idempotency_key
--
-- DROP + CREATE, not CREATE OR REPLACE (see header note) — old 5-argument
-- callers keep working (p_idempotency_key defaults to null, no protection),
-- new 6-argument callers get the idempotency contract.
-- ---------------------------------------------------------------------------

drop function public.create_customer_with_contact(jsonb, jsonb, bigint, bigint, boolean);

create function public.create_customer_with_contact(
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
        return v_replay;
    end if;

    select core.company_id, core.contact_id
    into v_company_id, v_contact_id
    from nora_private.create_customer_with_contact_core(
        p_company, null, p_contact, p_existing_contact_id, p_self_contact_id, p_mark_self, true
    ) as core;

    v_result := jsonb_build_object('company_id', v_company_id, 'contact_id', v_contact_id);
    return nora_private.idempotency_persist('create_customer_with_contact', p_idempotency_key, v_fingerprint, v_result);
end;
$$;

alter function public.create_customer_with_contact(jsonb, jsonb, bigint, bigint, boolean, uuid) owner to postgres;

comment on function public.create_customer_with_contact(jsonb, jsonb, bigint, bigint, boolean, uuid) is
    'Atomically creates a company and (optionally) a new/existing/self contact. p_self_contact_id links an existing contact as the representing person WITHOUT touching its company_id/is_primary. p_mark_self additionally marks a new/existing contact as self for customer_kind=business (always true for individual). Actor from safe_auth_uid(); requires can_write() (office/admin) — rejection carries DETAIL=NORA_PERMISSION_DENIED (Error Contract Wave, 2026-08-28). Optional p_idempotency_key: same key + same request replays the stored result (no second write); same key + different request raises DETAIL=NORA_IDEMPOTENCY_CONFLICT; null (default) preserves pre-wave behavior (Idempotency Wave, 2026-08-29).';

revoke all on function public.create_customer_with_contact(jsonb, jsonb, bigint, bigint, boolean, uuid) from public;
revoke all on function public.create_customer_with_contact(jsonb, jsonb, bigint, bigint, boolean, uuid) from anon;
grant execute on function public.create_customer_with_contact(jsonb, jsonb, bigint, bigint, boolean, uuid) to authenticated;
grant execute on function public.create_customer_with_contact(jsonb, jsonb, bigint, bigint, boolean, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. public.create_quick_capture_case — add p_idempotency_key (Core scope
--    only: company + contact + deal. Task stays a separate RPC, section 5).
-- ---------------------------------------------------------------------------

drop function public.create_quick_capture_case(jsonb, bigint, jsonb, bigint, bigint, jsonb, boolean);

create function public.create_quick_capture_case(
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
        return v_replay;
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

    v_result := jsonb_build_object('company_id', v_company_id, 'contact_id', v_contact_id, 'deal_id', v_deal_id);
    return nora_private.idempotency_persist('quick_capture_case.core', p_idempotency_key, v_fingerprint, v_result);
end;
$$;

alter function public.create_quick_capture_case(jsonb, bigint, jsonb, bigint, bigint, jsonb, boolean, uuid) owner to postgres;

comment on function public.create_quick_capture_case(jsonb, bigint, jsonb, bigint, bigint, jsonb, boolean, uuid) is
    'Quick Capture Application Command: Kunde + Kontakt + Vorgang atomically in one transaction. Validates that an existing contact paired with an existing company is already part of its effective contact context (DETAIL=NORA_CONTACT_NOT_IN_CUSTOMER_CONTEXT on rejection). Task creation stays a separate, best-effort step after this call succeeds — see public.create_quick_capture_task for its own idempotency scope under the same key. Actor from safe_auth_uid(); requires can_write() (office/admin) — rejection carries DETAIL=NORA_PERMISSION_DENIED (Error Contract Wave, 2026-08-28). Optional p_idempotency_key covers exactly this Core scope (company+contact+deal); same key + same request replays; same key + different request raises DETAIL=NORA_IDEMPOTENCY_CONFLICT; null (default) preserves pre-wave behavior (Idempotency Wave, 2026-08-29).';

revoke all on function public.create_quick_capture_case(jsonb, bigint, jsonb, bigint, bigint, jsonb, boolean, uuid) from public;
revoke all on function public.create_quick_capture_case(jsonb, bigint, jsonb, bigint, bigint, jsonb, boolean, uuid) from anon;
grant execute on function public.create_quick_capture_case(jsonb, bigint, jsonb, bigint, bigint, jsonb, boolean, uuid) to authenticated;
grant execute on function public.create_quick_capture_case(jsonb, bigint, jsonb, bigint, bigint, jsonb, boolean, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. public.create_quick_capture_task — new RPC, own transaction, own
--    idempotency scope ('quick_capture_case.task') under the SAME
--    idempotency_key as the Core call. Deliberately NOT part of
--    create_quick_capture_case's transaction — a failed task attempt must
--    never roll back an already-committed Core write, and stays freely
--    retriable (existing best-effort semantics preserved).
-- ---------------------------------------------------------------------------

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
        return v_replay;
    end if;

    insert into public.tasks (
        contact_id, company_id, type, text, due_date, sales_id
    ) values (
        p_contact_id, p_company_id, p_type, p_text, p_due_date, p_sales_id
    )
    returning id into v_task_id;

    v_result := jsonb_build_object('task_id', v_task_id);
    return nora_private.idempotency_persist('quick_capture_case.task', p_idempotency_key, v_fingerprint, v_result);
end;
$$;

alter function public.create_quick_capture_task(bigint, bigint, text, text, date, bigint, uuid) owner to postgres;

comment on function public.create_quick_capture_task(bigint, bigint, text, text, date, bigint, uuid) is
    'Quick Capture follow-up task creation — deliberately a separate RPC/transaction from create_quick_capture_case (best-effort semantics: a failed task must never roll back an already-committed Core write). Optional p_idempotency_key should reuse the SAME key as the paired create_quick_capture_case call but is checked under its own scope (quick_capture_case.task); same key + same request replays the existing task (no duplicate); same key + different request raises DETAIL=NORA_IDEMPOTENCY_CONFLICT; a technically failed attempt (no committed row) leaves the key freely retriable. Actor from safe_auth_uid(); requires can_write() (Idempotency Wave, 2026-08-29).';

revoke all on function public.create_quick_capture_task(bigint, bigint, text, text, date, bigint, uuid) from public;
revoke all on function public.create_quick_capture_task(bigint, bigint, text, text, date, bigint, uuid) from anon;
grant execute on function public.create_quick_capture_task(bigint, bigint, text, text, date, bigint, uuid) to authenticated;
grant execute on function public.create_quick_capture_task(bigint, bigint, text, text, date, bigint, uuid) to service_role;
