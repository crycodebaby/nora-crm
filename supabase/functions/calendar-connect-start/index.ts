import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { AuthMiddleware, UserMiddleware } from "../_shared/authentication.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { isActiveAdmin } from "../_shared/googleCalendar/adminAuth.ts";
import {
  GOOGLE_OAUTH_SCOPE_STRING,
  readGoogleCalendarEnv,
} from "../_shared/googleCalendar/config.ts";
import { createOAuthState } from "../_shared/googleCalendar/oauthState.ts";
import { upsertConnectingConnection } from "../_shared/googleCalendar/connectionStore.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const syncAllowlistToConfiguration = async (
  calendarId: string,
): Promise<void> => {
  const { data } = await supabaseAdmin
    .from("configuration")
    .select("config")
    .eq("id", 1)
    .maybeSingle();

  const config = (data?.config ?? {}) as Record<string, unknown>;
  const googleCalendar = (config.google_calendar ?? {}) as Record<
    string,
    unknown
  >;

  await supabaseAdmin.from("configuration").upsert({
    id: 1,
    config: {
      ...config,
      google_calendar: {
        ...googleCalendar,
        allowed_calendar_ids: [calendarId],
      },
    },
  });
};

Deno.serve(async (req: Request) => {
  return OptionsMiddleware(req, async (req) =>
    AuthMiddleware(req, async (req) =>
      UserMiddleware(req, async (req, user) => {
        if (req.method !== "POST") {
          return createErrorResponse(405, "Method not allowed");
        }

        if (!user) {
          return createErrorResponse(401, "Unauthorized");
        }

        const admin = await isActiveAdmin(user);
        if (!admin.ok) {
          return createErrorResponse(403, "Admin only");
        }

        const envStatus = readGoogleCalendarEnv();
        if (!envStatus.configured) {
          return new Response(
            JSON.stringify({
              error: "google_calendar_not_configured",
              missing: envStatus.missing,
            }),
            {
              status: 503,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }

        await syncAllowlistToConfiguration(envStatus.env.allowedCalendarId);
        await upsertConnectingConnection(envStatus.env, user.id);

        const { state, pkceChallenge } = await createOAuthState(user.id);
        const params = new URLSearchParams({
          client_id: envStatus.env.clientId,
          redirect_uri: envStatus.env.redirectUri,
          response_type: "code",
          scope: GOOGLE_OAUTH_SCOPE_STRING,
          access_type: "offline",
          prompt: "consent",
          include_granted_scopes: "true",
          state,
          code_challenge: pkceChallenge,
          code_challenge_method: "S256",
        });

        return new Response(
          JSON.stringify({
            authorization_url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }),
    ),
  );
});
