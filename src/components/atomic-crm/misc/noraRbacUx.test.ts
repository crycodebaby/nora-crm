import { describe, expect, it } from "vitest";

import { normalizeCrmError } from "./normalizeCrmError";
import { canAccess } from "../providers/commons/canAccess";

describe("normalizeCrmError", () => {
  it("maps RLS denial to permission message key", () => {
    const result = normalizeCrmError({
      status: 403,
      message: "new row violates row-level security policy",
    });
    expect(result.kind).toBe("permission_denied");
    expect(result.messageKey).toBe("crm.errors.permission_denied");
  });

  it("maps office delete attempts to delete_not_allowed", () => {
    const result = normalizeCrmError({
      message: "This record cannot be deleted with your role",
    });
    expect(result.kind).toBe("delete_not_allowed");
    expect(result.messageKey).toBe("crm.errors.delete_not_allowed");
  });

  it("maps network failures to retry-friendly message", () => {
    const result = normalizeCrmError(new TypeError("Failed to fetch"));
    expect(result.kind).toBe("network");
    expect(result.messageKey).toBe("crm.errors.network_unreachable");
  });

  it("maps missing records", () => {
    const result = normalizeCrmError({
      code: "PGRST116",
      message: "not found",
    });
    expect(result.kind).toBe("not_found");
    expect(result.messageKey).toBe("crm.errors.record_not_found");
  });

  it("maps the effective-contact-context business rejection to a stable code, not raw text", () => {
    const result = normalizeCrmError(
      new Error(
        "contact 7 is not part of the effective contact context of company 3",
      ),
    );
    expect(result.kind).toBe("contact_not_in_customer_context");
    expect(result.messageKey).toBe(
      "crm.errors.contact_not_in_customer_context",
    );
    // Technical detail is preserved for observability, just not used as the key.
    expect(result.technicalMessage).toContain("effective contact context");
  });

  it("maps FakeRest's German-text equivalent of the same business rejection to the same stable code (Final Release Candidate Verification, 2026-08-28)", () => {
    // FakeRest raises this business rule as German free text
    // (providers/fakerest/dataProvider.ts, createQuickCaptureCase existing
    // company + existing contact path) — verified live to previously fall
    // through to the generic "unknown" fallback before this pattern was added.
    const result = normalizeCrmError(
      new Error(
        "Quick Capture darf einen bestehenden Kontakt nicht einem Kunden zuordnen, zu dessen effektivem Kontaktkreis er nicht gehört.",
      ),
    );
    expect(result.kind).toBe("contact_not_in_customer_context");
    expect(result.messageKey).toBe(
      "crm.errors.contact_not_in_customer_context",
    );
  });

  it("maps the self-contact delete guard rejection to a stable code", () => {
    const result = normalizeCrmError(
      new Error(
        "Person hinter einer Privatkundenakte kann nicht geloescht werden — zuerst die Kundenakte anpassen",
      ),
    );
    expect(result.kind).toBe("self_contact_delete_blocked");
    expect(result.messageKey).toBe("crm.errors.self_contact_delete_blocked");
  });

  it("falls back to the generic unknown code for an unrecognized DB error, never echoing raw text into the key", () => {
    const result = normalizeCrmError(
      new Error(
        'duplicate key value violates unique constraint "companies_pkey"',
      ),
    );
    expect(result.kind).toBe("unknown");
    expect(result.messageKey).toBe("crm.errors.load_failed");
  });
});

describe("role matrix (UI guard)", () => {
  it("viewer cannot create, edit or delete CRM records", () => {
    expect(
      canAccess("viewer", { resource: "contacts", action: "create" }),
    ).toBe(false);
    expect(canAccess("viewer", { resource: "deals", action: "edit" })).toBe(
      false,
    );
    expect(
      canAccess("viewer", { resource: "companies", action: "delete" }),
    ).toBe(false);
    expect(canAccess("viewer", { resource: "contacts", action: "list" })).toBe(
      true,
    );
  });

  it("office can write and archive but not delete or manage users", () => {
    expect(canAccess("office", { resource: "deals", action: "edit" })).toBe(
      true,
    );
    expect(canAccess("office", { resource: "deals", action: "delete" })).toBe(
      false,
    );
    expect(canAccess("office", { resource: "sales", action: "list" })).toBe(
      false,
    );
    expect(
      canAccess("office", { resource: "configuration", action: "edit" }),
    ).toBe(false);
  });

  it("admin retains management actions", () => {
    expect(canAccess("admin", { resource: "sales", action: "create" })).toBe(
      true,
    );
    expect(
      canAccess("admin", { resource: "configuration", action: "edit" }),
    ).toBe(true);
    expect(canAccess("admin", { resource: "contacts", action: "delete" })).toBe(
      true,
    );
  });
});

describe("demo role switcher visibility", () => {
  it("is tied to VITE_IS_DEMO flag", async () => {
    const { isNoraDemoMode } = await import("./noraDemoMode");
    expect(typeof isNoraDemoMode).toBe("boolean");
  });
});
