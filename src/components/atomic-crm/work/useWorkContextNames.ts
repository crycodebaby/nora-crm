/**
 * Display-name enrichment for Work context (docs/nora/26 §7).
 *
 * Context IDENTITY is Work authority: whether a row has a customer or a
 * contact is decided by the DTO alone. This hook only resolves display names
 * for IDs the Work rows already carry — batched per resource through the
 * existing, authorized provider reads (`useGetManyAggregate`), with minimal
 * columns. A failed lookup never removes, changes or reorders Work and never
 * becomes a Work failure; it never infers another context.
 */
import { useMemo } from "react";
import { useGetManyAggregate, type Identifier } from "ra-core";

import type { WorkItem } from "../application/queries/getWorkItems";

/** Minimal columns; part of the cache key, so partial rows never reach the record caches. */
const COMPANY_META = { columns: ["id", "name"] } as const;
const CONTACT_META = { columns: ["id", "first_name", "last_name"] } as const;

type CompanyName = { id: Identifier; name?: string | null };
type ContactName = {
  id: Identifier;
  first_name?: string | null;
  last_name?: string | null;
};

export type ContextName =
  | { kind: "pending" }
  | { kind: "named"; name: string }
  | { kind: "empty" }
  | { kind: "missing" }
  | { kind: "failed" };

/** IDs to look up: `id != null` — `0` is a valid ID, `null` asks for nothing. */
const collectIds = (
  items: readonly WorkItem[] | undefined,
  pick: (item: WorkItem) => number | null,
): number[] => {
  const ids = new Set<number>();
  for (const item of items ?? []) {
    const id = pick(item);
    if (id != null) ids.add(id);
  }
  return [...ids];
};

const collapse = (value: string) => value.trim().replace(/\s+/g, " ");

export const companyDisplayName = (record: CompanyName): string =>
  collapse(record.name ?? "");

export const contactDisplayName = (record: ContactName): string =>
  collapse(`${record.first_name ?? ""} ${record.last_name ?? ""}`);

const lookup = <T extends { id: Identifier }>(
  id: number,
  result: {
    data?: T[];
    error: unknown;
    isPlaceholderData?: boolean;
    isPending: boolean;
  },
  toName: (record: T) => string,
): ContextName => {
  // Matched by ID only — never by position or name.
  const record = result.data?.find(
    (candidate) => candidate != null && String(candidate.id) === String(id),
  );
  if (record) {
    const name = toName(record);
    return name === "" ? { kind: "empty" } : { kind: "named", name };
  }
  if (result.error != null) return { kind: "failed" };
  if (result.isPending || result.isPlaceholderData || !result.data) {
    return { kind: "pending" };
  }
  return { kind: "missing" };
};

export type WorkContextNames = {
  customerName: (id: number) => ContextName;
  contactName: (id: number) => ContextName;
  /** At least one lookup failed; the surface shows one calm hint. */
  failed: boolean;
  /** Last failure instant (for "once per failure" announcements). */
  failedAt: number;
  /** Re-runs only the failed lookups — never the Work query. */
  retry: () => Promise<unknown>;
};

export const useWorkContextNames = (
  items: readonly WorkItem[] | undefined,
): WorkContextNames => {
  const customerIds = useMemo(
    () => collectIds(items, (item) => item.context.customerId),
    [items],
  );
  const contactIds = useMemo(
    () => collectIds(items, (item) => item.context.contactId),
    [items],
  );

  // Keep showing already resolved names while a grown ID set (next page)
  // loads; IDs not in the previous answer read as pending, not missing.
  const keepPrevious = <T>(previous: T | undefined) => previous;

  const companies = useGetManyAggregate<CompanyName>(
    "companies",
    { ids: customerIds, meta: COMPANY_META },
    {
      enabled: customerIds.length > 0,
      retry: false,
      placeholderData: keepPrevious,
    },
  );
  const contacts = useGetManyAggregate<ContactName>(
    "contacts",
    { ids: contactIds, meta: CONTACT_META },
    {
      enabled: contactIds.length > 0,
      retry: false,
      placeholderData: keepPrevious,
    },
  );

  const companiesFailed = customerIds.length > 0 && companies.error != null;
  const contactsFailed = contactIds.length > 0 && contacts.error != null;
  const { refetch: refetchCompanies } = companies;
  const { refetch: refetchContacts } = contacts;

  return {
    customerName: (id) => lookup(id, companies, companyDisplayName),
    contactName: (id) => lookup(id, contacts, contactDisplayName),
    failed: companiesFailed || contactsFailed,
    failedAt: Math.max(
      companiesFailed ? companies.errorUpdatedAt : 0,
      contactsFailed ? contacts.errorUpdatedAt : 0,
    ),
    retry: () =>
      Promise.all([
        companiesFailed ? refetchCompanies() : undefined,
        contactsFailed ? refetchContacts() : undefined,
      ]),
  };
};
