import { useCallback, useState } from "react";

import {
  DEAL_KANBAN_VIEW_STORAGE_KEY,
  type DealKanbanCategoryView,
} from "./dealKanbanView";

const VALID_VIEWS: DealKanbanCategoryView[] = [
  "all",
  "fensterservice",
  "hausmeisterdienst",
];

function readDealKanbanView(): DealKanbanCategoryView {
  if (typeof window === "undefined") {
    return "all";
  }
  const stored = window.localStorage.getItem(DEAL_KANBAN_VIEW_STORAGE_KEY);
  if (stored && VALID_VIEWS.includes(stored as DealKanbanCategoryView)) {
    return stored as DealKanbanCategoryView;
  }
  return "all";
}

export function useDealKanbanView() {
  const [kanbanView, setKanbanViewState] = useState(readDealKanbanView);

  const setKanbanView = useCallback((view: DealKanbanCategoryView) => {
    setKanbanViewState(view);
    window.localStorage.setItem(DEAL_KANBAN_VIEW_STORAGE_KEY, view);
  }, []);

  return { kanbanView, setKanbanView };
}
