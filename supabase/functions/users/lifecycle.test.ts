import { describe, expect, it, vi } from "vitest";
import {
  executeAccessChange,
  LifecycleFailure,
  mapAccessRpcError,
  type LifecycleDeps,
  type LifecycleSaleRow,
} from "./lifecycle.ts";
import type { EmployeeAuthFacts } from "./accessState.ts";

const ADMIN_A = "a0000000-0000-4000-8000-00000000000a";
const EMPLOYEE = "a0000000-0000-4000-8000-00000000000e";

const row = (over: Partial<LifecycleSaleRow> = {}): LifecycleSaleRow => ({
  id: 7,
  user_id: EMPLOYEE,
  role: "office",
  disabled: false,
  ...over,
});

const FUTURE = "2036-09-04T10:00:00.000Z";

/**
 * In-memory stand-in for Postgres + GoTrue. Records the call order so the
 * tests can assert that the database is always written before Auth and that
 * a refused request never reaches Auth at all.
 */
function fakeDeps(
  opts: {
    sale?: LifecycleSaleRow;
    dbError?: { code?: string; message?: string; details?: string };
    authFailTimes?: number;
    authFactsMissing?: boolean;
    authStuckBanned?: boolean;
  } = {},
) {
  let sale = opts.sale ?? row();
  let banned = false;
  let authFails = opts.authFailTimes ?? 0;
  const calls: string[] = [];
  const logs: Record<string, unknown>[] = [];

  const deps: LifecycleDeps = {
    applyAccessChange: vi.fn(async ({ role, disabled }) => {
      calls.push("db");
      if (opts.dbError) throw opts.dbError;
      sale = {
        ...sale,
        role: role ?? sale.role,
        disabled: disabled ?? sale.disabled,
      };
      return sale;
    }),
    setAuthBan: vi.fn(async (_userId, wantBanned) => {
      calls.push(`auth:${wantBanned ? "ban" : "unban"}`);
      if (authFails > 0) {
        authFails -= 1;
        throw new Error("auth down");
      }
      banned = wantBanned;
    }),
    readSale: vi.fn(async () => {
      calls.push("verify:db");
      return sale;
    }),
    readAuthFacts: vi.fn(async (): Promise<EmployeeAuthFacts | null> => {
      calls.push("verify:auth");
      if (opts.authFactsMissing) return null;
      const isBanned = opts.authStuckBanned ? true : banned;
      return {
        banned_until: isBanned ? FUTURE : null,
        email_confirmed_at: "2026-09-01T00:00:00.000Z",
      };
    }),
    log: (entry) => {
      logs.push(entry);
    },
  };

  return {
    deps,
    calls,
    logs,
    get sale() {
      return sale;
    },
    get banned() {
      return banned;
    },
  };
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof LifecycleFailure) return error.failure;
    throw error;
  }
  throw new Error("expected LifecycleFailure");
}

