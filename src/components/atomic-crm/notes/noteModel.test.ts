import { describe, expect, it } from "vitest";

import {
  hasPersistedOrRecoveryAttachmentContent,
  validateNoteOrAttachmentRequired,
} from "./noteModel";

const REQUIRED = "resources.notes.validation.note_or_attachment_required";

const attachment = {
  path: "k1.pdf",
  title: "angebot.pdf",
  type: "application/pdf",
  src: "https://cdn.test/k1.pdf",
};

describe("note content validation", () => {
  it("accepts a note with text", () => {
    expect(
      validateNoteOrAttachmentRequired("Call summary", {}),
    ).toBeUndefined();
  });

  it("treats whitespace-only text as empty", () => {
    expect(validateNoteOrAttachmentRequired("   ", {})).toBe(REQUIRED);
  });

  it("accepts an attachment-only note", () => {
    expect(
      validateNoteOrAttachmentRequired("", { attachments: [attachment] }),
    ).toBeUndefined();
  });

  it("rejects a genuinely empty note", () => {
    expect(validateNoteOrAttachmentRequired("", { attachments: [] })).toBe(
      REQUIRED,
    );
    expect(validateNoteOrAttachmentRequired(null, {})).toBe(REQUIRED);
  });

  // W8-C S5: a degraded note reads back with `attachments = null` and its
  // legacy array quarantined. A legally persisted attachment-only note must
  // not become unsavable — a status or date edit would otherwise be refused
  // with "text or attachment required" about a note that has an attachment.
  describe("degraded existing note (W8-C S5)", () => {
    const degraded = {
      attachments: null,
      attachments_unverified_legacy: [attachment],
    };

    it("accepts a text edit on an attachment-only degraded note", () => {
      expect(
        validateNoteOrAttachmentRequired("Now with text", degraded),
      ).toBeUndefined();
    });

    it("accepts a non-attachment edit while text stays empty", () => {
      expect(validateNoteOrAttachmentRequired("", degraded)).toBeUndefined();
    });

    it("accepts clearing the text again back to the persisted state", () => {
      expect(validateNoteOrAttachmentRequired("", degraded)).toBeUndefined();
    });

    it("still rejects a degraded note with nothing to recover", () => {
      expect(
        validateNoteOrAttachmentRequired("", {
          attachments: null,
          attachments_unverified_legacy: [],
        }),
      ).toBe(REQUIRED);
    });
  });

  it("behaves exactly as before on CREATE, where recovery is absent", () => {
    // no `attachments_unverified_legacy` key exists on a new note
    expect(validateNoteOrAttachmentRequired("", {})).toBe(REQUIRED);
    expect(validateNoteOrAttachmentRequired("", { attachments: [] })).toBe(
      REQUIRED,
    );
    expect(
      validateNoteOrAttachmentRequired("", { attachments: [attachment] }),
    ).toBeUndefined();
    expect(validateNoteOrAttachmentRequired("text", {})).toBeUndefined();
  });
});

describe("hasPersistedOrRecoveryAttachmentContent", () => {
  it("counts recovery only as evidence that content exists", () => {
    expect(
      hasPersistedOrRecoveryAttachmentContent({ attachments: [attachment] }),
    ).toBe(true);
    expect(
      hasPersistedOrRecoveryAttachmentContent({
        attachments: null,
        attachments_unverified_legacy: [attachment],
      }),
    ).toBe(true);
    expect(hasPersistedOrRecoveryAttachmentContent({ attachments: null })).toBe(
      false,
    );
    expect(hasPersistedOrRecoveryAttachmentContent(undefined)).toBe(false);
  });
});
