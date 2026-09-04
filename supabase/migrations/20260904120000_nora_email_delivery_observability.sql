-- Nora Employee Access V1C-A – Transactional Email Delivery Observability (backend RC)
--
-- Purpose: persist provider-reported delivery outcomes for the transactional
-- mails Nora triggers (employee invitation, password setup) so an administrator
-- can later be told "E-Mail zugestellt" / "Zustellung verzögert" / "E-Mail
-- konnte nicht zugestellt werden" instead of only "Versand wurde angenommen".
--
-- Scope boundaries baked into this schema on purpose:
--   * NO open/click surveillance. Tracking events are rejected at the Edge
--     Function and can never reach this table (CHECK on event_type).
--   * NO email bodies, NO subjects, NO auth links, NO one-time tokens.
--   * Append-only: INSERT + SELECT grants only, no UPDATE/DELETE anywhere.
--   * Correlation to a specific Nora send attempt is BEST_EFFORT, never
--     deterministic, as long as Supabase Auth sends through plain SMTP — the
--     column correlation_confidence records that fact per row instead of
--     letting later readers assume more than we know.
--
-- Additive only. No existing object is modified.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
-- employee_sale_id is a *resolved convenience*, not proof: it says the
-- recipient address belonged to that sales row when the event arrived, nothing
-- more. It is a SOFT reference with no foreign key, exactly like
-- operation_errors.resource_id: a real FK would either cascade the technical
-- history away or fire an ON DELETE SET NULL update against a table that must
-- never be updated.

create table if not exists public.email_delivery_events (
    id uuid primary key default gen_random_uuid(),

    -- Provider facts -------------------------------------------------------
    provider text not null default 'brevo',
    -- Raw provider event name, kept for diagnostics only. Nothing in Nora may
    -- branch on this value; branch on event_type.
    provider_event text not null,
    provider_message_id text,
    provider_event_id text,

    -- Nora contract --------------------------------------------------------
    event_type text not null,

    -- Correlation ----------------------------------------------------------
    -- Stored lowercased so that dedupe and reporting are stable regardless of
    -- how the provider echoes the address back.
    recipient text not null,
    employee_sale_id bigint,
    recipient_match text not null,
    correlation_confidence text not null,
    -- Derived from the configured Auth email subject; 'unknown' whenever the
    -- subject does not match a Nora template.
    mail_kind text not null default 'unknown',

    -- Minimal diagnostics --------------------------------------------------
    reason text,

    -- Timing ---------------------------------------------------------------
    -- event_at = provider timestamp (when it happened), received_at = when the
    -- webhook reached Nora. Product status is derived from event_at, never
    -- from arrival order.
    event_at timestamptz not null,
    received_at timestamptz not null default now(),

    -- Idempotency ----------------------------------------------------------
    dedupe_key text not null,

    constraint email_delivery_events_provider_check
        check (provider in ('brevo')),
    constraint email_delivery_events_event_type_check
        check (
            event_type in (
                'EMAIL_ACCEPTED',
                'EMAIL_DELIVERED',
                'EMAIL_DEFERRED',
                'EMAIL_SOFT_BOUNCED',
                'EMAIL_HARD_BOUNCED',
                'EMAIL_BLOCKED',
                'EMAIL_INVALID',
                'EMAIL_SPAM_REPORTED'
            )
        ),
    constraint email_delivery_events_recipient_match_check
        check (recipient_match in ('employee', 'unknown')),
    constraint email_delivery_events_correlation_confidence_check
        check (
            correlation_confidence in ('deterministic', 'best_effort', 'none')
        ),
    constraint email_delivery_events_mail_kind_check
        check (
            mail_kind in (
                'employee_invite',
                'employee_password_setup',
                'unknown'
            )
        ),
    constraint email_delivery_events_provider_event_len_check
        check (char_length(provider_event) between 1 and 64),
    constraint email_delivery_events_provider_message_id_len_check
        check (
            provider_message_id is null
            or char_length(provider_message_id) <= 255
        ),
    constraint email_delivery_events_provider_event_id_len_check
        check (
            provider_event_id is null
            or char_length(provider_event_id) <= 128
        ),
    constraint email_delivery_events_recipient_len_check
        check (char_length(recipient) between 3 and 320),
    constraint email_delivery_events_reason_len_check
        check (reason is null or char_length(reason) <= 500),
    constraint email_delivery_events_dedupe_key_len_check
        check (char_length(dedupe_key) between 1 and 512),
    -- An employee-matched row must never claim it matched nothing and vice
    -- versa; keeps later readers from inventing a third interpretation.
    constraint email_delivery_events_match_consistency_check
        check (
            (recipient_match = 'employee' and employee_sale_id is not null)
            or (recipient_match = 'unknown' and employee_sale_id is null)
        )
);

