/**
 * Provider-neutral email delivery event contract (Nora Employee Access V1C-A).
 *
 * Nothing outside this module may know that the provider is Brevo. The rest of
 * Nora — database rows, read model, later UI — sees only NoraEmailEventType.
 *
 * Two decisions are encoded here on purpose:
 *
 *  1. Tracking events (opened / uniqueOpened / click / proxy opens) are
 *     *classified*, not mapped. They are never persisted, because V1C-A is
 *     operational delivery observability, not employee surveillance. They are
 *     still answered with 2xx so the provider stops retrying them.
 *
 *  2. An event name we do not know is ignored the same way rather than
 *     rejected: an unknown future provider event is not an error on our side,
 *     and returning 4xx would make the provider retry it forever.
 */

/** The only email delivery vocabulary the rest of Nora is allowed to read. */
export type NoraEmailEventType =
  | "EMAIL_ACCEPTED"
  | "EMAIL_DELIVERED"
  | "EMAIL_DEFERRED"
  | "EMAIL_SOFT_BOUNCED"
  | "EMAIL_HARD_BOUNCED"
  | "EMAIL_BLOCKED"
  | "EMAIL_INVALID"
  | "EMAIL_SPAM_REPORTED";

/** Product-facing outcome. This — not the event list — is what a UI renders. */
export type NoraEmailDeliveryOutcome =
  | "accepted"
  | "delayed"
  | "delivered"
  | "undeliverable"
  | "spam_reported";

/** Which Nora mail this was, as far as the subject allows us to tell. */
export type NoraMailKind =
  | "employee_invite"
  | "employee_password_setup"
  | "unknown";

/**
 * Supported provider event names → Nora contract.
 *
 * Brevo emits both "request" and "sent" for the hand-off to the recipient's
 * mail system; both mean the same thing to Nora: the provider accepted the
 * message. That is explicitly NOT "delivered".
 */
const PROVIDER_EVENT_MAP: Record<string, NoraEmailEventType> = {
  request: "EMAIL_ACCEPTED",
  sent: "EMAIL_ACCEPTED",
  delivered: "EMAIL_DELIVERED",
  deferred: "EMAIL_DEFERRED",
  softbounce: "EMAIL_SOFT_BOUNCED",
  soft_bounce: "EMAIL_SOFT_BOUNCED",
  hardbounce: "EMAIL_HARD_BOUNCED",
  hard_bounce: "EMAIL_HARD_BOUNCED",
  blocked: "EMAIL_BLOCKED",
  invalid: "EMAIL_INVALID",
  invalid_email: "EMAIL_INVALID",
  spam: "EMAIL_SPAM_REPORTED",
};

/**
 * Events we deliberately refuse to store. Kept as an explicit list (not an
 * "everything else" bucket) so that adding open/click tracking later has to be
 * a conscious edit here rather than an accident.
 */
const TRACKING_EVENT_NAMES = new Set([
  "opened",
  "uniqueopened",
  "unique_opened",
  "click",
  "clicked",
  "proxy_open",
  "unique_proxy_open",
]);

export type EventClassification =
  | { kind: "supported"; eventType: NoraEmailEventType }
  | { kind: "tracking_ignored" }
  | { kind: "unsupported_ignored" };

