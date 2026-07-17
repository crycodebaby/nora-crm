export type AuditEntityType =
  | "company"
  | "contact"
  | "deal"
  | "task"
  | "contact_note"
  | "deal_note"
  | "sales"
  | "checklist_run"
  | "checklist_run_item"
  | "saved_text_snippet";

export type AuditSource =
  | "user"
  | "system"
  | "edge_function"
  | "migration"
  | "demo";

export type AuditRetentionClass =
  | "crm_change"
  | "security"
  | "user_management"
  | "checklist"
  | "integration"
  | "system";

export type AuditFieldChange = {
  old: unknown;
  new: unknown;
};

export type AuditEvent = {
  id: string;
  created_at: string;
  event_type: string;
  entity_type: AuditEntityType | string;
  actor_id?: string | null;
  actor_sales_id?: number | null;
  actor_name_snapshot?: string | null;
  actor_role_snapshot?: string | null;
  source?: AuditSource | string | null;
  retention_class?: AuditRetentionClass | string | null;
  metadata?: Record<string, unknown> | null;
  company_id?: number | null;
  contact_id?: number | null;
  deal_id?: number | null;
  task_id?: number | null;
  note_id?: number | null;
  /** Legacy rows may still carry full snapshots */
  old_data?: Record<string, unknown> | null;
  new_data?: Record<string, unknown> | null;
};

export type EntityAuditEntityType = "company" | "contact" | "deal";

export type GetEntityAuditEventsParams = {
  entityType: EntityAuditEntityType;
  entityId: number;
  limit?: number;
  before?: string;
};

export type GetEntityAuditEventsResult = {
  data: AuditEvent[];
  limit: number;
};

export type GetGlobalAuditEventsParams = {
  limit?: number;
  before?: string;
  entityType?: string | null;
  eventType?: string | null;
  actorSalesId?: number | null;
  from?: string | null;
  to?: string | null;
  businessNumber?: string | null;
};

export type GetGlobalAuditEventsResult = {
  data: AuditEvent[];
  limit: number;
};

export type AuditStorageStats = {
  event_count: number;
  oldest_event: string | null;
  newest_event: string | null;
  events_last_30_days: number;
  table_bytes: number;
  index_bytes: number;
  total_bytes: number;
  avg_metadata_bytes: number;
  growth_hint: "unauffaellig" | "wachstum_beobachten" | "archivierungsplanung_erforderlich" | string;
  projection_note: string;
};
