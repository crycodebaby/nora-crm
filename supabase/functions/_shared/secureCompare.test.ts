// @vitest-environment node
import { describe, it, expect } from "vitest";
import { secureEquals } from "./secureCompare";

describe("secureEquals", () => {
  it("accepts identical strings", async () => {
    await expect(secureEquals("Basic abc", "Basic abc")).resolves.toBe(true);
    await expect(secureEquals("", "")).resolves.toBe(true);
  });

  it("rejects a different string of the same length", async () => {
    await expect(secureEquals("Basic abc", "Basic abd")).resolves.toBe(false);
  });

  it("rejects when only the first byte differs", async () => {
    await expect(secureEquals("Xasic abc", "Basic abc")).resolves.toBe(false);
  });

  it("rejects when only the last byte differs", async () => {
    await expect(secureEquals("Basic abc", "Basic abX")).resolves.toBe(false);
  });

  it("rejects a prefix, a suffix and a length mismatch", async () => {
    await expect(secureEquals("Basic ab", "Basic abc")).resolves.toBe(false);
    await expect(secureEquals("Basic abcd", "Basic abc")).resolves.toBe(false);
    await expect(secureEquals("", "Basic abc")).resolves.toBe(false);
  });

  it("rejects a missing header modelled as the empty string", async () => {
    await expect(secureEquals("", "Basic dXNlcjpwYXNz")).resolves.toBe(false);
  });

  it("is case sensitive and whitespace sensitive", async () => {
    await expect(secureEquals("basic abc", "Basic abc")).resolves.toBe(false);
    await expect(secureEquals("Basic abc ", "Basic abc")).resolves.toBe(false);
  });

  it("handles non-ASCII without throwing", async () => {
    await expect(secureEquals("Grüße", "Grüße")).resolves.toBe(true);
    await expect(secureEquals("Grüße", "Grusse")).resolves.toBe(false);
  });
});
