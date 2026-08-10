import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildTechnicalContext,
  createSupabaseOperationErrorRecorder,
  recordOperationErrorBestEffort,
  setDefaultOperationErrorRecorder,
  TECHNICAL_CONTEXT_ALLOWLIST,
  type OperationErrorPersistInput,
  type OperationErrorPersistResult,
} from "./errorObservatory";
import { OPERATION_CATALOG } from "./operationCatalog";
import { executeDealUpdate } from "./executeDealUpdate";
import {
  createOperationManager,
  resetDefaultOperationManagerForTests,
} from "./operationManager";

describe("Error Observatory client", () => {
  afterEach(() => {
    setDefaultOperationErrorRecorder(null);
    resetDefaultOperationManagerForTests();
  });

  it("buildTechnicalContext only allowlists safe keys", () => {
    const ctx = buildTechnicalContext({
      status: 403,
      code: "PGRST301",
      message: "JWT Bearer secret password customer free text",
      details: "SQLSTATE 42501",
    });
    expect(Object.keys(ctx).sort()).toEqual(
      expect.arrayContaining(["http_status", "postgrest_code"]),
    );
    for (const key of Object.keys(ctx)) {
      expect(TECHNICAL_CONTEXT_ALLOWLIST).toContain(key);
    }
    expect(ctx).not.toHaveProperty("message");
    expect(JSON.stringify(ctx)).not.toMatch(/Bearer|password|JWT/i);
  });

  it("A: deal.update success → no Error Record", async () => {
    const recordError = vi.fn<
      (
        input: OperationErrorPersistInput,
      ) => Promise<OperationErrorPersistResult>
    >(async () => ({
      errorId: "should-not-call",
      publicRef: "NORA-E00000000",
    }));
    const manager = createOperationManager({ recordError });

    await executeDealUpdate(
      {
        id: 1,
        data: { name: "ok" },
        previousData: { id: 1 },
      },
      async () => ({ data: { id: 1 } }),
      manager,
    );

    expect(recordError).not.toHaveBeenCalled();
    expect(manager.getOperations()[0].status).toBe("success");
    expect(manager.getOperations()[0].persistentErrorId).toBeUndefined();
  });

  it("B/C: deal.update failure → record attempted; persistent ids attached", async () => {
    const recordError = vi.fn<
      (
        input: OperationErrorPersistInput,
      ) => Promise<OperationErrorPersistResult>
    >(async () => ({
      errorId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      publicRef: "NORA-E7K4M2PD",
    }));
    const manager = createOperationManager({ recordError });
    const serverError = { status: 403, message: "permission denied" };

    await expect(
      executeDealUpdate(
        {
          id: 9,
          data: { expected_closing_date: "2026-09-01" },
          previousData: { id: 9 },
        },
        async () => {
          throw serverError;
        },
        manager,
      ),
    ).rejects.toBe(serverError);

    // Error status is set immediately; Observatory enrichment is async.
    expect(manager.getOperations()[0].status).toBe("error");
    expect(manager.getOperations()[0].runtimeErrorId).toBeTruthy();

    await expect.poll(() => recordError.mock.calls.length).toBe(1);
    const recorded = recordError.mock.calls[0]?.[0];
    expect(recorded?.operationType).toBe("deal.update");
    expect(recorded?.operationId).toBe(manager.getOperations()[0].operationId);

    await expect
      .poll(
        () =>
          manager.getOperations()[0].persistentErrorId ===
          "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      )
      .toBe(true);
    expect(manager.getOperations()[0].publicErrorRef).toBe("NORA-E7K4M2PD");
  });

  it("D: Error Record failure keeps original exception + runtimeErrorId", async () => {
    const recordError = vi.fn<
      (
        input: OperationErrorPersistInput,
      ) => Promise<OperationErrorPersistResult>
    >(async () => {
      throw new Error("observatory down");
    });
    const manager = createOperationManager({ recordError });
    const serverError = { status: 500, code: "XX000", message: "boom" };

    await expect(
      manager.execute(
        OPERATION_CATALOG["deal.update"],
        { resourceId: 3 },
        async () => {
          throw serverError;
        },
      ),
    ).rejects.toBe(serverError);

    const op = manager.getOperations()[0];
    expect(op.status).toBe("error");
    expect(op.runtimeErrorId).toBeTruthy();
    expect(op.persistentErrorId).toBeUndefined();
    expect(op.publicErrorRef).toBeUndefined();
  });

  it("D2: hung recorder does not block business exception propagation", async () => {
    let resolveRecord!: (value: OperationErrorPersistResult) => void;
    const recordError = vi.fn(
      () =>
        new Promise<OperationErrorPersistResult>((resolve) => {
          resolveRecord = resolve;
        }),
    );
    const manager = createOperationManager({ recordError });
    const serverError = { status: 503, message: "upstream" };

    const rejected = await manager
      .execute(OPERATION_CATALOG["deal.update"], { resourceId: 8 }, async () => {
        throw serverError;
      })
      .then(
        () => null,
        (err) => err,
      );

    // Business failure must surface without waiting for Observatory RPC.
    expect(rejected).toBe(serverError);
    expect(manager.getOperations()[0].status).toBe("error");
    expect(manager.getOperations()[0].persistentErrorId).toBeUndefined();

    resolveRecord({
      errorId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      publicRef: "NORA-EHUNGWAIT",
    });
    await expect
      .poll(
        () =>
          manager.getOperations()[0].publicErrorRef === "NORA-EHUNGWAIT",
      )
      .toBe(true);
  });

  it("E/F: operationId preserved; runtime vs persistent stay distinct", async () => {
    const owned = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const recordError = vi.fn<
      (
        input: OperationErrorPersistInput,
      ) => Promise<OperationErrorPersistResult>
    >(async () => ({
      errorId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      publicRef: "NORA-EAAAAAAAA",
    }));
    const manager = createOperationManager({ recordError });

    await expect(
      manager.execute(
        OPERATION_CATALOG["deal.update"],
        { resourceId: 1, operationId: owned },
        async () => {
          throw { status: 404, message: "not found" };
        },
      ),
    ).rejects.toBeTruthy();

    const op = manager.getOperations()[0];
    expect(op.operationId).toBe(owned);
    await expect.poll(() => recordError.mock.calls.length).toBe(1);
    expect(recordError.mock.calls[0]?.[0]?.operationId).toBe(owned);
    expect(op.runtimeErrorId).toBeTruthy();
    await expect
      .poll(
        () =>
          manager.getOperations()[0].persistentErrorId ===
          "ffffffff-ffff-4fff-8fff-ffffffffffff",
      )
      .toBe(true);
    expect(manager.getOperations()[0].runtimeErrorId).not.toBe(
      manager.getOperations()[0].persistentErrorId,
    );
    expect(manager.getOperations()[0].runtimeErrorId).not.toBe(
      manager.getOperations()[0].publicErrorRef,
    );
  });

  it("G: React Admin error flow — original reject identity preserved", async () => {
    const manager = createOperationManager({
      recordError: async () => ({
        errorId: "11111111-1111-4111-8111-111111111111",
        publicRef: "NORA-E11111111",
      }),
    });
    const raError = Object.assign(new Error("ra.notification.http_error"), {
      status: 502,
    });

    await expect(
      executeDealUpdate(
        { id: 2, data: { name: "x" }, previousData: { id: 2 } },
        async () => {
          throw raError;
        },
        manager,
      ),
    ).rejects.toBe(raError);
  });

  it("H: Kontakttermin save path still forwards field on success", async () => {
    const manager = createOperationManager({ recordError: null });
    const update = vi.fn(async (_r: string, params: { data: unknown }) => ({
      data: params.data,
    }));

    await executeDealUpdate(
      {
        id: 15,
        data: { expected_closing_date: "2026-09-01" },
        previousData: { id: 15 },
      },
      update,
      manager,
    );

    expect(update.mock.calls[0][1].data).toMatchObject({
      expected_closing_date: "2026-09-01",
    });
  });

  it("bestEffort returns null when recorder missing", async () => {
    setDefaultOperationErrorRecorder(null);
    await expect(
      recordOperationErrorBestEffort({
        operationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        operationType: "deal.update",
        resourceType: "deals",
      }),
    ).resolves.toBeNull();
  });

  it("supabase recorder maps RPC payload and soft-fails", async () => {
    const rpc = vi.fn(
      async (_fn: string, _args?: Record<string, unknown>) => ({
        data: {
          error_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          public_ref: "NORA-EABCDEFGH",
        },
        error: null,
      }),
    );
    const recorder = createSupabaseOperationErrorRecorder(() => ({ rpc }));
    const result = await recorder({
      operationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      operationType: "deal.update",
      resourceType: "deals",
      resourceId: 7,
      safeErrorCode: "network",
      error: { status: 0, message: "Failed to fetch" },
    });
    expect(result).toEqual({
      errorId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      publicRef: "NORA-EABCDEFGH",
    });
    expect(rpc).toHaveBeenCalledWith(
      "record_operation_error",
      expect.objectContaining({
        p_operation_type: "deal.update",
        p_resource_type: "deals",
        p_resource_id: "7",
        p_source: "frontend",
      }),
    );
    const rpcArgs = rpc.mock.calls[0]?.[1];
    expect(rpcArgs?.p_technical_context).not.toHaveProperty("message");

    const failing = createSupabaseOperationErrorRecorder(() => ({
      rpc: async () => ({ data: null, error: { message: "down" } }),
    }));
    await expect(
      failing({
        operationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        operationType: "deal.update",
        resourceType: "deals",
      }),
    ).resolves.toBeNull();
  });
});
