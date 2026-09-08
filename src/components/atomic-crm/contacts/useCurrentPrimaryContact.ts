/**
 * Resolves the current Hauptansprechpartner of one customer with the
 * smallest existing read model (contacts list filtered by customer + flag,
 * one row). No global contact load, no new cache layer. React Query keys the
 * request by customer, so a late response for a previously selected customer
 * never overwrites the currently selected one (Atomic Contact Primary
 * Intent, 2026-09-08).
 */
import { useGetList } from "ra-core";

import type { Contact } from "../types";

const isBlankId = (value: unknown) =>
  value === undefined || value === null || value === "";

const sameId = (a: unknown, b: unknown) =>
  !isBlankId(a) && !isBlankId(b) && String(a) === String(b);

export const useCurrentPrimaryContact = (
  companyId: unknown,
): { holder: Contact | null; isLoading: boolean; resolvedFor: unknown } => {
  const enabled = !isBlankId(companyId);
  const { data, isPending } = useGetList<Contact>(
    "contacts",
    {
      filter: { company_id: companyId, is_primary: true },
      pagination: { page: 1, perPage: 1 },
      sort: { field: "id", order: "ASC" },
    },
    { enabled },
  );
  if (!enabled) {
    return { holder: null, isLoading: false, resolvedFor: null };
  }
  const holder =
    data?.find(
      (contact) =>
        contact.is_primary === true && sameId(contact.company_id, companyId),
    ) ?? null;
  return { holder, isLoading: isPending, resolvedFor: companyId };
};
