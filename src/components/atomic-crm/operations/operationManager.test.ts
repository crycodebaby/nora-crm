import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OPERATION_CATALOG } from "./operationCatalog";
import { NORA_OPERATION_ID_HEADER } from "./operationContext";
import { executeDealUpdate } from "./executeDealUpdate";
import {
  createOperationManager,
  getDefaultOperationManager,
  resetDefaultOperationManagerForTests,
  setDefaultOperationManager,
  type OperationManager,
} from "./operationManager";
import { OPERATION_RETENTION } from "./operationModel";
import { withOperationIdParams } from "./operationTransport";

describe("OperationManager without React", () => {
  afterEach(() => {
    resetDefaultOperationManagerForTests();
    vi.useRealTimers();
  });

  it("default manager execute works fully without OperationProvider", async () => {
    const manager = getDefaultOperationManager();
    expect(getDefaultOperationManager()).toBe(manager);

    const result = await manager.execute(
      OPERATION_CATALOG["deal.update"],
      { resourceId: 1 },
      async (ctx) => ({ ok: true, id: ctx.operationId }),
    );
    expect(result.ok).toBe(true);
    const op = manager.getOperation(result.id);
    expect(op?.status).toBe("success");
    expect(op?.finishedAt).toBeTruthy();
  });

  it("getDefaultOperationManager always returns the same singleton", () => {
    const a = getDefaultOperationManager();
    const b = getDefaultOperationManager();
    expect(a).toBe(b);
  });

  it("Provider/dataProvider share the same default manager instance", async () => {
    const shared = getDefaultOperationManager();
    // Simulate Provider binding (production path uses getDefault, not create).
    setDefaultOperationManager(shared);
    expect(getDefaultOperationManager()).toBe(shared);

    await executeDealUpdate(
      {
        id: 3,
        data: { name: "x" },
        previousData: { id: 3 },
      },
      async () => ({ data: { id: 3 } }),
      getDefaultOperationManager(),
    );

    expect(shared.getOperations()).toHaveLength(1);
    expect(shared.getOperations()[0].status).toBe("success");
  });
});

describe("OperationManager lifecycle", () => {
  let manager: OperationManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = createOperationManager({
      successTtlMs: 1_000,
      errorTtlMs: 2_000,
      maxOperations: 5,
    });
  });

  afterEach(() => {
    manager.resetForTests();
    vi.useRealTimers();
  });

  it("A: execute starts pending", async () => {
    let release!: (value: string) => void;
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });

    const run = manager.execute(
      OPERATION_CATALOG["deal.update"],
      { resourceId: 1 },
      async () => gate,
    );

    const pending = manager.getOperations();
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe("pending");

    release("ok");
    await run;
  });

  it("B: successful promise → success", async () => {
    const result = await manager.execute(
      OPERATION_CATALOG["deal.update"],
      { resourceId: 9 },
      async () => ({ saved: true }),
    );
    expect(result).toEqual({ saved: true });
    expect(manager.getOperations()[0].status).toBe("success");
    expect(manager.getOperations()[0].finishedAt).toBeTruthy();
  });

  it("C: failed promise → error with runtimeErrorId only", async () => {
    await expect(
      manager.execute(
        OPERATION_CATALOG["deal.update"],
        { resourceId: 9 },
        async () => {
          throw { status: 403, message: "permission denied" };
        },
      ),
    ).rejects.toMatchObject({ status: 403 });

    const op = manager.getOperations()[0];
    expect(op.status).toBe("error");
    expect(op.safeErrorCode).toBe("permission_denied");
    expect(op.runtimeErrorId).toBeTruthy();
    expect(op).not.toHaveProperty("errorId");
  });

  it("D: operationId stays identical through the handler", async () => {
    let seen: string | undefined;
    await manager.execute(
      OPERATION_CATALOG["deal.update"],
      { resourceId: 3 },
      async (ctx) => {
        seen = ctx.operationId;
        return true;
      },
    );
    expect(manager.getOperations()[0].operationId).toBe(seen);
  });

  it("E: two parallel operations stay separate", async () => {
    let releaseA!: () => void;
    let releaseB!: () => void;
    const gateA = new Promise<void>((r) => {
      releaseA = r;
    });
    const gateB = new Promise<void>((r) => {
      releaseB = r;
    });

    const runA = manager.execute(
      OPERATION_CATALOG["deal.update"],
      { resourceId: 1 },
      async (ctx) => {
        await gateA;
        return ctx.operationId;
      },
    );
    const runB = manager.execute(
      OPERATION_CATALOG["deal.update"],
      { resourceId: 2 },
      async (ctx) => {
        await gateB;
        return ctx.operationId;
      },
    );

    expect(manager.getOperations()).toHaveLength(2);
    releaseA();
    releaseB();
    const [idA, idB] = await Promise.all([runA, runB]);
    expect(idA).not.toBe(idB);
  });

  it("F/G: valid id reused; invalid id soft-replaced", async () => {
    const owned = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    await manager.execute(
      OPERATION_CATALOG["deal.update"],
      { resourceId: 1, operationId: owned },
      async (ctx) => {
        expect(ctx.operationId).toBe(owned);
        return true;
      },
    );
    await manager.execute(
      OPERATION_CATALOG["deal.update"],
      { resourceId: 2, operationId: "not-a-uuid" },
      async (ctx) => {
        expect(ctx.operationId).not.toBe("not-a-uuid");
        return true;
      },
    );
  });

  it("H/I: result returned; original exception rethrown after error mark", async () => {
    expect(
      await manager.execute(
        OPERATION_CATALOG["deal.update"],
        {},
        async () => 42,
      ),
    ).toBe(42);

    manager.resetForTests();

    const boom = new Error("save failed");
    await expect(
      manager.execute(OPERATION_CATALOG["deal.update"], {}, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(manager.getOperations()).toHaveLength(1);
    expect(manager.getOperations()[0].status).toBe("error");
    expect(manager.getOperations()[0].finishedAt).toBeTruthy();
  });

  it("J: pending never auto-cleaned", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const run = manager.execute(
      OPERATION_CATALOG["deal.update"],
      { resourceId: 1 },
      async () => {
        await gate;
        return true;
      },
    );

    vi.advanceTimersByTime(60_000);
    expect(manager.getOperations()[0].status).toBe("pending");
    release();
    await run;
  });

  it("M: double execute yields two independent operations", async () => {
    const first = await manager.execute(
      OPERATION_CATALOG["deal.update"],
      { resourceId: 7 },
      async (ctx) => ctx.operationId,
    );
    const second = await manager.execute(
      OPERATION_CATALOG["deal.update"],
      { resourceId: 7 },
      async (ctx) => ctx.operationId,
    );
    expect(first).not.toBe(second);
  });
});

