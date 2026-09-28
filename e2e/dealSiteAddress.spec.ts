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
  await expect.poll(async () => (await readDeal()).site_street).toBeNull();
  expect(await readDeal()).toMatchObject({
    site_street: null,
    site_city: null,
    site_floor: null,
    site_tenant_name: null,
  });
  const { data: audit, error: auditError } = await service
    .from("audit_events")
    .select("metadata")
    .eq("deal_id", deal.id)
    .eq("event_type", "deal.updated");
  if (auditError) throw auditError;
  expect(audit).toHaveLength(1);
  expect(audit[0].metadata.changes).toMatchObject({
    site_street: { old: "Einsatzstraße 9", new: null },
    site_city: { old: "Essen", new: null },
    site_floor: { old: "3", new: null },
    site_tenant_name: { old: "Meyer", new: null },
  });
});

test("editing a deal preserves untouched NULL sites and a single-field clear writes NULL", async ({
  page,
  isMobile,
  e2eAdmin,
  createCompany,
  loginAsAdmin,
}) => {
  test.skip(isMobile, "Mobile has no registered Vorgang edit route");
  const company = await createCompany({
    name: "Null-Einsatzort",
    salesId: e2eAdmin.id,
  });
  const { data: deal, error: createError } = await service
    .from("deals")
    .insert({
      company_id: company.id,
      name: "Unberührter Einsatzort",
      stage: "neue-anfrage",
      sales_id: e2eAdmin.id,
      expected_closing_date: "2026-10-05",
      amount: 0,
      site_street: null,
      site_city: null,
      site_floor: null,
      site_tenant_name: null,
    })
    .select("id")
    .single();
  if (createError) throw createError;
  const readSite = async () => {
    const { data, error } = await service
      .from("deals")
      .select("name,site_street,site_city,site_floor,site_tenant_name")
      .eq("id", deal.id)
      .single();
    if (error) throw error;
    return data;
  };
  const readAudit = async () => {
    const { data, error } = await service
      .from("audit_events")
      .select("metadata")
      .eq("deal_id", deal.id)
      .eq("event_type", "deal.updated")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data;
  };
  await loginAsAdmin(e2eAdmin);
  await page.goto(`/#/vorgaenge/${deal.id}`);
  let form = page.getByRole("dialog", { name: "Vorgang bearbeiten" });
  await expect(form).toBeVisible();
  await form
    .getByRole("textbox", { name: "Titel", exact: true })
    .fill("Nur Titel geändert");
  await form.getByRole("button", { name: "Speichern" }).click();
  await expect
    .poll(async () => (await readSite()).name)
    .toBe("Nur Titel geändert");
  expect(await readSite()).toMatchObject({
    site_street: null,
    site_city: null,
    site_floor: null,
    site_tenant_name: null,
  });
  expect(await readAudit()).toHaveLength(1);
  expect(Object.keys((await readAudit())[0].metadata.changes)).not.toContain(
    "site_street",
  );

  await page.goto(`/#/vorgaenge/${deal.id}`);
  form = page.getByRole("dialog", { name: "Vorgang bearbeiten" });
  await form
    .getByRole("textbox", { name: "Straße und Hausnummer" })
    .fill("Nur dieses Feld");
  await form.getByRole("button", { name: "Speichern" }).click();
  await expect
    .poll(async () => (await readSite()).site_street)
    .toBe("Nur dieses Feld");

  await page.goto(`/#/vorgaenge/${deal.id}`);
  form = page.getByRole("dialog", { name: "Vorgang bearbeiten" });
  await form.getByRole("textbox", { name: "Straße und Hausnummer" }).fill("");
  await form.getByRole("button", { name: "Speichern" }).click();
  await expect.poll(async () => (await readSite()).site_street).toBeNull();
  expect(await readSite()).toMatchObject({
    site_city: null,
    site_floor: null,
    site_tenant_name: null,
  });
  const audit = await readAudit();
  expect(audit).toHaveLength(3);
  expect(audit[2].metadata.changes.site_street).toEqual({
    old: "Nur dieses Feld",
    new: null,
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
