import { describe, expect, it } from "vitest";

import {
  allowedAdminActions,
  EMPLOYEE_ACCESS_STATES,
  EMPLOYEE_ACCESS_STATE_DESCRIPTION,
  EMPLOYEE_ACCESS_STATE_LABEL,
  isAdminActionAllowed,
  isEmployeeAccessState,
  mapEmployeeAccessError,
} from "./employeeAccessContract";

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
