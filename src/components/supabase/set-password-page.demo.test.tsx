import { render } from "vitest-browser-react";
import { vi } from "vitest";
import { StoryWrapper } from "@/test/StoryWrapper";
import { SetPasswordPage } from "./set-password-page";

/**
 * Demo-mode simulation of the onboarding backend (`npm run dev:demo`).
 *
 * Two guarantees are pinned here: the simulation only exists behind
 * `isNoraDemoMode` (`VITE_IS_DEMO=true`, mocked to true for this file — the
 * production tests next door run with it false and go through the Supabase
 * mock), and while it is active the real Supabase client is never touched:
 * the URL tokens are only checked for presence and never used as credentials.
 */

const supabase = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@/components/atomic-crm/misc/noraDemoMode", () => ({
  isNoraDemoMode: true,
}));

vi.mock("@/components/atomic-crm/providers/supabase/supabase", () => ({
  getSupabaseClient: () => {
    supabase.calls += 1;
    throw new Error("Supabase must not be used in demo mode");
  },
}));

beforeEach(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("VITE_SB_PUBLISHABLE_KEY", "sb_publishable_test");
  supabase.calls = 0;
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const PW = "demo-passwort-zum-ansehen";

const fillPassword = async (screen: Awaited<ReturnType<typeof render>>) => {
  await screen.getByRole("button", { name: "Zugang einrichten" }).click();
  await screen.getByRole("textbox", { name: "Passwort", exact: true }).fill(PW);
  await screen
    .getByRole("textbox", { name: "Passwort wiederholen", exact: true })
    .fill(PW);
  await screen.getByRole("checkbox").click();
  await screen.getByRole("button", { name: "Passwort speichern" }).click();
};

describe("Demo-mode onboarding simulation", () => {
  it("walks the whole flow to COMPLETE without touching Supabase", async () => {
    const screen = await render(
      <StoryWrapper
        initialEntries={["/set-password?access_token=demo&refresh_token=demo"]}
      >
        <SetPasswordPage />
      </StoryWrapper>,
    );

    await expect
      .element(screen.getByRole("heading", { name: "Hallo Otto" }))
      .toBeVisible();
    await fillPassword(screen);
    await expect
      .element(screen.getByText("Passwort gespeichert."))
      .toBeVisible();
    await screen.getByRole("button", { name: "Weiter" }).click();
    await expect
      .element(screen.getByTestId("onboarding-complete"))
      .toBeVisible();

    expect(supabase.calls).toBe(0);
  });

  it("routes ?demo=blocked to the blocked state, never to success", async () => {
    const screen = await render(
      <StoryWrapper
        initialEntries={[
          "/set-password?access_token=demo&refresh_token=demo&demo=blocked",
        ]}
      >
        <SetPasswordPage />
      </StoryWrapper>,
    );

    await fillPassword(screen);
    await expect
      .element(
        screen.getByRole("heading", {
          name: "Ihr Nora-Zugang ist derzeit nicht aktiv",
        }),
      )
      .toBeVisible();
    expect(
      screen.container.querySelector('[data-testid="onboarding-success-mark"]'),
    ).toBeNull();
    expect(supabase.calls).toBe(0);
  });

  it("still shows the invalid state without tokens", async () => {
    const screen = await render(
      <StoryWrapper initialEntries={["/set-password"]}>
        <SetPasswordPage />
      </StoryWrapper>,
    );
    await expect
      .element(
        screen.getByRole("heading", {
          name: "Dieser Link ist nicht mehr gültig",
        }),
      )
      .toBeVisible();
    expect(supabase.calls).toBe(0);
  });
});
