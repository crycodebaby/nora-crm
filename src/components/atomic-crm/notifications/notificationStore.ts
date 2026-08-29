/**
 * Notification store (Phase 7B.1).
 *
 * Derives human-facing notification cards from the Operation Manager's
 * technical truth. It owns NO lifecycle of its own: every state transition is
 * a reduction over `OperationRecord`s, plus timing.
 *
 * Invariants (Guardrails, Phase 7A/7B.1 — each covered by a test):
 * 1. Subscription and timers are fully releasable: `destroy()` leaks nothing.
 * 2. Timing is injectable and clock-driven — no real-time dependency in tests.
 * 3. Once settled, lifecycle/message/displayContext are FROZEN. A late
 *    publicErrorRef is additive metadata only and never restarts dismissal.
 * 4. Two separate limits: `maxVisible` is a HARD on-screen cap, while
 *    `retentionSoftCap` is best-effort retention that only evicts SETTLED
 *    entries — pending entries are never evicted and may exceed it. A
 *    long-running pending is never reinterpreted as an error.
 */

import { createOperationId } from "../operations/operationContext";
import type { OperationManager } from "../operations/operationManager";
import type { OperationRecord } from "../operations/operationModel";
import {
  HUMAN_INITIATOR,
  NO_RETRY,
  sanitizeDisplayContext,
  type NotificationDisplayContext,
  type NotificationInitiator,
  type NotificationIntentType,
  type NotificationRecord,
  type NotificationRetryPolicy,
  type NotificationSnapshot,
} from "./notificationModel";
import { buildNotificationMessage } from "./notificationMessages";
import {
  singleOperationResolver,
  type NotificationResolution,
  type NotificationStateResolver,
} from "./notificationPolicy";
import {
  dismissDurationMs,
  NOTIFICATION_CAPACITY,
  NOTIFICATION_TIMING,
  type NotificationCapacity,
  type NotificationTiming,
} from "./notificationTiming";

export type NotificationIntentRegistration = {
  intentType: NotificationIntentType;
  /** i18n namespace root, from the policy. */
  messageNamespace: string;
  /** Pre-minted operation ids, in resolver order. Never empty. */
  operationIds: readonly string[];
  /** Defaults to operationIds[0]. */
  primaryOperationId?: string;
  displayContext?: NotificationDisplayContext;
  /** Defaults to HUMAN_INITIATOR — never omitted on the record. */
  initiator?: NotificationInitiator;
  /** Defaults to NO_RETRY. */
  retry?: NotificationRetryPolicy;
  /** Defaults to the single-operation mirror. */
  resolve?: NotificationStateResolver;
};

export type NotificationStore = {
  registerIntent: (registration: NotificationIntentRegistration) => string;
  getSnapshot: () => NotificationSnapshot;
  subscribe: (listener: () => void) => () => void;
  dismiss: (notificationId: string) => void;
  pauseDismiss: (notificationId: string) => void;
  resumeDismiss: (notificationId: string) => void;
  /** Releases the manager subscription and every timer. Idempotent. */
  destroy: () => void;
  /** Test helper: drop entries and timers, keep the subscription. */
  resetForTests: () => void;
};

type TimerHandle = ReturnType<typeof setTimeout>;

type EntryTimers = {
  reveal?: TimerHandle;
  minVisible?: TimerHandle;
  dismiss?: TimerHandle;
};

type Entry = {
  record: NotificationRecord;
  namespace: string;
  resolve: NotificationStateResolver;
  settled: boolean;
  /** Set only for a settled failure; used to pick up a late publicErrorRef. */
  failedOperationId?: string;
  /** Remaining auto-dismiss time while paused — never re-expanded on resume. */
  dismissRemainingMs?: number;
  timers: EntryTimers;
};

const EMPTY_SNAPSHOT: NotificationSnapshot = Object.freeze([]);

