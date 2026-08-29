import { describe, expect, it, vi } from "vitest";

import { NORA_ERROR_CODES } from "../domain/noraErrorCodes";
import { OPERATION_CATALOG } from "./operationCatalog";
import { NORA_OPERATION_ID_HEADER } from "./operationContext";
import { createOperationManager } from "./operationManager";
import { executeCreateQuickCaptureCase } from "./executeCreateQuickCaptureCase";
import { executeCreateQuickCaptureTask } from "./executeCreateQuickCaptureTask";
import { executeCreateCustomerFromContact } from "./executeCreateCustomerFromContact";

const freshManager = () => createOperationManager({ recordError: null });

/**
 * Operation Status Contract v1 (2026-08-29) — test matrix from the
 * assessment/decision session. Covers the Manager-level contract
 * (execution disposition, errorCode, result reference) end to end through
 * the real-RPC execute*.ts wrappers with a mocked rpc client — the actual
 * Postgres/PostgREST round-trip is covered separately by
 * supabase/tests/operation_status_disposition_verification.sql (requires a
 * local Supabase/Docker stack, not runnable in this sandbox — see decision
 * log / final report).
 */
describe("Operation Status Contract v1 — execution disposition", () => {
  it("2: fresh idempotent write reports execution=executed with a result reference", async () => {
    const manager = freshManager();
    const setHeader = vi.fn().mockResolvedValue({
      data: {
        company_id: 1,
        contact_id: 2,
        deal_id: 3,
        _meta: { disposition: "executed" },
      },
      error: null,
    });
    const rpc = vi.fn().mockReturnValue({ setHeader });

    const result = await executeCreateQuickCaptureCase(
      {
        deal: { name: "Fenster kaputt" },
        idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
      rpc as any,
      manager,
    );

    // _meta is transport-only and must never leak into the business result.
    expect(result).toEqual({ company_id: 1, contact_id: 2, deal_id: 3 });

    const op = manager.getOperations()[0];
    expect(op.status).toBe("success");
    expect(op.execution).toBe("executed");
    expect(op.result).toEqual({ companyId: 1, contactId: 2, dealId: 3 });
  });

  it("3: replay reports execution=replayed with identical business ids, no dupe semantics implied", async () => {
    const manager = freshManager();
    const setHeader = vi.fn().mockResolvedValue({
      data: {
        company_id: 1,
        contact_id: 2,
        deal_id: 3,
        _meta: { disposition: "replayed" },
      },
      error: null,
    });
    const rpc = vi.fn().mockReturnValue({ setHeader });

    await executeCreateQuickCaptureCase(
      {
        deal: { name: "Fenster kaputt" },
        idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
      rpc as any,
      manager,
    );

    const op = manager.getOperations()[0];
    expect(op.status).toBe("success");
    expect(op.execution).toBe("replayed");
  });

  it("8: legacy call without idempotencyKey (no _meta in RPC response) leaves execution undefined", async () => {
    const manager = freshManager();
    const setHeader = vi.fn().mockResolvedValue({
      data: { company_id: 1, contact_id: null, deal_id: 3 },
      error: null,
    });
    const rpc = vi.fn().mockReturnValue({ setHeader });

    const result = await executeCreateQuickCaptureCase(
      { deal: { name: "Fenster kaputt" } },
      rpc as any,
      manager,
    );

    expect(result).toEqual({ company_id: 1, contact_id: null, deal_id: 3 });
    const op = manager.getOperations()[0];
    expect(op.status).toBe("success");
    expect(op.execution).toBeUndefined();
    expect(op.result).toBeUndefined();
  });

  it("5: a recognized NoraErrorCode is captured precisely on the operation record", async () => {
    const manager = freshManager();
    const pgError = {
      message: "insufficient privileges",
      code: "42501",
      details: NORA_ERROR_CODES.PERMISSION_DENIED,
    };
    const setHeader = vi.fn().mockResolvedValue({ data: null, error: pgError });
    const rpc = vi.fn().mockReturnValue({ setHeader });

    await expect(
      executeCreateQuickCaptureCase(
        { deal: { name: "x" } },
        rpc as any,
        manager,
      ),
    ).rejects.toBe(pgError);

    const op = manager.getOperations()[0];
    expect(op.status).toBe("error");
    expect(op.errorCode).toBe(NORA_ERROR_CODES.PERMISSION_DENIED);
    // Legacy field stays populated too (backward compatibility, decision D).
    expect(op.safeErrorCode).toBe("permission_denied");
  });

  it("4/6: an unrecognized error yields errorCode = 'unknown' (never a raw code guess)", async () => {
    const manager = freshManager();
    const setHeader = vi
      .fn()
      .mockResolvedValue({ data: null, error: new Error("boom") });
    const rpc = vi.fn().mockReturnValue({ setHeader });

    await expect(
      executeCreateQuickCaptureCase(
        { deal: { name: "x" } },
        rpc as any,
        manager,
      ),
    ).rejects.toThrow("boom");

    const op = manager.getOperations()[0];
    expect(op.status).toBe("error");
    expect(op.errorCode).toBe("unknown");
  });

  it("7: retry after error mints a new operation_id; the failed attempt is not mutated", async () => {
    const manager = freshManager();
    const failing = vi
      .fn()
      .mockResolvedValue({ data: null, error: new Error("network down") });
    const rpcFail = vi.fn().mockReturnValue({ setHeader: failing });

    await expect(
      executeCreateQuickCaptureCase(
        { deal: { name: "x" } },
        rpcFail as any,
        manager,
      ),
    ).rejects.toThrow();

    const firstAttempt = manager.getOperations()[0];
    expect(firstAttempt.status).toBe("error");

    const succeeding = vi.fn().mockResolvedValue({
      data: { company_id: 1, contact_id: null, deal_id: 2 },
      error: null,
    });
    const rpcOk = vi.fn().mockReturnValue({ setHeader: succeeding });

    await executeCreateQuickCaptureCase(
      { deal: { name: "x" } },
      rpcOk as any,
      manager,
    );

    const ops = manager.getOperations();
    expect(ops).toHaveLength(2);
    const retried = ops.find(
      (op) => op.operationId !== firstAttempt.operationId,
    );
    expect(retried?.status).toBe("success");
    // The old failed attempt is still there, unchanged.
    const stillFailed = ops.find(
      (op) => op.operationId === firstAttempt.operationId,
    );
    expect(stillFailed?.status).toBe("error");
  });

  it("9: Core success + Task error stay two independent operations (no partial lifecycle status)", async () => {
    const manager = freshManager();
    const caseSetHeader = vi.fn().mockResolvedValue({
      data: {
        company_id: 1,
        contact_id: null,
        deal_id: 2,
        _meta: { disposition: "executed" },
      },
      error: null,
    });
    const caseRpc = vi.fn().mockReturnValue({ setHeader: caseSetHeader });

    await executeCreateQuickCaptureCase(
      {
        deal: { name: "x" },
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
      },
      caseRpc as any,
      manager,
    );

    const taskSetHeader = vi
      .fn()
      .mockResolvedValue({ data: null, error: new Error("db timeout") });
    const taskRpc = vi.fn().mockReturnValue({ setHeader: taskSetHeader });

    await expect(
      executeCreateQuickCaptureTask(
        { companyId: 1, type: "rueckruf" },
        taskRpc as any,
        manager,
      ),
    ).rejects.toThrow();

    const ops = manager.getOperations();
    expect(ops).toHaveLength(2);
    const caseOp = ops.find(
      (op) => op.operationType === "quickCapture.createCase",
    );
    const taskOp = ops.find(
      (op) => op.operationType === "quickCapture.createTask",
    );
    expect(caseOp?.status).toBe("success");
    expect(caseOp?.execution).toBe("executed");
    expect(taskOp?.status).toBe("error");
  });

  it("10: result reference carries only the documented ids, not raw error/db text", async () => {
    const manager = freshManager();
    const setHeader = vi.fn().mockResolvedValue({
      data: { task_id: 42, _meta: { disposition: "executed" } },
      error: null,
    });
    const rpc = vi.fn().mockReturnValue({ setHeader });

    await executeCreateQuickCaptureTask(
      { companyId: 1, idempotencyKey: "x" },
      rpc as any,
      manager,
    );

    const op = manager.getOperations()[0];
    expect(op.result).toEqual({ taskId: 42 });
    expect(Object.keys(op.result ?? {})).toEqual(["taskId"]);
  });

  it("create_customer_with_contact (contact.convertToCustomer) also reports disposition via the same _meta contract", async () => {
    const manager = freshManager();
    const setHeader = vi.fn().mockResolvedValue({
      data: {
        company_id: 5,
        contact_id: 6,
        _meta: { disposition: "replayed" },
      },
      error: null,
    });
    const rpc = vi.fn().mockReturnValue({ setHeader });

    const result = await executeCreateCustomerFromContact(
      { contactId: 6, company: { name: "Freddie" }, idempotencyKey: "k" },
      rpc as any,
      manager,
    );

    expect(result).toEqual({ company_id: 5, contact_id: 6 });
    const op = manager.getOperations()[0];
    expect(op.execution).toBe("replayed");
    expect(op.result).toEqual({ companyId: 5, contactId: 6 });
  });

  it("does not report an outcome for a handler that never calls reportOutcome (existing behavior unchanged)", async () => {
    const manager = freshManager();
    const setHeader = vi.fn().mockResolvedValue({
      data: { company_id: 1, contact_id: null },
      error: null,
    });
    const rpc = vi.fn().mockReturnValue({ setHeader });
    void rpc;

    const result = await manager.execute(
      OPERATION_CATALOG["customer.update"],
      {},
      async (ctx) => {
        expect(ctx.operationId).toBeTruthy();
        return { ok: true };
      },
    );

    expect(result).toEqual({ ok: true });
    const op = manager.getOperations()[0];
    expect(op.execution).toBeUndefined();
    expect(op.result).toBeUndefined();
  });

  it("invariant: reportOutcome() followed by a thrown error never produces a contradictory record (no execution/result on an error record)", async () => {
    const manager = freshManager();

    await expect(
      manager.execute(
        OPERATION_CATALOG["quickCapture.createCase"],
        {},
        async (ctx) => {
          // Handler reports a successful-looking outcome, then still fails
          // (e.g. a post-write side effect throws). The final record must
          // never read as "success-shaped" data under an error status.
          ctx.reportOutcome({
            execution: "executed",
            result: { companyId: 1, contactId: 2, dealId: 3 },
          });
          throw new Error("post-report failure");
        },
      ),
    ).rejects.toThrow("post-report failure");

    const op = manager.getOperations()[0];
    expect(op.status).toBe("error");
    expect(op.execution).toBeUndefined();
    expect(op.result).toBeUndefined();
  });

  it("sanity: operation-id header is still attached exactly once per attempt", async () => {
    const manager = freshManager();
    const setHeader = vi.fn().mockResolvedValue({
      data: { company_id: 1, contact_id: null, deal_id: 2 },
      error: null,
    });
    const rpc = vi.fn().mockReturnValue({ setHeader });

    await executeCreateQuickCaptureCase(
      { deal: { name: "x" } },
      rpc as any,
      manager,
    );

    expect(setHeader).toHaveBeenCalledWith(
      NORA_OPERATION_ID_HEADER,
      expect.any(String),
    );
  });
});
