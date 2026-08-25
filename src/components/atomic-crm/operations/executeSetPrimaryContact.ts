/**
 * contact.setPrimary entry: Operation Manager owns the operation_id, then the
 * RPC call carries x-nora-operation-id for audit correlation.
 * Server side: public.set_primary_contact (atomic single-primary switch,
 * SECURITY DEFINER, can_write()-gated).
 */

import { OPERATION_CATALOG } from "./operationCatalog";
import {
  getDefaultOperationManager,
  type OperationManager,
} from "./operationManager";
import { NORA_OPERATION_ID_HEADER } from "./operationContext";

type RpcFn = (
  fn: "set_primary_contact",
  args: { p_contact_id: string | number },
) => {
  setHeader: (
    name: string,
    value: string,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

export const executeSetPrimaryContact = async (
  contactId: string | number,
  rpc: RpcFn,
  manager: OperationManager = getDefaultOperationManager(),
): Promise<void> => {
  await manager.execute(
    OPERATION_CATALOG["contact.setPrimary"],
    { resourceId: contactId },
    async (context) => {
      const builder = rpc("set_primary_contact", {
        p_contact_id: contactId,
      });
      const { error } = await builder.setHeader(
        NORA_OPERATION_ID_HEADER,
        context.operationId,
      );
      if (error) {
        throw error;
      }
    },
  );
};
