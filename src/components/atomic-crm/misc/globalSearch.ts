import type { DataProvider, Identifier } from "ra-core";

import {
  formatCaseNumber,
  formatCustomerNumber,
} from "./numbering";
import type { Company, Contact, Deal } from "../types";

export const GLOBAL_SEARCH_RESULT_LIMIT = 5;
export const GLOBAL_SEARCH_MIN_CHARS = 2;

const CUSTOMER_NUMBER_PATTERN = /^KD-\d+$/i;
const CASE_NUMBER_PATTERN = /^VG-\d{4}-\d+$/i;

export type GlobalSearchDirectHit = {
  kind: "direct";
  resource: "companies" | "deals";
  id: Identifier;
};

export type GlobalSearchGroupedHit = {
  kind: "results";
  companies: Company[];
  contacts: Contact[];
  deals: Deal[];
};

export type GlobalSearchResponse =
  | { kind: "idle" }
  | { kind: "min_chars" }
  | { kind: "empty"; exactNumber?: boolean }
  | GlobalSearchDirectHit
  | GlobalSearchGroupedHit;

/** Strip spaces, dashes, parentheses for phone matching (no +49/0 conversion yet). */
export function normalizePhoneForSearch(value: string): string {
  return value.replace(/[\s\-()/]/g, "");
}

export function isPhoneLikeQuery(value: string): boolean {
  const normalized = normalizePhoneForSearch(value);
  return normalized.length >= 3 && /^\+?\d+$/.test(normalized);
}

export function isBusinessNumberQuery(value: string): boolean {
  const trimmed = value.trim();
  return (
    CUSTOMER_NUMBER_PATTERN.test(trimmed) || CASE_NUMBER_PATTERN.test(trimmed)
  );
}

export function canSearchQuery(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (isBusinessNumberQuery(trimmed)) return true;
  return trimmed.length >= GLOBAL_SEARCH_MIN_CHARS;
}

export function normalizeCustomerNumberQuery(raw: string): string | null {
  const trimmed = raw.trim().toUpperCase();
  const match = trimmed.match(/^KD-(\d+)$/);
  if (!match) return null;
  return formatCustomerNumber(Number.parseInt(match[1], 10));
}

export function normalizeCaseNumberQuery(raw: string): string | null {
  const trimmed = raw.trim().toUpperCase();
  const match = trimmed.match(/^VG-(\d{4})-(\d+)$/);
  if (!match) return null;
  return formatCaseNumber(
    Number.parseInt(match[1], 10),
    Number.parseInt(match[2], 10),
  );
}

export function prepareSearchTerm(raw: string): string {
  const trimmed = raw.trim();
  if (isPhoneLikeQuery(trimmed)) {
    return normalizePhoneForSearch(trimmed);
  }
  return trimmed;
}

export function getContactPrimaryEmail(contact: Contact): string | undefined {
  return contact.email_jsonb?.[0]?.email;
}

export function getContactPrimaryPhone(contact: Contact): string | undefined {
  return contact.phone_jsonb?.[0]?.number;
}

export async function performGlobalSearch(
  dataProvider: Pick<DataProvider, "getList">,
  rawQuery: string,
): Promise<GlobalSearchResponse> {
  const query = rawQuery.trim();
  if (!query) {
    return { kind: "idle" };
  }

  if (!canSearchQuery(query)) {
    return { kind: "min_chars" };
  }

  const customerNumber = normalizeCustomerNumberQuery(query);
  if (customerNumber) {
    const { data } = await dataProvider.getList<Company>("companies", {
      filter: { "customer_number@eq": customerNumber },
      pagination: { page: 1, perPage: 1 },
      sort: { field: "id", order: "ASC" },
    });
    if (data.length === 1) {
      return { kind: "direct", resource: "companies", id: data[0].id };
    }
    return { kind: "empty", exactNumber: true };
  }

  const caseNumber = normalizeCaseNumberQuery(query);
  if (caseNumber) {
    const { data } = await dataProvider.getList<Deal>("deals", {
      filter: {
        "case_number@eq": caseNumber,
        "archived_at@is": null,
      },
      pagination: { page: 1, perPage: 1 },
      sort: { field: "id", order: "ASC" },
    });
    if (data.length === 1) {
      return { kind: "direct", resource: "deals", id: data[0].id };
    }
    return { kind: "empty", exactNumber: true };
  }

  const searchTerm = prepareSearchTerm(query);

  const [companiesResult, contactsResult, dealsResult] = await Promise.all([
    dataProvider.getList<Company>("companies", {
      filter: { q: searchTerm },
      pagination: { page: 1, perPage: GLOBAL_SEARCH_RESULT_LIMIT },
      sort: { field: "name", order: "ASC" },
    }),
    dataProvider.getList<Contact>("contacts", {
      filter: { q: searchTerm },
      pagination: { page: 1, perPage: GLOBAL_SEARCH_RESULT_LIMIT },
      sort: { field: "last_name", order: "ASC" },
    }),
    dataProvider.getList<Deal>("deals", {
      filter: {
        q: searchTerm,
        "archived_at@is": null,
      },
      pagination: { page: 1, perPage: GLOBAL_SEARCH_RESULT_LIMIT },
      sort: { field: "name", order: "ASC" },
    }),
  ]);

  const companies = companiesResult.data;
  const contacts = contactsResult.data;
  const deals = dealsResult.data;

  if (!companies.length && !contacts.length && !deals.length) {
    return { kind: "empty" };
  }

  return {
    kind: "results",
    companies,
    contacts,
    deals,
  };
}
