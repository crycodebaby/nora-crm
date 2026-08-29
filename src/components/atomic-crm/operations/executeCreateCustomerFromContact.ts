/**
 * contact.convertToCustomer: Kontakt → Kundenakte (Self Contact Wave,
 * 2026-08-26). Wraps the same server-side write as
 * executeCreateCustomerWithContact — p_self_contact_id links the existing
 * contact as the representing person WITHOUT touching its
 * company_id/is_primary. Operation Manager owns the operation_id, then the
 * RPC call carries x-nora-operation-id for audit correlation.
 */

import { OPERATION_CATALOG } from "./operationCatalog";
import {
  getDefaultOperationManager,
  type OperationManager,
} from "./operationManager";
import { NORA_OPERATION_ID_HEADER } from "./operationContext";
import { extractRpcDisposition } from "./rpcDisposition";

export type CreateCustomerFromContactCompanyInput = Record<string, unknown> & {
  name: string;
};

export type CreateCustomerFromContactParams = {
  contactId: string | number;
  company: CreateCustomerFromContactCompanyInput;
  /**
   * Idempotency Wave (2026-08-29): client-owned write-intent id, stable
   * across retries of the SAME dialog submit attempt. Not the same thing as
   * operation_id. Omit for the pre-wave, non-idempotent behavior.
   */
  idempotencyKey?: string | null;
};

export type CreateCustomerFromContactResult = {
  company_id: number;
  contact_id: number | null;
};

type RpcFn = (
  fn: "create_customer_with_contact",
  args: {
    p_company: Record<string, unknown>;
    p_contact: null;
    p_existing_contact_id: null;
    p_self_contact_id: string | number;
    p_mark_self: false;
    p_idempotency_key: string | null;
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

export const executeCreateCustomerFromContact = async (
  params: CreateCustomerFromContactParams,
  rpc: RpcFn,
  manager: OperationManager = getDefaultOperationManager(),
): Promise<CreateCustomerFromContactResult> =>
  manager.execute(
    OPERATION_CATALOG["contact.convertToCustomer"],
    {},
    async (context) => {
      const builder = rpc("create_customer_with_contact", {
        p_company: params.company,
        p_contact: null,
        p_existing_contact_id: null,
        p_self_contact_id: params.contactId,
        p_mark_self: false,
        p_idempotency_key: params.idempotencyKey ?? null,
      });
      const { data, error } = await builder.setHeader(
        NORA_OPERATION_ID_HEADER,
        context.operationId,
      );
      if (error) {
        throw error;
      }
      const { business, disposition } =
        extractRpcDisposition<CreateCustomerFromContactResult>(data);
      if (disposition) {
        context.reportOutcome({
          execution: disposition,
          result: {
            companyId: business.company_id,
            contactId: business.contact_id,
          },
        });
      }
      return business;
    },
  );
