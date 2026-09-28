import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type NoraMetaPairProps = {
  label: string;
  /** Plain value; ignored when `children` is given. */
  value?: ReactNode;
  children?: ReactNode;
  /** Something that qualifies the value (a badge, a relative day). */
  extra?: ReactNode;
  inline?: boolean;
  className?: string;
};

/**
 * Label + value. The value is the loud part, the label is quiet and small,
 * and both always sit in the same relation so repeated facts are found by
 * position, not by reading.
 */
export const NoraMetaPair = ({
  label,
  value,
  children,
  extra,
  inline,
  className,
}: NoraMetaPairProps) => (
  <div
    className={cn("nora-meta-pair", className)}
    data-inline={inline ? "true" : undefined}
  >
    <span className="nora-t-label nora-detail-label">{label}</span>
    <div className="nora-meta-pair-value nora-detail-value">
      {children ?? value}
      {extra}
    </div>
  </div>
);
