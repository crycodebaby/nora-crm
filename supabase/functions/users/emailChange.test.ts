import { describe, expect, it, vi } from "vitest";
import {
  classifyAuthUpdateError,
  EmailChangeFailure,
  executeEmailChange,
  mapPrepareRpcError,
  type EmailChangeDeps,
  type EmailChangeSaleRow,
  type EmailChangeTicket,
} from "./emailChange.ts";
import type { EmployeeAuthFacts } from "./accessState.ts";

const ADMIN_A = "a0000000-0000-4000-8000-00000000000a";
const EMPLOYEE = "a0000000-0000-4000-8000-00000000000e";
const OP = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const FUTURE = "2036-09-06T10:00:00.000Z";

const row = (over: Partial<EmailChangeSaleRow> = {}): EmailChangeSaleRow => ({
  id: 7,
  user_id: EMPLOYEE,
  email: "alt@ergart.de",
  first_name: "Viktoriia",
  last_name: "P",
  role: "office",
  disabled: false,
  ...over,
});

type Store = {
  sale: EmailChangeSaleRow;
  auth: EmployeeAuthFacts & { email: string };
  ticket: EmailChangeTicket | null;
};

/**
 * In-memory stand-in for Postgres + GoTrue. The fake Auth update mirrors the
 * real guard: with a live ticket it moves BOTH emails and consumes the
 * ticket in one step; without one it refuses and moves nothing.
 */
function fakeDeps(
  opts: {
    sale?: EmailChangeSaleRow;
    auth?: Partial<EmployeeAuthFacts>;
    prepareError?: { code?: string; message?: string; details?: string };
    /** Provider rejects; "silent" = rejects AFTER the guard already committed. */
    providerFailure?: "refuse" | "silent" | "duplicate" | "guard";
    inviteFails?: boolean;
    authUnreadableAfter?: boolean;
    tamperAfter?: (store: Store) => void;
  } = {},
) {
  const store: Store = {
    sale: opts.sale ?? row(),
    auth: {
      email: (opts.sale ?? row()).email,
      email_confirmed_at: "2026-09-01T08:00:00.000Z",
      banned_until: null,
      ...opts.auth,
    } as Store["auth"],
    ticket: null,
  };
  const calls: string[] = [];
  const logs: Record<string, unknown>[] = [];

  const deps: EmailChangeDeps = {
    prepare: vi.fn(async ({ salesId, newEmail, actorUserId, operationId }) => {
      calls.push("prepare");
      if (opts.prepareError) throw opts.prepareError;
      const ticket: EmailChangeTicket = {
        ticket_id: "t-1",
        sale_id: salesId,
        user_id: store.sale.user_id,
        old_email: store.sale.email,
        new_email: newEmail.trim().toLowerCase(),
        role: store.sale.role,
        disabled: store.sale.disabled,
        auth_confirmed: Boolean(store.auth.email_confirmed_at),
        auth_banned: Boolean(
          store.auth.banned_until && store.auth.banned_until !== "none",
        ),
      };
      void actorUserId;
      void operationId;
      store.ticket = ticket;
      return ticket;
    }),
    cancel: vi.fn(async (ticketId) => {
      calls.push("cancel");
      if (store.ticket?.ticket_id === ticketId) {
        store.ticket = null;
        return true;
      }
      return false;
    }),
    updateAuthEmail: vi.fn(async (_userId, email) => {
      calls.push("auth");
      if (opts.providerFailure === "refuse") throw new Error("auth down");
      if (opts.providerFailure === "duplicate") {
        throw { code: "23505", message: "duplicate key value" };
      }
      if (opts.providerFailure === "guard" || !store.ticket) {
        throw {
          code: "P0001",
          message:
            "login email changes are only possible through the Nora lifecycle executor (NORA_EMAIL_CHANGE_NOT_AUTHORIZED)",
        };
      }
      // The guard: both sides move together, ticket consumed.
      store.sale = { ...store.sale, email };
      store.auth = { ...store.auth, email };
      store.ticket = null;
      opts.tamperAfter?.(store);
      if (opts.providerFailure === "silent") {
        throw new Error("socket hang up");
      }
    }),
    readSale: vi.fn(async () => {
      calls.push("readSale");
      return store.sale;
    }),
    readAuthFacts: vi.fn(async () => {
      calls.push("readAuth");
      return opts.authUnreadableAfter ? null : store.auth;
    }),
    sendInvitation: vi.fn(async () => {
      calls.push("invite");
      if (opts.inviteFails) throw new Error("smtp down");
    }),
    log: (entry) => logs.push(entry),
  };

  return { deps, store, calls, logs };
}

const request = (newEmail = "Neu@Ergart.de") => ({
  actorUserId: ADMIN_A,
  operationId: OP,
  salesId: 7,
  newEmail,
});

async function failure(promise: Promise<unknown>): Promise<EmailChangeFailure> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof EmailChangeFailure) return e;
    throw e;
  }
  throw new Error("expected EmailChangeFailure");
}

