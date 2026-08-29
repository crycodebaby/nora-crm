/**
 * Phase 7B.3 — operation_id correlation plumbing.
 *
 * Proves that a caller-supplied operationId travels unchanged from the
 * Application Command through the provider layer into the OperationManager
 * record AND onto the `x-nora-operation-id` transport header, without any
 * transformation, second UUID, or notification dependency.
 *
 * Nothing here imports from notifications/ — the plumbing is presentation
 * neutral by construction.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createQuickCaptureCase } from "../application/commands/createQuickCaptureCase";
import { NORA_ERROR_CODES } from "../domain/noraErrorCodes";
import type { CrmDataProvider } from "../providers/types";
import { executeCreateQuickCaptureCase } from "./executeCreateQuickCaptureCase";
import { executeCreateQuickCaptureTask } from "./executeCreateQuickCaptureTask";
import {
  createOperationId,
  isValidOperationId,
  NORA_OPERATION_ID_HEADER,
} from "./operationContext";
import {
  createOperationManager,
  type OperationManager,
} from "./operationManager";

type CapturedCall = {
  fn: string;
  args: Record<string, unknown>;
  headers: Record<string, string>;
};

/** Minimal stand-in for the supabase-js rpc builder used by the wrappers. */
const buildRpc = (
  calls: CapturedCall[],
  data: unknown,
  error: unknown = null,
) =>
  ((fn: string, args: Record<string, unknown>) => ({
    setHeader: (name: string, value: string) => {
      calls.push({ fn, args, headers: { [name]: value } });
      return Promise.resolve({ data, error });
    },
  })) as never;

const CASE_RESULT = { company_id: 1, contact_id: 2, deal_id: 3 };
const TASK_RESULT = { task_id: 9 };

const baseInput = {
  customer: { mode: "existing" as const, companyId: 1 },
  contact: { mode: "none" as const },
  dealTitle: "Fenstergriff defekt",
  dealCategory: "fensterservice",
  dealDescription: "",
  sourceChannel: "phone" as const,
  sourceLabel: "Telefon",
  followUpDate: "2026-08-27",
  taskType: "" as const,
  salesId: 1,
};

describe("Quick Capture operation correlation — execute wrappers", () => {
  let manager: OperationManager;
  let calls: CapturedCall[];

  beforeEach(() => {
    manager = createOperationManager({ recordError: null });
    calls = [];
  });

  afterEach(() => {
    manager.resetForTests();
  });

  it("5/7: an explicit Core operationId becomes the record id AND the header, unchanged", async () => {
    const explicit = createOperationId();

    await executeCreateQuickCaptureCase(
      { deal: { name: "X" }, operationId: explicit },
      buildRpc(calls, CASE_RESULT),
      manager,
    );

    expect(manager.getOperation(explicit)?.operationId).toBe(explicit);
    expect(manager.getOperation(explicit)?.status).toBe("success");
    expect(calls).toHaveLength(1);
    expect(calls[0].headers[NORA_OPERATION_ID_HEADER]).toBe(explicit);
    // No second operation was created alongside it.
    expect(manager.getOperations()).toHaveLength(1);
  });

  it("5/7: an explicit Task operationId behaves identically", async () => {
    const explicit = createOperationId();

    await executeCreateQuickCaptureTask(
      { companyId: 1, operationId: explicit },
      buildRpc(calls, TASK_RESULT),
      manager,
    );

    expect(manager.getOperation(explicit)?.operationId).toBe(explicit);
    expect(calls[0].headers[NORA_OPERATION_ID_HEADER]).toBe(explicit);
  });

  it("6: without an explicit id the manager still mints a valid new one (no regression)", async () => {
    await executeCreateQuickCaptureCase(
      { deal: { name: "X" } },
      buildRpc(calls, CASE_RESULT),
      manager,
    );

    const records = manager.getOperations();
    expect(records).toHaveLength(1);
    expect(isValidOperationId(records[0].operationId)).toBe(true);
    // The minted id is what went on the wire — still exactly one identity.
    expect(calls[0].headers[NORA_OPERATION_ID_HEADER]).toBe(
      records[0].operationId,
    );
  });

  it("an unusable operationId falls back to minting instead of corrupting the header", async () => {
    await executeCreateQuickCaptureCase(
      { deal: { name: "X" }, operationId: "not-a-uuid" },
      buildRpc(calls, CASE_RESULT),
      manager,
    );

    const record = manager.getOperations()[0];
    expect(record.operationId).not.toBe("not-a-uuid");
    expect(isValidOperationId(record.operationId)).toBe(true);
    expect(calls[0].headers[NORA_OPERATION_ID_HEADER]).toBe(record.operationId);
  });

  it("16: a failed operation keeps the explicit id for Error Observatory correlation", async () => {
    const explicit = createOperationId();
    const rpcError = new Error("denied") as Error & { details: string };
    rpcError.details = NORA_ERROR_CODES.PERMISSION_DENIED;

    await expect(
      executeCreateQuickCaptureCase(
        { deal: { name: "X" }, operationId: explicit },
        buildRpc(calls, null, rpcError),
        manager,
      ),
    ).rejects.toThrow();

    const record = manager.getOperation(explicit);
    expect(record?.operationId).toBe(explicit);
    expect(record?.status).toBe("error");
    expect(record?.errorCode).toBe(NORA_ERROR_CODES.PERMISSION_DENIED);
    // 15: the very same id was sent as the audit correlation header.
    expect(calls[0].headers[NORA_OPERATION_ID_HEADER]).toBe(explicit);
  });

  it("14: operationId and idempotencyKey stay separate concerns", async () => {
    const idempotencyKey = createOperationId();
    const firstAttempt = createOperationId();
    const secondAttempt = createOperationId();

    await executeCreateQuickCaptureCase(
      { deal: { name: "X" }, idempotencyKey, operationId: firstAttempt },
      buildRpc(calls, CASE_RESULT),
      manager,
    );
    await executeCreateQuickCaptureCase(
      { deal: { name: "X" }, idempotencyKey, operationId: secondAttempt },
      buildRpc(calls, CASE_RESULT),
      manager,
    );

    // Same business intent, two technical attempts.
    expect(calls[0].args.p_idempotency_key).toBe(idempotencyKey);
    expect(calls[1].args.p_idempotency_key).toBe(idempotencyKey);
    expect(calls[0].headers[NORA_OPERATION_ID_HEADER]).toBe(firstAttempt);
    expect(calls[1].headers[NORA_OPERATION_ID_HEADER]).toBe(secondAttempt);
    expect(firstAttempt).not.toBe(secondAttempt);
  });
});

