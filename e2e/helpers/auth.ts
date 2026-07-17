import { expect, type ConsoleMessage, type Page } from "@playwright/test";

const LOGIN_PATH = "/#/login?mode=anmelden";

type AdminCredentials = {
  email: string;
  password: string;
};

type RuntimeDiagnostics = {
  consoleMessages: string[];
  pageErrors: string[];
};

const collectLoginDiagnostics = async (
  page: Page,
  runtimeDiagnostics: RuntimeDiagnostics,
) => {
  const alerts = await page
    .getByRole("alert")
    .allTextContents()
    .catch(() => []);
  const notifications = await page
    .locator("[data-sonner-toast]:visible")
    .allTextContents()
    .catch(() => []);
  const formErrors = await page
    .locator('[data-slot="form-message"]:visible')
    .allTextContents()
    .catch(() => []);

  return {
    url: page.url(),
    title: await page.title().catch(() => "<unavailable>"),
    visibleErrors: [...alerts, ...notifications, ...formErrors]
      .map((text) => text.trim())
      .filter(Boolean),
    pageErrors: runtimeDiagnostics.pageErrors,
    consoleMessages: runtimeDiagnostics.consoleMessages,
  };
};

export const loginAsAdmin = async (
  page: Page,
  { email, password }: AdminCredentials,
) => {
  const runtimeDiagnostics: RuntimeDiagnostics = {
    consoleMessages: [],
    pageErrors: [],
  };
  const onPageError = (error: Error) => {
    runtimeDiagnostics.pageErrors.push(error.message);
  };
  const onConsole = (message: ConsoleMessage) => {
    if (message.type() === "error" || message.type() === "warning") {
      runtimeDiagnostics.consoleMessages.push(
        `${message.type()}: ${message.text()}`,
      );
    }
  };

  page.on("pageerror", onPageError);
  page.on("console", onConsole);

  try {
    await page.context().clearCookies();
    await page.goto(LOGIN_PATH);
    await page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.reload();

    await expect(page).toHaveURL(/\/#\/login\?mode=anmelden(?:&|$)/);
    await page.getByLabel("E-Mail").fill(email);
    await page.getByLabel("Passwort").fill(password);
    await page.getByRole("button", { name: "Anmelden" }).click();

    await expect(
      page.getByRole("heading", { name: "Hotboard", exact: true }),
    ).toBeVisible();
  } catch (error) {
    const diagnostics = await collectLoginDiagnostics(page, runtimeDiagnostics);
    throw new Error(`Admin login failed: ${JSON.stringify(diagnostics)}`, {
      cause: error,
    });
  } finally {
    page.off("pageerror", onPageError);
    page.off("console", onConsole);
  }
};
