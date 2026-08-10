/**
 * deal.update entry: Operation Manager owns the operation_id, then Wave 1
 * transport attaches x-nora-operation-id for audit correlation.
 */

import { OPERATION_CATALOG } from "./operationCatalog";
import {
  getDefaultOperationManager,
  type OperationManager,
} from "./operationManager";
import { withOperationIdParams } from "./operationTransport";

type DealUpdateParams = {
  id: string | number;
  data: Record<string, unknown>;
  previousData: Record<string, unknown>;
  meta?: {
    headers?: Record<string, string>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type UpdateFn = (
  resource: string,
  params: DealUpdateParams,
) => Promise<{ data: unknown }>;

/**
 * Execute a deals update as a managed deal.update operation.
 * Nested calls that already carry a valid operation header still go through
 * the manager only at the outermost entry (this helper is that entry).
 */
export const executeDealUpdate = async <TResult extends { data: unknown }>(
  params: DealUpdateParams,
  update: UpdateFn,
  manager: OperationManager = getDefaultOperationManager(),
): Promise<TResult> =>
  manager.execute(
    OPERATION_CATALOG["deal.update"],
    { resourceId: params.id },
    async (context) =>
      update(
        "deals",
        withOperationIdParams(params, context) as DealUpdateParams,
      ) as Promise<TResult>,
  );
