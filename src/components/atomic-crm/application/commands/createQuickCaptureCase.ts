/**
 * Application Command: CreateQuickCaptureCase (Self Contact Wave,
 * 2026-08-26) — replaces the previous sequential-CRUD submitQuickCapture.ts.
 *
 * "Eine Schnellerfassung als konsistenten Geschäftsvorgang abschließen":
 * Kunde + Kontakt + Vorgang are one atomic server-side write
 * (dataProvider.createQuickCaptureCase → public.create_quick_capture_case).
 * The UI collects a serializable form snapshot and calls only this Command —
 * no dataProvider.create/update calls for company/contact/deal live in the
 * dialog component itself.
 *
 * Aufgabe (task) stays a deliberate, separate best-effort step AFTER the
 * case write succeeds — a failed task must not roll back an otherwise
 * successful Kunde+Kontakt+Vorgang, and this is existing, already-tested UX
 * (taskFailed partial-success notice).
 */
import type { Identifier } from "ra-core";

import { cleanupContactForCreate } from "../../contacts/contactModel";
import type { Contact } from "../../types";
import {
  buildDealDescriptionWithSource,
  type QuickCaptureSourceChannel,
  type QuickCaptureTaskOption,
} from "../../quickCapture/quickCaptureUtils";
import type { CrmDataProvider } from "../../providers/types";
import { normalizeCrmError } from "../../misc/normalizeCrmError";
import {
  NORA_ERROR_CODES,
  type NoraErrorCode,
} from "../../domain/noraErrorCodes";

export type QuickCaptureCustomerSelection =
  | { mode: "existing"; companyId: Identifier }
  | { mode: "new"; name: string };

export type QuickCaptureContactSelection =
  | { mode: "existing"; contactId: Identifier }
  | {
      mode: "new";
      contact: {
        first_name: string;
        last_name: string;
        phone: string;
        email: string;
      };
      markPrimary: boolean;
    }
  | { mode: "none" };

export type CreateQuickCaptureCaseInput = {
  customer: QuickCaptureCustomerSelection;
  contact: QuickCaptureContactSelection;
  dealTitle: string;
  dealCategory: string;
  dealDescription: string;
  sourceChannel: QuickCaptureSourceChannel;
  sourceLabel: string;
  followUpDate: string;
  taskType: QuickCaptureTaskOption;
  salesId: Identifier;
  /**
   * Idempotency Wave (2026-08-29): client-owned write-intent id for this
   * Quick Capture submit attempt — same key reused across retries of the
   * SAME intent (minted/persisted by the caller, e.g. the Quick Capture
   * draft). Used for BOTH the Core RPC call (company+contact+deal) and the
   * separate Task RPC call, each checked under its own server-side scope.
   * Omit to keep the pre-wave, non-idempotent behavior.
   */
  idempotencyKey?: string | null;
};

export type CreateQuickCaptureCaseOutput = {
  dealId: Identifier;
  companyId: Identifier;
  contactId: Identifier | null;
  taskId?: Identifier | null;
  taskFailed?: boolean;
};

export class QuickCaptureSubmitError extends Error {
  constructor(
    message: string,
    public readonly stage: "case" | "task",
    /** Recognized stable Nora business code, if any (Error Contract Wave) — `.message` stays the i18n key suffix consumed by QuickCaptureDialog. */
    public readonly code: NoraErrorCode | null = null,
  ) {
    super(message);
    this.name = "QuickCaptureSubmitError";
  }
}

