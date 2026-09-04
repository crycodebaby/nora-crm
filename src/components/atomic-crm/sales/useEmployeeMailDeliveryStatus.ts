import { useQuery } from "@tanstack/react-query";
import { useCanAccess, useDataProvider, type Identifier } from "ra-core";

import type { CrmDataProvider } from "../providers/types";
import {
  summariseEmployeeMailDelivery,
  type EmployeeMailDeliverySummary,
} from "./emailDeliveryContract";

export const EMPLOYEE_MAIL_DELIVERY_QUERY_KEY = [
  "employee-mail-delivery-status",
] as const;

/**
 * Reads the admin-only delivery read model for one employee.
 *
 * Gated on the caller being able to edit sales for the same reason as
 * `useEmployeeAccessStatus`: a non-admin would only collect 403s. The gate is
 * a convenience — `employee_email_delivery_status()` raises `forbidden` for
 * anyone who is not an administrator, and that is the actual boundary.
 *
 * Delivery status is secondary operational information, so a failure is not
 * surfaced as an error: the caller simply renders nothing. A missing line is
 * honest; a broken one next to the access state is not.
 */
export function useEmployeeMailDeliveryStatus(salesId?: Identifier): {
  summary: EmployeeMailDeliverySummary | null;
  isPending: boolean;
} {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { canAccess, isPending: canAccessPending } = useCanAccess({
    resource: "sales",
    action: "edit",
  });

  const enabled = Boolean(canAccess) && !canAccessPending && salesId != null;

  const { data, isPending, isError } = useQuery({
    queryKey: [...EMPLOYEE_MAIL_DELIVERY_QUERY_KEY, salesId ?? "all"],
    queryFn: () => dataProvider.getEmployeeMailDeliveryStatus(salesId),
    enabled,
    staleTime: 30_000,
    retry: false,
  });

  return {
    summary: isError || !data ? null : summariseEmployeeMailDelivery(data),
    isPending: enabled && isPending,
  };
}
