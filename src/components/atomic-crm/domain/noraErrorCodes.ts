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
