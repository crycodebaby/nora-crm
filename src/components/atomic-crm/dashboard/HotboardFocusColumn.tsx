import { useTranslate } from "ra-core";
import { Link } from "react-router";

import { findDealLabel } from "../deals/dealUtils";
import { noraCreatePath } from "../routing/noraRoutes";
import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Company, Deal } from "../types";
import type { FocusBoardStage } from "./hotboardUtils";
import { HotboardFocusCard } from "./HotboardFocusCard";

type HotboardFocusColumnProps = {
  stage: FocusBoardStage;
  deals: Deal[];
  total: number;
  remaining: number;
  companyById: Map<string | number, Company>;
  emptyMessageKey: string;
};

export const HotboardFocusColumn = ({
  stage,
  deals,
  total,
  remaining,
  companyById,
  emptyMessageKey,
}: HotboardFocusColumnProps) => {
  const translate = useTranslate();
  const { dealStages } = useConfigurationContext();
  const stageLabel = findDealLabel(dealStages, stage);

  return (
    <div className="nora-focus-column flex flex-col min-w-[280px] max-w-full">
      <header className="nora-kanban-column-header shrink-0">
        <div className="flex items-start justify-between gap-3">
          <h3 className="nora-kanban-column-title text-left flex-1 min-w-0">
            {stageLabel}
          </h3>
          <span
            className="nora-kanban-column-count shrink-0"
            aria-label={translate("resources.deals.kanban.deal_count", {
              smart_count: total,
            })}
          >
            {total}
          </span>
        </div>
      </header>

      <div className="nora-kanban-column-gap" aria-hidden />

      <div className="flex flex-col gap-3 min-h-[4rem]">
        {deals.length > 0 ? (
          deals.map((deal) => (
            <HotboardFocusCard
              key={deal.id}
              deal={deal}
              companyName={companyById.get(deal.company_id)?.name}
            />
          ))
        ) : (
          <p className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground nora-readable">
            {translate(emptyMessageKey)}
          </p>
        )}
        {remaining > 0 ? (
          <Link
            to={noraCreatePath({ resource: "deals", type: "list" })}
            className="text-sm font-medium text-primary hover:underline px-1 py-2 nora-touch-target inline-flex items-center"
          >
            {translate("crm.dashboard.hotboard.focus_board.more_deals", {
              count: remaining,
            })}
          </Link>
        ) : null}
      </div>
    </div>
  );
};
