import type { Identifier } from "ra-core";

import {
  isDealTerminalStage,
  isFollowUpDueToday,
  isFollowUpOverdue,
} from "../deals/dealUtils";
import type { Deal } from "../types";

export const HOTBOARD_DEAL_LIMIT = 5;

export const OFFER_FOLLOW_UP_STAGES = [
  "angebot-gesendet",
  "nachfassen",
] as const;

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
  return getActiveDeals(deals).filter((deal) => deal.stage === "neue-anfrage");
}

export function filterWaitingManufacturerDeals(deals: Deal[]): Deal[] {
  return getActiveDeals(deals).filter(
    (deal) => deal.stage === "wartet-auf-hersteller",
  );
}

export function filterOfferFollowUpDeals(
  deals: Deal[],
  excludeIds: ReadonlySet<Identifier> = new Set(),
): Deal[] {
  return getActiveDeals(deals).filter(
    (deal) =>
      (OFFER_FOLLOW_UP_STAGES as readonly string[]).includes(deal.stage) &&
      !excludeIds.has(deal.id),
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
