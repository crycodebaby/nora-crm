import { Draggable } from "@hello-pangea/dnd";
import { MapPin } from "lucide-react";
import { useRedirect, RecordContextProvider } from "ra-core";
import { noraCreatePath } from "../routing/noraRoutes";
import { NORA_MONEY_LOCALE } from "./dealUtils";
import { ReferenceField } from "@/components/admin/reference-field";
import { NumberField } from "@/components/admin/number-field";
import { SelectField } from "@/components/admin/select-field";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Deal } from "../types";
import { BusinessNumber } from "../misc/BusinessNumber";
import { NoraUrgencyBadge } from "../misc/NoraUrgencyBadge";
import { getFollowUpStatus, isDealTerminalStage } from "./dealUtils";

export const DealCard = ({ deal, index }: { deal: Deal; index: number }) => {
  if (!deal) return null;

  return (
    <Draggable draggableId={String(deal.id)} index={index}>
      {(provided, snapshot) => (
        <DealCardContent provided={provided} snapshot={snapshot} deal={deal} />
      )}
    </Draggable>
  );
};

/**
 * A Kanban card answers: what is it, for whom, where, and what needs
 * attention — nothing more. Floor and tenant details, the full description
 * and every secondary fact stay on the Vorgang itself.
 */
export const DealCardContent = ({
  provided,
  snapshot,
  deal,
}: {
  provided?: any;
  snapshot?: any;
  deal: Deal;
}) => {
  const { dealCategories, currency } = useConfigurationContext();
  const redirect = useRedirect();
  const followUpStatus =
    deal && !isDealTerminalStage(deal.stage)
      ? getFollowUpStatus(deal.expected_closing_date)
      : null;
  const street = deal.site_street?.trim();
  const city = deal.site_city?.trim();
  const site = [street, city].filter(Boolean).join(" · ");
  const handleClick = () => {
    redirect(
      noraCreatePath({ resource: "deals", type: "show", id: deal.id }),
      undefined,
      undefined,
      undefined,
      {
        _scrollToTop: false,
      },
    );
  };

  return (
    <div
      className="cursor-pointer"
      {...provided?.draggableProps}
      {...provided?.dragHandleProps}
      ref={provided?.innerRef}
      onClick={handleClick}
    >
      <RecordContextProvider value={deal}>
        <Card
          className={cn(
            "nora-card nora-deal-card py-3 transition-all duration-200",
            followUpStatus === "overdue" && "nora-deal-card-overdue",
            followUpStatus === "today" && "nora-deal-card-today",
            snapshot?.isDragging
              ? "opacity-90 transform rotate-1 shadow-lg"
              : "hover:shadow-md",
          )}
        >
          <CardContent className="px-3.5 flex flex-col gap-1.5">
            <div className="nora-deal-card-top flex-wrap">
              <BusinessNumber
                value={deal.case_number}
                kind="case"
                size="sm"
                variant="badge"
                className="nora-business-id-sm text-[12.5px]"
              />
              {followUpStatus ? (
                <NoraUrgencyBadge
                  dateString={deal.expected_closing_date}
                  variant="compact"
                  className="nora-urgency-badge-sm"
                />
              ) : null}
            </div>
            <p className="nora-deal-card-title line-clamp-2">{deal.name}</p>
            <p className="nora-deal-card-customer truncate">
              <ReferenceField
                source="company_id"
                reference="companies"
                link={false}
              />
            </p>
            {site ? (
              <p className="nora-deal-card-site" title={site}>
                <MapPin aria-hidden />
                <span>
                  <span className="sr-only">Einsatzort: </span>
                  {site}
                </span>
              </p>
            ) : null}
            {(deal.category || deal.amount) && (
              <p className="nora-deal-card-meta truncate">
                {deal.category ? (
                  <SelectField
                    source="category"
                    choices={dealCategories}
                    optionText="label"
                    optionValue="value"
                  />
                ) : null}
                {deal.category && deal.amount ? " · " : null}
                {deal.amount ? (
                  <NumberField
                    source="amount"
                    locales={NORA_MONEY_LOCALE}
                    options={{
                      notation: "compact",
                      style: "currency",
                      currency,
                      minimumSignificantDigits: 3,
                    }}
                  />
                ) : null}
              </p>
            )}
          </CardContent>
        </Card>
      </RecordContextProvider>
    </div>
  );
};
