import { useQuery } from "@tanstack/react-query";
import { useCanAccess, useDataProvider, type Identifier } from "ra-core";

import type { CrmDataProvider } from "../providers/types";
import { getEmployeeAccessStatus } from "../application/commands/employeeAccess";
import type { EmployeeAccessRecord } from "./employeeAccessContract";

export const EMPLOYEE_ACCESS_QUERY_KEY = ["employee-access-status"] as const;

/**
 * Reads employee access status through the named application action.
 *
 * The underlying endpoint is admin-only, so the query is gated on the caller
 * being able to edit sales — a non-admin would only collect 403s. That gate is
 * a convenience, not a security boundary: the Edge Function checks again.
 */
export function useEmployeeAccessStatus(salesId?: Identifier) {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { canAccess, isPending: canAccessPending } = useCanAccess({
    resource: "sales",
    action: "edit",
  });

  const query = useQuery<EmployeeAccessRecord[]>({
    queryKey: [...EMPLOYEE_ACCESS_QUERY_KEY, salesId ?? "all"],
    queryFn: () => getEmployeeAccessStatus(dataProvider, salesId),
    enabled: Boolean(canAccess) && !canAccessPending,
    staleTime: 30_000,
    retry: false,
  });

  return {
    ...query,
    /** Convenience lookup for list rows. */
    byEmployeeId: new Map(
      (query.data ?? []).map((record) => [String(record.employeeId), record]),
    ),
  };
}
