import { describe, expect, it } from "vitest";
import { buildCustomerCreatePayload } from "./buildCustomerCreatePayload";
import { CONTACT_CAPTURE_FIELD } from "./CustomerContactCaptureInputs";

describe("buildCustomerCreatePayload — Unternehmen/Selbstständig", () => {
  it("business with no contact (mode 'none') → company only", () => {
    const result = buildCustomerCreatePayload({
      customer_kind: "business",
      name: "WEG Königsallee 12",
      [CONTACT_CAPTURE_FIELD]: "none",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.params.company.name).toBe("WEG Königsallee 12");
    expect(result.params.company.customer_kind).toBe("business");
    expect(result.params.contact).toBeNull();
    expect(result.params.existingContactId).toBeNull();
  });

  it("business with a new contact defaults to a fresh primary contact", () => {
    const result = buildCustomerCreatePayload({
      customer_kind: "business",
      name: "Metaphor GmbH",
      [CONTACT_CAPTURE_FIELD]: "new",
      contact_first_name: "Max",
      contact_last_name: "Mustermann",
      contact_email_jsonb: [{ email: "max@metaphor.de", type: "Work" }],
      contact_phone_jsonb: [{ number: "0176", type: "Mobile" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.params.contact).toMatchObject({
      first_name: "Max",
      last_name: "Mustermann",
      email_jsonb: [{ email: "max@metaphor.de", type: "Work" }],
      phone_jsonb: [{ number: "0176", type: "Mobile" }],
    });
    expect(result.params.existingContactId).toBeNull();
  });

  it("self-employed: 'self' mode carries over the take-over fields (Angaben übernehmen) as the contact", () => {
    const result = buildCustomerCreatePayload({
      customer_kind: "business",
      name: "Sabine Becker Fensterservice",
      [CONTACT_CAPTURE_FIELD]: "self",
      contact_first_name: "Sabine",
      contact_last_name: "Becker",
      // "Angaben übernehmen" copied these from the company fields client-side
      contact_email_jsonb: [{ email: "info@becker-fenster.de", type: "Work" }],
      contact_phone_jsonb: [{ number: "0211 000", type: "Central" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // No re-typing: the same email/phone values end up on the contact record.
    expect(result.params.contact?.email_jsonb).toEqual([
      { email: "info@becker-fenster.de", type: "Work" },
    ]);
    expect(result.params.contact?.phone_jsonb).toEqual([
      { number: "0211 000", type: "Central" },
    ]);
  });

  it("business with an existing contact → existingContactId, no new contact payload", () => {
    const result = buildCustomerCreatePayload({
      customer_kind: "business",
      name: "Hausverwaltung Beispiel GmbH",
      [CONTACT_CAPTURE_FIELD]: "existing",
      contact_existing_id: 42,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.params.existingContactId).toBe(42);
    expect(result.params.contact).toBeNull();
  });

  it("drops business-only fields (sector/size/revenue/tax_identifier) — none apply here since kind stays business, but empty array rows are always stripped", () => {
    const result = buildCustomerCreatePayload({
      customer_kind: "business",
      name: "Rheinbogen Hausverwaltung",
      [CONTACT_CAPTURE_FIELD]: "none",
      email_jsonb: [
        { email: "", type: "Work" },
        { email: "info@rheinbogen.de", type: "Work" },
      ],
      links_jsonb: [{ url: "", type: "website" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.params.company.email_jsonb).toEqual([
      { email: "info@rheinbogen.de", type: "Work" },
    ]);
    expect(result.params.company.links_jsonb).toEqual([]);
  });
});

describe("buildCustomerCreatePayload — Privatperson", () => {
  it("derives the company name from the person's name and marks them as the implicit contact", () => {
    const result = buildCustomerCreatePayload({
      customer_kind: "individual",
      contact_first_name: "Sabine",
      contact_last_name: "Becker",
      contact_gender: "female",
      email_jsonb: [{ email: "sabine.becker@nora-demo.local", type: "Home" }],
      phone_jsonb: [{ number: "+49 211 000 41 02", type: "Mobile" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.params.company.name).toBe("Sabine Becker");
    expect(result.params.company.customer_kind).toBe("individual");
    // No business-only fields for a private customer.
    expect(result.params.company.sector).toBeNull();
    expect(result.params.company.size).toBeNull();
    expect(result.params.company.revenue).toBeNull();
    expect(result.params.company.tax_identifier).toBeNull();
    // Same data entered once, reused for the contact — no re-typing.
    expect(result.params.contact).toMatchObject({
      first_name: "Sabine",
      last_name: "Becker",
      email_jsonb: [{ email: "sabine.becker@nora-demo.local", type: "Home" }],
      phone_jsonb: [{ number: "+49 211 000 41 02", type: "Mobile" }],
    });
    expect(result.params.existingContactId).toBeNull();
  });

  it("fails fast with a clear error when neither a company name nor a person name is present", () => {
    const result = buildCustomerCreatePayload({ customer_kind: "individual" });
    expect(result).toEqual({ ok: false, error: "company_name_required" });
  });

  it("fails fast for business mode without a company name", () => {
    const result = buildCustomerCreatePayload({ customer_kind: "business" });
    expect(result).toEqual({ ok: false, error: "company_name_required" });
  });
});
