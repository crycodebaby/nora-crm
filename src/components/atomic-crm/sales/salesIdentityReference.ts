import type { SalesDirectory, SalesIdentity } from "../types";

/**
 * Historical employee lookup (User Lifecycle W2).
 *
 * Two questions, two read models:
 *   "Who may I assign new work to?"      -> `sales_directory` (active only),
 *                                            see SALES_DIRECTORY_REFERENCE_PROPS
 *   "Who owns / wrote this existing record?" -> `sales_identities` (all rows,
 *                                            `disabled` flag included)
 *
 * A disabled employee keeps their name on old deals, tasks and notes. History
 * is never relabelled "Unbekannt" or "Ehemalig" while the row exists.
 */
export const SALES_IDENTITIES_RESOURCE = "sales_identities" as const;

export const formatSalesIdentityName = (
  identity: Pick<SalesDirectory | SalesIdentity, "first_name" | "last_name">,
) => `${identity.first_name} ${identity.last_name}`;
