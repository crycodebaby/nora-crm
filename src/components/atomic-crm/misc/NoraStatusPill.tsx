import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type NoraStatusTone = "neutral" | "accent" | "success" | "quiet";

type NoraStatusPillProps = {
  children: ReactNode;
  tone?: NoraStatusTone;
  icon?: ReactNode;
  className?: string;
  title?: string;
};

/** A small labelled state. Tone supports the words; it never replaces them. */
export const NoraStatusPill = ({
  children,
  tone = "neutral",
  icon,
  className,
  title,
}: NoraStatusPillProps) => (
  <span
    className={cn("nora-status-pill", className)}
    data-tone={tone === "neutral" ? undefined : tone}
    title={title}
  >
    {icon}
    <span className="min-w-0 truncate">{children}</span>
  </span>
);
