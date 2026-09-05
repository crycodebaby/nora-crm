import { describe, expect, it } from "vitest";

import { canAccess } from "../providers/commons/canAccess";
import { SALES_DIRECTORY_REFERENCE_PROPS } from "./salesDirectoryReference";
import {
  SALES_IDENTITIES_RESOURCE,
  formatSalesIdentityName,
} from "./salesIdentityReference";

/**
 * User Lifecycle W2 — two read models, two questions:
 *   sales_directory  -> "Who may I assign new work to?"   (active only)
 *   sales_identities -> "Who owned / wrote this record?"   (disabled included)
 */
describe("employee read-model split (W2)", () => {
  it("assignment pickers and historical lookups use different resources", () => {
    expect(SALES_DIRECTORY_REFERENCE_PROPS.reference).toBe("sales_directory");
    expect(SALES_IDENTITIES_RESOURCE).toBe("sales_identities");
    expect(SALES_IDENTITIES_RESOURCE).not.toBe(
      SALES_DIRECTORY_REFERENCE_PROPS.reference,
    );
  });

  it("formats a historical name truthfully, without an 'ehemalig' relabel", () => {
    expect(
      formatSalesIdentityName({
        first_name: "Erika",
        last_name: "Ehemalig",
      }),
    ).toBe("Erika Ehemalig");
  });

  it("is readable by every active role and never writable", () => {
    for (const role of ["admin", "office", "viewer"] as const) {
      expect(
        canAccess(role, { resource: "sales_identities", action: "list" }),
      ).toBe(true);
      expect(
        canAccess(role, { resource: "sales_identities", action: "show" }),
      ).toBe(true);
      expect(
        canAccess(role, { resource: "sales_directory", action: "list" }),
      ).toBe(true);
    }
    for (const action of ["create", "edit", "delete"] as const) {
      expect(
        canAccess("office", { resource: "sales_identities", action }),
      ).toBe(false);
      expect(
        canAccess("viewer", { resource: "sales_identities", action }),
      ).toBe(false);
    }
  });
});
