import { useRedirect, useTranslate } from "ra-core";

import { DealFollowUpBadge } from "../deals/DealFollowUpBadge";
import { findDealLabel } from "../deals/dealUtils";
import { BusinessNumber } from "../misc/BusinessNumber";
import { noraCreatePath } from "../routing/noraRoutes";
import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Deal } from "../types";

type HotboardDealRowProps = {
  deal: Deal;
  companyName?: string;
};

export const HotboardDealRow = ({ deal, companyName }: HotboardDealRowProps) => {
  const translate = useTranslate();
  const redirect = useRedirect();
  const { dealStages } = useConfigurationContext();

  const openDeal = () => {
    redirect(
      noraCreatePath({ resource: "deals", type: "show", id: deal.id }),
      undefined,
      undefined,
      undefined,
      { _scrollToTop: false },
    );
  };

  const stageLabel = findDealLabel(dealStages, deal.stage);

  return (
    <button
      type="button"
      onClick={openDeal}
      className="w-full text-left px-4 py-3.5 hover:bg-muted/60 transition-colors nora-touch-target flex flex-col gap-1.5"
      aria-label={`${translate("crm.dashboard.hotboard.open_directly")}: ${deal.name}`}
    >
      <BusinessNumber value={deal.case_number} />
      <span className="nora-list-title text-sm leading-snug">{deal.name}</span>
      <span className="nora-muted text-xs">
        {[companyName, stageLabel].filter(Boolean).join(" · ")}
      </span>
      <DealFollowUpBadge dateString={deal.expected_closing_date} />
    </button>
  );
};
