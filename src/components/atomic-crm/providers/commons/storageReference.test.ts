import { classifyStorageReference } from "./storageReference";

/**
 * W8-E — the URL/identity policy for every stored file value.
 *
 * These are the adversarial cases. `src` is attacker-influenceable: anyone who
 * can write a note, any import, and every historical row predating the
 * relational attachment foundation can put an arbitrary string there. The
 * classifier is the single place that decides what such a value may become.
 */

const HOSTILE: [string, string][] = [
  ["javascript:", "javascript:alert(document.cookie)"],
  ["mixed-case JavaScript", "JaVaScRiPt:alert(1)"],
  ["javascript: with padding", "   javascript:alert(1)   "],
  ["data:text/html", "data:text/html,<script>alert(1)</script>"],
  ["vbscript:", "vbscript:msgbox(1)"],
  ["file:", "file:///etc/passwd"],
];

describe("classifyStorageReference — the stable key is the identity", () => {
  it("resolves a private attachment from its storage key, never from src", () => {
    expect(
      classifyStorageReference({
        path: "k1.png",
        src: "https://cdn.test/legacy-public-url.png",
      }),
    ).toEqual({ kind: "private", storageKey: "k1.png" });
  });

  it.each(HOSTILE)(
    "ignores a hostile src (%s) entirely when a storage key is present",
    (_label, src) => {
      // The security property: a key-bearing attachment can never be rendered
      // from its legacy URL, so a poisoned `src` is simply unreachable.
      expect(classifyStorageReference({ path: "k1.pdf", src })).toEqual({
        kind: "private",
        storageKey: "k1.pdf",
      });
    },
  );

  it("does not treat an empty path as a key", () => {
    expect(
      classifyStorageReference({ path: "", src: "https://ok.test/a" }),
    ).toEqual({ kind: "public", url: "https://ok.test/a" });
  });

  it("refuses to resolve a branding value from a stale attachments key", () => {
    // A migrated branding record still carries the OLD attachments key. Asking
    // for it again would sign against the wrong (private) bucket.
    expect(
      classifyStorageReference(
        {
          path: "0.4005419856169672.png",
          src: "https://cdn.test/branding.png",
        },
        "branding",
      ),
    ).toEqual({ kind: "public", url: "https://cdn.test/branding.png" });
  });
});

describe("classifyStorageReference — unsafe values never become links", () => {
  it.each(HOSTILE)("rejects %s when there is no storage key", (_label, src) => {
    expect(classifyStorageReference({ src })).toEqual({ kind: "none" });
  });

  it.each(HOSTILE)(
    "rejects %s for a branding value regardless of any key",
    (_label, src) => {
      expect(
        classifyStorageReference({ path: "k1.png", src }, "branding"),
      ).toEqual({ kind: "none" });
    },
  );

  it("rejects a protocol-relative value by upgrading it to https, not by trusting it", () => {
    expect(classifyStorageReference({ src: "//evil.test/x.png" })).toEqual({
      kind: "public",
      url: "https://evil.test/x.png",
    });
  });

  it("rejects empty, blank and absent values", () => {
    expect(classifyStorageReference(null)).toEqual({ kind: "none" });
    expect(classifyStorageReference(undefined)).toEqual({ kind: "none" });
    expect(classifyStorageReference({})).toEqual({ kind: "none" });
    expect(classifyStorageReference({ src: "   " })).toEqual({ kind: "none" });
  });

  it("does not accept a non-object value", () => {
    expect(classifyStorageReference("https://evil.test" as never)).toEqual({
      kind: "none",
    });
  });
});

