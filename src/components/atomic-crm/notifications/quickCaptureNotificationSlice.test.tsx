/**
 * Phase 7B.4 — the Quick Capture vertical slice, driven through the real
 * dialog.
 *
 * This is deliberately NOT a component test of the card: it mounts the real
 * QuickCaptureDialog, the real NotificationProvider/Outlet and the legacy
 * sonner <Notification /> side by side, then fills in and submits the form
 * like a user would. That is the only way to prove the two claims that
 * matter for this wave:
 *
 * - exactly ONE visible feedback layer per Quick Capture submit, and
 * - the card survives the dialog closing and the redirect that follows.
 */

import { CoreAdminContext, TestMemoryRouter, useNotify } from "ra-core";
import polyglotI18nProvider from "ra-i18n-polyglot";
import englishMessages from "ra-language-english";
import { mergeTranslations } from "ra-core";
import fakeDataProvider from "ra-data-fakerest";
import type { AuthProvider } from "ra-core";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import "@/index.css";
import { Notification } from "@/components/admin/notification";
import { NORA_ERROR_CODES } from "../domain/noraErrorCodes";
import { executeCreateQuickCaptureCase } from "../operations/executeCreateQuickCaptureCase";
import { executeCreateQuickCaptureTask } from "../operations/executeCreateQuickCaptureTask";
import { NORA_OPERATION_ID_HEADER } from "../operations/operationContext";
import { OperationProvider } from "../operations/OperationProvider";
import {
  createOperationManager,
  type OperationManager,
} from "../operations/operationManager";
import { germanCrmMessages } from "../providers/commons/germanCrmMessages";
import { QuickCaptureDialog } from "../quickCapture/QuickCaptureDialog";
import { NoraNotificationOutlet } from "./NoraNotificationOutlet";
import { NotificationProvider } from "./NotificationProvider";

const catalog = mergeTranslations(englishMessages, germanCrmMessages);
const i18nProvider = polyglotI18nProvider(() => catalog, "de", [
  { locale: "de", name: "Deutsch" },
]);

const authProvider: AuthProvider = {
  login: () => Promise.resolve(),
  logout: () => Promise.resolve(),
  checkAuth: () => Promise.resolve(),
  checkError: () => Promise.resolve(),
  getPermissions: () => Promise.resolve("admin"),
  getIdentity: () => Promise.resolve({ id: 1, fullName: "Office Nora" }),
};

const CASE_RESULT = { company_id: 1, contact_id: null, deal_id: 42 };
const TASK_RESULT = { task_id: 7 };

type Outcome = "ok" | { errorCode: string };

type Behavior = { core?: Outcome; task?: Outcome };

const headers: string[] = [];

const rpc =
  (outcome: Outcome, payload: Record<string, unknown>) =>
  (_fn: string, _args: Record<string, unknown>) => ({
    setHeader: async (name: string, value: string) => {
      if (name === NORA_OPERATION_ID_HEADER) headers.push(value);
      if (typeof outcome === "object") {
        const error = new Error("rpc failed") as Error & { details: string };
        error.details = outcome.errorCode;
        return { data: null, error };
      }
      return { data: payload, error: null };
    },
  });

const buildDataProvider = (manager: OperationManager, behavior: Behavior) => {
  const base = fakeDataProvider({
    companies: [],
    contacts: [],
    deals: [],
    tasks: [],
    sales: [{ id: 1, first_name: "Office", last_name: "Nora" }],
    tags: [],
  });
  return {
    ...base,
    createQuickCaptureCase: (params: Record<string, unknown>) =>
      executeCreateQuickCaptureCase(
        params as never,
        rpc(behavior.core ?? "ok", CASE_RESULT) as never,
        manager,
      ),
    createQuickCaptureTask: (params: Record<string, unknown>) =>
      executeCreateQuickCaptureTask(
        params as never,
        rpc(behavior.task ?? "ok", TASK_RESULT) as never,
        manager,
      ),
  } as never;
};

