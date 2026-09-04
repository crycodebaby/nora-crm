import { render } from "vitest-browser-react";
import { StoryWrapper } from "@/test/StoryWrapper";
import { StartPage } from "./StartPage";
import { SignupPage } from "./SignupPage";
import { EmployeeAccessShell } from "./EmployeeAccessShell";
import { SetPasswordPage } from "@/components/supabase/set-password-page";

describe("Employee access public surface", () => {
  it("shows Ergart and Smairys branding without public registration", async () => {
    const screen = await render(
      <StoryWrapper initialEntries={["/login?mode=anmelden"]}>
        <StartPage />
      </StoryWrapper>,
    );

    await expect
      .element(screen.getByText("Mitarbeiterzugang der Ergart Gruppe").first())
      .toBeVisible();
    await expect
      .element(screen.getByAltText("Ergart Gruppe").first())
      .toBeVisible();
    await expect.element(screen.getByAltText("Smairys").first()).toBeVisible();
    await expect
      .poll(
        () => screen.container.textContent?.includes("Registrieren") ?? false,
      )
      .toBe(false);
    await expect
      .poll(
        () =>
          screen.container.textContent?.includes("Konto erstellen") ?? false,
      )
      .toBe(false);
  });

  it("exposes invite activation and password recovery", async () => {
    const screen = await render(
      <StoryWrapper initialEntries={["/login?mode=anmelden"]}>
        <StartPage />
      </StoryWrapper>,
    );

    await expect
      .element(screen.getByRole("button", { name: "Einladung erhalten?" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Passwort vergessen" }))
      .toBeVisible();
  });

  it("keeps legacy sign-up invite-only", async () => {
    const screen = await render(
      <StoryWrapper initialEntries={["/sign-up"]}>
        <SignupPage />
      </StoryWrapper>,
    );

    await expect
      .element(screen.getByText("Zugang nur per Einladung"))
      .toBeVisible();
  });

  it("shows generic invite failure UI without role controls", async () => {
    const screen = await render(
      <StoryWrapper initialEntries={["/set-password"]}>
        <SetPasswordPage />
      </StoryWrapper>,
    );

    await expect
      .element(screen.getByText("Dieser Link ist nicht mehr gültig"))
      .toBeVisible();
    await expect
      .poll(() => screen.container.textContent?.includes("Nora-Rolle") ?? false)
      .toBe(false);
    await expect
      .poll(() => screen.container.textContent?.includes("admin") ?? false)
      .toBe(false);
  });
});

describe("EmployeeAccessShell", () => {
  it("renders the operator and technical marks", async () => {
    const screen = await render(
      <EmployeeAccessShell>
        <p>Inhalt</p>
      </EmployeeAccessShell>,
    );

    await expect.element(screen.getByText("Inhalt")).toBeVisible();
    await expect
      .element(screen.getByAltText("Ergart Gruppe").first())
      .toBeVisible();
    await expect.element(screen.getByAltText("Smairys").first()).toBeVisible();
  });
});

describe("Access email landing (access-link convergence)", () => {
  it("forwards an invitation link to the onboarding flow", async () => {
    const screen = await render(
      <StoryWrapper
        initialEntries={[
          "/zugang-einrichten?access_token=at-1&refresh_token=rt-1",
        ]}
      >
        <div />
      </StoryWrapper>,
    );

    // Both the invitation and the password-setup link land here and converge
    // on the same password-setup experience.
    await expect
      .element(screen.getByRole("button", { name: "Zugang einrichten" }))
      .toBeVisible();
  });

  it("shows the calm invalid state when the link carries no tokens", async () => {
    const screen = await render(
      <StoryWrapper initialEntries={["/zugang-einrichten"]}>
        <div />
      </StoryWrapper>,
    );

    await expect
      .element(screen.getByText("Dieser Link ist nicht mehr gültig"))
      .toBeVisible();
  });

  it("never exposes tokens as visible page content", async () => {
    const screen = await render(
      <StoryWrapper
        initialEntries={[
          "/zugang-einrichten?access_token=at-1&refresh_token=rt-1",
        ]}
      >
        <div />
      </StoryWrapper>,
    );

    await expect
      .element(screen.getByRole("button", { name: "Zugang einrichten" }))
      .toBeVisible();
    await expect
      .poll(() => screen.container.textContent?.includes("at-1") ?? false)
      .toBe(false);
    await expect
      .poll(() => screen.container.textContent?.includes("rt-1") ?? false)
      .toBe(false);
  });
});

describe("Public self-registration stays impossible", () => {
  it.each(["anmelden", "einladung", "passwort"])(
    "offers no registration affordance in mode=%s",
    async (mode) => {
      const screen = await render(
        <StoryWrapper initialEntries={[`/login?mode=${mode}`]}>
          <StartPage />
        </StoryWrapper>,
      );

      // Every public entry point must be invite-only: no way to turn an
      // arbitrary email address into a Nora user.
      await expect
        .poll(() => screen.container.textContent?.length ?? 0)
        .toBeGreaterThan(0);
      for (const forbidden of [
        "Registrieren",
        "Konto erstellen",
        "Konto anlegen",
        "Jetzt registrieren",
      ]) {
        await expect
          .poll(
            () => screen.container.textContent?.includes(forbidden) ?? false,
          )
          .toBe(false);
      }
    },
  );
});
