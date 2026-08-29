/**
 * quickCapture.createTask: Quick Capture follow-up task creation (Idempotency
 * Wave, 2026-08-29). Deliberately a separate RPC/transaction from
 * quickCapture.createCase — the task stays a best-effort step, a failed
 * attempt must never roll back an already-committed Core write. Reuses the
 * SAME idempotencyKey as the paired create_quick_capture_case call, but the
 * server checks it under its own scope (quick_capture_case.task) — same key,
 * independent claim. Operation Manager owns its own operation_id, then the
 * RPC call carries x-nora-operation-id for audit correlation (independent
 * from the Core call's operation_id).
 */

import { OPERATION_CATALOG } from "./operationCatalog";
import {
  getDefaultOperationManager,
  type OperationManager,
} from "./operationManager";
import { NORA_OPERATION_ID_HEADER } from "./operationContext";
import { extractRpcDisposition } from "./rpcDisposition";

export type CreateQuickCaptureTaskParams = {
  companyId: string | number | null;
  contactId?: string | number | null;
  type?: string | null;
  text?: string | null;
  dueDate?: string | null;
  salesId?: string | number | null;
  /**
   * Same client-owned key as the paired quickCapture.createCase call — see
   * executeCreateQuickCaptureCase.ts. Checked under an independent scope
   * (quick_capture_case.task) server-side, so a changed task on the same
   * key still conflicts even though the Core write can replay cleanly.
   */
  idempotencyKey?: string | null;
};

export type CreateQuickCaptureTaskResult = {
  task_id: number;
};

type RpcFn = (
  fn: "create_quick_capture_task",
  args: {
    p_company_id: string | number | null;
    p_contact_id: string | number | null;
    p_type: string | null;
    p_text: string | null;
    p_due_date: string | null;
    p_sales_id: string | number | null;
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

export const executeCreateQuickCaptureTask = async (
  params: CreateQuickCaptureTaskParams,
  rpc: RpcFn,
  manager: OperationManager = getDefaultOperationManager(),
): Promise<CreateQuickCaptureTaskResult> =>
  manager.execute(
    OPERATION_CATALOG["quickCapture.createTask"],
    {},
    async (context) => {
      const builder = rpc("create_quick_capture_task", {
        p_company_id: params.companyId,
        p_contact_id: params.contactId ?? null,
        p_type: params.type ?? null,
        p_text: params.text ?? null,
        p_due_date: params.dueDate ?? null,
        p_sales_id: params.salesId ?? null,
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
        extractRpcDisposition<CreateQuickCaptureTaskResult>(data);
      if (disposition) {
        context.reportOutcome({
          execution: disposition,
          result: { taskId: business.task_id },
        });
      }
      return business;
    },
  );
