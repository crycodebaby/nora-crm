/**
 * Notification policy + state resolvers (Phase 7B.1).
 *
 * Not every technical operation deserves a visible card. A CatalogOperationType
 * that is not listed here is SILENT — visibility is opt-in, never automatic.
 *
 * The resolver is the per-intent reduction from "n technical operations" to
 * "one presentation state". It is the only place that knows a Quick Capture
 * card covers two operations.
 */

import { NORA_ERROR_CODES } from "../domain/noraErrorCodes";
import type { CatalogOperationType } from "../operations/operationCatalog";
import type { OperationRecord } from "../operations/operationModel";
import {
  NO_RETRY,
  type NotificationIntentType,
  type NotificationRetryPolicy,
  type NotificationState,
} from "./notificationModel";
import {
  notificationNamespace,
  partialDetailKey,
} from "./notificationMessages";
import { resolveNotificationErrorDetailKey } from "./notificationErrorPresentation";

/**
 * A resolver never sees the raw manager — only the records for the operation
 * ids this notification registered, in registration order. `undefined` means
 * "registered but not started yet", which reads as pending.
 */
export type NotificationResolverContext = {
  operations: readonly (OperationRecord | undefined)[];
  namespace: string;
};

export type NotificationResolution = {
  state: NotificationState;
  /**
   * Which operation produced the failure — used later to pick up its
   * publicErrorRef. Never rendered.
   */
  failedOperationId?: string;
};

export type NotificationStateResolver = (
  context: NotificationResolverContext,
) => NotificationResolution;

const errorResolution = (
  operation: OperationRecord,
): NotificationResolution => ({
  state: {
    lifecycle: "error",
    detailKey: resolveNotificationErrorDetailKey({
      errorCode: operation.errorCode,
      safeErrorCode: operation.safeErrorCode,
    }),
  },
  failedOperationId: operation.operationId,
});

const PENDING: NotificationResolution = { state: { lifecycle: "pending" } };
const SUCCESS: NotificationResolution = { state: { lifecycle: "success" } };

/** Default: the card mirrors exactly one operation. */
export const singleOperationResolver: NotificationStateResolver = ({
  operations,
}) => {
  const operation = operations[0];
  if (!operation || operation.status === "pending") return PENDING;
  if (operation.status === "error") return errorResolution(operation);
  return SUCCESS;
};

/**
 * Quick Capture composite: one user intent, two technical operations.
 *
 * operations[0] = quickCapture.createCase (Kunde + Kontakt + Vorgang, atomic)
 * operations[1] = quickCapture.createTask (optional, best-effort, only
 *                 registered when the user actually asked for a task)
 *
 * Core failure wins outright — the task never starts in that case.
 * Core success + task failure is the Presentation-only `partial`, EXCEPT for
 * NORA_IDEMPOTENCY_CONFLICT: createQuickCaptureCase.ts deliberately throws that
 * hard instead of setting taskFailed, because it means the key was reused with
 * different data. Softening it to amber would hide a real conflict.
 */
export const quickCaptureCaseResolver: NotificationStateResolver = ({
  operations,
  namespace,
}) => {
  const core = operations[0];
  if (!core || core.status === "pending") return PENDING;
  if (core.status === "error") return errorResolution(core);

  // Core succeeded. No task registered → the intent is fully done.
  if (operations.length < 2) return SUCCESS;

  const task = operations[1];
  if (!task || task.status === "pending") return PENDING;
  if (task.status === "error") {
    if (task.errorCode === NORA_ERROR_CODES.IDEMPOTENCY_CONFLICT) {
      return errorResolution(task);
    }
    return {
      state: { lifecycle: "partial", detailKey: partialDetailKey(namespace) },
      failedOperationId: task.operationId,
    };
  }
  return SUCCESS;
};

export type NotificationPolicy = {
  /** false = deliberately silent; the operation still runs and is still audited. */
  visible: boolean;
  intentType: NotificationIntentType;
  /** i18n namespace root for this intent's message keys. */
  messageNamespace: string;
  retry: NotificationRetryPolicy;
  resolve: NotificationStateResolver;
};

/**
 * Phase 7B ships exactly one visible intent. `quickCapture.createTask` is
 * listed explicitly as invisible so the intent is documented rather than
 * merely absent — it is folded into the Quick Capture card.
 *
 * `deal.update`, `customer.createWithContact` and `contact.convertToCustomer`
 * follow in 7C and are deliberately NOT listed yet.
 */
export const NOTIFICATION_POLICIES: Partial<
  Record<CatalogOperationType, NotificationPolicy>
> = {
  "quickCapture.createCase": {
    visible: true,
    intentType: "quickCapture.case",
    messageNamespace: notificationNamespace("quick_capture_case"),
    // Phase 7B: no half-working retry. Task-only retry is a 7C decision.
    retry: NO_RETRY,
    resolve: quickCaptureCaseResolver,
  },
  "quickCapture.createTask": {
    visible: false,
    intentType: "quickCapture.case",
    messageNamespace: notificationNamespace("quick_capture_case"),
    retry: NO_RETRY,
    resolve: singleOperationResolver,
  },
};

export const getNotificationPolicy = (
  operationType: CatalogOperationType,
): NotificationPolicy | undefined => NOTIFICATION_POLICIES[operationType];

/** Unlisted operation types are silent. */
export const isNotifiable = (operationType: CatalogOperationType): boolean =>
  getNotificationPolicy(operationType)?.visible === true;
