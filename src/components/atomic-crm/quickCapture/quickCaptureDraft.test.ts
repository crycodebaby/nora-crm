/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Company } from "../types";
import {
  clearQuickCaptureDraft,
  isDraftEmpty,
  loadQuickCaptureDraft,
  QUICK_CAPTURE_DRAFT_STORAGE_KEY,
  saveQuickCaptureDraft,
  type QuickCaptureDraft,
} from "./quickCaptureDraft";

const baseDraft = (): QuickCaptureDraft => ({
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
  dealTitle: "",
  dealCategory: "fensterservice",
  dealDescription: "",
  sourceChannel: "phone",
  followUpDate: "2026-07-14",
  createTask: false,
  taskType: "rueckruf",
  dismissCustomerSuggestions: false,
  savedAt: "2026-07-14T12:00:00.000Z",
});

describe("quickCaptureDraft", () => {
  afterEach(() => {
    clearQuickCaptureDraft();
    vi.restoreAllMocks();
  });

  it("saves and restores draft from localStorage", () => {
    const draft = baseDraft();
    saveQuickCaptureDraft(draft);

    const loaded = loadQuickCaptureDraft();
    expect(loaded?.searchQuery).toBe("Peter");
    expect(loaded?.step).toBe(1);
    expect(localStorage.getItem(QUICK_CAPTURE_DRAFT_STORAGE_KEY)).toBeTruthy();
  });

  it("clears draft", () => {
    saveQuickCaptureDraft(baseDraft());
    clearQuickCaptureDraft();
    expect(loadQuickCaptureDraft()).toBeNull();
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
    saveQuickCaptureDraft({
      ...baseDraft(),
      selectedCompany: company,
    });
    expect(loadQuickCaptureDraft()?.selectedCompany?.name).toBe("Test GmbH");
  });
});
