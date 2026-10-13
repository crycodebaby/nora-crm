/**
 * Alpha UI 2 entries (docs/nora/26 §14): the fourth desktop navigation entry
 * and the entry at the top of the regular mobile start state.
 */
import { CoreAdminContext, memoryStore } from "ra-core";
import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient } from "@tanstack/react-query";
import { render } from "vitest-browser-react";

import { createCrmDb, StoryWrapper } from "@/test/StoryWrapper";
import { MobileDashboard } from "../dashboard/MobileDashboard";
import Header from "../layout/Header";
import { NotificationProvider } from "../notifications/NotificationProvider";
import { OperationProvider } from "../operations/OperationProvider";
import { createDataProvider } from "../providers/fakerest";
import { QuickCaptureProvider } from "../quickCapture/QuickCaptureContext";
import { ARBEITSKORB_PATH } from "./arbeitskorbPath";
import {
  createSwitchableAuthProvider,
  germanTestI18nProvider,
  LocationProbe,
} from "./testing/workTestKit";

const renderHeader = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <CoreAdminContext
        dataProvider={createDataProvider({ db: createCrmDb(), silent: true })}
        authProvider={createSwitchableAuthProvider(1).authProvider}
        i18nProvider={germanTestI18nProvider}
        queryClient={new QueryClient()}
        store={memoryStore()}
      >
        <OperationProvider>
          <NotificationProvider>
            <QuickCaptureProvider>
              <Routes>
                <Route
                  path="*"
                  element={
                    <>
                      <Header />
                      <LocationProbe />
                    </>
                  }
                />
              </Routes>
            </QuickCaptureProvider>
          </NotificationProvider>
        </OperationProvider>
      </CoreAdminContext>
    </MemoryRouter>,
  );

const primaryNav = () =>
  document.querySelector<HTMLElement>('nav[aria-label="Hauptnavigation"]');
const primaryLinks = () => [
  ...(primaryNav()?.querySelectorAll<HTMLAnchorElement>("a") ?? []),
];

describe("desktop navigation entry", () => {
  it("adds Arbeitskorb as the second of four primary entries, active only on its route", async () => {
    await renderHeader("/arbeitskorb?sicht=team");
    await expect.poll(() => primaryLinks().length).toBe(4);
    expect(primaryLinks().map((link) => link.textContent)).toEqual([
      "Startseite",
      "Arbeitskorb",
      "Kunden",
      "Vorgänge",
    ]);
    const entry = primaryLinks()[1];
    expect(entry.getAttribute("href")).toBe(ARBEITSKORB_PATH);
    expect(entry.getAttribute("aria-current")).toBe("page");
    expect(
      primaryLinks().filter((link) => link.hasAttribute("aria-current")),
    ).toHaveLength(1);
  });

  it("keeps Startseite, Kunden and Vorgänge active states unchanged", async () => {
    for (const [path, active] of [
      ["/", "Startseite"],
      ["/kunden", "Kunden"],
      ["/vorgaenge", "Vorgänge"],
    ] as const) {
      const screen = await renderHeader(path);
      await expect.poll(() => primaryLinks().length).toBe(4);
      expect(
        primaryLinks()
          .filter((link) => link.getAttribute("aria-current") === "page")
          .map((link) => link.textContent),
      ).toEqual([active]);
      await screen.unmount();
    }
  });
});

/** Regular start state: contacts and notes exist, so no onboarding step. */
const regularStart = (resource: string) => {
  if (resource === "contacts") return { data: [], total: 1 };
  if (resource === "contact_notes") return { data: [], total: 1 };
  return { data: [], total: 0 };
};

const arbeitskorbEntry = () =>
  document.querySelector<HTMLAnchorElement>(`a[href="${ARBEITSKORB_PATH}"]`);

describe("mobile start entry", () => {
  it("shows one full-width Arbeitskorb row above the Hotboard in the regular start state", async () => {
    await render(
      <StoryWrapper
        dataProvider={{
          getList: (async (r: string) => regularStart(r)) as never,
        }}
      >
        <QuickCaptureProvider>
          <MobileDashboard />
        </QuickCaptureProvider>
      </StoryWrapper>,
    );
    await expect.poll(() => arbeitskorbEntry()).not.toBeNull();
    const entry = arbeitskorbEntry()!;
    expect(entry.textContent).toBe("Work basket");
    const hotboard = () =>
      [...document.querySelectorAll("h1, h2, h3")].find(
        (heading) => heading.textContent === "Hotboard",
      );
    await expect.poll(hotboard).toBeTruthy();
    expect(
      entry.compareDocumentPosition(hotboard()!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      document.querySelectorAll(`a[href="${ARBEITSKORB_PATH}"]`),
    ).toHaveLength(1);
  });

  it("also shows the entry when the start page reports an area error", async () => {
    await render(
      <StoryWrapper
        dataProvider={{
          getList: (async (resource: string) => {
            if (resource === "contact_notes") throw new Error("failed");
            return regularStart(resource);
          }) as never,
        }}
      >
        <QuickCaptureProvider>
          <MobileDashboard />
        </QuickCaptureProvider>
      </StoryWrapper>,
    );
    // ra-core retries a failed list before the area error shows.
    await expect
      .poll(() => document.querySelector('[role="alert"]'), { timeout: 15_000 })
      .not.toBeNull();
    expect(arbeitskorbEntry()).not.toBeNull();
  });

  it("is absent while the start page loads and in the onboarding step", async () => {
    const loading = await render(
      <StoryWrapper
        dataProvider={{
          getList: (() => new Promise<never>(() => {})) as never,
        }}
      >
        <MobileDashboard />
      </StoryWrapper>,
    );
    await expect
      .poll(() => document.querySelectorAll('[data-slot="skeleton"]').length)
      .toBeGreaterThan(0);
    expect(arbeitskorbEntry()).toBeNull();
    await loading.unmount();

    await render(
      <StoryWrapper
        dataProvider={{
          getList: (async () => ({ data: [], total: 0 })) as never,
        }}
      >
        <MobileDashboard />
      </StoryWrapper>,
    );
    // Onboarding step 1 (no contacts yet) renders the stepper.
    await expect.poll(() => document.querySelector("h3")).not.toBeNull();
    expect(arbeitskorbEntry()).toBeNull();
  });
});
