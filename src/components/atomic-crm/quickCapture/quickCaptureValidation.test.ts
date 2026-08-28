/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { validateQuickCaptureForSave } from "./quickCaptureValidation";
import type { QuickCaptureValidationInput } from "./quickCaptureValidation";

describe("validateQuickCaptureForSave", () => {
  const validBase: QuickCaptureValidationInput = {
    selectedCompany: { id: 1 },
    createNewCompany: false,
    newCompanyName: "",
    contactMode: "existing",
    selectedContact: {
      id: 2,
    } as QuickCaptureValidationInput["selectedContact"],
    contactFirstName: "",
    contactLastName: "",
    dealTitle: "Fenster defekt",
    dealCategory: "fensterservice",
  };

  it("passes when all required fields present", () => {
    const result = validateQuickCaptureForSave(validBase);
    expect(result.valid).toBe(true);
    expect(result.firstInvalidStep).toBeNull();
  });

  it("requires customer on step 1", () => {
    const result = validateQuickCaptureForSave({
      ...validBase,
      selectedCompany: null,
      createNewCompany: false,
      newCompanyName: "",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.customer).toBe("company_name_required");
    expect(result.firstInvalidStep).toBe(1);
  });

  it("accepts new company name", () => {
    const result = validateQuickCaptureForSave({
      ...validBase,
      selectedCompany: null,
      createNewCompany: true,
      newCompanyName: "Neuer Kunde",
    });
    expect(result.errors.customer).toBeUndefined();
  });

  it("requires an explicit contact choice — undecided is invalid", () => {
    const result = validateQuickCaptureForSave({
      ...validBase,
      contactMode: null,
      selectedContact: null,
    });
    expect(result.errors.contact).toBe("contact_selection_required");
    expect(result.firstInvalidStep).toBe(2);
  });

  it("requires first/last name when creating a new contact", () => {
    const result = validateQuickCaptureForSave({
      ...validBase,
      contactMode: "new",
      selectedContact: null,
      contactFirstName: "",
      contactLastName: "",
    });
    expect(result.errors.contact).toBe("contact_selection_required");
  });

  it("accepts a new contact once first/last name are filled", () => {
    const result = validateQuickCaptureForSave({
      ...validBase,
      contactMode: "new",
      selectedContact: null,
      contactFirstName: "Max",
      contactLastName: "Mustermann",
    });
    expect(result.errors.contact).toBeUndefined();
  });

  it("accepts a deliberate 'none' contact choice", () => {
    const result = validateQuickCaptureForSave({
      ...validBase,
      contactMode: "none",
      selectedContact: null,
    });
    expect(result.errors.contact).toBeUndefined();
  });

  it("requires deal title and category on step 3", () => {
    const result = validateQuickCaptureForSave({
      ...validBase,
      dealTitle: "",
      dealCategory: "",
    });
    expect(result.errors.dealTitle).toBe("deal_title_required");
    expect(result.errors.dealCategory).toBe("deal_category_required");
    expect(result.firstInvalidStep).toBe(3);
  });
});
