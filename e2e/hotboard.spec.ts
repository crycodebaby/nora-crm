import { test, expect } from "./fixtures";

test("dashboard shows Hotboard after a contact note exists", async ({
  page,
  createSales,
  createContact,
  loginAsAdmin,
}) => {
  const admin = await createSales({
    email: "hotboard@nora-e2e.local",
    first_name: "Nora",
    last_name: "Hotboard",
    password: "password",
  });

  await createContact({
    first_name: "Ada",
    last_name: "Lovelace",
    sales_id: admin.id,
    title: "CTO",
    notes: [{ text: "Erste Kontaktnotiz für das Hotboard." }],
  });

  await loginAsAdmin({
    email: "hotboard@nora-e2e.local",
    password: "password",
  });

  await expect(page).toHaveTitle(/Nora CRM/);

  try {
    await expect(
      page.getByRole("heading", { name: "Hotboard", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Arbeitsboard" }),
    ).toBeVisible();
  } catch (error) {
    throw new Error(
      `Dashboard Hotboard assertion failed after authenticated shell loaded: ${page.url()}`,
      { cause: error },
    );
  }
});
