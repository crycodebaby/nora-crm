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
  OPERATION_RETENTION,
  type OperationRecord,
  type OperationStatus,
} from "./operationModel";

export type ExecuteInput = {
  resourceId?: string | number | null;
  /** Reuse a valid UUID; invalid/missing → mint. */
  operationId?: string;
  step?: string;
};

export type OperationHandler<T> = (context: OperationContext) => Promise<T> | T;

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
}): OperationManager => {
  const retention = { ...OPERATION_RETENTION, ...options };
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
   * Mark error state without letting bookkeeping failures mask the
   * original business exception that will be rethrown.
   */
  const markErrorSafely = (pending: OperationRecord, error: unknown) => {
    try {
      const normalized = normalizeCrmError(error);
      setRecord({
        ...pending,
        status: "error",
        finishedAt: nowIso(),
        safeErrorCode: normalized.kind,
        runtimeErrorId: createOperationId(),
      });
      scheduleCleanup(pending.operationId, "error");
    } catch {
      try {
        setRecord({
          ...pending,
          status: "error",
          finishedAt: nowIso(),
          safeErrorCode: "unknown",
          runtimeErrorId: createOperationId(),
        });
        scheduleCleanup(pending.operationId, "error");
      } catch {
        // Bookkeeping must never replace the business throw below.
      }
    }
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

    try {
      const result = await handler(context);
      setRecord({
        ...pending,
        status: "success",
        finishedAt: nowIso(),
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
