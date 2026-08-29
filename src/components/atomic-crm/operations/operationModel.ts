/**
 * Nora Application Backbone – Operation runtime model (Foundation Wave 2).
 *
 * In-memory only. Never persist payloads, PII, or form contents here.
 */

import type { NoraErrorCode } from "../domain/noraErrorCodes";
import type { OperationResourceType, OperationType } from "./operationContext";

export type OperationStatus = "pending" | "success" | "error";

/**
 * Operation Status Contract v1 (2026-08-29). Execution disposition is
 * deliberately NOT a lifecycle status — it only ever appears alongside
 * status="success", and only when the server-side RPC actually reported it
 * (idempotent write with a supplied idempotency_key). A legacy call without
 * an idempotency_key leaves this undefined — never assume "executed" just
 * because no protection was requested (see docs/nora/06-decision-log.md
 * "Operation Status Contract Wave").
 */
export type OperationExecutionDisposition = "executed" | "replayed";

/**
 * Minimal, stable result reference a caller may want to correlate later
 * (e.g. companyId/contactId/dealId). Never a full domain object, never PII
 * beyond what the caller already had (these are just the IDs the RPC
 * returned) — Operation Status must not become a second database.
 */
export type OperationResultReference = Record<string, string | number | null>;

export type OperationRecord = {
  operationId: string;
  operationType: OperationType;
  resourceType: OperationResourceType;
  resourceId?: string | number | null;
  startedAt: string;
  finishedAt?: string;
  status: OperationStatus;
  /**
   * Legacy CrmErrorKind-derived code (`normalizeCrmError().kind`) — kept for
   * backward compatibility with existing consumers of this field. Prefer
   * `errorCode` (NoraErrorCode) below for anything new; see decision log.
   */
  safeErrorCode?: string;
  /**
   * Stable Nora business error code (`normalizeCrmError().code`), or
   * `"unknown"` when no canonical code was recognized. Only set when
   * status="error". This is the precise identity `safeErrorCode` above
   * cannot always provide (it carries the broader/legacy CrmErrorKind).
   */
  errorCode?: NoraErrorCode | "unknown";
  /**
   * Only meaningful when status="success". Present only when the handler
   * explicitly reported it via context.reportOutcome() — never inferred.
   */
  execution?: OperationExecutionDisposition;
  /** Only meaningful when status="success" and explicitly reported. */
  result?: OperationResultReference;
  /**
   * Runtime-only ephemeral error reference for this browser session.
   * NOT a server lookup key. Distinct from persistentErrorId / publicErrorRef.
   */
  runtimeErrorId?: string;
  /** Server UUID from operation_errors.id after successful Observatory record. */
  persistentErrorId?: string;
  /** Human IT reference (NORA-E…) from operation_errors.public_ref. */
  publicErrorRef?: string;
  /** Reserved for real multi-step flows later. */
  step?: string;
};

/** Retention / capacity policy (testable constants). */
export const OPERATION_RETENTION = {
  /** Success ops stay briefly for future Feedback UI inspection. */
  successTtlMs: 8_000,
  /** Errors stay longer for Feedback / IT-report UI. */
  errorTtlMs: 60_000,
  /** Hard cap on stored finished+pending records. */
  maxOperations: 50,
} as const;
