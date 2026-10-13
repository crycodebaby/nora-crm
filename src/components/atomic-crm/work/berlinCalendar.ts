/**
 * Europe/Berlin clock helpers for the Arbeitskorb's *fetch* metadata only
 * (docs/nora/26 §3, §5.5): "Stand 14:32", the Berlin calendar day of the last
 * successful fetch, and the next Berlin midnight for the day-change
 * revalidation.
 *
 * Nothing here ever looks at a Work row: it compares two fetch/clock
 * instants, never a `dueAt`, and never derives `overdue` / `dueToday`.
 */

export const NORA_BUSINESS_TIME_ZONE = "Europe/Berlin";

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: NORA_BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const clockFormatter = new Intl.DateTimeFormat("de-DE", {
  timeZone: NORA_BUSINESS_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const dateTimeFormatter = new Intl.DateTimeFormat("de-DE", {
  timeZone: NORA_BUSINESS_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

type BerlinParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const berlinParts = (instant: number): BerlinParts => {
  const parts: Partial<BerlinParts> = {};
  for (const part of partsFormatter.formatToParts(instant)) {
    if (
      part.type in { year: 1, month: 1, day: 1, hour: 1, minute: 1, second: 1 }
    ) {
      parts[part.type as keyof BerlinParts] = Number(part.value);
    }
  }
  return parts as BerlinParts;
};

/** `YYYY-MM-DD` of the Berlin calendar day containing `instant`. */
export const berlinCalendarDay = (instant: number): string => {
  const { year, month, day } = berlinParts(instant);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

/** Berlin wall-clock offset from UTC at `instant`, in milliseconds. */
const berlinOffset = (instant: number): number => {
  const p = berlinParts(instant);
  const wallAsUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return wallAsUtc - Math.floor(instant / 1000) * 1000;
};

/** The instant of the first Berlin midnight strictly after `instant`. */
export const nextBerlinMidnight = (instant: number): number => {
  const { year, month, day } = berlinParts(instant);
  const wallMidnight = Date.UTC(year, month - 1, day + 1);
  // Berlin never switches DST at midnight; one refinement settles the offset
  // of the target day itself.
  const guess = wallMidnight - berlinOffset(instant);
  return wallMidnight - berlinOffset(guess);
};

/** Safety margin after Berlin midnight (docs/nora/26 §5.5). */
export const DAY_CHANGE_GRACE_MS = 2 * 60 * 1000;

export const isSameBerlinDay = (a: number, b: number): boolean =>
  berlinCalendarDay(a) === berlinCalendarDay(b);

/**
 * The "Stand" of a snapshot: `14:32`, or `12.10.2026, 17:45` when the
 * snapshot comes from another Berlin day than `now` (docs/nora/26 §5.5).
 */
export const formatStand = (fetchedAt: number, now: number): string =>
  isSameBerlinDay(fetchedAt, now)
    ? clockFormatter.format(fetchedAt)
    : dateTimeFormatter.format(fetchedAt);

/** `14:33` in Berlin — for "Erneut fehlgeschlagen · 14:33". */
export const formatBerlinClock = (instant: number): string =>
  clockFormatter.format(instant);
