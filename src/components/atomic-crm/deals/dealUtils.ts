import { defaultCurrency } from "../root/defaultConfiguration";
import type { DealStage } from "../types";
import { formatNoraDate, formatNoraRelativeDay } from "../misc/noraDateTime";

/** Visible German labels for legacy Atomic CRM stage values stored in the database. */
export const LEGACY_ATOMIC_DEAL_STAGE_LABELS: Record<string, string> = {
  opportunity: "Neue Anfrage",
  "proposal-sent": "Angebot gesendet",
  "in-negotiation": "In Klärung",
  "in-negociation": "In Klärung",
  won: "Angenommen",
  lost: "Abgelehnt",
  delayed: "Verzögert",
  // Kurzformen aus früherer Nora-Konfiguration
  anfrage: "Neue Anfrage",
  angebot: "Angebot gesendet",
  beauftragt: "Angenommen",
  "in-arbeit": "In Kalkulation",
  abgeschlossen: "Abgeschlossen",
  abgelehnt: "Abgelehnt",
};

/** Fallback when legacy English labels are still stored in app configuration. */
const LEGACY_ENGLISH_DEAL_STAGE_LABELS: Record<string, string> = {
  Opportunity: "Neue Anfrage",
  "Proposal Sent": "Angebot gesendet",
  "In Negotiation": "In Klärung",
  "In Negociation": "In Klärung",
  Won: "Angenommen",
  Lost: "Abgelehnt",
  Delayed: "Verzögert",
};

export const NORA_MONEY_LOCALE = "de-DE";

export const findDealLabel = (
  dealStages: DealStage[],
  dealValue: string,
): string | undefined => {
  if (LEGACY_ATOMIC_DEAL_STAGE_LABELS[dealValue]) {
    return LEGACY_ATOMIC_DEAL_STAGE_LABELS[dealValue];
  }

  const dealStage = dealStages.find((stage) => stage.value === dealValue);
  if (!dealStage?.label) {
    return undefined;
  }

  return LEGACY_ENGLISH_DEAL_STAGE_LABELS[dealStage.label] ?? dealStage.label;
};

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

/** Apply German labels to legacy Atomic stages still present in stored configuration. */
export const localizeDealStages = (dealStages: DealStage[]): DealStage[] =>
  dealStages.map((stage) => ({
    ...stage,
    label: findDealLabel(dealStages, stage.value) ?? stage.label,
  }));

const TERMINAL_DEAL_STAGES = new Set([
  "angenommen",
  "abgelehnt",
  "abgeschlossen",
  "won",
  "lost",
]);

export function isDealTerminalStage(stage: string): boolean {
  return TERMINAL_DEAL_STAGES.has(stage);
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

export function getFollowUpStatus(
  dateString: string,
): FollowUpStatus | null {
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
