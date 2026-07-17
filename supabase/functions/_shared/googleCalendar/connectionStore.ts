import { supabaseAdmin } from "../supabaseAdmin.ts";
import type { GoogleCalendarEnv } from "./config.ts";
import { assertAllowedCalendarId } from "./config.ts";
import {
  decryptSecret,
  encryptSecret,
  type EncryptedPayload,
} from "./tokenEncryption.ts";

export type CalendarConnection = {
  id: string;
  calendar_id: string;
  calendar_name: string | null;
  google_account_email: string | null;
  status: string;
  scopes_granted: string[];
  connected_by: string | null;
  connected_at: string | null;
  last_sync_at: string | null;
  last_sync_error: string | null;
};

export const getConnectedConnection =
  async (): Promise<CalendarConnection | null> => {
    const { data, error } = await supabaseAdmin
      .from("google_calendar_connections")
      .select("*")
      .eq("status", "connected")
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data as CalendarConnection | null;
  };

export const upsertConnectingConnection = async (
  env: GoogleCalendarEnv,
  userId: string,
): Promise<CalendarConnection> => {
  assertAllowedCalendarId(env.allowedCalendarId, env);

  const existing = await getConnectedConnection();
  if (existing) {
    throw new Error("calendar already connected");
  }

  const { data: rows, error: selectError } = await supabaseAdmin
    .from("google_calendar_connections")
    .select("*")
    .in("status", ["connecting", "disconnected", "error", "token_expired"])
    .order("updated_at", { ascending: false })
    .limit(1);

  if (selectError) {
    throw selectError;
  }

  const row = rows?.[0];
  if (row) {
    const { data, error } = await supabaseAdmin
      .from("google_calendar_connections")
      .update({
        calendar_id: env.allowedCalendarId,
        status: "connecting",
        connected_by: userId,
        last_sync_error: null,
      })
      .eq("id", row.id)
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return data as CalendarConnection;
  }

  const { data, error } = await supabaseAdmin
    .from("google_calendar_connections")
    .insert({
      calendar_id: env.allowedCalendarId,
      status: "connecting",
      connected_by: userId,
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data as CalendarConnection;
};

export const markConnectionConnected = async (args: {
  connectionId: string;
  env: GoogleCalendarEnv;
  googleAccountEmail: string | null;
  calendarName: string;
  scopesGranted: string[];
}): Promise<void> => {
  assertAllowedCalendarId(args.env.allowedCalendarId, args.env);

  const { error } = await supabaseAdmin
    .from("google_calendar_connections")
    .update({
      calendar_id: args.env.allowedCalendarId,
      calendar_name: args.calendarName,
      google_account_email: args.googleAccountEmail,
      status: "connected",
      scopes_granted: args.scopesGranted,
      connected_at: new Date().toISOString(),
      disconnected_at: null,
      last_sync_error: null,
    })
    .eq("id", args.connectionId);

  if (error) {
    throw error;
  }
};

export const markConnectionError = async (
  connectionId: string,
  message: string,
  status: "error" | "token_expired" = "error",
): Promise<void> => {
  const { error } = await supabaseAdmin
    .from("google_calendar_connections")
    .update({
      status,
      last_sync_error: message.slice(0, 500),
    })
    .eq("id", connectionId);

  if (error) {
    throw error;
  }
};

export const storeRefreshToken = async (
  connectionId: string,
  refreshToken: string,
  env: GoogleCalendarEnv,
  preserveExisting = false,
): Promise<void> => {
  if (preserveExisting) {
    const existing = await loadRefreshToken(connectionId, env);
    if (existing) {
      return;
    }
  }

  const encrypted = await encryptSecret(
    refreshToken,
    env.tokenEncryptionKey,
    env.tokenKeyVersion,
  );

  const { error } = await supabaseAdmin.rpc(
    "store_google_calendar_refresh_token",
    {
      p_connection_id: connectionId,
      p_ciphertext: encrypted.ciphertext,
      p_nonce: encrypted.nonce,
      p_key_version: encrypted.keyVersion,
      p_preserve_existing: preserveExisting,
    },
  );

  if (error) {
    throw error;
  }
};

export const loadRefreshToken = async (
  connectionId: string,
  env: GoogleCalendarEnv,
): Promise<string | null> => {
  const { data, error } = await supabaseAdmin.rpc(
    "load_google_calendar_refresh_token",
    { p_connection_id: connectionId },
  );

  if (error) {
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.refresh_token_ciphertext || !row?.nonce) {
    return null;
  }

  const payload: EncryptedPayload = {
    ciphertext: row.refresh_token_ciphertext,
    nonce: row.nonce,
    keyVersion: row.encryption_key_id,
  };

  return await decryptSecret(payload, env.tokenEncryptionKey);
};

export const updateConnectionSyncMeta = async (
  connectionId: string,
  fields: {
    last_sync_at?: string;
    last_sync_error?: string | null;
  },
): Promise<void> => {
  const { error } = await supabaseAdmin
    .from("google_calendar_connections")
    .update(fields)
    .eq("id", connectionId);

  if (error) {
    throw error;
  }
};

export const assertConnectionCalendarId = (
  connection: CalendarConnection,
  env: GoogleCalendarEnv,
): void => {
  assertAllowedCalendarId(connection.calendar_id, env);
  if (connection.calendar_id !== env.allowedCalendarId) {
    throw new Error("connection calendar_id does not match server allowlist");
  }
};
