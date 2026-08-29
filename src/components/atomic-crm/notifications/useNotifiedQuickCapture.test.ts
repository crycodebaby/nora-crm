/**
 * Phase 7B.4 — Quick Capture notification controller.
 *
 * The controller is driven against a REAL OperationManager and a REAL
 * NotificationStore; only the RPC transport is stubbed. So what is asserted
 * here is the derived truth of the shipped policy/resolver, not a mock of it.
 *
 * The stand-in dataProvider deliberately routes through the same
 * executeCreateQuickCapture* wrappers production uses, which is what makes
 * the 7B.3 correlation (explicit operationId → OperationRecord →
 * x-nora-operation-id header) observable from up here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NORA_ERROR_CODES } from "../domain/noraErrorCodes";
import { executeCreateQuickCaptureCase } from "../operations/executeCreateQuickCaptureCase";
import { executeCreateQuickCaptureTask } from "../operations/executeCreateQuickCaptureTask";
import {
  isValidOperationId,
  NORA_OPERATION_ID_HEADER,
} from "../operations/operationContext";
import {
  createOperationManager,
  type OperationManager,
} from "../operations/operationManager";
import type { CrmDataProvider } from "../providers/types";
import {
  createNotificationStore,
  type NotificationStore,
} from "./notificationStore";
import type { NotificationTiming } from "./notificationTiming";
import {
  QuickCaptureUnnotifiedError,
  submitNotifiedQuickCapture,
  type NotifiedQuickCaptureInput,
} from "./useNotifiedQuickCapture";

const TIMING: NotificationTiming = {
  pendingRevealDelayMs: 30,
  pendingMinVisibleMs: 60,
  successVisibleMs: 200,
  warningVisibleMs: 400,
};

const CASE_RESULT = { company_id: 1, contact_id: 2, deal_id: 3 };
const TASK_RESULT = { task_id: 9 };

const DISPLAY_CONTEXT = {
  dealTitle: "  Kontüreparatur  ",
  customerName: "Müller GmbH",
  contactName: "Anna Müller",
};

const baseInput: NotifiedQuickCaptureInput = {
  customer: { mode: "existing", companyId: 1 },
  contact: { mode: "none" },
  dealTitle: "Kontüreparatur",
  dealCategory: "fensterservice",
  dealDescription: "",
  sourceChannel: "phone",
  sourceLabel: "Telefon",
  followUpDate: "2026-08-29",
  taskType: "",
  salesId: 1,
  idempotencyKey: "intent-key",
  displayContext: DISPLAY_CONTEXT,
};

type Call = { fn: string; args: Record<string, unknown>; operationId: string };

type ProviderBehavior = {
  caseOutcome?: "ok" | "replayed" | { errorCode: string };
  taskOutcome?: "ok" | "replayed" | { errorCode: string };
  /** Resolves the Core call only once released. */
  gateCase?: Promise<void>;
  gateTask?: Promise<void>;
};

const rpcFor =
  (
    calls: Call[],
    outcome: ProviderBehavior["caseOutcome"],
    payload: Record<string, unknown>,
    gate?: Promise<void>,
  ) =>
  (fn: string, args: Record<string, unknown>) => ({
    setHeader: async (name: string, value: string) => {
      calls.push({
        fn,
        args,
        operationId: name === NORA_OPERATION_ID_HEADER ? value : "",
      });
      if (gate) await gate;
      if (outcome && typeof outcome === "object") {
        const error = new Error("rpc failed") as Error & { details: string };
        error.details = outcome.errorCode;
        return { data: null, error };
      }
      return {
        data:
          outcome === "replayed"
            ? { ...payload, _meta: { disposition: "replayed" } }
            : payload,
        error: null,
      };
    },
  });

const buildDataProvider = (
  manager: OperationManager,
  calls: Call[],
  behavior: ProviderBehavior = {},
): CrmDataProvider =>
  ({
    createQuickCaptureCase: (params: Record<string, unknown>) =>
      executeCreateQuickCaptureCase(
        params as never,
        rpcFor(
          calls,
          behavior.caseOutcome ?? "ok",
          CASE_RESULT,
          behavior.gateCase,
        ) as never,
        manager,
      ),
    createQuickCaptureTask: (params: Record<string, unknown>) =>
      executeCreateQuickCaptureTask(
        params as never,
        rpcFor(
          calls,
          behavior.taskOutcome ?? "ok",
          TASK_RESULT,
          behavior.gateTask,
        ) as never,
        manager,
      ),
  }) as unknown as CrmDataProvider;

