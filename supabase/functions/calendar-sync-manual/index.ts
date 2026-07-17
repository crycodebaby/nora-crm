import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { AuthMiddleware, UserMiddleware } from "../_shared/authentication.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { isActiveAdmin } from "../_shared/googleCalendar/adminAuth.ts";
import { readGoogleCalendarEnv } from "../_shared/googleCalendar/config.ts";
import { runManualReadOnlySync } from "../_shared/googleCalendar/syncManual.ts";

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

        try {
          const summary = await runManualReadOnlySync(envStatus.env);
          return new Response(JSON.stringify({ status: "ok", summary }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (error) {
          const message = error instanceof Error
            ? error.message.slice(0, 200)
            : "sync_failed";
          return new Response(
            JSON.stringify({ status: "error", error: message }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }
      }),
    ),
  );
});
