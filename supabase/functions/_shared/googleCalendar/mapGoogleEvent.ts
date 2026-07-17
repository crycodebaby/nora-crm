import type { GoogleCalendarEvent } from "./googleCalendarApi.ts";

export type MappedGoogleEvent = {
  google_event_id: string;
  google_ical_uid: string | null;
  google_etag: string | null;
  origin: "google";
  google_status: string | null;
  title_snapshot: string | null;
  description_snapshot: string | null;
  location_snapshot: string | null;
  html_link: string | null;
  is_all_day: boolean;
  starts_at: string | null;
  ends_at: string | null;
  start_date: string | null;
  end_date: string | null;
  timezone: string | null;
  recurring_event_id: string | null;
  original_start_at: string | null;
  google_updated_at: string | null;
  deleted_at: string | null;
  last_synced_at: string;
};

const stripHtml = (value: string): string =>
  value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const minimizeDescription = (
  description?: string | null,
): string | null => {
  if (!description) {
    return null;
  }
  const plain = stripHtml(description);
  if (!plain) {
    return null;
  }
  return plain.slice(0, 500);
};

const parseOriginalStart = (event: GoogleCalendarEvent): string | null => {
  const value = event.originalStartTime;
  if (!value) {
    return null;
  }
  if (value.dateTime) {
    return value.dateTime;
  }
  if (value.date) {
    return `${value.date}T00:00:00.000Z`;
  }
  return null;
};

/** Google all-day end dates are exclusive — store inclusive end_date for Nora constraint. */
const inclusiveAllDayEnd = (exclusiveEnd?: string): string | null => {
  if (!exclusiveEnd) {
    return null;
  }
  const date = new Date(`${exclusiveEnd}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
};

export const mapGoogleEventToCacheRow = (
  event: GoogleCalendarEvent,
  syncedAt: string,
): MappedGoogleEvent | null => {
  if (!event.id) {
    return null;
  }

  const isAllDay = Boolean(event.start?.date);
  const cancelled = event.status === "cancelled";

  if (isAllDay) {
    const startDate = event.start?.date ?? null;
    const endDate = inclusiveAllDayEnd(event.end?.date);
    if (!startDate || !endDate) {
      return null;
    }

    return {
      google_event_id: event.id,
      google_ical_uid: event.iCalUID ?? null,
      google_etag: event.etag ?? null,
      origin: "google",
      google_status: event.status ?? null,
      title_snapshot: event.summary ?? null,
      description_snapshot: minimizeDescription(event.description),
      location_snapshot: event.location ?? null,
      html_link: event.htmlLink ?? null,
      is_all_day: true,
      starts_at: null,
      ends_at: null,
      start_date: startDate,
      end_date: endDate,
      timezone: event.start?.timeZone ?? null,
      recurring_event_id: event.recurringEventId ?? null,
      original_start_at: parseOriginalStart(event),
      google_updated_at: event.updated ?? null,
      deleted_at: cancelled ? syncedAt : null,
      last_synced_at: syncedAt,
    };
  }

  const startsAt = event.start?.dateTime;
  const endsAt = event.end?.dateTime;
  if (!startsAt || !endsAt) {
    return null;
  }

  return {
    google_event_id: event.id,
    google_ical_uid: event.iCalUID ?? null,
    google_etag: event.etag ?? null,
    origin: "google",
    google_status: event.status ?? null,
    title_snapshot: event.summary ?? null,
    description_snapshot: minimizeDescription(event.description),
    location_snapshot: event.location ?? null,
    html_link: event.htmlLink ?? null,
    is_all_day: false,
    starts_at: startsAt,
    ends_at: endsAt,
    start_date: null,
    end_date: null,
    timezone: event.start?.timeZone ?? event.end?.timeZone ?? null,
    recurring_event_id: event.recurringEventId ?? null,
    original_start_at: parseOriginalStart(event),
    google_updated_at: event.updated ?? null,
    deleted_at: cancelled ? syncedAt : null,
    last_synced_at: syncedAt,
  };
};

export const isMeaningfulEventChange = (
  existing: {
    google_etag: string | null;
    google_updated_at: string | null;
    title_snapshot: string | null;
    location_snapshot: string | null;
    google_status: string | null;
    deleted_at: string | null;
  },
  mapped: MappedGoogleEvent,
): boolean => {
  if (existing.google_etag && mapped.google_etag) {
    return existing.google_etag !== mapped.google_etag;
  }
  if (existing.google_updated_at && mapped.google_updated_at) {
    return existing.google_updated_at !== mapped.google_updated_at;
  }
  return (
    existing.title_snapshot !== mapped.title_snapshot ||
    existing.location_snapshot !== mapped.location_snapshot ||
    existing.google_status !== mapped.google_status ||
    Boolean(existing.deleted_at) !== Boolean(mapped.deleted_at)
  );
};
