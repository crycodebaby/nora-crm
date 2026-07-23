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
      .element(screen.getByText("Einladung ungültig oder abgelaufen"))
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
