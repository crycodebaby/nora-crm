/**
 * Employee login-email change executor (Nora User Lifecycle W4).
 *
 * The ONE server-side path that moves an employee's login identity from one
 * address to another. Nothing else in Nora writes public.sales.email, and the
 * database refuses every auth.users email change that did not come through
 * here (guard_auth_email_change: ticket or refusal).
 *
 * Step order, chosen so that no step can leave the two identity stores apart:
 *
 *   1. DATABASE  prepare_sales_email_change(actor, target, new, operation)
 *                evaluates the actor, the self guard, the address (trim +
 *                lower-case, format, uniqueness across sales AND auth.users),
 *                the current identity consistency and the no-op case BEFORE
 *                anything changes, then writes a two-minute ticket. A refused
 *                request has touched nothing.
 *   2. AUTH      GoTrue Admin API: email = new. GoTrue's own UPDATE fires the
 *                database guard, which — with the ticket — writes sales.email,
 *                deletes the user's outstanding one-time tokens (old invitation
 *                and password links) and the user.email_changed audit row in
 *                the SAME transaction. Without a matching ticket the UPDATE is
 *                refused and GoTrue reports an error; nothing changes.
 *   3. VERIFY    re-read both facts. Only "sales.email = auth email = new,
 *                access state unchanged" is reported as success. An uncertain
 *                provider result (timeout after commit) resolves here: if the
 *                database shows the new address on both sides, the change
 *                happened.
 *   4. INVITE    only for an employee who had not activated yet and is not
 *                disabled: a fresh invitation goes to the new address (the old
 *                link is already dead since step 2). A failed send never
 *                reports the change as green — the identity is moved, the
 *                admin gets `email_change_invitation_failed` and can use
 *                "Einladung erneut senden".
 *
 * The Auth identity and the Nora identity really do change in one Postgres
 * transaction — GoTrue and public.sales share the database and the guard runs
 * inside GoTrue's UPDATE. What is NOT atomic is the HTTP round trip to the
 * provider and the optional invitation, which is why steps 3 and 4 exist and
 * why a retry after an uncertain result answers `email_unchanged` rather than
 * repeating a provider effect.
 *
 * Access state is orthogonal by construction: the guard may only write
 * sales.email (nora_identity_manager capability), never disabled/role, and
 * GoTrue's admin email update does not touch banned_until (proven locally).
 * Step 3 still verifies it.
 */

import {
  deriveAccessConsistency,
  hasActiveBan,
  hasConfirmedEmail,
  normalizeLoginEmail,
  type EmployeeAuthFacts,
} from "./accessState.ts";
import type { NoraRole } from "./patchHelpers.ts";

export type EmailChangeSaleRow = {
  id: number;
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: NoraRole;
  disabled: boolean;
};

/** What prepare_sales_email_change hands back — the ticket plus the facts it verified. */
export type EmailChangeTicket = {
  ticket_id: string;
  sale_id: number;
  user_id: string;
  old_email: string;
  new_email: string;
  role: NoraRole;
  disabled: boolean;
  auth_confirmed: boolean;
  auth_banned: boolean;
};

/** Stable machine-readable failure contract of the email-change executor. */
export type EmailChangeErrorCode =
  | "invalid_payload"
  | "invalid_email"
  | "email_unchanged"
  | "email_already_in_use"
  | "employee_auth_not_found"
  | "employee_identity_inconsistent"
  | "self_email_change_forbidden"
  | "role_update_forbidden"
  | "not_found"
  | "email_change_provider_failed"
  | "email_change_sync_failed"
  | "email_change_invitation_failed"
  | "internal_error";

export type EmailChangeFailureDetails = {
  status: number;
  error: EmailChangeErrorCode;
  message: string;
  /** True when the identity was moved although the request is reported non-green. */
  emailChanged?: boolean;
  identityConsistency?: "consistent" | "inconsistent" | "unknown";
};

export class EmailChangeFailure extends Error {
  constructor(public readonly failure: EmailChangeFailureDetails) {
    super(failure.error);
    this.name = "EmailChangeFailure";
  }
}

/** Ports the executor needs — real adapters live in index.ts, fakes in tests. */
export type EmailChangeDeps = {
  /** Calls prepare_sales_email_change; rejects with a PostgrestError-like object. */
  prepare(input: {
    actorUserId: string;
    salesId: number;
    newEmail: string;
    operationId: string | null;
  }): Promise<EmailChangeTicket>;
  /** Calls cancel_sales_email_change; resolves true when a live ticket was removed. */
  cancel(ticketId: string): Promise<boolean>;
  /** GoTrue Admin API `email = …`; rejects on any error (including the guard's refusal). */
  updateAuthEmail(userId: string, email: string): Promise<void>;
  readSale(salesId: number): Promise<EmailChangeSaleRow | null>;
  /** Must include the Auth email. null when the identity cannot be read. */
  readAuthFacts(userId: string): Promise<EmployeeAuthFacts | null>;
  /** Fresh invitation to the (new) address; rejects when the provider refuses. */
  sendInvitation(input: {
    email: string;
    firstName: string;
    lastName: string;
  }): Promise<void>;
  /** Structured, content-free diagnostics. Never user data, never tokens. */
  log(entry: Record<string, unknown>): void;
};

