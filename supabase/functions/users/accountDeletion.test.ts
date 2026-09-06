import { describe, expect, it, vi } from "vitest";
import {
  AccountDeletionFailure,
  classifyAuthDeleteError,
  executeAccountDeletion,
  isAuthUserNotFound,
  mapPrepareRpcError,
  toDeletionPreview,
  type AccountDeletionDeps,
  type DeletionEvidence,
  type DeletionTicket,
} from "./accountDeletion.ts";
import { parseEmployeeAccessCommand } from "./accessState.ts";

const ADMIN_A = "a0000000-0000-4000-8000-00000000000a";
const FAKE = "a0000000-0000-4000-8000-00000000000f";
const OP = "66666666-2222-4333-8444-555555555555";

const RAW_PREVIEW = {
  eligible: true,
  reasons: [],
  target: {
    sale_id: 7,
    role: "office",
    disabled: true,
    auth_present: true,
    auth_confirmed: false,
    auth_banned: true,
    identity_consistent: true,
  },
  business_history: {
    companies: 0,
    contacts: 0,
    deals: 0,
    tasks: 0,
    contact_notes: 0,
    deal_notes: 0,
  },
  provenance: {
    checklist_templates: 0,
    saved_text_snippets: 0,
    google_calendar_connections: 0,
    audit_events_as_actor: 0,
  },
  technical: {
    live_sessions: 0,
    audit_events_as_target: 3,
    email_delivery_events_attributable: 1,
    email_delivery_events_foreign: 0,
    email_change_tickets: 0,
    operation_errors: 0,
    idempotency_records: 0,
  },
};

const ticket = (over: Partial<DeletionTicket> = {}): DeletionTicket => ({
  ticket_id: "t0000000-0000-4000-8000-000000000001",
  sale_id: 7,
  user_id: FAKE,
  entity_id: "e0000000-0000-4000-8000-000000000007",
  role: "office",
  preview: RAW_PREVIEW as never,
  ...over,
});

/**
 * In-memory stand-in for Postgres + GoTrue. The "database" holds the sale row
 * and the committed deletion events; the GoTrue delete either commits the
 * whole thing (guard path) or fails leaving everything untouched — exactly
 * the two outcomes the real transaction has.
 */
function fakeDeps(
  opts: {
    saleExists?: boolean;
    deletedEvents?: number;
    prepareError?: { code?: string; message?: string; details?: string };
    ticket?: DeletionTicket;
    providerFails?: { message?: string; status?: number; code?: string };
    /** provider fails AND the deletion committed anyway (lost response). */
    commitDespiteProviderError?: boolean;
    /** provider says ok but nothing committed (must never be reported green). */
    providerOkButNotCommitted?: boolean;
    authStillThere?: boolean;
    evidenceError?: boolean;
  } = {},
) {
  let saleExists = opts.saleExists ?? true;
  let deletedEvents = opts.deletedEvents ?? 0;
  let ticketLive = false;
  const calls: string[] = [];
  const logs: Record<string, unknown>[] = [];

  const evidence = (): DeletionEvidence => ({
    sale_id: 7,
    sale_exists: saleExists,
    deleted_event_count: deletedEvents,
    last_deleted_request_id: deletedEvents > 0 ? OP : null,
    last_deleted_at: deletedEvents > 0 ? "2026-09-07T00:00:00.000Z" : null,
  });

  const deps: AccountDeletionDeps = {
    readEvidence: vi.fn(async () => {
      calls.push("evidence");
      if (opts.evidenceError) throw { code: "XX000" };
      return evidence();
    }),
    prepare: vi.fn(async () => {
      calls.push("db:prepare");
      if (opts.prepareError) throw opts.prepareError;
      ticketLive = true;
      return opts.ticket ?? ticket();
    }),
    cancel: vi.fn(async () => {
      calls.push("db:cancel");
      const was = ticketLive;
      ticketLive = false;
      return was;
    }),
    deleteAuthUser: vi.fn(async () => {
      calls.push("auth:delete");
      if (opts.providerFails) {
        if (opts.commitDespiteProviderError) {
          saleExists = false;
          deletedEvents += 1;
          ticketLive = false;
        }
        throw opts.providerFails;
      }
      if (!opts.providerOkButNotCommitted) {
        saleExists = false;
        deletedEvents += 1;
        ticketLive = false;
      }
    }),
    authUserExists: vi.fn(async () => {
      calls.push("verify:auth");
      if (opts.authStillThere) return true;
      return saleExists;
    }),
    log: (entry) => {
      logs.push(entry);
    },
  };

  return {
    deps,
    calls,
    logs,
    get saleExists() {
      return saleExists;
    },
    get deletedEvents() {
      return deletedEvents;
    },
    get ticketLive() {
      return ticketLive;
    },
  };
}

