/**
 * Phase 7B.1 — Notification Presentation Contract unit tests (P1–P26 plus the
 * store invariants required by the 7B.1 guardrails).
 *
 * Everything is driven through a real OperationManager with injected timing
 * and fake timers — no real-time waits, no flaky sleeps.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NORA_ERROR_CODES } from "../domain/noraErrorCodes";
import { OPERATION_CATALOG } from "../operations/operationCatalog";
import { createOperationId } from "../operations/operationContext";
import {
  createOperationManager,
  type OperationManager,
} from "../operations/operationManager";
import {
  DISPLAY_CONTEXT_MAX_LENGTH,
  HUMAN_INITIATOR,
  TONE_BY_LIFECYCLE,
  notificationTone,
  sanitizeDisplayContext,
  type NotificationLifecycle,
  type NotificationRecord,
} from "./notificationModel";
import {
  NOTIFICATION_GENERIC_ERROR_KEY,
  resolveNotificationErrorDetailKey,
} from "./notificationErrorPresentation";
import {
  getNotificationPolicy,
  isNotifiable,
  quickCaptureCaseResolver,
  singleOperationResolver,
} from "./notificationPolicy";
import {
  createNotificationStore,
  selectVisibleNotifications,
  type NotificationStore,
} from "./notificationStore";
import type { NotificationTiming } from "./notificationTiming";

const TIMING: NotificationTiming = {
  pendingRevealDelayMs: 100,
  pendingMinVisibleMs: 200,
  successVisibleMs: 1_000,
  warningVisibleMs: 3_000,
};

const QUICK_CAPTURE_NS = "crm.notifications.quick_capture_case";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/** Lets queued microtasks (e.g. the manager's best-effort recorder) run. */
const flush = async () => {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
};

const noraError = (code: string): Error => {
  const error = new Error("boom") as Error & { details: string };
  error.details = code;
  return error;
};

describe("Notification Presentation Contract — model", () => {
  it("tone is derived from lifecycle and covers every lifecycle", () => {
    const lifecycles: NotificationLifecycle[] = [
      "pending",
      "success",
      "partial",
      "error",
    ];
    for (const lifecycle of lifecycles) {
      expect(TONE_BY_LIFECYCLE[lifecycle]).toBeDefined();
    }
    expect(notificationTone({ lifecycle: "pending" })).toBe("pending");
    expect(notificationTone({ lifecycle: "success" })).toBe("success");
    expect(notificationTone({ lifecycle: "partial", detailKey: "k" })).toBe(
      "warning",
    );
    expect(notificationTone({ lifecycle: "error", detailKey: "k" })).toBe(
      "error",
    );
  });

  it("P9: display context is trimmed, empties dropped, long values clamped", () => {
    const long = "A".repeat(200);
    const context = sanitizeDisplayContext({
      dealTitle: long,
      customerName: "  Müller GmbH  ",
      contactName: "   ",
      taskTitle: undefined,
    });
    expect(context.customerName).toBe("Müller GmbH");
    expect(context.contactName).toBeUndefined();
    expect(context.taskTitle).toBeUndefined();
    expect(context.dealTitle).toHaveLength(DISPLAY_CONTEXT_MAX_LENGTH);
    expect(context.dealTitle?.endsWith("…")).toBe(true);
  });
});

