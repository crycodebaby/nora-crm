import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { handleBrevoWebhook } from "./handler.ts";
import type { NormalisedEmailEvent } from "./eventContract.ts";

/**
 * Runtime wiring only — the behaviour lives in ./handler.ts.
 *
 * Fail fast on a missing secret: an endpoint that boots without its token would
 * either reject everything or, worse, invite a future "just skip the check when
 * unset" shortcut. There is no safe default for this value.
 */
const webhookToken = Deno.env.get("BREVO_WEBHOOK_TOKEN");
if (!webhookToken) {
  throw new Error("Missing BREVO_WEBHOOK_TOKEN env variable");
}

/**
 * Ingest goes through the SECURITY DEFINER RPC rather than a direct insert:
 * recipient → employee resolution and duplicate suppression belong together in
 * one statement, and the Edge Function never needs table-level write rights.
 */
async function ingest(
  event: NormalisedEmailEvent,
): Promise<{ stored: boolean }> {
  const { data, error } = await supabaseAdmin.rpc(
    "ingest_email_delivery_event",
    {
      p_provider_event: event.providerEvent,
      p_event_type: event.eventType,
      p_recipient: event.recipient,
      p_event_at: event.eventAt,
      p_dedupe_key: event.dedupeKey,
      p_provider_message_id: event.providerMessageId,
      p_provider_event_id: event.providerEventId,
      p_mail_kind: event.mailKind,
      p_reason: event.reason,
    },
  );

  if (error) {
    console.error(
      JSON.stringify({
        operation: "ingest_email_delivery_event",
        stage: "rpc",
        sqlstate: error.code ?? null,
      }),
    );
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return { stored: row?.stored === true };
}

Deno.serve((req: Request) =>
  handleBrevoWebhook(req, { expectedToken: webhookToken, ingest }),
);
