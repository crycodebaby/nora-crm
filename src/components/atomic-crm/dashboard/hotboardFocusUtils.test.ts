/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import {
  FOCUS_BOARD_STAGES,
  filterDealsForFocusStage,
  filterNachfassenDeals,
  HOTBOARD_DEAL_LIMIT,
  prepareFocusColumnDeals,
  sortDealsByFocusPriority,
} from "./hotboardUtils";
import type { Deal } from "../types";
import { noraCreatePath } from "../routing/noraRoutes";

const today = new Date();
today.setHours(0, 0, 0, 0);
const todayIso = today.toISOString().slice(0, 10);

const yesterday = new Date(today);
yesterday.setDate(yesterday.getDate() - 1);
const yesterdayIso = yesterday.toISOString().slice(0, 10);

const tomorrow = new Date(today);
tomorrow.setDate(tomorrow.getDate() + 1);
const tomorrowIso = tomorrow.toISOString().slice(0, 10);

const baseDeal = (overrides: Partial<Deal>): Deal =>
  ({
    id: 1,
    name: "Test",
    company_id: 1,
    contact_ids: [],
    category: "fensterservice",
    stage: "neue-anfrage",
    description: "",
    amount: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    expected_closing_date: todayIso,
    sales_id: 1,
    index: 0,
    case_number: "VG-2026-000001",
    ...overrides,
  }) as Deal;

describe("FOCUS_BOARD_STAGES", () => {
  it("keeps canonical status IDs", () => {
    expect(FOCUS_BOARD_STAGES).toEqual(["neue-anfrage", "nachfassen"]);
  });
});

describe("filterNachfassenDeals", () => {
  it("only includes nachfassen stage", () => {
    const deals = [
      baseDeal({ id: 1, stage: "nachfassen" }),
      baseDeal({ id: 2, stage: "angebot-gesendet" }),
      baseDeal({ id: 3, stage: "neue-anfrage" }),
    ];
    expect(filterNachfassenDeals(deals).map((d) => d.id)).toEqual([1]);
  });
});

describe("sortDealsByFocusPriority", () => {
  it("orders overdue, today, upcoming, then created desc", () => {
    const deals = [
      baseDeal({
        id: 1,
        expected_closing_date: tomorrowIso,
        created_at: "2026-01-10T00:00:00Z",
      }),
      baseDeal({
        id: 2,
        expected_closing_date: yesterdayIso,
        created_at: "2026-01-01T00:00:00Z",
      }),
      baseDeal({
        id: 3,
        expected_closing_date: todayIso,
        created_at: "2026-01-05T00:00:00Z",
      }),
      baseDeal({
        id: 4,
        expected_closing_date: tomorrowIso,
        created_at: "2026-01-15T00:00:00Z",
      }),
    ];
    expect(sortDealsByFocusPriority(deals).map((d) => d.id)).toEqual([
      2, 3, 4, 1,
    ]);
  });
});

describe("prepareFocusColumnDeals", () => {
  it("limits visible deals to HOTBOARD_DEAL_LIMIT", () => {
    const deals = Array.from({ length: 7 }, (_, index) =>
      baseDeal({
        id: index + 1,
        stage: "neue-anfrage",
        created_at: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
      }),
    );
    const result = prepareFocusColumnDeals(deals, "neue-anfrage");
    expect(result.deals).toHaveLength(HOTBOARD_DEAL_LIMIT);
    expect(result.total).toBe(7);
    expect(result.remaining).toBe(2);
  });

  it("filters nachfassen column separately from neue-anfrage", () => {
    const deals = [
      baseDeal({ id: 1, stage: "neue-anfrage" }),
      baseDeal({ id: 2, stage: "nachfassen" }),
      baseDeal({ id: 3, stage: "angebot-gesendet" }),
    ];
    expect(
      filterDealsForFocusStage(deals, "nachfassen").map((d) => d.id),
    ).toEqual([2]);
    expect(
      prepareFocusColumnDeals(deals, "neue-anfrage").deals.map((d) => d.id),
    ).toEqual([1]);
  });
});

describe("deal show route", () => {
  it("uses German vorgaenge show path", () => {
    expect(noraCreatePath({ resource: "deals", type: "show", id: 42 })).toBe(
      "/vorgaenge/42/show",
    );
  });
});
