/**
 * Employee account hard-delete executor (Nora User Lifecycle W6-B).
 *
 * "Benutzerkonto endgültig löschen": the ONE server-side path that removes a
 * Nora employee identity (public.sales) together with its Auth identity
 * (auth.users + GoTrue's cascade children). It exists for accidental, fake,
 * duplicate, test or never-used accounts. A real employee with business or
 * authorship history is offboarded (W5), never deleted — the database refuses
 * everything else.
 *
 * Step order (W4 pattern: ticket in one transaction, provider call, guard in
 * the provider's transaction, verification):
 *
 *   1. DATABASE  prepare_employee_account_deletion(actor, target, confirmation,
 *                adminConfirmed, operation) — evaluates the actor (active admin),
 *                the self guard, the typed full name against the CURRENT
 *                identity, the extra confirmation for admin targets and the
 *                full eligibility (all-time business history, durable
 *                provenance, disabled + banned, consistent identity), then
 *                writes a two-minute ticket. Nothing has changed yet.
 *   2. AUTH      GoTrue Admin API hard delete. GoTrue's DELETE FROM auth.users
 *                fires nora_private.guard_auth_user_delete, which — with the
 *                ticket — revalidates everything, restores the verified actor,
 *                removes Nora technical state, deletes public.sales (the six W2
 *                NO ACTION FKs abort the whole transaction on any reference)
 *                and writes user.account_deleted, all inside GoTrue's own
 *                transaction. Without a matching ticket the DELETE is refused;
 *                GoTrue answers an error and nothing changes.
 *   3. VERIFY    sales row absent AND Auth identity absent AND a committed
 *                user.account_deleted for this entity. Only then `executed`.
 *
 * Retry / idempotency (by evidence, never by assumption):
 *   - sale gone + committed deletion event   -> `already_deleted` (200), no audit
 *   - sale gone, no deletion event           -> `not_found` (404), never green
 *   - provider failed, sale still present    -> ticket cancelled,
 *                                               `account_delete_provider_failed` (502)
 *   - provider failed, sale gone + event     -> the deletion committed and the
 *                                               response was lost -> `executed`
 *   - sale present, Auth gone (outside Nora) -> the preview says inconsistent,
 *                                               prepare refuses (`identity_inconsistent`)
 *
 * The actor is the verified JWT user id (never from the body). The database
 * re-checks the actor at prepare time and again inside the delete.
 */

import type { NoraRole } from "./patchHelpers.ts";

/** What the database preview returns (snake_case; mirrored to camelCase for the UI). */
export type DeletionPreviewRow = {
  eligible: boolean;
  reasons: string[];
  target: {
    sale_id: number;
    role: NoraRole;
    disabled: boolean;
    auth_present: boolean;
    auth_confirmed: boolean;
    auth_banned: boolean;
    identity_consistent: boolean;
  };
  business_history: Record<string, unknown>;
  provenance: Record<string, unknown>;
  technical: Record<string, unknown>;
};

/** Machine-readable, UI-safe reasons why an account cannot be deleted. */
export type DeletionBlockReason =
  | "still_active"
  | "access_inconsistent"
  | "identity_inconsistent"
  | "business_history_exists"
  | "durable_provenance_exists";

/** The public preview contract (no Auth internals, no row payload). */
export type EmployeeDeletionPreview = {
  supported: true;
  eligible: boolean;
  reasons: DeletionBlockReason[];
  role: NoraRole;
  businessHistory: {
    companies: number;
    contacts: number;
    deals: number;
    tasks: number;
    contactNotes: number;
    dealNotes: number;
  };
  provenance: {
    checklistTemplates: number;
    savedTextSnippets: number;
    googleCalendarConnections: number;
    auditEventsAsActor: number;
  };
  /** Informational counts — removed or preserved per policy, never blocking. */
  technical: {
    auditEventsAsTarget: number;
    emailDeliveryEventsAttributable: number;
    emailDeliveryEventsForeign: number;
  };
};

export type DeletionTicket = {
  ticket_id: string;
  sale_id: number;
  user_id: string;
  entity_id: string;
  role: NoraRole;
  preview: DeletionPreviewRow;
};

export type DeletionEvidence = {
  sale_id: number;
  sale_exists: boolean;
  deleted_event_count: number;
  last_deleted_request_id: string | null;
  last_deleted_at: string | null;
};

