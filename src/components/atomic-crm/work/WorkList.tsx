/**
 * The grouped Arbeitskorb list (docs/nora/26 §6.1, §8, §9, §13.1).
 *
 * Groups label the delivered sequence; they never reorder it. Each group is
 * a `<section aria-labelledby>` with an `h2` and an ordered list, because
 * order carries meaning. The desktop row is no link and has no click handler
 * — only its context links are interactive; the mobile row is one button
 * that opens the read-only sheet.
 */
import { useTranslate } from "ra-core";

import { cn } from "@/lib/utils";
import type { WorkScope } from "../application/queries/getWorkItems";
import type { WorkContextNames } from "./useWorkContextNames";
import {
  ContextLink,
  ContextText,
  DueText,
  GroupIcon,
  Separator,
  WorkTitle,
} from "./WorkRowParts";
import {
  contactPath,
  customerTasksPath,
  GROUP_LABEL_KEYS,
  holderText,
  titleId,
} from "./workRowText";
import type { WorkPresentationGroup, WorkRowView } from "./workRowView";

export type WorkListVariant = "desktop" | "mobile";

export const WorkList = ({
  groups,
  scope,
  variant,
  names,
  appendedFrom,
  onOpenRow,
}: {
  groups: WorkPresentationGroup[];
  scope: WorkScope;
  variant: WorkListVariant;
  names: WorkContextNames;
  /** Index of the first row appended by the last "Weitere laden" (M4). */
  appendedFrom: number | null;
  onOpenRow: (workId: string) => void;
}) => {
  const translate = useTranslate();
  let index = 0;
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => {
        const headingId = `arbeitskorb-gruppe-${scope}-${group.id}`;
        return (
          <section key={group.id} aria-labelledby={headingId}>
            <h2
              id={headingId}
              className={cn(
                "mb-1 flex items-center gap-1.5 px-1 text-sm font-semibold",
                group.key === "overdue" || group.key === "today"
                  ? "text-foreground"
                  : "text-muted-foreground",
              )}
            >
              <GroupIcon group={group.key} />
              {translate(GROUP_LABEL_KEYS[group.key])}
            </h2>
            <ol className="flex flex-col">
              {group.rows.map((row) => {
                const rowIndex = index++;
                const appended =
                  appendedFrom !== null && rowIndex >= appendedFrom;
                return variant === "desktop" ? (
                  <DesktopRow
                    key={row.workId}
                    row={row}
                    index={rowIndex}
                    names={names}
                    appended={appended}
                  />
                ) : (
                  <MobileRow
                    key={row.workId}
                    row={row}
                    index={rowIndex}
                    names={names}
                    appended={appended}
                    onOpen={onOpenRow}
                  />
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
};

const DesktopRow = ({
  row,
  index,
  names,
  appended,
}: {
  row: WorkRowView;
  index: number;
  names: WorkContextNames;
  appended: boolean;
}) => {
  const translate = useTranslate();
  const id = titleId(row.workId);
  // Every row has at least one context (docs/nora/25 §21.3); its first link
  // is the row's keyboard focus target.
  const firstContext = row.customerId != null ? "customer" : "contact";
  return (
    <li
      data-work-id={row.workId}
      data-work-index={index}
      className={cn(
        "nora-arbeitskorb-row grid min-h-14 items-start gap-x-4 rounded-md px-3 py-2.5",
        row.holder
          ? "grid-cols-[10rem_minmax(0,1fr)_11rem]"
          : "grid-cols-[10rem_minmax(0,1fr)]",
        row.group === "overdue" && "nora-arbeitskorb-overdue-line",
        appended && "nora-arbeitskorb-append",
      )}
    >
      <div className="pt-0.5 text-sm">
        <DueText row={row} noneAsDash />
      </div>
      <div className="min-w-0">
        <p className="font-medium leading-snug text-foreground">
          <WorkTitle row={row} id={id} />
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {row.workType !== null ? (
            <>
              <span>{row.workType}</span>
              <Separator />
            </>
          ) : null}
          {row.customerId != null ? (
            <ContextLink
              kind="customer"
              to={customerTasksPath(row.customerId)}
              name={names.customerName(row.customerId)}
              describedBy={id}
              focusTarget={firstContext === "customer" ? row.workId : undefined}
            />
          ) : null}
          {row.customerId != null && row.contactId != null ? (
            <Separator />
          ) : null}
          {row.contactId != null ? (
            <ContextLink
              kind="contact"
              to={contactPath(row.contactId)}
              name={names.contactName(row.contactId)}
              describedBy={id}
              focusTarget={firstContext === "contact" ? row.workId : undefined}
            />
          ) : null}
        </p>
      </div>
      {row.holder ? (
        <p className="pt-0.5 text-sm text-muted-foreground">
          <span className="sr-only">
            {translate("crm.work.holder.prefix")}{" "}
          </span>
          {holderText(translate, row.holder)}
        </p>
      ) : null}
    </li>
  );
};

const MobileRow = ({
  row,
  index,
  names,
  appended,
  onOpen,
}: {
  row: WorkRowView;
  index: number;
  names: WorkContextNames;
  appended: boolean;
  onOpen: (workId: string) => void;
}) => {
  const translate = useTranslate();
  return (
    <li
      data-work-id={row.workId}
      data-work-index={index}
      className={cn(
        "nora-arbeitskorb-row rounded-md",
        row.group === "overdue" && "nora-arbeitskorb-overdue-line",
        appended && "nora-arbeitskorb-append",
      )}
    >
      <button
        type="button"
        aria-haspopup="dialog"
        data-work-focus={row.workId}
        onClick={() => onOpen(row.workId)}
        className="flex min-h-16 w-full flex-col gap-0.5 rounded-md px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nora-brand-ring)]"
      >
        <span className="line-clamp-3 font-medium leading-snug text-foreground">
          <WorkTitle row={row} />
        </span>
        <span className="text-sm text-muted-foreground">
          <DueText row={row} />
          {row.workType !== null ? (
            <>
              <Separator />
              <span>{row.workType}</span>
            </>
          ) : null}
        </span>
        {row.customerId != null || row.contactId != null ? (
          <span className="text-sm text-muted-foreground">
            {row.customerId != null ? (
              <ContextText
                kind="customer"
                name={names.customerName(row.customerId)}
              />
            ) : null}
            {row.customerId != null && row.contactId != null ? (
              <Separator />
            ) : null}
            {row.contactId != null ? (
              <ContextText
                kind="contact"
                name={names.contactName(row.contactId)}
              />
            ) : null}
          </span>
        ) : null}
        {row.holder ? (
          <span className="text-sm text-muted-foreground">
            <span className="sr-only">
              {translate("crm.work.holder.prefix")}{" "}
            </span>
            {holderText(translate, row.holder)}
          </span>
        ) : null}
      </button>
    </li>
  );
};
