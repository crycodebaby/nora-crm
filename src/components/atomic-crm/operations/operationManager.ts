/**
 * Nora Application Backbone – Operation Manager (Foundation Wave 2).
 *
 * Pure runtime module — fully usable without React / OperationProvider.
 * Owns operation_id at the business entry, tracks pending/success/error
 * in memory, and never swallows handler exceptions.
 */

import { normalizeCrmError } from "../misc/normalizeCrmError";
import type { OperationCatalogEntry } from "./operationCatalog";
import {
  createOperationContext,
  createOperationId,
  type OperationContext,
  type OperationResourceType,
  type OperationType,
} from "./operationContext";
import {
  getDefaultOperationErrorRecorder,
  recordOperationErrorBestEffort,
  type OperationErrorRecorder,
} from "./errorObservatory";
import {
  OPERATION_RETENTION,
  type OperationExecutionDisposition,
  type OperationRecord,
  type OperationResultReference,
  type OperationStatus,
} from "./operationModel";

export type ExecuteInput = {
  resourceId?: string | number | null;
  /** Reuse a valid UUID; invalid/missing → mint. */
  operationId?: string;
  step?: string;
};

export type OperationOutcomeMeta = {
  execution?: OperationExecutionDisposition;
  result?: OperationResultReference;
};

/**
 * Context handed to a handler, extended with an opt-in reporter for the
 * Operation Status Contract v1 (execution disposition / result reference).
 * Calling `reportOutcome` is optional — existing handlers that never call it
 * behave exactly as before (execution/result stay undefined on the record).
 * Only the LAST call before the handler settles wins (no merge semantics).
 */
export type ExecutionOperationContext = OperationContext & {
  reportOutcome: (meta: OperationOutcomeMeta) => void;
};

export type OperationHandler<T> = (
  context: ExecutionOperationContext,
) => Promise<T> | T;

export type OperationManager = {
  execute: <T>(
    definition: OperationCatalogEntry,
    input: ExecuteInput,
    handler: OperationHandler<T>,
  ) => Promise<T>;
  getOperation: (operationId: string) => OperationRecord | undefined;
  getOperations: () => readonly OperationRecord[];
  getSnapshot: () => readonly OperationRecord[];
  subscribe: (listener: () => void) => () => void;
  /** Test helper: clear timers and state. */
  resetForTests: () => void;
};

type InternalTimers = Map<string, ReturnType<typeof setTimeout>>;

const nowIso = () => new Date().toISOString();

const EMPTY_SNAPSHOT: readonly OperationRecord[] = Object.freeze([]);