describe("useSyncExternalStore contract", () => {
  let manager: OperationManager;

  beforeEach(() => {
    manager = createOperationManager({ successTtlMs: 5_000 });
  });

  afterEach(() => {
    manager.resetForTests();
  });

  it("snapshot reference is stable while state unchanged", () => {
    const a = manager.getSnapshot();
    const b = manager.getSnapshot();
    expect(a).toBe(b);
    expect(a).toBe(manager.getOperations());
  });

  it("snapshot identity changes only on real state change", async () => {
    const before = manager.getSnapshot();
    await manager.execute(
      OPERATION_CATALOG["deal.update"],
      {},
      async () => true,
    );
    const after = manager.getSnapshot();
    expect(after).not.toBe(before);
    expect(manager.getSnapshot()).toBe(after);
  });

  it("unsubscribe stops notifications", async () => {
    const listener = vi.fn();
    const unsubscribe = manager.subscribe(listener);
    unsubscribe();
    await manager.execute(
      OPERATION_CATALOG["deal.update"],
      {},
      async () => true,
    );
    expect(listener).not.toHaveBeenCalled();
  });

  it("subscribe receives notifications for each state transition", async () => {
    const listener = vi.fn();
    const unsubscribe = manager.subscribe(listener);
    await manager.execute(
      OPERATION_CATALOG["deal.update"],
      {},
      async () => true,
    );
    // pending + success
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);
    unsubscribe();
  });
});

