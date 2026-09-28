import { getSupabaseClient } from "../providers/supabase/supabase";
import {
  ATTACHMENTS_BUCKET,
  ATTACHMENT_SIGNED_URL_TTL_SECONDS,
} from "../providers/commons/attachments";

/**
 * W8-E — the ONE place that turns a stable private storage key into a
 * temporary access URL.
 *
 * Contract (every bullet is load-bearing, see docs/nora/22 §6.14):
 *
 * - derives access from `path`/`storage_key` only, never from a persisted URL;
 * - uses the current user's Supabase session, so the existing W8-B
 *   `storage.objects` policies (`is_active_user()`) are the sole authority —
 *   there is no broker, no `service_role`, no actor parameter and no new
 *   capability of any kind;
 * - performs no database mutation and never writes a derived URL back into a
 *   record: the signed URL lives only in this module's runtime cache;
 * - deduplicates concurrent signing of the same key, so N components showing
 *   the same object issue ONE request;
 * - refreshes after expiry rather than caching a dead URL.
 *
 * A signed URL is a bearer capability. Nora guarantees that a deactivated
 * user cannot obtain a NEW one; it cannot retract one already issued before
 * it expires. That honest limit is documented, never papered over.
 */

/** How early a cached URL is considered stale, so a click never races expiry. */
const REFRESH_SKEW_SECONDS = 30;

/**
 * When a mounted consumer should renew a capability it is still displaying.
 *
 * Identical to the cache horizon, so the renewal lands exactly when the cached
 * URL stops being handed out — one re-sign per object per TTL, no earlier.
 */
export const ATTACHMENT_URL_RENEWAL_MS =
  (ATTACHMENT_SIGNED_URL_TTL_SECONDS - REFRESH_SKEW_SECONDS) * 1000;

export type AttachmentSigner = (storageKey: string) => Promise<string>;

/** Infrastructure: the real signer, bound to the browser's user session. */
export const supabaseAttachmentSigner: AttachmentSigner = async (
  storageKey,
) => {
  const { data, error } = await getSupabaseClient()
    .storage.from(ATTACHMENTS_BUCKET)
    .createSignedUrl(storageKey, ATTACHMENT_SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    throw error ?? new Error(`could not sign ${storageKey}`);
  }
  return data.signedUrl;
};

type CacheEntry = {
  /** Resolved URL, absent while the first request is still in flight. */
  url?: string;
  /** Epoch ms after which the URL must not be handed out any more. */
  expiresAt: number;
  /** In-flight request, so concurrent callers share one round trip. */
  inFlight?: Promise<string>;
};

const cache = new Map<string, CacheEntry>();

const freshUrl = (entry: CacheEntry | undefined): string | undefined =>
  entry?.url != null && entry.expiresAt > Date.now() ? entry.url : undefined;

/**
 * Returns a usable signed URL for `storageKey`, signing only when necessary.
 *
 * `force` drops a cached entry first — used when a consumer observes that a
 * URL stopped working (an expired capability, a rotated session) so the UI can
 * recover without a reload.
 */
export const getSignedAttachmentUrl = async (
  storageKey: string,
  signer: AttachmentSigner,
  force = false,
): Promise<string> => {
  if (force) cache.delete(storageKey);

  const cached = cache.get(storageKey);
  const fresh = freshUrl(cached);
  if (fresh != null) return fresh;
  if (cached?.inFlight) return cached.inFlight;

  const inFlight = signer(storageKey)
    .then((url) => {
      cache.set(storageKey, {
        url,
        expiresAt:
          Date.now() +
          (ATTACHMENT_SIGNED_URL_TTL_SECONDS - REFRESH_SKEW_SECONDS) * 1000,
      });
      return url;
    })
    .catch((error) => {
      // Never cache a failure: the next mount must be allowed to retry, e.g.
      // after a transient network error or a session refresh.
      cache.delete(storageKey);
      throw error;
    });

  cache.set(storageKey, { expiresAt: 0, inFlight });
  return inFlight;
};

/** Test/teardown seam. Never called by application code. */
export const resetAttachmentUrlCache = () => cache.clear();
