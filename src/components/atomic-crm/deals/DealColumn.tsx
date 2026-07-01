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

  return (
    <div className="flex-1 min-w-[16rem] max-w-[20rem] pb-8 shrink-0">
      <div className="flex flex-col items-center gap-0.5 px-1">
        <h3 className="text-base font-semibold tracking-tight text-center">
          {findDealLabel(dealStages, stage)}
        </h3>
        {totalAmount > 0 ? (
          <p className="nora-muted text-xs text-center">
            {translate("resources.deals.kanban.order_value", {
              amount: formatDealAmount(totalAmount, currency),
            })}
          </p>
        ) : null}
      </div>
      <Droppable droppableId={stage}>
        {(droppableProvided, snapshot) => (
          <div
            ref={droppableProvided.innerRef}
            {...droppableProvided.droppableProps}
            className={`flex flex-col rounded-2xl mt-3 gap-3 ${
              snapshot.isDraggingOver ? "bg-muted" : ""
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
