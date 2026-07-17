import { expect, type Page } from "@playwright/test";

const LOGIN_PATH = "/login?mode=anmelden";

type AdminCredentials = {
  email: string;
  password: string;
};

const collectLoginDiagnostics = async (page: Page) => {
  const alerts = await page
    .getByRole("alert")
    .allTextContents()
    .catch(() => []);
  const notifications = await page
    .locator("[data-sonner-toast]")
    .allTextContents()
    .catch(() => []);

  return {
    url: page.url(),
    alerts: alerts.map((text) => text.trim()).filter(Boolean),
    notifications: notifications.map((text) => text.trim()).filter(Boolean),
  };
};

export const loginAsAdmin = async (
  page: Page,
  { email, password }: AdminCredentials,
) => {
  await page.context().clearCookies();
  await page.goto(LOGIN_PATH);
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.reload();

  await expect(page).toHaveURL(/\/login\?mode=anmelden/);
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort").fill(password);
  await page.getByRole("button", { name: "Anmelden" }).click();

  try {
    await expect(
      page.getByRole("heading", { name: "Hotboard", exact: true }),
    ).toBeVisible();
  } catch (error) {
    const diagnostics = await collectLoginDiagnostics(page);
    throw new Error(
      `Admin login did not reach the Hotboard: ${JSON.stringify(diagnostics)}`,
      { cause: error },
    );
  }
};
