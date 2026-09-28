import { differenceInCalendarDays } from "date-fns";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { useTranslate } from "ra-core";

import { cn } from "@/lib/utils";

import { formatNoraDate, parseISODateOnly } from "../misc/noraDateTime";
import { getFollowUpStatus } from "./dealUtils";

type DealAttentionStripProps = {
  /** `deals.expected_closing_date` — the next customer-contact date. */
  dateString: string;
  /** Responsible employee, shown as "· Zuständig: …" when known. */
  responsible?: string | null;
  className?: string;
};

/**
 * Compact attention line for a Vorgang whose next customer contact is due
 * today or overdue. One row: glyph, what is due, since when / when, and who
 * is responsible. Replaces the former full-width alert banner; renders
 * nothing for upcoming or missing dates. Semantics unchanged: the source is
 * still `expected_closing_date` and the status still comes from
 * `getFollowUpStatus`.
 */
export const DealAttentionStrip = ({
  dateString,
  responsible,
  className,
}: DealAttentionStripProps) => {
  const translate = useTranslate();
  const status = getFollowUpStatus(dateString);
  if (status !== "overdue" && status !== "today") return null;

  const due = parseISODateOnly(dateString);
  const daysOverdue =
    status === "overdue"
      ? Math.max(1, differenceInCalendarDays(new Date(), due))
      : 0;
  const Icon = status === "overdue" ? AlertTriangle : AlertCircle;

  return (
    <div
      className={cn("nora-attention", className)}
      data-tone={status}
      role="status"
    >
      <Icon className="nora-attention-icon" aria-hidden />
      <div className="nora-attention-body">
        <span className="nora-attention-title">
          {status === "overdue"
            ? translate("resources.deals.attention.overdue_title")
            : translate("resources.deals.attention.today_title")}
        </span>
        <span className="nora-attention-meta">
          {status === "overdue"
            ? translate("resources.deals.attention.overdue_since", {
                smart_count: daysOverdue,
                date: formatNoraDate(dateString),
              })
            : translate("resources.deals.attention.today_meta", {
                date: formatNoraDate(dateString),
              })}
          {responsible ? (
            <>
              <span aria-hidden> · </span>
              {translate("resources.deals.fields.sales_id")}: {responsible}
            </>
          ) : null}
        </span>
      </div>
    </div>
  );
};
