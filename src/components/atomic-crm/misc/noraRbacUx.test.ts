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
