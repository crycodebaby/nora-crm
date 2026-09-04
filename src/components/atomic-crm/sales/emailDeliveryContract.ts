/**
 * Email delivery vocabulary mirror (Nora Employee Access V1C-A).
 *
 * V1C-A ships the backend only. This file exists so that V1C-B can build the
 * `/benutzer` delivery UI against a typed Nora vocabulary instead of against
 * provider strings — nothing in the app may ever branch on "hardBounce",
 * "softBounce", a Brevo message id, or the provider name.
 *
 * The authoritative source is the SQL read model
 * `public.employee_email_delivery_status(p_sales_id)` (admin only); this is its
 * TypeScript twin, exactly like `employeeAccessContract.ts` mirrors the Edge
 * Function's access-state contract.
 *
 * Deliberately NOT part of this contract: opens, clicks, read receipts. V1C-A
 * is delivery observability, not employee surveillance.
 */

/** Which Nora mail a delivery outcome refers to. */
export type EmployeeMailKind =
  | "employee_invite"
  | "employee_password_setup"
  | "unknown";

/**
 * What the provider currently reports about the message.
 *
 * Read these strictly:
 *   accepted      — the provider took the message. Not yet delivered.
 *   delayed       — deferred or soft-bounced; the provider is still retrying.
 *   delivered     — the RECIPIENT MAIL SYSTEM accepted it. It does NOT mean the
 *                   employee read it, clicked the link, or finished onboarding.
 *   undeliverable — hard bounce, blocked, or invalid address. Terminal.
 *   spam_reported — the recipient marked it as spam.
 */
export type EmployeeMailDeliveryOutcome =
  | "accepted"
  | "delayed"
  | "delivered"
  | "undeliverable"
  | "spam_reported";

/** One row of `public.employee_email_delivery_status`. */
export type EmployeeMailDeliveryStatus = {
  employeeId: number;
  mailKind: EmployeeMailKind;
  outcome: EmployeeMailDeliveryOutcome;
  /** Provider timestamp of the newest event behind this outcome. */
  lastEventAt: string;
  eventCount: number;
};

/**
 * Correlation honesty.
 *
 * While Supabase Auth sends invitation and recovery mails through plain SMTP,
 * Nora cannot attach its own correlation id to the message. An outcome is
 * therefore matched to an employee by recipient address, which is best-effort:
 * it identifies the person reliably, but not which individual send attempt.
 * A UI may say "Zustellung" — it must not claim "diese Einladung".
 */
export const EMPLOYEE_MAIL_CORRELATION_CONFIDENCE = "best_effort" as const;

/**
 * German UI wording for each outcome, as agreed for the V1C-B surface.
 *
 * `undeliverable` deliberately collapses hard bounce, blocked and invalid into
 * one product outcome — the administrator's next step is the same for all
 * three. A surface that wants to differentiate reads the event type from the
 * admin read model; it must still never render the provider's own word.
 */
export const EMPLOYEE_MAIL_OUTCOME_LABELS: Record<
  EmployeeMailDeliveryOutcome,
  string
> = {
  accepted: "E-Mail versendet",
  delayed: "Zustellung verzögert",
  delivered: "E-Mail zugestellt",
  undeliverable: "E-Mail konnte nicht zugestellt werden",
  spam_reported: "Als Spam markiert – Zustellung eingeschränkt",
};

/**
 * What an administrator should DO about an outcome.
 *
 * Nora never acts on these by itself: it does not correct addresses, does not
 * create accounts, and does not resend mail on a schedule. Retrying delivery is
 * the provider's job and its behaviour stays authoritative; a resend from Nora
 * only ever happens because an administrator asked for one.
 */
export const EMPLOYEE_MAIL_OUTCOME_ACTIONS: Record<
  EmployeeMailDeliveryOutcome,
  string | null
> = {
  accepted: null,
  delayed: "Der Anbieter versucht es weiter zuzustellen.",
  delivered: null,
  undeliverable: "E-Mail-Adresse prüfen",
  spam_reported: "Keine automatische erneute Zustellung",
};

/**
 * The provider's own failure text, bounded at 500 characters at ingest.
 *
 * It exists so an administrator can tell "Postfach voll" from "Adresse
 * existiert nicht". It is diagnostic, not product copy: show it as secondary
 * detail, never in place of the German outcome label.
 */
export type EmployeeMailProviderReason = string | null;

/**
 * The single guardrail this file is here to enforce: a delivered mail says
 * nothing about the employee's access state. Access state comes from
 * `employeeAccessContract.ts` and only from there.
 */
export function impliesOnboardingCompleted(
  _outcome: EmployeeMailDeliveryOutcome,
): false {
  return false;
}

/* ------------------------------------------------------------------------ *
 * V1C-B — what the admin surface actually renders
 * ------------------------------------------------------------------------ */