describe("executeAccessChange — order and single path", () => {
  it("role-only change writes the database and never calls Auth Admin", async () => {
    const f = fakeDeps();
    const result = await executeAccessChange(f.deps, {
      actorUserId: ADMIN_A,
      target: row(),
      role: "admin",
    });
    expect(result.sale.role).toBe("admin");
    expect(result.accessConsistency).toBe("consistent");
    expect(f.calls).toEqual(["db", "verify:db", "verify:auth"]);
  });

  it("disable writes the database first, then bans, then verifies both sides", async () => {
    const f = fakeDeps();
    const result = await executeAccessChange(f.deps, {
      actorUserId: ADMIN_A,
      target: row(),
      disabled: true,
    });
    expect(f.calls).toEqual(["db", "auth:ban", "verify:db", "verify:auth"]);
    expect(f.sale.disabled).toBe(true);
    expect(f.banned).toBe(true);
    expect(result.accessConsistency).toBe("consistent");
  });

  it("re-enable unbans after the database write and verifies", async () => {
    const f = fakeDeps({ sale: row({ disabled: true }) });
    // Simulate an identity that is currently banned.
    await f.deps.setAuthBan(EMPLOYEE, true);
    f.calls.length = 0;

    const result = await executeAccessChange(f.deps, {
      actorUserId: ADMIN_A,
      target: row({ disabled: true }),
      disabled: false,
    });
    expect(f.calls).toEqual(["db", "auth:unban", "verify:db", "verify:auth"]);
    expect(f.sale.disabled).toBe(false);
    expect(f.banned).toBe(false);
    expect(result.accessConsistency).toBe("consistent");
  });

  it("invite-as-disabled uses the same path: role + disabled in one request", async () => {
    const f = fakeDeps({ sale: row({ role: "viewer" }) });
    const result = await executeAccessChange(f.deps, {
      actorUserId: ADMIN_A,
      target: row({ role: "viewer" }),
      role: "office",
      disabled: true,
    });
    expect(f.calls).toEqual(["db", "auth:ban", "verify:db", "verify:auth"]);
    expect(result.sale).toMatchObject({ role: "office", disabled: true });
    expect(result.accessConsistency).toBe("consistent");
  });

  it("rejects an empty change without touching anything", async () => {
    const f = fakeDeps();
    const failure = await failureOf(
      executeAccessChange(f.deps, { actorUserId: ADMIN_A, target: row() }),
    );
    expect(failure).toMatchObject({ status: 400, error: "invalid_payload" });
    expect(f.calls).toEqual([]);
  });
});

describe("executeAccessChange — guards", () => {
  it("refuses a self change at the edge before any write", async () => {
    const f = fakeDeps({ sale: row({ user_id: ADMIN_A, role: "admin" }) });
    const failure = await failureOf(
      executeAccessChange(f.deps, {
        actorUserId: ADMIN_A,
        target: row({ user_id: ADMIN_A, role: "admin" }),
        disabled: true,
      }),
    );
    expect(failure).toMatchObject({
      status: 403,
      error: "self_access_change_forbidden",
    });
    expect(f.calls).toEqual([]);
  });

  it("maps the database self guard and never reaches Auth", async () => {
    const f = fakeDeps({
      dbError: {
        code: "42501",
        message: "administrators cannot change their own role or access",
        details: "NORA_SELF_ACCESS_CHANGE_FORBIDDEN",
      },
    });
    const failure = await failureOf(
      executeAccessChange(f.deps, {
        actorUserId: ADMIN_A,
        target: row(),
        disabled: true,
      }),
    );
    expect(failure).toMatchObject({
      status: 403,
      error: "self_access_change_forbidden",
    });
    expect(f.calls).toEqual(["db"]);
  });

  it("maps the last-admin invariant to 409 and never reaches Auth", async () => {
    const f = fakeDeps({
      dbError: {
        code: "23514",
        message: "at least one active administrator must remain",
        details: "NORA_LAST_ACTIVE_ADMIN_REQUIRED",
      },
    });
    const failure = await failureOf(
      executeAccessChange(f.deps, {
        actorUserId: ADMIN_A,
        target: row({ role: "admin" }),
        disabled: true,
      }),
    );
    expect(failure).toMatchObject({
      status: 409,
      error: "last_active_admin_required",
    });
    expect(f.calls).toEqual(["db"]);
    expect(f.banned).toBe(false);
  });

  it("maps a refused actor to 403 without exposing the SQL message", async () => {
    const f = fakeDeps({
      dbError: {
        code: "42501",
        message: "forbidden",
        details: "NORA_PERMISSION_DENIED",
      },
    });
    const failure = await failureOf(
      executeAccessChange(f.deps, {
        actorUserId: ADMIN_A,
        target: row(),
        role: "admin",
      }),
    );
    expect(failure).toMatchObject({
      status: 403,
      error: "role_update_forbidden",
    });
    expect(failure.message).not.toMatch(/sql|postgres|42501/i);
  });

  it("maps invalid role and not-found from the database", async () => {
    expect(
      mapAccessRpcError({ code: "22023", message: "invalid role: boss" }),
    ).toMatchObject({ status: 400, error: "invalid_role" });
    expect(
      mapAccessRpcError({
        code: "P0002",
        message: "sales profile not found: 9",
      }),
    ).toMatchObject({ status: 404, error: "not_found" });
    expect(mapAccessRpcError({ code: "XX000", message: "boom" })).toMatchObject(
      {
        status: 500,
        error: "internal_error",
      },
    );
  });

  it("prefers the canonical DETAIL code over SQLSTATE heuristics", () => {
    expect(
      mapAccessRpcError({
        code: "42501",
        message: "forbidden",
        details: "NORA_SELF_ACCESS_CHANGE_FORBIDDEN",
      }).error,
    ).toBe("self_access_change_forbidden");
  });
});

