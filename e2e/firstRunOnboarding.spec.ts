import { test, expect } from "./fixtures";

test("first-run dashboard shows the Nora onboarding stepper", async ({
  page,
  e2eAdmin,
  loginAsAdmin,
}) => {
  // First-run means an empty business state (no contacts, no notes), which
  // resetBusinessState guarantees — not an empty employee table.
  await loginAsAdmin(e2eAdmin);

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
