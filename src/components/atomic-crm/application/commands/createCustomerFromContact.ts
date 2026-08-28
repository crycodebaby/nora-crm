/**
 * Application Command: CreateCustomerFromContact (Self Contact Wave,
 * 2026-08-26) — Kontakt → Kundenakte. Uses an existing contact, never asks
 * for personal data again, and never touches contacts.company_id/is_primary
 * (the contact stays Ansprechpartner wherever it already was). The new
 * customer record references the contact via self_contact_id.
 *
 * This Command is the single entry point for this use case — the React
 * dialog (ContactToCustomerDialog) contains no RPC/CRUD orchestration of
 * its own, and any future caller (API, automation) would go through the
 * same Command and therefore the same server-side rule
 * (nora_private.create_customer_with_contact_core).
 */
import type { Identifier } from "ra-core";

import type { CustomerKind } from "../../types";
import type {
  CreateCustomerFromContactParams,
  CreateCustomerFromContactResult,
} from "../../operations/executeCreateCustomerFromContact";
import type { CrmDataProvider } from "../../providers/types";
import { normalizeCrmError } from "../../misc/normalizeCrmError";
import { NORA_ERROR_CODES } from "../../domain/noraErrorCodes";

export type CreateCustomerFromContactInput = {
  contactId: Identifier;
  customerKind: CustomerKind;
  /** Firma-Felder — für customerKind="individual" wird nur "name" als Fallback genutzt, der Server leitet companies.name aus dem Kontakt ab. */
  company: Record<string, unknown> & { name?: string };
};

export type CreateCustomerFromContactOutput = {
  companyId: Identifier;
  contactId: Identifier | null;
};

/** Thrown when the contact already represents a Privatkundenakte — the UI should offer to open it instead of retrying the write. */
export class ExistingPrivateCustomerRecordError extends Error {
  constructor(public readonly companyId: Identifier) {
    super("existing_private_customer_record");
    this.name = "ExistingPrivateCustomerRecordError";
  }
}

export const createCustomerFromContact = async (
  dataProvider: CrmDataProvider,
  input: CreateCustomerFromContactInput,
): Promise<CreateCustomerFromContactOutput> => {
  if (input.customerKind === "individual") {
    const existing = await findExistingPrivateCustomerRecord(
      dataProvider,
      input.contactId,
    );
    if (existing != null) {
      throw new ExistingPrivateCustomerRecordError(existing);
    }
  }

  const company: CreateCustomerFromContactParams["company"] = {
    name: input.company.name ?? "",
    customer_kind: input.customerKind,
    ...input.company,
  };

  let result: CreateCustomerFromContactResult;
  try {
    result = await dataProvider.createCustomerFromContact({
      contactId: input.contactId,
      company,
    });
  } catch (error) {
    // TOCTOU: the pre-check above can miss a private customer record
    // created by a concurrent request between the check and this write —
    // the DB's uq_companies_self_contact_individual backstop then rejects
    // with NORA_PRIVATE_CUSTOMER_ALREADY_EXISTS. Re-resolve the now-existing
    // record so the race path reaches the exact same
    // ExistingPrivateCustomerRecordError / dialog affordance as the normal
    // pre-check path — the user must never see a difference (Error Contract
    // Wave, 2026-08-28).
    const normalized = normalizeCrmError(error);
    if (normalized.code === NORA_ERROR_CODES.PRIVATE_CUSTOMER_ALREADY_EXISTS) {
      const existing = await findExistingPrivateCustomerRecord(
        dataProvider,
        input.contactId,
      );
      if (existing != null) {
        throw new ExistingPrivateCustomerRecordError(existing);
      }
    }
    throw error;
  }

  return { companyId: result.company_id, contactId: result.contact_id };
};

/**
 * Detects a pre-existing Privatkundenakte for this person BEFORE attempting
 * the write, so the dialog can offer "bestehende Kundenakte öffnen" instead
 * of surfacing a raw uq_companies_self_contact_individual constraint error.
 */
export const findExistingPrivateCustomerRecord = async (
  dataProvider: CrmDataProvider,
  contactId: Identifier,
): Promise<Identifier | null> => {
  const { data } = await dataProvider.getList("companies", {
    filter: { customer_kind: "individual", self_contact_id: contactId },
    pagination: { page: 1, perPage: 1 },
    sort: { field: "id", order: "ASC" },
  });
  return data[0]?.id ?? null;
};