/** Stable machine-readable failure contract of the deletion executor. */
export type AccountDeletionErrorCode =
  | "not_found"
  | "role_update_forbidden"
  | "self_delete_forbidden"
  | "confirmation_mismatch"
  | "admin_target_confirmation_required"
  | "employee_still_active"
  | "business_history_exists"
  | "durable_provenance_exists"
  | "identity_inconsistent"
  | "account_delete_not_authorized"
  | "account_delete_provider_failed"
  | "account_delete_verification_failed"
  | "internal_error";

export type AccountDeletionFailureDetails = {
  status: number;
  error: AccountDeletionErrorCode;
  message: string;
  /** The UI-safe block reasons when the refusal came from the eligibility contract. */
  reasons?: DeletionBlockReason[];
};

export class AccountDeletionFailure extends Error {
  constructor(public readonly failure: AccountDeletionFailureDetails) {
    super(failure.error);
    this.name = "AccountDeletionFailure";
  }
}

/** Ports the executor needs — real adapters live in index.ts, fakes in tests. */
export type AccountDeletionDeps = {
  /** get_employee_deletion_evidence(sale) — service_role only. */
  readEvidence(salesId: number): Promise<DeletionEvidence>;
  /** prepare_employee_account_deletion — rejects with a PostgrestError-like object. */
  prepare(input: {
    actorUserId: string;
    salesId: number;
    confirmationName: string;
    adminTargetConfirmed: boolean;
    operationId: string | null;
  }): Promise<DeletionTicket>;
  /** cancel_employee_account_deletion — true when a live ticket was removed. */
  cancel(ticketId: string): Promise<boolean>;
  /** GoTrue Admin hard delete; rejects on any error (incl. the guard's refusal). */
  deleteAuthUser(userId: string): Promise<void>;
  /** true when auth.users still has the id; false when GoTrue reports it gone; null when unreadable. */
  authUserExists(userId: string): Promise<boolean | null>;
  /** Structured, content-free diagnostics. Never user data, never tokens. */
  log(entry: Record<string, unknown>): void;
};

export type AccountDeletionRequest = {
  /** The caller's user id, resolved from the verified JWT — never from the body. */
  actorUserId: string;
  operationId?: string | null;
  salesId: number;
  /** Exactly what the administrator typed; the database normalises and compares. */
  confirmationName: string;
  adminTargetConfirmed: boolean;
};

export type AccountDeletionResult = {
  salesId: number;
  disposition: "executed" | "already_deleted";
  /** Present for `executed`: the role of the deleted account (for the success copy). */
  role?: NoraRole;
  deletedEventCount: number;
};

const NORA_DETAIL = {
  PERMISSION: "NORA_PERMISSION_DENIED",
  SELF: "NORA_SELF_DELETE_FORBIDDEN",
  CONFIRMATION: "NORA_DELETE_CONFIRMATION_MISMATCH",
  ADMIN_CONFIRM: "NORA_ADMIN_TARGET_CONFIRMATION_REQUIRED",
  STILL_ACTIVE: "NORA_EMPLOYEE_STILL_ACTIVE",
  ACCESS_INCONSISTENT: "NORA_EMPLOYEE_ACCESS_INCONSISTENT",
  AUTH_MISSING: "NORA_EMPLOYEE_AUTH_NOT_FOUND",
  IDENTITY_INCONSISTENT: "NORA_EMPLOYEE_IDENTITY_INCONSISTENT",
  BUSINESS_HISTORY: "NORA_EMPLOYEE_HAS_BUSINESS_HISTORY",
  PROVENANCE: "NORA_EMPLOYEE_HAS_DURABLE_PROVENANCE",
  NOT_AUTHORIZED: "NORA_ACCOUNT_DELETE_NOT_AUTHORIZED",
  SALES_NOT_AUTHORIZED: "NORA_SALES_DELETE_NOT_AUTHORIZED",
} as const;

const toCount = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
};

