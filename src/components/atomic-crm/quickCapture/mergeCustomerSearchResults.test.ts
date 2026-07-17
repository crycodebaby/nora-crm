/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import type { Company } from "../types";
import { mergeCustomerSearchResults } from "./mergeCustomerSearchResults";
import type { DuplicateCandidate } from "./duplicateCandidateUtils";

const company = (id: number, name: string): Company =>
  ({ id, name, customer_number: `KD-00000${id}` }) as Company;

describe("mergeCustomerSearchResults", () => {
  it("deduplicates company appearing in search and duplicate list", () => {
    const searchCompanies = [company(1, "Peter GmbH"), company(2, "Other AG")];
    const duplicateCandidates: DuplicateCandidate[] = [
      {
        company: company(1, "Peter GmbH"),
        score: 50,
        reasons: ["similar_name"],
      },
    ];

    const merged = mergeCustomerSearchResults(
      searchCompanies,
      duplicateCandidates,
    );

    expect(merged).toHaveLength(2);
    expect(merged[0]?.company.id).toBe(1);
    expect(merged[0]?.reasons).toContain("similar_name");
    expect(merged.filter((e) => e.company.id === 1)).toHaveLength(1);
  });

  it("limits to five entries", () => {
    const searchCompanies = Array.from({ length: 8 }, (_, i) =>
      company(i + 1, `Firma ${i}`),
    );
    const merged = mergeCustomerSearchResults(searchCompanies, []);
    expect(merged.length).toBe(5);
  });

  it("prefers scored candidate over plain search hit", () => {
    const c = company(1, "Becker");
    const duplicateCandidates: DuplicateCandidate[] = [
      {
        company: c,
        score: 90,
        reasons: ["same_phone"],
        displayPhone: "+49 211 000",
      },
    ];
    const merged = mergeCustomerSearchResults([c], duplicateCandidates);
    expect(merged[0]?.score).toBe(90);
    expect(merged[0]?.reasons).toContain("same_phone");
  });
});