/**
 * Heading of the delivery block on the employee access surface.
 *
 * Deliberately impersonal. Correlation is best-effort (see
 * EMPLOYEE_MAIL_CORRELATION_CONFIDENCE), so the surface may say "the last mail
 * to this address" and must never say "this invitation". The heading carries
 * that limitation so no individual line has to repeat it.
 */
export const EMPLOYEE_MAIL_DELIVERY_HEADING = "Letzte E-Mail-Zustellung";

/**
 * Tie-break rank between outcomes carrying the *same* timestamp.
 *
 * Mirrors the CASE ladder in `public.employee_email_delivery_status()`,
 * collapsed from event types to outcomes: accepted < delayed < delivered <
 * spam_reported < undeliverable. Ordering across different timestamps is done
 * by time, so a soft bounce followed by a successful retry still ends as
 * "delivered".
 */
const OUTCOME_RANK: Record<EmployeeMailDeliveryOutcome, number> = {
  accepted: 1,
  delayed: 2,
  delivered: 3,
  spam_reported: 4,
  undeliverable: 5,
};

/**
 * The one delivery fact the surface shows, reduced from the read model.
 *
 * The read model answers per employee AND mail kind. The surface shows one
 * line, because a second line would invite the reader to pair a kind with a
 * specific send — exactly the claim best-effort correlation cannot support.
 */
export type EmployeeMailDeliverySummary = {
  outcome: EmployeeMailDeliveryOutcome;
  lastEventAt: string;
  /**
   * Kept for diagnostics and future waves. It is NOT rendered: while
   * correlation is best-effort, naming the mail would read as a claim about
   * one specific send. See `describeEmployeeMailKind`.
   */
  mailKind: EmployeeMailKind;
};

/**
 * Picks the single newest outcome for one employee across all mail kinds.
 *
 * Rows with an unparsable timestamp are skipped rather than guessed at: a
 * status with no trustworthy time behind it is worse than no status.
 */
export function summariseEmployeeMailDelivery(
  rows: ReadonlyArray<EmployeeMailDeliveryStatus>,
): EmployeeMailDeliverySummary | null {
  let best: { row: EmployeeMailDeliveryStatus; time: number } | null = null;

  for (const row of rows) {
    const time = Date.parse(row.lastEventAt);
    if (Number.isNaN(time)) continue;
    if (
      !best ||
      time > best.time ||
      (time === best.time &&
        OUTCOME_RANK[row.outcome] > OUTCOME_RANK[best.row.outcome])
    ) {
      best = { row, time };
    }
  }

  if (!best) return null;
  return {
    outcome: best.row.outcome,
    lastEventAt: best.row.lastEventAt,
    mailKind: best.row.mailKind,
  };
}

/**
 * Why the mail kind is never rendered.
 *
 * Naming the mail ("Einladung zugestellt") reads as a statement about one
 * specific send attempt. As long as Nora matches events by recipient address
 * only, that statement is not supported by the data — and the kind itself is
 * derived best-effort from the mail subject, so it can legitimately be
 * "unknown" for a perfectly ordinary mail. The function exists so the rule is
 * a testable part of the contract rather than an omission someone "fixes".
 */
export function describeEmployeeMailKind(_kind: EmployeeMailKind): null {
  return null;
}

/**
 * Delivery timestamps are rendered in the operating company's own timezone.
 *
 * Nora is used by one German business, and the administrator compares this
 * line against a mailbox and against the provider's own log. A time rendered
 * in whatever timezone the browser happens to report would silently disagree
 * with both.
 */
const deliveryTimestampFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});

/** "04.09.2026 um 17:09", or null when the value is not a usable instant. */
export function formatEmployeeMailDeliveryTimestamp(
  value: string,
): string | null {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  const parts = deliveryTimestampFormatter.formatToParts(new Date(parsed));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("day")}.${get("month")}.${get("year")} um ${get("hour")}:${get("minute")}`;
}

/**
 * The rendered delivery line.
 *
 * `text` is the status sentence, `action` the administrative next step where
 * one exists. Neither ever mentions opening, reading or clicking: the provider
 * only reports transport, and Nora deliberately stores nothing else.
 */
export type EmployeeMailDeliveryLine = {
  text: string;
  action: string | null;
};

export function formatEmployeeMailDeliveryLine(
  summary: EmployeeMailDeliverySummary,
): EmployeeMailDeliveryLine {
  const action = EMPLOYEE_MAIL_OUTCOME_ACTIONS[summary.outcome];

  if (summary.outcome === "delivered") {
    const stamp = formatEmployeeMailDeliveryTimestamp(summary.lastEventAt);
    return {
      // Without a usable timestamp the undated label is still true; inventing
      // a time would not be.
      text: stamp ? `Zugestellt am ${stamp}` : "E-Mail zugestellt",
      action,
    };
  }

  return { text: EMPLOYEE_MAIL_OUTCOME_LABELS[summary.outcome], action };
}
