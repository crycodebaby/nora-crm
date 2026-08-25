/**
 * customer.createWithContact entry: Operation Manager owns the operation_id,
 * then the RPC call carries x-nora-operation-id for audit correlation.
 * Server side: public.create_customer_with_contact (atomic company + optional
 * contact insert, SECURITY DEFINER, can_write()-gated).
 */

import { OPERATION_CATALOG } from "./operationCatalog";
import {
  getDefaultOperationManager,
  type OperationManager,
} from "./operationManager";
import { NORA_OPERATION_ID_HEADER } from "./operationContext";

export type CreateCustomerWithContactCompanyInput = Record<string, unknown> & {
  name: string;
};

export type CreateCustomerWithContactContactInput = Record<string, unknown>;

export type CreateCustomerWithContactParams = {
  company: CreateCustomerWithContactCompanyInput;
  contact?: CreateCustomerWithContactContactInput | null;
  existingContactId?: string | number | null;
};

export type CreateCustomerWithContactResult = {
  company_id: number;
  contact_id: number | null;
};

type RpcFn = (
  fn: "create_customer_with_contact",
  args: {
    p_company: Record<string, unknown>;
    p_contact: Record<string, unknown> | null;
    p_existing_contact_id: string | number | null;
  },
) => {
  setHeader: (
    name: string,
    value: string,
  ) => PromiseLike<{
    data: unknown;
    error: unknown;
  }>;
};

export const executeCreateCustomerWithContact = async (
  params: CreateCustomerWithContactParams,
  rpc: RpcFn,
  manager: OperationManager = getDefaultOperationManager(),
): Promise<CreateCustomerWithContactResult> =>
  manager.execute(
    OPERATION_CATALOG["customer.createWithContact"],
    {},
    async (context) => {
      const builder = rpc("create_customer_with_contact", {
        p_company: params.company,
        p_contact: params.contact ?? null,
        p_existing_contact_id: params.existingContactId ?? null,
      });
      const { data, error } = await builder.setHeader(
        NORA_OPERATION_ID_HEADER,
        context.operationId,
      );
      if (error) {
        throw error;
      }
      return data as CreateCustomerWithContactResult;
    },
  );
