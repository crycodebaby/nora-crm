/**
 * Nora Error Contract — the stable, machine-readable business error codes
 * shared across every Nora write path (Postgres RPCs/triggers, FakeRest,
 * Application Commands, UI). Framework-free (no React, no Supabase) so it
 * can be imported from the server-adjacent FakeRest layer, the Application
 * layer, and presentation code alike.
 *
 * Contract (Error Contract Wave, 2026-08-28):
 * - MESSAGE (human text) is never canonical and may be freely reworded/
 *   translated without breaking detection.
 * - SQLSTATE (`ERRCODE`) carries PostgreSQL/transport semantics, not Nora
 *   business identity — it is not read for classification.
 * - `DETAIL` (real Postgres RPCs) / `.details` (FakeRest, mirroring the
 *   PostgrestError shape) carries the one canonical Nora code below.
 *
 * A new business error gets a code here ONLY once it is a real, traced
 * origin in the codebase — no speculative codes for hypothetical futures
 * (see docs/nora/06-decision-log.md "Error Contract Wave").
 */

export const NORA_ERROR_CODES = {
  CONTACT_NOT_IN_CUSTOMER_CONTEXT: "NORA_CONTACT_NOT_IN_CUSTOMER_CONTEXT",
  INDIVIDUAL_NAME_REQUIRED: "NORA_INDIVIDUAL_NAME_REQUIRED",
  SELF_CONTACT_DELETE_BLOCKED: "NORA_SELF_CONTACT_DELETE_BLOCKED",
  PRIVATE_CUSTOMER_ALREADY_EXISTS: "NORA_PRIVATE_CUSTOMER_ALREADY_EXISTS",
  PERMISSION_DENIED: "NORA_PERMISSION_DENIED",
  IDEMPOTENCY_CONFLICT: "NORA_IDEMPOTENCY_CONFLICT",
  /** User Lifecycle W2: a disabled employee cannot be newly assigned as responsible. */
  EMPLOYEE_NOT_ASSIGNABLE: "NORA_EMPLOYEE_NOT_ASSIGNABLE",
  /**
   * Atomic Contact Primary Intent (2026-09-08): the customer already has a
   * Hauptansprechpartner and the write tried to add a second one without
   * going through the primary transition (legacy raw write hitting
   * uq_contacts_one_primary_per_company, or the residual translation inside
   * create_contact/update_contact).
   */
  PRIMARY_CONTACT_ALREADY_EXISTS: "NORA_PRIMARY_CONTACT_ALREADY_EXISTS",
  /**
   * Atomic Contact Primary Intent (2026-09-08): the Hauptansprechpartner the
   * user observed in the form is no longer the current one — the transition
   * was refused and rolled back so a newer primary is never replaced silently.
   */
  PRIMARY_CONTACT_CHANGED: "NORA_PRIMARY_CONTACT_CHANGED",
  /**
   * W8-C S3A/S3B (2026-09-19): a note write tried to (re)reference an
   * attachment whose storage object has a deletion intent or was deleted —
   * typically a stale form re-adding a file someone else removed meanwhile.
   * Raised by the S3A admission guard inside the S3B note projection; the
   * whole note write is rolled back. Retrying does not help.
   */
  ATTACHMENT_STORAGE_KEY_PENDING_DELETION:
    "NORA_ATTACHMENT_STORAGE_KEY_PENDING_DELETION",
  /**
   * W8-C S3B (2026-09-19): a note attachment element is not a valid Nora
   * attachment reference (no storage key / title / type, a src that does not
   * match its key, a repeated key, or a changed title / type of an existing
   * attachment). Raised by the note projection (the whole note write is
   * rolled back) and, for an undownloadable pathless import element, by the
   * Supabase provider before the write.
   */
  ATTACHMENT_REFERENCE_INVALID: "NORA_ATTACHMENT_REFERENCE_INVALID",
  /**
   * W8-C S5 (2026-09-21): a note write tried to change the attachments of a
   * note whose relational attachment state could not be vouched for by
   * `public.attachments` (drift, or a read that carried no relational rows).
   * Raised by the Supabase provider BEFORE any Storage work; the write never
   * reaches the database. Reading such a note is a passive degraded state and
   * raises nothing — only an attachment-changing write is refused.
   */
  ATTACHMENT_STATE_UNVERIFIED: "NORA_ATTACHMENT_STATE_UNVERIFIED",
} as const;

export type NoraErrorCode =
  (typeof NORA_ERROR_CODES)[keyof typeof NORA_ERROR_CODES];

/**
 * category describes the general reaction/interaction class a code belongs
 * to — not the layer it originated from. `PRIVATE_CUSTOMER_ALREADY_EXISTS`
 * is `conflict` (an otherwise-permitted operation collides with existing
 * state), even though it obviously also carries domain meaning.
 */
export type NoraErrorCategory =
  | "domain"
  | "authorization"
  | "validation"
  | "conflict"
  | "not_found";

type NoraErrorDefinition = {
  category: NoraErrorCategory;
  /** i18n key used to present this code — never the code itself, never raw text. */
  messageKey: string;
};

