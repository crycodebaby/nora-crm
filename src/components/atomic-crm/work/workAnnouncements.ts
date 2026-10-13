/**
 * Screen-reader announcement texts of the Arbeitskorb (docs/nora/26 §13.5).
 * Pure: every number comes from delivered flags and row counts, never from
 * `dueAt` (§6.6).
 */
import type { TranslateFunction as Translate } from "ra-core";

import type { WorkItem, WorkScope } from "../application/queries/getWorkItems";
import { summarizeWork, workGroupKey } from "./workRowView";

export const viewLabel = (translate: Translate, scope: WorkScope) =>
  translate(scope === "mine" ? "crm.work.views.mine" : "crm.work.views.team");

/**
 * "{Sicht}: {n} offene Aufgaben, {a} überfällig, {b} heute." (parts with 0
 * omitted, total always) or "{Sicht}: {n} Aufgaben geladen, weitere
 * vorhanden." — or the empty-state text for 0 rows.
 */
export const successAnnouncement = (
  translate: Translate,
  scope: WorkScope,
  items: readonly WorkItem[],
  complete: boolean,
): string => {
  if (complete && items.length === 0) {
    return translate(
      scope === "mine"
        ? "crm.work.states.empty_mine"
        : "crm.work.states.empty_team",
    );
  }
  const view = viewLabel(translate, scope);
  const summary = summarizeWork(items, complete);
  if (!summary.complete) {
    return translate("crm.work.announce.partial", {
      view,
      smart_count: summary.loaded,
    });
  }
  const parts = [
    translate("crm.work.announce.open_count", { smart_count: summary.total }),
  ];
  if (summary.overdue > 0) {
    parts.push(
      translate("crm.work.announce.overdue_count", { count: summary.overdue }),
    );
  }
  if (summary.today > 0) {
    parts.push(
      translate("crm.work.announce.today_count", { count: summary.today }),
    );
  }
  return translate("crm.work.announce.complete", {
    view,
    parts: parts.join(", "),
  });
};

/**
 * What a revalidation is compared on: the `workId` sequence, the group keys
 * and the completeness (§13.5 "Revalidierung mit Änderung"). A day change that
 * only moves rows between groups therefore counts as a change.
 */
export const snapshotSignature = (
  items: readonly WorkItem[],
  complete: boolean,
): string =>
  `${complete ? "c" : "p"}|${items
    .map((item) => `${item.workId}:${workGroupKey(item)}`)
    .join(",")}`;

export type RevalidationOutcome = "changed" | "unchanged-manual" | "silent";

export const revalidationOutcome = (
  previousSignature: string,
  nextSignature: string,
  manual: boolean,
): RevalidationOutcome => {
  if (previousSignature !== nextSignature) return "changed";
  return manual ? "unchanged-manual" : "silent";
};
