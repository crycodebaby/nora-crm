import { describe, expect, it, vi } from "vitest";
import {
  AuditWriteFailure,
  recordEmployeeAdminEvent,
  resolveRequestOperationId,
  type EmployeeAuditDeps,
} from "./audit.ts";
import { parseEmployeeAccessCommand } from "./accessState.ts";
import { buildPatchPlan } from "./patchHelpers.ts";

const ADMIN_A = "a0000000-0000-4000-8000-00000000000a";
const OP_ID = "d0000000-0000-4000-8000-000000000001";

function fakeDeps(opts: { fail?: { code?: string; message?: string } } = {}) {
  const calls: unknown[] = [];
  const logs: Record<string, unknown>[] = [];
  const deps: EmployeeAuditDeps = {
    recordEmployeeAdminEvent: vi.fn(async (input) => {
      calls.push(input);
      if (opts.fail) throw opts.fail;
    }),
    log: (entry) => {
      logs.push(entry);
    },
  };
  return { deps, calls, logs };
}

describe("resolveRequestOperationId — one correlation id per request", () => {
  it("uses a valid x-nora-operation-id header, lower-cased", () => {
    const req = new Request("https://edge.test/users", {
      headers: { "x-nora-operation-id": OP_ID.toUpperCase() },
    });
    expect(resolveRequestOperationId(req)).toBe(OP_ID);
  });

  it("mints a fresh UUID when the header is missing", () => {
    const req = new Request("https://edge.test/users");
    const id = resolveRequestOperationId(req);
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("ignores an invalid header value and mints instead", () => {
    const req = new Request("https://edge.test/users", {
      headers: { "x-nora-operation-id": "not-a-uuid; drop table" },
    });
    const id = resolveRequestOperationId(req);
    expect(id).not.toContain("drop");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("recordEmployeeAdminEvent — what crosses the trust boundary", () => {
  it("forwards only actor id, target, event type, operation id and the role key", async () => {
    const f = fakeDeps();
    await recordEmployeeAdminEvent(f.deps, {
      actorUserId: ADMIN_A,
      salesId: 7,
      eventType: "user.invited",
      operationId: OP_ID,
      metadata: { role: "office" },
    });
    expect(f.calls).toEqual([
      {
        actorUserId: ADMIN_A,
        salesId: 7,
        eventType: "user.invited",
        operationId: OP_ID,
        metadata: { role: "office" },
      },
    ]);
  });

  it("sends null metadata when no allowlisted key is given", async () => {
    const f = fakeDeps();
    await recordEmployeeAdminEvent(f.deps, {
      actorUserId: ADMIN_A,
      salesId: 7,
      eventType: "user.invitation_resent",
      operationId: null,
    });
    expect((f.calls[0] as { metadata: unknown }).metadata).toBeNull();
  });

  it("never carries actor snapshots, emails or tokens itself", async () => {
    const f = fakeDeps();
    await recordEmployeeAdminEvent(f.deps, {
      actorUserId: ADMIN_A,
      salesId: 7,
      eventType: "user.password_setup_requested",
      operationId: OP_ID,
      // deliberately widened: extra keys must not survive
      metadata: {
        role: "viewer",
        actor_sale_id: 1,
        invite_token: "abc",
      } as never,
    });
    const sent = f.calls[0] as { metadata: Record<string, unknown> };
    expect(Object.keys(sent.metadata)).toEqual(["role"]);
    expect(JSON.stringify(sent)).not.toContain("abc");
  });

  it("throws AuditWriteFailure (500 audit_write_failed) when the database refuses", async () => {
    const f = fakeDeps({ fail: { code: "42501", message: "forbidden" } });
    await expect(
      recordEmployeeAdminEvent(f.deps, {
        actorUserId: ADMIN_A,
        salesId: 7,
        eventType: "user.invitation_resent",
        operationId: OP_ID,
      }),
    ).rejects.toBeInstanceOf(AuditWriteFailure);
    try {
      await recordEmployeeAdminEvent(f.deps, {
        actorUserId: ADMIN_A,
        salesId: 7,
        eventType: "user.invitation_resent",
        operationId: OP_ID,
      });
    } catch (error) {
      expect((error as AuditWriteFailure).failure).toEqual({
        status: 500,
        error: "audit_write_failed",
        message: "Action performed, but the audit record could not be written",
      });
    }
    expect(f.logs.at(-1)).toMatchObject({
      operation: "employee_admin_audit",
      stage: "db",
      sqlstate: "42501",
      error: "audit_write_failed",
    });
    // diagnostics stay content-free: no actor id, no message text
    expect(JSON.stringify(f.logs)).not.toContain(ADMIN_A);
    expect(JSON.stringify(f.logs)).not.toContain("forbidden");
  });
});

describe("request bodies cannot name an actor", () => {
  it("PATCH plan ignores actor_user_id / actor_id / user_id fields", () => {
    const plan = buildPatchPlan({
      sales_id: 5,
      role: "viewer",
      actor_user_id: "ffffffff-0000-4000-8000-000000000000",
      actor_id: "ffffffff-0000-4000-8000-000000000000",
      user_id: "ffffffff-0000-4000-8000-000000000000",
      p_actor_user_id: "ffffffff-0000-4000-8000-000000000000",
    } as never);
    expect("error" in plan).toBe(false);
    expect(JSON.stringify(plan)).not.toContain("ffffffff");
  });

  it("access commands ignore actor fields as well", () => {
    const command = parseEmployeeAccessCommand({
      action: "resend_invitation",
      sales_id: 5,
      actor_user_id: "ffffffff-0000-4000-8000-000000000000",
    });
    expect(command).toEqual({ kind: "resend_invitation", salesId: 5 });
  });
});