function normaliseEventName(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

export function classifyProviderEvent(raw: unknown): EventClassification {
  const name = normaliseEventName(raw);
  const mapped = PROVIDER_EVENT_MAP[name];
  if (mapped) return { kind: "supported", eventType: mapped };
  if (TRACKING_EVENT_NAMES.has(name)) return { kind: "tracking_ignored" };
  return { kind: "unsupported_ignored" };
}

/**
 * Severity rank used only to break ties between events carrying the *same*
 * provider timestamp. Ordering across different timestamps is done by time, so
 * a soft bounce followed by a successful retry correctly ends as "delivered".
 * Mirrors the CASE ladder in employee_email_delivery_status().
 */
const OUTCOME_RANK: Record<NoraEmailEventType, number> = {
  EMAIL_ACCEPTED: 1,
  EMAIL_DEFERRED: 2,
  EMAIL_SOFT_BOUNCED: 3,
  EMAIL_DELIVERED: 4,
  EMAIL_SPAM_REPORTED: 5,
  EMAIL_INVALID: 6,
  EMAIL_BLOCKED: 7,
  EMAIL_HARD_BOUNCED: 8,
};

const OUTCOME_BY_EVENT: Record<NoraEmailEventType, NoraEmailDeliveryOutcome> = {
  EMAIL_ACCEPTED: "accepted",
  EMAIL_DEFERRED: "delayed",
  EMAIL_SOFT_BOUNCED: "delayed",
  EMAIL_DELIVERED: "delivered",
  EMAIL_HARD_BOUNCED: "undeliverable",
  EMAIL_BLOCKED: "undeliverable",
  EMAIL_INVALID: "undeliverable",
  EMAIL_SPAM_REPORTED: "spam_reported",
};

export function outcomeForEvent(
  eventType: NoraEmailEventType,
): NoraEmailDeliveryOutcome {
  return OUTCOME_BY_EVENT[eventType];
}

/**
 * Derives the current product outcome from an unordered event set.
 *
 * Webhook events arrive out of order and may be replayed, so this must not
 * depend on array order. It is the TypeScript twin of the SQL read model and
 * exists so V1C-B can derive the same answer client-side from a raw list.
 */
export function deriveDeliveryOutcome(
  events: ReadonlyArray<{ eventType: NoraEmailEventType; eventAt: string }>,
): NoraEmailDeliveryOutcome | null {
  let best: { eventType: NoraEmailEventType; time: number } | null = null;

  for (const event of events) {
    const time = Date.parse(event.eventAt);
    if (Number.isNaN(time)) continue;
    if (
      !best ||
      time > best.time ||
      (time === best.time &&
        OUTCOME_RANK[event.eventType] > OUTCOME_RANK[best.eventType])
    ) {
      best = { eventType: event.eventType, time };
    }
  }

  return best ? OUTCOME_BY_EVENT[best.eventType] : null;
}

/**
 * Subject → mail kind.
 *
 * The subjects are the ones configured for the Supabase Auth invite and
 * recovery templates. This is a best-effort classification: an operator who
 * edits a subject in the Dashboard without editing this map turns the kind into
 * "unknown", which is a degraded but honest answer — never a wrong one.
 */
const MAIL_KIND_SUBJECTS: ReadonlyArray<[string, NoraMailKind]> = [
  ["einladung zu nora", "employee_invite"],
  ["persönliches passwort für nora einrichten", "employee_password_setup"],
];

export function classifyMailKind(subject: unknown): NoraMailKind {
  if (typeof subject !== "string") return "unknown";
  const normalised = subject.trim().toLowerCase();
  if (!normalised) return "unknown";
  for (const [needle, kind] of MAIL_KIND_SUBJECTS) {
    if (normalised.includes(needle)) return kind;
  }
  return "unknown";
}

/** What the ingest layer receives — already provider-neutral. */
export type NormalisedEmailEvent = {
  providerEvent: string;
  eventType: NoraEmailEventType;
  recipient: string;
  eventAt: string;
  dedupeKey: string;
  providerMessageId: string | null;
  providerEventId: string | null;
  mailKind: NoraMailKind;
  reason: string | null;
};

export type NormaliseResult =
  | { status: "ok"; event: NormalisedEmailEvent }
  | {
      status: "ignored";
      providerEvent: string;
      why: "tracking" | "unsupported";
    }
  | { status: "malformed"; why: string };

function readString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

/**
 * Reads the provider timestamp.
 *
 * ts_event / ts / ts_epoch are UTC and unambiguous; `date` is documented as
 * CET/CEST and therefore only a last resort. ts_epoch is milliseconds, the
 * other two are seconds — distinguished by magnitude rather than by trusting a
 * field name, because a wrong factor here silently mis-orders history.
 */
function readEventAt(payload: Record<string, unknown>): string | null {
  const epochCandidates: Array<[unknown, "s" | "ms"]> = [
    [payload["ts_event"], "s"],
    [payload["ts"], "s"],
    [payload["ts_epoch"], "ms"],
  ];

  for (const [raw, unit] of epochCandidates) {
    const numeric = typeof raw === "string" ? Number(raw) : raw;
    if (typeof numeric !== "number" || !Number.isFinite(numeric)) continue;
    if (numeric <= 0) continue;
    // A "seconds" field carrying a millisecond value (and vice versa) would be
    // off by three orders of magnitude; normalise by magnitude, not by name.
    const ms = unit === "ms" || numeric > 1e11 ? numeric : numeric * 1000;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  const dateString = readString(payload["date"]);
  if (dateString) {
    const parsed = Date.parse(dateString);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }

  return null;
}

/**
 * Builds the event identity used for duplicate suppression.
 *
 * The provider does not guarantee a single unique event id across all event
 * types, so identity is the combination that actually distinguishes one
 * occurrence: which message, to whom, which event, when — plus the provider's
 * own id when it sends one.
 */
export function buildDedupeKey(parts: {
  providerMessageId: string | null;
  providerEventId: string | null;
  providerEvent: string;
  recipient: string;
  eventAt: string;
}): string {
  return [
    parts.providerMessageId ?? "-",
    parts.providerEventId ?? "-",
    parts.providerEvent,
    parts.recipient.toLowerCase(),
    parts.eventAt,
  ].join("|");
}

/** Basic shape check only — we never validate a recipient into existence. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function normaliseProviderEvent(raw: unknown): NormaliseResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { status: "malformed", why: "not_an_object" };
  }

  const payload = raw as Record<string, unknown>;
  const providerEventName = normaliseEventName(payload["event"]);
  if (!providerEventName) {
    return { status: "malformed", why: "missing_event" };
  }

  const classification = classifyProviderEvent(providerEventName);
  if (classification.kind === "tracking_ignored") {
    return {
      status: "ignored",
      providerEvent: providerEventName,
      why: "tracking",
    };
  }
  if (classification.kind === "unsupported_ignored") {
    return {
      status: "ignored",
      providerEvent: providerEventName,
      why: "unsupported",
    };
  }

  const recipient = readString(payload["email"]);
  if (!recipient || !looksLikeEmail(recipient)) {
    return { status: "malformed", why: "missing_recipient" };
  }

  const eventAt = readEventAt(payload);
  if (!eventAt) {
    return { status: "malformed", why: "missing_event_timestamp" };
  }

  const providerMessageId = readString(payload["message-id"]);
  const providerEventId = readString(payload["id"]);
  const reason = readString(payload["reason"]);

  return {
    status: "ok",
    event: {
      providerEvent: providerEventName,
      eventType: classification.eventType,
      recipient,
      eventAt,
      providerMessageId,
      providerEventId,
      mailKind: classifyMailKind(payload["subject"]),
      // Provider-supplied diagnostic text: truncated, never a body, never a link.
      reason: reason ? reason.slice(0, 500) : null,
      dedupeKey: buildDedupeKey({
        providerMessageId,
        providerEventId,
        providerEvent: providerEventName,
        recipient,
        eventAt,
      }),
    },
  };
}

/**
 * The provider posts either a single event object or, with batching enabled, a
 * wrapper carrying many. Accept both plus a bare array so that turning batching
 * on in the provider dashboard cannot silently drop events.
 */
export function extractEventPayloads(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    const items = (body as Record<string, unknown>)["items"];
    if (Array.isArray(items)) return items;
    return [body];
  }
  return null;
}
