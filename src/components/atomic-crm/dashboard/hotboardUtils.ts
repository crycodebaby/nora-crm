import type { Identifier } from "ra-core";

import {
  isDealTerminalStage,
  isFollowUpDueToday,
  isFollowUpOverdue,
  getFollowUpStatus,
} from "../deals/dealUtils";
import { resolveDealStageColumn } from "../deals/dealStageModel";
import type { Deal } from "../types";

export const HOTBOARD_DEAL_LIMIT = 5;

/** Stages that map into “Angebot nachfassen” (canonical + legacy). */
export const OFFER_FOLLOW_UP_STAGES = [
  "quote_sent",
  "angebot-gesendet",
  "nachfassen",
] as const;

function stageColumn(deal: Deal): string {
  return resolveDealStageColumn(deal.stage);
}

export function getActiveDeals(deals: Deal[]): Deal[] {
  return deals.filter(
    (deal) => !deal.archived_at && !isDealTerminalStage(deal.stage),
  );
}

export function filterFollowUpDeals(deals: Deal[]): Deal[] {
  return getActiveDeals(deals).filter(
    (deal) =>
      isFollowUpOverdue(deal.expected_closing_date) ||
      isFollowUpDueToday(deal.expected_closing_date),
  );
}

export function filterNewInquiryDeals(deals: Deal[]): Deal[] {
  return getActiveDeals(deals).filter(
    (deal) => stageColumn(deal) === "requested",
  );
}

/** Legacy name kept for Hotboard focus — now means quote_sent bucket. */
export function filterNachfassenDeals(deals: Deal[]): Deal[] {
  return getActiveDeals(deals).filter(
    (deal) => stageColumn(deal) === "quote_sent",
  );
}

export const FOCUS_BOARD_STAGES = ["requested", "quote_sent"] as const;

export type FocusBoardStage = (typeof FOCUS_BOARD_STAGES)[number];

export function filterDealsForFocusStage(
  deals: Deal[],
  stage: FocusBoardStage,
): Deal[] {
  if (stage === "requested") {
    return filterNewInquiryDeals(deals);
  }
  return filterNachfassenDeals(deals);
}

/** Arbeitsboard: überfällig → heute → nächster Kontakttermin → zuletzt erstellt */
export function sortDealsByFocusPriority(deals: Deal[]): Deal[] {
  const urgencyRank = (deal: Deal): number => {
    const status = getFollowUpStatus(deal.expected_closing_date);
    if (status === "overdue") return 0;
    if (status === "today") return 1;
    if (status === "upcoming") return 2;
    return 3;
  };

  return [...deals].sort((a, b) => {
    const rankDiff = urgencyRank(a) - urgencyRank(b);
    if (rankDiff !== 0) return rankDiff;

    if (urgencyRank(a) <= 2) {
      const dateCmp = a.expected_closing_date.localeCompare(
        b.expected_closing_date,
      );
      if (dateCmp !== 0) return dateCmp;
    }

    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

export type FocusColumnDeals = {
  deals: Deal[];
  total: number;
  remaining: number;
};

export function prepareFocusColumnDeals(
  deals: Deal[],
  stage: FocusBoardStage,
  limit: number = HOTBOARD_DEAL_LIMIT,
): FocusColumnDeals {
  const sorted = sortDealsByFocusPriority(
    filterDealsForFocusStage(deals, stage),
  );
  return {
    deals: sorted.slice(0, limit),
    total: sorted.length,
    remaining: Math.max(0, sorted.length - limit),
  };
}

export function filterWaitingManufacturerDeals(deals: Deal[]): Deal[] {
  return getActiveDeals(deals).filter(
    (deal) => stageColumn(deal) === "in_production",
  );
}

export function filterOfferFollowUpDeals(
  deals: Deal[],
  excludeIds: ReadonlySet<Identifier> = new Set(),
): Deal[] {
  return getActiveDeals(deals).filter(
    (deal) => stageColumn(deal) === "quote_sent" && !excludeIds.has(deal.id),
  );
}

export function sortDealsByFollowUpDate(deals: Deal[]): Deal[] {
  return [...deals].sort((a, b) =>
    a.expected_closing_date.localeCompare(b.expected_closing_date),
  );
}

export function sortDealsByCreatedDesc(deals: Deal[]): Deal[] {
  return [...deals].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}
