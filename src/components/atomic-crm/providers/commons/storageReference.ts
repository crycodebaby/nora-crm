import { safeHref } from "@/lib/safeHref";

/**
 * W8-E — what a persisted attachment-ish value actually references.
 *
 * Nora stores four different kinds of file value in the same `{ src, path,
 * title, type, rawFile }` shape: note attachments, company logos, the two
 * configuration branding logos and employee/contact avatars. Once the
 * `attachments` bucket is private, "what is `src`?" stops being a rendering
 * detail and becomes an access-control question, so exactly one module
 * answers it.
 *
 * The ordering below is the security contract, not a convenience:
 *
 *   1. a `blob:` preview of a real `File` picked in THIS session is local,
 *      never stored, and never signed — it is the one narrow exemption
 *      inherited from RC3 and it stays narrow (both halves must hold);
 *   2. **`path` wins over `src`.** The stable persisted identity of a private
 *      object is its storage key. A persisted URL is never the identity and
 *      never the authorization source (W8-E), so an element that has a key is
 *      resolved from the key even when it still carries a legacy public URL;
 *   3. a `data:image/` value is inline content that has not been uploaded
 *      yet — narrowed to images, and checked after the key so it can never
 *      shadow a real object;
 *   4. only a value with NO key may fall back to its `src`, and then only
 *      through `safeHref` — that is how deliberately public branding URLs and
 *      foreign avatar URLs (favicon services) keep working unchanged.
 *
 * Anything else is `none`: it is not renderable and must not become a link.
 */
export type StorageReference =
  /** Local `blob:` preview of a file picked in this session. */
  | { kind: "local-preview"; url: string }
  /** Inline `data:` content — no storage object involved. */
  | { kind: "inline"; url: string }
  /** A private storage object, addressed by its stable key. */
  | { kind: "private"; storageKey: string }
  /** A safe absolute URL that is not a Nora private object. */
  | { kind: "public"; url: string }
  /** Nothing renderable, or a value rejected by the URL policy. */
  | { kind: "none" };

/**
 * Which security class a file value belongs to. This is declared by the
 * caller, never inferred from the value: "is this file confidential?" is a
 * product decision about the FIELD, not something a URL can be asked.
 *
 * `private`  note/document attachments and employee/contact photos. Addressed
 *            by storage key, reached through a derived signed URL.
 * `branding` the configuration light/dark logos and customer logos —
 *            deliberately public brand marks that must render without a
 *            session. Addressed by their public URL.
 *
 * `private` is the default, because defaulting to `branding` would mean a
 * mis-wired caller silently treats confidential content as public.
 */
export type StorageClass = "private" | "branding";

export type StorageReferenceInput =
  | {
      src?: string | null;
      path?: string | null;
      rawFile?: unknown;
    }
  | null
  | undefined;

const NONE: StorageReference = { kind: "none" };

/**
 * Classifies one persisted file value.
 *
 * Pure and synchronous: it performs no I/O and mints no URL. Deriving a
 * temporary access URL for a `private` reference is the job of
 * `useAttachmentUrl` — keeping the two apart is what lets the classification
 * be unit-tested against adversarial input without a Supabase client.
 */
export const classifyStorageReference = (
  value: StorageReferenceInput,
  storageClass: StorageClass = "private",
): StorageReference => {
  if (value == null || typeof value !== "object") return NONE;

  const src = typeof value.src === "string" ? value.src : null;

  // (1) Local preview. BOTH halves must hold: a value deserialized from note
  // JSON can never be a `File` instance, and `URL.createObjectURL` only ever
  // yields a `blob:` URL. This is deliberately not a general `blob:` bypass.
  if (value.rawFile instanceof File && src != null && src.startsWith("blob:")) {
    return { kind: "local-preview", url: src };
  }

  // (2) Stable identity wins — for private content. A legacy public `src`
  // alongside a key is inert legacy data from here on: it is neither proof of
  // membership nor an authorization source.
  //
  // A `branding` value deliberately skips this branch. Its object lives in the
  // public branding bucket, so signing it against the private bucket would
  // fail; and a migrated branding record still carries the OLD attachments key
  // in `path`, which must never be resolved again.
  if (storageClass === "private") {
    const storageKey =
      typeof value.path === "string" && value.path.length > 0
        ? value.path
        : null;
    if (storageKey != null) return { kind: "private", storageKey };
  }

  if (src == null || src.trim() === "") return NONE;

  // (3) Inline IMAGE content — a freshly cropped logo or avatar that has not
  // been uploaded yet. Deliberately narrowed to `data:image/`: a `data:`
  // value is a document, and `data:text/html` has no legitimate use in any
  // Nora file field. It is also checked AFTER the key, so a hostile inline
  // value can never shadow a real storage object.
  if (/^data:image\/[a-z0-9.+-]+[;,]/i.test(src.trim())) {
    return { kind: "inline", url: src };
  }

  // (4) Otherwise the value can only be an ordinary URL. `safeHref` is the
  // sole URL authority — `javascript:`, `vbscript:`, `file:`, every remaining
  // `data:` value, malformed input and anything else non-navigable degrade to
  // `none`.
  const safe = safeHref(src);
  return safe == null ? NONE : { kind: "public", url: safe };
};