describe("executeAccessChange — partial failure and retry", () => {
  it("reports sync_incomplete when Auth fails after the database succeeded", async () => {
    const f = fakeDeps({ authFailTimes: 1 });
    const failure = await failureOf(
      executeAccessChange(f.deps, {
        actorUserId: ADMIN_A,
        target: row(),
        disabled: true,
      }),
    );
    expect(failure).toMatchObject({
      status: 500,
      error: "employee_access_sync_incomplete",
      accessConsistency: "inconsistent",
    });
    // Fail-safe direction: Nora access is already denied by sales.disabled.
    expect(f.sale.disabled).toBe(true);
    expect(f.banned).toBe(false);
    expect(f.logs.some((l) => l.stage === "auth_admin")).toBe(true);
    expect(f.logs.some((l) => l.stage === "verify")).toBe(true);
  });

  it("a retry of the same request converges to a consistent state", async () => {
    const f = fakeDeps({ authFailTimes: 1 });
    await failureOf(
      executeAccessChange(f.deps, {
        actorUserId: ADMIN_A,
        target: row(),
        disabled: true,
      }),
    );
    f.calls.length = 0;

    const result = await executeAccessChange(f.deps, {
      actorUserId: ADMIN_A,
      target: f.sale,
      disabled: true,
    });
    expect(f.calls).toEqual(["db", "auth:ban", "verify:db", "verify:auth"]);
    expect(result.accessConsistency).toBe("consistent");
    expect(f.banned).toBe(true);
  });

  it("does not report success when verification still disagrees after an accepted Auth call", async () => {
    const f = fakeDeps({ authStuckBanned: true });
    const failure = await failureOf(
      executeAccessChange(f.deps, {
        actorUserId: ADMIN_A,
        target: row({ disabled: true }),
        disabled: false,
      }),
    );
    expect(failure).toMatchObject({
      error: "employee_access_sync_incomplete",
      accessConsistency: "inconsistent",
    });
  });

  it("does not report success when the Auth side cannot be verified at all", async () => {
    const f = fakeDeps({ authFactsMissing: true });
    const failure = await failureOf(
      executeAccessChange(f.deps, {
        actorUserId: ADMIN_A,
        target: row(),
        disabled: true,
      }),
    );
    expect(failure).toMatchObject({
      error: "employee_access_sync_incomplete",
      accessConsistency: "unknown",
    });
  });

  it("a role-only change is not blocked by an unverifiable Auth side", async () => {
    const f = fakeDeps({ authFactsMissing: true });
    const result = await executeAccessChange(f.deps, {
      actorUserId: ADMIN_A,
      target: row(),
      role: "viewer",
    });
    expect(result.sale.role).toBe("viewer");
    expect(result.accessConsistency).toBe("unknown");
    expect(f.calls).not.toContain("auth:ban");
  });

  it("a database failure leaves Auth untouched", async () => {
    const f = fakeDeps({ dbError: { code: "XX000", message: "boom" } });
    await failureOf(
      executeAccessChange(f.deps, {
        actorUserId: ADMIN_A,
        target: row(),
        disabled: true,
      }),
    );
    expect(f.calls).toEqual(["db"]);
    expect(f.banned).toBe(false);
  });
});
