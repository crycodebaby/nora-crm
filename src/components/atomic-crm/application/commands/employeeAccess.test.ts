import { describe, expect, it, vi } from "vitest";

import {
  EmployeeAccessActionNotApplicableError,
  getEmployeeAccessStatus,
  requestEmployeePasswordSetup,
  resendEmployeeInvitation,
  resyncEmployeeAccess,
} from "./employeeAccess";
import type { CrmDataProvider } from "../../providers/types";
import type { EmployeeAccessRecord } from "../../sales/employeeAccessContract";

const record = (
  over: Partial<EmployeeAccessRecord> = {},
): EmployeeAccessRecord => ({
  employeeId: 7,
  email: "viktoriia.p@ergart.de",
  accessState: "invited",
  disabled: false,
  noraDisabled: false,
  accessConsistency: "consistent",
  invitedAt: "2026-09-01T08:00:00.000Z",
  activatedAt: null,
  ...over,
});

const provider = (over: Partial<CrmDataProvider> = {}) =>
  ({
    getEmployeeAccessStatus: vi.fn(async () => [record()]),
    salesUpdate: vi.fn(async () => ({ id: 7, disabled: true })),
    resendEmployeeInvitation: vi.fn(async () => record()),
    requestEmployeePasswordSetup: vi.fn(async () =>
      record({
        accessState: "active",
        activatedAt: "2026-09-02T00:00:00.000Z",
      }),
    ),
    ...over,
  }) as unknown as CrmDataProvider;

describe("getEmployeeAccessStatus", () => {
  it("passes the employee id through to the authorized boundary", async () => {
    const dp = provider();
    await getEmployeeAccessStatus(dp, 7);
    expect(dp.getEmployeeAccessStatus).toHaveBeenCalledWith(7);
  });

  it("reads the whole directory when no id is given", async () => {
    const dp = provider();
    const result = await getEmployeeAccessStatus(dp);
    expect(dp.getEmployeeAccessStatus).toHaveBeenCalledWith(undefined);
    expect(result).toHaveLength(1);
  });
});

describe("resendEmployeeInvitation", () => {
  it("sends a fresh invitation for a not-yet-activated employee", async () => {
    const dp = provider();
    await resendEmployeeInvitation(dp, { salesId: 7, currentState: "invited" });
    expect(dp.resendEmployeeInvitation).toHaveBeenCalledWith(7);
  });

  it("refuses to treat an active employee as a first-time invite", async () => {
    const dp = provider();
    await expect(
      resendEmployeeInvitation(dp, { salesId: 7, currentState: "active" }),
    ).rejects.toBeInstanceOf(EmployeeAccessActionNotApplicableError);
    expect(dp.resendEmployeeInvitation).not.toHaveBeenCalled();
  });

  it("refuses to invite a disabled employee", async () => {
    const dp = provider();
    await expect(
      resendEmployeeInvitation(dp, { salesId: 7, currentState: "disabled" }),
    ).rejects.toBeInstanceOf(EmployeeAccessActionNotApplicableError);
    expect(dp.resendEmployeeInvitation).not.toHaveBeenCalled();
  });

  it("surfaces a server-side state conflict as the same typed error", async () => {
    const dp = provider({
      resendEmployeeInvitation: vi.fn(async () => {
        throw new Error("action_not_applicable");
      }),
    } as unknown as Partial<CrmDataProvider>);

    await expect(
      resendEmployeeInvitation(dp, { salesId: 7, currentState: "invited" }),
    ).rejects.toBeInstanceOf(EmployeeAccessActionNotApplicableError);
  });

  it("propagates an authorization failure unchanged", async () => {
    const dp = provider({
      resendEmployeeInvitation: vi.fn(async () => {
        throw new Error("access_action_forbidden");
      }),
    } as unknown as Partial<CrmDataProvider>);

    await expect(
      resendEmployeeInvitation(dp, { salesId: 7, currentState: "invited" }),
    ).rejects.toThrow("access_action_forbidden");
  });
});

describe("requestEmployeePasswordSetup", () => {
  it("sends the setup link for an active employee", async () => {
    const dp = provider();
    const result = await requestEmployeePasswordSetup(dp, {
      salesId: 7,
      currentState: "active",
    });
    expect(dp.requestEmployeePasswordSetup).toHaveBeenCalledWith(7);
    expect(result.accessState).toBe("active");
  });

  it("never offers password setup to a not-yet-activated employee", async () => {
    const dp = provider();
    await expect(
      requestEmployeePasswordSetup(dp, { salesId: 7, currentState: "invited" }),
    ).rejects.toBeInstanceOf(EmployeeAccessActionNotApplicableError);
    expect(dp.requestEmployeePasswordSetup).not.toHaveBeenCalled();
  });

  it("never offers password setup to a disabled employee", async () => {
    const dp = provider();
    await expect(
      requestEmployeePasswordSetup(dp, {
        salesId: 7,
        currentState: "disabled",
      }),
    ).rejects.toBeInstanceOf(EmployeeAccessActionNotApplicableError);
    expect(dp.requestEmployeePasswordSetup).not.toHaveBeenCalled();
  });

  it("returns only the safe access fields — no tokens, no provider metadata", async () => {
    const dp = provider();
    const result = await requestEmployeePasswordSetup(dp, {
      salesId: 7,
      currentState: "active",
    });
    expect(Object.keys(result).sort()).toEqual([
      "accessConsistency",
      "accessState",
      "activatedAt",
      "disabled",
      "email",
      "employeeId",
      "invitedAt",
      "noraDisabled",
    ]);
  });
});

describe("resyncEmployeeAccess (W1)", () => {
  it("re-applies Nora's own flag through the same PATCH the edit form uses", async () => {
    const dp = provider();
    await resyncEmployeeAccess(dp, { salesId: 7, disabled: true });
    expect(dp.salesUpdate).toHaveBeenCalledWith(7, { disabled: true });
  });

  it("sends only the access flag — never role, name or email", async () => {
    const dp = provider();
    await resyncEmployeeAccess(dp, { salesId: 7, disabled: false });
    const [, patch] = (dp.salesUpdate as ReturnType<typeof vi.fn>).mock
      .calls[0] as [unknown, Record<string, unknown>];
    expect(Object.keys(patch)).toEqual(["disabled"]);
  });
});
