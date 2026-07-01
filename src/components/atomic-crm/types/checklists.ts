import type { RaRecord } from "ra-core";

/** Servicebereich-Codes — nicht mit company_id verwechseln. */
export type ServiceAreaCode = "FENS" | "HAUS" | "IMMO";

export type ChecklistRunStatus = "open" | "completed" | "cancelled";

export type SavedTextSnippetKind =
  | "checklist_item"
  | "task_text"
  | "note_text"
  | "issue_text";

export type ChecklistTemplate = {
  code: string;
  name: string;
  service_area_code: ServiceAreaCode;
  description?: string | null;
  is_active: boolean;
  version: number;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
} & Pick<RaRecord, "id">;

export type ChecklistTemplateItem = {
  template_id: string;
  label: string;
  description?: string | null;
  is_required: boolean;
  sort_index: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
} & Pick<RaRecord, "id">;

export type ChecklistRun = {
  template_id: string;
  deal_id: number;
  company_id?: number | null;
  contact_id?: number | null;
  service_area_code: ServiceAreaCode;
  status: ChecklistRunStatus;
  started_by?: string | null;
  completed_by?: string | null;
  started_at: string;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
} & Pick<RaRecord, "id">;

export type ChecklistRunItem = {
  checklist_run_id: string;
  template_item_id?: string | null;
  label_snapshot: string;
  is_required: boolean;
  is_checked: boolean;
  checked_by?: string | null;
  checked_at?: string | null;
  note?: string | null;
  sort_index: number;
  created_at: string;
  updated_at: string;
} & Pick<RaRecord, "id">;

export type SavedTextSnippet = {
  service_area_code: ServiceAreaCode;
  kind: SavedTextSnippetKind;
  text: string;
  shortcut?: string | null;
  is_active: boolean;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  usage_count: number;
} & Pick<RaRecord, "id">;

export type AuditEvent = {
  actor_id?: string | null;
  event_type: string;
  entity_type: string;
  entity_id: string;
  company_id?: number | null;
  contact_id?: number | null;
  deal_id?: number | null;
  checklist_run_id?: string | null;
  checklist_run_item_id?: string | null;
  old_data?: Record<string, unknown> | null;
  new_data?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
} & Pick<RaRecord, "id">;

/** Seed-Vorlage Produktionsfreigabe Fenster */
export const FENS_PRODUCTION_RELEASE_TEMPLATE_CODE =
  "FENS_PRODUCTION_RELEASE" as const;