describe("classifyStorageReference — the blob: exemption stays narrow", () => {
  it("accepts a blob: preview only together with a real File", () => {
    const file = new File(["x"], "neu.png", { type: "image/png" });
    expect(
      classifyStorageReference({
        src: "blob:http://localhost/abc",
        rawFile: file,
      }),
    ).toEqual({ kind: "local-preview", url: "blob:http://localhost/abc" });
  });

  it("refuses a blob: value that did not come with a File", () => {
    // A value deserialized from note JSON can never be a `File` instance, so
    // this is the shape a stored attack would have.
    expect(
      classifyStorageReference({ src: "blob:http://localhost/abc" }),
    ).toEqual({ kind: "none" });
    expect(
      classifyStorageReference({
        src: "blob:http://localhost/abc",
        rawFile: { name: "not-a-file" },
      }),
    ).toEqual({ kind: "none" });
  });

  it("refuses a File paired with a non-blob src", () => {
    const file = new File(["x"], "neu.png", { type: "image/png" });
    expect(
      classifyStorageReference({ src: "javascript:alert(1)", rawFile: file }),
    ).toEqual({ kind: "none" });
  });

  it("does not let a File smuggle a data: URL into the local-preview branch", () => {
    const file = new File(["x"], "neu.png", { type: "image/png" });
    // It is inline IMAGE content, which is renderable but never navigable.
    expect(
      classifyStorageReference({
        src: "data:image/png;base64,AAA",
        rawFile: file,
      }),
    ).toEqual({ kind: "inline", url: "data:image/png;base64,AAA" });
  });

  it("accepts only data:image/, never a data: document", () => {
    // `data:text/html` in a file field has no legitimate use and would be a
    // navigable document if it ever reached an href.
    expect(
      classifyStorageReference({ src: "data:image/webp;base64,AAA" }),
    ).toEqual({ kind: "inline", url: "data:image/webp;base64,AAA" });
    expect(
      classifyStorageReference({
        src: "data:text/html,<script>alert(1)</script>",
      }),
    ).toEqual({ kind: "none" });
    expect(classifyStorageReference({ src: "data:image/png" })).toEqual({
      kind: "none",
    });
  });

  it("does not let an inline value shadow a real storage object", () => {
    // Ordering matters: the key is checked BEFORE any `data:` handling, so a
    // hostile or stale inline value cannot displace the object it belongs to.
    expect(
      classifyStorageReference({
        path: "k1.png",
        src: "data:image/png;base64,AAA",
      }),
    ).toEqual({ kind: "private", storageKey: "k1.png" });
  });
});

/**
 * W8-E — employee/contact photos are PERSONAL DATA, not branding.
 *
 * They must never resolve through the public branding bucket. Today every
 * avatar in Production is either an inline `data:` image or a foreign URL, so
 * none of them cost a round trip; the private branch exists so that an avatar
 * which does carry a storage key renders through a derived capability instead
 * of silently disappearing.
 */
describe("classifyStorageReference — avatars are private, never branding", () => {
  it("derives a key-bearing avatar from the private bucket", () => {
    expect(classifyStorageReference({ path: "a1.png" }, "private")).toEqual({
      kind: "private",
      storageKey: "a1.png",
    });
  });

  it("passes an inline avatar through without a round trip", () => {
    expect(
      classifyStorageReference({ src: "data:image/png;base64,AAA" }, "private"),
    ).toEqual({ kind: "inline", url: "data:image/png;base64,AAA" });
  });

  it("passes a foreign avatar URL through without a round trip", () => {
    expect(
      classifyStorageReference({ src: "https://favicon.show/x.de" }, "private"),
    ).toEqual({ kind: "public", url: "https://favicon.show/x.de" });
  });
});

describe("classifyStorageReference — deliberately public values still work", () => {
  it("passes a foreign avatar URL through unchanged", () => {
    expect(
      classifyStorageReference({ src: "https://favicon.show/example.de" }),
    ).toEqual({ kind: "public", url: "https://favicon.show/example.de" });
  });

  it("passes a public branding URL through", () => {
    const url =
      "https://kixxroxtfzbcbzctohex.supabase.co/storage/v1/object/public/branding/logo.png";
    expect(classifyStorageReference({ src: url }, "branding")).toEqual({
      kind: "public",
      url,
    });
  });
});
