import { dequal } from "dequal";

import type { AttachmentNote } from "../../types";

/**
 * W8-C S5 — Relational Attachment Read Gate (Note read model).
 *
 * This module owns the NOTE-specific compatibility between two
 * representations of the same attachments:
 *
 * - `public.attachments` (since W8-C S1/S3B) vouches for membership,
 *   `storage_key`, note ownership via FK, `file_name` and `mime_type`.
 * - the legacy note JSON array stays authoritative until S6 for the write
 *   representation, the array order, `src`, `rawFile` and tolerated unknown
 *   fields.
 *
 * Everything here exists ONLY because notes currently carry both. Generic
 * attachment policy (bucket, MIME, size, object keys) stays in
 * `./attachments.ts` so a future non-note attachment owner never has to
 * import note legacy semantics. When S6 retires the legacy JSON write path,
 * this module is the deletion boundary.
 */

/** Alias under which the relational rows are embedded — never a DB column. */
export const NOTE_ATTACHMENT_ROWS_KEY = "attachment_rows";

/**
 * `ok`         the relational rows vouch for the legacy JSON array.
 * `drift`      the read was enriched, but the two do not agree.
 * `unverified` the read carried no relational rows at all, so nothing is
 *              vouched for (every un-enriched read method lands here).
 */
export type NoteAttachmentsState = "ok" | "drift" | "unverified";

/** The three columns the relational gate reads — no id, size or owner FK. */
export type AttachmentRow = {
  storage_key: string;
  file_name: string;
  mime_type: string;
};

/**
 * Exact `meta.columns` selectors. Single line, whitespace-free: the value is
 * handed to PostgREST as `select=` verbatim. The alias is mandatory because
 * `contact_notes`/`deal_notes` already own a column literally named
 * `attachments` — without it the legacy column and the embedded relation
 * would contend for one key in the response object.
 */
export const CONTACT_NOTE_META_COLUMNS =
  "*,attachment_rows:attachments!attachments_contact_note_id_fkey(storage_key,file_name,mime_type)";

export const DEAL_NOTE_META_COLUMNS =
  "*,attachment_rows:attachments!attachments_deal_note_id_fkey(storage_key,file_name,mime_type)";

export const NOTE_META_COLUMNS: Record<string, string> = {
  contact_notes: CONTACT_NOTE_META_COLUMNS,
  deal_notes: DEAL_NOTE_META_COLUMNS,
};

export const NOTE_RESOURCES = ["contact_notes", "deal_notes"] as const;

export const isNoteResource = (resource: string): boolean =>
  resource === "contact_notes" || resource === "deal_notes";

/**
 * The structural equality the transport itself uses: `getChanges` inside
 * `@raphiniert/ra-data-postgrest` compares each key with `dequal`, so the S5
 * guard must ask the very same question — "would this key be sent?".
 * `lodash/isEqual` is NOT interchangeable here: it disagrees with `dequal` on
 * `File`-shaped values, and note attachments carry `rawFile`.
 */
export const attachmentsEqual = (a: unknown, b: unknown): boolean =>
  dequal(a, b);

/** Shape every note-ish record satisfies once the mapper has run. */
export type NoteAttachmentReadModel = {
  attachments?: AttachmentNote[] | null;
  attachments_state?: NoteAttachmentsState;
  attachments_unverified_legacy?: AttachmentNote[] | null;
};

type AnyRecord = Record<string, any>;

const asArray = (value: unknown): AttachmentNote[] | null =>
  Array.isArray(value) ? (value as AttachmentNote[]) : null;

/**
 * Relational parity. Membership is compared in BOTH directions over the
 * storage key (`path` ↔ `storage_key`), plus `title` ↔ `file_name` and
 * `type` ↔ `mime_type`. Order is deliberately NOT compared — the legacy JSON
 * stays the order master until S6.
 *
 * Anything that cannot be vouched for (an element without a storage key, a
 * repeated key on either side) fails closed.
 */
const hasRelationalParity = (
  legacy: AttachmentNote[],
  rows: AttachmentRow[],
): boolean => {
  const legacyByKey = new Map<string, AttachmentNote>();
  for (const attachment of legacy) {
    const key = attachment?.path;
    if (!key || legacyByKey.has(key)) return false;
    legacyByKey.set(key, attachment);
  }

  const rowsByKey = new Map<string, AttachmentRow>();
  for (const row of rows) {
    const key = row?.storage_key;
    if (!key || rowsByKey.has(key)) return false;
    rowsByKey.set(key, row);
  }

  if (legacyByKey.size !== rowsByKey.size) return false;

  for (const [key, attachment] of legacyByKey) {
    const row = rowsByKey.get(key);
    if (!row) return false;
    if (attachment.title !== row.file_name) return false;
    if (attachment.type !== row.mime_type) return false;
  }

  return true;
};

const withoutRelationalRows = <T extends AnyRecord>(row: T): AnyRecord => {
  const {
    [NOTE_ATTACHMENT_ROWS_KEY]: _rows,
    attachments_state: _state,
    attachments_unverified_legacy: _legacy,
    ...rest
  } = row;
  void _rows;
  void _state;
  void _legacy;
  return rest;
};

const quarantined = (
  rest: AnyRecord,
  legacy: AttachmentNote[] | null,
  state: Exclude<NoteAttachmentsState, "ok">,
): AnyRecord => ({
  ...rest,
  attachments: null,
  attachments_state: state,
  attachments_unverified_legacy: legacy ?? [],
});

/**
 * The single fail-closed mapper for every note read. A read that carries no
 * `attachment_rows` is `unverified` — never "verified because the JSON looks
 * fine". The legacy array is then quarantined, never left under the normal
 * `attachments` field.
 */
