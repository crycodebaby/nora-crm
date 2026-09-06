/**
 * Employee offboarding executor (Nora User Lifecycle W5).
 *
 * "Zugang beenden": this employee must no longer have operational access to
 * Nora. The person, their history and every business reference stay. Nothing
 * is mailed. Open assignments are surfaced, never a precondition.
 *
 * Step order, chosen so a partial failure fails towards "access denied":
 *
 *   1. DATABASE  offboard_employee_by_executor(actor, target, operation) —
 *                evaluates the actor, the self guard and the last-admin
 *                invariant, then in ONE transaction: sales.disabled := true
 *                (W1 capability path, user.disabled audit), every Auth
 *                session / refresh token of the employee deleted, dependency
 *                counts taken, user.offboarded written with the real actor
 *                (W3). A refused request has touched nothing. From this
 *                moment RLS denies every business row and GoTrue refuses the
 *                employee's refresh tokens and /user calls.
 *   2. AUTH      ban the Supabase Auth identity so a new login is refused at
 *                the provider too (same ban as W1 disable).
 *   3. VERIFY    re-read both facts and derive accessConsistency. Only a
 *                verified "consistent" pair is reported as success.
 *
 * Failure after step 1 (ban call fails or verification disagrees) leaves the
 * employee disabled with all sessions revoked — no data access is possible —
 * but GoTrue would still accept a password login (which then finds no
 * access). The caller receives `employee_access_sync_incomplete` with
 * `offboarded: true`, never a green result; "Zugangsstatus synchronisieren"
 * (W1) or a retry of this command converges the ban. A retry is safe: step 1
 * answers `replayed` (no state change, no second user.offboarded row) and
 * step 2 re-applies the same ban.
 *
 * There is no distributed transaction here on purpose: GoTrue's ban and the
 * database do not share one. Everything that CAN be atomic (access flag,
 * session revocation, audit) is — inside the database function.
 */

import {
  deriveAccessConsistency,
  type AccessConsistency,
  type EmployeeAuthFacts,
  type EmployeeDependencyPreview,
} from "./accessState.ts";
import { mapAccessRpcError, type LifecycleSaleRow } from "./lifecycle.ts";

/** What the database function hands back. */
export type OffboardRpcResult = LifecycleSaleRow & {
  disposition: "executed" | "replayed";
  sessions_revoked: number;
  dependencies: Record<string, unknown>;
};

/** Stable machine-readable failure contract of the offboarding executor. */
export type OffboardingErrorCode =
  | "not_found"
  | "role_update_forbidden"
  | "self_access_change_forbidden"
  | "last_active_admin_required"
  | "employee_access_sync_incomplete"
  | "internal_error";

export type OffboardingFailureDetails = {
  status: number;
  error: OffboardingErrorCode;
  message: string;
  /** True when access was already removed in the database (step 1 done). */
  offboarded?: boolean;
  accessConsistency?: AccessConsistency;
};

export class OffboardingFailure extends Error {
  constructor(public readonly failure: OffboardingFailureDetails) {
    super(failure.error);
    this.name = "OffboardingFailure";
  }
}

/** Ports the executor needs — real adapters live in index.ts, fakes in tests. */
export type OffboardingDeps = {
  /** Calls offboard_employee_by_executor; rejects with a PostgrestError-like object. */
  offboard(input: {
    actorUserId: string;
    salesId: number;
    operationId: string | null;
  }): Promise<OffboardRpcResult>;
  /** Bans (true) or unbans (false) the Auth identity; rejects on failure. */
  setAuthBan(userId: string, banned: boolean): Promise<void>;
  readSale(salesId: number): Promise<LifecycleSaleRow | null>;
  readAuthFacts(userId: string): Promise<EmployeeAuthFacts | null>;
  /** Structured, content-free diagnostics. Never user data, never tokens. */
  log(entry: Record<string, unknown>): void;
};

export type OffboardingRequest = {
  /** The caller's user id, resolved from the verified JWT — never from the body. */
  actorUserId: string;
  operationId?: string | null;
  target: LifecycleSaleRow;
};

export type OffboardingResult = {
  sale: LifecycleSaleRow;
  accessConsistency: AccessConsistency;
  disposition: "executed" | "replayed";
  sessionsRevoked: number;
  dependencies: EmployeeDependencyPreview;
};

const toCount = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
};

/** Maps the database's snake_case counts to the public contract. Unknown keys are dropped. */
export function toDependencyPreview(
  raw: Record<string, unknown> | null | undefined,
): EmployeeDependencyPreview {
  const r = raw ?? {};
  return {
    companies: toCount(r.companies),
    contacts: toCount(r.contacts),
    openDeals: toCount(r.open_deals),
    openTasks: toCount(r.open_tasks),
    contactNotes: toCount(r.contact_notes),
    dealNotes: toCount(r.deal_notes),
  };
}

/**
 * Executes one offboarding through the single privileged path.
 * Throws OffboardingFailure; never resolves with an unverified state.
 */
export async function executeOffboarding(
  deps: OffboardingDeps,
  request: OffboardingRequest,
): Promise<OffboardingResult> {
  // Edge-level self guard (repeated in the database): the caller never ends
  // their own access. Refused before any write.
  if (request.target.user_id === request.actorUserId) {
    throw new OffboardingFailure({
      status: 403,
      error: "self_access_change_forbidden",
      message: "Administrators cannot end their own access",
    });
  }

  // Step 1 — database: guards, access off, sessions gone, audit — atomically.
  let applied: OffboardRpcResult;
  try {
    applied = await deps.offboard({
      actorUserId: request.actorUserId,
      salesId: request.target.id,
      operationId: request.operationId ?? null,
    });
  } catch (error) {
    const failure = mapAccessRpcError(
      (error ?? {}) as { code?: string; message?: string; details?: string },
    );
    deps.log({
      operation: "employee_offboarding",
      stage: "db",
      error: failure.error,
      sqlstate: (error as { code?: string })?.code ?? null,
    });
    throw new OffboardingFailure({
      status: failure.status,
      error: failure.error as OffboardingErrorCode,
      message: failure.message,
    });
  }

  // Step 2 — Auth: the ban refuses new logins at the provider.
  let authSynced = true;
  try {
    await deps.setAuthBan(applied.user_id, true);
  } catch {
    authSynced = false;
    deps.log({
      operation: "employee_offboarding",
      stage: "auth_admin",
      error: "auth_update_failed",
      sales_id: applied.id,
    });
  }

  // Step 3 — verify both facts before reporting success.
  const fresh = (await deps.readSale(applied.id)) ?? applied;
  const facts = await deps.readAuthFacts(fresh.user_id);
  const accessConsistency = deriveAccessConsistency(fresh, facts);

  if (!fresh.disabled || !authSynced || accessConsistency !== "consistent") {
    deps.log({
      operation: "employee_offboarding",
      stage: "verify",
      error: "employee_access_sync_incomplete",
      sales_id: fresh.id,
      nora_disabled: fresh.disabled,
      access_consistency: accessConsistency,
    });
    throw new OffboardingFailure({
      status: 500,
      error: "employee_access_sync_incomplete",
      message: "Offboarding not fully synchronized",
      offboarded: fresh.disabled === true,
      accessConsistency,
    });
  }

  return {
    sale: fresh,
    accessConsistency,
    disposition: applied.disposition === "replayed" ? "replayed" : "executed",
    sessionsRevoked: toCount(applied.sessions_revoked),
    dependencies: toDependencyPreview(applied.dependencies),
  };
}
