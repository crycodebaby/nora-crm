import { test, expect } from "./fixtures";

test("first-run dashboard shows the Nora onboarding stepper", async ({
  page,
  createSales,
  loginAsAdmin,
}) => {
  const admin = await createSales({
    email: "admin@nora-e2e.local",
    first_name: "Nora",
    last_name: "Admin",
    password: "password",
  });
  expect(admin.role).toBe("admin");

  await loginAsAdmin({
    email: "admin@nora-e2e.local",
    password: "password",
  });

  await expect(page).toHaveTitle(/Nora CRM/);
  await expect(
    page.getByRole("heading", { name: "Wie geht es weiter?" }),
  ).toBeVisible();
  await expect(page.getByText("1/3 erledigt")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Nora CRM installieren" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Ersten Kontakt hinzufügen" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Notiz hinzufügen" }),
  ).toBeDisabled();
});
