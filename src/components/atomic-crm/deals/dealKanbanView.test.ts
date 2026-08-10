import { describe, expect, it } from "vitest";

import type { Deal } from "../types";
import { defaultDealStages } from "./dealStageModel";
import {
  filterDealsByKanbanView,
  FENSTERSERVICE_KANBAN_STAGE_IDS,
  getVisibleStagesForKanbanView,
} from "./dealKanbanView";
import { getDealsByStage } from "./stages";

const dealStages = defaultDealStages;

const baseDeal = {
  id: 1,
  index: 0,
  name: "Test",
  company_id: 1,
  sales_id: 1,
} as Deal;

describe("filterDealsByKanbanView", () => {
  it("filters fensterservice deals by category", () => {
    const deals = [
      { ...baseDeal, id: 1, category: "fensterservice" },
      { ...baseDeal, id: 2, category: "hausmeisterdienst" },
      { ...baseDeal, id: 3, category: "reparatur" },
    ] as Deal[];

    expect(filterDealsByKanbanView(deals, "fensterservice")).toHaveLength(1);
    expect(filterDealsByKanbanView(deals, "hausmeisterdienst")).toHaveLength(1);
    expect(filterDealsByKanbanView(deals, "all")).toHaveLength(3);
  });
});

describe("getVisibleStagesForKanbanView", () => {
  it("uses all stages for the default view", () => {
    const deals = [{ ...baseDeal, stage: "requested" }] as Deal[];
    const byStage = getDealsByStage(deals, dealStages);

    const visible = getVisibleStagesForKanbanView(
      "all",
      dealStages,
      byStage,
      false,
    );

    expect(visible.map((s) => s.value)).toEqual(["requested"]);
  });

  it("buckets legacy stages into canonical columns", () => {
    const deals = [{ ...baseDeal, stage: "neue-anfrage" }] as Deal[];
    const byStage = getDealsByStage(deals, dealStages);
    expect(byStage.requested).toHaveLength(1);
  });

  it("limits fensterservice to preferred stages when showing all", () => {
    const deals = [
      { ...baseDeal, stage: "requested", category: "fensterservice" },
    ] as Deal[];
    const byStage = getDealsByStage(deals, dealStages);

    const visible = getVisibleStagesForKanbanView(
      "fensterservice",
      dealStages,
      byStage,
      true,
    );

    expect(visible.map((s) => s.value)).toEqual([
      ...FENSTERSERVICE_KANBAN_STAGE_IDS,
    ]);
    expect(visible.some((s) => s.value === "none")).toBe(false);
  });

  it("shows orphan stages with deals in fensterservice view", () => {
    const deals = [
      { ...baseDeal, stage: "none", category: "fensterservice" },
    ] as Deal[];
    const byStage = getDealsByStage(deals, dealStages);

    const visible = getVisibleStagesForKanbanView(
      "fensterservice",
      dealStages,
      byStage,
      false,
    );

    expect(visible.map((s) => s.value)).toEqual(["none"]);
  });
});