describe("Quick Capture operation correlation — application command", () => {
  const buildDataProvider = (received: Record<string, unknown>[]) =>
    ({
      createQuickCaptureCase: async (params: Record<string, unknown>) => {
        received.push({ kind: "case", ...params });
        return CASE_RESULT;
      },
      createQuickCaptureTask: async (params: Record<string, unknown>) => {
        received.push({ kind: "task", ...params });
        return TASK_RESULT;
      },
    }) as unknown as CrmDataProvider;

  it("1/2/4: the Core id reaches the Core provider and the Task id the Task provider", async () => {
    const received: Record<string, unknown>[] = [];
    const caseOperationId = createOperationId();
    const taskOperationId = createOperationId();

    await createQuickCaptureCase(buildDataProvider(received), {
      ...baseInput,
      taskType: "rueckruf",
      operationIds: { caseOperationId, taskOperationId },
    });

    const core = received.find((call) => call.kind === "case");
    const task = received.find((call) => call.kind === "task");
    expect(core?.operationId).toBe(caseOperationId);
    expect(task?.operationId).toBe(taskOperationId);
    // 13: the composite invariant — two distinct, separately addressable ops.
    expect(caseOperationId).not.toBe(taskOperationId);
  });

  it("the Core id never leaks into the Task call", async () => {
    const received: Record<string, unknown>[] = [];
    const caseOperationId = createOperationId();

    await createQuickCaptureCase(buildDataProvider(received), {
      ...baseInput,
      taskType: "rueckruf",
      operationIds: { caseOperationId },
    });

    expect(received.find((c) => c.kind === "case")?.operationId).toBe(
      caseOperationId,
    );
    // No taskOperationId supplied → the Task operation mints its own.
    expect(
      received.find((c) => c.kind === "task")?.operationId,
    ).toBeUndefined();
  });

  it("3: without operationIds the command behaves exactly as before", async () => {
    const received: Record<string, unknown>[] = [];

    const output = await createQuickCaptureCase(buildDataProvider(received), {
      ...baseInput,
      taskType: "rueckruf",
    });

    expect(output).toMatchObject({
      dealId: 3,
      companyId: 1,
      contactId: 2,
      taskId: 9,
      taskFailed: false,
    });
    for (const call of received) {
      expect(call.operationId).toBeUndefined();
    }
  });

  it("9/10: existing success and task-failure semantics are unchanged", async () => {
    const failingProvider = {
      createQuickCaptureCase: async () => CASE_RESULT,
      createQuickCaptureTask: async () => {
        throw new Error("task exploded");
      },
    } as unknown as CrmDataProvider;

    const output = await createQuickCaptureCase(failingProvider, {
      ...baseInput,
      taskType: "rueckruf",
      operationIds: {
        caseOperationId: createOperationId(),
        taskOperationId: createOperationId(),
      },
    });

    // Core committed, task best-effort failed — still a partial, not a throw.
    expect(output.taskFailed).toBe(true);
    expect(output.dealId).toBe(3);
  });

  it("11: a task idempotency conflict still propagates hard, even with explicit ids", async () => {
    const conflictProvider = {
      createQuickCaptureCase: async () => CASE_RESULT,
      createQuickCaptureTask: async () => {
        const error = new Error("conflict") as Error & { details: string };
        error.details = NORA_ERROR_CODES.IDEMPOTENCY_CONFLICT;
        throw error;
      },
    } as unknown as CrmDataProvider;

    await expect(
      createQuickCaptureCase(conflictProvider, {
        ...baseInput,
        taskType: "rueckruf",
        operationIds: {
          caseOperationId: createOperationId(),
          taskOperationId: createOperationId(),
        },
      }),
    ).rejects.toMatchObject({ message: "task_idempotency_conflict" });
  });
});
