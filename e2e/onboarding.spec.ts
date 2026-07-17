import { test, expect } from "./fixtures";

test("bootstrapped admin can sign in and reaches the Nora hotboard", async ({
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
  await expect(page.getByRole("heading", { name: "Hotboard" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Arbeitsboard" }),
  ).toBeVisible();
});
