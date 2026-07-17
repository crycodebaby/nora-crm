import { useLocaleState } from "ra-core";

import { formatRelativeDate } from "./relativeDateUtils";

export const useRelativeDate = (date: string) => {
  const [locale = "de"] = useLocaleState();

  return formatRelativeDate(date, locale);
};
