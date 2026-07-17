import {
  expect,
  type ConsoleMessage,
  type Page,
  type Response,
} from "@playwright/test";

const LOGIN_PATH = "/#/login?mode=anmelden";
const AUTHENTICATED_HOME_URL = /\/#\/?(?:\?.*)?$/;
const ALLOWED_EXTERNAL_HOST_SUFFIXES = ["localhost", "127.0.0.1"] as const;

type AdminCredentials = {
  email: string;
  password: string;
};

type RuntimeDiagnostics = {
  consoleMessages: string[];
  pageErrors: string[];
  failedResponses: string[];
  externalRequests: string[];
};

const isAllowedRequestUrl = (rawUrl: string) => {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "data:" || url.protocol === "blob:") {
      return true;
    }
    return ALLOWED_EXTERNAL_HOST_SUFFIXES.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    );
  } catch {
    return true;
  }
};

const redactSensitiveText = (value: string) =>
  value
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      "[REDACTED_JWT]",
    )
    .replace(
      /(password|service[_-]?role(?:[_-]?key)?|apikey|authorization)\s*[:=]\s*["']?[^,\s"']+/gi,
      "$1=[REDACTED]",
    );

const truncateBodyText = (text: string, maxLength = 500) => {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}…`;
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
  const headings = await page
    .locator("h1, h2, h3, h4")
    .allTextContents()
    .catch(() => []);
  const navigationLabels = await page
    .locator(
      '[data-testid="authenticated-app-shell"] a:visible, [data-testid="authenticated-app-shell"] nav :visible',
    )
    .allTextContents()
    .catch(() => []);
  const bodyText = await page
    .locator("body")
    .innerText()
    .catch(() => "<unavailable>");

  return {
    url: page.url(),
    title: await page.title().catch(() => "<unavailable>"),
    headings: headings.map((text) => text.trim()).filter(Boolean),
    navigation: navigationLabels
      .map((text) => text.trim())
      .filter(Boolean)
      .slice(0, 20),
    bodyText: truncateBodyText(redactSensitiveText(bodyText)),
    visibleErrors: [...alerts, ...notifications, ...formErrors]
      .map((text) => text.trim())
      .filter(Boolean),
    pageErrors: runtimeDiagnostics.pageErrors.map(redactSensitiveText),
    consoleMessages:
      runtimeDiagnostics.consoleMessages.map(redactSensitiveText),
    failedResponses: runtimeDiagnostics.failedResponses,
    externalRequests: runtimeDiagnostics.externalRequests,
  };
};

const assertNoUnexpectedExternalRequests = (
  runtimeDiagnostics: RuntimeDiagnostics,
) => {
  if (runtimeDiagnostics.externalRequests.length === 0) {
    return;
  }

  throw new Error(
    `Unexpected external requests during login: ${JSON.stringify(
      runtimeDiagnostics.externalRequests,
    )}`,
  );
};

/**
 * Signs in as an admin and waits only for the authenticated app shell.
 * Dashboard-specific content (Hotboard, onboarding stepper) belongs in the
 * calling test, not here.
 *
 * Playwright already isolates cookies/storage per context, so this helper
 * does a single navigation to the login route without clear/reload churn.
 */
export const loginAsAdmin = async (
  page: Page,
  { email, password }: AdminCredentials,
) => {
  const runtimeDiagnostics: RuntimeDiagnostics = {
    consoleMessages: [],
    pageErrors: [],
    failedResponses: [],
    externalRequests: [],
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
  const onResponse = (response: Response) => {
    const url = response.url();
    if (!isAllowedRequestUrl(url)) {
      runtimeDiagnostics.externalRequests.push(
        `${response.request().method()} ${url}`,
      );
    }
    if (response.status() >= 400) {
      runtimeDiagnostics.failedResponses.push(
        `${response.status()} ${response.request().method()} ${url}`,
      );
    }
  };

  page.on("pageerror", onPageError);
  page.on("console", onConsole);
  page.on("response", onResponse);

  try {
    await page.goto(LOGIN_PATH);

    try {
      await expect(page).toHaveURL(/\/#\/login\?mode=anmelden(?:&|$)/);
      await page.getByLabel("E-Mail").fill(email);
      await page.getByLabel("Passwort").fill(password);
      await page.getByRole("button", { name: "Anmelden" }).click();
      await expect(page).not.toHaveURL(/\/#\/login(?:\?|$)/);
      await expect(page).toHaveURL(AUTHENTICATED_HOME_URL);
    } catch (error) {
      const diagnostics = await collectLoginDiagnostics(
        page,
        runtimeDiagnostics,
      );
      throw new Error(
        `Admin auth failed: still on login or credentials rejected: ${JSON.stringify(diagnostics)}`,
        { cause: error },
      );
    }

    try {
      await expect(page.getByTestId("authenticated-app-shell")).toBeVisible();
      await expect(page.getByRole("link", { name: "Kontakte" })).toBeVisible();
    } catch (error) {
      const diagnostics = await collectLoginDiagnostics(
        page,
        runtimeDiagnostics,
      );
      throw new Error(
        `Authenticated app shell not loaded after login: ${JSON.stringify(diagnostics)}`,
        { cause: error },
      );
    }

    assertNoUnexpectedExternalRequests(runtimeDiagnostics);
  } finally {
    page.off("pageerror", onPageError);
    page.off("console", onConsole);
    page.off("response", onResponse);
  }
};
