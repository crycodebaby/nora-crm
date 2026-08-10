import { defaultCurrency } from "../root/defaultConfiguration";
import { formatNoraDate, formatNoraRelativeDay } from "../misc/noraDateTime";

export {
  findDealLabel,
  isDealTerminalStage,
  localizeDealStages,
  LEGACY_ATOMIC_DEAL_STAGE_LABELS,
  normalizeDealStageValue,
  resolveDealStageColumn,
  getDealStageColorToken,
  getDealStageCssVars,
  ensureCanonicalDealStages,
  DEAL_STAGE_DEFAULT,
  DEAL_STAGE_NONE,
} from "./dealStageModel";

export const NORA_MONEY_LOCALE = "de-DE";

export function formatDealAmount(
  amount: number,
  currency: string = defaultCurrency,
  options?: Intl.NumberFormatOptions,
): string {
  return amount.toLocaleString(NORA_MONEY_LOCALE, {
    style: "currency",
    currency,
    ...options,
  });
}

/** Sum estimated order values; ignores missing or non-positive amounts. */
export function sumDealAmounts(deals: { amount?: number | null }[]): number {
  return deals.reduce((sum, deal) => {
    const amount = deal.amount ?? 0;
    return amount > 0 ? sum + amount : sum;
  }, 0);
}

export function getRelativeTimeString(
  dateString: string,
  locale = "de-DE",
): string {
  return formatNoraRelativeDay(dateString, locale);
}

const isoDateStringRegex = /^\d{4}-\d{2}-\d{2}$/;

export function formatISODateString(dateString: string) {
  return formatNoraDate(dateString);
}

export function parseISODateOnly(dateString: string): Date {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function isFollowUpOverdue(dateString: string): boolean {
  if (!isoDateStringRegex.test(dateString)) {
    return false;
  }
  const date = parseISODateOnly(dateString);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
}

export function isFollowUpDueToday(dateString: string): boolean {
  if (!isoDateStringRegex.test(dateString)) {
    return false;
  }
  const date = parseISODateOnly(dateString);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date.getTime() === today.getTime();
}

export type FollowUpStatus = "overdue" | "today" | "upcoming";

export function getFollowUpStatus(dateString: string): FollowUpStatus | null {
  if (!isoDateStringRegex.test(dateString)) {
    return null;
  }
  if (isFollowUpOverdue(dateString)) {
    return "overdue";
  }
  if (isFollowUpDueToday(dateString)) {
    return "today";
  }
  return "upcoming";
}
