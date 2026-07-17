import { subDays, subHours } from "date-fns";

import type { AuditEvent } from "../../../audit/auditTypes";

const iso = (date: Date) => date.toISOString();

/** Synthetic audit trail for FakeRest demo (source=demo). */
export const NORA_DEMO_AUDIT_EVENTS: AuditEvent[] = [
  {
    id: "demo-audit-001",
    created_at: iso(subHours(new Date(), 2)),
    event_type: "deal.status_changed",
    entity_type: "deal",
    actor_sales_id: 0,
    actor_name_snapshot: "Anna Admin",
    actor_role_snapshot: "admin",
    source: "demo",
    retention_class: "crm_change",
    company_id: 0,
    deal_id: 0,
    metadata: {
      changes: {
        stage: { old: "neue-anfrage", new: "angebot-gesendet" },
      },
      case_number: "2026-0001",
      customer_number: "K-2026-0001",
    },
  },
  {
    id: "demo-audit-002",
    created_at: iso(subDays(new Date(), 1)),
    event_type: "deal.updated",
    entity_type: "deal",
    actor_sales_id: 1,
    actor_name_snapshot: "Otto Office",
    actor_role_snapshot: "office",
    source: "demo",
    retention_class: "crm_change",
    company_id: 0,
    deal_id: 0,
    metadata: {
      changes: {
        amount: { old: 0, new: 4200 },
        expected_closing_date: { old: null, new: "2026-08-01" },
      },
      case_number: "2026-0001",
      customer_number: "K-2026-0001",
    },
  },
  {
    id: "demo-audit-003",
    created_at: iso(subDays(new Date(), 3)),
    event_type: "contact.created",
    entity_type: "contact",
    actor_sales_id: 1,
    actor_name_snapshot: "Otto Office",
    actor_role_snapshot: "office",
    source: "demo",
    retention_class: "crm_change",
    company_id: 0,
    contact_id: 0,
    metadata: {
      customer_number: "K-2026-0001",
    },
  },
  {
    id: "demo-audit-004",
    created_at: iso(subDays(new Date(), 5)),
    event_type: "company.updated",
    entity_type: "company",
    actor_sales_id: 0,
    actor_name_snapshot: "Anna Admin",
    actor_role_snapshot: "admin",
    source: "demo",
    retention_class: "crm_change",
    company_id: 0,
    metadata: {
      changes: {
        phone_number: { old: "+49 211 123400", new: "+49 211 123401" },
      },
      customer_number: "K-2026-0001",
    },
  },
  {
    id: "demo-audit-005",
    created_at: iso(subDays(new Date(), 7)),
    event_type: "company.created",
    entity_type: "company",
    actor_sales_id: 0,
    actor_name_snapshot: "Anna Admin",
    actor_role_snapshot: "admin",
    source: "demo",
    retention_class: "crm_change",
    company_id: 0,
    metadata: {
      customer_number: "K-2026-0001",
    },
  },
  {
    id: "demo-audit-006",
    created_at: iso(subDays(new Date(), 2)),
    event_type: "task.completed",
    entity_type: "task",
    actor_sales_id: 1,
    actor_name_snapshot: "Otto Office",
    actor_role_snapshot: "office",
    source: "demo",
    retention_class: "crm_change",
    company_id: 0,
    contact_id: 0,
    task_id: 0,
  },
  {
    id: "demo-audit-007",
    created_at: iso(subDays(new Date(), 4)),
    event_type: "deal_note.created",
    entity_type: "deal_note",
    actor_sales_id: 0,
    actor_name_snapshot: "Anna Admin",
    actor_role_snapshot: "admin",
    source: "demo",
    retention_class: "crm_change",
    company_id: 0,
    deal_id: 0,
    note_id: 0,
    metadata: {
      content_changed: true,
      old_length: 0,
      new_length: 42,
      old_preview: "",
      new_preview: "Kunde wünscht Rückruf wegen Fenstermassnahme EG",
      case_number: "2026-0001",
    },
  },
  {
    id: "demo-audit-008",
    created_at: iso(subDays(new Date(), 10)),
    event_type: "deal.created",
    entity_type: "deal",
    actor_sales_id: 1,
    actor_name_snapshot: "Otto Office",
    actor_role_snapshot: "office",
    source: "demo",
    retention_class: "crm_change",
    company_id: 1,
    deal_id: 1,
    metadata: {
      case_number: "2026-0002",
      customer_number: "K-2026-0002",
    },
  },
];

export const filterDemoEntityAuditEvents = (
  entityType: "company" | "contact" | "deal",
  entityId: number,
  limit: number,
  before?: string,
): AuditEvent[] => {
  const filtered = NORA_DEMO_AUDIT_EVENTS.filter((event) => {
    if (entityType === "company") return event.company_id === entityId;
    if (entityType === "contact") return event.contact_id === entityId;
    return event.deal_id === entityId;
  })
    .filter((event) => !before || event.created_at < before)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return filtered.slice(0, limit);
};

export const filterDemoGlobalAuditEvents = (params: {
  limit: number;
  before?: string;
  entityType?: string | null;
  eventType?: string | null;
  actorSalesId?: number | null;
  from?: string | null;
  to?: string | null;
  businessNumber?: string | null;
}): AuditEvent[] => {
  const {
    limit,
    before,
    entityType,
    eventType,
    actorSalesId,
    from,
    to,
    businessNumber,
  } = params;

  const needle = businessNumber?.trim().toLowerCase();

  return NORA_DEMO_AUDIT_EVENTS.filter((event) => {
    if (before && event.created_at >= before) return false;
    if (entityType && event.entity_type !== entityType) return false;
    if (eventType && event.event_type !== eventType) return false;
    if (actorSalesId != null && event.actor_sales_id !== actorSalesId) {
      return false;
    }
    if (from && event.created_at < from) return false;
    if (to && event.created_at > to) return false;
    if (needle) {
      const meta = event.metadata ?? {};
      const cn = String(meta.customer_number ?? "").toLowerCase();
      const caseNo = String(meta.case_number ?? "").toLowerCase();
      if (!cn.includes(needle) && !caseNo.includes(needle)) return false;
    }
    return true;
  })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);
};

export const getDemoAuditStorageStats = () => ({
  event_count: NORA_DEMO_AUDIT_EVENTS.length,
  oldest_event:
    NORA_DEMO_AUDIT_EVENTS[NORA_DEMO_AUDIT_EVENTS.length - 1]?.created_at ??
    null,
  newest_event: NORA_DEMO_AUDIT_EVENTS[0]?.created_at ?? null,
  events_last_30_days: NORA_DEMO_AUDIT_EVENTS.length,
  table_bytes: 48_000,
  index_bytes: 12_000,
  total_bytes: 60_000,
  avg_metadata_bytes: 180,
  growth_hint: "unauffaellig" as const,
  projection_note:
    "Schaetzung: bei gleichbleibendem Tempo ~96 Ereignisse/Jahr (nur Indikator, Demo-Daten).",
});
