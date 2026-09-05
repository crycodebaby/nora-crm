/**
 * Employee admin audit bridge (Nora User Lifecycle W3).
 *
 * The users Edge Function is the only place that knows the verified human
 * behind a lifecycle request (UserMiddleware → auth.getUser) while talking to
 * the database as service_role. This module carries exactly three facts into
 * the trusted audit path and nothing else:
 *
 *   actorUserId   the caller's user id from the verified JWT — never from
 *                 the request body
 *   salesId       the target employee (public.sales.id)
 *   operationId   the request correlation id (x-nora-operation-id, or one
 *                 minted per request so every audit row of one request shares
 *                 it)
 *
 * Everything else — actor name/role/sales_id snapshots, the stable target
 * entity_id, the metadata facts — is derived by public.record_employee_admin_event
 * inside the database. The caller may only pass the allowlisted key `role`.
 *
 * Which actions are audited here: the three admin actions that do not change
 * sales.role / sales.disabled (invite, invitation resend, password setup
 * request). Role and access changes are audited by the database trigger on
 * public.sales inside the executor's own transaction (see lifecycle.ts).
 *
 * Ordering: the audit row is written only AFTER the provider accepted the
 * action (invitation sent, reset mail sent, employee created and role
 * applied). A refused or failed provider call never yields an audit row.
 * If the audit write itself fails after a successful provider call, the
 * request is reported as `audit_write_failed` (HTTP 500) — the action did
 * happen, but Nora refuses to report a green result without its durable
 * business record. There is no false-success audit and no false-green
 * response.
 */

import {
  isValidNoraOperationId,
  readOperationIdFromRequest,
} from "../_shared/operationId.ts";

export type EmployeeAdminEventType =
  | "user.invited"
  | "user.invitation_resent"
  | "user.password_setup_requested";

export type EmployeeAdminEventInput = {
  /** From the verified JWT only. */
  actorUserId: string;
  /** Target employee (public.sales.id). */
  salesId: number;
  eventType: EmployeeAdminEventType;
  operationId: string | null;
  /** Allowlisted caller metadata; only `role` is accepted by the database. */
  metadata?: { role?: "admin" | "office" | "viewer" };
};

/** Port the bridge needs — the real adapter calls the RPC as service_role. */
export type EmployeeAuditDeps = {
  /** Calls public.record_employee_admin_event; rejects on any error. */
  recordEmployeeAdminEvent(input: {
    actorUserId: string;
    salesId: number;
    eventType: EmployeeAdminEventType;
    operationId: string | null;
    metadata: Record<string, unknown> | null;
  }): Promise<void>;
  /** Structured, content-free diagnostics. Never user data, never tokens. */
  log(entry: Record<string, unknown>): void;
};

export type AuditWriteFailureDetails = {
  status: 500;
  error: "audit_write_failed";
  message: string;
};

export class AuditWriteFailure extends Error {
  constructor(public readonly failure: AuditWriteFailureDetails) {
    super(failure.error);
    this.name = "AuditWriteFailure";
  }
}

/**
 * One correlation id per request: the header when the browser sent a valid
 * one, otherwise a fresh UUID minted here. The result is passed to every
 * database call of this request so the trigger-written events (role change,
 * disable, enable) and the Edge-written events (invite, resend, password
 * setup) of one request share the same request_id.
 */
export function resolveRequestOperationId(req: Request): string {
  const fromHeader = readOperationIdFromRequest(req);
  if (fromHeader && isValidNoraOperationId(fromHeader)) return fromHeader;
  return crypto.randomUUID();
}

/**
 * Writes one employee admin audit event through the trusted path. Throws
 * AuditWriteFailure when the database refuses or the call fails; the caller
 * decides how to report it (always non-green — see module comment).
 */
export async function recordEmployeeAdminEvent(
  deps: EmployeeAuditDeps,
  input: EmployeeAdminEventInput,
): Promise<void> {
  const metadata =
    input.metadata && input.metadata.role !== undefined
      ? { role: input.metadata.role }
      : null;

  try {
    await deps.recordEmployeeAdminEvent({
      actorUserId: input.actorUserId,
      salesId: input.salesId,
      eventType: input.eventType,
      operationId: input.operationId,
      metadata,
    });
  } catch (error) {
    deps.log({
      operation: "employee_admin_audit",
      stage: "db",
      event_type: input.eventType,
      sales_id: input.salesId,
      sqlstate: (error as { code?: string })?.code ?? null,
      error: "audit_write_failed",
    });
    throw new AuditWriteFailure({
      status: 500,
      error: "audit_write_failed",
      message: "Action performed, but the audit record could not be written",
    });
  }
}
