/**
 * Employee Access Contract — client side (Nora Employee Onboarding & Access V1A).
 *
 * The SERVER derives the access state (supabase/functions/users/accessState.ts).
 * This module only mirrors the resulting vocabulary so the UI can label it and
 * decide which admin action to offer. It deliberately contains no Auth logic:
 * the browser never sees auth.users, and the Edge Function re-checks every
 * action against the same rule — the UI is never the security boundary.
 *
 * W1 (User Lifecycle) adds the consistency fact: whether Nora's own flag and
 * the Auth side agree. It is not a fifth state — the four states stay as they
 * are — but a second, small typed fact the panel must never hide.
 */

/** Product-facing Nora-Zugang states. Mirrors EmployeeAccessState on the server. */
export const EMPLOYEE_ACCESS_STATES = [
  "invited",
  "active",
  "disabled",
  "unknown",
] as const;

export type EmployeeAccessState = (typeof EMPLOYEE_ACCESS_STATES)[number];

/** Mirrors AccessConsistency on the server. */
export type AccessConsistency = "consistent" | "inconsistent" | "unknown";

export type EmployeeAccessAction =
  | "resend_invitation"
  | "request_password_setup"
  | "disable_access"
  | "enable_access";

/** Exactly the fields the server returns — nothing here is provider metadata. */
export type EmployeeAccessRecord = {
  employeeId: number;
  email: string;
  accessState: EmployeeAccessState;
  /** Product-facing "no access": Nora flag OR an active Auth ban. */
  disabled: boolean;
  /** Nora's own flag on its own — the value a re-sync re-applies. */
  noraDisabled: boolean;
  accessConsistency: AccessConsistency;
  invitedAt: string | null;
  activatedAt: string | null;
};

export function isEmployeeAccessState(
  value: unknown,
): value is EmployeeAccessState {
  return EMPLOYEE_ACCESS_STATES.includes(value as EmployeeAccessState);
}

/**
 * Semantic status wording. These strings are product vocabulary, not decoration
 * — a later design wave may restyle them but must not change their meaning.
 */
export const EMPLOYEE_ACCESS_STATE_LABEL: Record<EmployeeAccessState, string> =
  {
    invited: "Einladung gesendet",
    active: "Zugang aktiv",
    disabled: "Zugang deaktiviert",
    unknown: "Zugang unklar",
  };

export const EMPLOYEE_ACCESS_STATE_DESCRIPTION: Record<
  EmployeeAccessState,
  string
> = {
  invited:
    "Diese Person hat ihren Nora-Zugang noch nicht eingerichtet. Sie kann sich noch nicht anmelden.",
  active:
    "Diese Person kann sich mit ihrer geschäftlichen E-Mail-Adresse und ihrem persönlichen Passwort anmelden.",
  disabled: "Diese Person hat aktuell keinen Zugang zu Nora.",
  unknown:
    "Zu diesem Benutzer lässt sich kein Zugang ermitteln. Bitte an die technische Betreuung wenden.",
};

/**
 * Supporting line for states that need one sentence more than their label.
 * "unknown" is visible on purpose and offers no action — the hint says why.
 */
export const EMPLOYEE_ACCESS_STATE_HINT: Partial<
  Record<EmployeeAccessState, string>
> = {
  unknown: "Technische Prüfung erforderlich",
};

export const EMPLOYEE_ACCESS_ACTION_LABEL: Record<
  EmployeeAccessAction,
  string
> = {
  resend_invitation: "Einladung erneut senden",
  request_password_setup: "Passwort einrichten lassen",
  disable_access: "Zugang deaktivieren",
  enable_access: "Zugang aktivieren",
};

/**
 * W1 consistency copy. Calm, names the fact, names the repair. Never mentions
 * the provider, tokens, bans or internal tables.
 */
export const EMPLOYEE_ACCESS_CONSISTENCY_NOTICE =
  "Der Zugangsstatus ist nicht vollständig synchron. Bitte den Zugangsstatus erneut anwenden.";

export const EMPLOYEE_ACCESS_RESYNC_ACTION_LABEL =
  "Zugangsstatus synchronisieren";

/** What a re-sync will re-apply, in product words. */
export function describeAccessResync(record: EmployeeAccessRecord): string {
  return record.noraDisabled
    ? "Nora wendet „Zugang deaktiviert“ erneut vollständig an."
    : "Nora wendet „Zugang aktiv“ erneut vollständig an.";
}

/** The repair is offered exactly when the server says the two facts disagree. */
export function isAccessResyncApplicable(
  record: Pick<EmployeeAccessRecord, "accessConsistency">,
): boolean {
  return record.accessConsistency === "inconsistent";
}

/**
 * Which action is appropriate for a state. Mirrors allowedAdminActions() on the
 * server, which remains authoritative — this only keeps the UI from offering an
 * action the server would reject anyway.
 */
export function allowedAdminActions(
  state: EmployeeAccessState,
): EmployeeAccessAction[] {
  switch (state) {
    case "invited":
      return ["resend_invitation", "disable_access"];
    case "active":
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

/** Calm German copy for the failure modes the access commands can return. */
export function mapEmployeeAccessError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : String(error ?? "").trim();

  switch (message) {
    case "access_action_forbidden":
    case "access_status_forbidden":
    case "role_update_forbidden":
      return "Sie sind nicht berechtigt, den Nora-Zugang zu verwalten.";
    case "self_access_change_forbidden":
      return "Den eigenen Nora-Zugang und die eigene Rolle können Sie hier nicht ändern.";
    case "last_active_admin_required":
      return "Mindestens ein aktiver Administrator muss erhalten bleiben.";
    case "employee_access_sync_incomplete":
      return "Der Zugangsstatus konnte nicht vollständig angewendet werden. Bitte „Zugangsstatus synchronisieren“ erneut ausführen.";
    case "action_not_applicable":
      return "Diese Aktion passt nicht mehr zum aktuellen Zugangsstatus. Bitte laden Sie die Seite neu.";
    case "not_found":
      return "Dieser Benutzer wurde nicht gefunden.";
    case "invite_mail_failed":
      return "Die Einladung konnte nicht gesendet werden. Bitte versuchen Sie es erneut.";
    case "password_setup_mail_failed":
      return "Die E-Mail zum Einrichten des Passworts konnte nicht gesendet werden. Bitte versuchen Sie es erneut.";
    default:
      return "Die Aktion konnte nicht ausgeführt werden. Bitte versuchen Sie es erneut.";
  }
}
