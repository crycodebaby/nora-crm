import type { ChecklistRunItem } from "../types";

export function shouldShowDealChecklistSection(
  category: string | null | undefined,
  hasAnyRuns: boolean,
): boolean {
  return category === "fensterservice" || hasAnyRuns;
}

export function computeChecklistProgress(items: ChecklistRunItem[]): {
  done: number;
  total: number;
} {
  const total = items.length;
  const done = items.filter((item) => item.is_checked).length;
  return { done, total };
}

export function allRequiredItemsChecked(items: ChecklistRunItem[]): boolean {
  const required = items.filter((item) => item.is_required);
  if (required.length === 0) return false;
  return required.every((item) => item.is_checked);
}
