/**
 * Employee Access State Contract (Nora Employee Onboarding & Access V1A).
 *
 * Pure, unit-testable derivation of the product-facing Nora-Zugang state from
 * the two authoritative sources we already have — no redundant status column
 * in public.sales:
 *
 *   1. Supabase Auth (auth.users, read via the Admin API in the Edge Function)
 *   2. public.sales.disabled (Nora's own access flag, enforced in checkAuth/RLS)
 *
 * Deliberately NOT derived from last_sign_in_at: an employee who activated the
 * invitation and set a password but has not signed in since is ACTIVE, and an
 * employee whose session simply expired is not "invited". Confirmation of the
 * email address is the fact that separates "has been through the invitation
 * link" from "has not".
 */

export type EmployeeAccessState = "invited" | "active" | "disabled" | "unknown";

/**
 * Admin-side product actions. Which of these is offered is derived from the
 * state — never inferred in the UI from raw Auth fields.
 */
export type EmployeeAccessAction =
  | "resend_invitation"
  | "request_password_setup"
  | "disable_access"
  | "enable_access";

/** The only Auth facts this contract reads. Nothing else leaves the server. */
export type EmployeeAuthFacts = {
  banned_until?: string | null;
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
  invited_at?: string | null;
  /** W4: the Auth login email, compared against sales.email (never returned raw). */
  email?: string | null;
};

export type EmployeeSaleFacts = {
  id: number;
  email: string;
  disabled?: boolean | null;
};

/**
 * W1: whether the two authoritative access facts agree.
 *
 *   consistent    sales.disabled and the Auth ban say the same thing
 *   inconsistent  one side says "disabled", the other does not — Nora must
 *                 not treat this as a healthy state (either direction)
 *   unknown       the Auth side could not be read; nothing is claimed
 *
 * Deliberately not a fifth access state: accessState keeps its four values,
 * and "disabled" still wins whenever either side says so.
 */
export type AccessConsistency = "consistent" | "inconsistent" | "unknown";

/**
 * W4: whether the login identity (auth.users.email) and Nora's employee
 * profile (sales.email) name the same address. "inconsistent" is a state the
 * email-change command refuses to build on; it is surfaced, never repaired
 * silently.
 */
export type IdentityConsistency = "consistent" | "inconsistent" | "unknown";

/**
 * W5: what still depends operationally on an employee. Current
 * responsibility (the four assignment tables) is separated from historical
 * authorship (notes), which never needs reassignment. Counts only.
 */
export type EmployeeDependencyPreview = {
  companies: number;
  contacts: number;
  openDeals: number;
  openTasks: number;
  contactNotes: number;
  dealNotes: number;
};

/** The complete public response shape — no provider metadata, no tokens. */
export type EmployeeAccessRecord = {
  employeeId: number;
  email: string;
  accessState: EmployeeAccessState;
  /** Product-facing "no access": sales.disabled OR an active Auth ban. */
  disabled: boolean;
  /** Nora's own access flag (sales.disabled) on its own — the value a re-sync re-applies. */
  noraDisabled: boolean;
  accessConsistency: AccessConsistency;
  /** W4: sales.email vs. the Auth login email (provider-equivalent normalisation). */
  identityConsistency: IdentityConsistency;
  /** auth.users.invited_at — present only for employees created via invitation. */
  invitedAt: string | null;
  /** Email confirmation timestamp — the moment the invitation was actually used. */
  activatedAt: string | null;
  /** W5: present on single-employee reads and offboarding results only. */
  dependencies?: EmployeeDependencyPreview;
};

/**
 * Supabase reports an unbanned user either as a null/absent banned_until or as
 * the literal string "none". A past timestamp means the ban has expired.
 */
export function hasActiveBan(
  bannedUntil: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!bannedUntil) return false;
  if (bannedUntil === "none") return false;
  const until = Date.parse(bannedUntil);
  if (Number.isNaN(until)) return false;
  return until > now.getTime();
}

/**
 * W4 normalisation contract, identical to nora_private.normalize_login_email
 * and to what GoTrue stores: trimmed and lower-cased. Format validation is
 * the database's job; this only makes two addresses comparable.
 */
export function normalizeLoginEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function deriveIdentityConsistency(
  sale: { email: string },
  auth: EmployeeAuthFacts | null | undefined,
): IdentityConsistency {
  if (!auth || auth.email === undefined) return "unknown";
  if (!auth.email) return "inconsistent";
  return normalizeLoginEmail(auth.email) === normalizeLoginEmail(sale.email)
    ? "consistent"
    : "inconsistent";
}

/** True once the invitation link (or Einmalcode) has actually been used. */
export function hasConfirmedEmail(auth: EmployeeAuthFacts): boolean {
  return Boolean(auth.email_confirmed_at ?? auth.confirmed_at);
}

