/**
 * contact.create — the authoritative application command for creating a
 * contact together with its Hauptansprechpartner intent (Atomic Contact
 * Primary Intent, 2026-09-08).
 *
 * ONE Operation Manager execution owns ONE operation UUID; that UUID travels
 * as x-nora-operation-id so every audit row the transaction produces
 * (previous holder demoted, new contact created) carries the same
 * request_id. Server side: public.create_contact — SECURITY DEFINER,
 * can_write()-gated, customer row lock, observed-holder verification,
 * idempotent under the client-owned idempotency key.
 *
 * Framework-free: React components orchestrate the form, the data provider
 * calls this, and tests drive it with a fake `rpc`.
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

export type CreateContactParams = {
  /** Allowlisted contact fields (the RPC ignores anything else, incl. is_primary). */
  contact: Record<string, unknown>;
  primary: PrimaryContactIntent;
  /** Stable per form session; distinct from the per-attempt operation id. */
  idempotencyKey?: string | null;
};

export type ContactCommandResult = {
  contact_id: number;
  /** The committed row (final state) — what the form/redirect works with. */
  contact: Record<string, unknown> & { id: number };
  demoted_contact_id: number | null;
};

export type ContactCommandRpcArgs = {
  create_contact: {
    p_contact: Record<string, unknown>;
    p_primary_intent: PrimaryContactIntent["kind"];
    p_expected_primary_contact_id: ContactIdentifier | null;
    p_idempotency_key: string | null;
  };
  update_contact: {
    p_contact_id: ContactIdentifier;
    p_patch: Record<string, unknown>;
    p_primary_intent: PrimaryContactIntent["kind"];
    p_expected_primary_contact_id: ContactIdentifier | null;
  };
};

export type ContactCommandRpcFn = <K extends keyof ContactCommandRpcArgs>(
  fn: K,
  args: ContactCommandRpcArgs[K],
) => {
  setHeader: (
    name: string,
    value: string,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

export const executeCreateContact = async (
  params: CreateContactParams,
  rpc: ContactCommandRpcFn,
  manager: OperationManager = getDefaultOperationManager(),
): Promise<ContactCommandResult> =>
  manager.execute(OPERATION_CATALOG["contact.create"], {}, async (context) => {
    const builder = rpc("create_contact", {
      p_contact: params.contact,
      ...toRpcPrimaryIntent(params.primary),
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
      extractRpcDisposition<ContactCommandResult>(data);
    if (disposition) {
      context.reportOutcome({
        execution: disposition,
        result: {
          contactId: business.contact_id,
          demotedContactId: business.demoted_contact_id ?? null,
        },
      });
    }
    return business;
  });
