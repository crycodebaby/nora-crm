/**
 * AC-18 (level I): after logout and a login with another identity, no row of
 * the previous identity appears before the new answer — in the real CRM root
 * with the Desktop Admin and the Mobile Admin QueryClient (gcTime 24 h,
 * offlineFirst). The E2E stack allows one employee only, so two real
 * accounts stay RG-7.
 */
import { memoryStore, useLogout, type LayoutComponent } from "ra-core";
import { useEffect, type ReactNode } from "react";
import { MemoryRouter, useNavigate, type NavigateFunction } from "react-router";
import { page as browserPage } from "vitest/browser";
import { render } from "vitest-browser-react";

import { createCrmDb } from "@/test/StoryWrapper";
import { testI18nProvider } from "../providers/commons/i18nProvider";
import { createDataProvider } from "../providers/fakerest";
import { CRM } from "../root/CRM";
import {
  buildWorkItem,
  createControlledReader,
  createSwitchableAuthProvider,
} from "./testing/workTestKit";

let logout: (() => Promise<unknown>) | null = null;
let navigate: NavigateFunction | null = null;

const LogoutHandle = () => {
  const doLogout = useLogout();
  useEffect(() => {
    logout = () => doLogout();
  }, [doLogout]);
  return null;
};

const TestLayout: LayoutComponent = ({
  children,
}: {
  children?: ReactNode;
}) => (
  <>
    <LogoutHandle />
    <main>{children}</main>
  </>
);

const NavigateHandle = () => {
  const go = useNavigate();
  useEffect(() => {
    navigate = go;
  }, [go]);
  return null;
};

const workText = () =>
  document.querySelector("[data-arbeitskorb]")?.textContent ?? "";

describe.each([
  ["Desktop Admin", 1280, 800],
  ["Mobile Admin", 390, 844],
] as const)("Arbeitskorb session isolation (%s)", (_admin, width, height) => {
  beforeAll(async () => {
    await browserPage.viewport(width, height);
  });

  it("shows no row of the previous identity after logout and a new login", async () => {
    const work = createControlledReader();
    const auth = createSwitchableAuthProvider(101);
    const dataProvider = {
      ...createDataProvider({ db: createCrmDb(), silent: true }),
      getWorkItems: work.reader.getWorkItems,
    };

    await render(
      <MemoryRouter initialEntries={["/arbeitskorb?sicht=mine"]}>
        <CRM
          authProvider={auth.authProvider}
          dataProvider={dataProvider as never}
          i18nProvider={testI18nProvider}
          store={memoryStore()}
          layout={TestLayout}
          disableTelemetry
        />
        <NavigateHandle />
      </MemoryRouter>,
    );

    // Employee A sees A's row.
    await expect.poll(() => work.calls.length, { timeout: 10_000 }).toBe(1);
    work.respond(0, [buildWorkItem({ title: "Aufgabe von A" })]);
    await expect.poll(workText).toContain("Aufgabe von A");

    // Logout (ra-core clears the QueryClient), then B signs in.
    await expect.poll(() => logout).not.toBeNull();
    await logout!();
    // Logged out: the login screen replaces the Arbeitskorb.
    await expect
      .poll(() => document.querySelector('input[type="password"]'))
      .not.toBeNull();
    expect(document.body.textContent).not.toContain("Aufgabe von A");
    auth.setIdentity(202);
    navigate!("/arbeitskorb?sicht=mine");

    // B's request is still pending: nothing of A may be on screen.
    await expect.poll(() => work.calls.length, { timeout: 10_000 }).toBe(2);
    expect(workText()).not.toContain("Aufgabe von A");
    expect(document.body.textContent).not.toContain("Aufgabe von A");
    // The request never names an actor — B is the server session.
    expect(work.requests()[1]).toEqual({
      scope: "mine",
      stateScope: "open",
      pageSize: 50,
      cursor: null,
    });

    work.respond(1, [buildWorkItem({ title: "Aufgabe von B" })]);
    await expect.poll(workText).toContain("Aufgabe von B");
    expect(document.body.textContent).not.toContain("Aufgabe von A");
  });
});