/**
 * Derivation order matters: "disabled" wins over everything, because a
 * disabled employee must never be offered an invitation or a password link.
 *
 * A sales row without a resolvable Auth identity yields "unknown". That is a
 * deliberate fourth state rather than a guess: it is not disabled (nobody
 * disabled it) and it must NOT be treated as "invited", because re-inviting
 * would mint a second Auth identity for an existing employee. "unknown" offers
 * no action at all and is the safe terminal state for that inconsistency.
 */
export function deriveEmployeeAccessState(
  sale: EmployeeSaleFacts,
  auth: EmployeeAuthFacts | null | undefined,
  now: Date = new Date(),
): EmployeeAccessState {
  if (!auth) {
    return sale.disabled === true ? "disabled" : "unknown";
  }
  if (sale.disabled === true || hasActiveBan(auth.banned_until, now)) {
    return "disabled";
  }
  return hasConfirmedEmail(auth) ? "active" : "invited";
}

/**
 * Both mismatch directions are reported: "Nora disabled, Auth not banned"
 * (the identity can still refresh tokens although RLS denies data) and
 * "Nora enabled, Auth banned" (Nora would claim "Zugang aktiv" for someone
 * who cannot sign in). Without Auth facts nothing is claimed.
 */
export function deriveAccessConsistency(
  sale: { disabled?: boolean | null },
  auth: EmployeeAuthFacts | null | undefined,
  now: Date = new Date(),
): AccessConsistency {
  if (!auth) return "unknown";
  const noraDisabled = sale.disabled === true;
  const authBanned = hasActiveBan(auth.banned_until, now);
  return noraDisabled === authBanned ? "consistent" : "inconsistent";
}

export function buildEmployeeAccessRecord(
  sale: EmployeeSaleFacts,
  auth: EmployeeAuthFacts | null | undefined,
  now: Date = new Date(),
): EmployeeAccessRecord {
  return {
    employeeId: sale.id,
    email: sale.email,
    accessState: deriveEmployeeAccessState(sale, auth, now),
    disabled:
      sale.disabled === true || hasActiveBan(auth?.banned_until ?? null, now),
    noraDisabled: sale.disabled === true,
    accessConsistency: deriveAccessConsistency(sale, auth, now),
    identityConsistency: deriveIdentityConsistency(sale, auth),
    invitedAt: auth?.invited_at ?? null,
    activatedAt: auth?.email_confirmed_at ?? auth?.confirmed_at ?? null,
  };
}

/**
 * Single source of truth for "which admin action is appropriate right now".
 * The server enforces this too — the UI merely renders the same answer.
 */
export function allowedAdminActions(
  state: EmployeeAccessState,
): EmployeeAccessAction[] {
  switch (state) {
    case "invited":
      // Not activated yet — a fresh invitation is the meaningful action.
      return ["resend_invitation", "disable_access"];
    case "active":
      // Already has an identity — never pretend they need a first invitation.
      return ["request_password_setup", "disable_access"];
    case "disabled":
      return ["enable_access"];
    case "unknown":
      return [];
  }
}

export function isAdminActionAllowed(
  state: EmployeeAccessState,
  action: EmployeeAccessAction,
): boolean {
  return allowedAdminActions(state).includes(action);
}

/**
 * Narrow admin command parsing for POST /users. A body without an "action"
 * field is the legacy "create + invite a new employee" payload and is left
 * untouched — this wave adds commands, it does not reshape the existing one.
 */
export type EmployeeAccessCommand =
  | {
      kind: "resend_invitation" | "request_password_setup";
      salesId: number;
    }
  | {
      /** W4: "E-Mail-Adresse ändern" — the only way to move a login email. */
      kind: "change_email";
      salesId: number;
      /** Trimmed, otherwise as typed; the database normalises and validates. */
      newEmail: string;
    }
  | {
      /** W5: "Zugang beenden" — access off, sessions revoked, history kept. */
      kind: "offboard";
      salesId: number;
    };

export function parseEmployeeAccessCommand(
  body: Record<string, unknown>,
): EmployeeAccessCommand | null | { error: string } {
  const action = body.action;
  if (action === undefined || action === null) return null;

  if (
    action !== "resend_invitation" &&
    action !== "request_password_setup" &&
    action !== "change_email" &&
    action !== "offboard"
  ) {
    return { error: "unknown_action" };
  }

  const salesId = Number(body.sales_id);
  if (!Number.isFinite(salesId) || salesId <= 0) {
    return { error: "invalid_payload" };
  }

  if (action === "change_email") {
    const raw = body.new_email;
    const newEmail = typeof raw === "string" ? raw.trim() : "";
    if (!newEmail) {
      return { error: "invalid_payload" };
    }
    return { kind: "change_email", salesId, newEmail };
  }

  return { kind: action, salesId };
}
