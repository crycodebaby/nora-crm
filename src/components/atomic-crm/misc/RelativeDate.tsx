import { useRelativeDate } from "./useRelativeDate";

export function RelativeDate({ date }: { date: string }) {
  return useRelativeDate(date);
}
