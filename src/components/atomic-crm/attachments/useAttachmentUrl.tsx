import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import {
  classifyStorageReference,
  type StorageClass,
  type StorageReferenceInput,
} from "../providers/commons/storageReference";
import {
  ATTACHMENT_URL_RENEWAL_MS,
  getSignedAttachmentUrl,
  supabaseAttachmentSigner,
  type AttachmentSigner,
} from "./attachmentAccess";

/**
 * W8-E — the presentation seam for attachment access.
 *
 * Components ask this hook for a URL; they never build a Storage URL and
 * never see the bucket. Two separate results, because they carry different
 * risk:
 *
 * - `previewUrl` may be placed in an `<img src>`;
 * - `href` may be placed in an anchor, and is deliberately absent for inline
 *   `data:` content — a `data:` anchor is a navigable document and stays
 *   non-clickable exactly as `safeHref` already made it.
 */
export type AttachmentAccessStatus =
  /** A URL is available now. */
  | "ready"
  /** A signed URL is being derived. */
  | "loading"
  /** Signing failed — typically no session, or no longer an active user. */
  | "error"
  /** Nothing renderable: no reference, or one the URL policy rejected. */
  | "unavailable";

export type AttachmentAccess = {
  status: AttachmentAccessStatus;
  previewUrl?: string;
  href?: string;
  /**
   * Re-derives access, bypassing the cache. Safe to call from an `onError`:
   * it is bounded, so a permanently broken object cannot cause a retry loop.
   */
  refresh: () => void;
};

const SignerContext = createContext<AttachmentSigner>(supabaseAttachmentSigner);

/** Injects a signer. Production never uses this; tests and demo builds do. */
export const AttachmentSignerProvider = ({
  signer,
  children,
}: {
  signer: AttachmentSigner;
  children: ReactNode;
}) => (
  <SignerContext.Provider value={signer}>{children}</SignerContext.Provider>
);

export const useAttachmentSigner = () => useContext(SignerContext);

const UNAVAILABLE = { status: "unavailable" as const };

/**
 * How often one mounted consumer may re-derive access for the same object.
 *
 * This bound is not a nicety. `refresh` is wired to the `onError` of an
 * `<img>`, so an object that is genuinely gone — deleted, wrong key, a broken
 * CDN — would otherwise loop: error, re-sign, error, re-sign, hammering the
 * Storage API for as long as the note stays on screen. One retry recovers the
 * case this exists for (a capability that expired while the tab sat open) and
 * gives up honestly on the case it cannot fix.
 */
const MAX_REFRESH_ATTEMPTS = 1;

/**
 * Derives a temporary access URL for one attachment-ish value.
 *
 * Only a `private` reference costs a round trip. Inline content, local
 * previews and deliberately public URLs (branding, foreign avatars) resolve
 * synchronously and never touch the network — which is what keeps avatar-heavy
 * lists from issuing one signing request per row.
 */
export const useAttachmentUrl = (
  value: StorageReferenceInput,
  storageClass: StorageClass = "private",
): AttachmentAccess => {
  const signer = useAttachmentSigner();
  const reference = useMemo(
    () => classifyStorageReference(value, storageClass),
    [value, storageClass],
  );
  const storageKey =
    reference.kind === "private" ? reference.storageKey : undefined;

  const [signed, setSigned] = useState<{
    key: string;
    status: "loading" | "ready" | "error";
    url?: string;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Bumped by a timer shortly before the current capability expires. Separate
  // from `attempt` on purpose: `attempt` is the BOUNDED error retry, this is
  // the unbounded-but-TTL-paced renewal of something still on screen.
  const [renewal, setRenewal] = useState(0);
  // Guards against a resolved promise writing state after unmount, and
  // against a slow response for a key the component no longer shows.
  const activeKey = useRef<string | undefined>(undefined);

  useEffect(() => {
    activeKey.current = storageKey;
    if (storageKey == null) {
      setSigned(null);
      return;
    }
    let cancelled = false;
    setSigned({ key: storageKey, status: "loading" });
    getSignedAttachmentUrl(storageKey, signer, attempt > 0)
      .then((url) => {
        if (cancelled || activeKey.current !== storageKey) return;
        setSigned({ key: storageKey, status: "ready", url });
      })
      .catch(() => {
        if (cancelled || activeKey.current !== storageKey) return;
        setSigned({ key: storageKey, status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [storageKey, signer, attempt, renewal]);

  /**
   * Proactive renewal — the reason a rendered link can be trusted.
   *
   * An anchor `href` is minted when the component renders, not when the user
   * clicks. Without this, a note left on screen longer than the TTL would
   * carry a dead link that opens a blank error tab, and `onError` cannot help
   * because an anchor never fires one. So while a consumer is mounted, the
   * capability is refreshed just before it lapses and whatever is in the DOM
   * stays live. It stops the moment the component unmounts.
   */
  useEffect(() => {
    if (storageKey == null || signed?.status !== "ready") return;
    const timer = setTimeout(
      () => setRenewal((n) => n + 1),
      ATTACHMENT_URL_RENEWAL_MS,
    );
    return () => clearTimeout(timer);
  }, [storageKey, signed?.status, signed?.url]);

  const refresh = useCallback(
    () => setAttempt((n) => (n < MAX_REFRESH_ATTEMPTS ? n + 1 : n)),
    [],
  );

  return useMemo<AttachmentAccess>(() => {
    switch (reference.kind) {
      case "none":
        return { ...UNAVAILABLE, refresh };
      case "local-preview":
        // The RC3 exemption: a real `File` picked in this session. Usable as
        // both preview and link, because it is local, not stored data.
        return {
          status: "ready",
          previewUrl: reference.url,
          href: reference.url,
          refresh,
        };
      case "inline":
        // Renderable, never navigable.
        return { status: "ready", previewUrl: reference.url, refresh };
      case "public":
        return {
          status: "ready",
          previewUrl: reference.url,
          href: reference.url,
          refresh,
        };
      case "private": {
        if (signed?.key !== reference.storageKey) {
          return { status: "loading", refresh };
        }
        if (signed.status === "ready" && signed.url) {
          return {
            status: "ready",
            previewUrl: signed.url,
            href: signed.url,
            refresh,
          };
        }
        return { status: signed.status, refresh };
      }
    }
  }, [reference, signed, refresh]);
};
