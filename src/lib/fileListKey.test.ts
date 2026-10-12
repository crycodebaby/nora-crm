import { describe, expect, it } from "vitest";

import { fileListKey } from "./fileListKey";

describe("fileListKey", () => {
  it("keys a persisted file by its storage key, not by src", () => {
    expect(
      fileListKey(
        { path: "k1.pdf", src: "https://x.test/other.pdf", title: "a" },
        3,
      ),
    ).toBe("path:k1.pdf");
  });

  it("keys a path-only file by its storage key", () => {
    expect(fileListKey({ path: "k1.pdf", title: "a" }, 0)).toBe("path:k1.pdf");
  });

  it("gives two path-only files two different keys", () => {
    // the pre-remediation mobile list keyed by `src`, so every path-only
    // element collapsed onto the same key (`undefined`)
    expect(fileListKey({ path: "a.pdf" }, 0)).not.toBe(
      fileListKey({ path: "b.pdf" }, 1),
    );
  });

  it("keys a file picked in this session by its local object URL", () => {
    expect(fileListKey({ src: "blob:http://localhost/1", title: "a" }, 2)).toBe(
      "src:blob:http://localhost/1",
    );
  });

  it("falls back to the position only when there is no identity", () => {
    expect(fileListKey({ title: "a" }, 4)).toBe("index:4");
    expect(fileListKey({ path: "", src: "" }, 5)).toBe("index:5");
    expect(fileListKey(null, 6)).toBe("index:6");
  });

  it("cannot collide a key with a src or an index across namespaces", () => {
    expect(fileListKey({ path: "index:1" }, 1)).not.toBe(
      fileListKey({}, 1),
    );
  });
});
