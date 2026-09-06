import { describe, expect, it } from "vitest";

import {
  countOpenResponsibilities,
  describeEmployeeOffboardingSuccess,
  describeOffboardingFollowUp,
  describeOpenResponsibilities,
  EMPTY_DEPENDENCY_PREVIEW,
  isOffboardingApplicable,
  mapEmployeeAccessError,
  type EmployeeAccessRecord,
  type EmployeeDependencyPreview,
} from "./employeeAccessContract";

const deps = (
  over: Partial<EmployeeDependencyPreview> = {},
): EmployeeDependencyPreview => ({ ...EMPTY_DEPENDENCY_PREVIEW, ...over });

const record = (
  over: Partial<EmployeeAccessRecord> = {},
): EmployeeAccessRecord => ({
  employeeId: 7,
  email: "eva.e@ergart.de",
  accessState: "active",
  disabled: false,
  noraDisabled: false,
  accessConsistency: "consistent",
  identityConsistency: "consistent",
  invitedAt: null,
  activatedAt: "2026-09-02T09:00:00.000Z",
  ...over,
});

describe("offboarding contract (W5 client mirror)", () => {
  it("is offered for invited and active employees only", () => {
    expect(isOffboardingApplicable({ accessState: "invited" })).toBe(true);
    expect(isOffboardingApplicable({ accessState: "active" })).toBe(true);
    expect(isOffboardingApplicable({ accessState: "disabled" })).toBe(false);
    expect(isOffboardingApplicable({ accessState: "unknown" })).toBe(false);
  });

  it("counts current responsibility, never notes", () => {
    expect(
      countOpenResponsibilities(
        deps({
          companies: 1,
          contacts: 2,
          openDeals: 3,
          openTasks: 4,
          contactNotes: 99,
          dealNotes: 99,
        }),
      ),
    ).toBe(10);
    expect(countOpenResponsibilities(deps({ contactNotes: 5 }))).toBe(0);
  });

  it("names only the non-zero parts in product words", () => {
    expect(describeOpenResponsibilities(deps())).toBe("");
    expect(describeOpenResponsibilities(deps({ openDeals: 1 }))).toBe(
      "1 Vorgang",
    );
    expect(
      describeOpenResponsibilities(deps({ openDeals: 3, openTasks: 5 })),
    ).toBe("3 Vorgänge und 5 offene Aufgaben");
    expect(
      describeOpenResponsibilities(
        deps({ companies: 1, contacts: 2, openDeals: 3, openTasks: 1 }),
      ),
    ).toBe("1 Kunde, 2 Kontakte, 3 Vorgänge und 1 offene Aufgabe");
  });

  it("phrases the follow-up as a recommendation, never a precondition", () => {
    expect(
      describeOffboardingFollowUp(deps({ openDeals: 3, openTasks: 5 })),
    ).toBe(
      "Es bestehen noch 3 Vorgänge und 5 offene Aufgaben, die anschließend neu zugewiesen werden sollten.",
    );
    expect(describeOffboardingFollowUp(deps({ contacts: 1 }))).toBe(
      "Es besteht noch 1 Kontakt, die anschließend neu zugewiesen werden sollten.",
    );
    expect(describeOffboardingFollowUp(deps({ dealNotes: 4 }))).toBe(
      "Es bestehen keine Kunden, Kontakte, Vorgänge oder offenen Aufgaben, die neu zugewiesen werden müssten.",
    );
  });

  it("success copy distinguishes executed from replayed and names open work", () => {
    const rec = record({ accessState: "disabled", disabled: true });
    expect(
      describeEmployeeOffboardingSuccess({
        record: rec,
        disposition: "executed",
        sessionsRevoked: 2,
        dependencies: deps({ openTasks: 2 }),
      }),
    ).toBe(
      "Der Nora-Zugang wurde beendet. Es bestehen noch 2 offene Aufgaben, die anschließend neu zugewiesen werden sollten.",
    );
    expect(
      describeEmployeeOffboardingSuccess({
        record: rec,
        disposition: "replayed",
        sessionsRevoked: 0,
        dependencies: deps(),
      }),
    ).toBe(
      "Der Nora-Zugang war bereits beendet. Es sind keine Zuweisungen offen.",
    );
  });

  it("maps the offboarding failure modes to calm copy without technical vocabulary", () => {
    for (const code of [
      "self_access_change_forbidden",
      "last_active_admin_required",
      "employee_access_sync_incomplete",
      "access_action_forbidden",
      "not_found",
      "audit_write_failed",
    ]) {
      const text = mapEmployeeAccessError(new Error(code));
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toMatch(/jwt|token|gotrue|session_id|ban/i);
    }
  });
});
