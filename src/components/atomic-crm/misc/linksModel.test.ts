import { describe, expect, it } from "vitest";
import {
  cleanLinksJsonb,
  isValidUrl,
  normalizeUrl,
  LINK_TYPES,
} from "./linksModel";

describe("isValidUrl", () => {
  it("accepts a plain https URL", () => {
    expect(isValidUrl("https://metaphor.de")).toBeUndefined();
  });

  it("accepts a bare domain without scheme (normalized before validation)", () => {
    expect(isValidUrl("metaphor.de")).toBeUndefined();
  });

  it("accepts non-LinkedIn URLs — no domain whitelist", () => {
    expect(isValidUrl("https://instagram.com/metaphor")).toBeUndefined();
    expect(isValidUrl("https://facebook.com/metaphor")).toBeUndefined();
  });

  it("rejects garbage input", () => {
    expect(isValidUrl("not a url at all !!")).toMatchObject({
      message: "crm.validation.invalid_url",
    });
  });

  it("treats empty input as valid (optional field)", () => {
    expect(isValidUrl("")).toBeUndefined();
  });
});

describe("cleanLinksJsonb", () => {
  it("drops rows without a url", () => {
    expect(
      cleanLinksJsonb([
        { url: "", type: "website" },
        { url: "https://metaphor.de", type: "website" },
      ] as any),
    ).toEqual([{ url: "https://metaphor.de", type: "website" }]);
  });

  it("returns an empty array for null/undefined", () => {
    expect(cleanLinksJsonb(null)).toEqual([]);
    expect(cleanLinksJsonb(undefined)).toEqual([]);
  });
});

describe("normalizeUrl", () => {
  it("adds https:// to a bare domain", () => {
    expect(normalizeUrl("metaphor.de")).toBe("https://metaphor.de");
  });

  it("leaves an already-scheme'd URL untouched", () => {
    expect(normalizeUrl("http://metaphor.de")).toBe("http://metaphor.de");
  });
});

describe("LINK_TYPES", () => {
  it("has no LinkedIn-only restriction — offers a general set of link types", () => {
    expect(LINK_TYPES).toEqual([
      "website",
      "linkedin",
      "instagram",
      "facebook",
      "google",
      "portal",
      "other",
    ]);
  });
});
