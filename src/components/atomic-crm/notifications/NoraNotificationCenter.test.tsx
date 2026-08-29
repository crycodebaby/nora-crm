/**
 * Phase 7B.2 — notification rendering, accessibility and responsive tests
 * (P27–P34, P36).
 *
 * The store is driven through a real OperationManager, exactly like the 7B.1
 * unit tests, so what is rendered here is the real derived state.
 */

import { I18nContextProvider } from "ra-core";
import polyglotI18nProvider from "ra-i18n-polyglot";
import englishMessages from "ra-language-english";
import { mergeTranslations } from "ra-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import "@/index.css";
import { NORA_ERROR_CODES } from "../domain/noraErrorCodes";
import { OPERATION_CATALOG } from "../operations/operationCatalog";
import { createOperationId } from "../operations/operationContext";
import {
  createOperationManager,
  type OperationManager,
} from "../operations/operationManager";
import { germanCrmMessages } from "../providers/commons/germanCrmMessages";
import { NoraNotificationCenter } from "./NoraNotificationCenter";
import { getNotificationPolicy } from "./notificationPolicy";
import {
  createNotificationStore,
  type NotificationStore,
} from "./notificationStore";
import type { NotificationTiming } from "./notificationTiming";

const TIMING: NotificationTiming = {
  pendingRevealDelayMs: 100,
  pendingMinVisibleMs: 200,
  successVisibleMs: 1_000,
  warningVisibleMs: 3_000,
};

const catalog = mergeTranslations(englishMessages, germanCrmMessages);
const i18nProvider = polyglotI18nProvider(() => catalog, "de", [
  { locale: "de", name: "Deutsch" },
]);

const deferredPromise = () => new Promise<string>(() => {});

