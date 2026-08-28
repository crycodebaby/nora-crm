/**
 * quickCapture.createCase: Quick Capture Application Command backing RPC.
 * Kunde + Kontakt + Vorgang atomically in one transaction
 * (public.create_quick_capture_case). Task creation stays a separate,
 * best-effort follow-up step handled by the calling command — not part of
 * this RPC. Operation Manager owns the operation_id, then the RPC call
 * carries x-nora-operation-id for audit correlation.
 */

import { OPERATION_CATALOG } from "./operationCatalog";
import {
  getDefaultOperationManager,
  type OperationManager,
} from "./operationManager";
import { NORA_OPERATION_ID_HEADER } from "./operationContext";

export type CreateQuickCaptureCaseCompanyInput = Record<string, unknown> & {
  name: string;
};

export type CreateQuickCaptureCaseContactInput = Record<string, unknown>;

export type CreateQuickCaptureCaseDealInput = Record<string, unknown> & {
  name: string;
};

export type CreateQuickCaptureCaseParams = {
  company?: CreateQuickCaptureCaseCompanyInput | null;
  existingCompanyId?: string | number | null;
  contact?: CreateQuickCaptureCaseContactInput | null;
  existingContactId?: string | number | null;
  selfContactId?: string | number | null;
  /** Only relevant for a brand-new contact (`contact`) added to an EXISTING company — whether it becomes the new Hauptansprechpartner (demoting any previous one). Defaults to true server-side. */
  contactIsPrimary?: boolean;
  deal: CreateQuickCaptureCaseDealInput;
  /**
   * Idempotency Wave (2026-08-29): client-owned write-intent id, stable
   * across retries of the SAME Quick Capture submit attempt (minted once,
   * persisted in the draft — see quickCaptureDraft.ts). Covers exactly the
   * Core scope (company+contact+deal); NOT the same thing as operation_id
   * (a fresh technical correlation id per attempt, owned by OperationManager
   * below). Omit for the pre-wave, non-idempotent behavior.
   */
  idempotencyKey?: string | null;
};

export type CreateQuickCaptureCaseResult = {
  company_id: number;
  contact_id: number | null;
  deal_id: number;
};

type RpcFn = (
  fn: "create_quick_capture_case",
  args: {
    p_company: Record<string, unknown> | null;
    p_existing_company_id: string | number | null;
    p_contact: Record<string, unknown> | null;
    p_existing_contact_id: string | number | null;
    p_self_contact_id: string | number | null;
    p_deal: Record<string, unknown>;
    p_contact_is_primary: boolean;
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

export const executeCreateQuickCaptureCase = async (
  params: CreateQuickCaptureCaseParams,
  rpc: RpcFn,
  manager: OperationManager = getDefaultOperationManager(),
): Promise<CreateQuickCaptureCaseResult> =>
  manager.execute(
    OPERATION_CATALOG["quickCapture.createCase"],
    {},
    async (context) => {
      const builder = rpc("create_quick_capture_case", {
        p_company: params.company ?? null,
        p_existing_company_id: params.existingCompanyId ?? null,
        p_contact: params.contact ?? null,
        p_existing_contact_id: params.existingContactId ?? null,
        p_self_contact_id: params.selfContactId ?? null,
        p_deal: params.deal,
        p_contact_is_primary: params.contactIsPrimary ?? true,
        p_idempotency_key: params.idempotencyKey ?? null,
      });
      const { data, error } = await builder.setHeader(
        NORA_OPERATION_ID_HEADER,
        context.operationId,
      );
      if (error) {
        throw error;
      }
      return data as CreateQuickCaptureCaseResult;
    },
  );
