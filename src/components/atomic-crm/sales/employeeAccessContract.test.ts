import { describe, expect, it } from "vitest";

import {
  allowedAdminActions,
  describeAccessResync,
  EMPLOYEE_ACCESS_CONSISTENCY_NOTICE,
  EMPLOYEE_ACCESS_RESYNC_ACTION_LABEL,
  EMPLOYEE_ACCESS_STATES,
  EMPLOYEE_ACCESS_STATE_DESCRIPTION,
  EMPLOYEE_ACCESS_STATE_LABEL,
  describeEmployeeEmailChangeSuccess,
  EMPLOYEE_EMAIL_CHANGE_CONSEQUENCE,
  isAccessResyncApplicable,
  isAdminActionAllowed,
  isEmailChangeApplicable,
  isEmployeeAccessState,
  isSameLoginEmail,
  mapEmployeeAccessError,
  type EmployeeAccessRecord,
} from "./employeeAccessContract";

const w1Record = (
  over: Partial<EmployeeAccessRecord> = {},
): EmployeeAccessRecord => ({
  employeeId: 7,
  email: "test.access@ergart.de",
  accessState: "disabled",
  disabled: true,
  noraDisabled: true,
  accessConsistency: "inconsistent",
  identityConsistency: "consistent",
  invitedAt: null,
  activatedAt: null,
  ...over,
});

describe("employee access consistency (W1 client mirror)", () => {
  it("offers the repair exactly when the server reports a mismatch", () => {
    expect(
      isAccessResyncApplicable({ accessConsistency: "inconsistent" }),
    ).toBe(true);
    expect(isAccessResyncApplicable({ accessConsistency: "consistent" })).toBe(
      false,
    );
    expect(isAccessResyncApplicable({ accessConsistency: "unknown" })).toBe(
      false,
    );
  });

  it("describes the repair in product words for both directions", () => {
    expect(describeAccessResync(w1Record({ noraDisabled: true }))).toContain(
      "Zugang deaktiviert",
    );
    expect(describeAccessResync(w1Record({ noraDisabled: false }))).toContain(
      "Zugang aktiv",
    );
  });

  it("keeps provider internals out of the consistency copy", () => {
    const wording = [
      EMPLOYEE_ACCESS_CONSISTENCY_NOTICE,
      EMPLOYEE_ACCESS_RESYNC_ACTION_LABEL,
      describeAccessResync(w1Record()),
      mapEmployeeAccessError(new Error("self_access_change_forbidden")),
      mapEmployeeAccessError(new Error("last_active_admin_required")),
      mapEmployeeAccessError(new Error("employee_access_sync_incomplete")),
    ].join(" ");
    expect(wording).not.toMatch(
      /banned_until|GoTrue|auth\.users|RPC|service_role|SQLSTATE|token/i,
    );
  });

  it("maps the W1 lifecycle codes to calm, specific German copy", () => {
    expect(
      mapEmployeeAccessError(new Error("self_access_change_forbidden")),
    ).toMatch(/eigenen Nora-Zugang/);
    expect(
      mapEmployeeAccessError(new Error("last_active_admin_required")),
    ).toMatch(/Mindestens ein aktiver Administrator/);
    expect(
      mapEmployeeAccessError(new Error("employee_access_sync_incomplete")),
    ).toMatch(/nicht vollständig angewendet/);
  });
});

describe("employee access contract (client mirror)", () => {
  it("covers every state with product wording", () => {
    for (const state of EMPLOYEE_ACCESS_STATES) {
      expect(EMPLOYEE_ACCESS_STATE_LABEL[state]).toBeTruthy();
      expect(EMPLOYEE_ACCESS_STATE_DESCRIPTION[state]).toBeTruthy();
    }
  });

  it("uses the agreed product vocabulary, not provider terminology", () => {
    const wording = Object.values(EMPLOYEE_ACCESS_STATE_LABEL)
      .concat(Object.values(EMPLOYEE_ACCESS_STATE_DESCRIPTION))
      .join(" ");
    expect(wording).toContain("Einladung gesendet");
    expect(wording).toContain("Zugang aktiv");
    expect(wording).toContain("Zugang deaktiviert");
    expect(wording).not.toMatch(/magic link|OTP|token|recovery|callback/i);
  });

  it("recognises only the contract states", () => {
    expect(isEmployeeAccessState("active")).toBe(true);
    expect(isEmployeeAccessState("pending")).toBe(false);
    expect(isEmployeeAccessState(undefined)).toBe(false);
  });

  it("offers a first invitation only before activation", () => {
    expect(isAdminActionAllowed("invited", "resend_invitation")).toBe(true);
    expect(isAdminActionAllowed("active", "resend_invitation")).toBe(false);
    expect(isAdminActionAllowed("disabled", "resend_invitation")).toBe(false);
    expect(isAdminActionAllowed("unknown", "resend_invitation")).toBe(false);
  });

  it("offers password setup only to an active employee", () => {
    expect(isAdminActionAllowed("active", "request_password_setup")).toBe(true);
    expect(isAdminActionAllowed("invited", "request_password_setup")).toBe(
      false,
    );
    expect(isAdminActionAllowed("disabled", "request_password_setup")).toBe(
      false,
    );
  });

  it("offers nothing at all for an unresolvable identity", () => {
    expect(allowedAdminActions("unknown")).toEqual([]);
  });

  it("maps server error codes to calm German copy without leaking detail", () => {
    expect(mapEmployeeAccessError(new Error("access_action_forbidden"))).toBe(
      "Sie sind nicht berechtigt, den Nora-Zugang zu verwalten.",
    );
    expect(
      mapEmployeeAccessError(new Error("action_not_applicable")),
    ).toContain("passt nicht mehr zum aktuellen Zugangsstatus");
    expect(mapEmployeeAccessError(new Error("PGRST301 jwt expired"))).toBe(
      "Die Aktion konnte nicht ausgeführt werden. Bitte versuchen Sie es erneut.",
    );
  });
});

