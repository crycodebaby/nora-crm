import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useDataProvider,
  useNotify,
  useRefresh,
  type Identifier,
} from "ra-core";
import { Button } from "@/components/ui/button";

import type { CrmDataProvider } from "../providers/types";
import {
  requestEmployeePasswordSetup,
  resendEmployeeInvitation,
  resyncEmployeeAccess,
} from "../application/commands/employeeAccess";
import {
  describeAccessResync,
  EMPLOYEE_ACCESS_ACTION_LABEL,
  EMPLOYEE_ACCESS_CONSISTENCY_NOTICE,
  EMPLOYEE_ACCESS_RESYNC_ACTION_LABEL,
  EMPLOYEE_ACCESS_STATE_DESCRIPTION,
  EMPLOYEE_IDENTITY_INCONSISTENT_NOTICE,
  isAccessResyncApplicable,
  isAdminActionAllowed,
  isEmailChangeApplicable,
  isOffboardingApplicable,
  mapEmployeeAccessError,
  type EmployeeAccessRecord,
} from "./employeeAccessContract";
import { ChangeEmployeeEmailDialog } from "./ChangeEmployeeEmailDialog";
import { OffboardEmployeeDialog } from "./OffboardEmployeeDialog";
import { EmployeeDependencySummary } from "./EmployeeDependencySummary";
import { EmployeeAccessStatus } from "./EmployeeAccessStatus";
import { EmployeeMailDeliveryStatus } from "./EmployeeMailDeliveryStatus";
import {
  EMPLOYEE_ACCESS_QUERY_KEY,
  useEmployeeAccessStatus,
} from "./useEmployeeAccessStatus";

const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function formatAccessDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : dateFormatter.format(date);
}

/** One date line, only where it adds clarity to the state it sits under. */
function accessDateLine(record: EmployeeAccessRecord): string | null {
  switch (record.accessState) {
    case "invited": {
      const invited = formatAccessDate(record.invitedAt);
      return invited ? `Eingeladen am ${invited}` : null;
    }
    case "active": {
      const activated = formatAccessDate(record.activatedAt);
      return activated ? `Zugang aktiv seit ${activated}` : null;
    }
    default:
      return null;
  }
}

type PanelAction = "resend_invitation" | "request_password_setup" | "resync";

/**
 * Nora-Zugang panel for one employee (V1A contract, V1B presentation).
 *
 * Header block: status pill, one sentence, the login address and — where it
 * helps — one date. Below it exactly the actions that fit the state.
 * Enabling/disabling access stays the existing "Zugang deaktiviert" field in
 * the edit form — deliberately not duplicated here, so there is only one write
 * path for that fact; the panel points the administrator to it instead.
 *
 * W1: if the server reports that Nora's flag and the Auth side disagree, the
 * panel says so and offers exactly one repair — re-applying Nora's own value
 * through the same PATCH the form uses. The form cannot resend an unchanged
 * value, which is why this one control exists.
 *
 * W5: "Offene Zuständigkeiten" is a durable part of the record — shown for
 * every access state, also at zero — so an administrator can return later and
 * see what is still assigned to this person. Access state and responsibility
 * state are separate facts; the offboarding dialog repeats the same counts
 * as a decision-time warning.
 */
