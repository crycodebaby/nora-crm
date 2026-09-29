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
 * - refreshes after expiry rather than caching a dead URL;
 * - hands each consumer the capability's OWN expiry horizon, so a component
 *   that receives an almost-expired cached URL renews it when THAT URL lapses,
 *   not a full TTL after it mounted (Alpha Storage 3 L-1). The horizon is
 *   runtime-only: never persisted, never part of any domain record.
 *
 * A signed URL is a bearer capability. Nora guarantees that a deactivated
 * user cannot obtain a NEW one; it cannot retract one already issued before
 * it expires. That honest limit is documented, never papered over.
 */

/** How early a cached URL is considered stale, so a click never races expiry. */
const REFRESH_SKEW_SECONDS = 30;

/**
 * How long a FRESHLY signed capability is handed out: the TTL minus the skew.
 *
 * This is the horizon stamped on a new cache entry. A mounted consumer renews
 * at the horizon of the capability it actually holds (`expiresAt`), which for
 * a fresh one lands exactly here — one re-sign per object per TTL, no earlier.
 */
export const ATTACHMENT_URL_RENEWAL_MS =
  (ATTACHMENT_SIGNED_URL_TTL_SECONDS - REFRESH_SKEW_SECONDS) * 1000;

/**
 * A derived capability plus the moment it stops being handed out.
 *
 * Internal to the access layer and its hook: components only ever see a URL
 * and a status. `expiresAt` is what lets a consumer schedule its renewal off
 * the capability it holds instead of off its own mount time.
 */
export type SignedAttachmentCapability = {
  url: string;
  /** Epoch ms after which `url` is no longer handed out as fresh. */
  expiresAt: number;
};

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
  inFlight?: Promise<SignedAttachmentCapability>;
};

const cache = new Map<string, CacheEntry>();

const freshCapability = (
  entry: CacheEntry | undefined,
): SignedAttachmentCapability | undefined =>
  entry?.url != null && entry.expiresAt > Date.now()
    ? { url: entry.url, expiresAt: entry.expiresAt }
    : undefined;

/**
 * Returns a usable signed capability for `storageKey`, signing only when
 * necessary, together with the horizon after which it is no longer fresh.
 *
 * A cached capability keeps the horizon it was issued with: a consumer that
 * arrives late gets the remaining lifetime, never a new full TTL.
 *
 * `force` drops a cached entry first — used when a consumer observes that a
 * URL stopped working (an expired capability, a rotated session) so the UI can
 * recover without a reload. A signing request that is already in flight is
 * joined rather than discarded: it IS the fresh derivation `force` asks for,
 * and starting a second one would only multiply requests.
 */
export const getSignedAttachmentCapability = async (
  storageKey: string,
  signer: AttachmentSigner,
  force = false,
): Promise<SignedAttachmentCapability> => {
  if (force && cache.get(storageKey)?.inFlight == null) {
    cache.delete(storageKey);
  }

  const cached = cache.get(storageKey);
  const fresh = freshCapability(cached);
  if (fresh != null) return fresh;
  if (cached?.inFlight) return cached.inFlight;

  const inFlight = signer(storageKey)
    .then((url) => {
      const capability = {
        url,
        expiresAt: Date.now() + ATTACHMENT_URL_RENEWAL_MS,
      };
      cache.set(storageKey, capability);
      return capability;
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

/**
 * URL-only view of `getSignedAttachmentCapability`, for callers that hold no
 * mounted state to renew (the header avatar resolved in `getIdentity`).
 */
export const getSignedAttachmentUrl = async (
  storageKey: string,
  signer: AttachmentSigner,
  force = false,
): Promise<string> =>
  (await getSignedAttachmentCapability(storageKey, signer, force)).url;

/** Test/teardown seam. Never called by application code. */
export const resetAttachmentUrlCache = () => cache.clear();