/** Maps one database reason code to the UI-safe vocabulary; unknown codes are dropped. */
export function toBlockReason(detail: string): DeletionBlockReason | null {
  switch (detail) {
    case NORA_DETAIL.STILL_ACTIVE:
      return "still_active";
    case NORA_DETAIL.ACCESS_INCONSISTENT:
      return "access_inconsistent";
    case NORA_DETAIL.AUTH_MISSING:
    case NORA_DETAIL.IDENTITY_INCONSISTENT:
      return "identity_inconsistent";
    case NORA_DETAIL.BUSINESS_HISTORY:
      return "business_history_exists";
    case NORA_DETAIL.PROVENANCE:
      return "durable_provenance_exists";
    default:
      return null;
  }
}

/** Maps the database preview to the public contract. Nothing else leaves the server. */
export function toDeletionPreview(
  raw: Record<string, unknown> | null | undefined,
): EmployeeDeletionPreview {
  const r = (raw ?? {}) as Partial<DeletionPreviewRow>;
  const bh = (r.business_history ?? {}) as Record<string, unknown>;
  const pv = (r.provenance ?? {}) as Record<string, unknown>;
  const te = (r.technical ?? {}) as Record<string, unknown>;
  const reasons = Array.isArray(r.reasons)
    ? r.reasons
        .map((code) => toBlockReason(String(code)))
        .filter((x): x is DeletionBlockReason => x !== null)
    : [];
  const role = r.target?.role;
  return {
    supported: true,
    eligible: r.eligible === true && reasons.length === 0,
    reasons,
    role: role === "admin" || role === "office" ? role : "viewer",
    businessHistory: {
      companies: toCount(bh.companies),
      contacts: toCount(bh.contacts),
      deals: toCount(bh.deals),
      tasks: toCount(bh.tasks),
      contactNotes: toCount(bh.contact_notes),
      dealNotes: toCount(bh.deal_notes),
    },
    provenance: {
      checklistTemplates: toCount(pv.checklist_templates),
      savedTextSnippets: toCount(pv.saved_text_snippets),
      googleCalendarConnections: toCount(pv.google_calendar_connections),
      auditEventsAsActor: toCount(pv.audit_events_as_actor),
    },
    technical: {
      auditEventsAsTarget: toCount(te.audit_events_as_target),
      emailDeliveryEventsAttributable: toCount(
        te.email_delivery_events_attributable,
      ),
      emailDeliveryEventsForeign: toCount(te.email_delivery_events_foreign),
    },
  };
}

/**
 * Maps a failure of the prepare RPC to the stable Edge error contract. The
 * canonical Nora code travels in DETAIL (`details` on a PostgrestError).
 */
