import { useRedirect, useTranslate } from "ra-core";

import { DealFollowUpBadge } from "../deals/DealFollowUpBadge";
import { DealStagePill } from "../deals/DealStagePill";
import { BusinessNumber } from "../misc/BusinessNumber";
import { noraCreatePath } from "../routing/noraRoutes";
import type { Deal } from "../types";

type HotboardDealRowProps = {
  deal: Deal;
  companyName?: string;
};

export const HotboardDealRow = ({
  deal,
  companyName,
}: HotboardDealRowProps) => {
  const translate = useTranslate();
  const redirect = useRedirect();

  const openDeal = () => {
    redirect(
      noraCreatePath({ resource: "deals", type: "show", id: deal.id }),
      undefined,
      undefined,
      undefined,
      { _scrollToTop: false },
    );
  };

  return (
    <button
      type="button"
      onClick={openDeal}
      className="w-full text-left px-4 py-3.5 hover:bg-muted/60 transition-colors nora-touch-target flex flex-col gap-1.5"
      aria-label={`${translate("crm.dashboard.hotboard.open_directly")}: ${deal.name}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <BusinessNumber
          value={deal.case_number}
          kind="case"
          size="sm"
          variant="badge"
        />
        <span className="font-medium truncate">{deal.name}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {companyName ? <span className="truncate">{companyName}</span> : null}
        <DealStagePill stage={deal.stage} />
        <DealFollowUpBadge
          dateString={deal.expected_closing_date}
          variant="inline"
        />
      </div>
    </button>
  );
};
