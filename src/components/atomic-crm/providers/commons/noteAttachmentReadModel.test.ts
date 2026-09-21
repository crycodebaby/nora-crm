import { describe, expect, it } from "vitest";

import {
  CONTACT_NOTE_META_COLUMNS,
  DEAL_NOTE_META_COLUMNS,
  attachmentsEqual,
  degradeNoteAttachmentReadModel,
  hasCanonicalReadModel,
  isNoteAttachmentChange,
  isNoteResource,
  mapNoteAttachmentReadModel,
  planNoteUpdateResult,
  preserveNoteAttachmentReadModel,
  priorLegacyAttachments,
  recoveryAttachments,
  stripNoteReadModelMetadata,
  verifiedAttachments,
} from "./noteAttachmentReadModel";

const legacy = (
  path: string,
  title: string,
  type = "application/pdf",
  extra: Record<string, unknown> = {},
) => ({ path, title, type, src: `https://cdn.test/${path}`, ...extra }) as any;

const row = (
  storage_key: string,
  file_name: string,
  mime_type = "application/pdf",
) => ({ storage_key, file_name, mime_type });

const noteRow = (over: Record<string, unknown> = {}) => ({
  id: 7,
  contact_id: 3,
  text: "hello",
  ...over,
});

describe("W8-C S5 transport selectors", () => {
  // The alias is mandatory: contact_notes/deal_notes already own a column
  // literally named `attachments`, so an unaliased embed and the legacy
  // column would contend for one key in the response object.
  it("are single-line, whitespace-free and aliased to attachment_rows", () => {
    for (const selector of [
      CONTACT_NOTE_META_COLUMNS,
      DEAL_NOTE_META_COLUMNS,
    ]) {
      expect(selector).not.toMatch(/\s/);
      expect(selector.startsWith("*,attachment_rows:attachments!")).toBe(true);
      expect(selector).toContain("(storage_key,file_name,mime_type)");
      // no id, byte_size, created_at or owner FK in the embedded payload
      expect(selector).not.toContain("byte_size");
      expect(selector).not.toContain("created_at");
      expect(selector).not.toContain("contact_note_id,");
      expect(selector).not.toContain("deal_note_id,");
    }
  });

  it("embeds through the exact foreign keys of migration 20260916120000", () => {
    expect(CONTACT_NOTE_META_COLUMNS).toContain(
      "attachments!attachments_contact_note_id_fkey",
    );
    expect(DEAL_NOTE_META_COLUMNS).toContain(
      "attachments!attachments_deal_note_id_fkey",
    );
  });

  it("recognizes exactly the two note resources", () => {
    expect(isNoteResource("contact_notes")).toBe(true);
    expect(isNoteResource("deal_notes")).toBe(true);
    expect(isNoteResource("contacts")).toBe(false);
    expect(isNoteResource("attachments")).toBe(false);
  });
});

describe("attachmentsEqual", () => {
  it("keeps [] and null apart in both directions", () => {
    expect(attachmentsEqual([], [])).toBe(true);
    expect(attachmentsEqual(null, null)).toBe(true);
    expect(attachmentsEqual([], null)).toBe(false);
    expect(attachmentsEqual(null, [])).toBe(false);
  });

  it("treats an absent value as different from null", () => {
    // Load-bearing: it is why the guard needs its own key-presence check.
    expect(attachmentsEqual(undefined, null)).toBe(false);
  });

  it("compares attachment arrays structurally, order included", () => {
    const a = [legacy("k1.pdf", "a.pdf"), legacy("k2.pdf", "b.pdf")];
    expect(attachmentsEqual(a, [...a])).toBe(true);
    expect(attachmentsEqual(a, [a[1], a[0]])).toBe(false);
    expect(attachmentsEqual(a, [legacy("k1.pdf", "renamed.pdf"), a[1]])).toBe(
      false,
    );
  });

  it("uses the transport's own File semantics, not lodash's", () => {
    // `getChanges` inside ra-data-postgrest compares with dequal, which
    // walks a File's enumerable metadata. Two Files with identical metadata
    // are equal to it; lodash/isEqual would disagree. The guard must ask the
    // same question the transport will ask.
    const lastModified = 1_700_000_000_000;
    const left = new File(["AAA"], "same.pdf", {
      type: "application/pdf",
      lastModified,
    });
    const right = new File(["BBB"], "same.pdf", {
      type: "application/pdf",
      lastModified,
    });

    expect(
      attachmentsEqual(
        [legacy("k.pdf", "same.pdf", "application/pdf", { rawFile: left })],
        [legacy("k.pdf", "same.pdf", "application/pdf", { rawFile: right })],
      ),
    ).toBe(true);
  });
});