describe("login email change contract (W4)", () => {
  it("offers the change for active, invited and disabled — never for unknown or inconsistent", () => {
    for (const accessState of ["active", "invited", "disabled"] as const) {
      expect(
        isEmailChangeApplicable({
          accessState,
          identityConsistency: "consistent",
        }),
      ).toBe(true);
      expect(
        isEmailChangeApplicable({
          accessState,
          identityConsistency: "unknown",
        }),
      ).toBe(true);
      expect(
        isEmailChangeApplicable({
          accessState,
          identityConsistency: "inconsistent",
        }),
      ).toBe(false);
    }
    expect(
      isEmailChangeApplicable({
        accessState: "unknown",
        identityConsistency: "consistent",
      }),
    ).toBe(false);
  });

  it("names a consequence for every offered state and none for unknown", () => {
    expect(EMPLOYEE_EMAIL_CHANGE_CONSEQUENCE.active).toContain("künftig");
    expect(EMPLOYEE_EMAIL_CHANGE_CONSEQUENCE.invited).toContain(
      "neue Einladung",
    );
    expect(EMPLOYEE_EMAIL_CHANGE_CONSEQUENCE.disabled).toBe(
      "Der Nora-Zugang bleibt deaktiviert. Es wird keine Einladung versendet.",
    );
    expect(EMPLOYEE_EMAIL_CHANGE_CONSEQUENCE.unknown).toBeUndefined();
  });

  it("compares addresses like the provider does", () => {
    expect(isSameLoginEmail("  A.B@Ergart.DE ", "a.b@ergart.de")).toBe(true);
    expect(isSameLoginEmail("a.b@ergart.de", "a.c@ergart.de")).toBe(false);
  });

  it("success copy follows the resulting state and never claims an unsent invitation", () => {
    const base = w1Record({
      accessState: "active",
      disabled: false,
      noraDisabled: false,
      accessConsistency: "consistent",
      email: "neu@ergart.de",
    });
    const previousEmail = "alt@ergart.de";
    expect(
      describeEmployeeEmailChangeSuccess({
        record: base,
        previousEmail,
        invitationSent: false,
      }),
    ).toBe(
      "Anmeldeadresse geändert auf neu@ergart.de. Die neue Adresse wird künftig für den Nora-Zugang verwendet.",
    );
    expect(
      describeEmployeeEmailChangeSuccess({
        record: {
          ...base,
          accessState: "disabled",
          disabled: true,
          noraDisabled: true,
        },
        previousEmail,
        invitationSent: false,
      }),
    ).toBe(
      "Anmeldeadresse geändert auf neu@ergart.de. Der Nora-Zugang bleibt deaktiviert.",
    );
    expect(
      describeEmployeeEmailChangeSuccess({
        record: { ...base, accessState: "invited" },
        previousEmail,
        invitationSent: true,
      }),
    ).toBe(
      "Anmeldeadresse geändert. Eine neue Einladung wurde an neu@ergart.de gesendet.",
    );
    expect(
      describeEmployeeEmailChangeSuccess({
        record: { ...base, accessState: "invited" },
        previousEmail,
        invitationSent: false,
      }),
    ).toBe("Anmeldeadresse geändert auf neu@ergart.de.");
  });

  it("maps every W4 server code to calm German copy without technical vocabulary", () => {
    const codes = [
      "invalid_email",
      "email_unchanged",
      "email_already_in_use",
      "self_email_change_forbidden",
      "employee_auth_not_found",
      "employee_identity_inconsistent",
      "email_change_provider_failed",
      "email_change_sync_failed",
      "email_change_invitation_failed",
      "email_change_requires_command",
      "audit_write_failed",
    ];
    const generic = mapEmployeeAccessError(new Error("something_else"));
    for (const code of codes) {
      const text = mapEmployeeAccessError(new Error(code));
      expect(text).not.toBe(generic);
      expect(text).not.toMatch(/jwt|gotrue|rpc|service_role|token|sql/i);
    }
    expect(
      mapEmployeeAccessError(new Error("email_change_provider_failed")),
    ).toContain("Es wurde nichts verändert");
    expect(
      mapEmployeeAccessError(new Error("email_change_invitation_failed")),
    ).toContain("Einladung erneut senden");
  });
});
