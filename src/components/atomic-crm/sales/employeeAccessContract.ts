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

/**
 * W4 (User Lifecycle): whether the login identity and the employee profile
 * name the same address. Mirrors IdentityConsistency on the server. Not a
 * fifth access state — a second small fact the panel must never hide.
 */
export type IdentityConsistency = "consistent" | "inconsistent" | "unknown";

export type EmployeeAccessAction =
  | "resend_invitation"
  | "request_password_setup"
  | "disable_access"
  | "enable_access";

/**
 * W5: what still depends operationally on an employee. Mirrors
 * EmployeeDependencyPreview on the server. Current responsibility (the four
 * assignment tables) is separate from historical authorship (notes), which
 * never needs reassignment. Counts only.
 */
export type EmployeeDependencyPreview = {
  companies: number;
  contacts: number;
  openDeals: number;
  openTasks: number;
  contactNotes: number;
  dealNotes: number;
};

export const EMPTY_DEPENDENCY_PREVIEW: EmployeeDependencyPreview = {
  companies: 0,
  contacts: 0,
  openDeals: 0,
  openTasks: 0,
  contactNotes: 0,
  dealNotes: 0,
};

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
  /** W4: login email vs. employee profile email. */
  identityConsistency: IdentityConsistency;
  invitedAt: string | null;
  activatedAt: string | null;
  /** W5: present on single-employee reads and offboarding results only. */
  dependencies?: EmployeeDependencyPreview;
};

/** What the server returns after a verified offboarding (W5). */
export type EmployeeOffboardingResult = {
  record: EmployeeAccessRecord;
  /** executed = access ended / sessions revoked now; replayed = already done. */
  disposition: "executed" | "replayed";
  sessionsRevoked: number;
  dependencies: EmployeeDependencyPreview;
};