describe("mapNoteAttachmentReadModel", () => {
  it("maps a verified note to ok and returns the legacy array verbatim", () => {
    const first = legacy("k1.pdf", "a.pdf", "application/pdf", {
      unknown_legacy_field: "kept",
    });
    const second = legacy("k2.png", "b.png", "image/png");
    const mapped = mapNoteAttachmentReadModel(
      noteRow({
        attachments: [first, second],
        attachment_rows: [
          row("k2.png", "b.png", "image/png"),
          row("k1.pdf", "a.pdf"),
        ],
      }),
    );

    expect(mapped.attachments_state).toBe("ok");
    // verbatim: JSON order, src, and tolerated unknown fields survive
    expect(mapped.attachments).toEqual([first, second]);
    expect(mapped.attachments[0].unknown_legacy_field).toBe("kept");
    expect(mapped.attachments_unverified_legacy).toBeUndefined();
  });

  it("maps a verified empty note to [] — never null", () => {
    expect(
      mapNoteAttachmentReadModel(
        noteRow({ attachments: [], attachment_rows: [] }),
      ),
    ).toMatchObject({ attachments: [], attachments_state: "ok" });

    expect(
      mapNoteAttachmentReadModel(
        noteRow({ attachments: null, attachment_rows: [] }),
      ),
    ).toMatchObject({ attachments: [], attachments_state: "ok" });
  });

  it("always removes the relational rows from the public result", () => {
    const mapped = mapNoteAttachmentReadModel(
      noteRow({ attachments: [], attachment_rows: [] }),
    );
    expect("attachment_rows" in mapped).toBe(false);
  });

  it("drifts on a title mismatch", () => {
    const mapped = mapNoteAttachmentReadModel(
      noteRow({
        attachments: [legacy("k1.pdf", "a.pdf")],
        attachment_rows: [row("k1.pdf", "renamed.pdf")],
      }),
    );
    expect(mapped.attachments_state).toBe("drift");
    expect(mapped.attachments).toBeNull();
    expect(mapped.attachments_unverified_legacy).toEqual([
      legacy("k1.pdf", "a.pdf"),
    ]);
  });

  it("drifts on a mime mismatch", () => {
    expect(
      mapNoteAttachmentReadModel(
        noteRow({
          attachments: [legacy("k1.pdf", "a.pdf", "application/pdf")],
          attachment_rows: [row("k1.pdf", "a.pdf", "image/png")],
        }),
      ).attachments_state,
    ).toBe("drift");
  });

  it("drifts on a missing relational key", () => {
    expect(
      mapNoteAttachmentReadModel(
        noteRow({
          attachments: [legacy("k1.pdf", "a.pdf"), legacy("k2.pdf", "b.pdf")],
          attachment_rows: [row("k1.pdf", "a.pdf")],
        }),
      ).attachments_state,
    ).toBe("drift");
  });

  it("drifts on an extra relational key", () => {
    expect(
      mapNoteAttachmentReadModel(
        noteRow({
          attachments: [legacy("k1.pdf", "a.pdf")],
          attachment_rows: [row("k1.pdf", "a.pdf"), row("k9.pdf", "ghost.pdf")],
        }),
      ).attachments_state,
    ).toBe("drift");
  });

  it("drifts on a legacy element without a storage key", () => {
    expect(
      mapNoteAttachmentReadModel(
        noteRow({
          attachments: [{ title: "a.pdf", src: "https://elsewhere/a.pdf" }],
          attachment_rows: [row("k1.pdf", "a.pdf")],
        }),
      ).attachments_state,
    ).toBe("drift");
  });

  it("ignores array order when comparing membership", () => {
    const attachments = [legacy("k1.pdf", "a.pdf"), legacy("k2.pdf", "b.pdf")];
    expect(
      mapNoteAttachmentReadModel(
        noteRow({
          attachments,
          attachment_rows: [row("k2.pdf", "b.pdf"), row("k1.pdf", "a.pdf")],
        }),
      ).attachments_state,
    ).toBe("ok");
  });

  it("fails closed on an un-enriched read (no attachment_rows at all)", () => {
    // getMany / getManyReference never carry the relation — such a read is
    // never "verified because the JSON looks fine".
    const mapped = mapNoteAttachmentReadModel(
      noteRow({ attachments: [legacy("k1.pdf", "a.pdf")] }),
    );
    expect(mapped.attachments_state).toBe("unverified");
    expect(mapped.attachments).toBeNull();
    expect(mapped.attachments_unverified_legacy).toEqual([
      legacy("k1.pdf", "a.pdf"),
    ]);
  });

  it("quarantines to [] when an un-enriched read has no legacy array", () => {
    expect(mapNoteAttachmentReadModel(noteRow())).toMatchObject({
      attachments: null,
      attachments_state: "unverified",
      attachments_unverified_legacy: [],
    });
  });

  it("never lets a stale read-model state survive a re-map", () => {
    const mapped = mapNoteAttachmentReadModel(
      noteRow({
        attachments: [],
        attachment_rows: [],
        attachments_state: "drift",
        attachments_unverified_legacy: [legacy("stale.pdf", "stale.pdf")],
      }),
    );
    expect(mapped.attachments_state).toBe("ok");
    expect(mapped.attachments_unverified_legacy).toBeUndefined();
  });
});

