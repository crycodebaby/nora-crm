/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import {
  formatNoraDate,
  formatNoraDateTime,
  formatNoraRelativeDateTime,
  formatNoraRelativeDay,
} from "./noraDateTime";

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
});

describe("formatNoraRelativeDateTime", () => {
  it("uses German locale for de", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(17, 13, 0, 0);
    const result = formatNoraRelativeDateTime(yesterday, "de");
    expect(result.toLowerCase()).toMatch(/gestern|tag/);
  });
});
