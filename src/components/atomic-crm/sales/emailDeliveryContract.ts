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
  accepted: "Versand angenommen",
  delayed: "Zustellung verzögert",
  delivered: "E-Mail zugestellt",
  undeliverable: "E-Mail konnte nicht zugestellt werden",
  spam_reported: "Als Spam markiert",
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
  delayed: "Zustellung verzögert",
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
