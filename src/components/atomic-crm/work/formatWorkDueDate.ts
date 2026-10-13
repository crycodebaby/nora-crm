/**
 * The one Work due-date formatter of the Arbeitskorb (docs/nora/26 §3.1).
 *
 * Input: `dueAt` verbatim from the Work DTO. Output: `none`, `date` (short
 * and long German text in Europe/Berlin, always with weekday and year) or
 * `unreadable`. It never shows a time, never computes overdue/today, never
 * orders, never mutates its input and never throws.
 *
 * Accepted grammar: `YYYY-MM-DDTHH:MM:SS[.f{1,6}](Z|±HH:MM)`. Anything else —
 * `infinity`, `-infinity`, five-digit years, `BC`, the space form, empty
 * strings, nonsense — is `unreadable`.
 */
import { NORA_BUSINESS_TIME_ZONE } from "./berlinCalendar";

export type WorkDueDisplay =
  | { kind: "none" }
  | { kind: "date"; short: string; long: string }
  | { kind: "unreadable" };

const GRAMMAR =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:(Z)|([+-])(\d{2}):(\d{2}))$/;

const shortFormatter = new Intl.DateTimeFormat("de-DE", {
  timeZone: NORA_BUSINESS_TIME_ZONE,
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const longFormatter = new Intl.DateTimeFormat("de-DE", {
  timeZone: NORA_BUSINESS_TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const NONE: WorkDueDisplay = { kind: "none" };
const UNREADABLE: WorkDueDisplay = { kind: "unreadable" };

/** Formats with the year always rendered as four digits. */
const formatWithFullYear = (
  formatter: Intl.DateTimeFormat,
  instant: number,
): string =>
  formatter
    .formatToParts(instant)
    .map((part) =>
      part.type === "year" ? part.value.padStart(4, "0") : part.value,
    )
    .join("");

/** Instant of a grammar-conforming timestamp, or `null` if it names no real date. */
const toInstant = (match: RegExpExecArray): number | null => {
  const [, y, mo, d, h, mi, s, fraction, zulu, sign, oh, om] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  const offsetHours = zulu ? 0 : Number(oh);
  const offsetMinutes = zulu ? 0 : Number(om);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHours > 23 ||
    offsetMinutes > 59
  ) {
    return null;
  }
  // `Date.UTC` maps years 0–99 to 1900–1999; set the full year explicitly.
  const wall = new Date(0);
  wall.setUTCFullYear(year, month - 1, day);
  wall.setUTCHours(
    hour,
    minute,
    second,
    Number((fraction ?? "0").slice(0, 3).padEnd(3, "0")),
  );
  if (wall.getUTCMonth() !== month - 1 || wall.getUTCDate() !== day) {
    return null; // e.g. 2026-02-30
  }
  const offset =
    (sign === "-" ? -1 : 1) * (offsetHours * 60 + offsetMinutes) * 60_000;
  const instant = wall.getTime() - offset;
  return Number.isFinite(instant) ? instant : null;
};

export const formatWorkDueDate = (dueAt: string | null): WorkDueDisplay => {
  if (dueAt === null) return NONE;
  try {
    const match = typeof dueAt === "string" ? GRAMMAR.exec(dueAt) : null;
    if (!match) return UNREADABLE;
    const instant = toInstant(match);
    if (instant === null) return UNREADABLE;
    return {
      kind: "date",
      short: formatWithFullYear(shortFormatter, instant),
      long: formatWithFullYear(longFormatter, instant),
    };
  } catch {
    return UNREADABLE;
  }
};