-- Idempotency: the provider may retry the same event. Same provider + same
-- identity string = same event, inserted once.
create unique index if not exists email_delivery_events_dedupe_uidx
    on public.email_delivery_events (provider, dedupe_key);

create index if not exists email_delivery_events_employee_event_at_idx
    on public.email_delivery_events (employee_sale_id, event_at desc)
    where employee_sale_id is not null;

create index if not exists email_delivery_events_message_idx
    on public.email_delivery_events (provider, provider_message_id)
    where provider_message_id is not null;

create index if not exists email_delivery_events_event_at_idx
    on public.email_delivery_events (event_at desc);

comment on table public.email_delivery_events is
    'V1C-A: append-only technical delivery events reported by the mail provider. No opens, no clicks, no bodies, no tokens. Correlation to a specific Nora send is best-effort.';

comment on column public.email_delivery_events.provider_event is
    'Raw provider event name, diagnostics only. Nora logic must branch on event_type.';

comment on column public.email_delivery_events.event_type is
    'Provider-neutral Nora event contract. The only value the rest of Nora may read.';

comment on column public.email_delivery_events.correlation_confidence is
    'How well this event maps to one Nora send attempt. best_effort while Supabase Auth sends via plain SMTP (no Nora-controlled correlation id in the message).';

comment on column public.email_delivery_events.employee_sale_id is
    'Resolved from the recipient address at ingest time. Convenience, not proof of which send attempt this was.';

comment on column public.email_delivery_events.mail_kind is
    'Best-effort classification from the Auth email subject; unknown when the subject is not a Nora template.';

comment on column public.email_delivery_events.dedupe_key is
    'Stable provider event identity. Duplicate webhook deliveries collide here and are ignored.';

-- ---------------------------------------------------------------------------
-- 2. RLS / Grants — append-only, admin-read
-- ---------------------------------------------------------------------------
-- No UPDATE and no DELETE grant is issued to any role. That, not a trigger, is
-- what makes the table append-only: service_role bypasses RLS but not grants.

alter table public.email_delivery_events enable row level security;

revoke all on table public.email_delivery_events from public;
revoke all on table public.email_delivery_events from anon;
revoke all on table public.email_delivery_events from authenticated;
revoke all on table public.email_delivery_events from service_role;

-- Normal employees (viewer/office) get nothing: no grant, and the single
-- policy below additionally requires admin.
grant select on table public.email_delivery_events to authenticated;
grant select, insert on table public.email_delivery_events to service_role;

drop policy if exists "Email delivery events read admin only"
    on public.email_delivery_events;
create policy "Email delivery events read admin only"
    on public.email_delivery_events
    for select
    to authenticated
    using (nora_private.is_admin());

-- No INSERT/UPDATE/DELETE policy for authenticated: ingest happens exclusively
-- through the SECURITY DEFINER RPC below, called by the webhook Edge Function.

-- ---------------------------------------------------------------------------
-- 3. Ingest RPC (webhook server only)
-- ---------------------------------------------------------------------------
-- Normalisation into the Nora contract happens in the Edge Function; this RPC
-- owns the two things that must be atomic in the database: recipient → employee
-- resolution and duplicate suppression.
--
-- Returns whether the row was newly stored, so the webhook can answer
-- truthfully without a second round trip.

