import {
  NORA_ERROR_CODES,
  NORA_ERROR_DEFINITIONS,
  extractNoraErrorCode,
  type NoraErrorCode,
} from "../domain/noraErrorCodes";

/**
 * Transport/infrastructure buckets (network/service/auth/notfound/aborted/
 * unknown) are permanent — they have no server-side business meaning to
 * encode. `contact_not_in_customer_context` and `self_contact_delete_blocked`
 * are migration-compatibility-only: they exist because they predate
 * NoraErrorCode. No new business member should be added here again — a new
 * business rejection gets a NoraErrorCode (./domain/noraErrorCodes.ts)
 * instead, resolved directly to a messageKey without a CrmErrorKind detour.
 */
export type CrmErrorKind =
  | "permission_denied"
  | "delete_not_allowed"
  | "disabled_user"
  | "network"
  | "service_unavailable"
  | "not_found"
  | "aborted"
  | "contact_not_in_customer_context"
  | "self_contact_delete_blocked"
  | "unknown";

export type NormalizedCrmError = {
  kind: CrmErrorKind;
  messageKey: string;
  status?: number;
  /** Recognized stable Nora business code, if any (Error Contract Wave). */
  code?: NoraErrorCode;
  /** Original message — logged in development only. */
  technicalMessage?: string;
};

/** Legacy CrmErrorKind for a recognized NoraErrorCode — vestigial once `code` is present; only used by the handful of consumers that still branch on `kind` instead of `code`. */
const KIND_BY_NORA_ERROR_CODE: Partial<Record<NoraErrorCode, CrmErrorKind>> = {
  [NORA_ERROR_CODES.CONTACT_NOT_IN_CUSTOMER_CONTEXT]:
    "contact_not_in_customer_context",
  [NORA_ERROR_CODES.SELF_CONTACT_DELETE_BLOCKED]: "self_contact_delete_blocked",
  [NORA_ERROR_CODES.PERMISSION_DENIED]: "permission_denied",
};

const RLS_PATTERNS = [
  /row-level security/i,
  /permission denied/i,
  /violates row-level security/i,
  /new row violates/i,
  /insufficient_privilege/i,
  /PGRST301/i,
  /42501/,
];

const DELETE_PATTERNS = [
  /cannot delete/i,
  /cannot be deleted/i,
  /delete is not allowed/i,
  /not deletable/i,
];

// Self Contact Wave (2026-08-26) business rejections — raised as free-text
// Postgres exceptions by nora_private.is_effective_contact_of_company() /
// create_quick_capture_case() and nora_private.guard_self_contact_delete().
// Mapped here to stable codes so callers never build an i18n key from raw
// exception text (Pre-Production Hardening Patch, Error Contract).
const CONTACT_NOT_IN_CUSTOMER_CONTEXT_PATTERNS = [
  /effective contact context/i,
  /not part of the effective/i,
  // FakeRest raises the equivalent business rejection as German free text
  // (providers/fakerest/dataProvider.ts) — same rule, different wording,
  // must map to the same stable code (Falle 33, 03-data-model-guardrails.md).
  /effektivem Kontaktkreis/i,
];

const SELF_CONTACT_DELETE_BLOCKED_PATTERNS = [
  /Privatkundenakte.*(nicht|not).*(gel|delet)/i,
];

// Legacy fallback only (Error Contract Wave) — every RPC/trigger that can
// raise these now sets DETAIL to the canonical NoraErrorCode; these patterns
// exist only for a not-yet-migrated call site or an older frontend build.
// The constraint-name anchor is deliberately narrow: other unique violations
// (e.g. uq_contacts_one_primary_per_company) must never match here.
const INDIVIDUAL_NAME_REQUIRED_PATTERNS = [/Vor- oder Nachnamen/i];

const PRIVATE_CUSTOMER_ALREADY_EXISTS_PATTERNS = [
  /uq_companies_self_contact_individual/i,
];

const DISABLED_PATTERNS = [/disabled/i, /deactivated/i, /inactive user/i];

const NETWORK_PATTERNS = [
  /failed to fetch/i,
  /network error/i,
  /networkrequestfailed/i,
  /load failed/i,
  /err_connection/i,
  /econnrefused/i,
];

const SERVICE_PATTERNS = [/502/i, /503/i, /504/i, /service unavailable/i];

const NOT_FOUND_PATTERNS = [/PGRST116/i, /not found/i, /0 rows/i];

const ABORT_PATTERNS = [/abort/i, /cancelled/i, /canceled/i];

const extractMessage = (error: unknown): string => {
  if (error == null) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  if (typeof error === "object" && "error" in error) {
    const nested = (error as { error?: unknown }).error;
    if (typeof nested === "string") return nested;
    if (
      nested &&
      typeof nested === "object" &&
      "message" in nested &&
      typeof (nested as { message?: unknown }).message === "string"
    ) {
      return (nested as { message: string }).message;
    }
  }
  return String(error);
};

const extractStatus = (error: unknown): number | undefined => {
  if (error && typeof error === "object") {
    const status =
      (error as { status?: unknown }).status ??
      (error as { statusCode?: unknown }).statusCode;
    if (typeof status === "number") return status;
  }
  return undefined;
};

const matchesAny = (message: string, patterns: RegExp[]) =>
  patterns.some((pattern) => pattern.test(message));

