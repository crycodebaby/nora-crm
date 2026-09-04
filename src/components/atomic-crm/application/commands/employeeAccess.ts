/**
 * Application actions: Employee Access (Nora Employee Onboarding & Access V1A).
 *
 * These three named operations are the single entry point for everything the
 * admin UI does with an employee's Nora-Zugang. React components contain no
 * auth orchestration of their own, so a future caller (script, automation)
 * would pass through exactly the same server-side authorization.
 *
 * The chain is deliberately flat:
 *   UI → named action (here) → dataProvider → users Edge Function → Supabase Auth
 *
 * No command bus, no repository layer — the same shape as the existing
 * createCustomerFromContact / createQuickCaptureCase commands.
 */
import type { Identifier } from "ra-core";

import type { CrmDataProvider } from "../../providers/types";
import {
  isAdminActionAllowed,
  type EmployeeAccessRecord,
  type EmployeeAccessState,
} from "../../sales/employeeAccessContract";

/**
 * Thrown when the requested action no longer matches the employee's actual
 * state (for example: a second admin activated the account in the meantime).
 * The server is authoritative and returns the same condition as
 * "action_not_applicable" — this class only carries it to the UI.
 */
export class EmployeeAccessActionNotApplicableError extends Error {
  constructor(public readonly accessState?: EmployeeAccessState) {
    super("action_not_applicable");
    this.name = "EmployeeAccessActionNotApplicableError";
  }
}

/** Reads the access status of one employee, or of every employee. */
export const getEmployeeAccessStatus = async (
  dataProvider: CrmDataProvider,
  salesId?: Identifier,
): Promise<EmployeeAccessRecord[]> => {
  return dataProvider.getEmployeeAccessStatus(salesId);
};

/**
 * "Einladung erneut senden" — meaningful only while the employee has not
 * activated their access. Pre-checked here purely to avoid a pointless round
 * trip; the Edge Function performs the authoritative check again.
 */
export const resendEmployeeInvitation = async (
  dataProvider: CrmDataProvider,
  input: { salesId: Identifier; currentState?: EmployeeAccessState },
): Promise<EmployeeAccessRecord> => {
  if (
    input.currentState &&
    !isAdminActionAllowed(input.currentState, "resend_invitation")
  ) {
    throw new EmployeeAccessActionNotApplicableError(input.currentState);
  }

  try {
    return await dataProvider.resendEmployeeInvitation(input.salesId);
  } catch (error) {
    throw normalizeAccessError(error);
  }
};

/**
 * "Passwort einrichten lassen" — for an already active employee. Sends THEM a
 * fresh link to choose their own password. No password is ever generated for
 * or shown to the administrator.
 */
export const requestEmployeePasswordSetup = async (
  dataProvider: CrmDataProvider,
  input: { salesId: Identifier; currentState?: EmployeeAccessState },
): Promise<EmployeeAccessRecord> => {
  if (
    input.currentState &&
    !isAdminActionAllowed(input.currentState, "request_password_setup")
  ) {
    throw new EmployeeAccessActionNotApplicableError(input.currentState);
  }

  try {
    return await dataProvider.requestEmployeePasswordSetup(input.salesId);
  } catch (error) {
    throw normalizeAccessError(error);
  }
};

function normalizeAccessError(error: unknown): unknown {
  const message = error instanceof Error ? error.message : "";
  if (message === "action_not_applicable") {
    return new EmployeeAccessActionNotApplicableError();
  }
  return error;
}