describe("verified / recovery accessors", () => {
  it("returns the array only for ok", () => {
    const attachments = [legacy("k1.pdf", "a.pdf")];
    expect(
      verifiedAttachments({ attachments, attachments_state: "ok" }),
    ).toEqual(attachments);
    expect(
      verifiedAttachments({ attachments: null, attachments_state: "ok" }),
    ).toEqual([]);
    expect(
      verifiedAttachments({ attachments: null, attachments_state: "drift" }),
    ).toBeNull();
    expect(
      verifiedAttachments({
        attachments: null,
        attachments_state: "unverified",
      }),
    ).toBeNull();
    // an undefined state is not a verified state
    expect(verifiedAttachments({ attachments })).toBeNull();
    expect(verifiedAttachments(undefined)).toBeNull();
  });

  it("never reads the normal attachments field for recovery", () => {
    const quarantined = [legacy("k1.pdf", "a.pdf")];
    expect(
      recoveryAttachments({
        attachments: null,
        attachments_state: "drift",
        attachments_unverified_legacy: quarantined,
      }),
    ).toEqual(quarantined);

    // a degraded record whose legacy array sits (wrongly) under `attachments`
    // must not leak into the recovery view
    expect(
      recoveryAttachments({
        attachments: quarantined,
        attachments_state: "unverified",
      }),
    ).toEqual([]);

    expect(
      recoveryAttachments({
        attachments: quarantined,
        attachments_state: "ok",
        attachments_unverified_legacy: quarantined,
      }),
    ).toEqual([]);
    expect(recoveryAttachments(undefined)).toEqual([]);
  });
});

