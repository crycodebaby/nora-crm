import {
  normalizePhoneForSearch,
  type GlobalSearchGroupedHit,
} from "../misc/globalSearch";
import type { Company, Contact } from "../types";

export const QUICK_CAPTURE_SOURCE_CHANNELS = [
  "phone",
  "whatsapp",
  "email",
  "google_note",
  "google_calendar",
  "other",
] as const;

export type QuickCaptureSourceChannel =
  (typeof QUICK_CAPTURE_SOURCE_CHANNELS)[number];

export type QuickCaptureTaskOption =
  | "rueckruf"
  | "besichtigung"
  | "angebot-erstellen"
  | "";

export function normalizeCompanyName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeEmailForMatch(email: string): string {
  return email.trim().toLowerCase();
}

export function isSimilarCompanyName(a: string, b: string): boolean {
  const left = normalizeCompanyName(a);
  const right = normalizeCompanyName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return left.includes(right) || right.includes(left);
}

export function contactMatchesPhone(contact: Contact, phone: string): boolean {
  const normalized = normalizePhoneForSearch(phone);
  if (!normalized) return false;
  return (contact.phone_jsonb ?? []).some(
    (entry) =>
      entry.number && normalizePhoneForSearch(entry.number) === normalized,
  );
}

export function contactMatchesEmail(contact: Contact, email: string): boolean {
  const normalized = normalizeEmailForMatch(email);
  if (!normalized) return false;
  return (contact.email_jsonb ?? []).some(
    (entry) =>
      entry.email && normalizeEmailForMatch(entry.email) === normalized,
  );
}

export function findPossibleDuplicateCompanies(
  companies: Company[],
  criteria: {
    name?: string;
    phone?: string;
    email?: string;
  },
  contacts: Contact[] = [],
): Company[] {
  const matches = new Map<string | number, Company>();
  const name = criteria.name?.trim();

  for (const company of companies) {
    if (name && isSimilarCompanyName(company.name, name)) {
      matches.set(company.id, company);
    }
    if (
      criteria.phone &&
      company.phone_number &&
      normalizePhoneForSearch(company.phone_number) ===
        normalizePhoneForSearch(criteria.phone)
    ) {
      matches.set(company.id, company);
    }
  }

  if (criteria.email) {
    for (const contact of contacts) {
      if (!contactMatchesEmail(contact, criteria.email)) continue;
      const company = companies.find(
        (entry) => entry.id === contact.company_id,
      );
      if (company) matches.set(company.id, company);
    }
  }

  if (criteria.phone) {
    for (const contact of contacts) {
      if (!contactMatchesPhone(contact, criteria.phone)) continue;
      const company = companies.find(
        (entry) => entry.id === contact.company_id,
      );
      if (company) matches.set(company.id, company);
    }
  }

  return [...matches.values()];
}

export function collectSearchCompanies(
  result: GlobalSearchGroupedHit | undefined,
): Company[] {
  return result?.companies ?? [];
}

export function collectSearchContacts(
  result: GlobalSearchGroupedHit | undefined,
): Contact[] {
  return result?.contacts ?? [];
}

export function buildDealDescriptionWithSource(
  _sourceChannel: QuickCaptureSourceChannel,
  sourceLabel: string,
  description: string,
): string {
  const trimmed = description.trim();
  const prefix = `Quelle: ${sourceLabel}`;
  return trimmed ? `${prefix}\n\n${trimmed}` : prefix;
}

export const QUICK_CAPTURE_MAX_RESULTS = 5;
