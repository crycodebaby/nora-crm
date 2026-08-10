import type { ConfigurationContextValue } from "../root/ConfigurationContext";
import type { Deal } from "../types";
import { resolveDealStageColumn } from "./dealStageModel";

export type DealsByStage = Record<string, Deal[]>;

export const getDealsByStage = (
  unorderedDeals: Deal[],
  dealStages: ConfigurationContextValue["dealStages"],
) => {
  if (!dealStages) return {};
  const dealsByStage: DealsByStage = dealStages.reduce(
    (obj, stage) => ({ ...obj, [stage.value]: [] }),
    {} as DealsByStage,
  );

  for (const deal of unorderedDeals) {
    const column = resolveDealStageColumn(deal.stage);
    const stage = dealStages.find((s) => s.value === column)
      ? column
      : dealStages[0]?.value;
    if (!stage) continue;
    if (!dealsByStage[stage]) {
      dealsByStage[stage] = [];
    }
    dealsByStage[stage].push(deal);
  }

  dealStages.forEach((stage) => {
    dealsByStage[stage.value] = (dealsByStage[stage.value] ?? []).sort(
      (recordA: Deal, recordB: Deal) => recordA.index - recordB.index,
    );
  });
  return dealsByStage;
};

/** Kanban columns to render — empty stages hidden unless showAllStages is true. */
export const getVisibleDealStages = (
  dealStages: ConfigurationContextValue["dealStages"],
  dealsByStage: DealsByStage,
  showAllStages: boolean,
) => {
  if (!dealStages) return [];
  if (showAllStages) return dealStages;
  return dealStages.filter((stage) => dealsByStage[stage.value]?.length > 0);
};
