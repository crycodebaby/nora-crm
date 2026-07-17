import type { ConfigurationContextValue } from "../root/ConfigurationContext";
import type { Deal } from "../types";
import type { DealsByStage } from "./stages";
import { getVisibleDealStages } from "./stages";

/** Client-side Kanban category views — no DB filter, complements list filters. */
export type DealKanbanCategoryView =
  | "all"
  | "fensterservice"
  | "hausmeisterdienst";

export const DEAL_KANBAN_VIEW_STORAGE_KEY = "nora-deals-kanban-view";

/** `deals.category` values for category-specific views. */
export const KANBAN_VIEW_CATEGORY: Record<
  Exclude<DealKanbanCategoryView, "all">,
  string
> = {
  fensterservice: "fensterservice",
  hausmeisterdienst: "hausmeisterdienst",
};

/**
 * Schlanker Fensterauftrag-Kanban (v0.3c) — Teilmenge von `defaultDealStages`.
 * S4a/S4b/S4c sind bewusst keine Status und erscheinen nicht als Spalten.
 */
export const FENSTERSERVICE_KANBAN_STAGE_IDS = [
  "neue-anfrage",
  "aufmass-geplant",
  "aufmass-erledigt",
  "angebot-gesendet",
  "angenommen",
  "wartet-auf-hersteller",
  "termin-vereinbart",
  "abgeschlossen",
] as const;

export type FensterserviceKanbanStageId =
  (typeof FENSTERSERVICE_KANBAN_STAGE_IDS)[number];

export function isFensterserviceKanbanStage(stageId: string): boolean {
  return (FENSTERSERVICE_KANBAN_STAGE_IDS as readonly string[]).includes(
    stageId,
  );
}

export function filterDealsByKanbanView(
  deals: Deal[],
  view: DealKanbanCategoryView,
): Deal[] {
  if (view === "all") return deals;
  const category = KANBAN_VIEW_CATEGORY[view];
  return deals.filter((deal) => deal.category === category);
}

export function getPreferredStagesForKanbanView(
  view: DealKanbanCategoryView,
  dealStages: ConfigurationContextValue["dealStages"],
) {
  if (!dealStages) return [];
  if (view !== "fensterservice") return dealStages;
  return dealStages.filter((stage) => isFensterserviceKanbanStage(stage.value));
}

/**
 * Visible Kanban columns for the active view.
 * Fensterservice: preferred 8 stages; orphan stages (e.g. `nachfassen`) appear only when they contain deals.
 */
export function getVisibleStagesForKanbanView(
  view: DealKanbanCategoryView,
  dealStages: ConfigurationContextValue["dealStages"],
  dealsByStage: DealsByStage,
  showAllStages: boolean,
) {
  if (!dealStages) return [];

  if (view !== "fensterservice") {
    return getVisibleDealStages(dealStages, dealsByStage, showAllStages);
  }

  const preferredStages = getPreferredStagesForKanbanView(view, dealStages);

  if (showAllStages) {
    return preferredStages;
  }

  const preferredVisible = preferredStages.filter(
    (stage) => dealsByStage[stage.value]?.length > 0,
  );

  const orphanStages = dealStages.filter(
    (stage) =>
      !isFensterserviceKanbanStage(stage.value) &&
      dealsByStage[stage.value]?.length > 0,
  );

  const visibleValues = new Set([
    ...preferredVisible.map((s) => s.value),
    ...orphanStages.map((s) => s.value),
  ]);

  return dealStages.filter((stage) => visibleValues.has(stage.value));
}

export function countHiddenEmptyStages(
  dealStages: ConfigurationContextValue["dealStages"],
  visibleStages: ConfigurationContextValue["dealStages"],
) {
  if (!dealStages) return 0;
  return dealStages.length - (visibleStages?.length ?? 0);
}
