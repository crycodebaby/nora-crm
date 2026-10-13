/**
 * Presentation model of the Arbeitskorb (docs/nora/26 §6). Shared by the
 * desktop and the mobile surface.
 *
 * It translates authoritative Work facts into presentation tokens — it never
 * creates a Work fact. Groups follow `derived.overdue`, `derived.dueToday`
 * and `dueAt === null` only; the holder follows `derived.isMine` /
 * `derived.isUnassigned` only; counts come from the delivered flags only.
 * Nothing here reorders, filters, deduplicates or mutates a Work row.
 */
import type { WorkItem, WorkScope } from "../application/queries/getWorkItems";
import { formatWorkDueDate, type WorkDueDisplay } from "./formatWorkDueDate";

export type WorkGroupKey = "overdue" | "today" | "none" | "upcoming";

/** Group of a row, in the frozen precedence (docs/nora/26 §6.1). */
export const workGroupKey = (item: WorkItem): WorkGroupKey => {
  if (item.derived.overdue) return "overdue";
  if (item.derived.dueToday) return "today";
  if (item.dueAt === null) return "none";
  return "upcoming";
};

export type WorkHolderPresentation =
  | { kind: "me" }
  | { kind: "unassigned" }
  | { kind: "named"; name: string }
  | { kind: "unnamed" }
  | { kind: "unknown" };

/** docs/nora/26 §6.4 — never a comparison of `holder.salesId` with the viewer. */
export const workHolderPresentation = (
  item: WorkItem,
): WorkHolderPresentation => {
  if (item.derived.isMine) return { kind: "me" };
  if (item.derived.isUnassigned) return { kind: "unassigned" };
  if (item.holder !== null && item.holder.displayName !== null) {
    return { kind: "named", name: item.holder.displayName };
  }
  if (item.holder !== null) return { kind: "unnamed" };
  return { kind: "unknown" };
};

export type WorkRowView = {
  workId: string;
  group: WorkGroupKey;
  /** The delivered title, or `null` for an incomplete row (never repaired). */
  title: string | null;
  incomplete: boolean;
  workType: string | null;
  due: WorkDueDisplay;
  /** `overdue` and `dueToday` both true: listed under Überfällig, plus "heute fällig". */
  alsoDueToday: boolean;
  /** Only in the team view (docs/nora/26 §6.4). */
  holder: WorkHolderPresentation | null;
  customerId: number | null;
  contactId: number | null;
};

export const toWorkRowView = (
  item: WorkItem,
  scope: WorkScope,
): WorkRowView => ({
  workId: item.workId,
  group: workGroupKey(item),
  title: item.validity === "valid" ? item.title : null,
  incomplete: item.validity === "incomplete",
  workType: item.workType,
  due: formatWorkDueDate(item.dueAt),
  alsoDueToday: item.derived.overdue && item.derived.dueToday,
  holder: scope === "team" ? workHolderPresentation(item) : null,
  customerId: item.context.customerId,
  contactId: item.context.contactId,
});

export type WorkPresentationGroup = {
  /** Stable within one sequence: the group's position, not its key. */
  id: string;
  key: WorkGroupKey;
  rows: WorkRowView[];
};

/**
 * Labels the delivered sequence once, starting a new group only where the
 * key changes from the previous row — also across page boundaries. A key
 * that reappears later gets its heading again; no row ever moves.
 *
 * Invariant: `flatten(presentationGroups(S)).map(workId) === S.map(workId)`.
 */
export const presentationGroups = (
  rows: readonly WorkRowView[],
): WorkPresentationGroup[] => {
  const groups: WorkPresentationGroup[] = [];
  for (const row of rows) {
    const current = groups[groups.length - 1];
    if (current && current.key === row.group) {
      current.rows.push(row);
    } else {
      groups.push({
        id: `${groups.length}-${row.group}`,
        key: row.group,
        rows: [row],
      });
    }
  }
  return groups;
};

export type WorkSummary =
  | { complete: true; total: number; overdue: number; today: number }
  | { complete: false; loaded: number };

/**
 * docs/nora/26 §6.6: counts only from delivered flags, and a total only over
 * a completely loaded set (last page's `nextCursor === null`).
 */
export const summarizeWork = (
  items: readonly WorkItem[],
  complete: boolean,
): WorkSummary => {
  if (!complete) return { complete: false, loaded: items.length };
  let overdue = 0;
  let today = 0;
  for (const item of items) {
    if (item.derived.overdue) overdue += 1;
    else if (item.derived.dueToday) today += 1;
  }
  return { complete: true, total: items.length, overdue, today };
};
