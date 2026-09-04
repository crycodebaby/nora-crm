import { render } from "vitest-browser-react";
import { vi } from "vitest";
import { StoryWrapper } from "@/test/StoryWrapper";
import { SetPasswordPage } from "./set-password-page";

/**
 * V1B presentation tests. They drive the real page against a fake Supabase
 * client so every assertion runs through the V1A reducer — the success mark,
 * the progress line and the step copy are checked as *consequences* of the
 * technical state, never as things the view could produce on its own.
 */

const fake = vi.hoisted(() => {
  type FakeUser = {
    id: string;
    email: string;
    user_metadata: Record<string, unknown>;
  } | null;
  const state = {
    user: null as FakeUser,
    updateUserError: null as { message: string; status?: number } | null,
    sale: { id: 7, disabled: false } as {
      id: number;
      disabled: boolean;
    } | null,
    saleError: null as { message: string } | null,
    profileError: null as { message: string } | null,
  };
  const client = {
    auth: {
      setSession: async () => ({ error: null }),
      getSession: async () => ({
        data: { session: state.user ? { user: state.user } : null },
      }),
      getUser: async () => ({ data: { user: state.user } }),
      updateUser: async () => ({ error: state.updateUserError }),
      refreshSession: async () => ({ error: null }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: state.sale,
            error: state.saleError,
          }),
        }),
      }),
      update: () => ({
        eq: () => ({
          select: () => ({
            single: async () =>
              state.profileError
                ? { data: null, error: state.profileError }
                : {
                    data: {
                      id: 7,
                      first_name: "Viktoriia",
                      last_name: "Petrova",
                      avatar: null,
                      administrator: false,
                      role: "office",
                      disabled: false,
                    },
                    error: null,
                  },
          }),
        }),
      }),
    }),
  };
  return { state, client };
});

vi.mock("@/components/atomic-crm/providers/supabase/supabase", () => ({
  getSupabaseClient: () => fake.client,
}));

const INVITE_ENTRY = "/set-password?access_token=at-1&refresh_token=rt-1";

const trustedUser = () => ({
  id: "user-1",
  email: "viktoriia.p@ergart.de",
  user_metadata: { first_name: "Viktoriia", last_name: "Petrova" },
});