describe("Notification Presentation Contract — error mapping", () => {
  it("P10: every canonical NoraErrorCode maps to its definition key", () => {
    expect(
      resolveNotificationErrorDetailKey({
        errorCode: NORA_ERROR_CODES.CONTACT_NOT_IN_CUSTOMER_CONTEXT,
      }),
    ).toBe("crm.errors.contact_not_in_customer_context");
    expect(
      resolveNotificationErrorDetailKey({
        errorCode: NORA_ERROR_CODES.INDIVIDUAL_NAME_REQUIRED,
      }),
    ).toBe("crm.errors.individual_name_required");
    expect(
      resolveNotificationErrorDetailKey({
        errorCode: NORA_ERROR_CODES.SELF_CONTACT_DELETE_BLOCKED,
      }),
    ).toBe("crm.errors.self_contact_delete_blocked");
    expect(
      resolveNotificationErrorDetailKey({
        errorCode: NORA_ERROR_CODES.PRIVATE_CUSTOMER_ALREADY_EXISTS,
      }),
    ).toBe("crm.errors.private_customer_already_exists");
    expect(
      resolveNotificationErrorDetailKey({
        errorCode: NORA_ERROR_CODES.PERMISSION_DENIED,
      }),
    ).toBe("crm.errors.permission_denied");
    expect(
      resolveNotificationErrorDetailKey({
        errorCode: NORA_ERROR_CODES.IDEMPOTENCY_CONFLICT,
      }),
    ).toBe("crm.errors.idempotency_conflict");
  });

  it("P11: unknown / missing / non-canonical codes fall back to the generic key", () => {
    expect(resolveNotificationErrorDetailKey()).toBe(
      NOTIFICATION_GENERIC_ERROR_KEY,
    );
    expect(resolveNotificationErrorDetailKey({ errorCode: "unknown" })).toBe(
      NOTIFICATION_GENERIC_ERROR_KEY,
    );
    expect(
      resolveNotificationErrorDetailKey({ errorCode: "NORA_MADE_UP" }),
    ).toBe(NOTIFICATION_GENERIC_ERROR_KEY);
  });

  it("P12: known transport buckets keep their accurate existing texts", () => {
    expect(
      resolveNotificationErrorDetailKey({ safeErrorCode: "network" }),
    ).toBe("crm.errors.network_unreachable");
    expect(
      resolveNotificationErrorDetailKey({
        safeErrorCode: "service_unavailable",
      }),
    ).toBe("crm.errors.service_unavailable");
    expect(
      resolveNotificationErrorDetailKey({ safeErrorCode: "aborted" }),
    ).toBe(NOTIFICATION_GENERIC_ERROR_KEY);
  });

  it("a canonical code always wins over the transport bucket", () => {
    expect(
      resolveNotificationErrorDetailKey({
        errorCode: NORA_ERROR_CODES.PERMISSION_DENIED,
        safeErrorCode: "network",
      }),
    ).toBe("crm.errors.permission_denied");
  });
});

describe("Notification Presentation Contract — policy", () => {
  it("P26: quickCapture.createTask is deliberately silent on its own", () => {
    expect(isNotifiable("quickCapture.createCase")).toBe(true);
    expect(isNotifiable("quickCapture.createTask")).toBe(false);
    expect(getNotificationPolicy("quickCapture.createTask")?.visible).toBe(
      false,
    );
  });

  it("unlisted operation types are silent by default", () => {
    expect(isNotifiable("deal.update")).toBe(false);
    expect(isNotifiable("deal.assign")).toBe(false);
    expect(isNotifiable("customer.update")).toBe(false);
    expect(getNotificationPolicy("contact.setPrimary")).toBeUndefined();
  });

  it("P13: the shipped Quick Capture policy offers no retry", () => {
    expect(getNotificationPolicy("quickCapture.createCase")?.retry).toEqual({
      kind: "none",
    });
  });

  it("resolvers reduce operations without touching the manager", () => {
    expect(
      singleOperationResolver({ operations: [undefined], namespace: "ns" })
        .state.lifecycle,
    ).toBe("pending");
    expect(
      quickCaptureCaseResolver({
        operations: [undefined, undefined],
        namespace: "ns",
      }).state.lifecycle,
    ).toBe("pending");
  });
});

