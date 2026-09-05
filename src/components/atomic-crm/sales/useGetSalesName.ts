import type { Identifier } from "ra-core";
import { useGetManyAggregate } from "ra-core";

import type { SalesIdentity } from "../types";
import {
  SALES_IDENTITIES_RESOURCE,
  formatSalesIdentityName,
} from "./salesIdentityReference";

/**
 * Resolves the display name of the employee behind an existing record
 * (owner of a deal/company/contact, author of a note, actor of an activity).
 *
 * Reads `sales_identities` on purpose (W2): the employee may have been
 * disabled since, and history must still show who it was. For choice lists
 * use `SALES_DIRECTORY_REFERENCE_PROPS` (active employees only).
 */
export const useGetSalesName = (
  id?: Identifier,
  options?: { enabled?: boolean },
) => {
  const enabled = options?.enabled ?? id != null;
  const { data, error } = useGetManyAggregate<SalesIdentity>(
    SALES_IDENTITIES_RESOURCE,
    { ids: id != null ? [id] : [] },
    { enabled },
  );

  return data && data[0] ? formatSalesIdentityName(data[0]) : error ? "??" : "";
};
