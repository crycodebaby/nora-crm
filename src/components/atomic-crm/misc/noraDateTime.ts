import { differenceInDays, formatDistance } from "date-fns";
import { de, enUS, fr } from "date-fns/locale";

export const NORA_DATE_LOCALE = "de-DE";
export const NORA_DATE_FALLBACK = "—";

const isoDateStringRegex = /^\d{4}-\d{2}-\d{2}$/;

/** Coerce unknown calendar/day inputs into a local midnight Date, or null. */
export function toValidLocalDate(
  value: string | Date | number | null | undefined,
): Date | null {
  if (value == null || value === "") {
    return null;
  }

  if (value instanceof Date) {
    const time = value.getTime();
    if (!Number.isFinite(time)) {
      return null;
    }
    const date = new Date(time);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      return null;
    }
    date.setHours(0, 0, 0, 0);
    return date;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  // Prefer strict ISO date-only parsing (avoids UTC shift for YYYY-MM-DD).
  if (isoDateStringRegex.test(trimmed)) {
    const [year, month, day] = trimmed.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    date.setHours(0, 0, 0, 0);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }
    return date;
  }

  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

export function parseISODateOnly(dateString: string): Date {
  const date = toValidLocalDate(dateString);
  if (!date) {
    throw new Error("Invalid date format. Expected YYYY-MM-DD.");
  }
  return date;
}

/** Long German date from ISO date-only string, e.g. 14. Juli 2026 */
export function formatNoraDate(dateString: string): string {
  if (!isoDateStringRegex.test(dateString)) {
    throw new Error("Invalid date format. Expected YYYY-MM-DD.");
  }
  const date = parseISODateOnly(dateString);
  return new Intl.DateTimeFormat(NORA_DATE_LOCALE, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

/** German date + time, e.g. 14. Juli 2026 um 17:13 Uhr */
export function formatNoraDateTime(dateInput: string | Date): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    return NORA_DATE_FALLBACK;
  }
  return new Intl.DateTimeFormat(NORA_DATE_LOCALE, {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(",", " um")
    .concat(" Uhr");
}

export function getDateFnsLocale(locale: string) {
  if (locale.startsWith("fr")) return fr;
  if (locale.startsWith("de")) return de;
  return enUS;
}

/** Relative note/task timestamps in German when locale is de */
export function formatNoraRelativeDateTime(
  dateInput: string | Date,
  locale = "de",
): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    return NORA_DATE_FALLBACK;
  }

  const now = new Date();
  const dateFnsLocale = getDateFnsLocale(locale);

  if (differenceInDays(now, date) > 6) {
    return formatNoraDateTime(date);
  }

  const distance = formatDistance(date, now, {
    addSuffix: true,
    locale: dateFnsLocale,
  });

  if (!locale.startsWith("de")) {
    return distance;
  }

  return distance
    .replace("about ", "")
    .replace("less than a minute ago", "gerade eben")
    .replace("minute ago", "Minute")
    .replace("minutes ago", "Minuten")
    .replace("hour ago", "Stunde")
    .replace("hours ago", "Stunden")
    .replace("yesterday at", "Gestern um")
    .replace("today at", "Heute um")
    .replace(" at ", " um ");
}

/**
 * Relative follow-up / archive day labels.
 * Never throws; never passes non-finite values to Intl.RelativeTimeFormat.
 */
export function formatNoraRelativeDay(
  dateInput: string | Date | number | null | undefined,
  locale = "de-DE",
): string {
  const date = toValidLocalDate(dateInput);
  if (!date) {
    return NORA_DATE_FALLBACK;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diff = Math.round(
    (date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (!Number.isFinite(diff)) {
    return NORA_DATE_FALLBACK;
  }

  if (Math.abs(diff) > 7) {
    return new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "long",
    }).format(date);
  }

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const formatted = rtf.format(diff, "day");
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}
