import { describe, expect, it, vi } from "vitest";
import {
  executeOffboarding,
  OffboardingFailure,
  toDependencyPreview,
  type OffboardingDeps,
  type OffboardRpcResult,
} from "./offboarding.ts";
import type { LifecycleSaleRow } from "./lifecycle.ts";
import type { EmployeeAuthFacts } from "./accessState.ts";

const ADMIN_A = "a0000000-0000-4000-8000-00000000000a";
const EMPLOYEE = "a0000000-0000-4000-8000-00000000000e";
const FUTURE = "2036-09-06T10:00:00.000Z";

const row = (over: Partial<LifecycleSaleRow> = {}): LifecycleSaleRow => ({
  id: 7,
  user_id: EMPLOYEE,
  role: "office",
  disabled: false,
  ...over,
});

const RAW_DEPS = {
  companies: 2,
  contacts: 3,
  open_deals: 1,
  open_tasks: 5,
  contact_notes: 9,
  deal_notes: 4,
};

/**
 * In-memory stand-in for Postgres + GoTrue. Records the call order so the
 * tests can assert that the database runs first and that a refused request
 * never reaches Auth.
 */
function fakeDeps(
  opts: {
    sale?: LifecycleSaleRow;
    dbError?: { code?: string; message?: string; details?: string };
    authFails?: boolean;
    authFactsMissing?: boolean;
    authStuckUnbanned?: boolean;
    sessions?: number;
  } = {},
) {
  let sale = opts.sale ?? row();
  let banned = false;
  let sessions = opts.sessions ?? 2;
  const calls: string[] = [];
  const logs: Record<string, unknown>[] = [];

  const deps: OffboardingDeps = {
    offboard: vi.fn(async (): Promise<OffboardRpcResult> => {
      calls.push("db");
      if (opts.dbError) throw opts.dbError;
      const wasDisabled = sale.disabled;
      const revoked = sessions;
      sessions = 0;
      sale = { ...sale, disabled: true };
      return {
        ...sale,
        disposition: !wasDisabled || revoked > 0 ? "executed" : "replayed",
        sessions_revoked: revoked,
        dependencies: RAW_DEPS,
      };
    }),
    setAuthBan: vi.fn(async (_userId, wantBanned) => {
      calls.push(`auth:${wantBanned ? "ban" : "unban"}`);
      if (opts.authFails) throw new Error("auth down");
      banned = wantBanned;
    }),
    readSale: vi.fn(async () => {
      calls.push("verify:db");
      return sale;
    }),
    readAuthFacts: vi.fn(async (): Promise<EmployeeAuthFacts | null> => {
      calls.push("verify:auth");
      if (opts.authFactsMissing) return null;
      const isBanned = opts.authStuckUnbanned ? false : banned;
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

const request = (over: Partial<LifecycleSaleRow> = {}) => ({
  actorUserId: ADMIN_A,
  operationId: "11111111-2222-4333-8444-555555555555",
  target: row(over),
});

describe("toDependencyPreview", () => {
  it("maps the database counts to the public contract", () => {
    expect(toDependencyPreview(RAW_DEPS)).toEqual({
      companies: 2,
      contacts: 3,
      openDeals: 1,
      openTasks: 5,
      contactNotes: 9,
      dealNotes: 4,
    });
  });

  it("never yields negative, fractional or unknown values", () => {
    expect(
      toDependencyPreview({
        companies: "3",
        contacts: -1,
        open_deals: 1.9,
        open_tasks: null,
        secret: "x",
      }),
    ).toEqual({
      companies: 3,
      contacts: 0,
      openDeals: 1,
      openTasks: 0,
      contactNotes: 0,
      dealNotes: 0,
    });
    expect(toDependencyPreview(null)).toEqual({
      companies: 0,
      contacts: 0,
      openDeals: 0,
      openTasks: 0,
      contactNotes: 0,
      dealNotes: 0,
    });
  });
});

describe("executeOffboarding — happy path", () => {
  it("runs database first, then the ban, then verifies both facts", async () => {
    const f = fakeDeps();
    const result = await executeOffboarding(f.deps, request());

    expect(f.calls).toEqual(["db", "auth:ban", "verify:db", "verify:auth"]);
    expect(result.sale.disabled).toBe(true);
    expect(result.accessConsistency).toBe("consistent");
    expect(result.disposition).toBe("executed");
    expect(result.sessionsRevoked).toBe(2);
    expect(result.dependencies).toEqual({
      companies: 2,
      contacts: 3,
      openDeals: 1,
      openTasks: 5,
      contactNotes: 9,
      dealNotes: 4,
    });
    expect(f.banned).toBe(true);
  });

  it("forwards only the verified actor, the target and the operation id", async () => {
    const f = fakeDeps();
    await executeOffboarding(f.deps, request());
    expect(f.deps.offboard).toHaveBeenCalledWith({
      actorUserId: ADMIN_A,
      salesId: 7,
      operationId: "11111111-2222-4333-8444-555555555555",
    });
  });

  it("succeeds with open assignments present — they are reported, never a blocker", async () => {
    const f = fakeDeps();
    const result = await executeOffboarding(f.deps, request());
    expect(result.dependencies.openTasks).toBe(5);
    expect(result.sale.disabled).toBe(true);
  });

  it("a retry is a typed replay: no state change, ban re-applied, verified", async () => {
    const f = fakeDeps({ sale: row({ disabled: true }), sessions: 0 });
    const result = await executeOffboarding(
      f.deps,
      request({ disabled: true }),
    );
    expect(result.disposition).toBe("replayed");
    expect(result.sessionsRevoked).toBe(0);
    expect(f.calls).toEqual(["db", "auth:ban", "verify:db", "verify:auth"]);
    expect(result.accessConsistency).toBe("consistent");
  });

  it("an already disabled employee with live sessions is executed (sessions revoked)", async () => {
    const f = fakeDeps({ sale: row({ disabled: true }), sessions: 3 });
    const result = await executeOffboarding(
      f.deps,
      request({ disabled: true }),
    );
    expect(result.disposition).toBe("executed");
    expect(result.sessionsRevoked).toBe(3);
  });
});

describe("executeOffboarding — refusals before any write", () => {
  it("refuses self offboarding at the edge without touching the database or Auth", async () => {
    const f = fakeDeps({ sale: row({ user_id: ADMIN_A }) });
    await expect(
      executeOffboarding(f.deps, request({ user_id: ADMIN_A })),
    ).rejects.toMatchObject({
      failure: { status: 403, error: "self_access_change_forbidden" },
    });
    expect(f.calls).toEqual([]);
  });

  it.each([
    [
      { code: "42501", details: "NORA_SELF_ACCESS_CHANGE_FORBIDDEN" },
      403,
      "self_access_change_forbidden",
    ],
    [
      { code: "23514", details: "NORA_LAST_ACTIVE_ADMIN_REQUIRED" },
      409,
      "last_active_admin_required",
    ],
    [
      { code: "42501", details: "NORA_PERMISSION_DENIED" },
      403,
      "role_update_forbidden",
    ],
    [{ code: "P0002", message: "sales profile not found" }, 404, "not_found"],
    [{ code: "XX000", message: "boom" }, 500, "internal_error"],
  ])(
    "maps the database refusal %j to %i %s and never reaches Auth",
    async (dbError, status, error) => {
      const f = fakeDeps({ dbError });
      await expect(executeOffboarding(f.deps, request())).rejects.toMatchObject(
        { failure: { status, error } },
      );
      expect(f.calls).toEqual(["db"]);
      expect(f.logs).toEqual([expect.objectContaining({ stage: "db", error })]);
    },
  );
});

describe("executeOffboarding — partial failure", () => {
  it("ban call fails: access is off, sessions gone, but never reported green", async () => {
    const f = fakeDeps({ authFails: true });
    let caught: unknown;
    try {
      await executeOffboarding(f.deps, request());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OffboardingFailure);
    const failure = (caught as OffboardingFailure).failure;
    expect(failure.status).toBe(500);
    expect(failure.error).toBe("employee_access_sync_incomplete");
    expect(failure.offboarded).toBe(true);
    expect(failure.accessConsistency).toBe("inconsistent");
    expect(f.sale.disabled).toBe(true);
    expect(f.logs).toEqual([
      expect.objectContaining({
        stage: "auth_admin",
        error: "auth_update_failed",
      }),
      expect.objectContaining({
        stage: "verify",
        error: "employee_access_sync_incomplete",
      }),
    ]);
  });

  it("verification disagrees (Auth reads back unbanned): non-green with the consistency fact", async () => {
    const f = fakeDeps({ authStuckUnbanned: true });
    await expect(executeOffboarding(f.deps, request())).rejects.toMatchObject({
      failure: {
        status: 500,
        error: "employee_access_sync_incomplete",
        offboarded: true,
        accessConsistency: "inconsistent",
      },
    });
  });

  it("Auth side unreadable after the change: never green, consistency unknown", async () => {
    const f = fakeDeps({ authFactsMissing: true });
    await expect(executeOffboarding(f.deps, request())).rejects.toMatchObject({
      failure: {
        error: "employee_access_sync_incomplete",
        offboarded: true,
        accessConsistency: "unknown",
      },
    });
  });

  it("logs never carry user data, tokens or provider responses", async () => {
    const f = fakeDeps({ authFails: true });
    await executeOffboarding(f.deps, request()).catch(() => undefined);
    for (const entry of f.logs) {
      const text = JSON.stringify(entry);
      expect(text).not.toMatch(/@|token|jwt|ban_duration/i);
    }
  });
});
