import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { DealStagePill } from "./DealStagePill";

type DealStageAuditValueProps = {
  oldStage: string | null | undefined;
  newStage: string | null | undefined;
  className?: string;
};

/** Audit row: previous → next as colored pills. */
export function DealStageAuditValue({
  oldStage,
  newStage,
  className,
}: DealStageAuditValueProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2 text-sm", className)}>
      <DealStagePill stage={oldStage} />
      <ArrowRight
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <DealStagePill stage={newStage} />
    </div>
  );
}
