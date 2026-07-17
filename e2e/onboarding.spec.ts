import { test, expect } from "./fixtures";

test("bootstrapped admin can sign in and reaches the Nora hotboard", async ({
  page,
  createSales,
}) => {
  const admin = await createSales({
    email: "admin@nora-e2e.local",
    first_name: "Nora",
    last_name: "Admin",
    password: "password",
  });
  expect(admin.role).toBe("admin");

  await page.goto("http://localhost:5175/");

  await expect(page).toHaveTitle(/Nora CRM/);
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page.getByLabel("First name")).not.toBeVisible();
  await expect(page.getByLabel("Last name")).not.toBeVisible();

  await page.getByLabel("Email").fill("admin@nora-e2e.local");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: "Hotboard" })).toBeVisible();
  await expect(page.getByText("Work board")).toBeVisible();
});
