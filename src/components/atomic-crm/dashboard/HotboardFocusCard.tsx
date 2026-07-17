import { useRedirect, RecordContextProvider } from "ra-core";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { formatDealAmount, getFollowUpStatus, isDealTerminalStage } from "../deals/dealUtils";
import { BusinessNumber } from "../misc/BusinessNumber";
import { NoraUrgencyBadge } from "../misc/NoraUrgencyBadge";
import { noraCreatePath } from "../routing/noraRoutes";
import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Deal } from "../types";

type HotboardFocusCardProps = {
  deal: Deal;
  companyName?: string;
};

export const HotboardFocusCard = ({
  deal,
  companyName,
}: HotboardFocusCardProps) => {
  const redirect = useRedirect();
  const { dealCategories, currency } = useConfigurationContext();

  const categoryLabel = dealCategories.find((c) => c.value === deal.category)
    ?.label;
  const followUpStatus =
    !isDealTerminalStage(deal.stage)
      ? getFollowUpStatus(deal.expected_closing_date)
      : null;
  const showUrgency =
    followUpStatus === "overdue" || followUpStatus === "today";

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
      className="w-full text-left nora-touch-target"
    >
      <RecordContextProvider value={deal}>
        <Card
          className={cn(
            "nora-card nora-deal-card py-3.5 transition-shadow hover:shadow-md",
            followUpStatus === "overdue" && "nora-deal-card-overdue",
            followUpStatus === "today" && "nora-deal-card-today",
          )}
        >
          <CardContent className="px-4 flex flex-col gap-2">
            <BusinessNumber
              value={deal.case_number}
              kind="case"
              size="md"
              variant="badge"
            />
            <p className="nora-deal-card-title text-base leading-snug line-clamp-2">
              {deal.name}
            </p>
            {companyName ? (
              <p className="nora-deal-card-customer truncate text-sm">
                {companyName}
              </p>
            ) : null}
            <p className="nora-deal-card-meta text-sm">
              {categoryLabel ?? null}
              {categoryLabel && deal.amount && deal.amount > 0 ? " · " : null}
              {deal.amount && deal.amount > 0
                ? formatDealAmount(deal.amount, currency, {
                    notation: "compact",
                    maximumFractionDigits: 0,
                  })
                : null}
            </p>
            {showUrgency ? (
              <NoraUrgencyBadge
                dateString={deal.expected_closing_date}
                variant="compact"
              />
            ) : null}
          </CardContent>
        </Card>
      </RecordContextProvider>
    </button>
  );
};