describe("stripNoteReadModelMetadata", () => {
  it("removes every read-contract field before persistence", () => {
    const stripped = stripNoteReadModelMetadata({
      text: "hello",
      attachments: [legacy("k1.pdf", "a.pdf")],
      attachments_state: "ok",
      attachments_unverified_legacy: [],
      attachment_rows: [row("k1.pdf", "a.pdf")],
    });

    expect(stripped).toEqual({
      text: "hello",
      attachments: [legacy("k1.pdf", "a.pdf")],
    });
  });

  it("leaves a payload without metadata untouched", () => {
    expect(stripNoteReadModelMetadata({ text: "hi" })).toEqual({ text: "hi" });
  });
});

describe("isNoteAttachmentChange", () => {
  const previous = {
    attachments: [legacy("k1.pdf", "a.pdf")],
    attachments_state: "ok" as const,
  };

  it("is false when the payload does not mention attachments", () => {
    // The contact-merge patch and other partial note updates must pass.
    expect(isNoteAttachmentChange({ contact_id: 9 }, previous)).toBe(false);
    expect(isNoteAttachmentChange({ sales_id: 4 }, previous)).toBe(false);
    expect(isNoteAttachmentChange({ text: "edited" }, previous)).toBe(false);
  });

  it("is false when a degraded note is saved with its null value", () => {
    expect(
      isNoteAttachmentChange(
        { text: "edited", attachments: null },
        { attachments: null, attachments_state: "drift" },
      ),
    ).toBe(false);
  });

  it("is true for [] vs null and null vs [] in both directions", () => {
    expect(
      isNoteAttachmentChange({ attachments: [] }, { attachments: null }),
    ).toBe(true);
    expect(
      isNoteAttachmentChange({ attachments: null }, { attachments: [] }),
    ).toBe(true);
  });

  it("is true when attachments are removed or replaced", () => {
    expect(isNoteAttachmentChange({ attachments: [] }, previous)).toBe(true);
    expect(
      isNoteAttachmentChange(
        { attachments: [legacy("k2.pdf", "b.pdf")] },
        previous,
      ),
    ).toBe(true);
  });

  it("is true when previousData is missing entirely", () => {
    expect(isNoteAttachmentChange({ attachments: [] }, undefined)).toBe(true);
    expect(isNoteAttachmentChange({ attachments: null }, null)).toBe(true);
  });
});

describe("previous-state helpers", () => {
  it("recognizes only the three canonical states", () => {
    expect(hasCanonicalReadModel({ attachments_state: "ok" })).toBe(true);
    expect(hasCanonicalReadModel({ attachments_state: "drift" })).toBe(true);
    expect(hasCanonicalReadModel({ attachments_state: "unverified" })).toBe(
      true,
    );
    expect(hasCanonicalReadModel({})).toBe(false);
    expect(hasCanonicalReadModel(undefined)).toBe(false);
    expect(hasCanonicalReadModel({ attachments_state: "nonsense" })).toBe(
      false,
    );
  });

  it("reads the legacy snapshot from the right field per state", () => {
    const verified = [legacy("k1.pdf", "a.pdf")];
    const quarantined = [legacy("k2.pdf", "b.pdf")];

    expect(
      priorLegacyAttachments({
        attachments: verified,
        attachments_state: "ok",
      }),
    ).toEqual(verified);

    expect(
      priorLegacyAttachments({
        attachments: null,
        attachments_state: "drift",
        attachments_unverified_legacy: quarantined,
      }),
    ).toEqual(quarantined);

    expect(priorLegacyAttachments(undefined)).toEqual([]);
  });
});

