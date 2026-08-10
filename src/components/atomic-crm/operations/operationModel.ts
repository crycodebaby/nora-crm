/**
 * Nora Application Backbone – Operation runtime model (Foundation Wave 2).
 *
 * In-memory only. Never persist payloads, PII, or form contents here.
 */

import type { OperationResourceType, OperationType } from "./operationContext";

export type OperationStatus = "pending" | "success" | "error";

export type OperationRecord = {
  operationId: string;
  operationType: OperationType;
  resourceType: OperationResourceType;
  resourceId?: string | number | null;
  startedAt: string;
  finishedAt?: string;
  status: OperationStatus;
  /** Normalized CRM error kind — never a raw DB message. */
  safeErrorCode?: string;
  /**
   * Runtime-only ephemeral error reference for this browser session.
   * NOT persisted server-side until Error Observatory exists.
   * Never treat as an IT ticket / DB lookup key.
   */
  runtimeErrorId?: string;
  /** Reserved for real multi-step flows later. */
  step?: string;
};

/** Retention / capacity policy (testable constants). */
export const OPERATION_RETENTION = {
  /** Success ops stay briefly for future Feedback UI inspection. */
  successTtlMs: 8_000,
  /** Errors stay longer for debugging before Error Observatory. */
  errorTtlMs: 60_000,
  /** Hard cap on stored finished+pending records. */
  maxOperations: 50,
} as const;
