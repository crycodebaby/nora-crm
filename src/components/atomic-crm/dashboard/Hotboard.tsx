import {
  CalendarClock,
  Factory,
  FileText,
  Inbox,
  MessageCircle,
} from "lucide-react";
import { useGetList, useGetMany, useTranslate } from "ra-core";
import { useMemo } from "react";

import type { Company, Deal } from "../types";
import { HotboardDealSection } from "./HotboardDealSection";
import { HotboardOpenTasks } from "./HotboardOpenTasks";
import {
  filterFollowUpDeals,
  filterNewInquiryDeals,
  filterOfferFollowUpDeals,
  filterWaitingManufacturerDeals,
  HOTBOARD_DEAL_LIMIT,
  sortDealsByCreatedDesc,
  sortDealsByFollowUpDate,
} from "./hotboardUtils";

export const Hotboard = () => {
  const translate = useTranslate();

  const { data: deals, isPending } = useGetList<Deal>("deals", {
    pagination: { page: 1, perPage: 500 },
    sort: { field: "expected_closing_date", order: "ASC" },
    filter: { "archived_at@is": null },
  });

  const followUpDeals = useMemo(
    () =>
      sortDealsByFollowUpDate(filterFollowUpDeals(deals ?? [])).slice(
        0,
        HOTBOARD_DEAL_LIMIT,
      ),
    [deals],
  );

  const newInquiryDeals = useMemo(
    () =>
      sortDealsByCreatedDesc(filterNewInquiryDeals(deals ?? [])).slice(
        0,
        HOTBOARD_DEAL_LIMIT,
      ),
    [deals],
  );

  const waitingManufacturerDeals = useMemo(
    () =>
      sortDealsByFollowUpDate(
        filterWaitingManufacturerDeals(deals ?? []),
      ).slice(0, HOTBOARD_DEAL_LIMIT),
    [deals],
  );

  const followUpIds = useMemo(
    () => new Set(followUpDeals.map((deal) => deal.id)),
    [followUpDeals],
  );

  const offerFollowUpDeals = useMemo(
    () =>
      sortDealsByFollowUpDate(
        filterOfferFollowUpDeals(deals ?? [], followUpIds),
      ).slice(0, HOTBOARD_DEAL_LIMIT),
    [deals, followUpIds],
  );

  const displayedDeals = useMemo(
    () => [
      ...followUpDeals,
      ...newInquiryDeals,
      ...waitingManufacturerDeals,
      ...offerFollowUpDeals,
    ],
    [
      followUpDeals,
      newInquiryDeals,
      waitingManufacturerDeals,
      offerFollowUpDeals,
    ],
  );

  const companyIds = useMemo(
    () => [...new Set(displayedDeals.map((deal) => deal.company_id))],
    [displayedDeals],
  );

  const { data: companies } = useGetMany<Company>(
    "companies",
    { ids: companyIds },
    { enabled: companyIds.length > 0 },
  );

  const companyById = useMemo(() => {
    const map = new Map<string | number, Company>();
    for (const company of companies ?? []) {
      map.set(company.id, company);
    }
    return map;
  }, [companies]);

  if (isPending) {
    return null;
  }

  return (
    <section
      className="flex flex-col gap-5"
      aria-label={translate("crm.dashboard.hotboard.title")}
    >
      <h1 className="text-xl font-semibold tracking-tight">
        {translate("crm.dashboard.hotboard.title")}
      </h1>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        <HotboardDealSection
          icon={CalendarClock}
          title={translate("crm.dashboard.hotboard.follow_up_today")}
          deals={followUpDeals}
          companyById={companyById}
        />
        <HotboardDealSection
          icon={Inbox}
          title={translate("crm.dashboard.hotboard.new_inquiries")}
          deals={newInquiryDeals}
          companyById={companyById}
        />
        <HotboardDealSection
          icon={Factory}
          title={translate("crm.dashboard.hotboard.waiting_manufacturer")}
          deals={waitingManufacturerDeals}
          companyById={companyById}
        />
        <HotboardDealSection
          icon={MessageCircle}
          title={translate("crm.dashboard.hotboard.offer_follow_up")}
          deals={offerFollowUpDeals}
          companyById={companyById}
        />
        <HotboardOpenTasks className="md:col-span-2 xl:col-span-1" />
      </div>
      <p className="nora-muted text-xs max-w-3xl">
        <FileText className="inline h-3.5 w-3.5 mr-1 align-text-bottom" />
        {translate("crm.dashboard.hotboard.no_appointments_hint")}
      </p>
    </section>
  );
};