describe("planNoteUpdateResult", () => {
  const verifiedPrevious = {
    attachments: [legacy("k1.pdf", "a.pdf")],
    attachments_state: "ok" as const,
  };
  const driftPrevious = {
    attachments: null,
    attachments_state: "drift" as const,
    attachments_unverified_legacy: [legacy("k1.pdf", "a.pdf")],
  };

  it("preserves — no verification read — for a text-only update", () => {
    expect(
      planNoteUpdateResult(
        { text: "edited" },
        verifiedPrevious,
        noteRow({ attachments: [legacy("k1.pdf", "a.pdf")] }),
      ),
    ).toBe("preserve");
  });

  it("preserves for a status-only and a date-only update", () => {
    const committed = noteRow({ attachments: [legacy("k1.pdf", "a.pdf")] });
    expect(
      planNoteUpdateResult({ status: "hot" }, verifiedPrevious, committed),
    ).toBe("preserve");
    expect(
      planNoteUpdateResult(
        { date: "2026-09-21T00:00:00.000Z" },
        verifiedPrevious,
        committed,
      ),
    ).toBe("preserve");
  });

  it("preserves a degraded state across a text-only update", () => {
    expect(
      planNoteUpdateResult(
        { text: "edited", attachments: null },
        driftPrevious,
        noteRow({ attachments: [legacy("k1.pdf", "a.pdf")] }),
      ),
    ).toBe("preserve");
  });

  it("verifies after an attachment-changing update", () => {
    expect(
      planNoteUpdateResult(
        { attachments: [legacy("k1.pdf", "a.pdf"), legacy("k2.pdf", "b.pdf")] },
        verifiedPrevious,
        noteRow({
          attachments: [legacy("k1.pdf", "a.pdf"), legacy("k2.pdf", "b.pdf")],
        }),
      ),
    ).toBe("verify");
  });

  it("verifies when the legacy JSON moved although this write did not", () => {
    // A concurrent change: stale state must never be carried over.
    expect(
      planNoteUpdateResult(
        { text: "edited" },
        verifiedPrevious,
        noteRow({ attachments: [legacy("k9.pdf", "someone-else.pdf")] }),
      ),
    ).toBe("verify");
  });

  it("verifies when there is no trustworthy previous state", () => {
    expect(
      planNoteUpdateResult(
        { text: "edited" },
        { attachments: [legacy("k1.pdf", "a.pdf")] },
        noteRow({ attachments: [legacy("k1.pdf", "a.pdf")] }),
      ),
    ).toBe("verify");
    expect(planNoteUpdateResult({ text: "edited" }, undefined, noteRow())).toBe(
      "verify",
    );
  });
});

describe("mutation-result read model", () => {
  it("carries a verified previous state over an unchanged mutation row", () => {
    const attachments = [legacy("k1.pdf", "a.pdf")];
    const preserved = preserveNoteAttachmentReadModel(
      noteRow({ text: "edited", attachments }),
      { attachments, attachments_state: "ok" },
    );

    expect(preserved).toMatchObject({
      text: "edited",
      attachments,
      attachments_state: "ok",
    });
    expect(preserved.attachments_unverified_legacy).toBeUndefined();
  });

  it("keeps a degraded note degraded — the raw row never resurrects it", () => {
    const quarantined = [legacy("k1.pdf", "a.pdf")];
    const preserved = preserveNoteAttachmentReadModel(
      // the raw PostgREST row still carries the legacy DB JSON
      noteRow({ text: "edited", attachments: quarantined }),
      {
        attachments: null,
        attachments_state: "drift",
        attachments_unverified_legacy: quarantined,
      },
    );

    expect(preserved.attachments).toBeNull();
    expect(preserved.attachments_state).toBe("drift");
    expect(preserved.attachments_unverified_legacy).toEqual(quarantined);
  });

  it("degrades a committed row honestly when verification is impossible", () => {
    const rawLegacy = [legacy("k1.pdf", "a.pdf")];
    const degraded = degradeNoteAttachmentReadModel(
      noteRow({ attachments: rawLegacy, attachment_rows: [] }),
    );

    expect(degraded.attachments).toBeNull();
    expect(degraded.attachments_state).toBe("unverified");
    expect(degraded.attachments_unverified_legacy).toEqual(rawLegacy);
    expect("attachment_rows" in degraded).toBe(false);
  });
});
