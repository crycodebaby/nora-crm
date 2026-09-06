/**
 * "E-Mail-Adresse ändern" (User Lifecycle W4).
 *
 * The one place in the UI that moves an employee's login email. It calls only
 * the ChangeEmployeeLoginEmail Application Command; no provider or Auth
 * orchestration lives here. The dialog names the current address, the access
 * state and — in product words — what the change does for that state, and
 * reports success only after the server verified that the login identity and
 * the employee profile carry the new address.
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { CrmDataProvider } from "../providers/types";
import { changeEmployeeLoginEmail } from "../application/commands/employeeAccess";
import {
  describeEmployeeEmailChangeSuccess,
  EMPLOYEE_EMAIL_CHANGE_ACTION_LABEL,
  EMPLOYEE_EMAIL_CHANGE_CONSEQUENCE,
  EMPLOYEE_EMAIL_CHANGE_UNCHANGED_HINT,
  isSameLoginEmail,
  mapEmployeeAccessError,
  type EmployeeAccessRecord,
} from "./employeeAccessContract";
import { EmployeeAccessStatus } from "./EmployeeAccessStatus";

type ChangeEmployeeEmailDialogProps = {
  salesId: Identifier;
  record: EmployeeAccessRecord;
  /** Called after a verified change so the caller can refresh what it shows. */
  onChanged?: () => void;
};

export function ChangeEmployeeEmailDialog({
  salesId,
  record,
  onChanged,
}: ChangeEmployeeEmailDialogProps) {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const trimmed = newEmail.trim();
  const unchanged = trimmed !== "" && isSameLoginEmail(trimmed, record.email);
  const consequence = EMPLOYEE_EMAIL_CHANGE_CONSEQUENCE[record.accessState];

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      changeEmployeeLoginEmail(dataProvider, {
        salesId,
        newEmail: trimmed,
        currentState: record.accessState,
      }),
    onSuccess: (result) => {
      const message = describeEmployeeEmailChangeSuccess(result);
      notify(message, { type: "success", messageArgs: { _: message } });
      setOpen(false);
      setNewEmail("");
      setError(null);
      onChanged?.();
    },
    onError: (err) => {
      setError(mapEmployeeAccessError(err));
      // The server may have moved the identity although it reports non-green
      // (for example: the fresh invitation could not be sent). Refresh so the
      // administrator sees the real state, never a stale address.
      onChanged?.();
    },
  });

  const handleOpenChange = (next: boolean) => {
    if (isPending) return;
    setOpen(next);
    if (!next) {
      setNewEmail("");
      setError(null);
    }
  };

  const canSubmit = trimmed !== "" && !unchanged && !isPending;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="nora-touch-target"
        onClick={() => setOpen(true)}
        data-testid="employee-email-change-trigger"
      >
        {EMPLOYEE_EMAIL_CHANGE_ACTION_LABEL}
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (canSubmit) mutate();
            }}
            className="space-y-5"
            data-testid="employee-email-change-form"
          >
            <DialogHeader>
              <DialogTitle>{EMPLOYEE_EMAIL_CHANGE_ACTION_LABEL}</DialogTitle>
              <DialogDescription>
                Die E-Mail-Adresse ist die Anmeldeadresse für Nora. Sie wird für
                die Anmeldung, Einladungen und das Einrichten des Passworts
                verwendet.
              </DialogDescription>
            </DialogHeader>

            <dl className="grid gap-2 text-sm">
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted-foreground">
                  Aktuelle Anmeldeadresse
                </dt>
                <dd
                  className="font-medium text-foreground break-all"
                  data-testid="employee-email-change-current"
                >
                  {record.email}
                </dd>
              </div>
              <div className="flex flex-wrap items-center gap-x-2">
                <dt className="text-muted-foreground">Nora-Zugang</dt>
                <dd>
                  <EmployeeAccessStatus state={record.accessState} />
                </dd>
              </div>
            </dl>

            {consequence ? (
              <p
                className="text-sm text-foreground"
                data-testid="employee-email-change-consequence"
              >
                {consequence}
              </p>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor={inputId}>Neue Anmeldeadresse</Label>
              <Input
                id={inputId}
                type="email"
                autoComplete="off"
                inputMode="email"
                value={newEmail}
                onChange={(event) => {
                  setNewEmail(event.target.value);
                  if (error) setError(null);
                }}
                disabled={isPending}
                required
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={
                  error
                    ? `${inputId}-error`
                    : unchanged
                      ? `${inputId}-hint`
                      : undefined
                }
              />
              {unchanged ? (
                <p
                  id={`${inputId}-hint`}
                  className="text-sm text-muted-foreground"
                  role="status"
                >
                  {EMPLOYEE_EMAIL_CHANGE_UNCHANGED_HINT}
                </p>
              ) : null}
              {error ? (
                <p
                  id={`${inputId}-error`}
                  className="text-sm text-destructive"
                  role="alert"
                  data-testid="employee-email-change-error"
                >
                  {error}
                </p>
              ) : null}
            </div>

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
                disabled={!canSubmit}
                aria-busy={isPending || undefined}
                data-testid="employee-email-change-submit"
              >
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                Adresse ändern
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
