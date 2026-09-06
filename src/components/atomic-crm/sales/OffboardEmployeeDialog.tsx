/**
 * "Zugang beenden" (User Lifecycle W5).
 *
 * The one place in the UI that ends an employee's operational access. It
 * calls only the OffboardEmployee Application Command; no provider or Auth
 * orchestration lives here. Before confirmation the dialog says, in product
 * words, what happens (access ends now, history stays) and what still depends
 * on this person (counts from the server). Open assignments never block the
 * action — security beats administrative tidiness — they are named so they
 * can be reassigned next. Success is reported only after the server verified
 * the access state.
 */
import { useState } from "react";
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

import type { CrmDataProvider } from "../providers/types";
import { offboardEmployee } from "../application/commands/employeeAccess";
import {
  countOpenResponsibilities,
  describeEmployeeOffboardingSuccess,
  describeOffboardingFollowUp,
  EMPLOYEE_OFFBOARDING_ACTION_LABEL,
  EMPLOYEE_OFFBOARDING_DESCRIPTION,
  EMPLOYEE_OFFBOARDING_NO_MAIL_HINT,
  EMPTY_DEPENDENCY_PREVIEW,
  mapEmployeeAccessError,
  type EmployeeAccessRecord,
  type EmployeeDependencyPreview,
  type EmployeeOffboardingResult,
} from "./employeeAccessContract";
import { EmployeeAccessStatus } from "./EmployeeAccessStatus";

type OffboardEmployeeDialogProps = {
  salesId: Identifier;
  record: EmployeeAccessRecord;
  /** Called after the server answered (green or not) so the caller can refresh. */
  onChanged?: (result?: EmployeeOffboardingResult) => void;
};

/** One line per count, current responsibility first, notes as history. */
export function DependencyPreviewList({
  dependencies,
}: {
  dependencies: EmployeeDependencyPreview;
}) {
  const rows: Array<[string, number]> = [
    ["Kunden", dependencies.companies],
    ["Kontakte", dependencies.contacts],
    ["Vorgänge", dependencies.openDeals],
    ["Offene Aufgaben", dependencies.openTasks],
  ];
  const notes = dependencies.contactNotes + dependencies.dealNotes;
  return (
    <dl
      className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm"
      data-testid="employee-offboarding-dependencies"
    >
      {rows.map(([label, count]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="font-medium tabular-nums">{count}</dd>
        </div>
      ))}
      <div className="contents">
        <dt className="text-muted-foreground">Notizen (bleiben erhalten)</dt>
        <dd className="font-medium tabular-nums">{notes}</dd>
      </div>
    </dl>
  );
}

export function OffboardEmployeeDialog({
  salesId,
  record,
  onChanged,
}: OffboardEmployeeDialogProps) {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dependencies = record.dependencies ?? EMPTY_DEPENDENCY_PREVIEW;
  const hasPreview = record.dependencies !== undefined;
  const openCount = countOpenResponsibilities(dependencies);

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      offboardEmployee(dataProvider, {
        salesId,
        currentState: record.accessState,
      }),
    onSuccess: (result) => {
      const message = describeEmployeeOffboardingSuccess(result);
      notify(message, { type: "success", messageArgs: { _: message } });
      setOpen(false);
      setError(null);
      onChanged?.(result);
    },
    onError: (err) => {
      setError(mapEmployeeAccessError(err));
      // The server may have ended the access although it reports non-green
      // (ban not confirmed). Refresh so the administrator sees the real state.
      onChanged?.();
    },
  });

  const handleOpenChange = (next: boolean) => {
    if (isPending) return;
    setOpen(next);
    if (!next) setError(null);
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="nora-touch-target"
        onClick={() => setOpen(true)}
        data-testid="employee-offboarding-trigger"
      >
        {EMPLOYEE_OFFBOARDING_ACTION_LABEL}
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!isPending) mutate();
            }}
            className="space-y-5"
            data-testid="employee-offboarding-form"
          >
            <DialogHeader>
              <DialogTitle>{EMPLOYEE_OFFBOARDING_ACTION_LABEL}</DialogTitle>
              <DialogDescription>
                {EMPLOYEE_OFFBOARDING_DESCRIPTION}
              </DialogDescription>
            </DialogHeader>

            <dl className="grid gap-2 text-sm">
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted-foreground">Anmeldeadresse</dt>
                <dd
                  className="font-medium text-foreground break-all"
                  data-testid="employee-offboarding-email"
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

            <div className="space-y-2 rounded-md border border-border p-3">
              <p className="text-sm font-medium text-foreground">
                Was hängt noch an dieser Person?
              </p>
              {hasPreview ? (
                <>
                  <DependencyPreviewList dependencies={dependencies} />
                  <p
                    className="text-sm text-muted-foreground"
                    data-testid="employee-offboarding-followup"
                  >
                    {describeOffboardingFollowUp(dependencies)}
                    {openCount > 0
                      ? " Der Zugang wird trotzdem sofort beendet."
                      : null}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground" role="status">
                  Die Zuweisungen konnten nicht geladen werden. Der Zugang kann
                  trotzdem beendet werden; die Zuweisungen bleiben bestehen.
                </p>
              )}
            </div>

            <p className="text-sm text-muted-foreground">
              {EMPLOYEE_OFFBOARDING_NO_MAIL_HINT}
            </p>

            {error ? (
              <p
                className="text-sm text-destructive"
                role="alert"
                data-testid="employee-offboarding-error"
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
                disabled={isPending}
                aria-busy={isPending || undefined}
                data-testid="employee-offboarding-submit"
              >
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                Zugang jetzt beenden
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