/** Maps Supabase/PostgREST and browser errors to user-facing i18n keys. */
export const normalizeCrmError = (error: unknown): NormalizedCrmError => {
  const message = extractMessage(error);
  const status = extractStatus(error);
  const technicalMessage = message || undefined;

  // Machine-code-first (Error Contract Wave): a recognized NoraErrorCode —
  // from PostgrestError.details, a FakeRest-thrown `.details`, or an
  // explicit `.code` on a local typed business error — is authoritative
  // regardless of MESSAGE wording. Only a canonical code is ever accepted;
  // an unrecognized details/code string falls through to legacy detection.
  const noraCode = extractNoraErrorCode(error);
  if (noraCode) {
    const definition = NORA_ERROR_DEFINITIONS[noraCode];
    return {
      kind: KIND_BY_NORA_ERROR_CODE[noraCode] ?? "unknown",
      messageKey: definition.messageKey,
      status,
      code: noraCode,
      technicalMessage,
    };
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return {
      kind: "aborted",
      messageKey: "crm.errors.request_aborted",
      status,
      technicalMessage,
    };
  }

  if (matchesAny(message, ABORT_PATTERNS)) {
    return {
      kind: "aborted",
      messageKey: "crm.errors.request_aborted",
      status,
      technicalMessage,
    };
  }

  if (status === 401) {
    return {
      kind: "permission_denied",
      messageKey: "crm.errors.not_authenticated",
      status,
      technicalMessage,
    };
  }

  if (matchesAny(message, DISABLED_PATTERNS)) {
    return {
      kind: "disabled_user",
      messageKey: "crm.errors.access_disabled",
      status,
      technicalMessage,
    };
  }

  if (status === 403 || matchesAny(message, RLS_PATTERNS)) {
    return {
      kind: "permission_denied",
      messageKey: "crm.errors.permission_denied",
      status,
      code: NORA_ERROR_CODES.PERMISSION_DENIED,
      technicalMessage,
    };
  }

  if (matchesAny(message, CONTACT_NOT_IN_CUSTOMER_CONTEXT_PATTERNS)) {
    return {
      kind: "contact_not_in_customer_context",
      messageKey: "crm.errors.contact_not_in_customer_context",
      status,
      code: NORA_ERROR_CODES.CONTACT_NOT_IN_CUSTOMER_CONTEXT,
      technicalMessage,
    };
  }

  if (matchesAny(message, SELF_CONTACT_DELETE_BLOCKED_PATTERNS)) {
    return {
      kind: "self_contact_delete_blocked",
      messageKey: "crm.errors.self_contact_delete_blocked",
      status,
      code: NORA_ERROR_CODES.SELF_CONTACT_DELETE_BLOCKED,
      technicalMessage,
    };
  }

  if (matchesAny(message, INDIVIDUAL_NAME_REQUIRED_PATTERNS)) {
    return {
      kind: "unknown",
      messageKey: "crm.errors.individual_name_required",
      status,
      code: NORA_ERROR_CODES.INDIVIDUAL_NAME_REQUIRED,
      technicalMessage,
    };
  }

  if (matchesAny(message, PRIVATE_CUSTOMER_ALREADY_EXISTS_PATTERNS)) {
    return {
      kind: "unknown",
      messageKey: "crm.errors.private_customer_already_exists",
      status,
      code: NORA_ERROR_CODES.PRIVATE_CUSTOMER_ALREADY_EXISTS,
      technicalMessage,
    };
  }

  if (matchesAny(message, DELETE_PATTERNS)) {
    return {
      kind: "delete_not_allowed",
      messageKey: "crm.errors.delete_not_allowed",
      status,
      technicalMessage,
    };
  }

  if (matchesAny(message, NOT_FOUND_PATTERNS) || status === 404) {
    return {
      kind: "not_found",
      messageKey: "crm.errors.record_not_found",
      status,
      technicalMessage,
    };
  }

  if (
    matchesAny(message, NETWORK_PATTERNS) ||
    (typeof navigator !== "undefined" && navigator.onLine === false)
  ) {
    return {
      kind: "network",
      messageKey: "crm.errors.network_unreachable",
      status,
      technicalMessage,
    };
  }

  if (
    matchesAny(message, SERVICE_PATTERNS) ||
    status === 502 ||
    status === 503
  ) {
    return {
      kind: "service_unavailable",
      messageKey: "crm.errors.service_unavailable",
      status,
      technicalMessage,
    };
  }

  return {
    kind: "unknown",
    messageKey: "crm.errors.load_failed",
    status,
    technicalMessage,
  };
};

export const logCrmErrorInDev = (
  error: unknown,
  normalized: NormalizedCrmError,
) => {
  if (import.meta.env.DEV && normalized.technicalMessage) {
    console.error(
      "[Nora CRM]",
      normalized.kind,
      normalized.technicalMessage,
      error,
    );
  }
};

/** Re-throw with an i18n message key as Error.message for ra-core notifications. */
export const toCrmError = (error: unknown): Error => {
  const normalized = normalizeCrmError(error);
  logCrmErrorInDev(error, normalized);
  const err = new Error(normalized.messageKey);
  (err as Error & { crmError: NormalizedCrmError }).crmError = normalized;
  return err;
};
