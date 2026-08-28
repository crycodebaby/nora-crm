/**
 * Shared scenario matrix for the "is this contact the effective contact of
 * this customer record" rule (Falle 31, 03-data-model-guardrails.md). This
 * rule has three parallel implementations that must never diverge:
 *
 * - SQL: nora_private.is_effective_contact_of_company()
 *   (supabase/schemas/02_functions.sql) — exercised by identically-named
 *   cases in supabase/tests/customer_contact_workflow_verification.sql.
 * - TS domain: isEffectiveContactOfCompany() (./customerContactContext.ts)
 *   — exercised in customerContactContext.test.ts.
 * - FakeRest: isEffectiveContactOfCompany()
 *   (providers/fakerest/internal/taskContextCheck.ts) — exercised in
 *   taskContextCheck.test.ts.
 *
 * Keep the case names identical across all three so a future divergence is
 * caught by a failing test instead of the browser (see decision log
 * "Pre-Production Hardening Patch").
 */

export type EffectiveContactContractCase = {
  name: string;
  description: string;
  contact: { id: number; company_id: number | null } | null;
  company: { id: number; self_contact_id: number | null } | null;
  expected: boolean;
};

export const effectiveContactContractCases: EffectiveContactContractCase[] = [
  {
    name: "regular_contact",
    description: "contact.company_id matches company.id",
    contact: { id: 1, company_id: 10 },
    company: { id: 10, self_contact_id: null },
    expected: true,
  },
  {
    name: "self_contact",
    description:
      "contact is the company's self_contact_id, company_id points elsewhere",
    contact: { id: 42, company_id: 1 },
    company: { id: 2, self_contact_id: 42 },
    expected: true,
  },
  {
    name: "foreign_contact",
    description: "contact belongs to neither company_id nor self_contact_id",
    contact: { id: 7, company_id: 1 },
    company: { id: 2, self_contact_id: 42 },
    expected: false,
  },
  {
    name: "foreign_primary_contact",
    description:
      "contact.is_primary=true at a DIFFERENT company must still be rejected",
    contact: { id: 7, company_id: 1 },
    company: { id: 2, self_contact_id: null },
    expected: false,
  },
  {
    name: "regular_and_self",
    description:
      "contact is both company_id member AND self_contact_id — must count once, not error",
    contact: { id: 1, company_id: 10 },
    company: { id: 10, self_contact_id: 1 },
    expected: true,
  },
  {
    name: "missing_contact",
    description: "contact does not exist",
    contact: null,
    company: { id: 10, self_contact_id: null },
    expected: false,
  },
  {
    name: "missing_company",
    description: "company does not exist",
    contact: { id: 1, company_id: 10 },
    company: null,
    expected: false,
  },
];
