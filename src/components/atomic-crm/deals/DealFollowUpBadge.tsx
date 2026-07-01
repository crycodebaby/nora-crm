import { useTranslate } from "ra-core";
import { cn } from "@/lib/utils";

import {
  formatISODateString,
  getFollowUpStatus,
  getRelativeTimeString,
  type FollowUpStatus,
} from "./dealUtils";

export const DealFollowUpBadge = ({
  dateString,
  showDate = false,
  className,
}: {
  dateString: string;
  showDate?: boolean;
  className?: string;
}) => {
  const translate = useTranslate();
  const status = getFollowUpStatus(dateString);

  if (!status) {
    return null;
  }

  const labelKey =
    status === "overdue"
      ? "resources.deals.follow_up.overdue"
      : status === "today"
        ? "resources.deals.follow_up.today"
        : null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2 py-0.5",
        followUpClassName(status),
        className,
      )}
    >
      {labelKey ? translate(labelKey) : getRelativeTimeString(dateString)}
      {showDate ? (
        <span className="font-normal opacity-90">
          ({formatISODateString(dateString)})
        </span>
      ) : null}
    </span>
  );
};

function followUpClassName(status: FollowUpStatus): string {
  if (status === "overdue") {
    return "nora-follow-up-overdue";
  }
  if (status === "today") {
    return "nora-follow-up-today";
  }
  return "nora-muted";
}