describe("Timer / cleanup", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses documented default TTLs", () => {
    expect(OPERATION_RETENTION.successTtlMs).toBe(8_000);
    expect(OPERATION_RETENTION.errorTtlMs).toBe(60_000);
    expect(OPERATION_RETENTION.maxOperations).toBe(50);
  });

  it("success removed after TTL; error after longer TTL; pending kept", async () => {
    vi.useFakeTimers();
    const manager = createOperationManager({
      successTtlMs: 1_000,
      errorTtlMs: 2_000,
      maxOperations: 10,
    });

    await manager.execute(
      OPERATION_CATALOG["deal.update"],
      { resourceId: 1 },
      async () => true,
    );
    vi.advanceTimersByTime(999);
    expect(manager.getOperations()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(manager.getOperations()).toHaveLength(0);

    await expect(
      manager.execute(
        OPERATION_CATALOG["deal.update"],
        { resourceId: 2 },
        async () => {
          throw new Error("x");
        },
      ),
    ).rejects.toThrow();
    vi.advanceTimersByTime(1_999);
    expect(manager.getOperations()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(manager.getOperations()).toHaveLength(0);

    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const pendingRun = manager.execute(
      OPERATION_CATALOG["deal.update"],
      { resourceId: 3 },
      async () => {
        await gate;
        return true;
      },
    );
    vi.advanceTimersByTime(60_000);
    expect(manager.getOperations()[0].status).toBe("pending");
    release();
    await pendingRun;
    manager.resetForTests();
  });

  it("timer of already-removed op does not throw", async () => {
    vi.useFakeTimers();
    const manager = createOperationManager({
      successTtlMs: 1_000,
      maxOperations: 10,
    });
    await manager.execute(
      OPERATION_CATALOG["deal.update"],
      {},
      async () => true,
    );
    manager.resetForTests();
    expect(() => vi.advanceTimersByTime(5_000)).not.toThrow();
  });

  it("parallel timers do not interfere", async () => {
    vi.useFakeTimers();
    const manager = createOperationManager({
      successTtlMs: 1_000,
      errorTtlMs: 3_000,
      maxOperations: 10,
    });

    await manager.execute(
      OPERATION_CATALOG["deal.update"],
      { resourceId: 1 },
      async () => true,
    );
    await expect(
      manager.execute(
        OPERATION_CATALOG["deal.update"],
        { resourceId: 2 },
        async () => {
          throw new Error("e");
        },
      ),
    ).rejects.toThrow();

    vi.advanceTimersByTime(1_000);
    const remaining = manager.getOperations();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].status).toBe("error");
    vi.advanceTimersByTime(2_000);
    expect(manager.getOperations()).toHaveLength(0);
    manager.resetForTests();
  });

  it("finished overflow evicts oldest finished, never pending", async () => {
    vi.useFakeTimers();
    const manager = createOperationManager({
      successTtlMs: 60_000,
      maxOperations: 3,
    });

    // Hold a pending slot
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const pendingRun = manager.execute(
      OPERATION_CATALOG["deal.update"],
      { resourceId: "pending" },
      async () => {
        await gate;
        return true;
      },
    );

    await manager.execute(
      OPERATION_CATALOG["deal.update"],
      { resourceId: "s1" },
      async () => true,
    );
    await manager.execute(
      OPERATION_CATALOG["deal.update"],
      { resourceId: "s2" },
      async () => true,
    );
    // size = 3 (1 pending + 2 success). Next success must evict oldest finished.
    await manager.execute(
      OPERATION_CATALOG["deal.update"],
      { resourceId: "s3" },
      async () => true,
    );

    const ops = manager.getOperations();
    expect(ops.length).toBeLessThanOrEqual(3);
    expect(ops.some((op) => op.resourceId === "pending")).toBe(true);
    expect(ops.every((op) => op.resourceId !== "s1")).toBe(true);

    release();
    await pendingRun;
    manager.resetForTests();
  });
});

describe("deal.update vertical slice", () => {
  afterEach(() => {
    resetDefaultOperationManagerForTests();
  });

  it("K: Manager operationId = Wave-1 x-nora-operation-id (single mutation)", async () => {
    const manager = createOperationManager();
    const update = vi.fn(
      async (
        _resource: string,
        _params: { meta?: { headers?: Record<string, string> } },
      ) => ({ data: { id: 15 } }),
    );

    await executeDealUpdate(
      {
        id: 15,
        data: { expected_closing_date: "2026-08-20" },
        previousData: { id: 15 },
      },
      update,
      manager,
    );

    expect(update).toHaveBeenCalledTimes(1);
    expect(manager.getOperations()).toHaveLength(1);
    const opId = manager.getOperations()[0].operationId;
    expect(
      update.mock.calls[0][1].meta?.headers?.[NORA_OPERATION_ID_HEADER],
    ).toBe(opId);
  });

  it("success path: exactly one managed deal.update and one mutation", async () => {
    const manager = createOperationManager();
    const update = vi.fn(async () => ({
      data: { id: 15, expected_closing_date: "2026-09-01" },
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

    expect(update).toHaveBeenCalledTimes(1);
    expect(manager.getOperations()).toHaveLength(1);
    expect(manager.getOperations()[0].status).toBe("success");
    expect(manager.getOperations()[0].operationType).toBe("deal.update");
  });

  it("error path: pending→error and original reject propagates for RA", async () => {
    const manager = createOperationManager();
    const serverError = { status: 500, message: "boom" };
    const update = vi.fn(async () => {
      throw serverError;
    });

    await expect(
      executeDealUpdate(
        {
          id: 15,
          data: { expected_closing_date: "2026-09-01" },
          previousData: { id: 15 },
        },
        update,
        manager,
      ),
    ).rejects.toBe(serverError);

    expect(update).toHaveBeenCalledTimes(1);
    expect(manager.getOperations()[0].status).toBe("error");
    expect(manager.getOperations()[0].runtimeErrorId).toBeTruthy();
  });

  it("L: Kontakttermin field forwarded; existing header not reminted", async () => {
    const manager = createOperationManager();
    const update = vi.fn(
      async (
        _resource: string,
        params: {
          data: unknown;
          meta?: { headers?: Record<string, string> };
        },
      ) => ({ data: params.data }),
    );

    await executeDealUpdate(
      {
        id: 15,
        data: { expected_closing_date: "2026-09-01", description: "x" },
        previousData: { id: 15 },
      },
      update,
      manager,
    );

    expect(update.mock.calls[0][1].data).toMatchObject({
      expected_closing_date: "2026-09-01",
    });

    const owned = "11111111-2222-4333-8444-555555555555";
    const params = withOperationIdParams(
      { id: 1, data: { name: "a" }, previousData: { id: 1 } },
      {
        operationId: owned,
        operationType: "deal.update",
        resourceType: "deals",
        resourceId: 1,
        startedAt: new Date().toISOString(),
      },
    );
    expect(params.meta.headers[NORA_OPERATION_ID_HEADER]).toBe(owned);
  });
});
