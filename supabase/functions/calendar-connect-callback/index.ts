import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import {
  assertAllowedCalendarId,
  readGoogleCalendarEnv,
} from "../_shared/googleCalendar/config.ts";
import { consumeOAuthState } from "../_shared/googleCalendar/oauthState.ts";
import {
  exchangeAuthorizationCode,
  fetchGoogleEmail,
} from "../_shared/googleCalendar/googleOAuth.ts";
import { verifyAllowlistedCalendarAccess } from "../_shared/googleCalendar/googleCalendarApi.ts";
import { loadRefreshToken, markConnectionConnected,
  markConnectionError,
  storeRefreshToken,
  upsertConnectingConnection,
} from "../_shared/googleCalendar/connectionStore.ts";
import { writeCalendarAuditEvent } from "../_shared/googleCalendar/calendarAudit.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const redirectWithStatus = (
  baseUrl: string,
  status: "connected" | "error",
  reason?: string,
): Response => {
  const url = new URL(baseUrl);
  url.searchParams.set("calendar", status);
  if (reason) {
    url.searchParams.set("reason", reason.slice(0, 120));
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      ...corsHeaders,
    },
  });
};

const sanitizeReason = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "oauth_failed";
  return message
    .replace(/refresh_token[=:\s][^\s]+/gi, "[redacted]")
    .replace(/access_token[=:\s][^\s]+/gi, "[redacted]")
    .slice(0, 200);
};

Deno.serve(async (req: Request) => {
  return OptionsMiddleware(req, async (req) => {
    if (req.method !== "GET") {
      return createErrorResponse(405, "Method not allowed");
    }

    const envStatus = readGoogleCalendarEnv();
    if (!envStatus.configured) {
      return createErrorResponse(503, "Google Calendar not configured");
    }

    const url = new URL(req.url);
    const oauthError = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (oauthError) {
      return redirectWithStatus(envStatus.env.adminReturnUrl, "error", oauthError);
    }

    if (!code || !state) {
      return redirectWithStatus(
        envStatus.env.adminReturnUrl,
        "error",
        "missing_oauth_parameters",
      );
    }

    let connectionId: string | null = null;

    try {
      const consumed = await consumeOAuthState(state);
      if (!consumed) {
        return redirectWithStatus(
          envStatus.env.adminReturnUrl,
          "error",
          "invalid_oauth_state",
        );
      }

      const tokens = await exchangeAuthorizationCode(
        envStatus.env,
        code,
        consumed.pkceVerifier,
      );

      assertAllowedCalendarId(envStatus.env.allowedCalendarId, envStatus.env);

      const { calendarName, accessRole } = await verifyAllowlistedCalendarAccess(
        envStatus.env,
        tokens.access_token,
      );

      const connection = await upsertConnectingConnection(
        envStatus.env,
        consumed.userId,
      );
      connectionId = connection.id;

      if (tokens.refresh_token) {
        await storeRefreshToken(
          connection.id,
          tokens.refresh_token,
          envStatus.env,
          false,
        );
      } else {
        const existingRefresh = await loadRefreshToken(connection.id, envStatus.env);
        if (!existingRefresh) {
          throw new Error("missing refresh token from Google consent");
        }
      }

      const googleEmail = await fetchGoogleEmail(
        tokens.access_token,
        tokens.id_token,
      );

      const scopes = tokens.scope?.split(" ").filter(Boolean) ?? [];

      await markConnectionConnected({
        connectionId: connection.id,
        env: envStatus.env,
        googleAccountEmail: googleEmail,
        calendarName,
        scopesGranted: scopes.length > 0 ? scopes : ["openid", "email"],
      });

      await writeCalendarAuditEvent({
        eventType: "calendar.connected",
        entityId: connection.id,
        metadata: {
          calendar_id: envStatus.env.allowedCalendarId,
          calendar_name: calendarName,
          access_role: accessRole,
          google_account_email: googleEmail,
        },
      });

      return redirectWithStatus(envStatus.env.adminReturnUrl, "connected");
    } catch (error) {
      const reason = sanitizeReason(error);

      if (connectionId) {
        await markConnectionError(connectionId, reason, "error");
        await writeCalendarAuditEvent({
          eventType: "calendar.sync_failed",
          entityId: connectionId,
          metadata: { phase: "oauth_callback", reason },
        });
      } else {
        const { data } = await supabaseAdmin
          .from("google_calendar_connections")
          .select("id")
          .eq("status", "connecting")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data?.id) {
          await markConnectionError(data.id, reason, "error");
        }
      }

      return redirectWithStatus(envStatus.env.adminReturnUrl, "error", reason);
    }
  });
});
