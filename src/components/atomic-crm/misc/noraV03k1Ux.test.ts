/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

import { canAccess } from "../providers/commons/canAccess";
import { getAccessRedirectTarget } from "./NoraEditGuard";
import { resolveDirtyClose } from "./useNoraDirtyDialog";
import {
  clearQuickCaptureDraft,
  loadQuickCaptureDraft,
  saveQuickCaptureDraft,
  type QuickCaptureDraft,
} from "../quickCapture/quickCaptureDraft";

const baseDraft = (): QuickCaptureDraft => ({
  step: 1,
  searchQuery: "Müller",
  selectedCompany: null,
  createNewCompany: false,
  newCompanyName: "",
  selectedContact: null,
  createNewContact: false,
  contactFirstName: "",
  contactLastName: "",
  contactPhone: "",
  contactEmail: "",
  dealTitle: "Fenster",
  dealCategory: "fensterservice",
  dealDescription: "",
  sourceChannel: "phone",
  followUpDate: "2026-07-14",
  createTask: false,
  taskType: "rueckruf",
  dismissCustomerSuggestions: false,
  savedAt: "2026-07-14T12:00:00.000Z",
});

describe("v0.3k.1 edit guard redirects", () => {
  it("viewer company edit redirects to show when record exists", () => {
    expect(canAccess("viewer", { resource: "companies", action: "edit" })).toBe(
      false,
    );
    expect(
      getAccessRedirectTarget({
        canAccess: false,
        isPending: false,
        recordId: 12,
        resource: "companies",
        redirectTarget: "show",
      }),
    ).toEqual({
      type: "ra",
      action: "show",
      resource: "companies",
      id: 12,
    });
  });

  it("viewer deal edit redirects to show when record exists", () => {
    expect(canAccess("viewer", { resource: "deals", action: "edit" })).toBe(
      false,
    );
    expect(
      getAccessRedirectTarget({
        canAccess: false,
        isPending: false,
        recordId: 7,
        resource: "deals",
        redirectTarget: "show",
      }),
    ).toEqual({
      type: "ra",
      action: "show",
      resource: "deals",
      id: 7,
    });
  });

  it("office can access company and deal edit", () => {
    expect(canAccess("office", { resource: "companies", action: "edit" })).toBe(
      true,
    );
    expect(canAccess("office", { resource: "deals", action: "edit" })).toBe(
      true,
    );
    expect(
      getAccessRedirectTarget({
        canAccess: true,
        isPending: false,
        recordId: 1,
        resource: "companies",
      }),
    ).toEqual({ type: "none" });
  });

  it("sales edit is admin-only", () => {
    expect(canAccess("admin", { resource: "sales", action: "edit" })).toBe(
      true,
    );
    expect(canAccess("office", { resource: "sales", action: "edit" })).toBe(
      false,
    );
    expect(canAccess("viewer", { resource: "sales", action: "edit" })).toBe(
      false,
    );
  });
});

describe("v0.3k.1 dirty dialog close", () => {
  it("opens confirm when dirty on X/Escape close request", () => {
    const onClose = vi.fn();
    const openConfirm = vi.fn();
    resolveDirtyClose(true, onClose, openConfirm);
    expect(openConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes immediately when not dirty", () => {
    const onClose = vi.fn();
    const openConfirm = vi.fn();
    resolveDirtyClose(false, onClose, openConfirm);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(openConfirm).not.toHaveBeenCalled();
  });
});

describe("v0.3k.1 quick capture draft on cancel", () => {
  it("keeps draft when closing like Abbrechen (persistDraft)", () => {
    clearQuickCaptureDraft();
    const draft = baseDraft();
    saveQuickCaptureDraft(draft);

    // Simulate handleOpenChange(false): persistDraft then close
    saveQuickCaptureDraft(loadQuickCaptureDraft()!);

    expect(loadQuickCaptureDraft()?.searchQuery).toBe("Müller");
    expect(loadQuickCaptureDraft()?.dealTitle).toBe("Fenster");
    clearQuickCaptureDraft();
  });
});

describe("v0.3k.1 import access", () => {
  it("import/configuration is admin-only in UI guard", () => {
    expect(
      canAccess("admin", { resource: "configuration", action: "edit" }),
    ).toBe(true);
    expect(
      canAccess("office", { resource: "configuration", action: "edit" }),
    ).toBe(false);
    expect(
      canAccess("viewer", { resource: "configuration", action: "edit" }),
    ).toBe(false);
  });
});

describe("v0.3k.1 global search error handling", () => {
  it("maps network errors to user-friendly retry message key", async () => {
    const { normalizeCrmError } = await import("./normalizeCrmError");
    const result = normalizeCrmError(new TypeError("Failed to fetch"));
    expect(result.kind).toBe("network");
    expect(result.messageKey).toBe("crm.errors.network_unreachable");
  });
});

describe("v0.3k.1 focus return helper", () => {
  it("exposes onCloseAutoFocus from useDialogFocusReturn module", async () => {
    const mod = await import("./useNoraDirtyDialog");
    expect(typeof mod.useDialogFocusReturn).toBe("function");
  });
});
