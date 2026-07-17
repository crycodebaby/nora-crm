import type { ChecklistRun, ChecklistRunItem, Deal } from "../types";
import { HOTBOARD_DEAL_LIMIT } from "./hotboardUtils";

export type ProductionReleasePriority = "required_missing" | "optional_only";

export type ProductionReleaseHotboardEntry = {
  runId: string;
  deal: Deal;
  requiredDone: number;
  requiredTotal: number;
  missingRequiredLabels: string[];
  priority: ProductionReleasePriority;
  sortStartedAt: string;
  sortFollowUpDate: string;
};

export function computeRequiredProgress(items: ChecklistRunItem[]): {
  done: number;
  total: number;
} {
  const required = items.filter((item) => item.is_required);
  const done = required.filter((item) => item.is_checked).length;
  return { done, total: required.length };
}

export function getMissingRequiredLabels(
  items: ChecklistRunItem[],
  limit = 2,
): string[] {
  return items
    .filter((item) => item.is_required && !item.is_checked)
    .sort((a, b) => a.sort_index - b.sort_index)
    .slice(0, limit)
    .map((item) => item.label_snapshot);
}

/**
 * Returns null when the run should not appear on the hotboard
 * (completed/cancelled handled upstream; here: all items done).
 */
export function classifyOpenProductionReleaseRun(
  items: ChecklistRunItem[],
): ProductionReleasePriority | null {
  const required = items.filter((item) => item.is_required);
  if (required.length === 0) return null;

  if (required.some((item) => !item.is_checked)) {
    return "required_missing";
  }

  if (items.some((item) => !item.is_required && !item.is_checked)) {
    return "optional_only";
  }

  return null;
}

export function buildProductionReleaseHotboardEntries(
  runs: ChecklistRun[],
  templateId: string,
  itemsByRunId: Map<string, ChecklistRunItem[]>,
  dealById: Map<number, Deal>,
): ProductionReleaseHotboardEntry[] {
  const entries: ProductionReleaseHotboardEntry[] = [];

  for (const run of runs) {
    if (run.template_id !== templateId) continue;
    if (run.status !== "open") continue;

    const deal = dealById.get(run.deal_id);
    if (!deal || deal.archived_at) continue;

    const items = itemsByRunId.get(String(run.id)) ?? [];
    const priority = classifyOpenProductionReleaseRun(items);
    if (!priority) continue;

    const { done, total } = computeRequiredProgress(items);

    entries.push({
      runId: String(run.id),
      deal,
      requiredDone: done,
      requiredTotal: total,
      missingRequiredLabels: getMissingRequiredLabels(items),
      priority,
      sortStartedAt: run.started_at,
      sortFollowUpDate: deal.expected_closing_date,
    });
  }

  return entries;
}

/** Oldest open checklist first; required gaps before optional-only. */
export function sortProductionReleaseHotboardEntries(
  entries: ProductionReleaseHotboardEntry[],
): ProductionReleaseHotboardEntry[] {
  const priorityOrder: Record<ProductionReleasePriority, number> = {
    required_missing: 0,
    optional_only: 1,
  };

  return [...entries].sort((a, b) => {
    const byPriority = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (byPriority !== 0) return byPriority;

    const byStarted = a.sortStartedAt.localeCompare(b.sortStartedAt);
    if (byStarted !== 0) return byStarted;

    return a.sortFollowUpDate.localeCompare(b.sortFollowUpDate);
  });
}

export function limitProductionReleaseHotboardEntries(
  entries: ProductionReleaseHotboardEntry[],
  limit = HOTBOARD_DEAL_LIMIT,
): ProductionReleaseHotboardEntry[] {
  return entries.slice(0, limit);
}

export function groupItemsByRunId(
  items: ChecklistRunItem[],
): Map<string, ChecklistRunItem[]> {
  const map = new Map<string, ChecklistRunItem[]>();
  for (const item of items) {
    const runId = String(item.checklist_run_id);
    const list = map.get(runId) ?? [];
    list.push(item);
    map.set(runId, list);
  }
  return map;
}
