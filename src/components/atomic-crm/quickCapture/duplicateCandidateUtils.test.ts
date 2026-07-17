/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import {
  normalizePhoneForSearch,
} from "../misc/globalSearch";
import type { Company, Contact } from "../types";
import {
  DUPLICATE_MAX_CANDIDATES,
  rankDuplicateCandidates,
  scoreCompanyAsDuplicate,
  shouldRunDuplicateSearch,
} from "./duplicateCandidateUtils";

const company = (overrides: Partial<Company> & Pick<Company, "id">): Company =>
  ({
    name: "Müller GmbH",
    customer_number: "KD-000042",
    phone_number: "030 123456",
    city: "Berlin",
    zipcode: "10115",
    sector: "privatkunde",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }) as Company;

const contact = (
  overrides: Partial<Contact> & Pick<Contact, "id">,
): Contact =>
  ({
    first_name: "Anna",
    last_name: "Müller",
    company_id: 1,
    email_jsonb: [{ email: "anna@example.com", type: "Work" }],
    phone_jsonb: [{ number: "01701234567", type: "Work" }],
    ...overrides,
  }) as Contact;

describe("shouldRunDuplicateSearch", () => {
  it("runs for phone-like input", () => {
    expect(shouldRunDuplicateSearch({ phone: "01701234567" })).toBe(true);
  });

  it("runs for email input", () => {
    expect(shouldRunDuplicateSearch({ email: "a@b.de" })).toBe(true);
  });

  it("does not run for very short name-only input", () => {
    expect(shouldRunDuplicateSearch({ name: "ab" })).toBe(false);
  });
});

describe("scoreCompanyAsDuplicate", () => {
  const base = company({ id: 1 });

  it("scores exact customer number", () => {
    const result = scoreCompanyAsDuplicate(
      base,
      { query: "KD-000042" },
      [],
    );
    expect(result?.reasons).toContain("customer_number");
    expect(result?.score).toBeGreaterThanOrEqual(100);
  });

  it("scores same phone on company", () => {
    const result = scoreCompanyAsDuplicate(
      base,
      { phone: "030 123 456" },
      [],
    );
    expect(result?.reasons).toContain("same_phone");
  });

  it("scores same email via contact", () => {
    const result = scoreCompanyAsDuplicate(
      base,
      { email: "anna@example.com" },
      [contact({ id: 10, company_id: 1 })],
    );
    expect(result?.reasons).toContain("same_email");
  });

  it("scores similar name", () => {
    const result = scoreCompanyAsDuplicate(base, { name: "Müller" }, []);
    expect(result?.reasons).toContain("similar_name");
  });

  it("boosts similar name with same city", () => {
    const result = scoreCompanyAsDuplicate(
      base,
      { name: "Müller", city: "Berlin" },
      [],
    );
    expect(result?.reasons).toContain("same_city");
    expect(result?.score).toBeGreaterThan(50);
  });

  it("returns null for weak unrelated name", () => {
    expect(
      scoreCompanyAsDuplicate(base, { name: "Schmidt AG" }, []),
    ).toBeNull();
  });
});

describe("rankDuplicateCandidates", () => {
  const companies = [
    company({ id: 1, name: "Müller GmbH", phone_number: "030 123456" }),
    company({
      id: 2,
      name: "Schmidt GmbH",
      phone_number: "040 999999",
      customer_number: "KD-000099",
    }),
  ];

  it("orders phone match above similar name only", () => {
    const ranked = rankDuplicateCandidates(
      companies,
      { name: "Müller", phone: "040 999999" },
      [],
    );
    expect(ranked[0]?.company.id).toBe(2);
    expect(ranked[0]?.reasons).toContain("same_phone");
  });

  it("limits to five candidates", () => {
    const many = Array.from({ length: 8 }, (_, index) =>
      company({
        id: index + 1,
        name: `Müller ${index}`,
        phone_number: `030 12345${index}`,
      }),
    );
    const ranked = rankDuplicateCandidates(many, { name: "Müller" }, []);
    expect(ranked.length).toBe(DUPLICATE_MAX_CANDIDATES);
  });
});

describe("normalizePhoneForSearch", () => {
  it("strips formatting characters", () => {
    expect(normalizePhoneForSearch("030 / 123-456")).toBe("030123456");
  });
});
