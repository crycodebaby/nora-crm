import { findDealLabel } from "../deals/dealUtils";
import { formatNoraDate, formatNoraDateTime } from "../misc/noraDateTime";
import type { DealStage } from "../types";
import type { AuditEvent, AuditFieldChange } from "./auditTypes";

export type AuditFormatContext = {
  dealStages?: DealStage[];
  currency?: string;
  translateField?: (field: string) => string;
  translateEvent?: (eventType: string) => string;
};

const isoDateOnlyRegex = /^\d{4}-\d{2}-\d{2}$/;

const NOTE_META_KEYS = new Set([
  "content_changed",
  "old_length",
  "new_length",
  "old_preview",
  "new_preview",
  "old_hash",
  "new_hash",
]);

export const isAuditNoteContentMeta = (
  changes: Record<string, AuditFieldChange>,
) => Object.keys(changes).some((key) => NOTE_META_KEYS.has(key));

export const parseAuditChanges = (
  event: AuditEvent,
): Record<string, AuditFieldChange> => {
  const metadata = event.metadata ?? {};
  const metadataChanges = metadata.changes;

  if (
    metadataChanges &&
    typeof metadataChanges === "object" &&
    !Array.isArray(metadataChanges)
  ) {
    return normalizeChangesRecord(metadataChanges as Record<string, unknown>);
  }

  if (isAuditNoteContentMeta(normalizeChangesRecord(metadata))) {
    return normalizeChangesRecord(metadata);
  }

  const oldData = event.old_data ?? {};
  const newData = event.new_data ?? {};
  const keys = new Set([...Object.keys(oldData), ...Object.keys(newData)]);
  const changes: Record<string, AuditFieldChange> = {};

  for (const key of keys) {
    const oldValue = oldData[key];
    const newValue = newData[key];
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      changes[key] = { old: oldValue ?? null, new: newValue ?? null };
    }
  }

  return changes;
};

const normalizeChangesRecord = (
  raw: Record<string, unknown>,
): Record<string, AuditFieldChange> => {
  const changes: Record<string, AuditFieldChange> = {};

  for (const [field, value] of Object.entries(raw)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const change = value as Record<string, unknown>;
      if ("old" in change || "new" in change) {
        changes[field] = {
          old: change.old ?? null,
          new: change.new ?? null,
        };
        continue;
      }
    }

    changes[field] = { old: null, new: value };
  }

  return changes;
};

export const formatAuditDateTime = (value: string): string =>
  formatNoraDateTime(value);

export const formatAuditFieldValue = (
  field: string,
  value: unknown,
  context: AuditFormatContext = {},
): string => {
  if (value == null || value === "") {
    return "—";
  }

  if (field === "stage" && typeof value === "string") {
    return findDealLabel(context.dealStages ?? [], value) ?? value;
  }

  if (field === "amount" && typeof value === "number") {
    return value.toLocaleString("de-DE", {
      style: "currency",
      currency: context.currency ?? "EUR",
    });
  }

  if (
    (field === "expected_closing_date" ||
      field === "due_date" ||
      field === "done_date" ||
      field === "archived_at") &&
    typeof value === "string"
  ) {
    if (isoDateOnlyRegex.test(value)) {
      return formatNoraDate(value);
    }
    return formatNoraDateTime(value);
  }

  if (typeof value === "boolean") {
    return value ? "Ja" : "Nein";
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join(", ");
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export const formatAuditEventLabel = (
  eventType: string,
  context: AuditFormatContext = {},
): string => context.translateEvent?.(eventType) ?? eventType;

export const formatAuditFieldLabel = (
  field: string,
  context: AuditFormatContext = {},
): string => context.translateField?.(field) ?? field;

export const formatAuditActor = (event: AuditEvent): string => {
  if (event.actor_name_snapshot) {
    return event.actor_name_snapshot;
  }
  if (event.source === "system") {
    return "System";
  }
  return "—";
};

export const formatAuditSource = (
  source: string | null | undefined,
  translate?: (key: string) => string,
): string => {
  if (!source) return "—";
  return translate?.(`crm.audit.sources.${source}`) ?? source;
};

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