export const createNotificationStore = (options: {
  manager: OperationManager;
  timing?: NotificationTiming;
  capacity?: NotificationCapacity;
  /** Injectable clock — must agree with the timer source used in tests. */
  now?: () => number;
  /** Injectable id factory. A notificationId is never an operationId. */
  createId?: () => string;
}): NotificationStore => {
  const manager = options.manager;
  const timing = options.timing ?? NOTIFICATION_TIMING;
  const capacity = options.capacity ?? NOTIFICATION_CAPACITY;
  const now = options.now ?? (() => Date.now());
  const createId = options.createId ?? createOperationId;

  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  let snapshot: NotificationSnapshot = EMPTY_SNAPSHOT;
  let destroyed = false;

  const rebuildSnapshot = () => {
    if (entries.size === 0) {
      snapshot = EMPTY_SNAPSHOT;
      return;
    }
    snapshot = Object.freeze(
      Array.from(entries.values())
        .map((entry) => entry.record)
        .sort((a, b) =>
          a.createdAt === b.createdAt
            ? a.notificationId < b.notificationId
              ? -1
              : 1
            : a.createdAt - b.createdAt,
        ),
    );
  };

  const emit = () => {
    rebuildSnapshot();
    for (const listener of listeners) {
      listener();
    }
  };

  const clearTimer = (entry: Entry, key: keyof EntryTimers) => {
    const handle = entry.timers[key];
    if (handle != null) {
      clearTimeout(handle);
      entry.timers[key] = undefined;
    }
  };

  const clearAllTimers = (entry: Entry) => {
    clearTimer(entry, "reveal");
    clearTimer(entry, "minVisible");
    clearTimer(entry, "dismiss");
  };

  const patch = (entry: Entry, changes: Partial<NotificationRecord>) => {
    entry.record = { ...entry.record, ...changes };
  };

  const readOperations = (
    entry: Entry,
  ): readonly (OperationRecord | undefined)[] =>
    entry.record.operationIds.map((id) => manager.getOperation(id));

  /**
   * Late Observatory metadata. Additive ONLY: it must never touch state,
   * message, settledAt or dismissAt (Guardrail, Phase 7B.1).
   */
  const refreshEscalation = (entry: Entry): boolean => {
    if (!entry.failedOperationId) return false;
    const failed = manager.getOperation(entry.failedOperationId);
    const publicErrorRef = failed?.publicErrorRef;
    if (!publicErrorRef || entry.record.publicErrorRef === publicErrorRef) {
      return false;
    }
    patch(entry, { publicErrorRef, canEscalateToIT: true });
    return true;
  };

  const scheduleDismiss = (entry: Entry, durationMs: number) => {
    clearTimer(entry, "dismiss");
    const notificationId = entry.record.notificationId;
    entry.timers.dismiss = setTimeout(() => {
      const current = entries.get(notificationId);
      if (!current) return;
      current.timers.dismiss = undefined;
      // Defensive: never drop a card that got paused or un-settled meanwhile.
      if (current.record.dismissPaused || !current.settled) return;
      clearAllTimers(current);
      entries.delete(notificationId);
      emit();
    }, durationMs);
  };

  const applySettle = (entry: Entry, resolution: NotificationResolution) => {
    const at = now();
    clearTimer(entry, "reveal");
    clearTimer(entry, "minVisible");

    entry.settled = true;
    entry.failedOperationId = resolution.failedOperationId;

    const duration = dismissDurationMs(resolution.state.lifecycle, timing);
    patch(entry, {
      state: resolution.state,
      message: buildNotificationMessage({
        namespace: entry.namespace,
        lifecycle: resolution.state.lifecycle,
        displayContext: entry.record.displayContext,
      }),
      visibleSince: entry.record.visibleSince ?? at,
      settledAt: at,
      dismissAt: duration == null ? null : at + duration,
      dismissPaused: false,
    });
    entry.dismissRemainingMs = undefined;

    if (duration != null) {
      scheduleDismiss(entry, duration);
    }
    refreshEscalation(entry);
  };

  /**
   * Re-derives one entry from the manager. A settled entry is frozen: only
   * escalation metadata may still change.
   */
  const evaluate = (entry: Entry): boolean => {
    if (entry.settled) {
      return refreshEscalation(entry);
    }

    const resolution = entry.resolve({
      operations: readOperations(entry),
      namespace: entry.namespace,
    });

    // A long-running pending stays pending. Nothing here can turn it into an
    // error (Guardrail, Phase 7A).
    if (resolution.state.lifecycle === "pending") {
      return false;
    }

    const visibleSince = entry.record.visibleSince;
    if (visibleSince == null) {
      // Never rendered as pending → show the outcome straight away.
      applySettle(entry, resolution);
      return true;
    }

    const shownFor = now() - visibleSince;
    if (shownFor >= timing.pendingMinVisibleMs) {
      applySettle(entry, resolution);
      return true;
    }

    // Pending is on screen but too briefly — hold the flip, do not flicker.
    if (entry.timers.minVisible != null) {
      return false;
    }
    const notificationId = entry.record.notificationId;
    entry.timers.minVisible = setTimeout(() => {
      const current = entries.get(notificationId);
      if (!current) return;
      current.timers.minVisible = undefined;
      if (current.settled) return;
      const latest = current.resolve({
        operations: readOperations(current),
        namespace: current.namespace,
      });
      if (latest.state.lifecycle === "pending") return;
      applySettle(current, latest);
      emit();
    }, timing.pendingMinVisibleMs - shownFor);
    return false;
  };

  const evaluateAll = () => {
    let changed = false;
    for (const entry of entries.values()) {
      if (evaluate(entry)) changed = true;
    }
    if (changed) emit();
  };

  /**
   * Best-effort retention, evaluated at registration time.
   *
   * Evicts SETTLED entries only, cheapest first: a settled success is the
   * least costly thing to lose, an error the most. Pending is never evicted —
   * dropping an in-flight card would strand the user mid-action.
   *
   * Consequence, stated plainly: `retentionSoftCap` is NOT a hard bound. With
   * more concurrent pending intents than the cap, the live count exceeds it
   * and stays there until those operations settle. That is intended; the
   * practical ceiling is the number of in-flight user intents, and the hard
   * on-screen limit is `maxVisible`, enforced separately.
   *
   * Two distinct mechanisms that must not be confused:
   * - TIME: an error never auto-dismisses (`dismissDurationMs` → null).
   * - CAPACITY: under sustained pressure an old, off-screen error may still be
   *   evicted as the last resort, after every success and partial is gone.
   */
  const enforceRetentionSoftCap = () => {
    if (entries.size <= capacity.retentionSoftCap) return;
    const evictionOrder = ["success", "partial", "error"] as const;
    for (const lifecycle of evictionOrder) {
      while (entries.size > capacity.retentionSoftCap) {
        const candidate = Array.from(entries.values())
          .filter(
            (entry) =>
              entry.settled && entry.record.state.lifecycle === lifecycle,
          )
          .sort((a, b) => a.record.createdAt - b.record.createdAt)[0];
        if (!candidate) break;
        clearAllTimers(candidate);
        entries.delete(candidate.record.notificationId);
      }
      if (entries.size <= capacity.retentionSoftCap) return;
    }
    // Nothing settled left to evict: the cap is deliberately exceeded rather
    // than dropping a pending card.
  };

  const unsubscribeManager = manager.subscribe(() => {
    if (destroyed) return;
    evaluateAll();
  });

  const registerIntent = (
    registration: NotificationIntentRegistration,
  ): string => {
    if (destroyed) {
      throw new Error("NotificationStore has been destroyed");
    }
    if (registration.operationIds.length === 0) {
      throw new Error("registerIntent requires at least one operationId");
    }

    const notificationId = createId();
    const displayContext = sanitizeDisplayContext(registration.displayContext);
    const createdAt = now();

    const record: NotificationRecord = {
      notificationId,
      intentType: registration.intentType,
      operationIds: Object.freeze([...registration.operationIds]),
      primaryOperationId:
        registration.primaryOperationId ?? registration.operationIds[0],
      state: { lifecycle: "pending" },
      message: buildNotificationMessage({
        namespace: registration.messageNamespace,
        lifecycle: "pending",
        displayContext,
      }),
      displayContext,
      initiator: registration.initiator ?? HUMAN_INITIATOR,
      retry: registration.retry ?? NO_RETRY,
      canEscalateToIT: false,
      createdAt,
      dismissAt: null,
      dismissPaused: false,
    };

    const entry: Entry = {
      record,
      namespace: registration.messageNamespace,
      resolve: registration.resolve ?? singleOperationResolver,
      settled: false,
      timers: {},
    };
    entries.set(notificationId, entry);

    entry.timers.reveal = setTimeout(() => {
      const current = entries.get(notificationId);
      if (!current) return;
      current.timers.reveal = undefined;
      if (current.settled || current.record.visibleSince != null) return;
      patch(current, { visibleSince: now() });
      emit();
    }, timing.pendingRevealDelayMs);

    // Defensive: an operation that already settled before registration must
    // not leave the card pending forever.
    evaluate(entry);
    enforceRetentionSoftCap();
    emit();
    return notificationId;
  };

  const dismiss = (notificationId: string) => {
    const entry = entries.get(notificationId);
    if (!entry) return;
    clearAllTimers(entry);
    entries.delete(notificationId);
    emit();
  };

  const pauseDismiss = (notificationId: string) => {
    const entry = entries.get(notificationId);
    if (!entry || entry.record.dismissPaused) return;
    const dismissAt = entry.record.dismissAt;
    if (dismissAt == null) return;
    clearTimer(entry, "dismiss");
    entry.dismissRemainingMs = Math.max(0, dismissAt - now());
    patch(entry, { dismissPaused: true, dismissAt: null });
    emit();
  };

  const resumeDismiss = (notificationId: string) => {
    const entry = entries.get(notificationId);
    if (!entry || !entry.record.dismissPaused) return;
    // Resume with the REMAINING time — never restart the full duration.
    const remaining = entry.dismissRemainingMs ?? 0;
    entry.dismissRemainingMs = undefined;
    patch(entry, { dismissPaused: false, dismissAt: now() + remaining });
    scheduleDismiss(entry, remaining);
    emit();
  };

  const clearEntries = () => {
    for (const entry of entries.values()) {
      clearAllTimers(entry);
    }
    entries.clear();
  };

  return {
    registerIntent,
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dismiss,
    pauseDismiss,
    resumeDismiss,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      unsubscribeManager();
      clearEntries();
      listeners.clear();
      snapshot = EMPTY_SNAPSHOT;
    },
    resetForTests: () => {
      clearEntries();
      rebuildSnapshot();
      emit();
    },
  };
};

