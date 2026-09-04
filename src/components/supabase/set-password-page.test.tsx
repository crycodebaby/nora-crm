import { render } from "vitest-browser-react";
import { StoryWrapper } from "@/test/StoryWrapper";
import { SetPasswordPage, mapPasswordSetupError } from "./set-password-page";

const INVITE_ENTRY = "/set-password?access_token=at-1&refresh_token=rt-1";

describe("SetPasswordPage password visibility", () => {
  it("starts with both password fields hidden", async () => {
    const screen = await render(
      <StoryWrapper initialEntries={[INVITE_ENTRY]}>
        <SetPasswordPage />
      </StoryWrapper>,
    );

    await expect
      .poll(() =>
        screen.container
          .querySelector('input[name="password"]')
          ?.getAttribute("type"),
      )
      .toBe("password");
    await expect
      .poll(() =>
        screen.container
          .querySelector('input[name="confirmPassword"]')
          ?.getAttribute("type"),
      )
      .toBe("password");
  });

  it("toggles the password field independently of confirm-password", async () => {
    const screen = await render(
      <StoryWrapper initialEntries={[INVITE_ENTRY]}>
        <SetPasswordPage />
      </StoryWrapper>,
    );

    const toggles = screen.getByRole("button", { name: "Passwort anzeigen" });
    await toggles.first().click();

    await expect
      .poll(() =>
        screen.container
          .querySelector('input[name="password"]')
          ?.getAttribute("type"),
      )
      .toBe("text");
    await expect
      .poll(() =>
        screen.container
          .querySelector('input[name="confirmPassword"]')
          ?.getAttribute("type"),
      )
      .toBe("password");

    await expect
      .element(screen.getByRole("button", { name: "Passwort ausblenden" }))
      .toBeVisible();
  });

  it("hides the password again on a second toggle click", async () => {
    const screen = await render(
      <StoryWrapper initialEntries={[INVITE_ENTRY]}>
        <SetPasswordPage />
      </StoryWrapper>,
    );

    const toggle = screen
      .getByRole("button", { name: "Passwort anzeigen" })
      .first();
    await toggle.click();
    await screen
      .getByRole("button", { name: "Passwort ausblenden" })
      .first()
      .click();

    await expect
      .poll(() =>
        screen.container
          .querySelector('input[name="password"]')
          ?.getAttribute("type"),
      )
      .toBe("password");
  });

  it("uses type=button on the visibility toggles so they never submit the form", async () => {
    const screen = await render(
      <StoryWrapper initialEntries={[INVITE_ENTRY]}>
        <SetPasswordPage />
      </StoryWrapper>,
    );

    const toggle = screen
      .getByRole("button", { name: "Passwort anzeigen" })
      .first();
    await expect.element(toggle).toHaveAttribute("type", "button");
  });

  it("shows the password length/strength guidance", async () => {
    const screen = await render(
      <StoryWrapper initialEntries={[INVITE_ENTRY]}>
        <SetPasswordPage />
      </StoryWrapper>,
    );

    await expect
      .element(
        screen.getByText(
          "Mindestens 12 Zeichen. Verwenden Sie kein leicht erratbares Passwort.",
        ),
      )
      .toBeVisible();
  });
});

describe("SetPasswordPage invalid/expired invite", () => {
  it("still shows the generic invite failure UI without tokens or a session", async () => {
    const screen = await render(
      <StoryWrapper initialEntries={["/set-password"]}>
        <SetPasswordPage />
      </StoryWrapper>,
    );

    await expect
      .element(screen.getByText("Einladung ungültig oder abgelaufen"))
      .toBeVisible();
  });
});

describe("mapPasswordSetupError", () => {
  it("maps weak/easy-to-guess password rejections to actionable German copy", () => {
    expect(
      mapPasswordSetupError({
        message:
          "Password is known to be weak and easy to guess, please choose a different one.",
      }),
    ).toBe(
      "Dieses Passwort ist zu leicht zu erraten. Bitte wählen Sie ein längeres und persönlicheres Passwort.",
    );
  });

  it("maps too-short password rejections to the 12-character guidance", () => {
    expect(
      mapPasswordSetupError({
        message: "Password should be at least 6 characters.",
      }),
    ).toBe("Das Passwort ist zu kurz. Verwenden Sie mindestens 12 Zeichen.");
  });

  it("maps expired/invalid session errors to a re-request message", () => {
    expect(
      mapPasswordSetupError({ message: "Auth session missing!", status: 401 }),
    ).toBe(
      "Dieser Link ist nicht mehr gültig. Bitte fordern Sie einen neuen Link an.",
    );
  });

  it("falls back to a calm generic message for unknown errors", () => {
    expect(mapPasswordSetupError(new Error("boom"))).toBe(
      "Das Passwort konnte nicht gesetzt werden. Bitte versuchen Sie es erneut oder fordern Sie eine neue Einladung an.",
    );
  });
});
