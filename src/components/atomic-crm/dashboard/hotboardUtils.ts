import type { Identifier } from "ra-core";

import {
  isDealTerminalStage,
  isFollowUpDueToday,
  isFollowUpOverdue,
  getFollowUpStatus,
} from "../deals/dealUtils";
import type { Deal, Task } from "../types";

export const HOTBOARD_DEAL_LIMIT = 5;

/**
 * Ansprechpartner-Ids für die Startseite aus offenen Aufgaben ableiten.
 *
 * Aufgaben sind fachlich entweder kundenbezogen (`contact_id` null) oder
 * kontaktbezogen, und mehrere Aufgaben zeigen häufig auf denselben Kontakt.
 * Beides darf nie ungefiltert in eine `getMany`-Abfrage laufen: leere Elemente
 * erzeugen ein ungültiges `id=in.(1,1,,29,)` und lassen die gesamte
 * Ansprechpartner-Auflösung fehlschlagen, Duplikate blähen sie nur auf.
 *
 * Reihenfolge des ersten Vorkommens bleibt erhalten, Ids werden nicht
 * umgewandelt und die Aufgaben nicht verändert.
 */
export function resolveHotboardContactIds(
  tasks: readonly Task[],
): Identifier[] {
  const seen = new Set<Identifier>();
  const contactIds: Identifier[] = [];

  for (const task of tasks) {
    const contactId = task.contact_id;
    if (contactId == null || contactId === "") continue;
    if (seen.has(contactId)) continue;
    seen.add(contactId);
    contactIds.push(contactId);
  }

  return contactIds;
}

/**
 * Kunden-Ids für die Startseite aus Vorgängen ableiten.
 *
 * `deals.company_id` ist in der Datenbank nullable (ein Vorgang kann ohne
 * zugeordneten Kunden existieren), auch wenn der TypeScript-Typ das derzeit
 * nicht abbildet. Dieselbe Regel wie bei [resolveHotboardContactIds] gilt: ein
 * leeres Element würde die Kundenauflösung der gesamten Startseite kippen.
 */
export function resolveHotboardCompanyIds(
  deals: readonly Deal[],
): Identifier[] {
  const seen = new Set<Identifier>();
  const companyIds: Identifier[] = [];

  for (const deal of deals) {
    const companyId = deal.company_id as Identifier | null | undefined;
    if (companyId == null || companyId === "") continue;
    if (seen.has(companyId)) continue;
    seen.add(companyId);
    companyIds.push(companyId);
  }

  return companyIds;
}

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

export function filterNachfassenDeals(deals: Deal[]): Deal[] {
  return getActiveDeals(deals).filter((deal) => deal.stage === "nachfassen");
}

export const FOCUS_BOARD_STAGES = ["neue-anfrage", "nachfassen"] as const;

export type FocusBoardStage = (typeof FOCUS_BOARD_STAGES)[number];

export function filterDealsForFocusStage(
  deals: Deal[],
  stage: FocusBoardStage,
): Deal[] {
  if (stage === "neue-anfrage") {
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
