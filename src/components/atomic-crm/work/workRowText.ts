/**
 * Text helpers of an Arbeitskorb row: group labels, spoken due text, holder
 * text, context labels and context destinations. Presentation only — they
 * translate row-view tokens, never Work facts.
 */
import type { TranslateFunction as Translate } from "ra-core";

import { noraCreatePath } from "../routing/noraRoutes";
import type { ContextName } from "./useWorkContextNames";
import type { WorkGroupKey, WorkRowView } from "./workRowView";

export type ContextKind = "customer" | "contact";

export const GROUP_LABEL_KEYS: Record<WorkGroupKey, string> = {
  overdue: "crm.work.groups.overdue",
  today: "crm.work.groups.today",
  upcoming: "crm.work.groups.upcoming",
  none: "crm.work.groups.none",
};

export const titleId = (workId: string) => `arbeitskorb-titel-${workId}`;

/** Long, spoken due text: "Überfällig, Freitag, 10. Oktober 2026" (§13.2). */
export const spokenDue = (translate: Translate, row: WorkRowView): string => {
  const group = translate(GROUP_LABEL_KEYS[row.group]);
  const date =
    row.due.kind === "date"
      ? row.due.long
      : row.due.kind === "none"
        ? translate("crm.work.date.none")
        : translate("crm.work.date.unreadable");
  const parts = group === date ? [group] : [group, date];
  if (row.alsoDueToday) parts.push(translate("crm.work.due_today_too"));
  return parts.join(", ");
};

export const holderText = (
  translate: Translate,
  holder: NonNullable<WorkRowView["holder"]>,
): string => {
  switch (holder.kind) {
    case "me":
      return translate("crm.work.holder.me");
    case "unassigned":
      return translate("crm.work.holder.unassigned");
    case "named":
      return holder.name;
    case "unnamed":
      return translate("crm.work.holder.unnamed");
    case "unknown":
      return translate("crm.work.holder.unknown");
  }
};

/** Visible text and accessible name of a context reference (§7). */
export const contextLabel = (
  translate: Translate,
  kind: ContextKind,
  name: ContextName,
): { visible: string; prefix: string | null; accessible: string | null } => {
  switch (name.kind) {
    case "named":
      return {
        visible: name.name,
        prefix: translate(`crm.work.context.${kind}_prefix`),
        accessible: null,
      };
    case "pending":
      return {
        visible: translate(`crm.work.context.${kind}_pending`),
        prefix: null,
        accessible: translate(`crm.work.context.${kind}_pending_label`),
      };
    case "failed":
      return {
        visible: translate(`crm.work.context.${kind}_failed`),
        prefix: null,
        accessible: null,
      };
    case "missing":
      return {
        visible: translate(`crm.work.context.${kind}_missing`),
        prefix: null,
        accessible: null,
      };
    case "empty":
      return {
        visible: translate(`crm.work.context.${kind}_empty`),
        prefix: null,
        accessible: null,
      };
  }
};

/** Customer destination on desktop: the customer record's task tab. */
export const customerTasksPath = (customerId: number) =>
  `${noraCreatePath({ resource: "companies", type: "show", id: customerId })}/tasks`;
export const customerPath = (customerId: number) =>
  noraCreatePath({ resource: "companies", type: "show", id: customerId });
export const contactPath = (contactId: number) =>
  noraCreatePath({ resource: "contacts", type: "show", id: contactId });