create or replace function public.ingest_email_delivery_event(
    p_provider_event text,
    p_event_type text,
    p_recipient text,
    p_event_at timestamptz,
    p_dedupe_key text,
    p_provider_message_id text default null,
    p_provider_event_id text default null,
    p_mail_kind text default 'unknown',
    p_reason text default null
)
returns table (event_id uuid, stored boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_sale_id bigint;
    v_recipient text;
    v_event_id uuid;
begin
    if p_recipient is null or btrim(p_recipient) = '' then
        raise exception 'recipient required' using errcode = '22023';
    end if;
    if p_event_at is null then
        raise exception 'event_at required' using errcode = '22023';
    end if;
    if p_dedupe_key is null or btrim(p_dedupe_key) = '' then
        raise exception 'dedupe_key required' using errcode = '22023';
    end if;

    v_recipient := lower(btrim(p_recipient));

    -- Best-effort correlation: the address currently belongs to this employee.
    -- Compared as lowercased text rather than through the citext = operator,
    -- because this function runs with an empty search_path and operator lookup
    -- would depend on the extensions schema being on it.
    select s.id
    into v_sale_id
    from public.sales s
    where lower(s.email::text) = v_recipient
    limit 1;

    insert into public.email_delivery_events (
        provider,
        provider_event,
        provider_message_id,
        provider_event_id,
        event_type,
        recipient,
        employee_sale_id,
        recipient_match,
        correlation_confidence,
        mail_kind,
        reason,
        event_at,
        dedupe_key
    )
    values (
        'brevo',
        p_provider_event,
        p_provider_message_id,
        p_provider_event_id,
        p_event_type,
        v_recipient,
        v_sale_id,
        case when v_sale_id is null then 'unknown' else 'employee' end,
        case when v_sale_id is null then 'none' else 'best_effort' end,
        coalesce(nullif(btrim(p_mail_kind), ''), 'unknown'),
        left(nullif(btrim(p_reason), ''), 500),
        p_event_at,
        p_dedupe_key
    )
    on conflict (provider, dedupe_key) do nothing
    returning id into v_event_id;

    if v_event_id is not null then
        return query select v_event_id, true;
        return;
    end if;

    -- Duplicate: report the row that already holds this event identity.
    select e.id
    into v_event_id
    from public.email_delivery_events e
    where e.provider = 'brevo'
      and e.dedupe_key = p_dedupe_key;

    return query select v_event_id, false;
end;
$$;

alter function public.ingest_email_delivery_event(
    text, text, text, timestamptz, text, text, text, text, text
) owner to postgres;

comment on function public.ingest_email_delivery_event(
    text, text, text, timestamptz, text, text, text, text, text
) is
    'V1C-A webhook ingest. Resolves recipient → sales best-effort and suppresses duplicate provider deliveries. service_role only.';

revoke all on function public.ingest_email_delivery_event(
    text, text, text, timestamptz, text, text, text, text, text
) from public;
revoke all on function public.ingest_email_delivery_event(
    text, text, text, timestamptz, text, text, text, text, text
) from anon;
revoke all on function public.ingest_email_delivery_event(
    text, text, text, timestamptz, text, text, text, text, text
) from authenticated;
grant execute on function public.ingest_email_delivery_event(
    text, text, text, timestamptz, text, text, text, text, text
) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Read model for V1C-B
-- ---------------------------------------------------------------------------
-- The UI must never see hardBounce/softBounce/Brevo/message-id. It asks this
-- function and receives one product outcome per employee and mail kind.
--
-- Outcome derivation is semantic, not arrival-ordered: the latest event by
-- provider timestamp wins, and equal timestamps are broken by severity rank.
-- That makes a soft bounce followed by a successful retry read as "delivered",
-- and an out-of-order "sent" arriving after "delivered" harmless.
--
-- Deliberately absent: anything that would imply the employee read the mail or
-- finished onboarding. 'delivered' means the receiving mail system accepted
-- the message, nothing else.

create or replace function public.employee_email_delivery_status(
    p_sales_id bigint default null
)
returns table (
    employee_id bigint,
    mail_kind text,
    outcome text,
    last_event_at timestamptz,
    event_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not nora_private.is_admin() then
        raise exception 'forbidden' using errcode = '42501';
    end if;

    return query
    with ranked as (
        select
            e.employee_sale_id,
            e.mail_kind as kind,
            e.event_type,
            e.event_at,
            row_number() over (
                partition by e.employee_sale_id, e.mail_kind
                order by
                    e.event_at desc,
                    case e.event_type
                        when 'EMAIL_HARD_BOUNCED' then 8
                        when 'EMAIL_BLOCKED' then 7
                        when 'EMAIL_INVALID' then 6
                        when 'EMAIL_SPAM_REPORTED' then 5
                        when 'EMAIL_DELIVERED' then 4
                        when 'EMAIL_SOFT_BOUNCED' then 3
                        when 'EMAIL_DEFERRED' then 2
                        else 1
                    end desc
            ) as rn,
            count(*) over (
                partition by e.employee_sale_id, e.mail_kind
            ) as total
        from public.email_delivery_events e
        where e.employee_sale_id is not null
          and (p_sales_id is null or e.employee_sale_id = p_sales_id)
    )
    select
        r.employee_sale_id,
        r.kind,
        case r.event_type
            when 'EMAIL_DELIVERED' then 'delivered'
            when 'EMAIL_DEFERRED' then 'delayed'
            when 'EMAIL_SOFT_BOUNCED' then 'delayed'
            when 'EMAIL_HARD_BOUNCED' then 'undeliverable'
            when 'EMAIL_BLOCKED' then 'undeliverable'
            when 'EMAIL_INVALID' then 'undeliverable'
            when 'EMAIL_SPAM_REPORTED' then 'spam_reported'
            else 'accepted'
        end,
        r.event_at,
        r.total::integer
    from ranked r
    where r.rn = 1;
end;
$$;

alter function public.employee_email_delivery_status(bigint) owner to postgres;

comment on function public.employee_email_delivery_status(bigint) is
    'V1C-B read model: one product delivery outcome per employee and mail kind. Admin only. Never exposes provider event names, message ids or subjects.';

revoke all on function public.employee_email_delivery_status(bigint) from public;
revoke all on function public.employee_email_delivery_status(bigint) from anon;
grant execute on function public.employee_email_delivery_status(bigint) to authenticated;
grant execute on function public.employee_email_delivery_status(bigint) to service_role;
