/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import {
  formatNoraRelativeDay,
  NORA_DATE_FALLBACK,
} from "../misc/noraDateTime";
import { getRelativeTimeString } from "./dealUtils";

describe("DealArchivedList relative day contract", () => {
  it("legacy toDateString keys must not throw RangeError", () => {
    expect(() => formatNoraRelativeDay("Mon Aug 10 2026")).not.toThrow();
    expect(() => getRelativeTimeString("Mon Aug 10 2026")).not.toThrow();
  });

  it("ISO archive day keys remain relative", () => {
    const label = getRelativeTimeString("2026-08-10");
    expect(label).not.toBe(NORA_DATE_FALLBACK);
    expect(label.length).toBeGreaterThan(0);
  });

  it("invalid values fall back instead of crashing", () => {
    expect(getRelativeTimeString("not-a-date")).toBe(NORA_DATE_FALLBACK);
    expect(getRelativeTimeString(null)).toBe(NORA_DATE_FALLBACK);
  });
});
