import { differenceInDays, formatDistance } from "date-fns";

import {
  formatNoraDateTime,
  getDateFnsLocale,
  NORA_DATE_LOCALE,
} from "./noraDateTime";

export const formatLocalizedDate = (date: string, locale = NORA_DATE_LOCALE) =>
  new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(date));

export const formatRelativeDate = (date: string, locale = "de") => {
  const dateObj = new Date(date);
  const now = new Date();
  const dateFnsLocale = getDateFnsLocale(locale);

  if (differenceInDays(now, dateObj) > 6) {
    return locale.startsWith("de")
      ? formatNoraDateTime(dateObj)
      : new Intl.DateTimeFormat(locale).format(dateObj);
  }

  const distance = formatDistance(dateObj, now, {
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
};