export type EmailChangeRequest = {
  /** The caller's user id, resolved from the verified JWT — never from the body. */
  actorUserId: string;
  operationId?: string | null;
  salesId: number;
  newEmail: string;
};

export type EmailChangeResult = {
  sale: EmailChangeSaleRow;
  authFacts: EmployeeAuthFacts;
  previousEmail: string;
  newEmail: string;
  /** A fresh invitation went to the new address (invited employee only). */
  invitationSent: boolean;
};

const NORA_DETAIL = {
  PERMISSION: "NORA_PERMISSION_DENIED",
  SELF: "NORA_SELF_EMAIL_CHANGE_FORBIDDEN",
  INVALID: "NORA_EMAIL_INVALID",
  UNCHANGED: "NORA_EMAIL_UNCHANGED",
  IN_USE: "NORA_EMAIL_ALREADY_IN_USE",
  AUTH_MISSING: "NORA_EMPLOYEE_AUTH_NOT_FOUND",
  INCONSISTENT: "NORA_EMPLOYEE_IDENTITY_INCONSISTENT",
  NOT_AUTHORIZED: "NORA_EMAIL_CHANGE_NOT_AUTHORIZED",
} as const;

/**
 * Maps a failure of the prepare RPC to the stable Edge error contract. The
 * canonical Nora code travels in DETAIL (`details` on a PostgrestError).
 */
export function mapPrepareRpcError(error: {
  code?: string;
  message?: string;
  details?: string | null;
}): EmailChangeFailureDetails {
  const details = error.details ?? "";
  const code = error.code ?? "";
  const message = error.message ?? "";

  switch (details) {
    case NORA_DETAIL.SELF:
      return {
        status: 403,
        error: "self_email_change_forbidden",
        message: "Administrators cannot change their own login email here",
      };
    case NORA_DETAIL.INVALID:
      return { status: 400, error: "invalid_email", message: "Invalid email" };
    case NORA_DETAIL.UNCHANGED:
      return {
        status: 409,
        error: "email_unchanged",
        message: "The new address equals the current login email",
      };
    case NORA_DETAIL.IN_USE:
      return {
        status: 409,
        error: "email_already_in_use",
        message: "This address already belongs to another employee",
      };
    case NORA_DETAIL.AUTH_MISSING:
      return {
        status: 409,
        error: "employee_auth_not_found",
        message: "No login identity exists for this employee",
      };
    case NORA_DETAIL.INCONSISTENT:
      return {
        status: 409,
        error: "employee_identity_inconsistent",
        message: "Login identity and employee profile disagree",
        identityConsistency: "inconsistent",
      };
    default:
      break;
  }
  if (
    details === NORA_DETAIL.PERMISSION ||
    code === "42501" ||
    /forbidden/i.test(message)
  ) {
    return {
      status: 403,
      error: "role_update_forbidden",
      message: "Not authorized to change login emails",
    };
  }
  if (code === "P0002" || /not found/i.test(message)) {
    return { status: 404, error: "not_found", message: "User not found" };
  }
  return {
    status: 500,
    error: "internal_error",
    message: "Internal Server Error",
  };
}

/**
 * Classifies a GoTrue Admin API failure. A unique violation means the address
 * was taken between step 1 and step 2. The database guard's refusal is
 * recognised when its detail is visible; GoTrue (2.196, proven locally) may
 * also hide it behind a generic "Error updating user" 500 — that case stays
 * `email_change_provider_failed`, which is equally non-green. Either way the
 * verification step, not the message text, decides whether anything moved.
 */
export function classifyAuthUpdateError(error: unknown): EmailChangeErrorCode {
  const e = (error ?? {}) as { code?: unknown; message?: unknown };
  const code = typeof e.code === "string" ? e.code : String(e.code ?? "");
  const message = typeof e.message === "string" ? e.message : "";
  if (message.includes(NORA_DETAIL.NOT_AUTHORIZED)) {
    return "email_change_sync_failed";
  }
  if (message.includes(NORA_DETAIL.INCONSISTENT)) {
    return "employee_identity_inconsistent";
  }
  if (
    code === "23505" ||
    /duplicate key|already been registered/i.test(message)
  ) {
    return "email_already_in_use";
  }
  return "email_change_provider_failed";
}

function sameEmail(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  return normalizeLoginEmail(a) === normalizeLoginEmail(b);
}

/**
 * Executes one login-email change through the single privileged path.
 * Throws EmailChangeFailure; never resolves with an unverified state.
 */
