import { NORA_ERROR_CODES, throwNoraError } from "../../domain/noraErrorCodes";

export const ATTACHMENTS_BUCKET =
  import.meta.env.VITE_ATTACHMENTS_BUCKET || "attachments";

/**
 * W8-E — the deliberately PUBLIC branding bucket.
 *
 * It exists because two of Nora's file classes are not business documents at
 * all: the configuration light/dark logos, which must render on the login page
 * with no session whatsoever, and the customer logos, which are public brand
 * marks of the firms Nora works with. Solving pre-auth branding with signed
 * URLs is impossible (there is nobody to sign as) and solving it with a
 * service broker would be a new privileged path, so the two classes are
 * separated by bucket instead.
 *
 * The name must NOT contain the substring `attachments`: the S2A2.1 liveness
 * resolver classifies any storage-looking URL mentioning `attachments` as
 * `unknown` (fail-closed), which would make every branding URL permanently
 * ambiguous to the deletion contract. `branding` classifies cleanly as `none`.
 *
 * Nothing that is a note or document attachment may ever be uploaded here.
 */
export const BRANDING_BUCKET =
  import.meta.env.VITE_BRANDING_BUCKET || "branding";

/**
 * Lifetime of a derived attachment access URL, in seconds.
 *
 * ONE place, on purpose: a TTL scattered across components cannot be reasoned
 * about, and this value is a security parameter, not styling. See
 * `attachments/attachmentAccess.ts` for how it is refreshed and
 * docs/nora/22 §6.14 for the measurements behind the number.
 */
export const ATTACHMENT_SIGNED_URL_TTL_SECONDS = 900;

/**
 * Upload policy of the attachments bucket (W8-B).
 *
 * Mirrors `storage.buckets.file_size_limit` / `allowed_mime_types` from
 * migration `20260915120000_nora_attachment_storage_hardening.sql`. The bucket
 * is the enforcement boundary; this copy only lets the UI refuse a file early
 * with an understandable message. Keep both in sync.
 */
export const ATTACHMENT_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

/** MIME type → file extensions, in react-dropzone `accept` shape. */
export const ATTACHMENT_ACCEPT: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "image/gif": [".gif"],
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    ".docx",
  ],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
    ".xlsx",
  ],
  "text/plain": [".txt"],
  "text/csv": [".csv"],
};

/** Value for a plain `<input type="file" accept>`. */
export const ATTACHMENT_ACCEPT_ATTRIBUTE = Object.entries(ATTACHMENT_ACCEPT)
  .flatMap(([mimeType, extensions]) => [mimeType, ...extensions])
  .join(",");

export type AttachmentFileRejection = "file_type" | "file_size";

/**
 * The bucket decides by the MIME type the browser reports, not by the file
 * name: a `.csv` reported as `application/vnd.ms-excel`, or a file with an
 * empty type, is rejected by storage — so it is rejected here as well.
 */
export const getAttachmentFileRejection = (file: {
  type: string;
  size: number;
}): AttachmentFileRejection | null => {
  if (!Object.hasOwn(ATTACHMENT_ACCEPT, file.type)) return "file_type";
  if (file.size > ATTACHMENT_MAX_FILE_SIZE_BYTES) return "file_size";
  return null;
};

/**
 * Object key for a new upload: a CSPRNG UUID plus the normalized extension of
 * the original file name. Existing keys (`0.<digits>.<ext>`) stay as they are.
 */
export const createAttachmentObjectKey = (fileName: string): string => {
  const baseName = fileName.split(/[/\\]/).pop() ?? "";
  const extension = /\.([a-z0-9]{1,10})$/i.exec(baseName)?.[1];
  return `${crypto.randomUUID()}${extension ? `.${extension.toLowerCase()}` : ""}`;
};

/**
 * W8-C S3B: a note attachment is a Nora storage object, identified by its
 * storage key (`path`). An element whose file could not be downloaded and that
 * has no storage key — e.g. a JSON import pointing at an unreachable external
 * URL — is not a Nora attachment. It is rejected with the same contract code
 * the database projection raises, instead of being stored as an external link
 * or silently dropped.
 */
export const assertStoredAttachment = (attachment: {
  path?: string | null;
}): void => {
  if (!attachment.path) {
    throwNoraError(
      "note attachment has no Nora storage key",
      NORA_ERROR_CODES.ATTACHMENT_REFERENCE_INVALID,
    );
  }
};
