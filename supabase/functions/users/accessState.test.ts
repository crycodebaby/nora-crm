import { describe, expect, it } from "vitest";
import {
  allowedAdminActions,
  buildEmployeeAccessRecord,
  deriveAccessConsistency,
  deriveEmployeeAccessState,
  hasActiveBan,
  hasConfirmedEmail,
  isAdminActionAllowed,
  parseEmployeeAccessCommand,
} from "./accessState.ts";

const NOW = new Date("2026-09-04T10:00:00.000Z");

const sale = (
  over: Partial<{ id: number; email: string; disabled: boolean }> = {},
) => ({
  id: 7,
  email: "viktoriia.p@ergart.de",
  disabled: false,
  ...over,
});

describe("deriveEmployeeAccessState", () => {
  it("reports an invited employee who never opened the invitation as invited", () => {
    const state = deriveEmployeeAccessState(
      sale(),
      { invited_at: "2026-09-01T08:00:00.000Z", email_confirmed_at: null },
      NOW,
    );
    expect(state).toBe("invited");
  });

  it("reports a confirmed employee as active", () => {
    const state = deriveEmployeeAccessState(
      sale(),
      {
        invited_at: "2026-09-01T08:00:00.000Z",
        email_confirmed_at: "2026-09-02T09:00:00.000Z",
      },
      NOW,
    );
    expect(state).toBe("active");
  });

  it("accepts confirmed_at as an equivalent activation fact", () => {
    expect(
      deriveEmployeeAccessState(
        sale(),
        { confirmed_at: "2026-09-02T09:00:00.000Z" },
        NOW,
      ),
    ).toBe("active");
  });

  it("reports a Nora-disabled employee as disabled even when confirmed", () => {
    const state = deriveEmployeeAccessState(
      sale({ disabled: true }),
      { email_confirmed_at: "2026-09-02T09:00:00.000Z" },
      NOW,
    );
    expect(state).toBe("disabled");
  });

  it("reports an Auth-banned employee as disabled even when sales.disabled is false", () => {
    const state = deriveEmployeeAccessState(
      sale({ disabled: false }),
      {
        email_confirmed_at: "2026-09-02T09:00:00.000Z",
        banned_until: "2036-09-02T09:00:00.000Z",
      },
      NOW,
    );
    expect(state).toBe("disabled");
  });

  it("disabled wins over not-yet-activated", () => {
    expect(
      deriveEmployeeAccessState(
        sale({ disabled: true }),
        { email_confirmed_at: null },
        NOW,
      ),
    ).toBe("disabled");
  });

  it("does not treat an expired ban as disabled", () => {
    expect(
      deriveEmployeeAccessState(
        sale(),
        {
          email_confirmed_at: "2026-09-02T09:00:00.000Z",
          banned_until: "2026-09-03T09:00:00.000Z",
        },
        NOW,
      ),
    ).toBe("active");
  });

  it("never infers state from sign-in history — an active employee who never signed in stays active", () => {
    // last_sign_in_at is deliberately not part of EmployeeAuthFacts at all.
    const state = deriveEmployeeAccessState(
      sale(),
      { email_confirmed_at: "2026-09-02T09:00:00.000Z", invited_at: null },
      NOW,
    );
    expect(state).toBe("active");
  });

  it("returns unknown for a sales row without a resolvable Auth identity", () => {
    expect(deriveEmployeeAccessState(sale(), null, NOW)).toBe("unknown");
  });

  it("still reports disabled when the Auth identity is missing but Nora disabled the access", () => {
    expect(deriveEmployeeAccessState(sale({ disabled: true }), null, NOW)).toBe(
      "disabled",
    );
  });
});

describe("hasActiveBan", () => {
  it.each([
    [null, false],
    [undefined, false],
    ["none", false],
    ["not-a-date", false],
    ["2026-09-03T09:00:00.000Z", false],
    ["2036-09-03T09:00:00.000Z", true],
  ])("hasActiveBan(%s) === %s", (value, expected) => {
    expect(hasActiveBan(value as string | null | undefined, NOW)).toBe(
      expected,
    );
  });
});

describe("hasConfirmedEmail", () => {
  it("is false when neither confirmation timestamp is present", () => {
    expect(
      hasConfirmedEmail({ email_confirmed_at: null, confirmed_at: null }),
    ).toBe(false);
  });
});

