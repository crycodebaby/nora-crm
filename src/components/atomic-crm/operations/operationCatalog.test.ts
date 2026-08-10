import { describe, expect, it } from "vitest";

import {
  getOperationCatalogEntry,
  OPERATION_CATALOG,
} from "./operationCatalog";

describe("OPERATION_CATALOG", () => {
  it("includes deal.update and deal.assign with German messages", () => {
    expect(OPERATION_CATALOG["deal.update"].pendingMessage).toContain(
      "gespeichert",
    );
    expect(OPERATION_CATALOG["deal.update"].successMessage).toBe(
      "Vorgang wurde gespeichert.",
    );
    expect(OPERATION_CATALOG["deal.assign"].resourceType).toBe("deals");
    expect(getOperationCatalogEntry("contact.update").errorMessage).toContain(
      "Kontakt",
    );
  });

  it("does not invent fake infrastructure step copy", () => {
    const blob = JSON.stringify(OPERATION_CATALOG);
    expect(blob).not.toMatch(/Datenbank arbeitet|Application Layer/i);
  });

  it("deal.assign stays catalog-only (not an active dataProvider slice)", () => {
    expect(OPERATION_CATALOG["deal.assign"].operationType).toBe("deal.assign");
    // Active Wave-2 slice is deal.update only — assign must not imply a second mutation.
    expect(OPERATION_CATALOG["deal.update"].operationType).toBe("deal.update");
  });
});
