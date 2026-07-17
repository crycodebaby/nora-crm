import { test, expect } from "./fixtures";

test("user adds a tag to several contacts", async ({
  page,
  isMobile,
  createContact,
  createSales,
  menu,
  loginAsAdmin,
  dismissToast,
}) => {
  test.skip(isMobile, "Bulk tag is only available on desktop");

  const sales = await createSales({
    email: "john@doe.com",
    first_name: "John",
    last_name: "Doe",
    password: "password",
  });

  await createContact({
    first_name: "Ada",
    last_name: "Lovelace",
    sales_id: sales.id,
    title: "CTO",
  });
  await createContact({
    first_name: "Grace",
    last_name: "Hopper",
    sales_id: sales.id,
    title: "Rear Admiral",
  });

  await loginAsAdmin({
    email: "john@doe.com",
    password: "password",
  });

  await expect(page).toHaveTitle(/Nora CRM/);
  await expect(page.getByRole("link", { name: "Kontakte" })).toBeVisible();

  await menu.goToContacts();
  await expect(page.getByText("Ada Lovelace")).toBeVisible();
  await expect(page.getByText("Grace Hopper")).toBeVisible();

  const checkboxes = page.getByRole("checkbox");
  await checkboxes.nth(1).click();
  await page.getByRole("button", { name: "Alle auswählen" }).click();

  await page.getByRole("button", { name: "Markieren" }).click();
  await page.getByRole("button", { name: "Neue Markierung anlegen" }).click();
  await page.getByLabel("Name der Markierung").fill("Interessent");
  await page.getByRole("button", { name: "Speichern" }).click();

  await dismissToast("Markierung zu 2 Kontakten hinzugefügt");

  await expect(
    page.getByText("Grace Hopper").locator("xpath=ancestor::a[1]"),
  ).toContainText("Interessent");
  await expect(
    page.getByText("Ada Lovelace").locator("xpath=ancestor::a[1]"),
  ).toContainText("Interessent");
});