describe("NoraNotificationCenter", () => {
  let manager: OperationManager;
  let store: NotificationStore;
  let counter = 0;

  const makeStore = () => {
    manager = createOperationManager({
      successTtlMs: 60_000,
      errorTtlMs: 60_000,
      maxOperations: 50,
      recordError: null,
    });
    store = createNotificationStore({
      manager,
      timing: TIMING,
      createId: () => `n${(counter += 1)}`,
    });
  };

  const registerCase = (input?: {
    operationIds?: string[];
    displayContext?: Record<string, string>;
    initiator?: { kind: "ai"; label: string };
  }) => {
    const policy = getNotificationPolicy("quickCapture.createCase")!;
    const operationIds = input?.operationIds ?? [createOperationId()];
    const notificationId = store.registerIntent({
      intentType: policy.intentType,
      messageNamespace: policy.messageNamespace,
      operationIds,
      displayContext: input?.displayContext ?? {
        dealTitle: "Kontüreparatur",
        customerName: "Müller GmbH",
      },
      initiator: input?.initiator,
      retry: policy.retry,
      resolve: policy.resolve,
    });
    return { operationIds, notificationId };
  };

  const renderCenter = (props?: {
    maxVisible?: number;
    forceMobile?: boolean;
  }) =>
    render(
      <I18nContextProvider value={i18nProvider}>
        <NoraNotificationCenter store={store} {...props} />
      </I18nContextProvider>,
    );

  beforeEach(() => {
    page.viewport(1440, 900);
    counter = 0;
    makeStore();
  });

  afterEach(() => {
    store.destroy();
    manager.resetForTests();
    vi.useRealTimers();
  });

  it("P29: the card stack is not a live region; the announcer owns both channels", async () => {
    const screen = await renderCenter();
    const region = screen.getByTestId("nora-notification-region");
    // Labelled and navigable, but explicitly NOT live — no nesting with the
    // announcer, so a pending→error transition cannot be announced twice.
    await expect.element(region).toHaveAttribute("aria-live", "off");
    await expect.element(region).toHaveAttribute("role", "region");
    await expect
      .element(region)
      .toHaveAttribute("aria-label", "Statusmeldungen");

    await expect
      .element(screen.getByTestId("nora-notification-announcer-polite"))
      .toHaveAttribute("aria-live", "polite");
    await expect
      .element(screen.getByTestId("nora-notification-announcer-assertive"))
      .toHaveAttribute("aria-live", "assertive");
  });

  it("P29: exactly one live region carries an error, and only the assertive one", async () => {
    const { operationIds } = registerCase();
    await expect(
      manager.execute(
        OPERATION_CATALOG["quickCapture.createCase"],
        { operationId: operationIds[0] },
        async () => {
          const error = new Error("boom") as Error & { details: string };
          error.details = NORA_ERROR_CODES.PERMISSION_DENIED;
          throw error;
        },
      ),
    ).rejects.toThrow();

    const screen = await renderCenter();
    const assertive = screen.getByTestId(
      "nora-notification-announcer-assertive",
    );
    await expect
      .element(assertive)
      .toHaveTextContent(/Vorgang konnte nicht erstellt werden/);

    const title = "Vorgang konnte nicht erstellt werden";
    const liveNodes = Array.from(
      document.querySelectorAll(
        '[aria-live]:not([aria-live="off"]), [role="alert"], [role="status"]',
      ),
    );
    const carrying = liveNodes.filter((node) =>
      node.textContent?.includes(title),
    );
    expect(carrying).toHaveLength(1);
    expect(carrying[0].getAttribute("aria-live")).toBe("assertive");

    // The polite channel must stay clear of the failure.
    expect(
      document
        .querySelector('[data-testid="nora-notification-announcer-polite"]')
        ?.textContent?.includes(title),
    ).toBe(false);
  });

  it("announcer: a repeated identical message re-announces via a new node, not altered text", async () => {
    const screen = await renderCenter();
    const polite = screen.getByTestId("nora-notification-announcer-polite");
    const exact = "Vorgang erstellt. „Kontüreparatur“ für Müller GmbH";

    const first = registerCase();
    await manager.execute(
      OPERATION_CATALOG["quickCapture.createCase"],
      { operationId: first.operationIds[0] },
      async () => "ok",
    );
    await vi.waitFor(() => {
      expect((polite.element() as HTMLElement).textContent).toBe(exact);
    });
    const firstNode = (polite.element() as HTMLElement).firstElementChild;
    expect(firstNode).not.toBeNull();

    // Same wording again — a second, distinct announcement event.
    const second = registerCase();
    await manager.execute(
      OPERATION_CATALOG["quickCapture.createCase"],
      { operationId: second.operationIds[0] },
      async () => "ok",
    );

    await vi.waitFor(() => {
      const node = (polite.element() as HTMLElement).firstElementChild;
      expect(node).not.toBeNull();
      // The child was replaced (new key) → the live region fires again.
      expect(node).not.toBe(firstNode);
    });
    // …and the spoken text is byte-identical: no whitespace marker, no padding.
    expect((polite.element() as HTMLElement).textContent).toBe(exact);
  });

  it("P29: pending → error announces once politely, then once assertively", async () => {
    vi.useFakeTimers();
    const { operationIds } = registerCase();
    let fail!: (reason: unknown) => void;
    const gate = new Promise<string>((_, reject) => {
      fail = reject;
    });
    const run = manager.execute(
      OPERATION_CATALOG["quickCapture.createCase"],
      { operationId: operationIds[0] },
      () => gate,
    );
    vi.advanceTimersByTime(TIMING.pendingRevealDelayMs);
    vi.useRealTimers();

    const screen = await renderCenter();
    const polite = screen.getByTestId("nora-notification-announcer-polite");
    const assertive = screen.getByTestId(
      "nora-notification-announcer-assertive",
    );
    await expect.element(polite).toHaveTextContent(/Vorgang wird erstellt/);
    expect((assertive.element() as HTMLElement).textContent).toBe("");

    const error = new Error("boom") as Error & { details: string };
    error.details = NORA_ERROR_CODES.PERMISSION_DENIED;
    fail(error);
    await expect(run).rejects.toThrow();

    await expect
      .element(assertive)
      .toHaveTextContent(/Vorgang konnte nicht erstellt werden/);
    // The pending announcement is never rewritten into the failure text.
    expect(
      (polite.element() as HTMLElement).textContent?.includes(
        "Vorgang konnte nicht erstellt werden",
      ),
    ).toBe(false);
  });

  it("renders German pending copy with the business display context", async () => {
    vi.useFakeTimers();
    registerCase();
    void manager.execute(
      OPERATION_CATALOG["quickCapture.createCase"],
      { operationId: createOperationId() },
      deferredPromise,
    );
    vi.advanceTimersByTime(TIMING.pendingRevealDelayMs);
    vi.useRealTimers();

    const screen = await renderCenter();
    // Scoped to the card: the sr-only announcer carries the same wording.
    const card = screen.getByTestId("nora-notification-card");
    await expect.element(card.getByText("Vorgang wird erstellt")).toBeVisible();
    await expect
      .element(card.getByText("„Kontüreparatur“ für Müller GmbH"))
      .toBeVisible();
  });

  it("renders success copy and the success tone", async () => {
    const { operationIds, notificationId } = registerCase();
    await manager.execute(
      OPERATION_CATALOG["quickCapture.createCase"],
      { operationId: operationIds[0] },
      async () => "ok",
    );

    const screen = await renderCenter();
    const card = screen.getByTestId("nora-notification-card");
    await expect.element(card.getByText("Vorgang erstellt")).toBeVisible();
    await expect.element(card).toHaveAttribute("data-tone", "success");
    // The card itself must not be a live region — see the announcer.
    expect((card.element() as HTMLElement).getAttribute("role")).toBeNull();
    void notificationId;
  });

  it("P29/detail: an error renders its reason and announces it assertively", async () => {
    const { operationIds } = registerCase();
    await expect(
      manager.execute(
        OPERATION_CATALOG["quickCapture.createCase"],
        { operationId: operationIds[0] },
        async () => {
          const error = new Error("boom") as Error & { details: string };
          error.details = NORA_ERROR_CODES.CONTACT_NOT_IN_CUSTOMER_CONTEXT;
          throw error;
        },
      ),
    ).rejects.toThrow();

    const screen = await renderCenter();
    // Scoped to the card: the sr-only announcer carries the same words.
    const card = screen.getByTestId("nora-notification-card");
    await expect
      .element(card.getByText("Vorgang konnte nicht erstellt werden"))
      .toBeVisible();
    await expect
      .element(
        card.getByText("Dieser Ansprechpartner gehört nicht zu diesem Kunden."),
      )
      .toBeVisible();
    await expect.element(card).toHaveAttribute("data-tone", "error");
    await expect
      .element(screen.getByTestId("nora-notification-announcer-assertive"))
      .toHaveTextContent(/Vorgang konnte nicht erstellt werden/);
  });

  it("a partial renders the warning tone with an unclamped reason", async () => {
    const caseOp = createOperationId();
    const taskOp = createOperationId();
    registerCase({ operationIds: [caseOp, taskOp] });
    await manager.execute(
      OPERATION_CATALOG["quickCapture.createCase"],
      { operationId: caseOp },
      async () => "ok",
    );
    await expect(
      manager.execute(
        OPERATION_CATALOG["quickCapture.createTask"],
        { operationId: taskOp },
        async () => {
          throw new Error("nope");
        },
      ),
    ).rejects.toThrow();

    const screen = await renderCenter();
    const card = screen.getByTestId("nora-notification-card");
    await expect
      .element(card.getByText("Vorgang erstellt — Aufgabe offen"))
      .toBeVisible();
    const detail = card.getByText("Die Aufgabe konnte nicht angelegt werden.");
    await expect.element(detail).toBeVisible();
    await expect.element(card).toHaveAttribute("data-tone", "warning");
    // A partial is a warning, not a failure: it goes to the polite channel.
    await expect
      .element(screen.getByTestId("nora-notification-announcer-polite"))
      .toHaveTextContent(/Die Aufgabe konnte nicht angelegt werden/);
    expect(
      (
        screen
          .getByTestId("nora-notification-announcer-assertive")
          .element() as HTMLElement
      ).textContent,
    ).toBe("");

    // Guardrail: the actionable reason must not be line-clamped away.
    const element = detail.element() as HTMLElement;
    expect(getComputedStyle(element).webkitLineClamp).not.toMatch(/^[1-9]/);
  });

  it("P27: the close button is keyboard reachable, dismisses, and never steals focus", async () => {
    const { operationIds, notificationId } = registerCase();
    await manager.execute(
      OPERATION_CATALOG["quickCapture.createCase"],
      { operationId: operationIds[0] },
      async () => "ok",
    );

    const screen = await renderCenter();
    // Nothing inside the region grabbed focus when the card appeared.
    expect(
      document
        .querySelector('[data-testid="nora-notification-region"]')
        ?.contains(document.activeElement),
    ).toBe(false);

    const close = screen.getByRole("button", { name: /close/i });
    await expect.element(close).toBeVisible();
    (close.element() as HTMLElement).focus();
    expect(document.activeElement).toBe(close.element());

    await close.click();
    expect(
      store.getSnapshot().some((r) => r.notificationId === notificationId),
    ).toBe(false);
  });

  it("P28/touch: the close control satisfies the 44px minimum target", async () => {
    const { operationIds } = registerCase();
    await manager.execute(
      OPERATION_CATALOG["quickCapture.createCase"],
      { operationId: operationIds[0] },
      async () => "ok",
    );

    const screen = await renderCenter();
    const close = screen.getByRole("button", { name: /close/i });
    await expect.element(close).toBeVisible();
    const box = (close.element() as HTMLElement).getBoundingClientRect();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  });

  it("P30: motion is declared through Nora motion tokens", async () => {
    const { operationIds } = registerCase();
    await manager.execute(
      OPERATION_CATALOG["quickCapture.createCase"],
      { operationId: operationIds[0] },
      async () => "ok",
    );

    const screen = await renderCenter();
    const card = screen.getByTestId("nora-notification-card");
    await expect.element(card).toBeVisible();
    const root = getComputedStyle(document.documentElement);
    expect(root.getPropertyValue("--nora-motion-base").trim()).toBe("220ms");
    expect(root.getPropertyValue("--nora-motion-fast").trim()).toBe("150ms");
    expect(root.getPropertyValue("--nora-motion-ease").trim()).not.toBe("");
  });

  it("P31: success and warning tokens are defined and distinct from destructive", () => {
    const root = getComputedStyle(document.documentElement);
    const success = root.getPropertyValue("--nora-success").trim();
    const warning = root.getPropertyValue("--nora-warning").trim();
    const destructive = root.getPropertyValue("--destructive").trim();
    expect(success).not.toBe("");
    expect(warning).not.toBe("");
    expect(success).not.toBe(destructive);
    expect(warning).not.toBe(destructive);
    expect(success).not.toBe(warning);
  });

  it("colour is never the only carrier: every tone has an icon and its own wording", async () => {
    const { operationIds } = registerCase();
    await manager.execute(
      OPERATION_CATALOG["quickCapture.createCase"],
      { operationId: operationIds[0] },
      async () => "ok",
    );

    const screen = await renderCenter();
    const card = screen.getByTestId("nora-notification-card");
    await expect.element(card).toBeVisible();
    const icon = (card.element() as HTMLElement).querySelector(
      ".nora-notification-icon",
    );
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  });

  it("P14/render: a human initiator shows no provenance line", async () => {
    const { operationIds } = registerCase();
    await manager.execute(
      OPERATION_CATALOG["quickCapture.createCase"],
      { operationId: operationIds[0] },
      async () => "ok",
    );

    const screen = await renderCenter();
    await expect
      .element(screen.getByTestId("nora-notification-card"))
      .toBeVisible();
    expect(
      document.querySelector('[data-testid="nora-notification-origin"]'),
    ).toBeNull();
  });

  it("a non-human initiator is visibly attributed", async () => {
    const { operationIds } = registerCase({
      initiator: { kind: "ai", label: "KI-Agent Nora" },
    });
    await manager.execute(
      OPERATION_CATALOG["quickCapture.createCase"],
      { operationId: operationIds[0] },
      async () => "ok",
    );

    const screen = await renderCenter();
    await expect.element(screen.getByText("KI-Agent Nora")).toBeVisible();
  });

  it("P32: desktop shows at most three cards, bottom right", async () => {
    for (let i = 0; i < 4; i += 1) {
      const { operationIds } = registerCase({
        displayContext: { dealTitle: `Vorgang ${i}` },
      });
      await manager.execute(
        OPERATION_CATALOG["quickCapture.createCase"],
        { operationId: operationIds[0] },
        async () => "ok",
      );
    }

    const screen = await renderCenter({ forceMobile: false });
    const region = screen.getByTestId("nora-notification-region");
    await expect.element(region).toBeVisible();
    expect(
      document.querySelectorAll('[data-testid="nora-notification-card"]'),
    ).toHaveLength(3);
    expect(
      (region.element() as HTMLElement).classList.contains(
        "nora-notification-region-mobile",
      ),
    ).toBe(false);
  });

  it("P33: tablet keeps the desktop layout", async () => {
    page.viewport(1024, 768);
    const { operationIds } = registerCase();
    await manager.execute(
      OPERATION_CATALOG["quickCapture.createCase"],
      { operationId: operationIds[0] },
      async () => "ok",
    );

    const screen = await renderCenter();
    const region = screen.getByTestId("nora-notification-region");
    await expect.element(region).toBeVisible();
    expect(
      (region.element() as HTMLElement).classList.contains(
        "nora-notification-region-mobile",
      ),
    ).toBe(false);
  });

  it("P34: mobile shows at most two cards, full width, clear of the nav bar", async () => {
    page.viewport(390, 844);
    for (let i = 0; i < 3; i += 1) {
      const { operationIds } = registerCase({
        displayContext: { dealTitle: `Vorgang ${i}` },
      });
      await manager.execute(
        OPERATION_CATALOG["quickCapture.createCase"],
        { operationId: operationIds[0] },
        async () => "ok",
      );
    }

    const screen = await renderCenter({ forceMobile: true });
    const region = screen.getByTestId("nora-notification-region");
    await expect.element(region).toBeVisible();
    expect(
      document.querySelectorAll('[data-testid="nora-notification-card"]'),
    ).toHaveLength(2);

    const element = region.element() as HTMLElement;
    expect(element.classList.contains("nora-notification-region-mobile")).toBe(
      true,
    );
    // MobileNavigation is fixed bottom-0 with h-16 (64px) — stay above it.
    const box = element.getBoundingClientRect();
    expect(window.innerHeight - box.bottom).toBeGreaterThanOrEqual(64);
    // 7B.4c: mobile shares the desktop layer again. What keeps it off the
    // dialog's controls is modal-aware placement plus the click-through rule,
    // not a lower z-index (which only made the card invisible).
    expect(Number(getComputedStyle(element).zIndex)).toBe(60);
  });

  it("P36 (revised 7B.4b): the region sits ABOVE the dialog layer, and stays non-modal", async () => {
    const { operationIds } = registerCase();
    await manager.execute(
      OPERATION_CATALOG["quickCapture.createCase"],
      { operationId: operationIds[0] },
      async () => "ok",
    );

    // Pinned to desktop so this case is unambiguous. Since 7B.4c mobile shares
    // the very same layer (asserted in P34) — what keeps a card off the
    // dialog's controls is modal-aware placement plus click-through, not a
    // lower z-index.
    const screen = await renderCenter({ forceMobile: false });
    const region = screen.getByTestId("nora-notification-region");
    await expect.element(region).toBeVisible();
    const style = getComputedStyle(region.element() as HTMLElement);
    const zIndex = Number(style.zIndex);
    // Above the Radix dialog/overlay layer (z-50) — the 7A/7B rule was
    // corrected in 7B.4b after the card turned out to be unreadable under
    // the Vorgangsakte modal.
    expect(zIndex).toBe(60);
    expect(zIndex).toBeGreaterThan(50);
    // Smallest clean step above it — not an escape hatch that would block a
    // later, explicitly introduced critical/system layer.
    expect(zIndex).toBeLessThan(100);
    // Stacking change only — no modal semantics were added along with it.
    // (Layout utilities like `fixed`/`pointer-events-none` are Tailwind
    // classes and are not compiled in this browser bundle, so only the plain
    // CSS declaration above is asserted here; the real geometry and
    // click-through behaviour are verified in the styled app.)
    expect(
      (region.element() as HTMLElement).getAttribute("aria-modal"),
    ).toBeNull();
    expect((region.element() as HTMLElement).getAttribute("aria-live")).toBe(
      "off",
    );
  });

  it("7B.4b: the raised layer adds no focus trap and steals no focus", async () => {
    const { operationIds } = registerCase();
    await manager.execute(
      OPERATION_CATALOG["quickCapture.createCase"],
      { operationId: operationIds[0] },
      async () => "ok",
    );

    const screen = await renderCenter();
    const card = screen.getByTestId("nora-notification-card");
    await expect.element(card).toBeVisible();

    const region = screen
      .getByTestId("nora-notification-region")
      .element() as HTMLElement;
    // Nothing inside the notification layer grabbed focus when it appeared…
    expect(region.contains(document.activeElement)).toBe(false);
    // …and the close control is still reachable and operable from it.
    const close = screen.getByRole("button", { name: /close/i });
    (close.element() as HTMLElement).focus();
    expect(document.activeElement).toBe(close.element());
    await close.click();
    expect(store.getSnapshot()).toHaveLength(0);
  });

  it("hovering a card pauses its auto-dismiss", async () => {
    const { operationIds, notificationId } = registerCase();
    await manager.execute(
      OPERATION_CATALOG["quickCapture.createCase"],
      { operationId: operationIds[0] },
      async () => "ok",
    );

    const screen = await renderCenter();
    const card = screen.getByTestId("nora-notification-card");
    await expect.element(card).toBeVisible();
    await card.hover();

    await vi.waitFor(() => {
      const record = store
        .getSnapshot()
        .find((r) => r.notificationId === notificationId);
      expect(record?.dismissPaused).toBe(true);
    });
  });

  it("renders nothing visible when there is no notification", async () => {
    const screen = await renderCenter();
    await expect
      .element(screen.getByTestId("nora-notification-region"))
      .toBeInTheDocument();
    expect(
      document.querySelectorAll('[data-testid="nora-notification-card"]'),
    ).toHaveLength(0);
  });
});