export const NORA_ERROR_DEFINITIONS: Record<
  NoraErrorCode,
  NoraErrorDefinition
> = {
  [NORA_ERROR_CODES.CONTACT_NOT_IN_CUSTOMER_CONTEXT]: {
    category: "domain",
    messageKey: "crm.errors.contact_not_in_customer_context",
  },
  [NORA_ERROR_CODES.INDIVIDUAL_NAME_REQUIRED]: {
    category: "domain",
    messageKey: "crm.errors.individual_name_required",
  },
  [NORA_ERROR_CODES.SELF_CONTACT_DELETE_BLOCKED]: {
    category: "domain",
    messageKey: "crm.errors.self_contact_delete_blocked",
  },
  [NORA_ERROR_CODES.PRIVATE_CUSTOMER_ALREADY_EXISTS]: {
    category: "conflict",
    messageKey: "crm.errors.private_customer_already_exists",
  },
  [NORA_ERROR_CODES.PERMISSION_DENIED]: {
    category: "authorization",
    messageKey: "crm.errors.permission_denied",
  },
  [NORA_ERROR_CODES.IDEMPOTENCY_CONFLICT]: {
    category: "conflict",
    messageKey: "crm.errors.idempotency_conflict",
  },
  [NORA_ERROR_CODES.EMPLOYEE_NOT_ASSIGNABLE]: {
    category: "domain",
    messageKey: "crm.errors.employee_not_assignable",
  },
  [NORA_ERROR_CODES.PRIMARY_CONTACT_ALREADY_EXISTS]: {
    category: "conflict",
    messageKey: "crm.errors.primary_contact_already_exists",
  },
  [NORA_ERROR_CODES.PRIMARY_CONTACT_CHANGED]: {
    category: "conflict",
    messageKey: "crm.errors.primary_contact_changed",
  },
  [NORA_ERROR_CODES.ATTACHMENT_STORAGE_KEY_PENDING_DELETION]: {
    category: "conflict",
    messageKey: "crm.errors.attachment_pending_deletion",
  },
  [NORA_ERROR_CODES.ATTACHMENT_REFERENCE_INVALID]: {
    category: "validation",
    messageKey: "crm.errors.attachment_reference_invalid",
  },
  [NORA_ERROR_CODES.ATTACHMENT_STATE_UNVERIFIED]: {
    category: "conflict",
    messageKey: "crm.errors.attachment_state_unverified",
  },
};

const CANONICAL_CODES = new Set<string>(Object.values(NORA_ERROR_CODES));

/** True only for one of the canonical codes above — never a `startsWith("NORA_")` guess. */
export const isNoraErrorCode = (value: unknown): value is NoraErrorCode =>
  typeof value === "string" && CANONICAL_CODES.has(value);

/**
 * The stable, minimal contract a caller may carry forward once a business
 * error is recognized. Deliberately excludes technicalMessage, SQLSTATE,
 * constraint names, raw Postgres details/hint, severity, retryable, HTTP
 * status, and UI text — those stay in NormalizedCrmError / dev logging /
 * errorObservatory.ts (operation_errors), never in the stable contract a
 * future notification/API/MCP consumer would read.
 */
export type NoraApplicationError = {
  code: NoraErrorCode;
  operationId?: string;
};

/**
 * Extracts a recognized NoraErrorCode from a PostgrestError-shaped `.details`
 * field, or from an explicit `.code` property on a locally-thrown typed
 * error object. Unwraps one level of `{ error: {...} }` nesting to match
 * normalizeCrmError's own message extraction. Never accepts an unrecognized
 * value — an unknown `details`/`code` string is treated as "not a Nora code".
 */
export const extractNoraErrorCode = (error: unknown): NoraErrorCode | null => {
  if (error == null || typeof error !== "object") return null;

  const direct = (error as { details?: unknown }).details;
  if (isNoraErrorCode(direct)) return direct;

  const explicitCode = (error as { code?: unknown }).code;
  if (isNoraErrorCode(explicitCode)) return explicitCode;

  const nested = (error as { error?: unknown }).error;
  if (nested && typeof nested === "object") {
    const nestedDetails = (nested as { details?: unknown }).details;
    if (isNoraErrorCode(nestedDetails)) return nestedDetails;
    const nestedCode = (nested as { code?: unknown }).code;
    if (isNoraErrorCode(nestedCode)) return nestedCode;
  }

  return null;
};

/**
 * Throws a plain Error carrying `.details = code`, mirroring the shape of a
 * real PostgrestError so the same normalizeCrmError()/extractNoraErrorCode()
 * logic classifies FakeRest and real Postgres/PostgREST errors identically.
 * Used by FakeRest to raise the same NoraErrorCode a migrated RPC/trigger
 * would raise via `USING ERRCODE = ..., DETAIL = '<code>'`.
 */
export const throwNoraError = (message: string, code: NoraErrorCode): never => {
  const error = new Error(message) as Error & { details: NoraErrorCode };
  error.details = code;
  throw error;
};
