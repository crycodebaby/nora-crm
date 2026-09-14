import { test, expect } from "./fixtures";

test("dashboard shows Hotboard after a contact note exists", async ({
  page,
  e2eAdmin,
  createContact,
  loginAsAdmin,
}) => {
  await createContact({
    first_name: "Ada",
    last_name: "Lovelace",
    sales_id: e2eAdmin.id,
    title: "CTO",
    notes: [{ text: "Erste Kontaktnotiz für das Hotboard." }],
  });

  await loginAsAdmin(e2eAdmin);

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
