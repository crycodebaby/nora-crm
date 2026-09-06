/**
 * "Benutzerkonto endgültig löschen" — the exceptional, destructive section of
 * the employee record (User Lifecycle W6-B).
 *
 * Deliberately separated from the ordinary access controls (invitation,
 * password link, email, role, enable/disable) and placed last: this is not a
 * routine action. It renders exactly one of
 *
 *   - the destructive control, only for a DISABLED account the server declared
 *     eligible (all-time business history and provenance are zero);
 *   - the reason(s) why the account cannot be deleted, with the six all-time
 *     counts, and the sentence that the person stays a disabled employee;
 *   - for an active / invited account: the pointer to "Zugang beenden" first;
 *   - for demo mode: the documented unavailability.
 *
 * The server decides again at delete time; nothing here is a security
 * boundary. The section is admin-only by virtue of the record it sits on.
 */
import type { Identifier } from "ra-core";

import {
  describeBusinessHistory,
  describeProvenance,
  EMPLOYEE_ACCOUNT_DELETION_BLOCK_REASON,
  EMPLOYEE_ACCOUNT_DELETION_DEMO_UNAVAILABLE,
  EMPLOYEE_ACCOUNT_DELETION_ELIGIBLE,
  EMPLOYEE_ACCOUNT_DELETION_PREVIEW_UNAVAILABLE,
  EMPLOYEE_ACCOUNT_DELETION_PURPOSE,
  EMPLOYEE_ACCOUNT_DELETION_REQUIRES_OFFBOARDING,
  EMPLOYEE_ACCOUNT_DELETION_SECTION_TITLE,
  EMPLOYEE_ACCOUNT_DELETION_UNKNOWN_STATE,
  isAccountDeletionOffered,
  type EmployeeAccessRecord,
  type EmployeeAccountDeletionResult,
  type EmployeeDeletionPreview,
} from "./employeeAccessContract";
import { DeleteEmployeeAccountDialog } from "./DeleteEmployeeAccountDialog";

/** The six all-time counts, one line each. Shared by the section and the dialog. */
export function EmployeeBusinessHistoryCounts({
  history,
  "data-testid": testId,
}: {
  history: EmployeeDeletionPreview["businessHistory"];
  "data-testid"?: string;
}) {
  const rows: Array<[string, number]> = [
    ["Kunden", history.companies],
    ["Kontakte", history.contacts],
    ["Vorgänge (auch archivierte)", history.deals],
    ["Aufgaben (auch erledigte)", history.tasks],
    ["Kontaktnotizen", history.contactNotes],
    ["Vorgangsnotizen", history.dealNotes],
  ];
  return (
    <dl
      className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm"
      data-testid={testId}
    >
      {rows.map(([label, count]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="font-medium tabular-nums">{count}</dd>
        </div>
      ))}
    </dl>
  );
}

function blockerExplanation(deletion: EmployeeDeletionPreview): string[] {
  const lines: string[] = [];
  for (const reason of deletion.reasons) {
    let line = EMPLOYEE_ACCOUNT_DELETION_BLOCK_REASON[reason];
    if (reason === "business_history_exists") {
      const detail = describeBusinessHistory(deletion.businessHistory);
      if (detail) line = `${line} (${detail})`;
    }
    if (reason === "durable_provenance_exists") {
      const detail = describeProvenance(deletion.provenance);
      if (detail) line = `${line} (${detail})`;
    }
    lines.push(line);
  }
  return lines;
}

export function EmployeeAccountDeletionSection({
  salesId,
  record,
  employeeName,
  onDeleted,
  onRefused,
}: {
  salesId: Identifier;
  record: EmployeeAccessRecord;
  /** Current full name from the employee record; without it no destructive control is offered. */
  employeeName: string | undefined;
  onDeleted: (result: EmployeeAccountDeletionResult) => void;
  onRefused?: () => void;
}) {
  const deletion = record.deletion;
  const state = record.accessState;

  let body: React.ReactNode;
  if (deletion && !deletion.supported) {
    body = (
      <p className="text-sm text-muted-foreground" role="status">
        {EMPLOYEE_ACCOUNT_DELETION_DEMO_UNAVAILABLE}
      </p>
    );
  } else if (state === "active" || state === "invited") {
    body = (
      <p
        className="text-sm text-muted-foreground"
        data-testid="employee-account-deletion-requires-offboarding"
      >
        {EMPLOYEE_ACCOUNT_DELETION_REQUIRES_OFFBOARDING}
      </p>
    );
  } else if (state === "unknown") {
    body = (
      <p className="text-sm text-muted-foreground">
        {EMPLOYEE_ACCOUNT_DELETION_UNKNOWN_STATE}
      </p>
    );
  } else if (!deletion) {
    body = (
      <p className="text-sm text-muted-foreground" role="status">
        {EMPLOYEE_ACCOUNT_DELETION_PREVIEW_UNAVAILABLE}
      </p>
    );
  } else if (isAccountDeletionOffered(record) && employeeName) {
    body = (
      <>
        <p
          className="text-sm text-foreground"
          data-testid="employee-account-deletion-eligible"
        >
          {EMPLOYEE_ACCOUNT_DELETION_ELIGIBLE}
        </p>
        <EmployeeBusinessHistoryCounts
          history={deletion.businessHistory}
          data-testid="employee-account-deletion-counts"
        />
        <DeleteEmployeeAccountDialog
          salesId={salesId}
          record={record}
          deletion={deletion}
          employeeName={employeeName}
          onDeleted={onDeleted}
          onRefused={onRefused}
        />
      </>
    );
  } else {
    body = (
      <>
        {blockerExplanation(deletion).map((line) => (
          <p
            key={line}
            className="text-sm text-foreground"
            data-testid="employee-account-deletion-blocked"
          >
            {line}
          </p>
        ))}
        <EmployeeBusinessHistoryCounts
          history={deletion.businessHistory}
          data-testid="employee-account-deletion-counts"
        />
      </>
    );
  }

  return (
    <section
      className="space-y-3 rounded-md border border-destructive/40 p-3"
      data-testid="employee-account-deletion"
    >
      <h4 className="text-sm font-semibold text-foreground">
        {EMPLOYEE_ACCOUNT_DELETION_SECTION_TITLE}
      </h4>
      <p className="text-sm text-muted-foreground">
        {EMPLOYEE_ACCOUNT_DELETION_PURPOSE}
      </p>
      {body}
    </section>
  );
}
