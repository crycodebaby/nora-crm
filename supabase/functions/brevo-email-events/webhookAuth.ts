/**
 * Webhook authentication for the transactional email event endpoint.
 *
 * This endpoint is intentionally callable by the mail provider, so it does NOT
 * require a Nora user JWT — there is no user behind a delivery event. It is
 * protected by a dedicated shared secret instead, configured on the provider
 * side as a bearer token and held in Supabase Edge Function secrets as
 * BREVO_WEBHOOK_TOKEN.
 *
 * The Brevo API key is deliberately NOT reused here: an outbound credential
 * that can send mail must never double as an inbound authenticator.
 */

const encoder = new TextEncoder();

/**
 * Constant-time equality.
 *
 * Both sides are hashed first so that comparing values of different lengths
 * costs the same as comparing equal-length ones — a plain byte loop leaks the
 * secret's length through timing before it leaks anything else.
 */
export async function secureEquals(a: string, b: string): Promise<boolean> {
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);

  const viewA = new Uint8Array(digestA);
  const viewB = new Uint8Array(digestB);

  let diff = 0;
  for (let i = 0; i < viewA.length; i++) {
    diff |= viewA[i] ^ viewB[i];
  }
  return diff === 0;
}

/** Pulls the bearer token out of an Authorization header, if there is one. */
export function readBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1].trim();
  return token === "" ? null : token;
}

export type WebhookAuthResult =
  | { ok: true }
  | { ok: false; reason: "missing_token" | "invalid_token" };

/**
 * A missing and a wrong token are answered identically to the caller (401 with
 * no detail); the distinction exists only for our own logs.
 */
export async function authenticateWebhookRequest(
  req: Request,
  expectedToken: string,
): Promise<WebhookAuthResult> {
  const presented = readBearerToken(req.headers.get("Authorization"));
  if (!presented) return { ok: false, reason: "missing_token" };

  const matches = await secureEquals(presented, expectedToken);
  return matches ? { ok: true } : { ok: false, reason: "invalid_token" };
}