describe("buildEmployeeAccessRecord", () => {
  it("returns only the safe product fields", () => {
    const record = buildEmployeeAccessRecord(
      sale(),
      {
        invited_at: "2026-09-01T08:00:00.000Z",
        email_confirmed_at: "2026-09-02T09:00:00.000Z",
        banned_until: "none",
      },
      NOW,
    );

    expect(record).toEqual({
      employeeId: 7,
      email: "viktoriia.p@ergart.de",
      accessState: "active",
      disabled: false,
      noraDisabled: false,
      accessConsistency: "consistent",
      invitedAt: "2026-09-01T08:00:00.000Z",
      activatedAt: "2026-09-02T09:00:00.000Z",
    });
    expect(Object.keys(record).sort()).toEqual([
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

  it("reports disabled true when Auth holds an active ban", () => {
    const record = buildEmployeeAccessRecord(
      sale({ disabled: false }),
      {
        email_confirmed_at: "2026-09-02T09:00:00.000Z",
        banned_until: "2036-01-01T00:00:00.000Z",
      },
      NOW,
    );
    expect(record.disabled).toBe(true);
    expect(record.accessState).toBe("disabled");
  });
});

describe("deriveAccessConsistency (W1)", () => {
  const confirmed = { email_confirmed_at: "2026-09-02T09:00:00.000Z" };

  it("is consistent when neither side disables", () => {
    expect(
      deriveAccessConsistency(
        sale(),
        { ...confirmed, banned_until: null },
        NOW,
      ),
    ).toBe("consistent");
  });

  it("is consistent when both sides disable", () => {
    expect(
      deriveAccessConsistency(
        sale({ disabled: true }),
        { ...confirmed, banned_until: "2036-01-01T00:00:00.000Z" },
        NOW,
      ),
    ).toBe("consistent");
  });

  it("flags Nora-disabled without an Auth ban (the drift found in Production)", () => {
    const record = buildEmployeeAccessRecord(
      sale({ disabled: true }),
      { ...confirmed, banned_until: null },
      NOW,
    );
    expect(record.accessConsistency).toBe("inconsistent");
    // The product state still says disabled: Nora's flag wins for access.
    expect(record.accessState).toBe("disabled");
    expect(record.noraDisabled).toBe(true);
    expect(record.disabled).toBe(true);
  });

  it("flags Nora-enabled with an active Auth ban", () => {
    const record = buildEmployeeAccessRecord(
      sale({ disabled: false }),
      { ...confirmed, banned_until: "2036-01-01T00:00:00.000Z" },
      NOW,
    );
    expect(record.accessConsistency).toBe("inconsistent");
    expect(record.accessState).toBe("disabled");
    expect(record.noraDisabled).toBe(false);
    expect(record.disabled).toBe(true);
  });

  it("treats an expired ban as no ban", () => {
    expect(
      deriveAccessConsistency(
        sale(),
        { ...confirmed, banned_until: "2020-01-01T00:00:00.000Z" },
        NOW,
      ),
    ).toBe("consistent");
  });

  it("claims nothing when the Auth side cannot be read", () => {
    expect(deriveAccessConsistency(sale({ disabled: true }), null, NOW)).toBe(
      "unknown",
    );
    expect(buildEmployeeAccessRecord(sale(), null, NOW).accessConsistency).toBe(
      "unknown",
    );
  });
});

describe("allowedAdminActions", () => {
  it("offers a fresh invitation only to a not-yet-activated employee", () => {
    expect(allowedAdminActions("invited")).toContain("resend_invitation");
    expect(allowedAdminActions("active")).not.toContain("resend_invitation");
    expect(allowedAdminActions("disabled")).not.toContain("resend_invitation");
  });

  it("offers password setup only to an active employee", () => {
    expect(allowedAdminActions("active")).toContain("request_password_setup");
    expect(allowedAdminActions("invited")).not.toContain(
      "request_password_setup",
    );
    expect(allowedAdminActions("disabled")).not.toContain(
      "request_password_setup",
    );
  });

  it("offers only re-enabling for a disabled employee", () => {
    expect(allowedAdminActions("disabled")).toEqual(["enable_access"]);
  });

  it("offers nothing for an unresolvable identity", () => {
    expect(allowedAdminActions("unknown")).toEqual([]);
  });

  it("isAdminActionAllowed mirrors allowedAdminActions", () => {
    expect(isAdminActionAllowed("invited", "resend_invitation")).toBe(true);
    expect(isAdminActionAllowed("active", "resend_invitation")).toBe(false);
    expect(isAdminActionAllowed("unknown", "request_password_setup")).toBe(
      false,
    );
  });
});

describe("parseEmployeeAccessCommand", () => {
  it("treats a body without an action as the legacy create+invite payload", () => {
    expect(
      parseEmployeeAccessCommand({
        email: "neu@ergart.de",
        first_name: "Neu",
        last_name: "Person",
      }),
    ).toBeNull();
  });

  it("parses the two supported commands", () => {
    expect(
      parseEmployeeAccessCommand({ action: "resend_invitation", sales_id: 7 }),
    ).toEqual({ kind: "resend_invitation", salesId: 7 });
    expect(
      parseEmployeeAccessCommand({
        action: "request_password_setup",
        sales_id: "7",
      }),
    ).toEqual({ kind: "request_password_setup", salesId: 7 });
  });

  it("rejects an unknown action instead of falling back to invite", () => {
    expect(
      parseEmployeeAccessCommand({ action: "delete_user", sales_id: 7 }),
    ).toEqual({ error: "unknown_action" });
  });

  it("rejects a malformed employee id", () => {
    for (const salesId of [undefined, null, 0, -1, "abc"]) {
      expect(
        parseEmployeeAccessCommand({
          action: "resend_invitation",
          sales_id: salesId,
        }),
      ).toEqual({ error: "invalid_payload" });
    }
  });
});
