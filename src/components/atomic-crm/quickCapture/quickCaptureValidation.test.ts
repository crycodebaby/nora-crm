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
    selectedContact: { id: 2 } as QuickCaptureValidationInput["selectedContact"],
    createNewContact: false,
    contactFirstName: "",
    contactLastName: "",
    companyContactsCount: 1,
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

  it("requires contact when no existing contacts", () => {
    const result = validateQuickCaptureForSave({
      ...validBase,
      selectedContact: null,
      createNewContact: true,
      contactFirstName: "",
      contactLastName: "",
      companyContactsCount: 0,
    });
    expect(result.errors.contact).toBe("contact_name_required");
    expect(result.firstInvalidStep).toBe(2);
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
