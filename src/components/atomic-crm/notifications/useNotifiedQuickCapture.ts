/**
 * Quick Capture notification controller (Phase 7B.4) — the first live
 * vertical slice of the notification layer.
 *
 * It is a UI/delivery-layer adapter and nothing more. It sits BETWEEN the
 * dialog and the Application Command:
 *
 *   QuickCaptureDialog → useNotifiedQuickCapture → createQuickCaptureCase
 *                              ↓
 *                        NotificationStore ← OperationManager
 *
 * Responsibilities (exhaustive):
 * 1. mint the technical correlation ids for this submit,
 * 2. register ONE user-visible intent that covers them,
 * 3. hand the ids to the Command as neutral execution metadata.
 *
 * Explicit non-responsibilities: it computes no lifecycle, interprets no
 * business error, owns no timer, reads no database and formats no text. Every
 * transition comes from the OperationManager via the store's resolver
 * (notificationPolicy.quickCaptureCaseResolver).
 *
 * The Application Command stays presentation-independent: it never learns
 * that a notification exists.
 */

import { useCallback } from "react";
import { useDataProvider } from "ra-core";

import {
  createQuickCaptureCase,
  type CreateQuickCaptureCaseInput,
  type CreateQuickCaptureCaseOutput,
} from "../application/commands/createQuickCaptureCase";
import { createOperationId } from "../operations/operationContext";
import { useOperationManager } from "../operations/OperationProvider";
import type { OperationManager } from "../operations/operationManager";
import type { CrmDataProvider } from "../providers/types";
import type { NotificationDisplayContext } from "./notificationModel";
import { getNotificationPolicy } from "./notificationPolicy";
import type { NotificationStore } from "./notificationStore";
import { useNotificationStore } from "./NotificationProvider";

export type NotifiedQuickCaptureInput = Omit<
  CreateQuickCaptureCaseInput,
  "operationIds"
> & {
  /**
   * Business subject for the card, taken from the form the user just filled
   * in. Never re-fetched, never an id, never contact details beyond a name.
   * Trimming/clamping is done by the store (`sanitizeDisplayContext`).
   */
  displayContext: NotificationDisplayContext;
};

/**
 * Raised when the submit failed BEFORE any technical operation started, so no
 * notification card exists for it and the caller must surface the reason
 * itself (Phase 7B.4 §15, category C).
 *
 * This is deliberately not turned into a synthetic OperationRecord: inventing
 * a technical operation that never ran would poison audit and the Error
 * Observatory with a failure that has no server-side counterpart.
 */
export class QuickCaptureUnnotifiedError extends Error {
  constructor(public readonly reason: unknown) {
    super("quick_capture_unnotified");
    this.name = "QuickCaptureUnnotifiedError";
  }
}

export type NotifiedQuickCaptureDeps = {
  dataProvider: CrmDataProvider;
  store: NotificationStore;
  manager: OperationManager;
};

/**
 * Pure form of the controller, so the id/intent contract can be tested
 * without a React tree.
 */
export const submitNotifiedQuickCapture = async (
  deps: NotifiedQuickCaptureDeps,
  input: NotifiedQuickCaptureInput,
): Promise<CreateQuickCaptureCaseOutput> => {
  const { displayContext, ...commandInput } = input;
  const policy = getNotificationPolicy("quickCapture.createCase");
  if (!policy?.visible) {
    // Cannot happen with the shipped policy table; keeps the intent honest
    // rather than silently registering an unpoliced card.
    throw new Error(
      "quickCapture.createCase has no visible notification policy",
    );
  }

  const caseOperationId = createOperationId();
  // A Task slot is registered ONLY when the Command will actually run the
  // Task step (`taskType` truthy — see createQuickCaptureCase). A phantom
  // slot would leave the card waiting forever on an operation that never
  // starts.
  const taskOperationId = commandInput.taskType ? createOperationId() : null;

  const notificationId = deps.store.registerIntent({
    intentType: policy.intentType,
    messageNamespace: policy.messageNamespace,
    operationIds: taskOperationId
      ? [caseOperationId, taskOperationId]
      : [caseOperationId],
    primaryOperationId: caseOperationId,
    displayContext,
    // Phase 7B.4 is human-only UI. The initiator field stays future-proof but
    // is never derived from a heuristic here.
    retry: policy.retry,
    resolve: policy.resolve,
  });

  try {
    return await createQuickCaptureCase(deps.dataProvider, {
      ...commandInput,
      operationIds: {
        caseOperationId,
        ...(taskOperationId ? { taskOperationId } : {}),
      },
    });
  } catch (error) {
    // The Core operation never reached the manager → nothing will ever settle
    // this card. Drop it instead of leaving a pending card on screen forever,
    // and tell the caller the failure is still unreported.
    if (!deps.manager.getOperation(caseOperationId)) {
      deps.store.dismiss(notificationId);
      throw new QuickCaptureUnnotifiedError(error);
    }
    // Otherwise the card already shows the failure — rethrow unchanged so the
    // caller can keep its own draft/state handling, but WITHOUT a second
    // visible message.
    throw error;
  }
};

export const useNotifiedQuickCapture = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const store = useNotificationStore();
  const manager = useOperationManager();

  return useCallback(
    (input: NotifiedQuickCaptureInput) =>
      submitNotifiedQuickCapture({ dataProvider, store, manager }, input),
    [dataProvider, store, manager],
  );
};