/** What the server returns after a verified login-email change (W4). */
export type EmployeeEmailChangeResult = {
  record: EmployeeAccessRecord;
  previousEmail: string;
  /** A fresh invitation went to the new address (invited employees only). */
  invitationSent: boolean;
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

/* ---------------------------------------------------------------------- */
/* W4 — "E-Mail-Adresse ändern"                                             */
/* ---------------------------------------------------------------------- */

export const EMPLOYEE_EMAIL_CHANGE_ACTION_LABEL = "E-Mail-Adresse ändern";

/**
 * What the change does for the employee's current state, in product words.
 * Wording follows the behaviour proven against the real login provider:
 * links already mailed to the old address stop working; an invited employee
 * gets a fresh invitation; a disabled employee gets nothing and stays out.
 */
export const EMPLOYEE_EMAIL_CHANGE_CONSEQUENCE: Partial<
  Record<EmployeeAccessState, string>
> = {
  active:
    "Die neue Adresse wird künftig für den Nora-Zugang verwendet. Bereits versendete Links zum Einrichten des Passworts werden ungültig.",
  invited:
    "Die bisherige Einladung wird ungültig. Eine neue Einladung wird an die neue Adresse gesendet.",
  disabled:
    "Der Nora-Zugang bleibt deaktiviert. Es wird keine Einladung versendet.",
};

export const EMPLOYEE_EMAIL_CHANGE_UNCHANGED_HINT =
  "Die neue Adresse entspricht der aktuellen Anmeldeadresse.";

export const EMPLOYEE_IDENTITY_INCONSISTENT_NOTICE =
  "Die Anmeldeadresse stimmt nicht mit dem Benutzerprofil überein. Die E-Mail-Adresse kann hier nicht geändert werden. Bitte an die technische Betreuung wenden.";

/** Provider-equivalent comparison: trimmed, case-insensitive. */
export function isSameLoginEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * The change is offered for every resolvable state — active, invited and
 * disabled alike (a disabled employee's address may need correcting) — but
 * never for an unresolvable identity or one whose two stores disagree; the
 * server refuses those anyway.
 */
export function isEmailChangeApplicable(
  record: Pick<EmployeeAccessRecord, "accessState" | "identityConsistency">,
): boolean {
  return (
    record.accessState !== "unknown" &&
    record.identityConsistency !== "inconsistent"
  );
}

/** Success copy — spoken only after the server verified both stores. */
export function describeEmployeeEmailChangeSuccess(
  result: EmployeeEmailChangeResult,
): string {
  const next = result.record.email;
  switch (result.record.accessState) {
    case "disabled":
      return `Anmeldeadresse geändert auf ${next}. Der Nora-Zugang bleibt deaktiviert.`;
    case "invited":
      return result.invitationSent
        ? `Anmeldeadresse geändert. Eine neue Einladung wurde an ${next} gesendet.`
        : `Anmeldeadresse geändert auf ${next}.`;
    default:
      return `Anmeldeadresse geändert auf ${next}. Die neue Adresse wird künftig für den Nora-Zugang verwendet.`;
  }
}

/* ---------------------------------------------------------------------- */
/* W5 — "Zugang beenden"                                                    */
/* ---------------------------------------------------------------------- */

export const EMPLOYEE_OFFBOARDING_ACTION_LABEL = "Zugang beenden";

export const EMPLOYEE_OFFBOARDING_DESCRIPTION =
  "Der Nora-Zugang dieser Person wird sofort beendet. Sie kann sich nicht mehr anmelden, laufende Anmeldungen werden abgemeldet. Kunden, Kontakte, Vorgänge, Aufgaben und Notizen bleiben mit ihrem Namen erhalten. Der Zugang kann später wieder aktiviert werden.";

export const EMPLOYEE_OFFBOARDING_NO_MAIL_HINT =
  "Es wird keine E-Mail versendet.";

/**
 * Offered for every employee who currently has (or is about to get) access.
 * A disabled employee is already out; the server would replay anyway, but
 * the action would only confuse next to "Zugang deaktiviert".
 */
export function isOffboardingApplicable(
  record: Pick<EmployeeAccessRecord, "accessState">,
): boolean {
  return record.accessState === "invited" || record.accessState === "active";
}

/** Title of the durable section on the employee record (W5). */
export const EMPLOYEE_OPEN_RESPONSIBILITIES_TITLE = "Offene Zuständigkeiten";

/** Zero state of that section — the section stays, so it is clear Nora checked. */
export const EMPLOYEE_NO_OPEN_RESPONSIBILITIES =
  "Keine offenen Zuständigkeiten.";

/** What still needs a new owner — current responsibility only, never notes. */
export function countOpenResponsibilities(
  deps: EmployeeDependencyPreview,
): number {
  return deps.companies + deps.contacts + deps.openDeals + deps.openTasks;
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** "3 Vorgänge und 5 offene Aufgaben" — only the non-zero parts, in product words. */
export function describeOpenResponsibilities(
  deps: EmployeeDependencyPreview,
): string {
  const parts: string[] = [];
  if (deps.companies > 0) parts.push(plural(deps.companies, "Kunde", "Kunden"));
  if (deps.contacts > 0)
    parts.push(plural(deps.contacts, "Kontakt", "Kontakte"));
  if (deps.openDeals > 0)
    parts.push(plural(deps.openDeals, "Vorgang", "Vorgänge"));
  if (deps.openTasks > 0)
    parts.push(
      `${deps.openTasks} offene ${deps.openTasks === 1 ? "Aufgabe" : "Aufgaben"}`,
    );
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} und ${parts[parts.length - 1]}`;
}

/**
 * The follow-up sentence shown before and after offboarding. Assignments
 * never block the action; they are named so they can be reassigned next.
 */
export function describeOffboardingFollowUp(
  deps: EmployeeDependencyPreview,
): string {
  const open = countOpenResponsibilities(deps);
  if (open === 0) {
    return "Es bestehen keine Kunden, Kontakte, Vorgänge oder offenen Aufgaben, die neu zugewiesen werden müssten.";
  }
  return `Es ${open === 1 ? "besteht" : "bestehen"} noch ${describeOpenResponsibilities(deps)}, die anschließend neu zugewiesen werden sollten.`;
}

/** Success copy — spoken only after the server verified the access state. */
export function describeEmployeeOffboardingSuccess(
  result: EmployeeOffboardingResult,
): string {
  const lead =
    result.disposition === "replayed"
      ? "Der Nora-Zugang war bereits beendet."
      : "Der Nora-Zugang wurde beendet.";
  const open = countOpenResponsibilities(result.dependencies);
  if (open === 0) return `${lead} Es sind keine Zuweisungen offen.`;
  return `${lead} ${describeOffboardingFollowUp(result.dependencies)}`;
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
    // W4 — login email
    case "invalid_email":
      return "Bitte eine gültige E-Mail-Adresse eingeben.";
    case "email_unchanged":
      return "Die neue Adresse entspricht bereits der aktuellen Anmeldeadresse.";
    case "email_already_in_use":
      return "Diese E-Mail-Adresse gehört bereits zu einem anderen Benutzer.";
    case "self_email_change_forbidden":
      return "Die eigene Anmeldeadresse können Sie hier nicht ändern. Bitte einen anderen Administrator darum bitten.";
    case "employee_auth_not_found":
    case "employee_identity_inconsistent":
      return "Der Nora-Zugang dieses Benutzers lässt sich nicht eindeutig zuordnen. Bitte an die technische Betreuung wenden.";
    case "email_change_provider_failed":
      return "Die Anmeldeadresse konnte nicht geändert werden. Es wurde nichts verändert. Bitte versuchen Sie es erneut.";
    case "email_change_sync_failed":
      return "Die Änderung konnte nicht vollständig bestätigt werden. Bitte laden Sie die Seite neu und prüfen Sie die Anmeldeadresse.";
    case "email_change_invitation_failed":
      return "Die Anmeldeadresse wurde geändert, aber die neue Einladung konnte nicht gesendet werden. Bitte „Einladung erneut senden“ verwenden.";
    case "email_change_requires_command":
      return "Die E-Mail-Adresse wird über „E-Mail-Adresse ändern“ im Bereich Nora-Zugang geändert.";
    case "audit_write_failed":
      return "Die Aktion wurde ausgeführt, konnte aber nicht protokolliert werden. Bitte an die technische Betreuung wenden.";
    default:
      return "Die Aktion konnte nicht ausgeführt werden. Bitte versuchen Sie es erneut.";
  }
}