describe("executeEmailChange — active employee", () => {
  it("prepares, updates Auth, verifies both stores and reports the new address", async () => {
    const { deps, store, calls } = fakeDeps();

    const result = await executeEmailChange(deps, request());

    expect(calls).toEqual(["prepare", "auth", "readSale", "readAuth"]);
    expect(result.newEmail).toBe("neu@ergart.de");
    expect(result.previousEmail).toBe("alt@ergart.de");
    expect(store.sale.email).toBe("neu@ergart.de");
    expect(store.auth.email).toBe("neu@ergart.de");
    expect(result.invitationSent).toBe(false);
    expect(deps.sendInvitation).not.toHaveBeenCalled();
    expect(result.sale.disabled).toBe(false);
    expect(result.sale.role).toBe("office");
  });

  it("normalises before the provider sees the address and passes it to prepare", async () => {
    const { deps } = fakeDeps();
    await executeEmailChange(deps, request("  Neu@Ergart.de "));
    expect(deps.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        newEmail: "neu@ergart.de",
        actorUserId: ADMIN_A,
        operationId: OP,
      }),
    );
    expect(deps.updateAuthEmail).toHaveBeenCalledWith(
      EMPLOYEE,
      "neu@ergart.de",
    );
  });

  it("does not send an invitation to an already active employee", async () => {
    const { deps } = fakeDeps();
    const result = await executeEmailChange(deps, request());
    expect(result.invitationSent).toBe(false);
    expect(deps.sendInvitation).not.toHaveBeenCalled();
  });
});

describe("executeEmailChange — refused before anything changes", () => {
  it.each([
    ["NORA_EMAIL_UNCHANGED", "email_unchanged", 409],
    ["NORA_EMAIL_ALREADY_IN_USE", "email_already_in_use", 409],
    ["NORA_EMAIL_INVALID", "invalid_email", 400],
    ["NORA_EMPLOYEE_AUTH_NOT_FOUND", "employee_auth_not_found", 409],
    [
      "NORA_EMPLOYEE_IDENTITY_INCONSISTENT",
      "employee_identity_inconsistent",
      409,
    ],
    ["NORA_SELF_EMAIL_CHANGE_FORBIDDEN", "self_email_change_forbidden", 403],
    ["NORA_PERMISSION_DENIED", "role_update_forbidden", 403],
  ])(
    "maps %s from prepare and never touches Auth",
    async (detail, code, status) => {
      const { deps, calls, store } = fakeDeps({
        prepareError: { code: "P0001", message: "refused", details: detail },
      });
      const e = await failure(executeEmailChange(deps, request()));
      expect(e.failure.error).toBe(code);
      expect(e.failure.status).toBe(status);
      expect(calls).toEqual(["prepare"]);
      expect(store.sale.email).toBe("alt@ergart.de");
      expect(store.auth.email).toBe("alt@ergart.de");
    },
  );

  it("refuses an empty address without calling the database", async () => {
    const { deps, calls } = fakeDeps();
    const e = await failure(executeEmailChange(deps, request("   ")));
    expect(e.failure.error).toBe("invalid_email");
    expect(calls).toEqual([]);
  });

  it("maps a missing employee to 404", async () => {
    const { deps } = fakeDeps({
      prepareError: { code: "P0002", message: "sales profile not found: 7" },
    });
    const e = await failure(executeEmailChange(deps, request()));
    expect(e.failure).toMatchObject({ status: 404, error: "not_found" });
  });
});

describe("executeEmailChange — provider failures", () => {
  it("provider refuses: reports provider failure, cancels the ticket, nothing moved", async () => {
    const { deps, calls, store, logs } = fakeDeps({
      providerFailure: "refuse",
    });
    const e = await failure(executeEmailChange(deps, request()));
    expect(e.failure).toMatchObject({
      status: 502,
      error: "email_change_provider_failed",
      emailChanged: false,
      identityConsistency: "consistent",
    });
    expect(calls).toEqual([
      "prepare",
      "auth",
      "readSale",
      "readAuth",
      "cancel",
    ]);
    expect(store.ticket).toBeNull();
    expect(store.sale.email).toBe("alt@ergart.de");
    expect(store.auth.email).toBe("alt@ergart.de");
    expect(logs.some((l) => l.stage === "auth_admin")).toBe(true);
  });

  it("guard refusal (no live ticket) is reported as sync failure, not success", async () => {
    const { deps, store } = fakeDeps({ providerFailure: "guard" });
    const e = await failure(executeEmailChange(deps, request()));
    expect(e.failure.error).toBe("email_change_sync_failed");
    expect(e.failure.emailChanged).toBe(false);
    expect(store.sale.email).toBe("alt@ergart.de");
  });

  it("race on the address between prepare and Auth is a conflict, not a 5xx", async () => {
    const { deps } = fakeDeps({ providerFailure: "duplicate" });
    const e = await failure(executeEmailChange(deps, request()));
    expect(e.failure).toMatchObject({
      status: 409,
      error: "email_already_in_use",
      emailChanged: false,
    });
  });

  it("uncertain provider result after commit resolves to success through verification", async () => {
    const { deps, calls, store } = fakeDeps({ providerFailure: "silent" });
    const result = await executeEmailChange(deps, request());
    expect(result.newEmail).toBe("neu@ergart.de");
    expect(store.sale.email).toBe("neu@ergart.de");
    expect(calls).not.toContain("cancel");
  });

  it("never reports success when the Auth side cannot be read back", async () => {
    const { deps } = fakeDeps({ authUnreadableAfter: true });
    const e = await failure(executeEmailChange(deps, request()));
    expect(e.failure).toMatchObject({
      status: 500,
      error: "email_change_sync_failed",
      identityConsistency: "unknown",
    });
  });

  it("never reports success when the two identities end up apart", async () => {
    const { deps } = fakeDeps({
      tamperAfter: (store) => {
        store.auth = { ...store.auth, email: "alt@ergart.de" };
      },
    });
    const e = await failure(executeEmailChange(deps, request()));
    expect(e.failure).toMatchObject({
      status: 500,
      error: "email_change_sync_failed",
      emailChanged: true,
      identityConsistency: "inconsistent",
    });
  });

  it("never reports success when the access state moved with the email", async () => {
    const { deps } = fakeDeps({
      tamperAfter: (store) => {
        store.sale = { ...store.sale, disabled: true };
      },
    });
    const e = await failure(executeEmailChange(deps, request()));
    expect(e.failure).toMatchObject({
      status: 500,
      error: "email_change_sync_failed",
      emailChanged: true,
    });
  });
});

