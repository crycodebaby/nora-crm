import { useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import type { DealKanbanCategoryView } from "./dealKanbanView";

type DealKanbanToolbarProps = {
  kanbanView: DealKanbanCategoryView;
  onKanbanViewChange: (view: DealKanbanCategoryView) => void;
  showAllStages: boolean;
  onToggleShowAllStages: () => void;
  hiddenEmptyStageCount: number;
};

export const DealKanbanToolbar = ({
  kanbanView,
  onKanbanViewChange,
  showAllStages,
  onToggleShowAllStages,
  hiddenEmptyStageCount,
}: DealKanbanToolbarProps) => {
  const translate = useTranslate();

  const showStageToggle = showAllStages || hiddenEmptyStageCount > 0;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-1 pb-1">
      <ToggleGroup
        type="single"
        value={kanbanView}
        onValueChange={(value) => {
          if (value) {
            onKanbanViewChange(value as DealKanbanCategoryView);
          }
        }}
        size="lg"
        variant="outline"
        className="w-full sm:w-auto flex flex-wrap justify-start"
        aria-label={translate("resources.deals.kanban.view_filter_label")}
      >
        <ToggleGroupItem
          value="all"
          className="nora-touch-target flex-1 sm:flex-none text-sm font-normal px-4"
        >
          {translate("resources.deals.kanban.view_all")}
        </ToggleGroupItem>
        <ToggleGroupItem
          value="fensterservice"
          className="nora-touch-target flex-1 sm:flex-none text-sm font-normal px-4"
        >
          {translate("resources.deals.kanban.view_fensterservice")}
        </ToggleGroupItem>
        <ToggleGroupItem
          value="hausmeisterdienst"
          className="nora-touch-target flex-1 sm:flex-none text-sm font-normal px-4"
        >
          {translate("resources.deals.kanban.view_hausmeisterdienst")}
        </ToggleGroupItem>
      </ToggleGroup>
      {showStageToggle ? (
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={onToggleShowAllStages}
          className={cn(
            "nora-secondary-action nora-touch-target text-sm font-normal w-full sm:w-auto shrink-0",
            showAllStages && "border-muted-foreground/30",
          )}
          aria-pressed={showAllStages}
        >
          {showAllStages
            ? translate("resources.deals.kanban.hide_empty_stages")
            : translate("resources.deals.kanban.show_all_stages")}
        </Button>
      ) : null}
    </div>
  );
};
