import {
  canSearchQuery,
  getContactPrimaryEmail,
  getContactPrimaryPhone,
  isPhoneLikeQuery,
  normalizeCustomerNumberQuery,
  normalizePhoneForSearch,
} from "../misc/globalSearch";
import type { Company, Contact } from "../types";
import {
  contactMatchesEmail,
  contactMatchesPhone,
  isSimilarCompanyName,
  normalizeCompanyName,
} from "./quickCaptureUtils";

export const DUPLICATE_MIN_NAME_LENGTH = 3;
export const DUPLICATE_MIN_SCORE = 50;
export const DUPLICATE_MAX_CANDIDATES = 5;
export const DUPLICATE_SEARCH_DEBOUNCE_MS = 400;

export type DuplicateMatchReason =
  | "customer_number"
  | "same_phone"
  | "same_email"
  | "similar_name"
  | "same_city";

export const DUPLICATE_REASON_SCORE: Record<DuplicateMatchReason, number> = {
  customer_number: 100,
  same_phone: 90,
  same_email: 90,
  similar_name: 50,
  same_city: 20,
};

/** Input for duplicate detection — reusable by Lexware/CSV import later. */
export type DuplicateSearchInput = {
  query?: string;
  name?: string;
  phone?: string;
  email?: string;
  city?: string;
  zipcode?: string;
};

export type DuplicateCandidate = {
  company: Company;
  score: number;
  reasons: DuplicateMatchReason[];
  displayPhone?: string;
  displayEmail?: string;
  displayLocation?: string;
};

export function normalizeCity(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeCustomerNumberForMatch(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return normalizeCustomerNumberQuery(trimmed) ?? trimmed.toUpperCase();
}

export function isValidEmailForDuplicateSearch(email: string): boolean {
  const trimmed = email.trim();
  return trimmed.includes("@") && trimmed.length >= 5;
}

export function shouldRunDuplicateSearch(input: DuplicateSearchInput): boolean {
  const query = input.query?.trim() ?? "";
  const name = input.name?.trim() ?? "";

  if (query && canSearchQuery(query)) return true;
  if (name.length >= DUPLICATE_MIN_NAME_LENGTH) return true;
  if (input.phone && isPhoneLikeQuery(input.phone)) return true;
  if (input.email && isValidEmailForDuplicateSearch(input.email)) return true;

  return false;
}

export function buildDuplicateSearchCacheKey(
  input: DuplicateSearchInput,
): string {
  return JSON.stringify({
    query: input.query?.trim() ?? "",
    name: input.name?.trim() ?? "",
    phone: input.phone ? normalizePhoneForSearch(input.phone) : "",
    email: input.email?.trim().toLowerCase() ?? "",
    city: input.city?.trim().toLowerCase() ?? "",
    zipcode: input.zipcode?.trim() ?? "",
  });
}

export function formatCompanyLocation(company: Company): string | undefined {
  const parts = [company.zipcode, company.city].filter(Boolean);
  return parts.length ? parts.join(" ") : undefined;
}

export function scoreCompanyAsDuplicate(
  company: Company,
  input: DuplicateSearchInput,
  contacts: Contact[],
): DuplicateCandidate | null {
  const reasons: DuplicateMatchReason[] = [];
  let score = 0;

  const inputName = (input.name || input.query || "").trim();
  const inputPhone = input.phone?.trim();
  const inputEmail = input.email?.trim();
  const customerNumberQuery = normalizeCustomerNumberForMatch(
    input.query || input.name || "",
  );

  if (
    customerNumberQuery &&
    company.customer_number &&
    normalizeCustomerNumberForMatch(company.customer_number) ===
      customerNumberQuery
  ) {
    reasons.push("customer_number");
    score += DUPLICATE_REASON_SCORE.customer_number;
  }

  if (
    inputPhone &&
    company.phone_number &&
    normalizePhoneForSearch(company.phone_number) ===
      normalizePhoneForSearch(inputPhone)
  ) {
    reasons.push("same_phone");
    score += DUPLICATE_REASON_SCORE.same_phone;
  }

  const companyContacts = contacts.filter(
    (contact) => contact.company_id === company.id,
  );

  for (const contact of companyContacts) {
    if (inputPhone && contactMatchesPhone(contact, inputPhone)) {
      if (!reasons.includes("same_phone")) {
        reasons.push("same_phone");
        score += DUPLICATE_REASON_SCORE.same_phone;
      }
    }
    if (inputEmail && contactMatchesEmail(contact, inputEmail)) {
      if (!reasons.includes("same_email")) {
        reasons.push("same_email");
        score += DUPLICATE_REASON_SCORE.same_email;
      }
    }
  }

  const hasSimilarName =
    inputName.length >= DUPLICATE_MIN_NAME_LENGTH &&
    isSimilarCompanyName(company.name, inputName);

  if (hasSimilarName) {
    reasons.push("similar_name");
    score += DUPLICATE_REASON_SCORE.similar_name;
  }

  const inputCity = input.city?.trim();
  const inputZip = input.zipcode?.trim();
  const cityMatch =
    hasSimilarName &&
    inputCity &&
    company.city &&
    normalizeCity(inputCity) === normalizeCity(company.city);
  const zipMatch =
    hasSimilarName &&
    inputZip &&
    company.zipcode &&
    inputZip === company.zipcode.trim();

  if (cityMatch || zipMatch) {
    reasons.push("same_city");
    score += DUPLICATE_REASON_SCORE.same_city;
  }

  if (reasons.length === 0 || score < DUPLICATE_MIN_SCORE) {
    return null;
  }

  const primaryContact = companyContacts[0];

  return {
    company,
    score,
    reasons,
    displayPhone:
      company.phone_number ||
      getContactPrimaryPhone(primaryContact ?? ({} as Contact)),
    displayEmail: getContactPrimaryEmail(primaryContact ?? ({} as Contact)),
    displayLocation: formatCompanyLocation(company),
  };
}

export function rankDuplicateCandidates(
  companies: Company[],
  input: DuplicateSearchInput,
  contacts: Contact[] = [],
): DuplicateCandidate[] {
  const byId = new Map<string | number, DuplicateCandidate>();

  for (const company of companies) {
    const candidate = scoreCompanyAsDuplicate(company, input, contacts);
    if (!candidate) continue;

    const existing = byId.get(company.id);
    if (!existing || candidate.score > existing.score) {
      byId.set(company.id, candidate);
    }
  }

  return [...byId.values()]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return normalizeCompanyName(a.company.name).localeCompare(
        normalizeCompanyName(b.company.name),
      );
    })
    .slice(0, DUPLICATE_MAX_CANDIDATES);
}

export function buildDuplicateSearchInput(params: {
  searchQuery?: string;
  newCompanyName?: string;
  createNewCompany?: boolean;
  contactPhone?: string;
  contactEmail?: string;
  city?: string;
  zipcode?: string;
}): DuplicateSearchInput {
  const searchQuery = params.searchQuery?.trim() ?? "";
  const newCompanyName = params.newCompanyName?.trim() ?? "";

  return {
    query: searchQuery,
    name: params.createNewCompany
      ? newCompanyName
      : searchQuery || newCompanyName,
    phone: params.contactPhone?.trim() || undefined,
    email: params.contactEmail?.trim() || undefined,
    city: params.city,
    zipcode: params.zipcode,
  };
}