export function mapPrepareRpcError(error: {
  code?: string;
  message?: string;
  details?: string | null;
}): AccountDeletionFailureDetails {
  const details = error.details ?? "";
  const code = error.code ?? "";
  const message = error.message ?? "";

  switch (details) {
    case NORA_DETAIL.SELF:
      return {
        status: 403,
        error: "self_delete_forbidden",
        message: "Administrators cannot delete their own account",
      };
    case NORA_DETAIL.CONFIRMATION:
      return {
        status: 400,
        error: "confirmation_mismatch",
        message: "The typed confirmation does not match the employee name",
      };
    case NORA_DETAIL.ADMIN_CONFIRM:
      return {
        status: 400,
        error: "admin_target_confirmation_required",
        message:
          "Deleting an administrator account requires the extra confirmation",
      };
    case NORA_DETAIL.STILL_ACTIVE:
      return {
        status: 409,
        error: "employee_still_active",
        message: "The employee still has access; end the access first",
        reasons: ["still_active"],
      };
    case NORA_DETAIL.ACCESS_INCONSISTENT:
      return {
        status: 409,
        error: "identity_inconsistent",
        message: "Access state is not consistent; synchronize it first",
        reasons: ["access_inconsistent"],
      };
    case NORA_DETAIL.AUTH_MISSING:
    case NORA_DETAIL.IDENTITY_INCONSISTENT:
      return {
        status: 409,
        error: "identity_inconsistent",
        message: "Login identity and employee profile do not resolve uniquely",
        reasons: ["identity_inconsistent"],
      };
    case NORA_DETAIL.BUSINESS_HISTORY:
      return {
        status: 409,
        error: "business_history_exists",
        message: "The employee is part of the business history",
        reasons: ["business_history_exists"],
      };
    case NORA_DETAIL.PROVENANCE:
      return {
        status: 409,
        error: "durable_provenance_exists",
        message: "The employee authored durable content or acted in Nora",
        reasons: ["durable_provenance_exists"],
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
      message: "Not authorized to delete employee accounts",
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
 * Classifies a GoTrue Admin delete failure. GoTrue (2.196, proven locally)
 * hides the database guard's refusal behind a generic 500; when the Nora
 * detail is visible it is mapped, otherwise the failure stays
 * `account_delete_provider_failed`. Either way the evidence step, not the
 * message text, decides whether anything changed.
 */
export function classifyAuthDeleteError(
  error: unknown,
): AccountDeletionErrorCode {
  const e = (error ?? {}) as { message?: unknown };
  const message = typeof e.message === "string" ? e.message : "";
  if (
    message.includes(NORA_DETAIL.NOT_AUTHORIZED) ||
    message.includes(NORA_DETAIL.SALES_NOT_AUTHORIZED)
  ) {
    return "account_delete_not_authorized";
  }
  if (message.includes(NORA_DETAIL.BUSINESS_HISTORY)) {
    return "business_history_exists";
  }
  if (message.includes(NORA_DETAIL.PROVENANCE)) {
    return "durable_provenance_exists";
  }
  if (
    message.includes(NORA_DETAIL.IDENTITY_INCONSISTENT) ||
    message.includes(NORA_DETAIL.AUTH_MISSING)
  ) {
    return "identity_inconsistent";
  }
  if (message.includes(NORA_DETAIL.STILL_ACTIVE)) {
    return "employee_still_active";
  }
  return "account_delete_provider_failed";
}

/** GoTrue's "user_not_found" (404) after a committed deletion is evidence, not an error. */
export function isAuthUserNotFound(error: unknown): boolean {
  const e = (error ?? {}) as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
  };
  return (
    e.status === 404 ||
    e.code === "user_not_found" ||
    (typeof e.message === "string" &&
      /user_not_found|not found/i.test(e.message))
  );
}

/**
 * Executes one account deletion through the single privileged path.
 * Throws AccountDeletionFailure; never resolves with an unverified state.
 */
export async function executeAccountDeletion(
  deps: AccountDeletionDeps,
  request: AccountDeletionRequest,
): Promise<AccountDeletionResult> {
  // Step 0 — evidence first: a retry after a lost response must not prepare
  // anything, and a sale that never had a committed deletion is not found.
  let evidence: DeletionEvidence;
  try {
    evidence = await deps.readEvidence(request.salesId);
  } catch (error) {
    deps.log({
      operation: "employee_account_deletion",
      stage: "evidence",
      error: "internal_error",
      sqlstate: (error as { code?: string })?.code ?? null,
    });
    throw new AccountDeletionFailure({
      status: 500,
      error: "internal_error",
      message: "Internal Server Error",
    });
  }
  if (!evidence.sale_exists) {
    if (toCount(evidence.deleted_event_count) > 0) {
      return {
        salesId: request.salesId,
        disposition: "already_deleted",
        deletedEventCount: toCount(evidence.deleted_event_count),
      };
    }
    throw new AccountDeletionFailure({
      status: 404,
      error: "not_found",
      message: "User not found",
    });
  }

  // Step 1 — database: every guard, then the ticket. Nothing has changed yet.
  let ticket: DeletionTicket;
  try {
    ticket = await deps.prepare({
      actorUserId: request.actorUserId,
      salesId: request.salesId,
      confirmationName: request.confirmationName,
      adminTargetConfirmed: request.adminTargetConfirmed,
      operationId: request.operationId ?? null,
    });
  } catch (error) {
    const failure = mapPrepareRpcError(
      (error ?? {}) as { code?: string; message?: string; details?: string },
    );
    deps.log({
      operation: "employee_account_deletion",
      stage: "db_prepare",
      error: failure.error,
      sqlstate: (error as { code?: string })?.code ?? null,
    });
    throw new AccountDeletionFailure(failure);
  }

  // Edge-level self guard repeated (the database refused it already; this
  // keeps the invariant visible even if the RPC contract ever drifted).
  if (ticket.user_id === request.actorUserId) {
    try {
      await deps.cancel(ticket.ticket_id);
    } catch {
      // nothing to do: the ticket expires on its own
    }
    throw new AccountDeletionFailure({
      status: 403,
      error: "self_delete_forbidden",
      message: "Administrators cannot delete their own account",
    });
  }

  // Step 2 — Auth. The guard inside GoTrue's transaction does the rest.
  let providerError: unknown = null;
  try {
    await deps.deleteAuthUser(ticket.user_id);
  } catch (error) {
    providerError = error ?? new Error("auth_delete_failed");
  }

  // Step 3 — verify by evidence, never by the provider's answer alone.
  let after: DeletionEvidence;
  try {
    after = await deps.readEvidence(ticket.sale_id);
  } catch (error) {
    deps.log({
      operation: "employee_account_deletion",
      stage: "verify",
      error: "account_delete_verification_failed",
      sales_id: ticket.sale_id,
      sqlstate: (error as { code?: string })?.code ?? null,
    });
    throw new AccountDeletionFailure({
      status: 500,
      error: "account_delete_verification_failed",
      message: "The deletion could not be verified",
    });
  }
  const authExists = await deps.authUserExists(ticket.user_id);
  const committed =
    after.sale_exists === false && toCount(after.deleted_event_count) > 0;

  if (providerError !== null && !committed) {
    // The provider refused or failed and the database shows no deletion (the
    // guard runs inside GoTrue's DELETE, so "nothing changed" is the only
    // other outcome). Drop the ticket so it cannot be consumed later.
    const kind = classifyAuthDeleteError(providerError);
    let cancelled: boolean | null = null;
    try {
      cancelled = await deps.cancel(ticket.ticket_id);
    } catch {
      cancelled = null;
    }
    deps.log({
      operation: "employee_account_deletion",
      stage: "auth_admin",
      error: kind,
      sales_id: ticket.sale_id,
      ticket_cancelled: cancelled,
      provider_status: (providerError as { status?: unknown })?.status ?? null,
      sale_exists: after.sale_exists,
    });
    const status =
      kind === "account_delete_provider_failed"
        ? 502
        : kind === "account_delete_not_authorized"
          ? 500
          : 409;
    throw new AccountDeletionFailure({
      status,
      error: kind,
      message:
        kind === "account_delete_provider_failed"
          ? "The login provider did not apply the deletion"
          : "The deletion was refused by the database",
      ...(toBlockReason(
        kind === "business_history_exists"
          ? NORA_DETAIL.BUSINESS_HISTORY
          : kind === "durable_provenance_exists"
            ? NORA_DETAIL.PROVENANCE
            : kind === "identity_inconsistent"
              ? NORA_DETAIL.IDENTITY_INCONSISTENT
              : kind === "employee_still_active"
                ? NORA_DETAIL.STILL_ACTIVE
                : "",
      )
        ? {
            reasons: [
              toBlockReason(
                kind === "business_history_exists"
                  ? NORA_DETAIL.BUSINESS_HISTORY
                  : kind === "durable_provenance_exists"
                    ? NORA_DETAIL.PROVENANCE
                    : kind === "identity_inconsistent"
                      ? NORA_DETAIL.IDENTITY_INCONSISTENT
                      : NORA_DETAIL.STILL_ACTIVE,
              ) as DeletionBlockReason,
            ],
          }
        : {}),
    });
  }

  if (!committed || authExists === true) {
    // Cannot happen by construction (one transaction), but never claim it.
    deps.log({
      operation: "employee_account_deletion",
      stage: "verify",
      error: "account_delete_verification_failed",
      sales_id: ticket.sale_id,
      sale_exists: after.sale_exists,
      deleted_event_count: toCount(after.deleted_event_count),
      auth_exists: authExists,
    });
    throw new AccountDeletionFailure({
      status: 500,
      error: "account_delete_verification_failed",
      message: "Account deletion not consistently applied",
    });
  }

  if (providerError !== null) {
    // Committed although the provider call reported an error (response lost
    // after commit, or GoTrue's own 404 on a racing retry): evidence wins.
    deps.log({
      operation: "employee_account_deletion",
      stage: "auth_admin",
      error: "provider_response_lost_after_commit",
      sales_id: ticket.sale_id,
      provider_not_found: isAuthUserNotFound(providerError),
    });
  }

  return {
    salesId: ticket.sale_id,
    disposition: "executed",
    role: ticket.role,
    deletedEventCount: toCount(after.deleted_event_count),
  };
}
