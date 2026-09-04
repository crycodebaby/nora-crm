/**
 * Transactional email delivery webhook (Nora Employee Access V1C-A).
 *
 * Everything except the runtime wiring lives here so the endpoint's behaviour
 * — authentication, contract mapping, idempotency, batch handling — is unit
 * testable without a Deno server or a database.
 *
 * Response policy, which matters because the caller retries on its own:
 *   401  bad/missing webhook credential      — never retried into success
 *   405  wrong method
 *   400  payload we can never make sense of  — retrying would not help
 *   500  we accepted the payload but failed to persist it — retry is correct
 *   200  everything understood; ignored and duplicate events count as handled
 */

import {
  extractEventPayloads,
  normaliseProviderEvent,
  type NormalisedEmailEvent,
} from "./eventContract.ts";
import { authenticateWebhookRequest } from "./webhookAuth.ts";

/** Persists one normalised event. Returns false when it was already stored. */
export type IngestEvent = (
  event: NormalisedEmailEvent,
) => Promise<{ stored: boolean }>;

export type HandlerDeps = {
  expectedToken: string;
  ingest: IngestEvent;
};

/**
 * Upper bound on one webhook delivery. Batched mode sends many events per call;
 * an unbounded loop here would turn a single request into arbitrary database
 * work. Anything beyond this is rejected rather than silently truncated.
 */
export const MAX_EVENTS_PER_REQUEST = 500;

export type WebhookSummary = {
  received: number;
  stored: number;
  duplicate: number;
  ignored: number;
  malformed: number;
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handleBrevoWebhook(
  req: Request,
  deps: HandlerDeps,
): Promise<Response> {
  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }

  const auth = await authenticateWebhookRequest(req, deps.expectedToken);
  if (!auth.ok) {
    // The reason is logged, never returned: an unauthenticated caller learns
    // nothing about whether a token was present or merely wrong.
    console.error(
      JSON.stringify({
        operation: "brevo_email_events",
        stage: "auth",
        error: auth.reason,
      }),
    );
    return json(401, { error: "unauthorized" });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_payload" });
  }

  const payloads = extractEventPayloads(body);
  if (!payloads) {
    return json(400, { error: "invalid_payload" });
  }
  if (payloads.length > MAX_EVENTS_PER_REQUEST) {
    return json(400, { error: "batch_too_large" });
  }

  const summary: WebhookSummary = {
    received: payloads.length,
    stored: 0,
    duplicate: 0,
    ignored: 0,
    malformed: 0,
  };
  let ingestFailed = false;

  for (const payload of payloads) {
    const result = normaliseProviderEvent(payload);

    if (result.status === "ignored") {
      // Tracking events and unknown future event names are accepted and
      // dropped. Nothing about them is persisted.
      summary.ignored += 1;
      continue;
    }

    if (result.status === "malformed") {
      // One unusable item must not discard the rest of a batch.
      summary.malformed += 1;
      console.error(
        JSON.stringify({
          operation: "brevo_email_events",
          stage: "normalise",
          error: result.why,
        }),
      );
      continue;
    }

    try {
      const { stored } = await deps.ingest(result.event);
      if (stored) summary.stored += 1;
      else summary.duplicate += 1;
    } catch {
      ingestFailed = true;
      console.error(
        JSON.stringify({
          operation: "brevo_email_events",
          stage: "ingest",
          error: "ingest_failed",
          event_type: result.event.eventType,
        }),
      );
    }
  }

  if (ingestFailed) {
    // Ask for a retry. Re-delivery is safe: ingest is idempotent, so the events
    // that did land are recognised as duplicates the second time round.
    return json(500, { error: "ingest_failed", summary });
  }

  return json(200, { summary });
}
