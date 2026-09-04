/**
 * Employee lifecycle executor (Nora User Lifecycle W1).
 *
 * The ONE server-side path for every employee access mutation the admin UI
 * can request: role change, disable, re-enable, and "invited as disabled".
 * Every branch of the users Edge Function that touches role/disabled goes
 * through executeAccessChange(); nothing else in Nora writes those facts.
 *
 * Step order, chosen so a partial failure fails towards "access denied":
 *
 *   1. DATABASE  set_sales_access_by_executor(actor, ...) — evaluates the
 *                actor, the self guard and the last-admin invariant BEFORE
 *                anything else changes. A refused request has touched
 *                nothing, in particular not the Auth identity.
 *   2. AUTH      only when the request carried `disabled`: ban / unban the
 *                Supabase Auth identity so it matches sales.disabled.
 *   3. VERIFY    re-read both facts and derive accessConsistency. Only a
 *                verified "consistent" pair is reported as success.
 *
 * Failure after step 1 (Auth call fails or verification disagrees) leaves
 * sales.disabled already applied, which RLS enforces immediately; the
 * identity may still refresh tokens until the retry. The caller receives
 * `employee_access_sync_incomplete`, never a green result. Retrying the same
 * request is safe: step 1 re-applies identical values (no audit duplicate —
 * the audit trigger fires on change only) and step 2 converges the Auth side.
 *
 * There is no distributed transaction here on purpose: GoTrue and PostgREST
 * do not share one, and pretending otherwise would only hide the partial
 * state this contract makes visible instead.
 */

import {
  deriveAccessConsistency,
  type AccessConsistency,
  type EmployeeAuthFacts,
} from "./accessState.ts";
import type { NoraRole } from "./patchHelpers.ts";

export type LifecycleSaleRow = {
  id: number;
  user_id: string;
  role: NoraRole;
  disabled: boolean;
};

/** Stable machine-readable failure contract of the executor. */
export type LifecycleErrorCode =
  | "invalid_payload"
  | "invalid_role"
  | "not_found"
  | "role_update_forbidden"
  | "self_access_change_forbidden"
  | "last_active_admin_required"
  | "employee_access_sync_incomplete"
  | "internal_error";

export type LifecycleFailureDetails = {
  status: number;
  error: LifecycleErrorCode;
  message: string;
  accessConsistency?: AccessConsistency;
};

export class LifecycleFailure extends Error {
  constructor(public readonly failure: LifecycleFailureDetails) {
    super(failure.error);
    this.name = "LifecycleFailure";
  }
}

/** Ports the executor needs — real adapters live in index.ts, fakes in tests. */
export type LifecycleDeps = {
  /** Calls set_sales_access_by_executor; rejects with a PostgrestError-like object. */
  applyAccessChange(input: {
    actorUserId: string;
    salesId: number;
    role: NoraRole | null;
    disabled: boolean | null;
  }): Promise<LifecycleSaleRow>;
  /** Bans (true) or unbans (false) the Auth identity; rejects on failure. */
  setAuthBan(userId: string, banned: boolean): Promise<void>;
  readSale(salesId: number): Promise<LifecycleSaleRow | null>;
  readAuthFacts(userId: string): Promise<EmployeeAuthFacts | null>;
  /** Structured, content-free diagnostics. Never user data, never tokens. */
  log(entry: Record<string, unknown>): void;
};

export type AccessChangeRequest = {
  /** The caller's user id, resolved from the verified JWT — never from the body. */
  actorUserId: string;
  target: LifecycleSaleRow;
  /** undefined = keep current value. */
  role?: NoraRole;
  /** undefined = keep current value. */
  disabled?: boolean;
};

export type AccessChangeResult = {
  sale: LifecycleSaleRow;
  accessConsistency: AccessConsistency;
};

const NORA_DETAIL = {
  SELF: "NORA_SELF_ACCESS_CHANGE_FORBIDDEN",
  LAST_ADMIN: "NORA_LAST_ACTIVE_ADMIN_REQUIRED",
  PERMISSION: "NORA_PERMISSION_DENIED",
} as const;

