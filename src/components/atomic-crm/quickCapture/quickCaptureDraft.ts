import type { Company, Contact } from "../types";
import type {
  QuickCaptureSourceChannel,
  QuickCaptureTaskOption,
} from "./quickCaptureUtils";

export const QUICK_CAPTURE_DRAFT_STORAGE_KEY = "nora-quick-capture-draft";

export type QuickCaptureStep = 1 | 2 | 3;

/** Serializable quick-capture state — stored locally in the browser only. */
export type QuickCaptureDraft = {
  step: QuickCaptureStep;
  searchQuery: string;
  selectedCompany: Company | null;
  createNewCompany: boolean;
  newCompanyName: string;
  selectedContact: Contact | null;
  createNewContact: boolean;
  contactFirstName: string;
  contactLastName: string;
  contactPhone: string;
  contactEmail: string;
  dealTitle: string;
  dealCategory: string;
  dealDescription: string;
  sourceChannel: QuickCaptureSourceChannel;
  followUpDate: string;
  createTask: boolean;
  taskType: QuickCaptureTaskOption;
  dismissCustomerSuggestions: boolean;
  savedAt: string;
};

export function saveQuickCaptureDraft(draft: QuickCaptureDraft): void {
  try {
    localStorage.setItem(
      QUICK_CAPTURE_DRAFT_STORAGE_KEY,
      JSON.stringify({ ...draft, savedAt: new Date().toISOString() }),
    );
  } catch {
    // Ignore quota / private-mode errors
  }
}

export function loadQuickCaptureDraft(): QuickCaptureDraft | null {
  try {
    const raw = localStorage.getItem(QUICK_CAPTURE_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as QuickCaptureDraft;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.step !== 1 && parsed.step !== 2 && parsed.step !== 3)
      return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearQuickCaptureDraft(): void {
  try {
    localStorage.removeItem(QUICK_CAPTURE_DRAFT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function hasQuickCaptureDraft(): boolean {
  return loadQuickCaptureDraft() !== null;
}

export function isDraftEmpty(draft: QuickCaptureDraft): boolean {
  return (
    !draft.searchQuery.trim() &&
    !draft.selectedCompany &&
    !draft.createNewCompany &&
    !draft.newCompanyName.trim() &&
    !draft.selectedContact &&
    !draft.createNewContact &&
    !draft.contactFirstName.trim() &&
    !draft.contactLastName.trim() &&
    !draft.contactPhone.trim() &&
    !draft.contactEmail.trim() &&
    !draft.dealTitle.trim() &&
    !draft.dealDescription.trim() &&
    !draft.createTask
  );
}
