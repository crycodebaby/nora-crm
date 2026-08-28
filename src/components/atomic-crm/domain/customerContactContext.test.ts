/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import {
  isEffectiveContactOfCompany,
  resolveCustomerContacts,
} from "./customerContactContext";
import { effectiveContactContractCases } from "./effectiveContactContext.contractCases";

describe("resolveCustomerContacts", () => {
  it("returns empty context when no company is given", () => {
    const result = resolveCustomerContacts(null, [{ id: 1 }]);
    expect(result.members).toEqual([]);
    expect(result.preferredContact).toBeNull();
  });

  it("includes only company_id-matching contacts as members when no self_contact_id", () => {
    const company = { id: 10 };
    const contacts = [
      { id: 1, company_id: 10, is_primary: true },
      { id: 2, company_id: 10, is_primary: false },
      { id: 3, company_id: 99, is_primary: true },
    ];
    const result = resolveCustomerContacts(company, contacts);
    expect(result.members.map((c) => c.id)).toEqual([1, 2]);
    expect(result.explicitPrimaryContact?.id).toBe(1);
    expect(result.preferredContact?.id).toBe(1);
  });

  it("Freddie scenario: self_contact with a DIFFERENT company_id is a member but never explicitPrimaryContact", () => {
    // Freddie stays Ansprechpartner of Firma A (company_id=1, is_primary=true
    // there) while also being self_contact_id of his own Privatkundenakte
    // (company id=2).
    const privateCompany = { id: 2, self_contact_id: 42 };
    const freddie = { id: 42, company_id: 1, is_primary: true };

    const result = resolveCustomerContacts(privateCompany, [freddie]);

    expect(result.selfContact?.id).toBe(42);
    expect(result.members.map((c) => c.id)).toEqual([42]);
    // is_primary=true at Firma A must NEVER be read as primary for the
    // Privatkundenakte — company_id doesn't match.
    expect(result.explicitPrimaryContact).toBeNull();
    expect(result.preferredContact?.id).toBe(42);
  });

  it("prefers explicitPrimaryContact over selfContact when both exist and differ", () => {
    const company = { id: 5, self_contact_id: 2 };
    const contacts = [
      { id: 1, company_id: 5, is_primary: true },
      { id: 2, company_id: 5, is_primary: false },
    ];
    const result = resolveCustomerContacts(company, contacts);
    expect(result.explicitPrimaryContact?.id).toBe(1);
    expect(result.selfContact?.id).toBe(2);
    expect(result.preferredContact?.id).toBe(1);
    expect(result.members.map((c) => c.id).sort()).toEqual([1, 2]);
  });

  it("deduplicates when the self_contact is already a company_id member", () => {
    const company = { id: 5, self_contact_id: 1 };
    const contacts = [{ id: 1, company_id: 5, is_primary: true }];
    const result = resolveCustomerContacts(company, contacts);
    expect(result.members).toHaveLength(1);
  });
});

describe("isEffectiveContactOfCompany", () => {
  it("true when company_id matches", () => {
    expect(
      isEffectiveContactOfCompany({ id: 1, company_id: 9 }, { id: 9 }),
    ).toBe(true);
  });

  it("true when self_contact_id matches, regardless of company_id", () => {
    expect(
      isEffectiveContactOfCompany(
        { id: 42, company_id: 1 },
        { id: 2, self_contact_id: 42 },
      ),
    ).toBe(true);
  });

  it("false for an unrelated contact", () => {
    expect(
      isEffectiveContactOfCompany(
        { id: 7, company_id: 1 },
        { id: 2, self_contact_id: 42 },
      ),
    ).toBe(false);
  });

  it("regression: contact id/self_contact_id = 0 is a valid identity, not 'absent'", () => {
    // A demo/FakeRest contact id of 0 must be treated exactly like any other
    // id — resolution here uses String()-based comparison (sameId), not
    // truthiness, so this must already pass; kept as an explicit regression
    // guard against a future truthiness regression (Falsy-ID Guardrail).
    expect(
      isEffectiveContactOfCompany({ id: 0, company_id: 1 }, { id: 1 }),
    ).toBe(true);
    expect(
      isEffectiveContactOfCompany(
        { id: 0, company_id: 1 },
        { id: 2, self_contact_id: 0 },
      ),
    ).toBe(true);
  });

  describe("contract matrix (parity with SQL + FakeRest)", () => {
    it.each(effectiveContactContractCases)(
      "$name: $description",
      ({ contact, company, expected }) => {
        expect(isEffectiveContactOfCompany(contact, company)).toBe(expected);
      },
    );
  });
});