export const mapNoteAttachmentReadModel = <T extends AnyRecord>(
  row: T,
): AnyRecord => {
  if (row == null || typeof row !== "object") return row;

  const rest = withoutRelationalRows(row);
  const legacy = asArray(row.attachments);
  const rows = row[NOTE_ATTACHMENT_ROWS_KEY];

  if (!Array.isArray(rows)) {
    return quarantined(rest, legacy, "unverified");
  }

  if (!hasRelationalParity(legacy ?? [], rows as AttachmentRow[])) {
    return quarantined(rest, legacy, "drift");
  }

  return {
    ...rest,
    attachments: legacy ?? [],
    attachments_state: "ok" as const,
  };
};

/**
 * A committed mutation whose verification read could not be performed. The
 * write stays successful; the record degrades honestly instead of presenting
 * the raw legacy array as verified.
 */
export const degradeNoteAttachmentReadModel = <T extends AnyRecord>(
  row: T,
): AnyRecord =>
  quarantined(
    withoutRelationalRows(row),
    asArray(row.attachments),
    "unverified",
  );

/** The legacy JSON snapshot a previously read record stands for. */
export const priorLegacyAttachments = (
  previous: NoteAttachmentReadModel | null | undefined,
): AttachmentNote[] => {
  if (!previous) return [];
  return previous.attachments_state === "ok"
    ? (asArray(previous.attachments) ?? [])
    : (asArray(previous.attachments_unverified_legacy) ?? []);
};

/** True only when `previous` carries a canonical S5 state we may carry over. */
export const hasCanonicalReadModel = (
  previous: unknown,
): previous is NoteAttachmentReadModel & {
  attachments_state: NoteAttachmentsState;
} => {
  const state = (previous as NoteAttachmentReadModel | null)?.attachments_state;
  return state === "ok" || state === "drift" || state === "unverified";
};

/**
 * Carry the previous canonical read model over a mutation row whose legacy
 * JSON is provably unchanged. A raw PostgREST mutation row is never a
 * relational projection truth, so it must not escape as one.
 */
export const preserveNoteAttachmentReadModel = <T extends AnyRecord>(
  row: T,
  previous: NoteAttachmentReadModel & {
    attachments_state: NoteAttachmentsState;
  },
): AnyRecord => {
  const rest = withoutRelationalRows(row);

  if (previous.attachments_state === "ok") {
    return {
      ...rest,
      attachments: asArray(previous.attachments) ?? [],
      attachments_state: "ok" as const,
    };
  }

  return quarantined(
    rest,
    asArray(previous.attachments_unverified_legacy),
    previous.attachments_state,
  );
};

/**
 * Verified presentation data, or `null` when nothing is vouched for. The
 * verified renderer only ever receives the array form — it must not be able
 * to decide trust itself.
 */
export const verifiedAttachments = (
  note: NoteAttachmentReadModel | null | undefined,
): AttachmentNote[] | null => {
  if (note?.attachments_state !== "ok") return null;
  return asArray(note.attachments) ?? [];
};

/** Quarantined legacy data, for the read-only recovery renderer only. */
export const recoveryAttachments = (
  note: NoteAttachmentReadModel | null | undefined,
): AttachmentNote[] => {
  if (!note || note.attachments_state === "ok") return [];
  return asArray(note.attachments_unverified_legacy) ?? [];
};

/** Read-model metadata never reaches persistence — it is not a DB column. */
export const stripNoteReadModelMetadata = <T extends AnyRecord>(
  data: T,
): AnyRecord => {
  if (data == null || typeof data !== "object") return data;
  const {
    attachments_state: _state,
    attachments_unverified_legacy: _legacy,
    [NOTE_ATTACHMENT_ROWS_KEY]: _rows,
    ...rest
  } = data;
  void _state;
  void _legacy;
  void _rows;
  return rest;
};

/**
 * What must a note UPDATE do with its mutation row?
 *
 * `verify`   re-read the relational truth (an attachment-changing write, a
 *            missing/untrustworthy previous state, or a legacy array that
 *            moved underneath a write that did not touch it).
 * `preserve` carry the previous canonical state over — no extra read.
 *
 * Keeping this decision pure is what makes "a text-only update issues NO
 * verification GET" an assertable property rather than a hope.
 */
export type NoteUpdatePlan = "verify" | "preserve";

export const planNoteUpdateResult = (
  data: AnyRecord | null | undefined,
  previousData: AnyRecord | null | undefined,
  committedRow: AnyRecord | null | undefined,
): NoteUpdatePlan => {
  if (isNoteAttachmentChange(data, previousData)) return "verify";
  if (!hasCanonicalReadModel(previousData)) return "verify";

  const rawLegacy = asArray(committedRow?.attachments) ?? [];
  return attachmentsEqual(rawLegacy, priorLegacyAttachments(previousData))
    ? "preserve"
    : "verify";
};

/**
 * Would this write touch the attachments column? Mirrors `getChanges`:
 * a key that is absent from `data` is never sent, so it is never an
 * attachment change — which is what keeps partial updates such as the
 * contact-merge `{ contact_id }` patch out of the guard.
 */
export const isNoteAttachmentChange = (
  data: AnyRecord | null | undefined,
  previousData: AnyRecord | null | undefined,
): boolean => {
  if (data == null) return false;
  const hasKey = Object.prototype.hasOwnProperty.call(data, "attachments");
  if (!hasKey) return false;
  return (
    previousData == null ||
    !attachmentsEqual(data.attachments, previousData.attachments)
  );
};
