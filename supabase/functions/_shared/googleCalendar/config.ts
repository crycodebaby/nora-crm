/**
 * Server-side Google Calendar configuration (Edge Functions only).
 * Never import from frontend code.
 */

export type GoogleCalendarEnv = {
  clientId: string;
  clientSecret: string;
  allowedCalendarId: string;
  redirectUri: string;
  tokenEncryptionKey: Uint8Array;
  tokenKeyVersion: string;
  adminReturnUrl: string;
};

export type GoogleCalendarEnvStatus =
  | { configured: true; env: GoogleCalendarEnv }
  | { configured: false; missing: string[] };

const REQUIRED_KEYS = [
  "GOOGLE_CALENDAR_CLIENT_ID",
  "GOOGLE_CALENDAR_CLIENT_SECRET",
  "GOOGLE_CALENDAR_ALLOWED_ID",
  "GOOGLE_CALENDAR_OAUTH_REDIRECT_URI",
  "GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY",
  "GOOGLE_CALENDAR_TOKEN_KEY_VERSION",
] as const;

const OPTIONAL_KEYS = ["GOOGLE_CALENDAR_ADMIN_RETURN_URL"] as const;

const getEnv = (key: string): string | undefined => {
  if (typeof Deno !== "undefined" && typeof Deno.env?.get === "function") {
    return Deno.env.get(key);
  }
  return process.env[key];
};

const decodeBase64Key = (raw: string): Uint8Array | null => {
  try {
    const normalized = raw.trim();
    const binary = typeof atob === "function"
      ? atob(normalized)
      : Buffer.from(normalized, "base64").toString("binary");
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.length === 32 ? bytes : null;
  } catch {
    return null;
  }
};

export const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events.owned.readonly",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
] as const;

/**
 * calendar.calendarlist.readonly is required server-side only for
 * CalendarList.get on the allowlisted calendar ID (accessRole/owner check).
 * Nora does not expose a calendar picker in the UI.
 */
export const GOOGLE_OAUTH_SCOPE_STRING = GOOGLE_OAUTH_SCOPES.join(" ");

export const readGoogleCalendarEnv = (): GoogleCalendarEnvStatus => {
  const missing: string[] = [];

  for (const key of REQUIRED_KEYS) {
    const value = getEnv(key);
    if (!value || value.trim() === "") {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    return { configured: false, missing: [...missing] };
  }

  const encryptionKeyRaw = getEnv("GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY")!.trim();
  const encryptionKey = decodeBase64Key(encryptionKeyRaw);
  if (!encryptionKey) {
    return {
      configured: false,
      missing: ["GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY (invalid base64 or not 32 bytes)"],
    };
  }

  const adminReturnUrl =
    getEnv("GOOGLE_CALENDAR_ADMIN_RETURN_URL")?.trim() ||
    "http://localhost:5173/google-kalender";

  return {
    configured: true,
    env: {
      clientId: getEnv("GOOGLE_CALENDAR_CLIENT_ID")!.trim(),
      clientSecret: getEnv("GOOGLE_CALENDAR_CLIENT_SECRET")!.trim(),
      allowedCalendarId: getEnv("GOOGLE_CALENDAR_ALLOWED_ID")!.trim(),
      redirectUri: getEnv("GOOGLE_CALENDAR_OAUTH_REDIRECT_URI")!.trim(),
      tokenEncryptionKey: encryptionKey,
      tokenKeyVersion: getEnv("GOOGLE_CALENDAR_TOKEN_KEY_VERSION")!.trim(),
      adminReturnUrl,
    },
  };
};

/** Edge allowlist is authoritative — DB config cannot widen it. */
export const assertAllowedCalendarId = (
  calendarId: string,
  env: GoogleCalendarEnv,
): void => {
  if (calendarId !== env.allowedCalendarId) {
    throw new Error("calendar_id not in server allowlist");
  }
};

export const isAllowedRedirectUri = (
  redirectUri: string,
  env: GoogleCalendarEnv,
): boolean => redirectUri === env.redirectUri;

export const SYNC_PAST_DAYS = 30;
export const SYNC_FUTURE_DAYS = 365;

export { OPTIONAL_KEYS };
