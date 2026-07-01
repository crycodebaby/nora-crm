import { describe, expect, it } from "vitest";

import type { ChecklistRunItem } from "../types";
import {
  allRequiredItemsChecked,
  computeChecklistProgress,
  shouldShowDealChecklistSection,
} from "./checklistUtils";

const item = (
  overrides: Partial<ChecklistRunItem> & Pick<ChecklistRunItem, "id">,
): ChecklistRunItem =>
  ({
    checklist_run_id: "run-1",
    label_snapshot: "Test",
    is_required: false,
    is_checked: false,
    sort_index: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }) as ChecklistRunItem;

describe("shouldShowDealChecklistSection", () => {
  it("shows for fensterservice deals", () => {
    expect(shouldShowDealChecklistSection("fensterservice", false)).toBe(true);
  });

  it("shows when runs exist regardless of category", () => {
    expect(shouldShowDealChecklistSection("hausmeisterdienst", true)).toBe(
      true,
    );
  });

  it("hides for other categories without runs", () => {
    expect(shouldShowDealChecklistSection("hausmeisterdienst", false)).toBe(
      false,
    );
  });
});

describe("computeChecklistProgress", () => {
  it("counts checked items", () => {
    const items = [
      item({ id: "1", is_checked: true }),
      item({ id: "2", is_checked: false }),
      item({ id: "3", is_checked: true }),
    ];
    expect(computeChecklistProgress(items)).toEqual({ done: 2, total: 3 });
  });
});

describe("allRequiredItemsChecked", () => {
  it("returns false when optional items remain open", () => {
    const items = [
      item({ id: "1", is_required: true, is_checked: true }),
      item({ id: "2", is_required: false, is_checked: false }),
    ];
    expect(allRequiredItemsChecked(items)).toBe(true);
  });

  it("returns false when a required item is open", () => {
    const items = [
      item({ id: "1", is_required: true, is_checked: true }),
      item({ id: "2", is_required: true, is_checked: false }),
    ];
    expect(allRequiredItemsChecked(items)).toBe(false);
  });

  it("returns false when there are no required items", () => {
    expect(allRequiredItemsChecked([item({ id: "1", is_required: false })])).toBe(
      false,
    );
  });
});
