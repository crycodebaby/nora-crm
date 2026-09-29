import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { noteAttachmentCallbacks } from "./dataProvider";
import { classifyStorageReference } from "../commons/storageReference";

/**
 * Alpha Storage 3 M-2 — what a PRIVATE upload persists.
 *
 * The W8-E runtime reaches a private object through `path -> signed URL` and
 * never through `src`. But the pre-W8-E runtime dereferences `src`
 * unconditionally (`fi.src.startsWith(...)`), so an element persisted without
 * one makes an N-1 runtime rollback crash on the next note save. The upload
 * therefore persists:
 *
 *   path = the generated storage key         (identity / authority)
 *   src  = the canonical public URL of THAT  (inert N-1 compatibility data)
 *
 * and never a signed URL, a token, a query string or the incoming value.
 *
 * Only the network half of the client is doubled. `getPublicUrl` is the REAL
 * supabase-js helper against the local stack origin, so the asserted `src` is
 * byte-for-byte what the application persists.
 */
const LOCAL_ORIGIN = "http://127.0.0.1:54321";

const client = vi.hoisted(() => ({ current: null as any }));
vi.mock("./supabase", () => ({ getSupabaseClient: () => client.current }));

/** The S3B grammar's only accepted non-null `src`, verbatim from migration
 * 20260918120000 (`attachment_url_liveness`). */
const CANONICAL =
  /^(https?:\/\/[^/?#\s]+)\/storage\/v1\/object\/public\/attachments\/([A-Za-z0-9._-]+)$/;

const makeClient = () => {
  const real = createClient(LOCAL_ORIGIN, "test-publishable-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const calls = {
    upload: [] as { bucket: string; key: string }[],
    sign: [] as { bucket: string; key: string }[],
  };
  client.current = {
    storage: {
      from: (bucket: string) => ({
        upload: async (key: string) => {
          calls.upload.push({ bucket, key });
          return { data: { path: key }, error: null };
        },
        createSignedUrl: async (key: string) => {
          calls.sign.push({ bucket, key });
          return {
            data: {
              signedUrl: `${LOCAL_ORIGIN}/storage/v1/object/sign/${bucket}/${key}?token=secret`,
            },
            error: null,
          };
        },
        getPublicUrl: (key: string) =>
          real.storage.from(bucket).getPublicUrl(key),
      }),
    },
  };
  return calls;
};

const save = async (attachments: unknown[]) => {
  const callbacks = noteAttachmentCallbacks("contact_notes");
  const result = await (callbacks.beforeSave as any)(
    { contact_id: 1, text: "t", attachments },
    {},
    "contact_notes",
  );
  return result.attachments as Record<string, unknown>[];
};

afterEach(() => {
  client.current = null;
});

describe("private upload representation (M-2)", () => {
  it("persists the generated key as path and the canonical public URL of exactly that key as src", async () => {
    const calls = makeClient();
    const rawFile = new File(["%PDF"], "Angebot.PDF", {
      type: "application/pdf",
    });

    const [stored] = await save([
      { rawFile, src: URL.createObjectURL(rawFile), title: "Angebot.PDF" },
    ]);

    expect(calls.upload).toHaveLength(1);
    expect(calls.upload[0].bucket).toBe("attachments");
    expect(stored.path).toBe(calls.upload[0].key);
    expect(stored.path).toMatch(/^[0-9a-f-]{36}\.pdf$/);
    expect(stored.src).toBe(
      `${LOCAL_ORIGIN}/storage/v1/object/public/attachments/${stored.path}`,
    );
    expect(stored.type).toBe("application/pdf");
  });

  it("persists exactly the one src the S3B grammar accepts for that key", async () => {
    makeClient();
    const rawFile = new File(["x"], "bild.png", { type: "image/png" });

    const [stored] = await save([
      { rawFile, src: URL.createObjectURL(rawFile), title: "bild.png" },
    ]);

    const match = CANONICAL.exec(stored.src as string);
    expect(match).not.toBeNull();
    expect(match![1]).toBe(LOCAL_ORIGIN);
    expect(match![2]).toBe(stored.path);
  });

  it("never persists a signed URL, a token, a query string or the local blob", async () => {
    makeClient();
    const rawFile = new File(["x"], "a.txt", { type: "text/plain" });
    const blob = URL.createObjectURL(rawFile);

    const [stored] = await save([{ rawFile, src: blob, title: "a.txt" }]);
    const src = stored.src as string;

    expect(src).not.toContain("/object/sign/");
    expect(src).not.toContain("token");
    expect(src).not.toContain("?");
    expect(src).not.toContain("#");
    expect(src).not.toBe(blob);
    expect(src.startsWith("blob:")).toBe(false);
    expect(JSON.stringify(stored)).not.toContain("secret");
  });

  it("keeps an existing stored element as it is, without re-uploading", async () => {
    const calls = makeClient();
    const existing = {
      path: "k-existing.pdf",
      src: `${LOCAL_ORIGIN}/storage/v1/object/public/attachments/k-existing.pdf`,
      title: "alt.pdf",
      type: "application/pdf",
    };

    const [stored] = await save([{ ...existing }]);

    expect(calls.upload).toEqual([]);
    expect(calls.sign).toEqual([
      { bucket: "attachments", key: "k-existing.pdf" },
    ]);
    expect(stored).toEqual(existing);
  });

  it("is resolved by the W8-E runtime from path, never from the persisted src", async () => {
    makeClient();
    const rawFile = new File(["x"], "b.pdf", { type: "application/pdf" });

    const [stored] = await save([
      { rawFile, src: URL.createObjectURL(rawFile), title: "b.pdf" },
    ]);

    // the persisted JSON, as it comes back from the database: no File any more
    const persisted = JSON.parse(JSON.stringify(stored));
    expect(persisted.rawFile).toEqual({});
    expect(classifyStorageReference(persisted)).toEqual({
      kind: "private",
      storageKey: stored.path,
    });
  });
});
