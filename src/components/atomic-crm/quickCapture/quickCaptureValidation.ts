import type { Contact } from "../types";

export type QuickCaptureStep = 1 | 2 | 3;

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
  selectedContact: Contact | null;
  createNewContact: boolean;
  contactFirstName: string;
  contactLastName: string;
  companyContactsCount: number;
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

  const mustCreateContact =
    input.createNewContact || input.companyContactsCount === 0;

  const hasContact =
    (!mustCreateContact && !!input.selectedContact) ||
    (mustCreateContact &&
      input.contactFirstName.trim().length > 0 &&
      input.contactLastName.trim().length > 0);

  if (!hasContact) {
    errors.contact = "contact_name_required";
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
