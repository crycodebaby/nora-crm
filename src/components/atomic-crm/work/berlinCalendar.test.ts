import {
  berlinCalendarDay,
  formatBerlinClock,
  formatStand,
  nextBerlinMidnight,
} from "./berlinCalendar";

const utc = (iso: string) => Date.parse(iso);

describe("berlinCalendar (fetch metadata only)", () => {
  it("returns the Berlin calendar day, not the UTC one", () => {
    // 23:30 UTC on Oct 12 is already Oct 13 in Berlin (CEST).
    expect(berlinCalendarDay(utc("2026-10-12T23:30:00Z"))).toBe("2026-10-13");
    // 23:30 UTC on Dec 31 is Jan 1 in Berlin (CET).
    expect(berlinCalendarDay(utc("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
  });

  it("finds the next Berlin midnight across both DST changes and the year end", () => {
    expect(nextBerlinMidnight(utc("2026-10-12T12:00:00Z"))).toBe(
      utc("2026-10-12T22:00:00Z"),
    );
    // Night of the switch back to CET (2026-10-25): next midnight is CET.
    expect(nextBerlinMidnight(utc("2026-10-25T01:30:00Z"))).toBe(
      utc("2026-10-25T23:00:00Z"),
    );
    // Day before the switch: midnight of Oct 25 is still CEST.
    expect(nextBerlinMidnight(utc("2026-10-24T12:00:00Z"))).toBe(
      utc("2026-10-24T22:00:00Z"),
    );
    // Switch to CEST on 2026-03-29.
    expect(nextBerlinMidnight(utc("2026-03-29T12:00:00Z"))).toBe(
      utc("2026-03-29T22:00:00Z"),
    );
    expect(nextBerlinMidnight(utc("2026-03-28T12:00:00Z"))).toBe(
      utc("2026-03-28T23:00:00Z"),
    );
    expect(nextBerlinMidnight(utc("2026-12-31T22:59:59Z"))).toBe(
      utc("2026-12-31T23:00:00Z"),
    );
    // Exactly at midnight → the following one.
    expect(nextBerlinMidnight(utc("2026-10-12T22:00:00Z"))).toBe(
      utc("2026-10-13T22:00:00Z"),
    );
  });

  it("formats the Stand as clock time, with the date when the day differs", () => {
    const fetched = utc("2026-10-12T15:45:10Z"); // 17:45 Berlin
    expect(formatStand(fetched, utc("2026-10-12T16:00:00Z"))).toBe("17:45");
    expect(formatStand(fetched, utc("2026-10-12T22:05:00Z"))).toBe(
      "12.10.2026, 17:45",
    );
    expect(formatBerlinClock(utc("2026-10-13T12:33:00Z"))).toBe("14:33");
  });
});
