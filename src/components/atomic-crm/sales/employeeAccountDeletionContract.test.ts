import { describe, expect, it } from "vitest";

import {
  describeBusinessHistory,
  describeEmployeeAccountDeletionSuccess,
  describeProvenance,
  EMPLOYEE_ACCOUNT_DELETION_BLOCK_REASON,
  EMPLOYEE_ACCOUNT_DELETION_DESCRIPTION,
  employeeFullName,
  isAccountDeletionOffered,
  isDeletionConfirmationComplete,
  mapEmployeeAccessError,
  normalizeConfirmationName,
  type EmployeeDeletionPreview,
} from "./employeeAccessContract";

const preview = (
  over: Partial<EmployeeDeletionPreview> = {},
): EmployeeDeletionPreview => ({
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
    emailDeliveryEventsAttributable: 0,
    emailDeliveryEventsForeign: 0,
  },
  ...over,
});

describe("employee account deletion contract (W6-B)", () => {
  it("normalises the typed name exactly like the database: trim + collapse whitespace, case kept", () => {
    expect(normalizeConfirmationName("  Fritz   Fake ")).toBe("Fritz Fake");
    expect(normalizeConfirmationName("fritz fake")).toBe("fritz fake");
    expect(employeeFullName({ first_name: " Fritz ", last_name: "Fake" })).toBe(
      "Fritz Fake",
    );
    expect(employeeFullName({ first_name: null, last_name: null })).toBe("");
  });

  it("completes the confirmation only for the exact current name (and the checkbox for admins)", () => {
    const base = {
      expectedName: "Fritz Fake",
      targetRole: "office" as const,
      adminTargetConfirmed: false,
    };
    expect(
      isDeletionConfirmationComplete({ ...base, typedName: "Fritz Fake" }),
    ).toBe(true);
    expect(
      isDeletionConfirmationComplete({ ...base, typedName: "  Fritz  Fake " }),
    ).toBe(true);
    expect(
      isDeletionConfirmationComplete({ ...base, typedName: "fritz fake" }),
    ).toBe(false);
    expect(
      isDeletionConfirmationComplete({ ...base, typedName: "Fritz Fak" }),
    ).toBe(false);
    expect(isDeletionConfirmationComplete({ ...base, typedName: "" })).toBe(
      false,
    );
    expect(
      isDeletionConfirmationComplete({
        ...base,
        typedName: "Fritz Fake",
        expectedName: "",
      }),
    ).toBe(false);
    // administrator target: the extra checkbox is required in addition
    expect(
      isDeletionConfirmationComplete({
        ...base,
        typedName: "Fritz Fake",
        targetRole: "admin",
      }),
    ).toBe(false);
    expect(
      isDeletionConfirmationComplete({
        ...base,
        typedName: "Fritz Fake",
        targetRole: "admin",
        adminTargetConfirmed: true,
      }),
    ).toBe(true);
  });

  it("offers the destructive control only for a disabled, supported, eligible account", () => {
    expect(
      isAccountDeletionOffered({
        accessState: "disabled",
        deletion: preview(),
      }),
    ).toBe(true);
    expect(
      isAccountDeletionOffered({ accessState: "active", deletion: preview() }),
    ).toBe(false);
    expect(
      isAccountDeletionOffered({ accessState: "invited", deletion: preview() }),
    ).toBe(false);
    expect(
      isAccountDeletionOffered({ accessState: "unknown", deletion: preview() }),
    ).toBe(false);
    expect(
      isAccountDeletionOffered({
        accessState: "disabled",
        deletion: preview({
          eligible: false,
          reasons: ["business_history_exists"],
        }),
      }),
    ).toBe(false);
    expect(
      isAccountDeletionOffered({
        accessState: "disabled",
        deletion: preview({ supported: false }),
      }),
    ).toBe(false);
    expect(isAccountDeletionOffered({ accessState: "disabled" })).toBe(false);
  });

  it("describes all-time business history and provenance in product words", () => {
    expect(
      describeBusinessHistory({
        companies: 2,
        contacts: 0,
        deals: 1,
        tasks: 3,
        contactNotes: 2,
        dealNotes: 1,
      }),
    ).toBe("2 Kunden, 1 Vorgang, 3 Aufgaben und 3 Notizen");
    expect(
      describeBusinessHistory({
        companies: 0,
        contacts: 0,
        deals: 0,
        tasks: 0,
        contactNotes: 0,
        dealNotes: 0,
      }),
    ).toBe("");
    expect(
      describeProvenance({
        checklistTemplates: 1,
        savedTextSnippets: 0,
        googleCalendarConnections: 0,
        auditEventsAsActor: 12,
      }),
    ).toBe(
      "1 Checklisten-Vorlage und 12 eigene Änderungen im Änderungsverlauf",
    );
  });

  it("speaks success only in the two verified dispositions", () => {
    expect(
      describeEmployeeAccountDeletionSuccess(
        { employeeId: 7, disposition: "executed" },
        "Fritz Fake",
      ),
    ).toBe("Das Benutzerkonto von Fritz Fake wurde endgültig gelöscht.");
    expect(
      describeEmployeeAccountDeletionSuccess(
        { employeeId: 7, disposition: "already_deleted" },
        "Fritz Fake",
      ),
    ).toBe("Das Benutzerkonto von Fritz Fake war bereits endgültig gelöscht.");
  });

  it("maps every server code to calm German without technical vocabulary", () => {
    const codes = [
      "self_delete_forbidden",
      "confirmation_mismatch",
      "admin_target_confirmation_required",
      "employee_still_active",
      "business_history_exists",
      "durable_provenance_exists",
      "identity_inconsistent",
      "account_delete_not_authorized",
      "account_delete_provider_failed",
      "account_delete_verification_failed",
      "demo_unsupported",
    ];
    for (const code of codes) {
      const text = mapEmployeeAccessError(new Error(code));
      expect(text).not.toBe(
        mapEmployeeAccessError(new Error("something_else")),
      );
      expect(text).not.toMatch(
        /jwt|token|gotrue|session|auth\.users|sql|ticket|NORA_/i,
      );
    }
    expect(mapEmployeeAccessError(new Error("business_history_exists"))).toBe(
      EMPLOYEE_ACCOUNT_DELETION_BLOCK_REASON.business_history_exists,
    );
  });

  it("never promises a full erasure of personal data", () => {
    expect(EMPLOYEE_ACCOUNT_DELETION_DESCRIPTION).not.toMatch(
      /alle personenbezogenen daten/i,
    );
    expect(EMPLOYEE_ACCOUNT_DELETION_DESCRIPTION).toContain(
      "Einträge im Änderungsverlauf bleiben erhalten",
    );
  });
});