const request = (over: Record<string, unknown> = {}) => ({
  actorUserId: ADMIN_A,
  operationId: OP,
  salesId: 7,
  confirmationName: "Fritz Fake",
  adminTargetConfirmed: false,
  ...over,
});

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (e) {
    if (e instanceof AccountDeletionFailure) return e.failure;
    throw e;
  }
  throw new Error("expected AccountDeletionFailure");
}

describe("toDeletionPreview", () => {
  it("maps the database preview to the public contract", () => {
    expect(toDeletionPreview(RAW_PREVIEW)).toEqual({
      supported: true,
      eligible: true,
      reasons: [],
      role: "office",
      businessHistory: {
        companies: 0,
        contacts: 0,
        deals: 0,
        tasks: 0,
        contactNotes: 0,
        dealNotes: 0,
      },
      provenance: {
        checklistTemplates: 0,
        savedTextSnippets: 0,
        googleCalendarConnections: 0,
        auditEventsAsActor: 0,
      },
      technical: {
        auditEventsAsTarget: 3,
        emailDeliveryEventsAttributable: 1,
        emailDeliveryEventsForeign: 0,
      },
    });
  });

  it("translates the NORA_* reasons and never claims eligibility with a reason present", () => {
    const preview = toDeletionPreview({
      ...RAW_PREVIEW,
      eligible: false,
      reasons: [
        "NORA_EMPLOYEE_STILL_ACTIVE",
        "NORA_EMPLOYEE_HAS_BUSINESS_HISTORY",
        "NORA_EMPLOYEE_HAS_DURABLE_PROVENANCE",
        "NORA_EMPLOYEE_ACCESS_INCONSISTENT",
        "NORA_EMPLOYEE_AUTH_NOT_FOUND",
        "NORA_SOMETHING_NEW",
      ],
      business_history: {
        ...RAW_PREVIEW.business_history,
        deals: "2",
        tasks: -1,
      },
    });
    expect(preview.eligible).toBe(false);
    expect(preview.reasons).toEqual([
      "still_active",
      "business_history_exists",
      "durable_provenance_exists",
      "access_inconsistent",
      "identity_inconsistent",
    ]);
    expect(preview.businessHistory.deals).toBe(2);
    expect(preview.businessHistory.tasks).toBe(0);
  });

  it("does not expose Auth internals or unknown keys", () => {
    const preview = toDeletionPreview({
      ...RAW_PREVIEW,
      technical: { ...RAW_PREVIEW.technical, live_sessions: 5, secret: "x" },
    }) as unknown as Record<string, unknown>;
    expect(JSON.stringify(preview)).not.toMatch(/live_sessions|secret|banned/);
  });

  it("is eligible only when the database says so AND no reason remains", () => {
    expect(
      toDeletionPreview({
        ...RAW_PREVIEW,
        eligible: true,
        reasons: ["NORA_EMPLOYEE_STILL_ACTIVE"],
      }).eligible,
    ).toBe(false);
  });
});

describe("mapPrepareRpcError", () => {
  it.each([
    ["NORA_SELF_DELETE_FORBIDDEN", 403, "self_delete_forbidden"],
    ["NORA_DELETE_CONFIRMATION_MISMATCH", 400, "confirmation_mismatch"],
    [
      "NORA_ADMIN_TARGET_CONFIRMATION_REQUIRED",
      400,
      "admin_target_confirmation_required",
    ],
    ["NORA_EMPLOYEE_STILL_ACTIVE", 409, "employee_still_active"],
    ["NORA_EMPLOYEE_ACCESS_INCONSISTENT", 409, "identity_inconsistent"],
    ["NORA_EMPLOYEE_AUTH_NOT_FOUND", 409, "identity_inconsistent"],
    ["NORA_EMPLOYEE_IDENTITY_INCONSISTENT", 409, "identity_inconsistent"],
    ["NORA_EMPLOYEE_HAS_BUSINESS_HISTORY", 409, "business_history_exists"],
    ["NORA_EMPLOYEE_HAS_DURABLE_PROVENANCE", 409, "durable_provenance_exists"],
    ["NORA_PERMISSION_DENIED", 403, "role_update_forbidden"],
  ])("maps DETAIL %s to %i %s", (details, status, error) => {
    const mapped = mapPrepareRpcError({ details, code: "P0001", message: "x" });
    expect(mapped.status).toBe(status);
    expect(mapped.error).toBe(error);
  });

  it("carries the UI-safe reason for eligibility refusals", () => {
    expect(
      mapPrepareRpcError({ details: "NORA_EMPLOYEE_HAS_BUSINESS_HISTORY" })
        .reasons,
    ).toEqual(["business_history_exists"]);
    expect(
      mapPrepareRpcError({ details: "NORA_SELF_DELETE_FORBIDDEN" }).reasons,
    ).toBeUndefined();
  });

  it("falls back to SQLSTATE / message for pre-contract errors", () => {
    expect(mapPrepareRpcError({ code: "42501" }).error).toBe(
      "role_update_forbidden",
    );
    expect(mapPrepareRpcError({ code: "P0002" }).error).toBe("not_found");
    expect(mapPrepareRpcError({ code: "XX000", message: "boom" }).error).toBe(
      "internal_error",
    );
  });
});

