import { useGetList, useRecordContext } from "ra-core";
import type { Identifier } from "ra-core";

import type { Company, Contact, Deal } from "../types";
import { isDealTerminalStage } from "./dealUtils";
import {
  CANONICAL_DEAL_STAGE_DEFINITIONS,
  resolveDealStageColumn,
} from "./dealStageModel";
import { DealStagePill } from "./DealStagePill";

const STAGE_ORDER = new Map(
  CANONICAL_DEAL_STAGE_DEFINITIONS.map((s, index) => [s.value, index]),
);

/** Prefer earliest active pipeline stage; tie-break by newest created_at. */
export function pickPrimaryActiveDeal(deals: Deal[]): Deal | null {
  const active = deals.filter(
    (deal) => !deal.archived_at && !isDealTerminalStage(deal.stage),
  );
  if (!active.length) return null;

  return [...active].sort((a, b) => {
    const aOrder =
      STAGE_ORDER.get(resolveDealStageColumn(a.stage) as never) ?? 99;
    const bOrder =
      STAGE_ORDER.get(resolveDealStageColumn(b.stage) as never) ?? 99;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  })[0];
}

type PrimaryDealStageHintProps = {
  /** Scope of deals to consider */
  scope: "company" | "contact";
  className?: string;
};

/**
 * Derived hint only — does not store status on contact/company.
 * Shows the primary active deal stage for context.
 */
export function PrimaryDealStageHint({
  scope,
  className,
}: PrimaryDealStageHintProps) {
  const company = useRecordContext<Company>();
  const contact = useRecordContext<Contact>();
  const recordId =
    scope === "company" ? company?.id : (contact?.id as Identifier | undefined);

  const { data: deals } = useGetList<Deal>(
    "deals",
    {
      pagination: { page: 1, perPage: 50 },
      sort: { field: "created_at", order: "DESC" },
      filter:
        scope === "company"
          ? { company_id: recordId, "archived_at@is": null }
          : { "contact_ids@cs": `{${recordId}}`, "archived_at@is": null },
    },
    { enabled: recordId != null },
  );

  const primary = pickPrimaryActiveDeal(deals ?? []);
  if (!primary) return null;

  return (
    <div className={className}>
      <DealStagePill stage={primary.stage} />
      <p
        className="text-xs text-muted-foreground mt-1 truncate"
        title={primary.name}
      >
        {primary.name}
      </p>
    </div>
  );
}
