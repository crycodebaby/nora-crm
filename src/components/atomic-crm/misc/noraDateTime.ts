import { differenceInDays, formatDistance } from "date-fns";
import { de, enUS, fr } from "date-fns/locale";

export const NORA_DATE_LOCALE = "de-DE";

const isoDateStringRegex = /^\d{4}-\d{2}-\d{2}$/;

export function parseISODateOnly(dateString: string): Date {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
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
  if (Number.isNaN(date.getTime())) {
    return "—";
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
  if (Number.isNaN(date.getTime())) {
    return "—";
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

/** Relative follow-up day labels for Kanban badges */
export function formatNoraRelativeDay(
  dateString: string,
  locale = "de-DE",
): string {
  const date = parseISODateOnly(dateString);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diff = Math.round((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

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