describe("classifyAuthDeleteError / isAuthUserNotFound", () => {
  it("recognises the database guard when GoTrue surfaces it, otherwise provider_failed", () => {
    expect(
      classifyAuthDeleteError({
        message: "… NORA_ACCOUNT_DELETE_NOT_AUTHORIZED …",
      }),
    ).toBe("account_delete_not_authorized");
    expect(
      classifyAuthDeleteError({
        message: "NORA_EMPLOYEE_HAS_BUSINESS_HISTORY",
      }),
    ).toBe("business_history_exists");
    expect(
      classifyAuthDeleteError({ message: "Database error deleting user" }),
    ).toBe("account_delete_provider_failed");
    expect(classifyAuthDeleteError(null)).toBe(
      "account_delete_provider_failed",
    );
  });

  it("treats GoTrue's user_not_found as evidence, not as a generic failure", () => {
    expect(isAuthUserNotFound({ status: 404 })).toBe(true);
    expect(isAuthUserNotFound({ code: "user_not_found" })).toBe(true);
    expect(isAuthUserNotFound({ message: "User not found" })).toBe(true);
    expect(isAuthUserNotFound({ status: 500, message: "boom" })).toBe(false);
  });
});

describe("executeAccountDeletion", () => {
  it("runs evidence → prepare → provider → verify and reports executed only after the evidence", async () => {
    const f = fakeDeps();
    const result = await executeAccountDeletion(f.deps, request());
    expect(result).toEqual({
      salesId: 7,
      disposition: "executed",
      role: "office",
      deletedEventCount: 1,
    });
    expect(f.calls).toEqual([
      "evidence",
      "db:prepare",
      "auth:delete",
      "evidence",
      "verify:auth",
    ]);
    expect(f.saleExists).toBe(false);
    expect(f.deps.prepare).toHaveBeenCalledWith({
      actorUserId: ADMIN_A,
      salesId: 7,
      confirmationName: "Fritz Fake",
      adminTargetConfirmed: false,
      operationId: OP,
    });
  });

  it("answers already_deleted from evidence without preparing or touching the provider", async () => {
    const f = fakeDeps({ saleExists: false, deletedEvents: 1 });
    const result = await executeAccountDeletion(f.deps, request());
    expect(result.disposition).toBe("already_deleted");
    expect(result.deletedEventCount).toBe(1);
    expect(f.calls).toEqual(["evidence"]);
  });

  it("never fabricates success: sale gone without a deletion event is not_found", async () => {
    const f = fakeDeps({ saleExists: false, deletedEvents: 0 });
    const details = await failure(executeAccountDeletion(f.deps, request()));
    expect(details.status).toBe(404);
    expect(details.error).toBe("not_found");
    expect(f.calls).toEqual(["evidence"]);
  });

  it("maps a database refusal, touches the provider never, and leaves no ticket", async () => {
    const f = fakeDeps({
      prepareError: {
        code: "23514",
        details: "NORA_EMPLOYEE_HAS_BUSINESS_HISTORY",
      },
    });
    const details = await failure(executeAccountDeletion(f.deps, request()));
    expect(details).toMatchObject({
      status: 409,
      error: "business_history_exists",
      reasons: ["business_history_exists"],
    });
    expect(f.calls).toEqual(["evidence", "db:prepare"]);
    expect(f.saleExists).toBe(true);
  });

  it("refuses a wrong typed name and an admin target without the extra confirmation", async () => {
    const wrong = fakeDeps({
      prepareError: {
        code: "22023",
        details: "NORA_DELETE_CONFIRMATION_MISMATCH",
      },
    });
    expect(
      (await failure(executeAccountDeletion(wrong.deps, request()))).error,
    ).toBe("confirmation_mismatch");
    const admin = fakeDeps({
      prepareError: {
        code: "22023",
        details: "NORA_ADMIN_TARGET_CONFIRMATION_REQUIRED",
      },
    });
    expect(
      (await failure(executeAccountDeletion(admin.deps, request()))).error,
    ).toBe("admin_target_confirmation_required");
  });

  it("refuses self deletion even if the ticket named the actor, and cancels the ticket", async () => {
    const f = fakeDeps({ ticket: ticket({ user_id: ADMIN_A }) });
    const details = await failure(executeAccountDeletion(f.deps, request()));
    expect(details.error).toBe("self_delete_forbidden");
    expect(f.calls).toEqual(["evidence", "db:prepare", "db:cancel"]);
    expect(f.ticketLive).toBe(false);
  });

  it("provider failure with nothing committed: ticket cancelled, provider_failed, no green", async () => {
    const f = fakeDeps({
      providerFails: { message: "Database error deleting user", status: 500 },
    });
    const details = await failure(executeAccountDeletion(f.deps, request()));
    expect(details).toMatchObject({
      status: 502,
      error: "account_delete_provider_failed",
    });
    expect(f.ticketLive).toBe(false);
    expect(f.saleExists).toBe(true);
    expect(f.calls).toContain("db:cancel");
  });

  it("provider failure that exposes a business-history refusal is a typed 409", async () => {
    const f = fakeDeps({
      providerFails: {
        message: "ERROR: … NORA_EMPLOYEE_HAS_BUSINESS_HISTORY",
        status: 500,
      },
    });
    const details = await failure(executeAccountDeletion(f.deps, request()));
    expect(details).toMatchObject({
      status: 409,
      error: "business_history_exists",
      reasons: ["business_history_exists"],
    });
  });

  it("provider response lost after commit: evidence wins, executed, no second prepare", async () => {
    const f = fakeDeps({
      providerFails: { message: "network", status: 0 },
      commitDespiteProviderError: true,
    });
    const result = await executeAccountDeletion(f.deps, request());
    expect(result.disposition).toBe("executed");
    expect(f.deps.prepare).toHaveBeenCalledTimes(1);
    expect(f.deps.cancel).not.toHaveBeenCalled();
    expect(
      f.logs.some((l) => l.error === "provider_response_lost_after_commit"),
    ).toBe(true);
  });

  it("never reports green when the provider said ok but nothing committed", async () => {
    const f = fakeDeps({ providerOkButNotCommitted: true });
    const details = await failure(executeAccountDeletion(f.deps, request()));
    expect(details).toMatchObject({
      status: 500,
      error: "account_delete_verification_failed",
    });
  });

  it("never reports green when the Auth identity is still there after a committed sales delete", async () => {
    const f = fakeDeps({ authStillThere: true });
    const details = await failure(executeAccountDeletion(f.deps, request()));
    expect(details.error).toBe("account_delete_verification_failed");
  });

  it("an unreadable evidence RPC is an internal error before anything is prepared", async () => {
    const f = fakeDeps({ evidenceError: true });
    const details = await failure(executeAccountDeletion(f.deps, request()));
    expect(details.error).toBe("internal_error");
    expect(f.calls).toEqual(["evidence"]);
  });

  it("logs stay content-free (no email, no name, no token)", async () => {
    const f = fakeDeps({
      providerFails: { message: "Database error deleting user", status: 500 },
    });
    await failure(executeAccountDeletion(f.deps, request()));
    expect(JSON.stringify(f.logs)).not.toMatch(/Fritz|@|token|jwt/i);
  });
});