/**
 * Visible-window selection (pure, so 7B.2 can reuse it per breakpoint:
 * 3 slots on desktop, 2 on mobile).
 *
 * Errors and already-visible pendings are protected — a burst of successes
 * must never push a failure off screen. Remaining slots go to the newest
 * dismissible cards. Unrevealed cards are never visible.
 */
export const selectVisibleNotifications = (
  snapshot: NotificationSnapshot,
  maxVisible: number = NOTIFICATION_CAPACITY.maxVisible,
): NotificationSnapshot => {
  if (maxVisible <= 0) return EMPTY_SNAPSHOT;
  const revealed = snapshot.filter((record) => record.visibleSince != null);
  if (revealed.length <= maxVisible) return Object.freeze([...revealed]);

  const isProtected = (record: NotificationRecord) =>
    record.state.lifecycle === "error" || record.state.lifecycle === "pending";

  const protectedRecords = revealed.filter(isProtected);
  const rest = revealed.filter((record) => !isProtected(record));

  const chosen =
    protectedRecords.length >= maxVisible
      ? protectedRecords.slice(-maxVisible)
      : [
          ...protectedRecords,
          ...rest.slice(-(maxVisible - protectedRecords.length)),
        ];

  return Object.freeze(chosen.sort((a, b) => a.createdAt - b.createdAt));
};
