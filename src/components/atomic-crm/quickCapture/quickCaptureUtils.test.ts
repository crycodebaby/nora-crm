/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import type { Company, Contact } from "../types";
import {
  buildDealDescriptionWithSource,
  findPossibleDuplicateCompanies,
  isSimilarCompanyName,
  normalizeCompanyName,
} from "./quickCaptureUtils";

const company = (overrides: Partial<Company> & Pick<Company, "id">): Company =>
  ({
    name: "Müller GmbH",
    customer_number: "KD-000042",
    phone_number: "030 123456",
    sector: "privatkunde",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }) as Company;

const contact = (overrides: Partial<Contact> & Pick<Contact, "id">): Contact =>
  ({
    first_name: "Anna",
    last_name: "Müller",
    company_id: 1,
    email_jsonb: [{ email: "anna@example.com", type: "Work" }],
    phone_jsonb: [{ number: "01701234567", type: "Work" }],
    ...overrides,
  }) as Contact;

describe("normalizeCompanyName", () => {
  it("folds case and whitespace", () => {
    expect(normalizeCompanyName("  Müller   GmbH ")).toBe("müller gmbh");
  });
});

describe("isSimilarCompanyName", () => {
  it("detects equal and contained names", () => {
    expect(isSimilarCompanyName("Müller GmbH", "müller gmbh")).toBe(true);
    expect(isSimilarCompanyName("Müller", "Müller GmbH")).toBe(true);
    expect(isSimilarCompanyName("Schmidt", "Müller")).toBe(false);
  });
});

describe("findPossibleDuplicateCompanies", () => {
  const companies = [company({ id: 1, name: "Müller GmbH" })];

  it("flags similar company names", () => {
    expect(
      findPossibleDuplicateCompanies(companies, { name: "Müller" }),
    ).toHaveLength(1);
  });

  it("flags companies by matching contact email", () => {
    expect(
      findPossibleDuplicateCompanies(companies, { email: "anna@example.com" }, [
        contact({ id: 10, company_id: 1 }),
      ]),
    ).toHaveLength(1);
  });

  it("returns empty when no match", () => {
    expect(
      findPossibleDuplicateCompanies(companies, { name: "Schmidt AG" }),
    ).toHaveLength(0);
  });
});

describe("buildDealDescriptionWithSource", () => {
  it("prefixes source and keeps note", () => {
    expect(
      buildDealDescriptionWithSource("whatsapp", "WhatsApp", "Fenster defekt"),
    ).toBe("Quelle: WhatsApp\n\nFenster defekt");
  });

  it("works without user description", () => {
    expect(buildDealDescriptionWithSource("phone", "Telefon", "")).toBe(
      "Quelle: Telefon",
    );
  });
});