/** A still-unmigrated flow, so the sonner regression is checked for real. */
const LegacyNotifyButton = () => {
  const notify = useNotify();
  return (
    <button
      type="button"
      data-testid="legacy-notify"
      onClick={() =>
        notify("crm.quick_capture.draft_restored", { type: "info" })
      }
    >
      legacy
    </button>
  );
};

/** Mirrors the real Layout: dialog inside, both feedback layers as siblings. */
const Harness = ({
  manager,
  behavior,
  locations,
}: {
  manager: OperationManager;
  behavior: Behavior;
  locations: string[];
}) => {
  const [open, setOpen] = useState(true);
  return (
    <TestMemoryRouter
      locationCallback={(location) => locations.push(location.pathname)}
    >
      <CoreAdminContext
        dataProvider={buildDataProvider(manager, behavior)}
        authProvider={authProvider}
        i18nProvider={i18nProvider}
      >
        <OperationProvider manager={manager}>
          <NotificationProvider>
            <div data-testid="app-shell">
              <LegacyNotifyButton />
              <QuickCaptureDialog open={open} onOpenChange={setOpen} />
              <Notification />
              <NoraNotificationOutlet />
            </div>
          </NotificationProvider>
        </OperationProvider>
      </CoreAdminContext>
    </TestMemoryRouter>
  );
};

const sonnerToasts = () =>
  document.querySelectorAll("[data-sonner-toast], li[data-sonner-toast]");

const cards = () =>
  document.querySelectorAll('[data-testid="nora-notification-card"]');

const announcerText = (channel: "polite" | "assertive") =>
  document.querySelector(
    `[data-testid="nora-notification-announcer-${channel}"]`,
  )?.textContent ?? "";