describe("executeEmailChange — disabled employee", () => {
  it("changes the address, keeps sales.disabled and the ban, sends nothing", async () => {
    const { deps, store } = fakeDeps({
      sale: row({ disabled: true }),
      auth: { banned_until: FUTURE, email_confirmed_at: null },
    });
    const result = await executeEmailChange(deps, request());
    expect(result.newEmail).toBe("neu@ergart.de");
    expect(store.sale.disabled).toBe(true);
    expect(store.auth.banned_until).toBe(FUTURE);
    expect(result.invitationSent).toBe(false);
    expect(deps.sendInvitation).not.toHaveBeenCalled();
  });

  it("sends nothing even when the disabled employee never activated", async () => {
    const { deps } = fakeDeps({
      sale: row({ disabled: true }),
      auth: {
        banned_until: FUTURE,
        email_confirmed_at: null,
        confirmed_at: null,
      },
    });
    await executeEmailChange(deps, request());
    expect(deps.sendInvitation).not.toHaveBeenCalled();
  });
});

describe("executeEmailChange — invited employee", () => {
  it("changes the address and sends a fresh invitation to the new one", async () => {
    const { deps, calls } = fakeDeps({
      auth: {
        email_confirmed_at: null,
        confirmed_at: null,
        invited_at: "2026-09-01T08:00:00.000Z",
      },
    });
    const result = await executeEmailChange(deps, request());
    expect(result.invitationSent).toBe(true);
    expect(deps.sendInvitation).toHaveBeenCalledWith({
      email: "neu@ergart.de",
      firstName: "Viktoriia",
      lastName: "P",
    });
    expect(calls.indexOf("invite")).toBeGreaterThan(calls.indexOf("readAuth"));
  });

  it("a failed invitation is reported non-green although the identity moved", async () => {
    const { deps, store } = fakeDeps({
      auth: { email_confirmed_at: null, confirmed_at: null },
      inviteFails: true,
    });
    const e = await failure(executeEmailChange(deps, request()));
    expect(e.failure).toMatchObject({
      status: 502,
      error: "email_change_invitation_failed",
      emailChanged: true,
      identityConsistency: "consistent",
    });
    expect(store.sale.email).toBe("neu@ergart.de");
    expect(store.auth.email).toBe("neu@ergart.de");
  });
});

describe("mapPrepareRpcError / classifyAuthUpdateError", () => {
  it("falls back on SQLSTATE 42501 for pre-contract permission errors", () => {
    expect(
      mapPrepareRpcError({ code: "42501", message: "permission denied" }).error,
    ).toBe("role_update_forbidden");
  });

  it("maps unknown errors to 500", () => {
    expect(mapPrepareRpcError({ code: "XX000", message: "boom" }).status).toBe(
      500,
    );
  });

  it("classifies the guard's refusal and duplicates from GoTrue", () => {
    expect(
      classifyAuthUpdateError({
        code: "P0001",
        message: "… NORA_EMAIL_CHANGE_NOT_AUTHORIZED",
      }),
    ).toBe("email_change_sync_failed");
    expect(
      classifyAuthUpdateError({ code: "23505", message: "duplicate key" }),
    ).toBe("email_already_in_use");
    expect(
      classifyAuthUpdateError({
        code: 422,
        message: "A user with this email address has already been registered",
      }),
    ).toBe("email_already_in_use");
    expect(classifyAuthUpdateError(new Error("fetch failed"))).toBe(
      "email_change_provider_failed",
    );
    expect(classifyAuthUpdateError(null)).toBe("email_change_provider_failed");
  });
});
