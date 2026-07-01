import { useTranslate } from "ra-core";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DealKanbanToolbarProps = {
  showAllStages: boolean;
  onToggleShowAllStages: () => void;
  hiddenEmptyStageCount: number;
};

export const DealKanbanToolbar = ({
  showAllStages,
  onToggleShowAllStages,
  hiddenEmptyStageCount,
}: DealKanbanToolbarProps) => {
  const translate = useTranslate();

  if (!showAllStages && hiddenEmptyStageCount === 0) {
    return null;
  }

  return (
    <div className="flex justify-end px-1 pb-1">
      <Button
        type="button"
        variant="outline"
        size="lg"
        onClick={onToggleShowAllStages}
        className={cn(
          "nora-secondary-action nora-touch-target text-sm font-normal",
          showAllStages && "border-muted-foreground/30",
        )}
        aria-pressed={showAllStages}
      >
        {showAllStages
          ? translate("resources.deals.kanban.hide_empty_stages")
          : translate("resources.deals.kanban.show_all_stages")}
      </Button>
    </div>
  );
};
