/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import type { ChecklistRun, ChecklistRunItem, Deal } from "../types";
import {
  buildProductionReleaseHotboardEntries,
  classifyOpenProductionReleaseRun,
  limitProductionReleaseHotboardEntries,
  sortProductionReleaseHotboardEntries,
} from "./productionReleaseHotboardUtils";

const templateId = "tpl-fens";

const item = (
  overrides: Partial<ChecklistRunItem> & Pick<ChecklistRunItem, "id">,
): ChecklistRunItem =>
  ({
    checklist_run_id: "run-1",
    label_snapshot: "Punkt",
    is_required: true,
    is_checked: false,
    sort_index: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }) as ChecklistRunItem;

const run = (overrides: Partial<ChecklistRun>): ChecklistRun =>
  ({
    id: "run-1",
    template_id: templateId,
    deal_id: 1,
    service_area_code: "FENS",
    status: "open",
    started_at: "2026-06-01T10:00:00Z",
    created_at: "2026-06-01T10:00:00Z",
    updated_at: "2026-06-01T10:00:00Z",
    ...overrides,
  }) as ChecklistRun;

const deal = (overrides: Partial<Deal>): Deal =>
  ({
    id: 1,
    name: "Fenster Müller",
    company_id: 10,
    contact_ids: [],
    category: "fensterservice",
    stage: "angebot-gesendet",
    description: "",
    amount: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    expected_closing_date: "2026-06-15",
    sales_id: 1,
    index: 0,
    case_number: "VG-2026-000010",
    ...overrides,
  }) as Deal;

describe("classifyOpenProductionReleaseRun", () => {
  it("returns required_missing when a required item is open", () => {
    expect(
      classifyOpenProductionReleaseRun([
        item({ id: "1", is_required: true, is_checked: false }),
      ]),
    ).toBe("required_missing");
  });

  it("returns optional_only when only optional items remain", () => {
    expect(
      classifyOpenProductionReleaseRun([
        item({ id: "1", is_required: true, is_checked: true }),
        item({
          id: "2",
          is_required: false,
          is_checked: false,
          sort_index: 1,
        }),
      ]),
    ).toBe("optional_only");
  });

  it("returns null when all items are checked", () => {
    expect(
      classifyOpenProductionReleaseRun([
        item({ id: "1", is_required: true, is_checked: true }),
        item({ id: "2", is_required: false, is_checked: true, sort_index: 1 }),
      ]),
    ).toBeNull();
  });
});

describe("buildProductionReleaseHotboardEntries", () => {
  const dealById = new Map<number, Deal>([[1, deal({ id: 1 })]]);

  it("includes open runs with missing required items", () => {
    const itemsByRun = new Map([
      [
        "run-1",
        [item({ id: "1", checklist_run_id: "run-1", is_checked: false })],
      ],
    ]);
    const entries = buildProductionReleaseHotboardEntries(
      [run({ id: "run-1" })],
      templateId,
      itemsByRun,
      dealById,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.priority).toBe("required_missing");
  });

  it("excludes completed and cancelled runs", () => {
    const itemsByRun = new Map([
      [
        "run-1",
        [item({ id: "1", checklist_run_id: "run-1", is_checked: false })],
      ],
    ]);
    const entries = buildProductionReleaseHotboardEntries(
      [
        run({ id: "run-1", status: "completed" }),
        run({ id: "run-2", status: "cancelled" }),
      ],
      templateId,
      itemsByRun,
      dealById,
    );
    expect(entries).toHaveLength(0);
  });

  it("excludes archived deals", () => {
    const archivedDeal = deal({ id: 2, archived_at: "2026-06-02T00:00:00Z" });
    const itemsByRun = new Map([
      [
        "run-1",
        [item({ id: "1", checklist_run_id: "run-1", is_checked: false })],
      ],
    ]);
    const entries = buildProductionReleaseHotboardEntries(
      [run({ id: "run-1", deal_id: 2 })],
      templateId,
      itemsByRun,
      new Map([[2, archivedDeal]]),
    );
    expect(entries).toHaveLength(0);
  });

  it("excludes runs when all required items are done and no optional open", () => {
    const itemsByRun = new Map([
      [
        "run-1",
        [item({ id: "1", checklist_run_id: "run-1", is_checked: true })],
      ],
    ]);
    const entries = buildProductionReleaseHotboardEntries(
      [run({ id: "run-1" })],
      templateId,
      itemsByRun,
      dealById,
    );
    expect(entries).toHaveLength(0);
  });
});

describe("sortProductionReleaseHotboardEntries", () => {
  it("prioritizes required_missing over optional_only", () => {
    const entries = sortProductionReleaseHotboardEntries([
      {
        runId: "b",
        deal: deal({ id: 2 }),
        requiredDone: 8,
        requiredTotal: 8,
        missingRequiredLabels: [],
        priority: "optional_only",
        sortStartedAt: "2026-06-01T10:00:00Z",
        sortFollowUpDate: "2026-06-01",
      },
      {
        runId: "a",
        deal: deal({ id: 1 }),
        requiredDone: 2,
        requiredTotal: 8,
        missingRequiredLabels: ["Aufmaß"],
        priority: "required_missing",
        sortStartedAt: "2026-06-10T10:00:00Z",
        sortFollowUpDate: "2026-06-20",
      },
    ]);
    expect(entries.map((e) => e.runId)).toEqual(["a", "b"]);
  });

  it("sorts oldest started_at first within same priority", () => {
    const entries = sortProductionReleaseHotboardEntries([
      {
        runId: "new",
        deal: deal({ id: 2 }),
        requiredDone: 1,
        requiredTotal: 8,
        missingRequiredLabels: [],
        priority: "required_missing",
        sortStartedAt: "2026-06-10T10:00:00Z",
        sortFollowUpDate: "2026-06-20",
      },
      {
        runId: "old",
        deal: deal({ id: 1 }),
        requiredDone: 1,
        requiredTotal: 8,
        missingRequiredLabels: [],
        priority: "required_missing",
        sortStartedAt: "2026-06-01T10:00:00Z",
        sortFollowUpDate: "2026-06-15",
      },
    ]);
    expect(entries.map((e) => e.runId)).toEqual(["old", "new"]);
  });
});

describe("limitProductionReleaseHotboardEntries", () => {
  it("caps at 5 entries", () => {
    const entries = Array.from({ length: 7 }, (_, index) => ({
      runId: `run-${index}`,
      deal: deal({ id: index + 1 }),
      requiredDone: 0,
      requiredTotal: 8,
      missingRequiredLabels: [],
      priority: "required_missing" as const,
      sortStartedAt: `2026-06-0${index + 1}T10:00:00Z`,
      sortFollowUpDate: "2026-06-15",
    }));
    expect(limitProductionReleaseHotboardEntries(entries)).toHaveLength(5);
  });
});