describe("Quick Capture notification vertical slice (Phase 7B.4)", () => {
  let manager: OperationManager;

  beforeEach(() => {
    page.viewport(1440, 900);
    headers.length = 0;
    localStorage.clear();
    manager = createOperationManager({
      successTtlMs: 60_000,
      errorTtlMs: 60_000,
      recordError: null,
    });
  });

  afterEach(() => {
    manager.resetForTests();
    localStorage.clear();
    vi.useRealTimers();
  });

  /** Fills the three steps and submits. */
  const submit = async (
    screen: Awaited<ReturnType<typeof render>>,
    options?: { withTask?: boolean; dealTitle?: string },
  ) => {
    // Tailwind utilities are not compiled in the browser-test bundle, so the
    // zero-sized Radix checkbox itself is not clickable — its <label
    // htmlFor> is, and toggles exactly the same control.
    await screen.getByText("Neuen Kunden anlegen").click();
    await screen.getByPlaceholder("Kundenname").fill("Müller GmbH");
    await screen.getByRole("button", { name: "Weiter" }).click();

    await screen.getByText("Ohne Ansprechpartner fortfahren").click();
    await screen.getByRole("button", { name: "Weiter" }).click();

    await screen
      .getByLabelText("Titel")
      .fill(options?.dealTitle ?? "Kontüreparatur");
    if (options?.withTask) {
      await screen.getByText("Aufgabe anlegen").click();
    }
    await screen
      .getByRole("button", { name: "Speichern und Vorgang öffnen" })
      .click();
  };

  it("19/22/23: success shows one card, no sonner toast, and survives dialog close + redirect", async () => {
    const locations: string[] = [];
    const screen = await render(
      <Harness manager={manager} behavior={{}} locations={locations} />,
    );

    await submit(screen);

    await vi.waitFor(() => {
      expect(cards()).toHaveLength(1);
    });
    const card = screen.getByTestId("nora-notification-card");
    await expect.element(card.getByText("Vorgang erstellt")).toBeVisible();
    await expect
      .element(card.getByText("„Kontüreparatur“ für Müller GmbH"))
      .toBeVisible();

    // 22: the dialog is gone…
    await vi.waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
    // 23: …the redirect to the Vorgangsakte happened…
    expect(locations.some((path) => path.includes("42"))).toBe(true);
    // …and the card outlived both.
    expect(cards()).toHaveLength(1);

    // 19: exactly one feedback layer — the migrated toast is really gone.
    expect(sonnerToasts()).toHaveLength(0);
  });

  it("21: a failed task renders one warning card and no sonner warning", async () => {
    const screen = await render(
      <Harness
        manager={manager}
        behavior={{ task: { errorCode: "transport_broke" } }}
        locations={[]}
      />,
    );

    await submit(screen, { withTask: true });

    await vi.waitFor(() => {
      expect(cards()).toHaveLength(1);
    });
    const card = screen.getByTestId("nora-notification-card");
    await expect
      .element(card.getByText("Vorgang erstellt — Aufgabe offen"))
      .toBeVisible();
    await expect
      .element(card.getByText("Die Aufgabe konnte nicht angelegt werden."))
      .toBeVisible();
    await expect.element(card).toHaveAttribute("data-tone", "warning");
    expect(sonnerToasts()).toHaveLength(0);

    // 31/32: a partial is a warning, announced politely exactly once.
    await vi.waitFor(() => {
      expect(announcerText("polite")).toMatch(/Aufgabe offen/);
    });
    expect(announcerText("assertive")).toBe("");
  });

  it("20/31: a core failure renders one error card, assertive only, no sonner error", async () => {
    const locations: string[] = [];
    const screen = await render(
      <Harness
        manager={manager}
        behavior={{ core: { errorCode: NORA_ERROR_CODES.PERMISSION_DENIED } }}
        locations={locations}
      />,
    );

    await submit(screen);

    await vi.waitFor(() => {
      expect(cards()).toHaveLength(1);
    });
    const card = screen.getByTestId("nora-notification-card");
    await expect
      .element(card.getByText("Vorgang konnte nicht erstellt werden"))
      .toBeVisible();
    await expect.element(card).toHaveAttribute("data-tone", "error");

    // 20: no second message next to it.
    expect(sonnerToasts()).toHaveLength(0);
    // 31: exactly one channel carries the failure.
    await vi.waitFor(() => {
      expect(announcerText("assertive")).toMatch(
        /Vorgang konnte nicht erstellt werden/,
      );
    });
    expect(announcerText("polite")).not.toMatch(
      /Vorgang konnte nicht erstellt werden/,
    );

    // A failed write keeps the user in the dialog with their input intact.
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(locations.some((path) => path.includes("42"))).toBe(false);
  });

  it("24: the card stack lives outside the dialog portal and now stacks above it", async () => {
    const screen = await render(
      <Harness manager={manager} behavior={{}} locations={[]} />,
    );

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const region = screen.getByTestId("nora-notification-region");
    await expect.element(region).toBeInTheDocument();
    const element = region.element() as HTMLElement;

    // Not inside the Radix portal — that is what lets it survive the unmount.
    expect(dialog?.contains(element)).toBe(false);
    // 7B.4b: above the dialog layer, so the outcome of the action the user
    // just took stays readable while that dialog is still on screen.
    //
    // Only the region's z-index is a plain CSS declaration. The dialog gets
    // its layer from the Tailwind utility `z-50`, which this browser bundle
    // does not compile — so the layer being compared against is asserted
    // through the authored class, and the real paint order is checked in the
    // styled app during the 7B.4b UX acceptance.
    expect(Number(getComputedStyle(element).zIndex)).toBe(60);
    expect((dialog as HTMLElement).className).toContain("z-50");
  });

  it("7B.4b: the error card renders alongside the still-open dialog, on the higher layer", async () => {
    const screen = await render(
      <Harness
        manager={manager}
        behavior={{ core: { errorCode: NORA_ERROR_CODES.PERMISSION_DENIED } }}
        locations={[]}
      />,
    );

    await submit(screen);

    await vi.waitFor(() => {
      expect(cards()).toHaveLength(1);
    });
    // The core failed, so the dialog deliberately stays open with the input…
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).not.toBeNull();

    // …and the failure is readable next to it rather than underneath it.
    const card = screen.getByTestId("nora-notification-card");
    await expect
      .element(card.getByText("Vorgang konnte nicht erstellt werden"))
      .toBeVisible();
    const region = screen
      .getByTestId("nora-notification-region")
      .element() as HTMLElement;
    expect(Number(getComputedStyle(region).zIndex)).toBe(60);
    expect(dialog.className).toContain("z-50");

    // 7B.4c — the hard guarantee: while a dialog is open the card body is
    // click-through, so it can never take a click meant for the dialog. Only
    // the close control keeps pointer events. These are plain declarations
    // in the modal-aware block, so they DO resolve in this bundle.
    const cardEl = card.element() as HTMLElement;
    expect(getComputedStyle(cardEl).pointerEvents).toBe("none");
    const close = cardEl.querySelector(
      ".nora-notification-close",
    ) as HTMLElement;
    expect(close).not.toBeNull();
    expect(getComputedStyle(close).pointerEvents).toBe("auto");

    // Nothing in the notification layer traps focus away from the dialog.
    expect(region.contains(document.activeElement)).toBe(false);
  });

  it("7B.4c: while a dialog is open only the newest card is shown, and it is click-through", async () => {
    const screen = await render(
      <Harness
        manager={manager}
        behavior={{ core: { errorCode: NORA_ERROR_CODES.PERMISSION_DENIED } }}
        locations={[]}
      />,
    );

    // Two failed submits in a row — errors never auto-dismiss, so this is a
    // reachable state, and an unbounded stack reached down into the form.
    await submit(screen);
    await vi.waitFor(() => {
      expect(cards()).toHaveLength(1);
    });
    await screen
      .getByRole("button", { name: "Speichern und Vorgang öffnen" })
      .click();
    await vi.waitFor(() => {
      expect(cards()).toHaveLength(2);
    });

    // The store still holds both…
    expect(cards()).toHaveLength(2);
    // …but only the newest is rendered while the dialog is open.
    const visible = [...cards()].filter(
      (c) => (c as HTMLElement).getBoundingClientRect().height > 0,
    );
    expect(visible).toHaveLength(1);
    expect(visible[0]).toBe(cards()[cards().length - 1]);
    expect(getComputedStyle(visible[0] as HTMLElement).pointerEvents).toBe(
      "none",
    );
  });

  it("7B.4c: closing the dialog restores the normal stack and pointer behaviour", async () => {
    const screen = await render(
      <Harness
        manager={manager}
        behavior={{ core: { errorCode: NORA_ERROR_CODES.PERMISSION_DENIED } }}
        locations={[]}
      />,
    );

    await submit(screen);
    await vi.waitFor(() => {
      expect(cards()).toHaveLength(1);
    });

    await screen.getByRole("button", { name: "Abbrechen" }).click();
    await vi.waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    // Outside a dialog the card takes pointer events again, so hover/focus
    // pause behaves exactly as before the modal-aware rules.
    const card = screen.getByTestId("nora-notification-card").element();
    await vi.waitFor(() => {
      expect(getComputedStyle(card as HTMLElement).pointerEvents).toBe("auto");
    });
  });

  it("7B.4b: on mobile the raised layer still leaves MobileNavigation geometrically free", async () => {
    page.viewport(390, 844);
    const screen = await render(
      <Harness manager={manager} behavior={{}} locations={[]} />,
    );

    await submit(screen);

    await vi.waitFor(() => {
      expect(cards()).toHaveLength(1);
    });
    const region = screen.getByTestId("nora-notification-region");
    const element = region.element() as HTMLElement;
    await vi.waitFor(() => {
      expect(
        element.classList.contains("nora-notification-region-mobile"),
      ).toBe(true);
    });
    // Stacking above dialogs must NOT become "sitting on top of the nav bar":
    // MobileNavigation is fixed bottom-0 with h-16 (64px).
    const box = element.getBoundingClientRect();
    expect(window.innerHeight - box.bottom).toBeGreaterThanOrEqual(64);

    // 7B.4c: mobile shares the desktop layer. Staying clear of the dialog's
    // controls is achieved by modal-aware placement + click-through, not by
    // hiding the card under the dialog.
    expect(Number(getComputedStyle(element).zIndex)).toBe(60);
  });

  it("28: an unmigrated sonner flow still works next to the new card stack", async () => {
    const screen = await render(
      <Harness manager={manager} behavior={{}} locations={[]} />,
    );

    // The open dialog makes the rest of the app inert; close it first so the
    // legacy flow is triggered the way a user would.
    await screen.getByRole("button", { name: "Abbrechen" }).click();
    await vi.waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    await screen.getByTestId("legacy-notify").click();

    await vi.waitFor(() => {
      expect(sonnerToasts().length).toBeGreaterThan(0);
    });
    // The legacy toast did not produce a Nora card, and vice versa.
    expect(cards()).toHaveLength(0);
  });

  it("29/30: one polite announcement per settled intent, and no focus theft", async () => {
    const screen = await render(
      <Harness manager={manager} behavior={{}} locations={[]} />,
    );

    await submit(screen);

    await vi.waitFor(() => {
      expect(announcerText("polite")).toMatch(/Vorgang erstellt/);
    });
    const politeRegion = document.querySelector(
      '[data-testid="nora-notification-announcer-polite"]',
    ) as HTMLElement;
    // Exactly one announcement node — no repeated/duplicated message.
    expect(politeRegion.childElementCount).toBe(1);
    expect(announcerText("assertive")).toBe("");

    // 29: the card never grabbed focus away from the app.
    const region = document.querySelector(
      '[data-testid="nora-notification-region"]',
    );
    expect(region?.contains(document.activeElement)).toBe(false);
  });

  it("the Core and Task operations stay separately correlated on the wire (7B.3 intact)", async () => {
    const screen = await render(
      <Harness manager={manager} behavior={{}} locations={[]} />,
    );

    await submit(screen, { withTask: true });

    await vi.waitFor(() => {
      expect(headers).toHaveLength(2);
    });
    expect(headers[0]).not.toBe(headers[1]);
    expect(manager.getOperation(headers[0])?.operationType).toBe(
      "quickCapture.createCase",
    );
    expect(manager.getOperation(headers[1])?.operationType).toBe(
      "quickCapture.createTask",
    );
    // One card for two operations.
    await vi.waitFor(() => {
      expect(cards()).toHaveLength(1);
    });
  });
  it("25/26: the mounted stack follows the viewport — desktop right, mobile above the nav", async () => {
    const desktop = await render(
      <Harness manager={manager} behavior={{}} locations={[]} />,
    );
    const desktopRegion = desktop.getByTestId("nora-notification-region");
    await expect.element(desktopRegion).toBeInTheDocument();
    expect(
      (desktopRegion.element() as HTMLElement).classList.contains(
        "nora-notification-region-mobile",
      ),
    ).toBe(false);
    desktop.unmount();

    page.viewport(390, 844);
    const mobile = await render(
      <Harness manager={manager} behavior={{}} locations={[]} />,
    );
    const mobileRegion = mobile.getByTestId("nora-notification-region");
    await vi.waitFor(() => {
      expect(
        (mobileRegion.element() as HTMLElement).classList.contains(
          "nora-notification-region-mobile",
        ),
      ).toBe(true);
    });
  });
});