export const createQuickCaptureCase = async (
  dataProvider: CrmDataProvider,
  input: CreateQuickCaptureCaseInput,
): Promise<CreateQuickCaptureCaseOutput> => {
  const description = buildDealDescriptionWithSource(
    input.sourceChannel,
    input.sourceLabel,
    input.dealDescription,
  );

  let result: {
    company_id: Identifier;
    contact_id: Identifier | null;
    deal_id: Identifier;
  };

  try {
    result = await dataProvider.createQuickCaptureCase({
      company:
        input.customer.mode === "new"
          ? { name: input.customer.name, sales_id: input.salesId }
          : null,
      existingCompanyId:
        input.customer.mode === "existing" ? input.customer.companyId : null,
      contact:
        input.contact.mode === "new"
          ? buildQuickCaptureContactPayload(input.contact)
          : null,
      existingContactId:
        input.contact.mode === "existing" ? input.contact.contactId : null,
      selfContactId: null,
      contactIsPrimary:
        input.contact.mode === "new" ? input.contact.markPrimary : undefined,
      deal: {
        name: input.dealTitle.trim(),
        category: input.dealCategory,
        stage: "neue-anfrage",
        description,
        amount: 0,
        expected_closing_date: input.followUpDate,
        sales_id: input.salesId,
      },
      idempotencyKey: input.idempotencyKey ?? null,
    });
  } catch (error) {
    // Never build the i18n key from raw exception text (Error Contract,
    // Pre-Production Hardening Patch) — normalize to a stable, finite code.
    // "not_authenticated" is preserved as-is for backward compatibility with
    // the pre-existing client-side auth guard above.
    const normalized = normalizeCrmError(error);
    const messageSuffix =
      normalized.code === NORA_ERROR_CODES.CONTACT_NOT_IN_CUSTOMER_CONTEXT
        ? "contact_not_in_customer_context"
        : normalized.code === NORA_ERROR_CODES.PERMISSION_DENIED
          ? "permission_denied"
          : normalized.code === NORA_ERROR_CODES.IDEMPOTENCY_CONFLICT
            ? "idempotency_conflict"
            : "case_create_failed";
    throw new QuickCaptureSubmitError(
      messageSuffix,
      "case",
      normalized.code ?? null,
    );
  }

  const output: CreateQuickCaptureCaseOutput = {
    dealId: result.deal_id,
    companyId: result.company_id,
    contactId: result.contact_id,
    taskFailed: false,
  };

  if (input.taskType) {
    const taskLabel =
      input.taskType === "rueckruf"
        ? "Rückruf"
        : input.taskType === "besichtigung"
          ? "Besichtigung"
          : "Angebot erstellen";
    try {
      const taskResult = await dataProvider.createQuickCaptureTask({
        companyId: result.company_id,
        contactId: result.contact_id ?? null,
        type: input.taskType,
        text: taskLabel,
        dueDate: input.followUpDate,
        salesId: input.salesId,
        idempotencyKey: input.idempotencyKey ?? null,
      });
      output.taskId = taskResult.task_id;
    } catch (error) {
      // NORA_IDEMPOTENCY_CONFLICT means this idempotency_key was already
      // used to create a DIFFERENT task — a corrupted/misused retry, not an
      // ordinary best-effort task failure. Never swallow it into
      // taskFailed:true (that would silently hide the conflict); propagate
      // as a hard error so the caller sees it (Idempotency Wave, 2026-08-29).
      const normalized = normalizeCrmError(error);
      if (normalized.code === NORA_ERROR_CODES.IDEMPOTENCY_CONFLICT) {
        throw new QuickCaptureSubmitError(
          "task_idempotency_conflict",
          "task",
          normalized.code,
        );
      }
      output.taskFailed = true;
    }
  }

  return output;
};

const buildQuickCaptureContactPayload = (
  contact: Extract<QuickCaptureContactSelection, { mode: "new" }>,
) => {
  const email = contact.contact.email.trim();
  const phone = contact.contact.phone.trim();
  return cleanupContactForCreate({
    first_name: contact.contact.first_name.trim(),
    last_name: contact.contact.last_name.trim(),
    title: "",
    gender: "",
    status: "",
    background: "",
    has_newsletter: false,
    tags: [],
    email_jsonb: email ? [{ email, type: "Work" }] : [],
    phone_jsonb: phone ? [{ number: phone, type: "Work" }] : [],
    first_seen: new Date().toISOString(),
    last_seen: new Date().toISOString(),
  } as unknown as Contact) as unknown as Record<string, unknown>;
};
