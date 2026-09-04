import { describe, expect, it } from "vitest";

import {
  allowedAdminActions,
  describeAccessResync,
  EMPLOYEE_ACCESS_CONSISTENCY_NOTICE,
  EMPLOYEE_ACCESS_RESYNC_ACTION_LABEL,
  EMPLOYEE_ACCESS_STATES,
  EMPLOYEE_ACCESS_STATE_DESCRIPTION,
  EMPLOYEE_ACCESS_STATE_LABEL,
  isAccessResyncApplicable,
  isAdminActionAllowed,
  isEmployeeAccessState,
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
