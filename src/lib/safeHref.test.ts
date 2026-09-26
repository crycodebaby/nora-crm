import { describe, expect, it } from "vitest";
import { safeHref } from "./safeHref";

describe("safeHref", () => {
  it("allows http and https URLs unchanged", () => {
    expect(safeHref("http://example.com")).toBe("http://example.com");
    expect(safeHref("https://example.com/path?q=1")).toBe(
      "https://example.com/path?q=1",
    );
  });

  it("allows mailto and tel", () => {
    expect(safeHref("mailto:foo@bar.de")).toBe("mailto:foo@bar.de");
    expect(safeHref("tel:+49123")).toBe("tel:+49123");
  });

  it("rejects javascript: URLs", () => {
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("  javascript:alert(document.cookie)  ")).toBeUndefined();
    expect(safeHref("JavaScript:alert(1)")).toBeUndefined();
  });

  it("rejects data: and other script-capable schemes", () => {
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBeUndefined();
    expect(safeHref("vbscript:msgbox(1)")).toBeUndefined();
    expect(safeHref("file:///etc/passwd")).toBeUndefined();
  });

  it("upgrades a bare host to https", () => {
    expect(safeHref("example.com")).toBe("https://example.com");
    expect(safeHref("www.foo.de/path")).toBe("https://www.foo.de/path");
  });

  it("upgrades protocol-relative URLs to https", () => {
    expect(safeHref("//cdn.example.com/x")).toBe("https://cdn.example.com/x");
  });

  it("passes through same-origin relative links", () => {
    expect(safeHref("/contacts/1")).toBe("/contacts/1");
    expect(safeHref("#section")).toBe("#section");
  });

  it("returns undefined for empty or nullish input", () => {
    expect(safeHref(null)).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
    expect(safeHref("")).toBeUndefined();
    expect(safeHref("   ")).toBeUndefined();
  });
});
