/**
 * Shared row pieces of the Arbeitskorb (desktop and mobile). Presentation
 * only: every visible state comes from the row view (`toWorkRowView`) and the
 * display-name enrichment.
 */
import { CalendarClock, CircleAlert, CircleDashed } from "lucide-react";
import { useTranslate } from "ra-core";
import { Link } from "react-router";

import { cn } from "@/lib/utils";
import type { ContextName } from "./useWorkContextNames";
import { contextLabel, spokenDue, type ContextKind } from "./workRowText";
import type { WorkGroupKey, WorkRowView } from "./workRowView";

/** Group icon — always next to the word, never alone (docs/nora/26 §8). */
export const GroupIcon = ({
  group,
  className,
}: {
  group: WorkGroupKey;
  className?: string;
}) => {
  if (group === "overdue") {
    return (
      <CircleAlert
        aria-hidden="true"
        className={cn("nora-arbeitskorb-overdue-icon size-4", className)}
      />
    );
  }
  if (group === "today") {
    return (
      <CalendarClock aria-hidden="true" className={cn("size-4", className)} />
    );
  }
  return null;
};

/** Visible short due text in the urgency tone of its group. */
export const DueText = ({
  row,
  noneAsDash = false,
}: {
  row: WorkRowView;
  noneAsDash?: boolean;
}) => {
  const translate = useTranslate();
  const visible =
    row.due.kind === "date"
      ? row.due.short
      : row.due.kind === "none"
        ? noneAsDash
          ? "—"
          : translate("crm.work.date.none")
        : translate("crm.work.date.unreadable");
  return (
    <span
      className={cn(
        row.group === "overdue" && "nora-arbeitskorb-overdue-date",
        row.group === "today" && "font-semibold text-foreground",
      )}
    >
      <span aria-hidden="true" className="whitespace-nowrap">
        {visible}
      </span>
      <span className="sr-only">{spokenDue(translate, row)}</span>
      {row.alsoDueToday ? (
        <>
          {" "}
          <span
            aria-hidden="true"
            className="whitespace-nowrap text-xs font-medium"
          >
            · {translate("crm.work.due_today_too")}
          </span>
        </>
      ) : null}
    </span>
  );
};

/** Title, or "Ohne Bezeichnung" + "Unvollständig" for an incomplete row. */
export const WorkTitle = ({
  row,
  id,
  className,
}: {
  row: WorkRowView;
  id?: string;
  className?: string;
}) => {
  const translate = useTranslate();
  if (!row.incomplete && row.title !== null) {
    return (
      <span id={id} className={className}>
        {row.title}
      </span>
    );
  }
  return (
    <span
      id={id}
      className={cn("inline-flex flex-wrap items-center gap-x-2", className)}
    >
      <span className="italic text-[var(--nora-text-muted)]">
        {translate("crm.work.title_missing")}
      </span>
      <IncompleteMark />
    </span>
  );
};

export const IncompleteMark = () => {
  const translate = useTranslate();
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium not-italic text-[var(--nora-text-muted)]">
      <CircleDashed aria-hidden="true" className="size-3.5" />
      {translate("crm.work.incomplete")}
    </span>
  );
};

/** A real `<a>` to a context record (desktop). */
export const ContextLink = ({
  kind,
  to,
  name,
  describedBy,
  focusTarget,
}: {
  kind: ContextKind;
  to: string;
  name: ContextName;
  describedBy: string;
  focusTarget?: string;
}) => {
  const translate = useTranslate();
  const label = contextLabel(translate, kind, name);
  return (
    <Link
      to={to}
      aria-label={label.accessible ?? undefined}
      aria-describedby={describedBy}
      data-work-focus={focusTarget}
      className="rounded-sm text-foreground underline decoration-[var(--nora-text-muted)] underline-offset-2 [overflow-wrap:anywhere] hover:decoration-current focus-visible:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nora-brand-ring)]"
    >
      {label.prefix ? <span className="sr-only">{label.prefix} </span> : null}
      {label.visible}
    </Link>
  );
};

/** The same reference as plain text (mobile rows). */
export const ContextText = ({
  kind,
  name,
}: {
  kind: ContextKind;
  name: ContextName;
}) => {
  const translate = useTranslate();
  const label = contextLabel(translate, kind, name);
  return (
    <span>
      {label.prefix ? <span className="sr-only">{label.prefix} </span> : null}
      <span aria-hidden={label.accessible ? "true" : undefined}>
        {label.visible}
      </span>
      {label.accessible ? (
        <span className="sr-only">{label.accessible}</span>
      ) : null}
    </span>
  );
};

export const Separator = () => (
  <span aria-hidden="true" className="px-1 text-[var(--nora-text-muted)]">
    ·
  </span>
);