export function EmployeeAccessPanel({ salesId }: { salesId: Identifier }) {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const refresh = useRefresh();
  const { data, isPending, isError } = useEmployeeAccessStatus(salesId);

  const record: EmployeeAccessRecord | undefined = data?.[0];

  const { mutate, isPending: isSubmitting } = useMutation({
    mutationFn: async (action: PanelAction) => {
      if (!record) throw new Error("not_found");
      if (action === "resync") {
        return resyncEmployeeAccess(dataProvider, {
          salesId,
          disabled: record.noraDisabled,
        });
      }
      const input = { salesId, currentState: record.accessState };
      return action === "resend_invitation"
        ? resendEmployeeInvitation(dataProvider, input)
        : requestEmployeePasswordSetup(dataProvider, input);
    },
    onSuccess: (_result, action) => {
      void queryClient.invalidateQueries({
        queryKey: EMPLOYEE_ACCESS_QUERY_KEY,
      });
      const message =
        action === "resend_invitation"
          ? record?.email
            ? `Einladung erneut gesendet an ${record.email}.`
            : "Die Einladung wurde erneut gesendet."
          : action === "resync"
            ? "Zugangsstatus synchronisiert."
            : "E-Mail zum Einrichten des Passworts gesendet.";
      notify(message, { type: "success", messageArgs: { _: message } });
    },
    onError: (error) => {
      void queryClient.invalidateQueries({
        queryKey: EMPLOYEE_ACCESS_QUERY_KEY,
      });
      const message = mapEmployeeAccessError(error);
      notify(message, { type: "error", messageArgs: { _: message } });
    },
  });

  if (isPending) {
    return (
      <section className="space-y-2" aria-busy="true">
        <h3 className="text-base font-semibold">Nora-Zugang</h3>
        <p className="text-sm text-muted-foreground">
          Zugangsstatus wird geladen…
        </p>
      </section>
    );
  }

  if (isError || !record) {
    return (
      <section className="space-y-2">
        <h3 className="text-base font-semibold">Nora-Zugang</h3>
        <p className="text-sm text-muted-foreground" role="status">
          Der Zugangsstatus konnte nicht geladen werden.
        </p>
      </section>
    );
  }

  const state = record.accessState;
  const dateLine = accessDateLine(record);
  const canResend = isAdminActionAllowed(state, "resend_invitation");
  const canRequestPassword = isAdminActionAllowed(
    state,
    "request_password_setup",
  );
  const needsResync = isAccessResyncApplicable(record);
  const canChangeEmail = isEmailChangeApplicable(record);
  const canOffboard = isOffboardingApplicable(record);
  const invalidateAndRefresh = () => {
    void queryClient.invalidateQueries({
      queryKey: EMPLOYEE_ACCESS_QUERY_KEY,
    });
    refresh();
  };
  const identityInconsistent = record.identityConsistency === "inconsistent";

  return (
    <section className="space-y-4" data-testid="employee-access-panel">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h3 className="text-base font-semibold">Nora-Zugang</h3>
          <EmployeeAccessStatus
            state={state}
            showHint
            data-testid="employee-access-state"
          />
        </div>

        <p className="text-sm text-muted-foreground">
          {EMPLOYEE_ACCESS_STATE_DESCRIPTION[state]}
        </p>

        <dl className="grid gap-1 text-sm">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
            <dt className="text-muted-foreground">Anmeldeadresse</dt>
            <dd
              className="font-medium text-foreground break-all"
              data-testid="employee-login-email"
            >
              {record.email}
            </dd>
            {/* W4: the one write path for the login email. Offered for every
                resolvable, consistent identity — the server decides again. */}
            {canChangeEmail ? (
              <dd>
                <ChangeEmployeeEmailDialog
                  salesId={salesId}
                  record={record}
                  onChanged={() => {
                    void queryClient.invalidateQueries({
                      queryKey: EMPLOYEE_ACCESS_QUERY_KEY,
                    });
                    refresh();
                  }}
                />
              </dd>
            ) : null}
          </div>
          {identityInconsistent ? (
            <div>
              <dd
                className="text-muted-foreground"
                role="status"
                data-testid="employee-identity-consistency"
              >
                {EMPLOYEE_IDENTITY_INCONSISTENT_NOTICE}
              </dd>
            </div>
          ) : null}
          {dateLine ? (
            <div>
              <dd className="text-muted-foreground">{dateLine}</dd>
            </div>
          ) : null}
        </dl>

        {/* Secondary, and placed after the access facts on purpose: what the
            administrator acts on is the access state above, not transport. */}
        <EmployeeMailDeliveryStatus salesId={salesId} />
      </div>

      {needsResync ? (
        <div
          className="space-y-2 rounded-md border border-border p-3"
          role="status"
          data-testid="employee-access-consistency"
        >
          <p className="text-sm font-medium text-foreground">
            {EMPLOYEE_ACCESS_CONSISTENCY_NOTICE}
          </p>
          <p className="text-sm text-muted-foreground">
            {describeAccessResync(record)}
          </p>
          <Button
            type="button"
            variant="outline"
            className="nora-touch-target"
            disabled={isSubmitting}
            aria-busy={isSubmitting || undefined}
            onClick={() => mutate("resync")}
          >
            {EMPLOYEE_ACCESS_RESYNC_ACTION_LABEL}
          </Button>
        </div>
      ) : null}

      {canResend || canRequestPassword ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {canResend ? (
            <Button
              type="button"
              variant="outline"
              className="nora-touch-target"
              disabled={isSubmitting}
              aria-busy={isSubmitting || undefined}
              onClick={() => mutate("resend_invitation")}
            >
              {EMPLOYEE_ACCESS_ACTION_LABEL.resend_invitation}
            </Button>
          ) : null}

          {canRequestPassword ? (
            <Button
              type="button"
              variant="outline"
              className="nora-touch-target"
              disabled={isSubmitting}
              aria-busy={isSubmitting || undefined}
              onClick={() => mutate("request_password_setup")}
            >
              {EMPLOYEE_ACCESS_ACTION_LABEL.request_password_setup}
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* W5: ending access is a distinct administrative action with its own
          confirmation and dependency preview — never a hidden side effect of
          "Speichern". Re-enabling stays the W1 form field below. */}
      {canOffboard ? (
        <div className="space-y-2" data-testid="employee-offboarding">
          <OffboardEmployeeDialog
            salesId={salesId}
            record={record}
            onChanged={invalidateAndRefresh}
          />
          <p className="text-sm text-muted-foreground">
            Beendet den Nora-Zugang sofort. Daten und Zuweisungen bleiben
            erhalten und können anschließend neu zugewiesen werden.
          </p>
        </div>
      ) : null}
      {state === "disabled" ? (
        <p className="text-sm text-muted-foreground">
          Zum Aktivieren entfernen Sie unten den Haken bei „Zugang deaktiviert“
          und speichern. Eine neue Anmeldung ist danach erforderlich.
        </p>
      ) : null}
      {state === "unknown" ? (
        <p className="text-sm text-muted-foreground">
          Für diesen Zustand gibt es keine Aktion in Nora. Bitte an die
          technische Betreuung wenden.
        </p>
      ) : null}

      {/* W5: durable overview, independent of the access state above. */}
      <EmployeeDependencySummary
        salesId={salesId}
        dependencies={record.dependencies}
      />
    </section>
  );
}
