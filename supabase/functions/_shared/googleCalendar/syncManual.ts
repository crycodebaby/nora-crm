import type { GoogleCalendarEnv } from "./config.ts";
import { SYNC_FUTURE_DAYS, SYNC_PAST_DAYS } from "./config.ts";
import {
  assertConnectionCalendarId,
  getConnectedConnection,
  loadRefreshToken,
  markConnectionError,
  updateConnectionSyncMeta,
  type CalendarConnection,
} from "./connectionStore.ts";
import { listCalendarEvents } from "./googleCalendarApi.ts";
import { refreshAccessToken } from "./googleOAuth.ts";
import {
  isMeaningfulEventChange,
  mapGoogleEventToCacheRow,
} from "./mapGoogleEvent.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import {
  writeCalendarAuditEvent,
  writeCalendarEventImportedAudit,
} from "./calendarAudit.ts";

export type SyncSummary = {
  imported: number;
  updated: number;
  unchanged: number;
  cancelled: number;
  errors: number;
  timeMin: string;
  timeMax: string;
  durationMs: number;
};

const buildSyncWindow = (): { timeMin: string; timeMax: string } => {
  const now = new Date();
  const timeMin = new Date(now);
  timeMin.setUTCDate(timeMin.getUTCDate() - SYNC_PAST_DAYS);
  const timeMax = new Date(now);
  timeMax.setUTCDate(timeMax.getUTCDate() + SYNC_FUTURE_DAYS);
  return {
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
  };
};

const sanitizeSyncError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/refresh_token[=:\s][^\s]+/gi, "[redacted]")
    .replace(/access_token[=:\s][^\s]+/gi, "[redacted]")
    .slice(0, 500);
};

export const runManualReadOnlySync = async (
  env: GoogleCalendarEnv,
): Promise<SyncSummary> => {
  const started = Date.now();
  const connection = await getConnectedConnection();
  if (!connection) {
    throw new Error("no connected calendar");
  }

  assertConnectionCalendarId(connection, env);

  await writeCalendarAuditEvent({
    eventType: "calendar.sync_started",
    entityId: connection.id,
    metadata: {
      calendar_id: env.allowedCalendarId,
    },
  });

  const summary: SyncSummary = {
    imported: 0,
    updated: 0,
    unchanged: 0,
    cancelled: 0,
    errors: 0,
    ...buildSyncWindow(),
    durationMs: 0,
  };

  try {
    const refreshToken = await loadRefreshToken(connection.id, env);
    if (!refreshToken) {
      throw new Error("missing refresh token");
    }

    let accessToken: string;
    try {
      const tokens = await refreshAccessToken(env, refreshToken);
      accessToken = tokens.access_token;
    } catch (error) {
      const code = (error as Error & { code?: string }).code;
      if (code === "invalid_grant") {
        await markConnectionError(connection.id, "refresh token revoked", "token_expired");
      }
      throw error;
    }

    const syncedAt = new Date().toISOString();
    let pageToken: string | undefined;

    do {
      const page = await listCalendarEvents(env, accessToken, {
        timeMin: summary.timeMin,
        timeMax: summary.timeMax,
        pageToken,
      });

      for (const googleEvent of page.items) {
        try {
          const mapped = mapGoogleEventToCacheRow(googleEvent, syncedAt);
          if (!mapped) {
            summary.errors += 1;
            continue;
          }

          if (mapped.deleted_at) {
            summary.cancelled += 1;
          }

          const { data: existing, error: existingError } = await supabaseAdmin
            .from("google_calendar_events")
            .select("id, google_etag, google_updated_at, title_snapshot, location_snapshot, google_status, deleted_at")
            .eq("connection_id", connection.id)
            .eq("google_event_id", mapped.google_event_id)
            .maybeSingle();

          if (existingError) {
            throw existingError;
          }

          if (!existing) {
            const { data: inserted, error: insertError } = await supabaseAdmin
              .from("google_calendar_events")
              .insert({
                connection_id: connection.id,
                ...mapped,
              })
              .select("id")
              .single();

            if (insertError) {
              throw insertError;
            }

            summary.imported += 1;
            await writeCalendarEventImportedAudit({
              connectionId: connection.id,
              eventId: inserted.id,
              googleEventId: mapped.google_event_id,
            });
            continue;
          }

          if (!isMeaningfulEventChange(existing, mapped)) {
            summary.unchanged += 1;
            continue;
          }

          const { error: updateError } = await supabaseAdmin
            .from("google_calendar_events")
            .update({
              google_ical_uid: mapped.google_ical_uid,
              google_etag: mapped.google_etag,
              google_status: mapped.google_status,
              title_snapshot: mapped.title_snapshot,
              description_snapshot: mapped.description_snapshot,
              location_snapshot: mapped.location_snapshot,
              html_link: mapped.html_link,
              is_all_day: mapped.is_all_day,
              starts_at: mapped.starts_at,
              ends_at: mapped.ends_at,
              start_date: mapped.start_date,
              end_date: mapped.end_date,
              timezone: mapped.timezone,
              recurring_event_id: mapped.recurring_event_id,
              original_start_at: mapped.original_start_at,
              google_updated_at: mapped.google_updated_at,
              deleted_at: mapped.deleted_at,
              last_synced_at: mapped.last_synced_at,
            })
            .eq("id", existing.id);

          if (updateError) {
            throw updateError;
          }

          summary.updated += 1;
        } catch {
          summary.errors += 1;
        }
      }

      pageToken = page.nextPageToken;
    } while (pageToken);

    summary.durationMs = Date.now() - started;

    await updateConnectionSyncMeta(connection.id, {
      last_sync_at: new Date().toISOString(),
      last_sync_error: null,
    });

    await writeCalendarAuditEvent({
      eventType: "calendar.sync_completed",
      entityId: connection.id,
      metadata: {
        imported: summary.imported,
        updated: summary.updated,
        unchanged: summary.unchanged,
        cancelled: summary.cancelled,
        errors: summary.errors,
        time_min: summary.timeMin,
        time_max: summary.timeMax,
        duration_ms: summary.durationMs,
      },
    });

    return summary;
  } catch (error) {
    const message = sanitizeSyncError(error);
    await updateConnectionSyncMeta(connection.id, {
      last_sync_error: message,
    });
    await writeCalendarAuditEvent({
      eventType: "calendar.sync_failed",
      entityId: connection.id,
      metadata: {
        reason: message,
      },
    });
    throw error;
  }
};

export const getConnectionForAdmin = async (): Promise<CalendarConnection | null> =>
  await getConnectedConnection();
