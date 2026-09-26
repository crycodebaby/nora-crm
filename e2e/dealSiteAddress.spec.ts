import { test, expect } from "./fixtures";
import { createClient } from "@supabase/supabase-js";

const service = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SERVICE_ROLE_KEY!,
  {
    auth: { autoRefreshToken: false, persistSession: false },
  },
);

test("desktop create keeps the manually entered Einsatzort independent of customer changes", async ({
  page,
  isMobile,
  e2eAdmin,
  createCompany,
  createContact,
  loginAsAdmin,
}) => {
  test.skip(isMobile, "Mobile create has no registered Vorgangsliste route");
  const first = await createCompany({
    name: "Adresse Erstkunde",
    salesId: e2eAdmin.id,
  });
  const second = await createCompany({
    name: "Adresse Zweitkunde",
    salesId: e2eAdmin.id,
  });
  await createContact({
    first_name: "Adelheid",
    last_name: "Adresse",
    sales_id: e2eAdmin.id,
    company_id: first.id,
  });
  for (const [id, address, city] of [
    [first.id, "Kundenstraße 1", "Bonn"],
    [second.id, "Kundenstraße 2", "Köln"],
  ] as const) {
    const { error } = await service
      .from("companies")
      .update({ address, city })
      .eq("id", id);
    if (error) throw error;
  }

  await loginAsAdmin(e2eAdmin);
  await page.goto("/#/vorgaenge/create");
  const form = page.getByRole("dialog", { name: "Neuen Vorgang anlegen" });
  await expect(form).toBeVisible();
  const customer = form.getByRole("combobox", { name: /Kunde/i });
  await customer.click();
  await page.getByRole("option", { name: "Adresse Erstkunde" }).click();
  await expect(
    form.getByRole("textbox", { name: "Straße und Hausnummer" }),
  ).toHaveValue("Kundenstraße 1");
  await expect(form.getByRole("textbox", { name: "Ort" })).toHaveValue("Bonn");

  await customer.click();
  await page.getByRole("option", { name: "Adresse Zweitkunde" }).click();
  await expect(
    form.getByRole("textbox", { name: "Straße und Hausnummer" }),
  ).toHaveValue("Kundenstraße 2");
  await expect(form.getByRole("textbox", { name: "Ort" })).toHaveValue("Köln");

  await form
    .getByRole("textbox", { name: "Straße und Hausnummer" })
    .fill("Einsatzstraße 9");
  await form.getByRole("textbox", { name: "Ort" }).fill("Essen");
  await form
    .getByRole("button", { name: "Etage oder Klingelschild ergänzen" })
    .click();
  await form.getByRole("textbox", { name: "Etage" }).fill("3");
  await form
    .getByRole("textbox", { name: "Klingelschild / Mietername" })
    .fill("Meyer");
  await customer.click();
  await page.getByRole("option", { name: "Adresse Erstkunde" }).click();
  await expect(
    form.getByRole("textbox", { name: "Straße und Hausnummer" }),
  ).toHaveValue("Einsatzstraße 9");
  await expect(form.getByRole("textbox", { name: "Ort" })).toHaveValue("Essen");
  await expect(form.getByRole("textbox", { name: "Etage" })).toHaveValue("3");
  await expect(
    form.getByRole("textbox", { name: "Klingelschild / Mietername" }),
  ).toHaveValue("Meyer");

  await form
    .getByRole("textbox", { name: "Titel", exact: true })
    .fill("Adressvertrag E2E");
  await form.getByRole("button", { name: "Speichern" }).click();
  await expect(form).toBeHidden();
  const readDeal = async () => {
    const { data, error } = await service
      .from("deals")
      .select("id,company_id,site_street,site_city,site_floor,site_tenant_name")
      .eq("name", "Adressvertrag E2E")
      .single();
    if (error) throw error;
    return data;
  };
  await expect
    .poll(async () => (await readDeal()).site_street)
    .toBe("Einsatzstraße 9");
  const deal = await readDeal();
  expect(deal).toMatchObject({
    company_id: first.id,
    site_street: "Einsatzstraße 9",
    site_city: "Essen",
    site_floor: "3",
    site_tenant_name: "Meyer",
  });

  const { error: companyError } = await service
    .from("companies")
    .update({ address: "Neue Straße", city: "Düsseldorf" })
    .eq("id", first.id);
  if (companyError) throw companyError;
  expect(await readDeal()).toMatchObject({
    site_street: "Einsatzstraße 9",
    site_city: "Essen",
  });
  await page.goto(`/#/vorgaenge/${deal.id}/show`);
  await expect(
    page
      .getByRole("dialog", { name: "Vorgang" })
      .getByText("Einsatzstraße 9 · Essen"),
  ).toBeVisible();

  await page.goto(`/#/vorgaenge/${deal.id}`);
  const editForm = page.getByRole("dialog", { name: "Vorgang bearbeiten" });
  await expect(
    editForm.getByRole("textbox", { name: "Straße und Hausnummer" }),
  ).toHaveValue("Einsatzstraße 9");
  await editForm
    .getByRole("button", { name: "Einsatzadresse vollständig löschen" })
    .click();
  await expect(
    editForm.getByRole("textbox", { name: "Straße und Hausnummer" }),
  ).toHaveValue("");
  await editForm.getByRole("button", { name: "Speichern" }).click();
  await expect.poll(async () => (await readDeal()).site_street).toBe("");
  expect(await readDeal()).toMatchObject({
    site_street: "",
    site_city: "",
    site_floor: "",
    site_tenant_name: "",
  });
  const { data: audit, error: auditError } = await service
    .from("audit_events")
    .select("metadata")
    .eq("deal_id", deal.id)
    .eq("event_type", "deal.updated")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (auditError) throw auditError;
  expect(audit.metadata.changes).toMatchObject({
    site_street: { old: "Einsatzstraße 9", new: "" },
    site_city: { old: "Essen", new: "" },
  });
});

test("mobile Deal Show reads the stored Einsatzort", async ({
  page,
  isMobile,
  e2eAdmin,
  createCompany,
  loginAsAdmin,
}) => {
  test.skip(!isMobile, "Mobile presentation contract");
  const company = await createCompany({
    name: "Mobile Standortkunde",
    salesId: e2eAdmin.id,
  });
  const { data, error } = await service
    .from("deals")
    .insert({
      company_id: company.id,
      name: "Mobiler Einsatzort",
      stage: "neue-anfrage",
      site_street: "Mobilstraße 4",
      site_city: "Bremen",
      sales_id: e2eAdmin.id,
      expected_closing_date: "2026-10-05",
      amount: 0,
    })
    .select("id")
    .single();
  if (error) throw error;
  await loginAsAdmin(e2eAdmin);
  await page.goto(`/#/vorgaenge/${data.id}/show`);
  await expect(page.getByText("Mobilstraße 4 · Bremen")).toBeVisible();
  await expect(page.getByRole("link", { name: "Start" })).toBeVisible();
});