export const createOperationManager = (options?: {
  successTtlMs?: number;
  errorTtlMs?: number;
  maxOperations?: number;
  /**
   * Optional Error Observatory recorder. When omitted, uses the process-wide
   * default (Supabase-wired in production; null in FakeRest/tests unless set).
   * Pass `null` explicitly to disable recording for a manager instance.
   */
  recordError?: OperationErrorRecorder | null;
}): OperationManager => {
  const retention = {
    successTtlMs: options?.successTtlMs ?? OPERATION_RETENTION.successTtlMs,
    errorTtlMs: options?.errorTtlMs ?? OPERATION_RETENTION.errorTtlMs,
    maxOperations: options?.maxOperations ?? OPERATION_RETENTION.maxOperations,
  };
  const resolveRecorder = (): OperationErrorRecorder | null => {
    if (options && "recordError" in options) {
      return options.recordError ?? null;
    }
    return getDefaultOperationErrorRecorder();
  };
  const operations = new Map<string, OperationRecord>();
  const listeners = new Set<() => void>();
  const timers: InternalTimers = new Map();
  let snapshot: readonly OperationRecord[] = EMPTY_SNAPSHOT;

  const rebuildSnapshot = () => {
    if (operations.size === 0) {
      snapshot = EMPTY_SNAPSHOT;
      return;
    }
    snapshot = Object.freeze(
      Array.from(operations.values()).sort((a, b) =>
        a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0,
      ),
    );
  };

  const emit = () => {
    rebuildSnapshot();
    for (const listener of listeners) {
      listener();
    }
  };

  const clearTimer = (operationId: string) => {
    const timer = timers.get(operationId);
    if (timer != null) {
      clearTimeout(timer);
      timers.delete(operationId);
    }
  };

  const removeOperation = (operationId: string) => {
    clearTimer(operationId);
    if (operations.delete(operationId)) {
      emit();
    }
  };

  const enforceCapacity = () => {
    if (operations.size <= retention.maxOperations) {
      return;
    }
    // Evict oldest finished first; never auto-drop pending.
    const finished = Array.from(operations.values())
      .filter((op) => op.status !== "pending")
      .sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
    for (const op of finished) {
      if (operations.size <= retention.maxOperations) break;
      removeOperation(op.operationId);
    }
  };

  const scheduleCleanup = (operationId: string, status: OperationStatus) => {
    clearTimer(operationId);
    if (status === "pending") {
      return;
    }
    const ttl =
      status === "success" ? retention.successTtlMs : retention.errorTtlMs;
    const timer = setTimeout(() => {
      timers.delete(operationId);
      const current = operations.get(operationId);
      // No-op if already removed or status changed — never throws.
      if (current && current.status === status) {
        operations.delete(operationId);
        emit();
      }
    }, ttl);
    timers.set(operationId, timer);
  };

  const setRecord = (record: OperationRecord) => {
    operations.set(record.operationId, record);
    enforceCapacity();
    emit();
  };

  /**
   * Mark error state immediately, then best-effort Observatory persist.
   * Recorder enrichment is intentionally non-blocking so a hung RPC cannot
   * delay propagation of the original business exception to React Admin.
   */
  const markErrorSafely = (pending: OperationRecord, error: unknown): void => {
    let runtimeErrorId = createOperationId();
    let safeErrorCode = "unknown";
    try {
      const normalized = normalizeCrmError(error);
      safeErrorCode = normalized.kind;
      setRecord({
        ...pending,
        status: "error",
        finishedAt: nowIso(),
        safeErrorCode,
        errorCode: normalized.code ?? "unknown",
        runtimeErrorId,
      });
      scheduleCleanup(pending.operationId, "error");
    } catch {
      try {
        runtimeErrorId = createOperationId();
        setRecord({
          ...pending,
          status: "error",
          finishedAt: nowIso(),
          safeErrorCode: "unknown",
          errorCode: "unknown",
          runtimeErrorId,
        });
        scheduleCleanup(pending.operationId, "error");
      } catch {
        // Bookkeeping must never replace the business throw below.
        return;
      }
    }

    const operationId = pending.operationId;
    void (async () => {
      try {
        const persisted = await recordOperationErrorBestEffort(
          {
            operationId,
            operationType: pending.operationType,
            resourceType: pending.resourceType,
            resourceId: pending.resourceId,
            safeErrorCode,
            error,
            source: "frontend",
          },
          resolveRecorder(),
        );
        if (!persisted) {
          return;
        }
        const current = operations.get(operationId);
        // Safe if cleaned up or status changed — never resurrect a finished op.
        if (!current || current.status !== "error") {
          return;
        }
        setRecord({
          ...current,
          persistentErrorId: persisted.errorId,
          publicErrorRef: persisted.publicRef,
        });
      } catch {
        // Observatory outage must never replace or swallow the business error.
      }
    })();
  };

  const execute = async <T>(
    definition: OperationCatalogEntry,
    input: ExecuteInput,
    handler: OperationHandler<T>,
  ): Promise<T> => {
    const context = createOperationContext({
      operationType: definition.operationType,
      resourceType: definition.resourceType,
      resourceId: input.resourceId,
      operationId: input.operationId,
    });

    const pending: OperationRecord = {
      operationId: context.operationId,
      operationType: definition.operationType,
      resourceType: definition.resourceType,
      resourceId: input.resourceId ?? null,
      startedAt: context.startedAt,
      status: "pending",
      ...(input.step ? { step: input.step } : {}),
    };
    setRecord(pending);

    let outcomeMeta: OperationOutcomeMeta = {};
    const executionContext: ExecutionOperationContext = {
      ...context,
      reportOutcome: (meta) => {
        outcomeMeta = meta;
      },
    };

    try {
      const result = await handler(executionContext);
      setRecord({
        ...pending,
        status: "success",
        finishedAt: nowIso(),
        ...(outcomeMeta.execution ? { execution: outcomeMeta.execution } : {}),
        ...(outcomeMeta.result ? { result: outcomeMeta.result } : {}),
      });
      scheduleCleanup(context.operationId, "success");
      return result;
    } catch (error) {
      markErrorSafely(pending, error);
      throw error;
    }
  };

  rebuildSnapshot();

  return {
    execute,
    getOperation: (operationId) => operations.get(operationId),
    getOperations: () => snapshot,
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    resetForTests: () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
      operations.clear();
      rebuildSnapshot();
      emit();
    },
  };
};

/**
 * Process-wide default manager. Fully functional without React.
 * OperationProvider must bind to this same instance (or an explicit
 * test inject that replaces it) — never a second competing store.
 */
let defaultManager: OperationManager | null = null;

export const getDefaultOperationManager = (): OperationManager => {
  if (!defaultManager) {
    defaultManager = createOperationManager();
  }
  return defaultManager;
};

export const setDefaultOperationManager = (
  manager: OperationManager | null,
): void => {
  defaultManager = manager;
};

/** Test helper: drop singleton so the next getDefault creates a fresh one. */
export const resetDefaultOperationManagerForTests = (): void => {
  if (defaultManager) {
    defaultManager.resetForTests();
  }
  defaultManager = null;
};

export type { OperationType, OperationResourceType, OperationContext };
