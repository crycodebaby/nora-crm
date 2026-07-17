import { AlertCircle, AlertTriangle, CalendarClock } from "lucide-react";
import { useTranslate } from "ra-core";

import { cn } from "@/lib/utils";

import { formatNoraDate, formatNoraRelativeDay } from "./noraDateTime";
import { getFollowUpStatus, type FollowUpStatus } from "../deals/dealUtils";

export type NoraUrgencyVariant = "compact" | "inline" | "alert";

type NoraUrgencyBadgeProps = {
  dateString: string;
  showDate?: boolean;
  variant?: NoraUrgencyVariant;
  className?: string;
};

export const NoraUrgencyBadge = ({
  dateString,
  showDate = false,
  variant = "compact",
  className,
}: NoraUrgencyBadgeProps) => {
  const translate = useTranslate();
  const status = getFollowUpStatus(dateString);

  if (!status) {
    return null;
  }

  const label = getUrgencyLabel(status, dateString, translate);
  const Icon = getUrgencyIcon(status);

  if (variant === "alert" && (status === "today" || status === "overdue")) {
    return (
      <div
        className={cn(
          "nora-urgency-alert",
          status === "overdue" && "nora-urgency-alert-overdue",
          status === "today" && "nora-urgency-alert-today",
          className,
        )}
        role="status"
      >
        <Icon className="nora-urgency-icon shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="nora-urgency-alert-title">{label}</p>
          {showDate ? (
            <p className="nora-urgency-alert-date">
              {formatNoraDate(dateString)}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <span
      className={cn(
        "nora-urgency-badge",
        status === "overdue" && "nora-urgency-overdue",
        status === "today" && "nora-urgency-today",
        status === "upcoming" && "nora-urgency-upcoming",
        variant === "inline" && "nora-urgency-inline",
        className,
      )}
      role="status"
    >
      <Icon className="nora-urgency-icon-sm shrink-0" aria-hidden />
      <span>{label}</span>
      {showDate ? (
        <span className="font-normal opacity-90">
          ({formatNoraDate(dateString)})
        </span>
      ) : null}
    </span>
  );
};

function getUrgencyLabel(
  status: FollowUpStatus,
  dateString: string,
  translate: (key: string) => string,
): string {
  if (status === "overdue") {
    return translate("resources.deals.follow_up.overdue");
  }
  if (status === "today") {
    return translate("resources.deals.follow_up.today");
  }
  return formatNoraRelativeDay(dateString);
}

function getUrgencyIcon(status: FollowUpStatus) {
  if (status === "overdue") {
    return AlertTriangle;
  }
  if (status === "today") {
    return AlertCircle;
  }
  return CalendarClock;
}
