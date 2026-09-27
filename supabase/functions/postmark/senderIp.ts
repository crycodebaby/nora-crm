/**
 * Sender-address handling for the Postmark inbound webhook.
 *
 * Split out of `index.ts` so the rule can be tested directly: `index.ts` calls
 * `Deno.serve` and reads required environment variables at module load, which
 * makes it unimportable from a unit test.
 *
 * READ THIS BEFORE TRUSTING ANYTHING HERE. `x-forwarded-for` is a request
 * header. A caller sends whatever it likes and the platform appends to the
 * chain, so an attacker controls at least the leading entries. Supabase
 * documents no platform-attested client IP for Edge Functions and does not say
 * how many proxies sit in front of a function, so no position in the chain is
 * verifiable. This module therefore provides a NOISE FILTER, not an
 * authorization check. The Basic-auth shared secret is the gate, and `index.ts`
 * checks it first, before any of this runs.
 */

/**
 * The client IP as Supabase's own documentation extracts it: the first entry of
 * the chain (see "Accessing request information" in
 * https://supabase.com/docs/guides/api/securing-your-api, which uses
 * `split_part(..., ',', 1)`).
 */
export const clientIpFromChain = (
  forwardedFor: string | null | undefined,
): string | null => {
  if (!forwardedFor) return null;
  const first = forwardedFor.split(",")[0]?.trim();
  return first ? first : null;
};

export const parseAuthorizedIps = (raw: string | null | undefined): string[] =>
  (raw ?? "")
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);

/**
 * Best-effort sender filter.
 *
 * The previous implementation accepted the request when ANY entry of the chain
 * was allowlisted. That was strictly worse than no check: an attacker did not
 * have to spoof anything subtle, only to prepend or append a published Postmark
 * IP to their own header, and the request passed as if it came from Postmark.
 * Only the single documented client-IP position is considered now.
 *
 * That is narrower, not sound — a caller can put an allowlisted address in that
 * position too. Keep the Basic-auth check ahead of this one.
 */
export const isAuthorizedSenderIp = (
  forwardedFor: string | null | undefined,
  rawAuthorizedIps: string | null | undefined,
): boolean => {
  const clientIp = clientIpFromChain(forwardedFor);
  if (!clientIp) return false;
  return parseAuthorizedIps(rawAuthorizedIps).includes(clientIp);
};
