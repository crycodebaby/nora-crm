import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDataProvider, useNotify, type Identifier } from "ra-core";
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
  isAccessResyncApplicable,
  isAdminActionAllowed,
  mapEmployeeAccessError,
  type EmployeeAccessRecord,
} from "./employeeAccessContract";
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
 */
export function EmployeeAccessPanel({ salesId }: { salesId: Identifier }) {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const queryClient = useQueryClient();
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
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-muted-foreground">Anmeldeadresse</dt>
            <dd className="font-medium text-foreground break-all">
              {record.email}
            </dd>
          </div>
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

      {/* The single write path for enabled/disabled is the form field below.
          The panel names it instead of offering a second control. */}
      {state === "disabled" ? (
        <p className="text-sm text-muted-foreground">
          Zum Aktivieren entfernen Sie unten den Haken bei „Zugang deaktiviert“
          und speichern.
        </p>
      ) : null}
      {state === "invited" || state === "active" ? (
        <p className="text-sm text-muted-foreground">
          Zum Deaktivieren setzen Sie unten den Haken bei „Zugang deaktiviert“
          und speichern.
        </p>
      ) : null}
      {state === "unknown" ? (
        <p className="text-sm text-muted-foreground">
          Für diesen Zustand gibt es keine Aktion in Nora. Bitte an die
          technische Betreuung wenden.
        </p>
      ) : null}
    </section>
  );
}
