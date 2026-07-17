import { NoraUrgencyBadge } from "../misc/NoraUrgencyBadge";

export const DealFollowUpBadge = ({
  dateString,
  showDate = false,
  className,
  variant = "compact",
}: {
  dateString: string;
  showDate?: boolean;
  className?: string;
  variant?: "compact" | "inline" | "alert";
}) => (
  <NoraUrgencyBadge
    dateString={dateString}
    showDate={showDate}
    className={className}
    variant={variant}
  />
);
