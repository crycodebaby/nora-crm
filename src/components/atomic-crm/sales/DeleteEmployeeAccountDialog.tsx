/**
 * "Benutzerkonto endgültig löschen" (User Lifecycle W6-B).
 *
 * The one place in the UI that irreversibly removes an employee account. It
 * calls only the DeleteEmployeeAccount Application Command; no provider or
 * Auth orchestration lives here. The dialog names the target prominently
 * (full name in the title, login email, role, access state), shows the
 * all-time business-history counts the server evaluated, requires the full
 * name to be typed and — for administrator targets — an extra checkbox, and
 * says in product words what happens and what does not (the change log
 * stays). The server re-checks everything, including the typed name against
 * the current identity; the button state here is convenience, not authority.
 * Success is reported only after the server verified both identity stores.
 */
import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useDataProvider, useNotify, type Identifier } from "ra-core";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { CrmDataProvider } from "../providers/types";
import { deleteEmployeeAccount } from "../application/commands/employeeAccess";
import {
  describeEmployeeAccountDeletionSuccess,
  EMPLOYEE_ACCOUNT_DELETION_ACTION_LABEL,
  EMPLOYEE_ACCOUNT_DELETION_ADMIN_CONFIRMATION_LABEL,
  EMPLOYEE_ACCOUNT_DELETION_DESCRIPTION,
  EMPLOYEE_ROLE_LABEL,
  isDeletionConfirmationComplete,
  mapEmployeeAccessError,
  type EmployeeAccessRecord,
  type EmployeeAccountDeletionResult,
  type EmployeeDeletionPreview,
} from "./employeeAccessContract";
import { EmployeeAccessStatus } from "./EmployeeAccessStatus";
import { EmployeeBusinessHistoryCounts } from "./EmployeeAccountDeletionSection";

type DeleteEmployeeAccountDialogProps = {
  salesId: Identifier;
  record: EmployeeAccessRecord;
  deletion: EmployeeDeletionPreview;
  /** Current full name of the employee (title and typed confirmation). */
  employeeName: string;
  /** Called after a verified deletion so the caller can leave the record. */
  onDeleted: (result: EmployeeAccountDeletionResult) => void;
  /** Called after a refusal so the caller can refresh the facts. */
  onRefused?: () => void;
};

export function DeleteEmployeeAccountDialog({
  salesId,
  record,
  deletion,
  employeeName,
  onDeleted,
  onRefused,
}: DeleteEmployeeAccountDialogProps) {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const inputId = useId();
  const checkboxId = useId();
  const [open, setOpen] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [adminConfirmed, setAdminConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdminTarget = deletion.role === "admin";
  const complete = isDeletionConfirmationComplete({
    typedName,
    expectedName: employeeName,
    targetRole: deletion.role,
    adminTargetConfirmed: adminConfirmed,
  });

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      deleteEmployeeAccount(dataProvider, {
        salesId,
        confirmationName: typedName,
        adminTargetConfirmed: adminConfirmed,
        currentState: record.accessState,
        deletion,
      }),
    onSuccess: (result) => {
      const message = describeEmployeeAccountDeletionSuccess(
        result,
        employeeName,
      );
      notify(message, { type: "success", messageArgs: { _: message } });
      setOpen(false);
      setError(null);
      onDeleted(result);
    },
    onError: (err) => {
      setError(mapEmployeeAccessError(err));
      onRefused?.();
    },
  });

  const reset = () => {
    setTypedName("");
    setAdminConfirmed(false);
    setError(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (isPending) return;
    setOpen(next);
    if (!next) reset();
  };

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        className="nora-touch-target"
        onClick={() => setOpen(true)}
        data-testid="employee-account-deletion-trigger"
      >
        {EMPLOYEE_ACCOUNT_DELETION_ACTION_LABEL}
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!isPending && complete) mutate();
            }}
            className="space-y-5"
            data-testid="employee-account-deletion-form"
          >
            <DialogHeader>
              <DialogTitle data-testid="employee-account-deletion-name">
                {employeeName}
              </DialogTitle>
              <DialogDescription>
                {EMPLOYEE_ACCOUNT_DELETION_ACTION_LABEL}
              </DialogDescription>
            </DialogHeader>

            <dl className="grid gap-2 text-sm">
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted-foreground">Anmeldeadresse</dt>
                <dd
                  className="font-medium text-foreground break-all"
                  data-testid="employee-account-deletion-email"
                >
                  {record.email}
                </dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted-foreground">Rolle</dt>
                <dd
                  className="font-medium text-foreground"
                  data-testid="employee-account-deletion-role"
                >
                  {EMPLOYEE_ROLE_LABEL[deletion.role]}
                </dd>
              </div>
              <div className="flex flex-wrap items-center gap-x-2">
                <dt className="text-muted-foreground">Nora-Zugang</dt>
                <dd>
                  <EmployeeAccessStatus state={record.accessState} />
                </dd>
              </div>
            </dl>

            <div className="space-y-2 rounded-md border border-border p-3">
              <p className="text-sm font-medium text-foreground">
                Geschäftshistorie in Nora
              </p>
              <EmployeeBusinessHistoryCounts
                history={deletion.businessHistory}
                data-testid="employee-account-deletion-history"
              />
              <p className="text-sm text-muted-foreground">
                Alle Werte sind null. Nur deshalb kann dieses Konto gelöscht
                werden.
              </p>
            </div>

            <div
              className="space-y-2 rounded-md border border-destructive/50 bg-destructive/5 p-3"
              role="note"
            >
              <p
                className="text-sm font-medium text-destructive"
                data-testid="employee-account-deletion-consequence"
              >
                {EMPLOYEE_ACCOUNT_DELETION_DESCRIPTION}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor={inputId} className="text-sm">
                Zur Bestätigung den vollständigen Namen eingeben:{" "}
                <span className="font-semibold">{employeeName}</span>
              </Label>
              <Input
                id={inputId}
                value={typedName}
                onChange={(event) => setTypedName(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                disabled={isPending}
                data-testid="employee-account-deletion-confirmation"
              />
            </div>

            {isAdminTarget ? (
              <div className="flex items-start gap-2">
                <Checkbox
                  id={checkboxId}
                  checked={adminConfirmed}
                  onCheckedChange={(value) => setAdminConfirmed(value === true)}
                  disabled={isPending}
                  data-testid="employee-account-deletion-admin-confirmation"
                />
                <Label htmlFor={checkboxId} className="text-sm leading-snug">
                  {EMPLOYEE_ACCOUNT_DELETION_ADMIN_CONFIRMATION_LABEL}
                </Label>
              </div>
            ) : null}

            {error ? (
              <p
                className="text-sm text-destructive"
                role="alert"
                data-testid="employee-account-deletion-error"
              >
                {error}
              </p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isPending}
              >
                Abbrechen
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={isPending || !complete}
                aria-busy={isPending || undefined}
                data-testid="employee-account-deletion-submit"
              >
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                Endgültig löschen
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
