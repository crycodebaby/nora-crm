import { isValid } from "date-fns";
import { useTranslate } from "ra-core";

import { useConfigurationContext } from "../root/ConfigurationContext";
import { useGetSalesName } from "../sales/useGetSalesName";
import type { Deal } from "../types";
import {
  findDealLabel,
  formatDealAmount,
  formatISODateString,
  getFollowUpStatus,
  isDealTerminalStage,
  type FollowUpStatus,
} from "./dealUtils";

/** Nora's placeholder for a fact that is not set or cannot be resolved. */
export const DEAL_FACT_UNKNOWN = "—";

export type DealShowFacts = {
  stageLabel?: string;
  categoryLabel?: string;
  /**
   * The formatted estimate, or `DEAL_FACT_UNKNOWN` when no amount is set.
   * `deals.amount` is nullable in the database: a missing estimate is not a
   * zero-euro estimate, so the two must never render alike.
   */
  amountLabel: string;
  followUpDateLabel: string;
  followUpStatus: FollowUpStatus | null;
  showFollowUp: boolean;
  /**
   * The responsible employee, or `DEAL_FACT_UNKNOWN` when there is none or it
   * is not (yet) resolved. "??" is kept when resolving failed.
   */
  salesName: string;
};

/**
 * Derives everything a Vorgang detail view states about a Vorgang.
 *
 * Since W7-M1 the Vorgang has two presentations — the desktop dialog on top of
 * the Kanban board and the mobile detail page — and they must never disagree
 * about what a Vorgang says. Stage/category labels, the estimated amount, the
 * Nachfassen status and the responsible employee are therefore derived here
 * once; the two shells only decide how to lay them out.
 */
export const useDealShowFacts = (record?: Deal): DealShowFacts => {
  const translate = useTranslate();
  const { dealStages, dealCategories, currency } = useConfigurationContext();
  const salesName = useGetSalesName(record?.sales_id);

  const showFollowUp = record ? !isDealTerminalStage(record.stage) : false;

  return {
    stageLabel: record ? findDealLabel(dealStages, record.stage) : undefined,
    categoryLabel: record?.category
      ? (dealCategories.find((c) => c.value === record.category)?.label ??
        record.category)
      : undefined,
    amountLabel:
      record?.amount == null
        ? DEAL_FACT_UNKNOWN
        : formatDealAmount(record.amount, currency, {
            notation: "compact",
            minimumSignificantDigits: 3,
          }),
    followUpDateLabel:
      record && isValid(new Date(record.expected_closing_date))
        ? formatISODateString(record.expected_closing_date)
        : translate("resources.deals.invalid_date"),
    followUpStatus:
      record && showFollowUp
        ? getFollowUpStatus(record.expected_closing_date)
        : null,
    showFollowUp,
    salesName: salesName.trim() ? salesName : DEAL_FACT_UNKNOWN,
  };
};
