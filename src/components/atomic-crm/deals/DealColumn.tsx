import { Droppable } from "@hello-pangea/dnd";
import { useTranslate } from "ra-core";

import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Deal } from "../types";
import { findDealLabel, formatDealAmount, sumDealAmounts } from "./dealUtils";
import { DealCard } from "./DealCard";

export const DealColumn = ({
  stage,
  deals,
}: {
  stage: string;
  deals: Deal[];
}) => {
  const totalAmount = sumDealAmounts(deals);
  const { dealStages, currency } = useConfigurationContext();
  const translate = useTranslate();
  const stageLabel = findDealLabel(dealStages, stage);

  return (
    <div className="nora-kanban-column flex flex-col shrink-0">
      <header className="nora-kanban-column-header shrink-0">
        <div className="flex items-start justify-between gap-3">
          <h3 className="nora-kanban-column-title text-left flex-1 min-w-0">
            {stageLabel}
          </h3>
          <span
            className="nora-kanban-column-count shrink-0"
            aria-label={translate("resources.deals.kanban.deal_count", {
              smart_count: deals.length,
            })}
          >
            {deals.length}
          </span>
        </div>
        {totalAmount > 0 ? (
          <p className="nora-kanban-column-meta mt-2 text-left">
            {translate("resources.deals.kanban.order_value", {
              amount: formatDealAmount(totalAmount, currency),
            })}
          </p>
        ) : null}
      </header>

      <div className="nora-kanban-column-gap" aria-hidden />

      <Droppable droppableId={stage}>
        {(droppableProvided, snapshot) => (
          <div
            ref={droppableProvided.innerRef}
            {...droppableProvided.droppableProps}
            className={`nora-kanban-column-cards flex flex-col gap-3 min-h-[4rem] ${
              snapshot.isDraggingOver ? "bg-muted/50 rounded-xl" : ""
            }`}
          >
            {deals.map((deal, index) => (
              <DealCard key={deal.id} deal={deal} index={index} />
            ))}
            {droppableProvided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
};
