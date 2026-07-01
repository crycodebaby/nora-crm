/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import {
  canSearchQuery,
  isBusinessNumberQuery,
  isPhoneLikeQuery,
  normalizeCaseNumberQuery,
  normalizeCustomerNumberQuery,
  normalizePhoneForSearch,
  prepareSearchTerm,
} from "./globalSearch";

describe("normalizeCustomerNumberQuery", () => {
  it("pads numeric part to six digits", () => {
    expect(normalizeCustomerNumberQuery("kd-1")).toBe("KD-000001");
    expect(normalizeCustomerNumberQuery("KD-42")).toBe("KD-000042");
  });

  it("returns null for non-customer numbers", () => {
    expect(normalizeCustomerNumberQuery("VG-2026-000001")).toBeNull();
    expect(normalizeCustomerNumberQuery("Müller")).toBeNull();
  });
});

describe("normalizeCaseNumberQuery", () => {
  it("pads sequence to six digits", () => {
    expect(normalizeCaseNumberQuery("vg-2026-1")).toBe("VG-2026-000001");
  });

  it("returns null for invalid patterns", () => {
    expect(normalizeCaseNumberQuery("KD-000001")).toBeNull();
  });
});

describe("normalizePhoneForSearch", () => {
  it("removes spaces, dashes and parentheses", () => {
    expect(normalizePhoneForSearch("030 12 34-56")).toBe("030123456");
    expect(normalizePhoneForSearch("(030) 1234567")).toBe("0301234567");
  });
});

describe("isPhoneLikeQuery", () => {
  it("detects digit-heavy queries", () => {
    expect(isPhoneLikeQuery("030 12345")).toBe(true);
    expect(isPhoneLikeQuery("+4930123456")).toBe(true);
    expect(isPhoneLikeQuery("Müller")).toBe(false);
  });
});

describe("prepareSearchTerm", () => {
  it("normalizes phone-like input", () => {
    expect(prepareSearchTerm("030 12 34")).toBe("0301234");
  });

  it("keeps text queries trimmed", () => {
    expect(prepareSearchTerm("  Hauser  ")).toBe("Hauser");
  });
});

describe("canSearchQuery", () => {
  it("allows business numbers with fewer than two chars in numeric part", () => {
    expect(canSearchQuery("KD-1")).toBe(true);
    expect(isBusinessNumberQuery("KD-1")).toBe(true);
  });

  it("requires two characters for free text", () => {
    expect(canSearchQuery("a")).toBe(false);
    expect(canSearchQuery("ab")).toBe(true);
  });
});