describe("Quick Capture notification controller (Phase 7B.4)", () => {
  let manager: OperationManager;
  let store: NotificationStore;
  let calls: Call[];
  let counter: number;

  const makeStore = () => {
    manager = createOperationManager({
      successTtlMs: 60_000,
      errorTtlMs: 60_000,
      recordError: null,
    });
    counter = 0;
    store = createNotificationStore({
      manager,
      timing: TIMING,
      createId: () => `n${(counter += 1)}`,
    });
  };

  const only = () => {
    const snapshot = store.getSnapshot();
    expect(snapshot).toHaveLength(1);
    return snapshot[0];
  };

  beforeEach(() => {
    calls = [];
    makeStore();
  });

  afterEach(() => {
    store.destroy();
    manager.resetForTests();
  });

  // ---------------------------------------------------------------- ids ---

  it("1/7: without a task step it mints one valid Core id and no phantom Task slot", async () => {
    const dataProvider = buildDataProvider(manager, calls);
    await submitNotifiedQuickCapture(
      { dataProvider, store, manager },
      baseInput,
    );

    const record = only();
    expect(record.operationIds).toHaveLength(1);
    expect(isValidOperationId(record.operationIds[0])).toBe(true);
    // A second slot would have left the card waiting on an operation that
    // never starts.
    expect(
      calls.filter((c) => c.fn === "create_quick_capture_task"),
    ).toHaveLength(0);
  });

  it("2/3/5: with a task step both ids are valid, distinct, and Core is primary", async () => {
    const dataProvider = buildDataProvider(manager, calls);
    await submitNotifiedQuickCapture(
      { dataProvider, store, manager },
      {
        ...baseInput,
        taskType: "rueckruf",
      },
    );

    const record = only();
    expect(record.operationIds).toHaveLength(2);
    const [caseId, taskId] = record.operationIds;
    expect(isValidOperationId(caseId)).toBe(true);
    expect(isValidOperationId(taskId)).toBe(true);
    expect(caseId).not.toBe(taskId);
    expect(record.primaryOperationId).toBe(caseId);
  });

  it("4/8: the Command and the transport carry exactly the registered ids", async () => {
    const dataProvider = buildDataProvider(manager, calls);
    await submitNotifiedQuickCapture(
      { dataProvider, store, manager },
      {
        ...baseInput,
        taskType: "besichtigung",
      },
    );

    const [caseId, taskId] = only().operationIds;
    const coreCall = calls.find((c) => c.fn === "create_quick_capture_case");
    const taskCall = calls.find((c) => c.fn === "create_quick_capture_task");
    // 7B.3 unchanged: same id in the record and on x-nora-operation-id.
    expect(coreCall?.operationId).toBe(caseId);
    expect(taskCall?.operationId).toBe(taskId);
    expect(manager.getOperation(caseId)?.operationId).toBe(caseId);
    expect(manager.getOperation(taskId)?.operationId).toBe(taskId);
    // No extra operations were minted alongside them.
    expect(manager.getOperations()).toHaveLength(2);
  });

  it("8: the idempotency key stays untouched and separate from the operation ids", async () => {
    const dataProvider = buildDataProvider(manager, calls);
    await submitNotifiedQuickCapture(
      { dataProvider, store, manager },
      {
        ...baseInput,
        taskType: "rueckruf",
      },
    );

    const [caseId, taskId] = only().operationIds;
    for (const call of calls) {
      expect(call.args.p_idempotency_key).toBe("intent-key");
      expect(call.args.p_idempotency_key).not.toBe(caseId);
      expect(call.args.p_idempotency_key).not.toBe(taskId);
    }
  });

  it("6: the display context is registered, sanitized, and free of ids", async () => {
    const dataProvider = buildDataProvider(manager, calls);
    await submitNotifiedQuickCapture(
      { dataProvider, store, manager },
      baseInput,
    );

    const record = only();
    expect(record.displayContext).toEqual({
      dealTitle: "Kontüreparatur",
      customerName: "Müller GmbH",
      contactName: "Anna Müller",
    });
    expect(record.message.bodyKey).toBe(
      "crm.notifications.quick_capture_case.success.body",
    );
    // Own identity — never an operationId.
    expect(record.operationIds).not.toContain(record.notificationId);
    expect(record.initiator).toEqual({ kind: "human" });
    expect(record.retry).toEqual({ kind: "none" });
  });

  // ----------------------------------------------------------- lifecycle ---

  it("9: the controller adds no lifecycle of its own — a settled Core with a pending Task stays pending", async () => {
    let releaseTask!: () => void;
    const gateTask = new Promise<void>((resolve) => {
      releaseTask = resolve;
    });
    const dataProvider = buildDataProvider(manager, calls, { gateTask });

    const run = submitNotifiedQuickCapture(
      { dataProvider, store, manager },
      {
        ...baseInput,
        taskType: "rueckruf",
      },
    );

    await vi.waitFor(() => {
      const [caseId] = only().operationIds;
      expect(manager.getOperation(caseId)?.status).toBe("success");
    });
    // Core is done, the intent is not.
    expect(only().state.lifecycle).toBe("pending");

    releaseTask();
    await run;
    await vi.waitFor(() => {
      expect(only().state.lifecycle).toBe("success");
    });
  });

  it("10/11/16: a slow submit reveals pending and then flips the SAME card to success", async () => {
    let release!: () => void;
    const gateCase = new Promise<void>((resolve) => {
      release = resolve;
    });
    const dataProvider = buildDataProvider(manager, calls, { gateCase });

    const run = submitNotifiedQuickCapture(
      { dataProvider, store, manager },
      baseInput,
    );
    const notificationId = only().notificationId;

    await vi.waitFor(() => {
      expect(only().visibleSince).toBeTypeOf("number");
      expect(only().state.lifecycle).toBe("pending");
    });

    release();
    await run;

    await vi.waitFor(() => {
      const record = only();
      expect(record.state.lifecycle).toBe("success");
      // Same card, not a second one.
      expect(record.notificationId).toBe(notificationId);
    });
    expect(only().message.titleKey).toBe(
      "crm.notifications.quick_capture_case.success.title",
    );
  });

  it("16: a fast submit shows success without ever rendering a pending card", async () => {
    const dataProvider = buildDataProvider(manager, calls);
    await submitNotifiedQuickCapture(
      { dataProvider, store, manager },
      baseInput,
    );

    const record = only();
    expect(record.state.lifecycle).toBe("success");
    // visibleSince is stamped at settle time, never earlier — the pending
    // state was never on screen, so there is nothing to flicker.
    expect(record.settledAt).toBe(record.visibleSince);
  });

  it("12: a Core failure renders as an error with a human reason", async () => {
    const dataProvider = buildDataProvider(manager, calls, {
      caseOutcome: { errorCode: NORA_ERROR_CODES.PERMISSION_DENIED },
    });

    await expect(
      submitNotifiedQuickCapture({ dataProvider, store, manager }, baseInput),
    ).rejects.toThrow();

    const record = only();
    expect(record.state).toMatchObject({
      lifecycle: "error",
      detailKey: expect.stringContaining("crm."),
    });
    // A NORA_* code is never the visible text.
    if (record.state.lifecycle === "error") {
      expect(record.state.detailKey).not.toContain("NORA_");
    }
  });

  it("13: Core success + an ordinary Task failure is a partial warning, on one card", async () => {
    const dataProvider = buildDataProvider(manager, calls, {
      taskOutcome: { errorCode: "some_transport_problem" },
    });

    const output = await submitNotifiedQuickCapture(
      { dataProvider, store, manager },
      { ...baseInput, taskType: "rueckruf" },
    );
    expect(output.taskFailed).toBe(true);

    const record = only();
    expect(record.state).toEqual({
      lifecycle: "partial",
      detailKey: "crm.notifications.quick_capture_case.partial.detail",
    });
    expect(record.message.titleKey).toBe(
      "crm.notifications.quick_capture_case.partial.title",
    );
  });

  it("14: a Task idempotency conflict is an error, never softened to partial", async () => {
    const dataProvider = buildDataProvider(manager, calls, {
      taskOutcome: { errorCode: NORA_ERROR_CODES.IDEMPOTENCY_CONFLICT },
    });

    await expect(
      submitNotifiedQuickCapture(
        { dataProvider, store, manager },
        {
          ...baseInput,
          taskType: "rueckruf",
        },
      ),
    ).rejects.toMatchObject({ message: "task_idempotency_conflict" });

    expect(only().state.lifecycle).toBe("error");
  });

  it("15: a replayed execution is an ordinary success — no replay wording", async () => {
    const dataProvider = buildDataProvider(manager, calls, {
      caseOutcome: "replayed",
      taskOutcome: "replayed",
    });

    await submitNotifiedQuickCapture(
      { dataProvider, store, manager },
      {
        ...baseInput,
        taskType: "rueckruf",
      },
    );

    const record = only();
    const [caseId] = record.operationIds;
    // The technical disposition is recorded…
    expect(manager.getOperation(caseId)?.execution).toBe("replayed");
    // …and stays internal: the card is a plain success.
    expect(record.state.lifecycle).toBe("success");
    expect(record.message.titleKey).toBe(
      "crm.notifications.quick_capture_case.success.title",
    );
    expect(JSON.stringify(record.message)).not.toMatch(/replay/i);
  });

  it("17/18: success auto-dismisses, an error stays until it is closed", async () => {
    const dataProvider = buildDataProvider(manager, calls);
    await submitNotifiedQuickCapture(
      { dataProvider, store, manager },
      baseInput,
    );
    expect(only().dismissAt).toBeTypeOf("number");
    await vi.waitFor(
      () => {
        expect(store.getSnapshot()).toHaveLength(0);
      },
      { timeout: 2_000 },
    );

    const failing = buildDataProvider(manager, calls, {
      caseOutcome: { errorCode: NORA_ERROR_CODES.PERMISSION_DENIED },
    });
    await expect(
      submitNotifiedQuickCapture(
        { dataProvider: failing, store, manager },
        baseInput,
      ),
    ).rejects.toThrow();

    // null = never auto-dismiss.
    expect(only().dismissAt).toBeNull();
    await new Promise((resolve) =>
      setTimeout(resolve, TIMING.successVisibleMs * 2),
    );
    expect(store.getSnapshot()).toHaveLength(1);

    store.dismiss(only().notificationId);
    expect(store.getSnapshot()).toHaveLength(0);
  });

  // ------------------------------------------- failures before an operation ---

  it("§15/C: a failure before the Core operation starts drops the card instead of hanging it", async () => {
    const brokenProvider = {
      createQuickCaptureCase: () => {
        throw new TypeError("provider exploded before the operation started");
      },
    } as unknown as CrmDataProvider;

    await expect(
      submitNotifiedQuickCapture(
        { dataProvider: brokenProvider, store, manager },
        baseInput,
      ),
    ).rejects.toBeInstanceOf(QuickCaptureUnnotifiedError);

    // No stranded pending card, and no invented OperationRecord.
    expect(store.getSnapshot()).toHaveLength(0);
    expect(manager.getOperations()).toHaveLength(0);
  });

  it("§15/B: a failure inside a started operation keeps its card and is NOT reported as unnotified", async () => {
    const dataProvider = buildDataProvider(manager, calls, {
      caseOutcome: { errorCode: NORA_ERROR_CODES.PERMISSION_DENIED },
    });

    const error = await submitNotifiedQuickCapture(
      { dataProvider, store, manager },
      baseInput,
    ).catch((e: unknown) => e);

    expect(error).not.toBeInstanceOf(QuickCaptureUnnotifiedError);
    expect(only().state.lifecycle).toBe("error");
  });

  it("one user intent produces exactly one card, never one per operation", async () => {
    const dataProvider = buildDataProvider(manager, calls);
    await submitNotifiedQuickCapture(
      { dataProvider, store, manager },
      {
        ...baseInput,
        taskType: "rueckruf",
      },
    );

    expect(manager.getOperations()).toHaveLength(2);
    expect(store.getSnapshot()).toHaveLength(1);
  });
});
