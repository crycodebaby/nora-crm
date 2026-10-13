import { formatWorkDueDate } from "./formatWorkDueDate";

/**
 * AC-11 (U) / AC-12: grammar, Europe/Berlin calendar date, never a time,
 * never throws. The formatter names its zone explicitly, so these results do
 * not depend on the runtime zone; the cross-zone proof is the E2E (AC-11 E).
 */
const date = (dueAt: string) => {
  const result = formatWorkDueDate(dueAt);
  if (result.kind !== "date") throw new Error(`${dueAt} → ${result.kind}`);
  return result;
};

describe("formatWorkDueDate", () => {
  it("formats the Berlin calendar date with weekday and year, short and long", () => {
    expect(date("2026-10-10T08:00:00+02:00")).toEqual({
      kind: "date",
      short: "Sa., 10.10.2026",
      long: "Samstag, 10. Oktober 2026",
    });
  });

  it("returns none for null", () => {
    expect(formatWorkDueDate(null)).toEqual({ kind: "none" });
  });

  it("uses the Berlin date, not the UTC date", () => {
    // 22:30 UTC = 00:30 Berlin next day (CEST).
    expect(date("2026-10-09T22:30:00Z").short).toBe("Sa., 10.10.2026");
    // 02:00 Berlin artefact of quick capture (00:00 UTC) stays on its day.
    expect(date("2026-10-10T00:00:00+00:00").short).toBe("Sa., 10.10.2026");
    expect(date("2026-10-10T02:00:00+02:00").short).toBe("Sa., 10.10.2026");
    // 23:30 Berlin = 21:30 UTC, same Berlin day.
    expect(date("2026-10-10T21:30:00Z").short).toBe("Sa., 10.10.2026");
  });

  it("handles both DST changes and the year boundary", () => {
    // Switch to CET on 2026-10-25 03:00 CEST.
    expect(date("2026-10-24T22:30:00Z").short).toBe("So., 25.10.2026");
    expect(date("2026-10-25T22:59:59Z").short).toBe("So., 25.10.2026");
    expect(date("2026-10-25T23:00:00Z").short).toBe("Mo., 26.10.2026");
    // Switch to CEST on 2026-03-29.
    expect(date("2026-03-28T22:59:59Z").short).toBe("Sa., 28.03.2026");
    expect(date("2026-03-28T23:00:00Z").short).toBe("So., 29.03.2026");
    expect(date("2026-03-29T21:59:59Z").short).toBe("So., 29.03.2026");
    expect(date("2026-03-29T22:00:00Z").short).toBe("Mo., 30.03.2026");
    // Year boundary.
    expect(date("2026-12-31T22:59:59.999999Z").short).toBe("Do., 31.12.2026");
    expect(date("2026-12-31T23:00:00Z").long).toBe("Freitag, 1. Januar 2027");
  });

  it("accepts 1 to 6 fraction digits and negative offsets", () => {
    expect(date("2026-10-10T12:00:00.1+02:00").short).toBe("Sa., 10.10.2026");
    expect(date("2026-10-10T12:00:00.123456+02:00").short).toBe(
      "Sa., 10.10.2026",
    );
    expect(date("2026-10-09T20:00:00-05:00").short).toBe("Sa., 10.10.2026");
  });

  it("always prints four year digits", () => {
    expect(date("0099-06-15T12:00:00Z").short).toMatch(/\.0099$/);
  });

  it("returns unreadable — never throws — for everything outside the grammar", () => {
    for (const value of [
      "infinity",
      "-infinity",
      "12026-01-01T00:00:00Z",
      "0044-03-15T00:00:00Z BC",
      "2026-10-10 00:00:00+02",
      "2026-10-10 00:00:00+02:00",
      "",
      "nonsense",
      "2026-10-10",
      "2026-10-10T00:00:00",
      "2026-10-10T00:00:00+02",
      "2026-02-30T00:00:00Z",
      "2026-13-01T00:00:00Z",
      "2026-10-10T24:00:00Z",
      "2026-10-10T00:00:00.1234567Z",
    ]) {
      expect({ value, result: formatWorkDueDate(value) }).toEqual({
        value,
        result: { kind: "unreadable" },
      });
    }
    expect(formatWorkDueDate(42 as unknown as string)).toEqual({
      kind: "unreadable",
    });
  });

  it("never shows a time", () => {
    for (const value of [
      "2026-10-10T02:00:00+02:00",
      "2026-10-10T14:32:00Z",
      "2026-10-10T23:59:59.999Z",
    ]) {
      const result = date(value);
      expect(result.short).not.toMatch(/\d{1,2}:\d{2}/);
      expect(result.long).not.toMatch(/\d{1,2}:\d{2}/);
    }
  });
});
