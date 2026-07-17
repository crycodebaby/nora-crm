import { expect, test } from "./fixtures";

test.describe("user adding a task", () => {
  test.beforeEach(async ({ createSales, createContact, createCompany }) => {
    const sales = await createSales({
      first_name: "John",
      last_name: "Doe",
      email: "john@doe.com",
      password: "password",
    });

    const company = await createCompany({
      name: "Smith Corp",
      salesId: sales.id,
    });

    await createContact({
      first_name: "Jane",
      last_name: "Smith",
      title: "CEO",
      sales_id: sales.id,
      company_id: company.id,
      notes: [{ text: "Met at a conference." }],
    });

    await createContact({
      first_name: "Bob",
      last_name: "Johnson",
      title: "CTO",
      sales_id: sales.id,
      company_id: company.id,
    });

    await createContact({
      first_name: "Alice",
      last_name: "Williams",
      title: "CFO",
      sales_id: sales.id,
      company_id: company.id,
    });
  });
  test("user adding a task", async ({
    page,
    isMobile,
    menu,
    loginAsAdmin,
    dismissToast,
  }) => {
    await loginAsAdmin({
      email: "john@doe.com",
      password: "password",
    });
    await expect(page).toHaveTitle(/Nora CRM/);

    await menu.goToContacts();
    await page.waitForLoadState("networkidle");

    await page.getByText("Jane Smith").click();
    await page.waitForLoadState("networkidle");

    if (isMobile) {
      await page.getByRole("button", { name: "Anlegen" }).click();
      await page.getByRole("menuitem", { name: "Aufgabe" }).click();
    } else {
      await page.getByRole("button", { name: "Aufgabe hinzufügen" }).click();
    }
    await page.getByLabel("Beschreibung *").fill("Mit Jane nachfassen");
    await page.getByLabel("Fällig am").fill("2026-12-11T21:00");
    await page.getByLabel("Art").click();
    await page.getByRole("option", { name: "Rückruf" }).click();

    await page.getByRole("button", { name: "Speichern" }).click();

    await dismissToast("Aufgabe hinzugefügt");

    if (isMobile) {
      await expect(page.getByText("1 Aufgabe")).toBeVisible();
      await page.getByText("1 Aufgabe").click();

      await expect(page.getByText("Mit Jane nachfassen")).toBeVisible();
    } else {
      await expect(page.getByText("Aufgaben")).toBeVisible();

      await expect(page.getByText("Aufgaben").locator("..")).toHaveText(
        /Mit Jane nachfassen/,
      );
      await menu.goToDashboard();

      await expect(
        page.getByRole("heading", { name: "Offene Aufgaben" }),
      ).toBeVisible();
      await expect(page.getByText("Mit Jane nachfassen")).toBeVisible();
    }
  });
});
