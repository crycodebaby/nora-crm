/**
 * Nora Notification Presentation Contract v1 (Phase 7B.1, 2026-08-29).
 *
 * The human translation layer on top of the Operation Status Contract. This
 * module is framework-free (no React, no Supabase) and UI-neutral: it carries
 * no colors, no Tailwind classes, no ReactNodes, no HTML and no finished text —
 * only i18n keys plus a whitelisted, flat display context.
 *
 * Hard boundaries (docs/nora/06-decision-log.md, "Notification Presentation
 * Contract v1 (Phase 7A)"):
 * - Operation Status stays the technical truth. Nothing here writes back to it.
 * - `notificationId` is NEVER an `operationId`. One notification may cover
 *   several technical operations (Quick Capture: Core + Task).
 * - A Presentation-only `partial` exists here; the core lifecycle keeps its
 *   three values (`pending | success | error`) unchanged.
 * - `tone` is derived from `lifecycle`, never set independently — contradictory
 *   combinations must be unrepresentable.
 */

/** Visual status semantics. Derived only — see `toneForLifecycle`. */
export type NotificationTone = "pending" | "success" | "warning" | "error";

/**
 * Presentation lifecycle. Deliberately NOT identical to OperationStatus:
 * "partial" exists only here (Core succeeded, an optional follow-up step did
 * not) and never becomes a core lifecycle value.
 */
export type NotificationLifecycle = "pending" | "success" | "partial" | "error";

/**
 * The single source of tone. Exhaustive by construction: adding a lifecycle
 * without a tone is a type error.
 */
export const TONE_BY_LIFECYCLE: Record<
  NotificationLifecycle,
  NotificationTone
> = {
  pending: "pending",
  success: "success",
  partial: "warning",
  error: "error",
};

export const toneForLifecycle = (
  lifecycle: NotificationLifecycle,
): NotificationTone => TONE_BY_LIFECYCLE[lifecycle];

/**
 * Discriminated union over the lifecycle. `partial` and `error` REQUIRE a
 * human-readable detail key — a warning or failure without a reason is not
 * representable (Guardrail, Phase 7A).
 */
export type NotificationState =
  | { lifecycle: "pending" }
  | { lifecycle: "success" }
  | { lifecycle: "partial"; detailKey: string }
  | { lifecycle: "error"; detailKey: string };

export const isSettledState = (state: NotificationState): boolean =>
  state.lifecycle !== "pending";

export const notificationTone = (state: NotificationState): NotificationTone =>
  toneForLifecycle(state.lifecycle);

/**
 * Who triggered the action. v1 always sets "human" and renders nothing for it.
 * The field exists so a later AI/automation initiator does not require a
 * contract change — it must always come from structured execution/audit
 * context, never from a heuristic and never from an LLM.
 */
export type NotificationInitiatorKind =
  | "human"
  | "ai"
  | "automation"
  | "system";

export type NotificationInitiator = {
  kind: NotificationInitiatorKind;
  /** Only rendered when kind !== "human". A configured, finite string. */
  label?: string;
};

/**
 * Explicit default. A MISSING initiator must never be read as "probably not a
 * human" — every record carries one.
 */
export const HUMAN_INITIATOR: NotificationInitiator = Object.freeze({
  kind: "human",
});

/**
 * Everything the card may say about the business subject. Flat, finite, and
 * supplied at the start of the user action — never guessed from UI strings,
 * never re-fetched, never forwarded into operation_errors.technical_context.
 */
export type NotificationDisplayContext = {
  customerName?: string;
  contactName?: string;
  dealTitle?: string;
  taskTitle?: string;
};

/** A deal title can be long; the card must not grow to fill the screen. */
export const DISPLAY_CONTEXT_MAX_LENGTH = 80;

const clampDisplayValue = (value: string | undefined): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length <= DISPLAY_CONTEXT_MAX_LENGTH) return trimmed;
  return `${trimmed.slice(0, DISPLAY_CONTEXT_MAX_LENGTH - 1).trimEnd()}…`;
};

/**
 * Trims, clamps and drops empty values. A dropped value must select a
 * DIFFERENT message key downstream — never render an empty placeholder.
 */
export const sanitizeDisplayContext = (
  raw: NotificationDisplayContext | undefined,
): NotificationDisplayContext => {
  if (!raw) return {};
  const result: NotificationDisplayContext = {};
  const customerName = clampDisplayValue(raw.customerName);
  const contactName = clampDisplayValue(raw.contactName);
  const dealTitle = clampDisplayValue(raw.dealTitle);
  const taskTitle = clampDisplayValue(raw.taskTitle);
  if (customerName) result.customerName = customerName;
  if (contactName) result.contactName = contactName;
  if (dealTitle) result.dealTitle = dealTitle;
  if (taskTitle) result.taskTitle = taskTitle;
  return result;
};

/** Where a "reopen" retry would send the user. */
export type NotificationReopenTarget = "quickCapture" | "contactToCustomer";

/**
 * Retry is a command policy, never inferred from an error code: it requires
 * BOTH an explicit policy and a compatible idempotency scope. Phase 7B ships
 * `none` everywhere (decision log, Phase 7A).
 */
export type NotificationRetryPolicy =
  | { kind: "none" }
  | { kind: "reopen"; targetKey: NotificationReopenTarget }
  | { kind: "safeRetry" };

export const NO_RETRY: NotificationRetryPolicy = Object.freeze({
  kind: "none",
});

/** Business intent, not the technical OperationType. */
export type NotificationIntentType =
  | "quickCapture.case"
  | "customer.createWithContact"
  | "contact.convertToCustomer"
  | "deal.update";

/**
 * i18n keys plus whitelisted arguments. Never raw text, never a NORA_* code,
 * never HTML. The detail line lives on `NotificationState`, so that a
 * `partial`/`error` cannot exist without one.
 */
export type NotificationMessage = {
  titleKey: string;
  /** Undefined when there is no usable display context at all. */
  bodyKey?: string;
  args: NotificationDisplayContext;
};

export type NotificationRecord = {
  /** Own identity. NEVER equal to an operationId. */
  notificationId: string;
  intentType: NotificationIntentType;
  /** Every technical operation covered by this one card, in registration order. */
  operationIds: readonly string[];
  /** The operation that decides the core outcome. */
  primaryOperationId: string;

  state: NotificationState;
  message: NotificationMessage;
  displayContext: NotificationDisplayContext;
  initiator: NotificationInitiator;

  retry: NotificationRetryPolicy;
  /**
   * Capability only — Phase 7B renders no escalation UI. True only once a
   * publicErrorRef actually exists (decision log, Phase 7A).
   */
  canEscalateToIT: boolean;
  /** NORA-E… from operation_errors.public_ref, may arrive after settling. */
  publicErrorRef?: string;

  /** Registration time (ms epoch). */
  createdAt: number;
  /** When the card actually became visible — not when it was registered. */
  visibleSince?: number;
  /** When the settled state became the DISPLAYED state. */
  settledAt?: number;
  /** Absolute ms deadline, or null = stays until dismissed manually. */
  dismissAt: number | null;
  dismissPaused: boolean;
};

/** Visible cards only ever come from the store's frozen snapshot. */
export type NotificationSnapshot = readonly NotificationRecord[];
