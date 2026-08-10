import { cn } from "@/lib/utils";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { findDealLabel, getDealStageCssVars } from "./dealStageModel";

type DealStageBadgeProps = {
  stage: string | null | undefined;
  className?: string;
  /** Dot + text (default). Use `dot` for color-only with aria-label. */
  variant?: "full" | "dot";
};

/** List/detail badge: always exposes text for a11y (or aria-label for dot). */
export function DealStageBadge({
  stage,
  className,
  variant = "full",
}: DealStageBadgeProps) {
  const { dealStages } = useConfigurationContext();
  const label = findDealLabel(dealStages, stage);
  const vars = getDealStageCssVars(stage);

  if (variant === "dot") {
    return (
      <span
        className={cn("inline-flex items-center", className)}
        style={vars}
        role="img"
        aria-label={label}
        title={label}
      >
        <span className="nora-deal-stage-dot" />
      </span>
    );
  }

  return (
    <span
      className={cn("inline-flex items-center gap-1.5 min-w-0", className)}
      style={vars}
    >
      <span className="nora-deal-stage-dot" aria-hidden="true" />
      <span className="text-sm truncate">{label}</span>
    </span>
  );
}
