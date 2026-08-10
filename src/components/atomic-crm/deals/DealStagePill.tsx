import { cn } from "@/lib/utils";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { findDealLabel, getDealStageCssVars } from "./dealStageModel";

type DealStagePillProps = {
  stage: string | null | undefined;
  className?: string;
  /** Hide the colored dot (text + soft background only). */
  hideDot?: boolean;
};

/** Compact colored pill with label — deals only. */
export function DealStagePill({
  stage,
  className,
  hideDot = false,
}: DealStagePillProps) {
  const { dealStages } = useConfigurationContext();
  const label = findDealLabel(dealStages, stage);
  const vars = getDealStageCssVars(stage);

  return (
    <span
      className={cn("nora-deal-stage-pill", className)}
      style={vars}
      title={label}
    >
      {!hideDot ? (
        <span className="nora-deal-stage-dot" aria-hidden="true" />
      ) : null}
      <span className="nora-deal-stage-pill-label">{label}</span>
    </span>
  );
}
