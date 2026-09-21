type NoteContentValues = {
  attachments?: unknown[] | null;
  attachments_unverified_legacy?: unknown[] | null;
};

const isNonEmptyArray = (value: unknown): boolean =>
  Array.isArray(value) && value.length > 0;

/**
 * Does this note carry attachment content at all?
 *
 * W8-C S5: a note whose attachments could not be verified reads back with
 * `attachments = null` and its legacy array quarantined under
 * `attachments_unverified_legacy`. A legally persisted attachment-only note
 * (empty text) would otherwise become unsavable while degraded — a plain
 * status or date edit would be refused with "text or attachment required"
 * about a note that demonstrably has an attachment.
 *
 * The quarantined array counts ONLY as evidence that content exists. It is
 * never verified, never editable, never a preview source and never part of a
 * write payload — use `verifiedAttachments()` for anything that renders or
 * writes. On CREATE the field is absent, so this behaves exactly as before.
 */
export const hasPersistedOrRecoveryAttachmentContent = (
  values: NoteContentValues | null | undefined,
): boolean =>
  isNonEmptyArray(values?.attachments) ||
  isNonEmptyArray(values?.attachments_unverified_legacy);

export const validateNoteOrAttachmentRequired = (
  value: string | null | undefined,
  values: NoteContentValues,
) => {
  const hasText = typeof value === "string" && value.trim().length > 0;

  return hasText || hasPersistedOrRecoveryAttachmentContent(values)
    ? undefined
    : "resources.notes.validation.note_or_attachment_required";
};
