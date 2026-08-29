/**
 * Error presentation mapping (Phase 7B.1).
 *
 * NOT a new error contract. `normalizeCrmError()` already produces a canonical
 * `NoraErrorCode`, and `NORA_ERROR_DEFINITIONS` already maps that code to an
 * i18n key. This module only picks the key a notification card shows — it adds
 * no classification, no new codes and no raw text.
 *
 * A NORA_* code is NEVER rendered. Neither is a SQLSTATE, a PostgREST message,
 * an operationId or a runtimeErrorId.
 */

import {
  NORA_ERROR_DEFINITIONS,
  isNoraErrorCode,
} from "../domain/noraErrorCodes";

/**
 * The only new error string this wave introduces. Deliberately not
 * `crm.errors.load_failed` ("data could not be loaded") — that is the wrong
 * statement about a failed WRITE.
 */
export const NOTIFICATION_GENERIC_ERROR_KEY =
  "crm.notifications.errors.generic";

/**
 * Transport buckets (`normalizeCrmError().kind`, mirrored onto
 * `OperationRecord.safeErrorCode`) that have an existing, accurate and
 * actionable German text. Everything else falls back to the generic message
 * rather than guessing.
 */
const DETAIL_KEY_BY_SAFE_ERROR_CODE: Record<string, string> = {
  network: "crm.errors.network_unreachable",
  service_unavailable: "crm.errors.service_unavailable",
};

/**
 * Resolves the human-readable detail line for a failed operation.
 *
 * Precedence: canonical NoraErrorCode → known transport bucket → generic.
 * `"unknown"` and unrecognized values always land on the generic fallback.
 */
export const resolveNotificationErrorDetailKey = (input?: {
  errorCode?: string | null;
  safeErrorCode?: string | null;
}): string => {
  const errorCode = input?.errorCode;
  if (isNoraErrorCode(errorCode)) {
    return NORA_ERROR_DEFINITIONS[errorCode].messageKey;
  }

  const safeErrorCode = input?.safeErrorCode;
  if (typeof safeErrorCode === "string") {
    const mapped = DETAIL_KEY_BY_SAFE_ERROR_CODE[safeErrorCode];
    if (mapped) return mapped;
  }

  return NOTIFICATION_GENERIC_ERROR_KEY;
};
