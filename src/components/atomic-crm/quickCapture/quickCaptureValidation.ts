import type { Contact } from "../types";

export type QuickCaptureStep = 1 | 2 | 3;

export type QuickCaptureContactMode = "existing" | "new" | "none" | null;

export type QuickCaptureFieldErrors = {
  customer?: string;
  contact?: string;
  dealTitle?: string;
  dealCategory?: string;
};

export type QuickCaptureValidationInput = {
  selectedCompany: { id: unknown } | null;
  createNewCompany: boolean;
  newCompanyName: string;
  contactMode: QuickCaptureContactMode;
  selectedContact: Contact | null;
  contactFirstName: string;
  contactLastName: string;
  dealTitle: string;
  dealCategory: string;
};

export type QuickCaptureValidationResult = {
  valid: boolean;
  errors: QuickCaptureFieldErrors;
  firstInvalidStep: QuickCaptureStep | null;
};

export function validateQuickCaptureForSave(
  input: QuickCaptureValidationInput,
): QuickCaptureValidationResult {
  const errors: QuickCaptureFieldErrors = {};

  const hasCustomer =
    (!!input.selectedCompany && !input.createNewCompany) ||
    (input.createNewCompany && input.newCompanyName.trim().length > 0);

  if (!hasCustomer) {
    errors.customer = "company_name_required";
  }

  // "none" is a deliberate, valid choice — Quick Capture step 2 requires an
  // explicit decision (existing/new/none), not an implicit default.
  const hasContact =
    input.contactMode === "none" ||
    (input.contactMode === "existing" && !!input.selectedContact) ||
    (input.contactMode === "new" &&
      input.contactFirstName.trim().length > 0 &&
      input.contactLastName.trim().length > 0);

  if (!hasContact) {
    errors.contact = "contact_selection_required";
  }

  if (!input.dealTitle.trim()) {
    errors.dealTitle = "deal_title_required";
  }

  if (!input.dealCategory.trim()) {
    errors.dealCategory = "deal_category_required";
  }

  const firstInvalidStep: QuickCaptureStep | null = errors.customer
    ? 1
    : errors.contact
      ? 2
      : errors.dealTitle || errors.dealCategory
        ? 3
        : null;

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    firstInvalidStep,
  };
}
