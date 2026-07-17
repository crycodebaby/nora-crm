import type { GoogleCalendarEnv } from "./config.ts";
import { assertAllowedCalendarId } from "./config.ts";

export type GoogleCalendarListEntry = {
  id: string;
  summary?: string;
  accessRole?: string;
};

export type GoogleEventDateTime = {
  date?: string;
  dateTime?: string;
  timeZone?: string;
};

export type GoogleCalendarEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  etag?: string;
  iCalUID?: string;
  updated?: string;
  recurringEventId?: string;
  originalStartTime?: GoogleEventDateTime;
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
};

const googleFetch = async <T>(
  url: string,
  accessToken: string,
): Promise<T> => {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`google_api_${response.status}: ${text.slice(0, 200)}`);
  }
  return await response.json() as T;
};

export const verifyAllowlistedCalendarAccess = async (
  env: GoogleCalendarEnv,
  accessToken: string,
): Promise<{ calendarName: string; accessRole: string }> => {
  assertAllowedCalendarId(env.allowedCalendarId, env);

  const url =
    `https://www.googleapis.com/calendar/v3/users/me/calendarList/${encodeURIComponent(env.allowedCalendarId)}`;

  const entry = await googleFetch<GoogleCalendarListEntry>(url, accessToken);

  if (entry.id !== env.allowedCalendarId) {
    throw new Error("calendar_id mismatch from CalendarList.get");
  }

  const role = entry.accessRole ?? "unknown";
  if (!["owner", "writer", "reader"].includes(role)) {
    throw new Error(`insufficient calendar access role: ${role}`);
  }

  return {
    calendarName: entry.summary ?? env.allowedCalendarId,
    accessRole: role,
  };
};

export const listCalendarEvents = async (
  env: GoogleCalendarEnv,
  accessToken: string,
  options: {
    timeMin: string;
    timeMax: string;
    pageToken?: string;
  },
): Promise<{ items: GoogleCalendarEvent[]; nextPageToken?: string }> => {
  assertAllowedCalendarId(env.allowedCalendarId, env);

  const params = new URLSearchParams({
    timeMin: options.timeMin,
    timeMax: options.timeMax,
    singleEvents: "true",
    showDeleted: "true",
    maxResults: "250",
    orderBy: "startTime",
  });
  if (options.pageToken) {
    params.set("pageToken", options.pageToken);
  }

  const url =
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.allowedCalendarId)}/events?${params.toString()}`;

  const data = await googleFetch<{
    items?: GoogleCalendarEvent[];
    nextPageToken?: string;
  }>(url, accessToken);

  return {
    items: data.items ?? [],
    nextPageToken: data.nextPageToken,
  };
};

/** Ensure we never call Google write endpoints in v0.4c.2 */
export const assertReadOnlyGoogleMethod = (method: string): void => {
  if (method !== "GET") {
    throw new Error("google write methods are forbidden in read-only phase");
  }
};
