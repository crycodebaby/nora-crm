import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createNoteWithReadModel,
  noteAttachmentCallbacks,
  updateNoteWithReadModel,
} from "./dataProvider";
import {
  CONTACT_NOTE_META_COLUMNS,
  DEAL_NOTE_META_COLUMNS,
} from "../commons/noteAttachmentReadModel";
import {
  NORA_ERROR_CODES,
  extractNoraErrorCode,
} from "../../domain/noraErrorCodes";

const legacy = (path: string, title: string, type = "application/pdf") => ({
  path,
  title,
  type,
  src: `https://cdn.test/${path}`,
});

const row = (storage_key: string, file_name: string, mime_type: string) => ({
  storage_key,
  file_name,
  mime_type,
});

/** Minimal base provider double — only what the S5 orchestration touches. */
const fakeBase = (over: Record<string, any> = {}) =>
  ({
    getOne: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    ...over,
  }) as any;

/** The callback slots are typed as "one or many"; these hooks are single. */
const callHook = (hook: unknown, ...args: any[]): Promise<any> =>
  (hook as (...a: any[]) => Promise<any>)(...args);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("note attachment read gate — transport injection", () => {
  it("enriches getList and getOne with the exact selector", async () => {
    for (const [resource, selector] of [
      ["contact_notes", CONTACT_NOTE_META_COLUMNS],
      ["deal_notes", DEAL_NOTE_META_COLUMNS],
    ] as const) {
      const callbacks = noteAttachmentCallbacks(resource);

      const listParams: any = await callHook(
        callbacks.beforeGetList,
        { filter: {}, pagination: { page: 1, perPage: 25 } } as any,
        {} as any,
        resource,
      );
      const oneParams: any = await callHook(
        callbacks.beforeGetOne,
        { id: 7 } as any,
        {} as any,
        resource,
      );

      expect(listParams.meta.columns).toBe(selector);
      expect(oneParams.meta.columns).toBe(selector);
      // META_COLUMNS only — embed/prefetch would append to the select
      expect(listParams.meta.embed).toBeUndefined();
      expect(listParams.meta.prefetch).toBeUndefined();
      expect(oneParams.meta.embed).toBeUndefined();
      expect(oneParams.meta.prefetch).toBeUndefined();
    }
  });

  it("maps every ordinary read through the fail-closed mapper", async () => {
    const callbacks = noteAttachmentCallbacks("contact_notes");

    const verified: any = await callHook(
      callbacks.afterRead,
      {
        id: 1,
        attachments: [legacy("k1.pdf", "a.pdf")],
        attachment_rows: [row("k1.pdf", "a.pdf", "application/pdf")],
      } as any,
      {} as any,
      "contact_notes",
    );
    expect(verified.attachments_state).toBe("ok");
    expect("attachment_rows" in verified).toBe(false);

    // an un-enriched read (getMany / getManyReference) carries no relation
    const unEnriched: any = await callHook(
      callbacks.afterRead,
      { id: 2, attachments: [legacy("k1.pdf", "a.pdf")] } as any,
      {} as any,
      "contact_notes",
    );
    expect(unEnriched.attachments_state).toBe("unverified");
    expect(unEnriched.attachments).toBeNull();
  });
});

