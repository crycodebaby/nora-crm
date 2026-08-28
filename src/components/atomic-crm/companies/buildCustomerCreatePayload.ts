/**
 * Pure mapping: CustomerCreateForm field values → create_customer_with_contact
 * RPC payload. Extracted from the form component so the branching logic
 * (Unternehmen/Selbstständig vs. Privatperson, Ansprechpartner-Modus) is
 * unit-testable without mounting the full form (Customer & Contact Workflow
 * Wave — "keine Businesslogik tief in visuellen Komponenten verstecken").
 */
import { cleanLinksJsonb } from "../misc/linksModel";
import type { CreateCustomerWithContactParams } from "../operations/executeCreateCustomerWithContact";
import {
  CONTACT_CAPTURE_FIELD,
  type ContactCaptureMode,
} from "./CustomerContactCaptureInputs";

const cleanEmails = (rows: any[] | null | undefined) =>
  (rows ?? []).filter((r) => r && r.email);
const cleanPhones = (rows: any[] | null | undefined) =>
  (rows ?? []).filter((r) => r && r.number);

export type BuildCustomerCreatePayloadResult =
  | { ok: true; params: CreateCustomerWithContactParams }
  | { ok: false; error: "company_name_required" };

export const buildCustomerCreatePayload = (
  values: Record<string, any>,
): BuildCustomerCreatePayloadResult => {
  const customerKind = values.customer_kind ?? "business";
  const isIndividual = customerKind === "individual";

  const company = {
    name: isIndividual
      ? [values.contact_first_name, values.contact_last_name]
          .filter(Boolean)
          .join(" ")
          .trim()
      : values.name,
    customer_kind: customerKind,
    sector: isIndividual ? null : values.sector,
    size: isIndividual ? null : values.size,
    address: values.address,
    zipcode: values.zipcode,
    city: values.city,
    state_abbr: values.state_abbr,
    country: values.country,
    description: values.description,
    revenue: isIndividual ? null : values.revenue,
    tax_identifier: isIndividual ? null : values.tax_identifier,
    sales_id: values.sales_id,
    links_jsonb: cleanLinksJsonb(values.links_jsonb),
    email_jsonb: cleanEmails(values.email_jsonb),
    phone_jsonb: cleanPhones(values.phone_jsonb),
  };

  if (!company.name) {
    return { ok: false, error: "company_name_required" };
  }

  let contact: Record<string, unknown> | null = null;
  let existingContactId: string | number | null = null;

  const mode: ContactCaptureMode = isIndividual
    ? "self"
    : (values[CONTACT_CAPTURE_FIELD] ?? "new");
  // "self" = Unternehmer/Selbstständiger ist selbst Ansprechpartner — der neu
  // angelegte Kontakt wird zusätzlich als self_contact_id der Kundenakte
  // markiert (Self Contact Wave, 2026-08-26). Für individual ist das
  // serverseitig ohnehin immer der Fall, markSelf ist dort ein No-op.
  const markSelf = mode === "self";

  if (mode === "existing") {
    existingContactId = values.contact_existing_id ?? null;
  } else if (mode === "new" || mode === "self") {
    contact = {
      first_name: values.contact_first_name,
      last_name: values.contact_last_name,
      gender: values.contact_gender,
      title: values.contact_title,
      email_jsonb: cleanEmails(
        values.contact_email_jsonb ?? (isIndividual ? values.email_jsonb : []),
      ),
      phone_jsonb: cleanPhones(
        values.contact_phone_jsonb ?? (isIndividual ? values.phone_jsonb : []),
      ),
      links_jsonb: cleanLinksJsonb(
        values.contact_links_jsonb ?? (isIndividual ? values.links_jsonb : []),
      ),
    };
  }

  return {
    ok: true,
    params: { company, contact, existingContactId, markSelf },
  };
};
