import type { Company, Contact } from "../types";
import type {
  QuickCaptureSourceChannel,
  QuickCaptureTaskOption,
} from "./quickCaptureUtils";

/**
 * Self Contact Wave (2026-08-26): per-user scoped key. The previous global
 * key (no user scope) is retired on first load — its historical ownership
 * is not determinable across users on a shared machine/browser profile, so
 * it is never migrated/assigned to whichever user happens to load next,
 * only safely removed.
 */
const LEGACY_GLOBAL_DRAFT_STORAGE_KEY = "nora-quick-capture-draft";
export const quickCaptureDraftStorageKey = (userId: unknown): string =>
  `nora-quick-capture-draft:${String(userId)}`;

/** Bump when the draft shape changes incompatibly — an old-shaped draft is treated as "no draft" rather than risking a runtime error on load. */
export const CURRENT_DRAFT_SCHEMA_VERSION = 3;

/** A draft older than this is treated as stale and silently discarded rather than surprising the user with old data. */
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type QuickCaptureStep = 1 | 2 | 3;

/** Serializable quick-capture state — stored locally in the browser only. */
export type QuickCaptureDraft = {
  schemaVersion: number;
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
  markNewContactPrimary: boolean;
  dealTitle: string;
  dealCategory: string;
  dealDescription: string;
  sourceChannel: QuickCaptureSourceChannel;
  followUpDate: string;
  createTask: boolean;
  taskType: QuickCaptureTaskOption;
  dismissCustomerSuggestions: boolean;
  /**
   * Idempotency Wave (2026-08-29): stable write-intent id for this Quick
   * Capture attempt, minted once and persisted with the draft so a
   * reload/resume retry reuses the SAME key (not a new one — see
   * docs/nora/06-decision-log.md "Idempotency Wave" Key Contract). Cleared
   * together with the draft on success or explicit discard.
   */
  idempotencyKey: string;
  savedAt: string;
  updatedAt: string;
};

export function saveQuickCaptureDraft(
  userId: unknown,
  draft: QuickCaptureDraft,
): void {
  try {
    const now = new Date().toISOString();
    localStorage.setItem(
      quickCaptureDraftStorageKey(userId),
      JSON.stringify({
        ...draft,
        schemaVersion: CURRENT_DRAFT_SCHEMA_VERSION,
        savedAt: now,
        updatedAt: now,
      }),
    );
  } catch {
    // Ignore quota / private-mode errors
  }
}

export function loadQuickCaptureDraft(
  userId: unknown,
): QuickCaptureDraft | null {
  try {
    const raw = localStorage.getItem(quickCaptureDraftStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as QuickCaptureDraft;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.schemaVersion !== CURRENT_DRAFT_SCHEMA_VERSION) return null;
    if (parsed.step !== 1 && parsed.step !== 2 && parsed.step !== 3)
      return null;
    const updatedAt = Date.parse(parsed.updatedAt ?? "");
    if (!Number.isNaN(updatedAt) && Date.now() - updatedAt > DRAFT_MAX_AGE_MS) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearQuickCaptureDraft(userId: unknown): void {
  try {
    localStorage.removeItem(quickCaptureDraftStorageKey(userId));
  } catch {
    // ignore
  }
}

/** Removes the pre-Self-Contact-Wave global draft key without ever assigning its content to a user — call once per app/dialog lifecycle. */
export function purgeLegacyGlobalQuickCaptureDraft(): void {
  try {
    localStorage.removeItem(LEGACY_GLOBAL_DRAFT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function hasQuickCaptureDraft(userId: unknown): boolean {
  return loadQuickCaptureDraft(userId) !== null;
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