/**
 * Maps a failure of the executor RPC to the stable Edge error contract. The
 * canonical Nora code travels in DETAIL (`details` on a PostgrestError);
 * SQLSTATE and message text are only fallbacks for pre-contract errors.
 */
export function mapAccessRpcError(error: {
  code?: string;
  message?: string;
  details?: string | null;
}): LifecycleFailureDetails {
  const details = error.details ?? "";
  const code = error.code ?? "";
  const message = error.message ?? "";

  if (details === NORA_DETAIL.SELF) {
    return {
      status: 403,
      error: "self_access_change_forbidden",
      message: "Administrators cannot change their own role or access",
    };
  }
  if (details === NORA_DETAIL.LAST_ADMIN) {
    return {
      status: 409,
      error: "last_active_admin_required",
      message: "At least one active administrator must remain",
    };
  }
  if (
    details === NORA_DETAIL.PERMISSION ||
    code === "42501" ||
    /forbidden/i.test(message)
  ) {
    return {
      status: 403,
      error: "role_update_forbidden",
      message: "Not authorized to change user roles",
    };
  }
  if (code === "22023" || /invalid role/i.test(message)) {
    return { status: 400, error: "invalid_role", message: "Invalid role" };
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

function isActor(request: AccessChangeRequest): boolean {
  return request.target.user_id === request.actorUserId;
}

/**
 * Executes one access change through the single privileged path.
 * Throws LifecycleFailure; never resolves with an unverified state.
 */
export async function executeAccessChange(
  deps: LifecycleDeps,
  request: AccessChangeRequest,
): Promise<AccessChangeResult> {
  const wantsRole = request.role !== undefined;
  const wantsDisabled = request.disabled !== undefined;

  if (!wantsRole && !wantsDisabled) {
    throw new LifecycleFailure({
      status: 400,
      error: "invalid_payload",
      message: "Invalid request",
    });
  }

  // Edge-level self guard: strict. A request that targets the caller and
  // carries role/disabled at all is refused before any write. The database
  // repeats this check on actual change, so a forged body cannot get past it.
  if (isActor(request)) {
    throw new LifecycleFailure({
      status: 403,
      error: "self_access_change_forbidden",
      message: "Administrators cannot change their own role or access",
    });
  }

  // Step 1 — database: guards are evaluated here, before Auth is touched.
  let applied: LifecycleSaleRow;
  try {
    applied = await deps.applyAccessChange({
      actorUserId: request.actorUserId,
      salesId: request.target.id,
      role: wantsRole ? request.role! : null,
      disabled: wantsDisabled ? request.disabled! : null,
    });
  } catch (error) {
    const failure = mapAccessRpcError(
      (error ?? {}) as { code?: string; message?: string; details?: string },
    );
    deps.log({
      operation: "employee_access_change",
      stage: "db",
      error: failure.error,
      sqlstate: (error as { code?: string })?.code ?? null,
    });
    throw new LifecycleFailure(failure);
  }

  // Step 2 — Auth: only a disabled change moves the ban. Role changes never
  // call Auth Admin.
  let authSynced = true;
  if (wantsDisabled) {
    try {
      await deps.setAuthBan(applied.user_id, applied.disabled);
    } catch {
      authSynced = false;
      deps.log({
        operation: "employee_access_change",
        stage: "auth_admin",
        error: "auth_update_failed",
        sales_id: applied.id,
      });
    }
  }

  // Step 3 — verify both facts before reporting success.
  const fresh = (await deps.readSale(applied.id)) ?? applied;
  const facts = await deps.readAuthFacts(fresh.user_id);
  const accessConsistency = deriveAccessConsistency(fresh, facts);

  if (wantsDisabled && (!authSynced || accessConsistency !== "consistent")) {
    deps.log({
      operation: "employee_access_change",
      stage: "verify",
      error: "employee_access_sync_incomplete",
      sales_id: fresh.id,
      access_consistency: accessConsistency,
    });
    throw new LifecycleFailure({
      status: 500,
      error: "employee_access_sync_incomplete",
      message: "Access change not fully synchronized",
      accessConsistency,
    });
  }

  return { sale: fresh, accessConsistency };
}
