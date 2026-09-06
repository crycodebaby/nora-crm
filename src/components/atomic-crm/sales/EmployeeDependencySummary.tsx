/**
 * "Offene Zuständigkeiten" (User Lifecycle W5).
 *
 * The one presentation of what still depends operationally on an employee.
 * The counts come from the server (`get_employee_dependency_preview` through
 * the single-employee users read); nothing is computed here beyond the
 * product sentence. Two callers, one rendering:
 *
 *   - EmployeeAccessPanel   durable section on the employee record — before,
 *                           during and after offboarding, for every access
 *                           state, also when every count is zero (the section
 *                           itself says that Nora checked)
 *   - OffboardEmployeeDialog decision-time warning before "Zugang beenden"
 *
 * Current responsibility (Kunden, Kontakte, Vorgänge, offene Aufgaben) is what
 * needs a new owner. Notes are historical authorship: preserved, never
 * reassignment work, therefore shown only as "bleiben erhalten" and never
 * counted as open.
 */
import type { Identifier } from "ra-core";
import { Link } from "react-router";

import { noraCreatePath } from "../routing/noraRoutes";
import {
  countOpenResponsibilities,
  describeOffboardingFollowUp,
  EMPLOYEE_NO_OPEN_RESPONSIBILITIES,
  EMPLOYEE_OPEN_RESPONSIBILITIES_TITLE,
  type EmployeeDependencyPreview,
} from "./employeeAccessContract";

/** `#/kunden?filter={"sales_id":7}` — the existing list filter, nothing new. */
function filteredListPath(resource: string, salesId: Identifier): string {
  return `${noraCreatePath({ resource, type: "list" })}?filter=${encodeURIComponent(
    JSON.stringify({ sales_id: salesId }),
  )}`;
}

type CountRow = {
  label: string;
  count: number;
  /** Existing list resource to link to; tasks have no desktop list. */
  resource?: "companies" | "contacts" | "deals";
};

function responsibilityRows(deps: EmployeeDependencyPreview): CountRow[] {
  return [
    { label: "Kunden", count: deps.companies, resource: "companies" },
    { label: "Kontakte", count: deps.contacts, resource: "contacts" },
    { label: "Vorgänge", count: deps.openDeals, resource: "deals" },
    { label: "Offene Aufgaben", count: deps.openTasks },
  ];
}

/**
 * The counts, one line each, current responsibility first. With `salesId`
 * every non-zero row that has a list links to it filtered by this employee.
 * With `showHistory` the notes follow as one separate, preserved line.
 */
export function EmployeeDependencyCounts({
  dependencies,
  salesId,
  showHistory = false,
  "data-testid": testId,
}: {
  dependencies: EmployeeDependencyPreview;
  salesId?: Identifier;
  showHistory?: boolean;
  "data-testid"?: string;
}) {
  const notes = dependencies.contactNotes + dependencies.dealNotes;
  return (
    <dl
      className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm"
      data-testid={testId}
    >
      {responsibilityRows(dependencies).map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="font-medium tabular-nums">
            {row.count}
            {salesId !== undefined && row.resource && row.count > 0 ? (
              <>
                {" "}
                <Link
                  className="font-normal underline underline-offset-4"
                  to={filteredListPath(row.resource, salesId)}
                >
                  anzeigen
                </Link>
              </>
            ) : null}
          </dd>
        </div>
      ))}
      {showHistory ? (
        <div className="contents">
          <dt className="text-muted-foreground">Notizen (bleiben erhalten)</dt>
          <dd className="font-medium tabular-nums">{notes}</dd>
        </div>
      ) : null}
    </dl>
  );
}

/**
 * The durable "Offene Zuständigkeiten" section of the employee record.
 * Always rendered: with the counts, with the zero state, or — when the server
 * could not deliver the preview — with a calm notice instead of nothing.
 */
export function EmployeeDependencySummary({
  salesId,
  dependencies,
}: {
  salesId: Identifier;
  dependencies: EmployeeDependencyPreview | undefined;
}) {
  const open = dependencies ? countOpenResponsibilities(dependencies) : null;
  return (
    <div
      className="space-y-2 rounded-md border border-border p-3"
      role="status"
      data-testid="employee-open-responsibilities"
    >
      <p className="text-sm font-medium text-foreground">
        {EMPLOYEE_OPEN_RESPONSIBILITIES_TITLE}
      </p>
      {dependencies === undefined ? (
        <p className="text-sm text-muted-foreground">
          Die Zuständigkeiten konnten nicht geladen werden.
        </p>
      ) : open === 0 ? (
        <p className="text-sm text-muted-foreground">
          {EMPLOYEE_NO_OPEN_RESPONSIBILITIES}
        </p>
      ) : (
        <>
          <EmployeeDependencyCounts
            dependencies={dependencies}
            salesId={salesId}
            data-testid="employee-open-responsibilities-counts"
          />
          <p className="text-sm text-muted-foreground">
            {describeOffboardingFollowUp(dependencies)}
          </p>
          {dependencies.openTasks > 0 ? (
            <p className="text-sm text-muted-foreground">
              Offene Aufgaben finden Sie in der Aufgabenliste über den Filter
              „Zuständig“.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
