import { supabaseAdmin } from "../supabaseAdmin.ts";

export type CalendarAuditMetadata = Record<string, unknown>;

export const writeCalendarAuditEvent = async (args: {
  eventType: string;
  entityId: string;
  metadata?: CalendarAuditMetadata;
}): Promise<void> => {
  const { error } = await supabaseAdmin.rpc("insert_audit_event", {
    p_event_type: args.eventType,
    p_entity_type: "google_calendar_connection",
    p_entity_id: args.entityId,
    p_metadata: args.metadata ?? {},
  });

  if (error) {
    throw error;
  }
};

export const writeCalendarEventImportedAudit = async (args: {
  connectionId: string;
  eventId: string;
  googleEventId: string;
}): Promise<void> => {
  const { error } = await supabaseAdmin.rpc("insert_audit_event", {
    p_event_type: "calendar.event_imported",
    p_entity_type: "google_calendar_event",
    p_entity_id: args.eventId,
    p_metadata: {
      google_event_id: args.googleEventId,
      connection_id: args.connectionId,
    },
  });

  if (error) {
    throw error;
  }
};
