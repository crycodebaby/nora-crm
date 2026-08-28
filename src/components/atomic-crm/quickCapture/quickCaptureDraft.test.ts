/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Company } from "../types";
import {
  clearQuickCaptureDraft,
  CURRENT_DRAFT_SCHEMA_VERSION,
  hasQuickCaptureDraft,
  isDraftEmpty,
  loadQuickCaptureDraft,
  purgeLegacyGlobalQuickCaptureDraft,
  quickCaptureDraftStorageKey,
  saveQuickCaptureDraft,
  type QuickCaptureDraft,
} from "./quickCaptureDraft";

const USER_A = "sales-1";
const USER_B = "sales-2";

const baseDraft = (): QuickCaptureDraft => ({
  schemaVersion: CURRENT_DRAFT_SCHEMA_VERSION,
  step: 1,
  searchQuery: "Peter",
  selectedCompany: null,
  createNewCompany: false,
  newCompanyName: "",
  selectedContact: null,
  createNewContact: false,
  contactFirstName: "",
  contactLastName: "",
  contactPhone: "",
  contactEmail: "",
  markNewContactPrimary: true,
  dealTitle: "",
  dealCategory: "fensterservice",
  dealDescription: "",
  sourceChannel: "phone",
  followUpDate: "2026-07-14",
  createTask: false,
  taskType: "rueckruf",
  dismissCustomerSuggestions: false,
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  savedAt: "2026-07-14T12:00:00.000Z",
  updatedAt: "2026-07-14T12:00:00.000Z",
});

describe("quickCaptureDraft", () => {
  afterEach(() => {
    clearQuickCaptureDraft(USER_A);
    clearQuickCaptureDraft(USER_B);
    localStorage.removeItem("nora-quick-capture-draft");
    vi.restoreAllMocks();
  });

  it("saves and restores draft from localStorage, scoped per user", () => {
    const draft = baseDraft();
    saveQuickCaptureDraft(USER_A, draft);

    const loaded = loadQuickCaptureDraft(USER_A);
    expect(loaded?.searchQuery).toBe("Peter");
    expect(loaded?.step).toBe(1);
    expect(
      localStorage.getItem(quickCaptureDraftStorageKey(USER_A)),
    ).toBeTruthy();
  });

  it("keeps drafts isolated between different users", () => {
    saveQuickCaptureDraft(USER_A, { ...baseDraft(), searchQuery: "A-Kunde" });
    saveQuickCaptureDraft(USER_B, { ...baseDraft(), searchQuery: "B-Kunde" });

    expect(loadQuickCaptureDraft(USER_A)?.searchQuery).toBe("A-Kunde");
    expect(loadQuickCaptureDraft(USER_B)?.searchQuery).toBe("B-Kunde");

    clearQuickCaptureDraft(USER_A);
    expect(loadQuickCaptureDraft(USER_A)).toBeNull();
    expect(loadQuickCaptureDraft(USER_B)?.searchQuery).toBe("B-Kunde");
  });

  it("clears draft", () => {
    saveQuickCaptureDraft(USER_A, baseDraft());
    clearQuickCaptureDraft(USER_A);
    expect(loadQuickCaptureDraft(USER_A)).toBeNull();
  });

  it("detects empty draft", () => {
    expect(isDraftEmpty(baseDraft())).toBe(false);
    expect(
      isDraftEmpty({
        ...baseDraft(),
        searchQuery: "",
        dealTitle: "",
      }),
    ).toBe(true);
  });

  it("persists selected company snapshot", () => {
    const company = { id: 3, name: "Test GmbH" } as Company;
    saveQuickCaptureDraft(USER_A, {
      ...baseDraft(),
      selectedCompany: company,
    });
    expect(loadQuickCaptureDraft(USER_A)?.selectedCompany?.name).toBe(
      "Test GmbH",
    );
  });

  it("treats a draft with a mismatched schemaVersion as no draft", () => {
    localStorage.setItem(
      quickCaptureDraftStorageKey(USER_A),
      JSON.stringify({ ...baseDraft(), schemaVersion: 1 }),
    );
    expect(loadQuickCaptureDraft(USER_A)).toBeNull();
  });

  it("treats a draft older than the staleness threshold as no draft", () => {
    const eightDaysAgo = new Date(
      Date.now() - 8 * 24 * 60 * 60 * 1000,
    ).toISOString();
    localStorage.setItem(
      quickCaptureDraftStorageKey(USER_A),
      JSON.stringify({ ...baseDraft(), updatedAt: eightDaysAgo }),
    );
    expect(loadQuickCaptureDraft(USER_A)).toBeNull();
  });

  it("keeps a draft within the staleness threshold", () => {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    saveQuickCaptureDraft(USER_A, { ...baseDraft(), updatedAt: oneDayAgo });
    // saveQuickCaptureDraft always stamps updatedAt=now, so re-write raw to
    // simulate an aged-but-still-fresh draft.
    localStorage.setItem(
      quickCaptureDraftStorageKey(USER_A),
      JSON.stringify({ ...baseDraft(), updatedAt: oneDayAgo }),
    );
    expect(loadQuickCaptureDraft(USER_A)).not.toBeNull();
  });

  it("regression: userId = 0 (default demo admin identity.id) is a valid scope, not treated as absent", () => {
    // identity.id = 0 must not be confused with "no identity" — callers must
    // use `identity?.id == null`, never `!identity?.id` (Falsy-ID Guardrail,
    // 03-data-model-guardrails.md).
    expect(quickCaptureDraftStorageKey(0)).toBe("nora-quick-capture-draft:0");
    saveQuickCaptureDraft(0, { ...baseDraft(), searchQuery: "Admin-Draft" });
    expect(loadQuickCaptureDraft(0)?.searchQuery).toBe("Admin-Draft");
    expect(hasQuickCaptureDraft(0)).toBe(true);
    clearQuickCaptureDraft(0);
    expect(loadQuickCaptureDraft(0)).toBeNull();
  });

  it("purges the legacy global draft key without assigning it to any user", () => {
    localStorage.setItem(
      "nora-quick-capture-draft",
      JSON.stringify(baseDraft()),
    );
    purgeLegacyGlobalQuickCaptureDraft();
    expect(localStorage.getItem("nora-quick-capture-draft")).toBeNull();
    // Never migrated into a user-scoped key — ownership isn't determinable.
    expect(loadQuickCaptureDraft(USER_A)).toBeNull();
  });
});
