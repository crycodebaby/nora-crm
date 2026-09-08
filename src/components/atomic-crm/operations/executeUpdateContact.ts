/**
 * contact.update — the authoritative application command for saving an
 * existing contact together with its Hauptansprechpartner intent (Atomic
 * Contact Primary Intent, 2026-09-08). Same contract as executeCreateContact:
 * one Operation Manager execution, one operation UUID on the wire, one
 * atomic RPC (public.update_contact) that applies field changes, customer
 * moves and the primary transition in a single transaction.
 *
 * Updates are naturally idempotent (a retried make_primary finds the
 * contact already primary and does nothing), so no idempotency key exists
 * on this path.
 */

import {
  toRpcPrimaryIntent,
  type ContactIdentifier,
  type PrimaryContactIntent,
} from "../domain/contactPrimaryIntent";
import { OPERATION_CATALOG } from "./operationCatalog";
import {
  getDefaultOperationManager,
  type OperationManager,
} from "./operationManager";
import { NORA_OPERATION_ID_HEADER } from "./operationContext";
import { extractRpcDisposition } from "./rpcDisposition";
import type {
  ContactCommandResult,
  ContactCommandRpcFn,
} from "./executeCreateContact";

export type UpdateContactParams = {
  contactId: ContactIdentifier;
  /** Only present keys are applied; is_primary is ignored by the RPC. */
  patch: Record<string, unknown>;
  primary: PrimaryContactIntent;
};

export const executeUpdateContact = async (
  params: UpdateContactParams,
  rpc: ContactCommandRpcFn,
  manager: OperationManager = getDefaultOperationManager(),
): Promise<ContactCommandResult> =>
  manager.execute(
    OPERATION_CATALOG["contact.update"],
    { resourceId: params.contactId },
    async (context) => {
      const builder = rpc("update_contact", {
        p_contact_id: params.contactId,
        p_patch: params.patch,
        ...toRpcPrimaryIntent(params.primary),
      });
      const { data, error } = await builder.setHeader(
        NORA_OPERATION_ID_HEADER,
        context.operationId,
      );
      if (error) {
        throw error;
      }
      const { business } = extractRpcDisposition<ContactCommandResult>(data);
      context.reportOutcome({
        result: {
          contactId: business.contact_id,
          demotedContactId: business.demoted_contact_id ?? null,
        },
      });
      return business;
    },
  );