describe("NotificationStore", () => {
  let manager: OperationManager;
  let store: NotificationStore;
  let idCounter: number;

  const makeStore = (overrides?: {
    successTtlMs?: number;
    errorTtlMs?: number;
    retentionSoftCap?: number;
    maxVisible?: number;
  }) => {
    manager = createOperationManager({
      successTtlMs: overrides?.successTtlMs ?? 60_000,
      errorTtlMs: overrides?.errorTtlMs ?? 60_000,
      maxOperations: 50,
      recordError: null,
    });
    store = createNotificationStore({
      manager,
      timing: TIMING,
      capacity: {
        maxVisible: overrides?.maxVisible ?? 3,
        retentionSoftCap: overrides?.retentionSoftCap ?? 10,
      },
      createId: () => `n${(idCounter += 1)}`,
    });
  };

  const registerQuickCapture = (input?: {
    operationIds?: string[];
    displayContext?: Record<string, string>;
  }) => {
    const policy = getNotificationPolicy("quickCapture.createCase")!;
    const operationIds = input?.operationIds ?? [createOperationId()];
    return {
      operationIds,
      notificationId: store.registerIntent({
        intentType: policy.intentType,
        messageNamespace: policy.messageNamespace,
        operationIds,
        displayContext: input?.displayContext ?? {
          dealTitle: "Kontüreparatur",
          customerName: "Müller GmbH",
        },
        retry: policy.retry,
        resolve: policy.resolve,
      }),
    };
  };

  const find = (notificationId: string): NotificationRecord => {
    const record = store
      .getSnapshot()
      .find((entry) => entry.notificationId === notificationId);
    if (!record) throw new Error(`notification ${notificationId} not found`);
    return record;
  };

  const exists = (notificationId: string): boolean =>
    store
      .getSnapshot()
      .some((entry) => entry.notificationId === notificationId);

  beforeEach(() => {
    vi.useFakeTimers();
    idCounter = 0;
    makeStore();
  });

  afterEach(() => {
    store.destroy();
    manager.resetForTests();
    vi.useRealTimers();
  });

  it("P1: pending becomes visible only after the reveal delay", async () => {
    const { operationIds, notificationId } = registerQuickCapture();
    const gate = deferred<string>();
    const run = manager.execute(
      OPERATION_CATALOG["quickCapture.createCase"],
      { operationId: operationIds[0] },
      () => gate.promise,
    );

    expect(find(notificationId).visibleSince).toBeUndefined();
    expect(find(notificationId).state.lifecycle).toBe("pending");

    vi.advanceTimersByTime(99);
    expect(find(notificationId).visibleSince).toBeUndefined();

    vi.advanceTimersByTime(1);
    expect(find(notificationId).visibleSince).toBeDefined();
    expect(find(notificationId).dismissAt).toBeNull();

    gate.resolve("ok");
    await run;
  });

  it("P2: success transition keeps the same notificationId (no remount)", async () => {
    const { operationIds, notificationId } = registerQuickCapture();
    vi.advanceTimersByTime(TIMING.pendingRevealDelayMs);
    const before = find(notificationId);

    await manager.execute(
      OPERATION_CATALOG["quickCapture.createCase"],
      { operationId: operationIds[0] },
      async () => "ok",
    );
    vi.advanceTimersByTime(TIMING.pendingMinVisibleMs);

    const after = find(notificationId);
    expect(after.notificationId).toBe(before.notificationId);
    expect(after.state.lifecycle).toBe("success");
    expect(notificationTone(after.state)).toBe("success");
    expect(after.message.titleKey).toBe(`${QUICK_CAPTURE_NS}.success.title`);
  });

  it("P3: error transition keeps the same card and carries a detail key", async () => {
    const { operationIds, notificationId } = registerQuickCapture();
    vi.advanceTimersByTime(TIMING.pendingRevealDelayMs);

    await expect(
      manager.execute(
        OPERATION_CATALOG["quickCapture.createCase"],
        { operationId: operationIds[0] },
        async () => {
          throw noraError(NORA_ERROR_CODES.CONTACT_NOT_IN_CUSTOMER_CONTEXT);
        },
      ),
    ).rejects.toThrow();
    vi.advanceTimersByTime(TIMING.pendingMinVisibleMs);

    const record = find(notificationId);
    expect(record.state.lifecycle).toBe("error");
    expect(notificationTone(record.state)).toBe("error");
    expect(
      record.state.lifecycle === "error" ? record.state.detailKey : null,
    ).toBe("crm.errors.contact_not_in_customer_context");
    expect(record.message.titleKey).toBe(`${QUICK_CAPTURE_NS}.error.title`);
  });

  it("P4: a replayed execution renders identically to an executed one", async () => {
    const executed = registerQuickCapture();
    await manager.execute(
      OPERATION_CATALOG["quickCapture.createCase"],
      { operationId: executed.operationIds[0] },
      async (ctx) => {
        ctx.reportOutcome({ execution: "executed", result: { dealId: 1 } });
        return "ok";
      },
    );

    const replayed = registerQuickCapture();
    await manager.execute(
      OPERATION_CATALOG["quickCapture.createCase"],
      { operationId: replayed.operationIds[0] },
      async (ctx) => {
        ctx.reportOutcome({ execution: "replayed", result: { dealId: 1 } });
        return "ok";
      },
    );

    const a = find(executed.notificationId);
    const b = find(replayed.notificationId);
    expect(manager.getOperation(executed.operationIds[0])?.execution).toBe(
      "executed",
    );
    expect(manager.getOperation(replayed.operationIds[0])?.execution).toBe(
      "replayed",
    );
    // Same tone, same keys, same args — replay is not a special case.
    expect(b.state).toEqual(a.state);
    expect(b.message).toEqual(a.message);
    expect(notificationTone(b.state)).toBe(notificationTone(a.state));
  });

  it("P5: core success + task failure is a Presentation partial (warning)", async () => {
    const caseOp = createOperationId();
    const taskOp = createOperationId();
    const { notificationId } = registerQuickCapture({
      operationIds: [caseOp, taskOp],
    });

    await manager.execute(
      OPERATION_CATALOG["quickCapture.createCase"],
      { operationId: caseOp },
      async () => "ok",
    );
    // Core done, task still running → the card stays pending.
    expect(find(notificationId).state.lifecycle).toBe("pending");

    await expect(
      manager.execute(
        OPERATION_CATALOG["quickCapture.createTask"],
        { operationId: taskOp },
        async () => {
          throw new Error("task blew up");
        },
      ),
    ).rejects.toThrow();
    vi.advanceTimersByTime(TIMING.pendingRevealDelayMs);

    const record = find(notificationId);
    expect(record.state.lifecycle).toBe("partial");
    expect(notificationTone(record.state)).toBe("warning");
    expect(
      record.state.lifecycle === "partial" ? record.state.detailKey : null,
    ).toBe(`${QUICK_CAPTURE_NS}.partial.detail`);
    expect(record.message.titleKey).toBe(`${QUICK_CAPTURE_NS}.partial.title`);
  });

  it("P6: a task idempotency conflict is a hard error, never a partial", async () => {
    const caseOp = createOperationId();
    const taskOp = createOperationId();
    const { notificationId } = registerQuickCapture({
      operationIds: [caseOp, taskOp],
    });

    await manager.execute(
      OPERATION_CATALOG["quickCapture.createCase"],
      { operationId: caseOp },
      async () => "ok",
    );
    await expect(
      manager.execute(
        OPERATION_CATALOG["quickCapture.createTask"],
        { operationId: taskOp },
        async () => {
          throw noraError(NORA_ERROR_CODES.IDEMPOTENCY_CONFLICT);
        },
      ),
    ).rejects.toThrow();
    vi.advanceTimersByTime(TIMING.pendingRevealDelayMs);

    const record = find(notificationId);
    expect(record.state.lifecycle).toBe("error");
    expect(
      record.state.lifecycle === "error" ? record.state.detailKey : null,
    ).toBe("crm.errors.idempotency_conflict");
  });

  it("core failure wins outright — a registered task never softens it", async () => {
    const caseOp = createOperationId();
    const taskOp = createOperationId();
    const { notificationId } = registerQuickCapture({
      operationIds: [caseOp, taskOp],
    });

    await expect(
      manager.execute(
        OPERATION_CATALOG["quickCapture.createCase"],
        { operationId: caseOp },
        async () => {
          throw noraError(NORA_ERROR_CODES.PERMISSION_DENIED);
        },
      ),
    ).rejects.toThrow();
    vi.advanceTimersByTime(TIMING.pendingRevealDelayMs);

    expect(find(notificationId).state.lifecycle).toBe("error");
  });

  it("P7: the body carries the business display context", () => {
    const { notificationId } = registerQuickCapture();
    const record = find(notificationId);
    expect(record.message.bodyKey).toBe(`${QUICK_CAPTURE_NS}.pending.body`);
    expect(record.message.args).toEqual({
      dealTitle: "Kontüreparatur",
      customerName: "Müller GmbH",
    });
  });

  it("P8: a missing customer selects a different key, never an empty slot", () => {
    const { notificationId } = registerQuickCapture({
      displayContext: { dealTitle: "Kontüreparatur" },
    });
    const record = find(notificationId);
    expect(record.message.bodyKey).toBe(
      `${QUICK_CAPTURE_NS}.pending.body_no_customer`,
    );
    expect(record.message.args.customerName).toBeUndefined();
  });

  it("no usable context at all yields a title-only message", () => {
    const { notificationId } = registerQuickCapture({ displayContext: {} });
    expect(find(notificationId).message.bodyKey).toBeUndefined();
  });

  it("P14: initiator defaults to human; a non-human initiator is preserved", () => {
    const first = registerQuickCapture();
    expect(find(first.notificationId).initiator).toEqual(HUMAN_INITIATOR);

    const policy = getNotificationPolicy("quickCapture.createCase")!;
    const id = store.registerIntent({
      intentType: policy.intentType,
      messageNamespace: policy.messageNamespace,
      operationIds: [createOperationId()],
      displayContext: { dealTitle: "X" },
      initiator: { kind: "ai", label: "KI-Agent Nora" },
      resolve: policy.resolve,
    });
    expect(find(id).initiator).toEqual({ kind: "ai", label: "KI-Agent Nora" });
  });

  it("P15: several cards keep a stable oldest-first order within the visible window", async () => {
    const created: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const { operationIds, notificationId } = registerQuickCapture({
        displayContext: { dealTitle: `Vorgang ${i}` },
      });
      created.push(notificationId);
      await manager.execute(
        OPERATION_CATALOG["quickCapture.createCase"],
        { operationId: operationIds[0] },
        async () => "ok",
      );
      vi.advanceTimersByTime(10);
    }

    expect(store.getSnapshot()).toHaveLength(4);
    const visible = selectVisibleNotifications(store.getSnapshot(), 3);
    expect(visible).toHaveLength(3);
    expect(visible.map((r) => r.notificationId)).toEqual(created.slice(1));
    const times = visible.map((r) => r.createdAt);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("P16: an error is never pushed out of the visible window by newer successes", async () => {
    const failing = registerQuickCapture({
      displayContext: { dealTitle: "Fehlerfall" },
    });
    await expect(
      manager.execute(
        OPERATION_CATALOG["quickCapture.createCase"],
        { operationId: failing.operationIds[0] },
        async () => {
          throw noraError(NORA_ERROR_CODES.PERMISSION_DENIED);
        },
      ),
    ).rejects.toThrow();
    vi.advanceTimersByTime(10);

    for (let i = 0; i < 3; i += 1) {
      const { operationIds } = registerQuickCapture({
        displayContext: { dealTitle: `Erfolg ${i}` },
      });
      await manager.execute(
        OPERATION_CATALOG["quickCapture.createCase"],
        { operationId: operationIds[0] },
        async () => "ok",
      );
      vi.advanceTimersByTime(10);
    }

    const visible = selectVisibleNotifications(store.getSnapshot(), 3);
    expect(
      visible.some((r) => r.notificationId === failing.notificationId),
    ).toBe(true);
  });

  it("P17: a fast operation never renders a pending flash", async () => {
    const { operationIds, notificationId } = registerQuickCapture();
    vi.advanceTimersByTime(50); // still below the reveal delay
    await manager.execute(
      OPERATION_CATALOG["quickCapture.createCase"],
      { operationId: operationIds[0] },
      async () => "ok",
    );

    const record = find(notificationId);
    expect(record.state.lifecycle).toBe("success");
    expect(record.visibleSince).toBe(record.settledAt);

    // The reveal timer must not fire afterwards and re-open a pending state.
    vi.advanceTimersByTime(TIMING.pendingRevealDelayMs);
    expect(find(notificationId).state.lifecycle).toBe("success");
  });

  it("P18: once pending is visible it stays for the minimum display time", async () => {
    const { operationIds, notificationId } = registerQuickCapture();
    vi.advanceTimersByTime(TIMING.pendingRevealDelayMs); // t=100, visible
    await manager.execute(
      OPERATION_CATALOG["quickCapture.createCase"],
      { operationId: operationIds[0] },
      async () => "ok",
    );

    // Settled technically, but pending has only been on screen for 0 ms.
    expect(find(notificationId).state.lifecycle).toBe("pending");
    vi.advanceTimersByTime(TIMING.pendingMinVisibleMs - 1);
    expect(find(notificationId).state.lifecycle).toBe("pending");
    vi.advanceTimersByTime(1);
    expect(find(notificationId).state.lifecycle).toBe("success");
  });

  it("P19: success auto-dismisses after its visible time", async () => {
    const { operationIds, notificationId } = registerQuickCapture();
    await manager.execute(
      OPERATION_CATALOG["quickCapture.createCase"],
      { operationId: operationIds[0] },
      async () => "ok",
    );
    expect(exists(notificationId)).toBe(true);

    vi.advanceTimersByTime(TIMING.successVisibleMs - 1);
    expect(exists(notificationId)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(exists(notificationId)).toBe(false);
  });

  it("P20: a partial stays visible longer than a success", async () => {
    const caseOp = createOperationId();
    const taskOp = createOperationId();
    const { notificationId } = registerQuickCapture({
      operationIds: [caseOp, taskOp],
    });
    await manager.execute(
      OPERATION_CATALOG["quickCapture.createCase"],
      { operationId: caseOp },
      async () => "ok",
    );
    await expect(
      manager.execute(
        OPERATION_CATALOG["quickCapture.createTask"],
        { operationId: taskOp },
        async () => {
          throw new Error("nope");
        },
      ),
    ).rejects.toThrow();

    vi.advanceTimersByTime(TIMING.successVisibleMs);
    expect(exists(notificationId)).toBe(true);
    vi.advanceTimersByTime(TIMING.warningVisibleMs - TIMING.successVisibleMs);
    expect(exists(notificationId)).toBe(false);
  });

  it("P21: an error never auto-dismisses", async () => {
    const { operationIds, notificationId } = registerQuickCapture();
    await expect(
      manager.execute(
        OPERATION_CATALOG["quickCapture.createCase"],
        { operationId: operationIds[0] },
        async () => {
          throw noraError(NORA_ERROR_CODES.PERMISSION_DENIED);
        },
      ),
    ).rejects.toThrow();

    expect(find(notificationId).dismissAt).toBeNull();
    vi.advanceTimersByTime(10 * 60_000);
    expect(exists(notificationId)).toBe(true);

    store.dismiss(notificationId);
    expect(exists(notificationId)).toBe(false);
  });

  it("P22: the card survives eviction of its OperationRecord unchanged", async () => {
    store.destroy();
    makeStore({ errorTtlMs: 500 });

    const { operationIds, notificationId } = registerQuickCapture();
    await expect(
      manager.execute(
        OPERATION_CATALOG["quickCapture.createCase"],
        { operationId: operationIds[0] },
        async () => {
          throw noraError(NORA_ERROR_CODES.CONTACT_NOT_IN_CUSTOMER_CONTEXT);
        },
      ),
    ).rejects.toThrow();

    const before = find(notificationId);
    vi.advanceTimersByTime(600);

    expect(manager.getOperation(operationIds[0])).toBeUndefined();
    const after = find(notificationId);
    expect(after.state).toEqual(before.state);
    expect(after.message).toEqual(before.message);
    expect(after.displayContext).toEqual(before.displayContext);
    expect(after.settledAt).toBe(before.settledAt);
  });

  it("P23: a late publicErrorRef is additive and never restarts dismissal", async () => {
    store.destroy();
    // The recorder is held open deliberately: the ref must be observable as
    // arriving AFTER the card already settled, not folded into the same tick.
    const recorderGate = deferred<{ errorId: string; publicRef: string }>();
    manager = createOperationManager({
      successTtlMs: 60_000,
      errorTtlMs: 60_000,
      maxOperations: 50,
      recordError: () => recorderGate.promise,
    });
    store = createNotificationStore({
      manager,
      timing: TIMING,
      createId: () => `n${(idCounter += 1)}`,
    });

    const caseOp = createOperationId();
    const taskOp = createOperationId();
    const policy = getNotificationPolicy("quickCapture.createCase")!;
    const notificationId = store.registerIntent({
      intentType: policy.intentType,
      messageNamespace: policy.messageNamespace,
      operationIds: [caseOp, taskOp],
      displayContext: {
        dealTitle: "Kontüreparatur",
        customerName: "Müller GmbH",
      },
      resolve: policy.resolve,
    });

    await manager.execute(
      OPERATION_CATALOG["quickCapture.createCase"],
      { operationId: caseOp },
      async () => "ok",
    );
    await expect(
      manager.execute(
        OPERATION_CATALOG["quickCapture.createTask"],
        { operationId: taskOp },
        async () => {
          throw new Error("task failed");
        },
      ),
    ).rejects.toThrow();

    const before = find(notificationId);
    expect(before.state.lifecycle).toBe("partial");
    expect(before.canEscalateToIT).toBe(false);
    expect(before.publicErrorRef).toBeUndefined();

    recorderGate.resolve({
      errorId: "11111111-1111-4111-8111-111111111111",
      publicRef: "NORA-E4711",
    });
    await flush();

    const after = find(notificationId);
    expect(after.publicErrorRef).toBe("NORA-E4711");
    expect(after.canEscalateToIT).toBe(true);
    // Additive only — nothing else moved.
    expect(after.state).toEqual(before.state);
    expect(after.message).toEqual(before.message);
    expect(after.settledAt).toBe(before.settledAt);
    expect(after.dismissAt).toBe(before.dismissAt);
  });

  it("P24/P25: pausing keeps the remaining time and never restarts it", async () => {
    const { operationIds, notificationId } = registerQuickCapture();
    await manager.execute(
      OPERATION_CATALOG["quickCapture.createCase"],
      { operationId: operationIds[0] },
      async () => "ok",
    );

    vi.advanceTimersByTime(800); // 200 ms left of successVisibleMs
    store.pauseDismiss(notificationId);
    expect(find(notificationId).dismissPaused).toBe(true);
    expect(find(notificationId).dismissAt).toBeNull();

    vi.advanceTimersByTime(10_000); // paused: nothing happens
    expect(exists(notificationId)).toBe(true);

    store.resumeDismiss(notificationId);
    expect(find(notificationId).dismissPaused).toBe(false);
    vi.advanceTimersByTime(199);
    expect(exists(notificationId)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(exists(notificationId)).toBe(false);
  });

  it("pausing a persistent error is a no-op", async () => {
    const { operationIds, notificationId } = registerQuickCapture();
    await expect(
      manager.execute(
        OPERATION_CATALOG["quickCapture.createCase"],
        { operationId: operationIds[0] },
        async () => {
          throw new Error("x");
        },
      ),
    ).rejects.toThrow();

    store.pauseDismiss(notificationId);
    expect(find(notificationId).dismissPaused).toBe(false);
  });

  it("a long-running pending is never reinterpreted as an error", async () => {
    const { operationIds, notificationId } = registerQuickCapture();
    const gate = deferred<string>();
    const run = manager.execute(
      OPERATION_CATALOG["quickCapture.createCase"],
      { operationId: operationIds[0] },
      () => gate.promise,
    );

    vi.advanceTimersByTime(30 * 60_000);
    expect(find(notificationId).state.lifecycle).toBe("pending");
    expect(find(notificationId).dismissAt).toBeNull();

    gate.resolve("ok");
    await run;
    expect(find(notificationId).state.lifecycle).toBe("success");
  });

  it("retention: settled entries are evicted cheapest-first, errors last", async () => {
    store.destroy();
    makeStore({ retentionSoftCap: 3 });

    const ids: string[] = [];
    // One error first, then five successes.
    const failing = registerQuickCapture();
    await expect(
      manager.execute(
        OPERATION_CATALOG["quickCapture.createCase"],
        { operationId: failing.operationIds[0] },
        async () => {
          throw new Error("x");
        },
      ),
    ).rejects.toThrow();
    vi.advanceTimersByTime(10);

    for (let i = 0; i < 5; i += 1) {
      const { operationIds, notificationId } = registerQuickCapture();
      ids.push(notificationId);
      await manager.execute(
        OPERATION_CATALOG["quickCapture.createCase"],
        { operationId: operationIds[0] },
        async () => "ok",
      );
      vi.advanceTimersByTime(10);
    }

    expect(store.getSnapshot().length).toBeLessThanOrEqual(3);
    expect(exists(failing.notificationId)).toBe(true);
    // The oldest successes went first.
    expect(exists(ids[0])).toBe(false);
  });

  it("retention: pending is never evicted, so the soft cap is deliberately exceeded", () => {
    store.destroy();
    makeStore({ retentionSoftCap: 2 });

    const pendingIds = [0, 1, 2, 3].map(() => {
      const { operationIds, notificationId } = registerQuickCapture();
      manager.execute(
        OPERATION_CATALOG["quickCapture.createCase"],
        { operationId: operationIds[0] },
        () => deferred<string>().promise,
      );
      return notificationId;
    });

    for (const id of pendingIds) {
      expect(exists(id)).toBe(true);
    }
    // retentionSoftCap is NOT a hard bound: it is exceeded rather than
    // stranding a user mid-action.
    expect(store.getSnapshot()).toHaveLength(4);
    // The HARD limit is the on-screen one, and it still holds.
    vi.advanceTimersByTime(TIMING.pendingRevealDelayMs);
    expect(selectVisibleNotifications(store.getSnapshot(), 3)).toHaveLength(3);
  });

  it("retention: an error is evicted only as the last resort, never on time", async () => {
    store.destroy();
    makeStore({ retentionSoftCap: 2 });

    const errors: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const { operationIds, notificationId } = registerQuickCapture();
      errors.push(notificationId);
      await expect(
        manager.execute(
          OPERATION_CATALOG["quickCapture.createCase"],
          { operationId: operationIds[0] },
          async () => {
            throw new Error("x");
          },
        ),
      ).rejects.toThrow();
      vi.advanceTimersByTime(10);
    }

    // Capacity pressure with nothing cheaper left: the OLDEST errors go.
    expect(store.getSnapshot()).toHaveLength(2);
    expect(exists(errors[0])).toBe(false);
    expect(exists(errors[3])).toBe(true);

    // Time alone still never removes an error.
    vi.advanceTimersByTime(60 * 60_000);
    expect(store.getSnapshot()).toHaveLength(2);
  });

  it("invariant: destroy() releases the manager subscription and all timers", async () => {
    const { operationIds, notificationId } = registerQuickCapture();
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });

    store.destroy();
    const afterDestroy = notified;

    await manager.execute(
      OPERATION_CATALOG["quickCapture.createCase"],
      { operationId: operationIds[0] },
      async () => "ok",
    );
    vi.advanceTimersByTime(60_000);

    expect(notified).toBe(afterDestroy);
    expect(store.getSnapshot()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(() => store.destroy()).not.toThrow();
    expect(() => registerQuickCapture()).toThrow(/destroyed/);
    void notificationId;
  });

  it("invariant: dismiss clears that card's timers", async () => {
    const { operationIds, notificationId } = registerQuickCapture();
    await manager.execute(
      OPERATION_CATALOG["quickCapture.createCase"],
      { operationId: operationIds[0] },
      async () => "ok",
    );
    const withCard = vi.getTimerCount();
    expect(withCard).toBeGreaterThan(0);

    store.dismiss(notificationId);
    expect(store.getSnapshot()).toHaveLength(0);
    // One timer is still outstanding, but it belongs to the OperationManager's
    // own retention — not to the dismissed card.
    expect(vi.getTimerCount()).toBe(withCard - 1);
    manager.resetForTests();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("snapshot identity is stable between emits (useSyncExternalStore safe)", () => {
    const first = store.getSnapshot();
    expect(store.getSnapshot()).toBe(first);
    registerQuickCapture();
    const second = store.getSnapshot();
    expect(second).not.toBe(first);
    expect(store.getSnapshot()).toBe(second);
  });

  it("subscribers are notified on registration and unsubscribe cleanly", () => {
    let count = 0;
    const unsubscribe = store.subscribe(() => {
      count += 1;
    });
    registerQuickCapture();
    expect(count).toBeGreaterThan(0);

    const seen = count;
    unsubscribe();
    registerQuickCapture();
    expect(count).toBe(seen);
  });

  it("registerIntent rejects an empty operation list", () => {
    const policy = getNotificationPolicy("quickCapture.createCase")!;
    expect(() =>
      store.registerIntent({
        intentType: policy.intentType,
        messageNamespace: policy.messageNamespace,
        operationIds: [],
      }),
    ).toThrow(/at least one operationId/);
  });

  it("a notificationId is never one of its operationIds", () => {
    const { operationIds, notificationId } = registerQuickCapture();
    expect(operationIds).not.toContain(notificationId);
    expect(find(notificationId).primaryOperationId).toBe(operationIds[0]);
  });
});
