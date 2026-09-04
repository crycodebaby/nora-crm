import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDataProvider, useNotify, type Identifier } from "ra-core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import type { CrmDataProvider } from "../providers/types";
import {
  requestEmployeePasswordSetup,
  resendEmployeeInvitation,
} from "../application/commands/employeeAccess";
import {
  EMPLOYEE_ACCESS_ACTION_LABEL,
  EMPLOYEE_ACCESS_STATE_DESCRIPTION,
  EMPLOYEE_ACCESS_STATE_LABEL,
  isAdminActionAllowed,
  mapEmployeeAccessError,
  type EmployeeAccessRecord,
} from "./employeeAccessContract";
import {
  EMPLOYEE_ACCESS_QUERY_KEY,
  useEmployeeAccessStatus,
} from "./useEmployeeAccessStatus";

/**
 * Nora-Zugang panel for one employee (V1A — functional, not the design wave).
 *
 * Shows the derived access state and offers exactly the action that fits it.
 * Enabling/disabling access stays the existing "Zugang deaktiviert" field in
 * the edit form — deliberately not duplicated here, so there is only one write
 * path for that fact.
 */
export function EmployeeAccessPanel({ salesId }: { salesId: Identifier }) {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const { data, isPending, isError } = useEmployeeAccessStatus(salesId);

  const record: EmployeeAccessRecord | undefined = data?.[0];

  const { mutate, isPending: isSubmitting } = useMutation({
    mutationFn: async (
      action: "resend_invitation" | "request_password_setup",
    ) => {
      if (!record) throw new Error("not_found");
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
          ? "Die Einladung wurde erneut gesendet."
          : "Die E-Mail zum Einrichten des Passworts wurde gesendet.";
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

  return (
    <section className="space-y-3" data-testid="employee-access-panel">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">Nora-Zugang</h3>
        <Badge variant="outline" data-testid="employee-access-state">
          {EMPLOYEE_ACCESS_STATE_LABEL[state]}
        </Badge>
      </div>

      <p className="text-sm text-muted-foreground">
        {EMPLOYEE_ACCESS_STATE_DESCRIPTION[state]}
      </p>

      <p className="text-sm text-muted-foreground">
        Anmeldeadresse:{" "}
        <span className="font-medium text-foreground">{record.email}</span>
      </p>

      <div className="flex flex-wrap gap-2">
        {isAdminActionAllowed(state, "resend_invitation") ? (
          <Button
            type="button"
            variant="outline"
            className="nora-touch-target"
            disabled={isSubmitting}
            onClick={() => mutate("resend_invitation")}
          >
            {EMPLOYEE_ACCESS_ACTION_LABEL.resend_invitation}
          </Button>
        ) : null}

        {isAdminActionAllowed(state, "request_password_setup") ? (
          <Button
            type="button"
            variant="outline"
            className="nora-touch-target"
            disabled={isSubmitting}
            onClick={() => mutate("request_password_setup")}
          >
            {EMPLOYEE_ACCESS_ACTION_LABEL.request_password_setup}
          </Button>
        ) : null}
      </div>

      {state === "disabled" ? (
        <p className="text-sm text-muted-foreground">
          Zum Aktivieren entfernen Sie unten den Haken bei „Zugang deaktiviert“
          und speichern.
        </p>
      ) : null}
    </section>
  );
}