export async function executeEmailChange(
  deps: EmailChangeDeps,
  request: EmailChangeRequest,
): Promise<EmailChangeResult> {
  const requested = normalizeLoginEmail(request.newEmail);
  if (!requested) {
    throw new EmailChangeFailure({
      status: 400,
      error: "invalid_email",
      message: "Invalid email",
    });
  }

  // Step 1 — database: every guard, then the ticket. Nothing has changed yet.
  let ticket: EmailChangeTicket;
  try {
    ticket = await deps.prepare({
      actorUserId: request.actorUserId,
      salesId: request.salesId,
      newEmail: requested,
      operationId: request.operationId ?? null,
    });
  } catch (error) {
    const failure = mapPrepareRpcError(
      (error ?? {}) as { code?: string; message?: string; details?: string },
    );
    deps.log({
      operation: "employee_email_change",
      stage: "db_prepare",
      error: failure.error,
      sqlstate: (error as { code?: string })?.code ?? null,
    });
    throw new EmailChangeFailure(failure);
  }

  const target = ticket.new_email;

  // Step 2 — Auth. The guard inside GoTrue's transaction does the rest.
  let providerError: unknown = null;
  try {
    await deps.updateAuthEmail(ticket.user_id, target);
  } catch (error) {
    providerError = error ?? new Error("auth_update_failed");
  }

  // Step 3 — verify both identity stores and the access state.
  const fresh = await deps.readSale(ticket.sale_id);
  const facts = fresh ? await deps.readAuthFacts(fresh.user_id) : null;
  const salesMoved = Boolean(fresh && sameEmail(fresh.email, target));
  const authMoved = Boolean(facts && sameEmail(facts.email, target));

  if (providerError !== null && !(salesMoved && authMoved)) {
    // The provider refused or failed and the database shows no change (the
    // guard runs inside GoTrue's UPDATE, so "nothing moved" is the only other
    // outcome). Drop the ticket so it cannot be consumed later.
    const kind = classifyAuthUpdateError(providerError);
    let cancelled: boolean | null = null;
    try {
      cancelled = await deps.cancel(ticket.ticket_id);
    } catch {
      cancelled = null;
    }
    deps.log({
      operation: "employee_email_change",
      stage: "auth_admin",
      error: kind,
      sales_id: ticket.sale_id,
      ticket_cancelled: cancelled,
      provider_code: (providerError as { code?: unknown })?.code ?? null,
    });
    const status =
      kind === "email_already_in_use" ||
      kind === "employee_identity_inconsistent"
        ? 409
        : 502;
    throw new EmailChangeFailure({
      status,
      error: kind,
      message:
        kind === "email_already_in_use"
          ? "This address already belongs to another identity"
          : kind === "employee_identity_inconsistent"
            ? "Login identity and employee profile disagree"
            : "The login provider did not apply the change",
      emailChanged: false,
      identityConsistency:
        fresh && facts
          ? sameEmail(facts.email, fresh.email)
            ? "consistent"
            : "inconsistent"
          : "unknown",
    });
  }

  if (!fresh || !facts || !salesMoved || !authMoved) {
    // Cannot happen by construction (one transaction), but never claim it.
    deps.log({
      operation: "employee_email_change",
      stage: "verify",
      error: "email_change_sync_failed",
      sales_id: ticket.sale_id,
      sales_moved: salesMoved,
      auth_moved: authMoved,
      auth_readable: facts !== null,
    });
    throw new EmailChangeFailure({
      status: 500,
      error: "email_change_sync_failed",
      message: "Login email not consistently applied",
      emailChanged: salesMoved || authMoved,
      identityConsistency: !fresh || !facts ? "unknown" : "inconsistent",
    });
  }

  const accessUnchanged =
    fresh.disabled === ticket.disabled &&
    fresh.role === ticket.role &&
    hasActiveBan(facts.banned_until) === ticket.auth_banned &&
    deriveAccessConsistency(fresh, facts) === "consistent";

  if (!accessUnchanged) {
    deps.log({
      operation: "employee_email_change",
      stage: "verify",
      error: "email_change_sync_failed",
      sales_id: ticket.sale_id,
      access_state_changed: true,
    });
    throw new EmailChangeFailure({
      status: 500,
      error: "email_change_sync_failed",
      message: "Access state changed during the email change",
      emailChanged: true,
      identityConsistency: "consistent",
    });
  }

  // Step 4 — invited employees get a fresh invitation to the new address.
  // Disabled employees never do, whatever their confirmation state.
  let invitationSent = false;
  const wasInvited = !ticket.disabled && !ticket.auth_confirmed;
  if (wasInvited && !hasConfirmedEmail(facts)) {
    try {
      await deps.sendInvitation({
        email: target,
        firstName: fresh.first_name,
        lastName: fresh.last_name,
      });
      invitationSent = true;
    } catch (error) {
      deps.log({
        operation: "employee_email_change",
        stage: "invite",
        error: "email_change_invitation_failed",
        sales_id: ticket.sale_id,
        provider_code: (error as { code?: unknown })?.code ?? null,
      });
      throw new EmailChangeFailure({
        status: 502,
        error: "email_change_invitation_failed",
        message:
          "Login email changed, but the new invitation could not be sent",
        emailChanged: true,
        identityConsistency: "consistent",
      });
    }
  }

  return {
    sale: fresh,
    authFacts: facts,
    previousEmail: ticket.old_email,
    newEmail: target,
    invitationSent,
  };
}
