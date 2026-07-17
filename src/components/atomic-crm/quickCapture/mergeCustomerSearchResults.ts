import {
  DUPLICATE_MAX_CANDIDATES,
  formatCompanyLocation,
  type DuplicateCandidate,
  type DuplicateMatchReason,
} from "./duplicateCandidateUtils";
import type { Company } from "../types";

export type CustomerListEntry = {
  company: Company;
  score: number;
  reasons: DuplicateMatchReason[];
  displayPhone?: string;
  displayEmail?: string;
  displayLocation?: string;
};

/**
 * Merges global-search companies with scored duplicate candidates.
 * Each company appears at most once; scored entries win over plain search hits.
 */
export function mergeCustomerSearchResults(
  searchCompanies: Company[],
  duplicateCandidates: DuplicateCandidate[],
  max = DUPLICATE_MAX_CANDIDATES,
): CustomerListEntry[] {
  const byId = new Map<string | number, CustomerListEntry>();

  for (const candidate of duplicateCandidates) {
    byId.set(candidate.company.id, { ...candidate });
  }

  for (const company of searchCompanies) {
    if (byId.has(company.id)) continue;
    byId.set(company.id, {
      company,
      score: 0,
      reasons: [],
      displayPhone: company.phone_number || undefined,
      displayLocation: formatCompanyLocation(company),
    });
  }

  return [...byId.values()]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.company.name.localeCompare(b.company.name, "de");
    })
    .slice(0, max);
}