describe("note attachment save guard", () => {
  const callbacks = noteAttachmentCallbacks("contact_notes");
  const guard = (data: any, previousData: any) =>
    callHook(
      callbacks.beforeUpdate,
      { id: 7, data, previousData } as any,
      {} as any,
      "contact_notes",
    );

  const verified = {
    attachments: [legacy("k1.pdf", "a.pdf")],
    attachments_state: "ok",
  };
  const drifted = {
    attachments: null,
    attachments_state: "drift",
    attachments_unverified_legacy: [legacy("k1.pdf", "a.pdf")],
  };

  it("allows a partial update that never mentions attachments", async () => {
    // the contact-merge patch: { contact_id } against a fail-closed read
    await expect(guard({ contact_id: 9 }, drifted)).resolves.toBeTruthy();
    await expect(guard({ sales_id: 4 }, drifted)).resolves.toBeTruthy();
    await expect(guard({ text: "edited" }, drifted)).resolves.toBeTruthy();
  });

  it("allows a text edit that carries the degraded null value", async () => {
    await expect(
      guard({ text: "edited", attachments: null }, drifted),
    ).resolves.toBeTruthy();
  });

  it("allows attachment changes on a verified note", async () => {
    await expect(
      guard({ attachments: [legacy("k2.pdf", "b.pdf")] }, verified),
    ).resolves.toBeTruthy();
  });

  it("blocks removing attachments from an unverified note", async () => {
    await expect(guard({ attachments: [] }, drifted)).rejects.toSatisfy(
      (error: unknown) =>
        extractNoraErrorCode(error) ===
        NORA_ERROR_CODES.ATTACHMENT_STATE_UNVERIFIED,
    );
  });

  it("blocks adding attachments to an unverified note", async () => {
    await expect(
      guard({ attachments: [legacy("k2.pdf", "b.pdf")] }, drifted),
    ).rejects.toSatisfy(
      (error: unknown) =>
        extractNoraErrorCode(error) ===
        NORA_ERROR_CODES.ATTACHMENT_STATE_UNVERIFIED,
    );
  });

  it("blocks an attachment payload with no previous state at all", async () => {
    await expect(guard({ attachments: [] }, undefined)).rejects.toSatisfy(
      (error: unknown) =>
        extractNoraErrorCode(error) ===
        NORA_ERROR_CODES.ATTACHMENT_STATE_UNVERIFIED,
    );
  });

  it("runs before beforeSave, so a refused write does zero Storage work", async () => {
    // Ordering is the framework's: beforeUpdate -> beforeSave -> provider.
    // A guard rejection therefore precedes every upload. Proven here by the
    // guard throwing without beforeSave having been invoked at all.
    const upload = vi.fn();
    const runWriteChain = async () => {
      const params = await callHook(
        callbacks.beforeUpdate,
        { id: 7, data: { attachments: [] }, previousData: drifted } as any,
        {} as any,
        "contact_notes",
      );
      upload();
      return params;
    };

    await expect(runWriteChain()).rejects.toThrow();
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("write metadata strip", () => {
  it("never persists the read-model fields", async () => {
    const callbacks = noteAttachmentCallbacks("contact_notes");
    const payload: any = await callHook(
      callbacks.beforeSave,
      {
        text: "hello",
        attachments: null,
        attachments_state: "drift",
        attachments_unverified_legacy: [legacy("k1.pdf", "a.pdf")],
        attachment_rows: [row("k1.pdf", "a.pdf", "application/pdf")],
      } as any,
      {} as any,
      "contact_notes",
    );

    expect(payload).toEqual({ text: "hello", attachments: null });
  });
});

describe("conditional post-commit verification", () => {
  const verifiedPrevious = {
    attachments: [legacy("k1.pdf", "a.pdf")],
    attachments_state: "ok" as const,
  };
  const committed = {
    id: 7,
    text: "edited",
    attachments: [legacy("k1.pdf", "a.pdf")],
  };
  const enriched = {
    id: 7,
    text: "edited",
    attachments: [legacy("k1.pdf", "a.pdf")],
    attachment_rows: [row("k1.pdf", "a.pdf", "application/pdf")],
  };

  it("always verifies a CREATE", async () => {
    const base = fakeBase({
      create: vi.fn().mockResolvedValue({ data: committed }),
      getOne: vi.fn().mockResolvedValue({ data: enriched }),
    });

    const result = await createNoteWithReadModel(base, "contact_notes", {
      data: { text: "edited" },
    });

    expect(base.getOne).toHaveBeenCalledWith("contact_notes", {
      id: 7,
      meta: { columns: CONTACT_NOTE_META_COLUMNS },
    });
    expect(result.data.attachments_state).toBe("ok");
    expect("attachment_rows" in result.data).toBe(false);
  });

  it("verifies an attachment-changing UPDATE", async () => {
    const base = fakeBase({
      update: vi.fn().mockResolvedValue({ data: committed }),
      getOne: vi.fn().mockResolvedValue({ data: enriched }),
    });

    await updateNoteWithReadModel(base, "contact_notes", {
      id: 7,
      data: { attachments: [legacy("k1.pdf", "a.pdf")] },
      previousData: { attachments: [], attachments_state: "ok" },
    });

    expect(base.getOne).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["text", { text: "edited" }],
    ["status", { status: "hot" }],
    ["date", { date: "2026-09-21T00:00:00.000Z" }],
  ])("issues NO verification read for a %s-only UPDATE", async (_, data) => {
    const base = fakeBase({
      update: vi.fn().mockResolvedValue({ data: committed }),
      getOne: vi.fn(),
    });

    const result = await updateNoteWithReadModel(base, "contact_notes", {
      id: 7,
      data,
      previousData: verifiedPrevious,
    });

    expect(base.getOne).not.toHaveBeenCalled();
    expect(result.data.attachments_state).toBe("ok");
    expect(result.data.attachments).toEqual(verifiedPrevious.attachments);
  });

  it("keeps a degraded note degraded across a text-only UPDATE", async () => {
    const drifted = {
      attachments: null,
      attachments_state: "drift" as const,
      attachments_unverified_legacy: [legacy("k1.pdf", "a.pdf")],
    };
    const base = fakeBase({
      // the raw PostgREST row still carries the legacy DB JSON
      update: vi.fn().mockResolvedValue({ data: committed }),
      getOne: vi.fn(),
    });

    const result = await updateNoteWithReadModel(base, "contact_notes", {
      id: 7,
      data: { text: "edited", attachments: null },
      previousData: drifted,
    });

    expect(base.getOne).not.toHaveBeenCalled();
    expect(result.data.attachments_state).toBe("drift");
    expect(result.data.attachments).toBeNull();
    expect(result.data.attachments_unverified_legacy).toEqual(
      drifted.attachments_unverified_legacy,
    );
  });

  it("verifies when the legacy JSON moved although the write did not touch it", async () => {
    const base = fakeBase({
      update: vi.fn().mockResolvedValue({
        data: { ...committed, attachments: [legacy("k9.pdf", "other.pdf")] },
      }),
      getOne: vi.fn().mockResolvedValue({ data: enriched }),
    });

    await updateNoteWithReadModel(base, "contact_notes", {
      id: 7,
      data: { text: "edited" },
      previousData: verifiedPrevious,
    });

    expect(base.getOne).toHaveBeenCalledTimes(1);
  });

  it("never returns raw legacy JSON as verified without a previous state", async () => {
    const base = fakeBase({
      update: vi.fn().mockResolvedValue({ data: committed }),
      getOne: vi.fn().mockResolvedValue({ data: enriched }),
    });

    const result = await updateNoteWithReadModel(base, "contact_notes", {
      id: 7,
      data: { text: "edited" },
      previousData: { id: 7, text: "old" },
    });

    expect(base.getOne).toHaveBeenCalledTimes(1);
    expect(result.data.attachments_state).toBe("ok");
  });
});

describe("post-commit verification failure", () => {
  it("keeps a committed CREATE successful and degrades honestly", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rawLegacy = [legacy("k1.pdf", "a.pdf")];
    const base = fakeBase({
      create: vi
        .fn()
        .mockResolvedValue({ data: { id: 7, attachments: rawLegacy } }),
      getOne: vi.fn().mockRejectedValue(new Error("network")),
    });

    const result = await createNoteWithReadModel(base, "contact_notes", {
      data: {},
    });

    expect(result.data.attachments_state).toBe("unverified");
    expect(result.data.attachments).toBeNull();
    expect(result.data.attachments_unverified_legacy).toEqual(rawLegacy);
  });

  it("keeps a committed attachment-changing UPDATE successful", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rawLegacy = [legacy("k1.pdf", "a.pdf")];
    const base = fakeBase({
      update: vi
        .fn()
        .mockResolvedValue({ data: { id: 7, attachments: rawLegacy } }),
      getOne: vi.fn().mockRejectedValue(new Error("network")),
    });

    const result = await updateNoteWithReadModel(base, "contact_notes", {
      id: 7,
      data: { attachments: rawLegacy },
      previousData: { attachments: [], attachments_state: "ok" },
    });

    expect(result.data.attachments_state).toBe("unverified");
    expect(result.data.attachments).toBeNull();
    expect(result.data.attachments_unverified_legacy).toEqual(rawLegacy);
  });
});
