/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatNoraDate,
  formatNoraDateTime,
  formatNoraRelativeDateTime,
  formatNoraRelativeDay,
  NORA_DATE_FALLBACK,
  toValidLocalDate,
} from "./noraDateTime";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-15T10:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("formatNoraDate", () => {
  it("formats ISO dates in German long form", () => {
    expect(formatNoraDate("2026-07-14")).toBe("14. Juli 2026");
  });

  it("rejects invalid formats", () => {
    expect(() => formatNoraDate("14-07-2026")).toThrow();
  });
});

describe("formatNoraDateTime", () => {
  it("formats datetime in German", () => {
    const formatted = formatNoraDateTime(new Date(2026, 6, 14, 17, 13));
    expect(formatted).toContain("14. Juli 2026");
    expect(formatted).toContain("17:13");
    expect(formatted).toContain("Uhr");
  });

  it("returns fallback for invalid Date", () => {
    expect(formatNoraDateTime(new Date(Number.NaN))).toBe(NORA_DATE_FALLBACK);
  });
});

describe("toValidLocalDate", () => {
  it("accepts ISO date-only strings and Date objects", () => {
    expect(toValidLocalDate("2026-07-14")?.getDate()).toBe(14);
    expect(toValidLocalDate(new Date(2026, 6, 14))?.getMonth()).toBe(6);
  });

  it("rejects null, undefined, empty, invalid, NaN, Infinity", () => {
    expect(toValidLocalDate(null)).toBeNull();
    expect(toValidLocalDate(undefined)).toBeNull();
    expect(toValidLocalDate("")).toBeNull();
    expect(toValidLocalDate("   ")).toBeNull();
    expect(toValidLocalDate("not-a-date")).toBeNull();
    expect(toValidLocalDate(Number.NaN)).toBeNull();
    expect(toValidLocalDate(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toValidLocalDate(new Date(Number.NaN))).toBeNull();
  });

  it("can parse legacy Date#toDateString keys without producing Invalid Date", () => {
    // DealArchivedList previously grouped with toDateString(); utility must not crash.
    const parsed = toValidLocalDate("Mon Aug 10 2026");
    expect(parsed).not.toBeNull();
    expect(Number.isFinite(parsed!.getTime())).toBe(true);
  });
});

describe("formatNoraRelativeDay", () => {
  it("returns German relative day within a week", () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const iso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
    const result = formatNoraRelativeDay(iso);
    expect(result.toLowerCase()).toMatch(/morgen|in 1 tag/);
  });

  it("never throws on invalid inputs and never feeds NaN to RelativeTimeFormat", () => {
    const invalid = [
      null,
      undefined,
      "",
      "not-a-date",
      Number.NaN,
      Number.POSITIVE_INFINITY,
      new Date(Number.NaN),
    ];
    for (const value of invalid) {
      expect(formatNoraRelativeDay(value as never)).toBe(NORA_DATE_FALLBACK);
    }
  });

  it("tolerates legacy toDateString keys without RangeError", () => {
    expect(() => formatNoraRelativeDay("Mon Aug 10 2026")).not.toThrow();
    expect(formatNoraRelativeDay("Mon Aug 10 2026")).not.toBe("");
  });
});

describe("formatNoraRelativeDateTime", () => {
  it("uses German locale for de", () => {
    const yesterday = new Date("2026-07-14T17:13:00.000Z");
    const result = formatNoraRelativeDateTime(yesterday, "de");
    expect(result).toBe("vor etwa 17 Stunden");
  });
});