beforeEach(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("VITE_SB_PUBLISHABLE_KEY", "sb_publishable_test");
  fake.state.user = trustedUser();
  fake.state.updateUserError = null;
  fake.state.sale = { id: 7, disabled: false };
  fake.state.saleError = null;
  fake.state.profileError = null;
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const renderPage = () =>
  render(
    <StoryWrapper initialEntries={[INVITE_ENTRY]}>
      <SetPasswordPage />
    </StoryWrapper>,
  );

const hasSuccessMark = (container: Element) =>
  container.querySelector('[data-testid="onboarding-success-mark"]') !== null;

const reachPasswordStep = async (
  screen: Awaited<ReturnType<typeof renderPage>>,
) => {
  await screen.getByRole("button", { name: "Zugang einrichten" }).click();
  await expect
    .element(screen.getByRole("button", { name: "Passwort speichern" }))
    .toBeVisible();
};

const fillAndSubmitPassword = async (
  screen: Awaited<ReturnType<typeof renderPage>>,
  password = "sehr-langes-persoenliches-passwort",
) => {
  await screen
    .getByRole("textbox", { name: "Passwort", exact: true })
    .fill(password);
  await screen
    .getByRole("textbox", { name: "Passwort wiederholen", exact: true })
    .fill(password);
  await screen.getByRole("checkbox").click();
  await screen.getByRole("button", { name: "Passwort speichern" }).click();
};

describe("V1B greeting", () => {
  it("greets with the trusted first name and shows the login address", async () => {
    const screen = await renderPage();

    await expect
      .element(screen.getByRole("heading", { name: "Hallo Viktoriia" }))
      .toBeVisible();
    await expect
      .element(screen.getByTestId("onboarding-identity"))
      .toHaveTextContent("viktoriia.p@ergart.de");
  });

  it("falls back to a neutral welcome when no trustworthy first name exists", async () => {
    fake.state.user = {
      id: "user-2",
      email: "neu@ergart.de",
      user_metadata: {},
    };
    const screen = await renderPage();

    await expect
      .element(screen.getByRole("heading", { name: "Willkommen bei Nora" }))
      .toBeVisible();
    await expect
      .poll(() => screen.container.textContent?.includes("Hallo ") ?? false)
      .toBe(false);
  });
});

describe("V1B progress model", () => {
  it("counts three human steps and never a fourth", async () => {
    const screen = await renderPage();

    await expect
      .element(screen.getByText("Schritt 1 von 3 · Zugang"))
      .toBeVisible();
    await reachPasswordStep(screen);
    await expect
      .element(screen.getByText("Schritt 2 von 3 · Passwort"))
      .toBeVisible();

    await fillAndSubmitPassword(screen);
    await expect
      .element(screen.getByText("Schritt 3 von 3 · Profil"))
      .toBeVisible();

    await screen.getByRole("button", { name: "Weiter" }).click();
    await expect
      .element(screen.getByTestId("onboarding-complete"))
      .toBeVisible();
    await expect
      .poll(() => screen.container.textContent?.includes("Schritt 4") ?? false)
      .toBe(false);
    await expect
      .poll(() =>
        screen.container.querySelector('[data-testid="onboarding-progress"]'),
      )
      .toBeNull();
  });

  it("keeps the progress indicator non-interactive", async () => {
    const screen = await renderPage();
    const progress = await vi.waitFor(() => {
      const node = screen.container.querySelector(
        '[data-testid="onboarding-progress"]',
      );
      if (!node) throw new Error("progress not rendered");
      return node;
    });
    expect(progress.querySelectorAll("a, button, [tabindex]")).toHaveLength(0);
  });
});

describe("V1B success gating", () => {
  it("shows the success mark only after the real COMPLETE state", async () => {
    const screen = await renderPage();
    expect(hasSuccessMark(screen.container)).toBe(false);

    await reachPasswordStep(screen);
    expect(hasSuccessMark(screen.container)).toBe(false);

    await fillAndSubmitPassword(screen);
    // Profile step: the password is truthfully reported as saved…
    await expect
      .element(screen.getByText("Passwort gespeichert."))
      .toBeVisible();
    // …but success does not exist yet.
    expect(hasSuccessMark(screen.container)).toBe(false);

    await screen.getByRole("button", { name: "Weiter" }).click();
    await expect
      .element(screen.getByTestId("onboarding-complete"))
      .toBeVisible();
    await expect.poll(() => hasSuccessMark(screen.container)).toBe(true);
    await expect
      .element(
        screen.getByRole("heading", {
          name: "Ihr Nora-Zugang ist eingerichtet",
        }),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Weiter zu Nora" }))
      .toBeVisible();
  });

  it("keeps a rejected password on the password step with an inline error", async () => {
    fake.state.updateUserError = {
      message: "Password is known to be weak and easy to guess",
    };
    const screen = await renderPage();
    await reachPasswordStep(screen);
    await fillAndSubmitPassword(screen);

    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Dieses Passwort ist zu leicht zu erraten");
    await expect
      .element(screen.getByRole("button", { name: "Erneut versuchen" }))
      .toBeVisible();
    expect(hasSuccessMark(screen.container)).toBe(false);
    await expect
      .poll(
        () =>
          screen.container.textContent?.includes("Passwort gespeichert") ??
          false,
      )
      .toBe(false);
  });

  it("reports a failed profile save without implying the password failed", async () => {
    fake.state.profileError = { message: "boom" };
    const screen = await renderPage();
    await reachPasswordStep(screen);
    await fillAndSubmitPassword(screen);
    await expect
      .element(screen.getByText("Passwort gespeichert."))
      .toBeVisible();

    await screen.getByRole("button", { name: "Weiter" }).click();

    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent(
        "Ihr Passwort ist gespeichert. Der Name konnte gerade nicht gespeichert werden.",
      );
    // Still on the profile step, still truthful, still no success.
    await expect
      .element(screen.getByText("Schritt 3 von 3 · Profil"))
      .toBeVisible();
    expect(hasSuccessMark(screen.container)).toBe(false);
    await expect
      .poll(
        () => screen.container.querySelector('input[name="password"]') !== null,
      )
      .toBe(false);
  });

  it("routes a disabled employee to the blocked state, never to success", async () => {
    fake.state.sale = { id: 7, disabled: true };
    const screen = await renderPage();
    await reachPasswordStep(screen);
    await fillAndSubmitPassword(screen);

    await expect
      .element(
        screen.getByRole("heading", {
          name: "Ihr Nora-Zugang ist derzeit nicht aktiv",
        }),
      )
      .toBeVisible();
    expect(hasSuccessMark(screen.container)).toBe(false);
  });
});

describe("V1B Einmalcode rule", () => {
  it("never advertises an Einmalcode on the password-setup step", async () => {
    const screen = await renderPage();
    await reachPasswordStep(screen);
    await expect
      .poll(() => screen.container.textContent?.includes("Einmalcode") ?? false)
      .toBe(false);
  });

  it("offers the invitation Einmalcode only on the calm invalid state", async () => {
    fake.state.user = null;
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
    await expect
      .element(
        screen.getByRole("link", {
          name: "Einladung mit Einmalcode aktivieren",
        }),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "Zur Anmeldung" }))
      .toBeVisible();
  });
});

describe("V1B password treatment", () => {
  it("confirms a matching repeat quietly and keeps both toggles independent", async () => {
    const screen = await renderPage();
    await reachPasswordStep(screen);

    await screen
      .getByRole("textbox", { name: "Passwort", exact: true })
      .fill("abc-def-ghi-jkl");
    await expect
      .poll(() =>
        screen.container.querySelector('[data-testid="password-match"]'),
      )
      .toBeNull();
    await screen
      .getByRole("textbox", { name: "Passwort wiederholen", exact: true })
      .fill("abc-def-ghi-jkl");
    await expect.element(screen.getByTestId("password-match")).toBeVisible();

    const toggles = screen.getByRole("button", { name: "Passwort anzeigen" });
    await toggles.nth(1).click();
    await expect
      .poll(() =>
        screen.container
          .querySelector('input[name="confirmPassword"]')
          ?.getAttribute("type"),
      )
      .toBe("text");
    await expect
      .poll(() =>
        screen.container
          .querySelector('input[name="password"]')
          ?.getAttribute("type"),
      )
      .toBe("password");
  });

  it("shows the mismatch under the repeated password on submit only", async () => {
    const screen = await renderPage();
    await reachPasswordStep(screen);

    await screen
      .getByRole("textbox", { name: "Passwort", exact: true })
      .fill("erstes-passwort");
    await screen
      .getByRole("textbox", { name: "Passwort wiederholen", exact: true })
      .fill("anderes-passwort");
    await expect
      .poll(
        () =>
          screen.container.textContent?.includes(
            "Die Passwörter stimmen nicht überein.",
          ) ?? false,
      )
      .toBe(false);

    await screen.getByRole("checkbox").click();
    await screen.getByRole("button", { name: "Passwort speichern" }).click();
    await expect
      .element(screen.getByText("Die Passwörter stimmen nicht überein."))
      .toBeVisible();
    expect(hasSuccessMark(screen.container)).toBe(false);
  });
});