describe("parseEmployeeAccessCommand — delete_account (W6-B)", () => {
  it("parses the command with the typed name trimmed and the admin confirmation as a strict boolean", () => {
    expect(
      parseEmployeeAccessCommand({
        action: "delete_account",
        sales_id: "7",
        confirmation_name: "  Fritz Fake ",
        admin_target_confirmed: true,
      }),
    ).toEqual({
      kind: "delete_account",
      salesId: 7,
      confirmationName: "Fritz Fake",
      adminTargetConfirmed: true,
    });
    expect(
      parseEmployeeAccessCommand({
        action: "delete_account",
        sales_id: 7,
        confirmation_name: "Fritz Fake",
        admin_target_confirmed: "true",
      }),
    ).toMatchObject({ adminTargetConfirmed: false });
  });

  it("rejects a missing or empty confirmation", () => {
    for (const confirmation of [undefined, null, "", "   ", 7]) {
      expect(
        parseEmployeeAccessCommand({
          action: "delete_account",
          sales_id: 7,
          confirmation_name: confirmation,
        }),
      ).toEqual({ error: "invalid_payload" });
    }
  });

  it("ignores any actor / user id field in the body", () => {
    const parsed = parseEmployeeAccessCommand({
      action: "delete_account",
      sales_id: 7,
      confirmation_name: "Fritz Fake",
      actor_user_id: "forged",
      user_id: "forged",
    });
    expect(JSON.stringify(parsed)).not.toContain("forged");
  });
});
