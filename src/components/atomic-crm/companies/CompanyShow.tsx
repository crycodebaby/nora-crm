import { ReferenceManyField } from "@/components/admin/reference-many-field";
import { SortButton } from "@/components/admin/sort-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserPlus } from "lucide-react";
import {
  RecordContextProvider,
  ShowBase,
  useGetOne,
  useListContext,
  useLocaleState,
  useRecordContext,
  useShowContext,
  useTranslate,
} from "ra-core";
import {
  Link,
  Link as RouterLink,
  useLocation,
  useMatch,
  useNavigate,
} from "react-router-dom";

import { useIsMobile } from "@/hooks/use-mobile";
import { ActivityLog } from "../activity/ActivityLog";
import { EntityAuditHistory } from "../audit/EntityAuditHistory";
import { Avatar } from "../contacts/Avatar";
import { TagsList } from "../contacts/TagsList";
import { findDealLabel, formatDealAmount } from "../deals/dealUtils";
import { MobileContent } from "../layout/MobileContent";
import MobileHeader from "../layout/MobileHeader";
import { MobileBackButton } from "../misc/MobileBackButton";
import { formatRelativeDate } from "../misc/relativeDateUtils";
import { Status } from "../misc/Status";
import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Company, Contact, Deal } from "../types";
import { BusinessNumber } from "../misc/BusinessNumber";
import { NoraShowBoundary } from "../misc/NoraShowBoundary";
import { noraCreatePath } from "../routing/noraRoutes";
import {
  AdditionalInfo,
  AddressInfo,
  CompanyAside,
  CompanyInfo,
  ContextInfo,
} from "./CompanyAside";
import { CompanyAvatar } from "./CompanyAvatar";
import { CompanyTasksList } from "./CompanyTasksList";

export const CompanyShow = () => {
  const isMobile = useIsMobile();

  return (
    <ShowBase>
      <NoraShowBoundary>
        {isMobile ? <CompanyShowContentMobile /> : <CompanyShowContent />}
      </NoraShowBoundary>
    </ShowBase>
  );
};

const CompanyShowContentMobile = () => {
  const translate = useTranslate();
  const { record } = useShowContext<Company>();
  if (!record) return null;

  return (
    <>
      <MobileHeader>
        <MobileBackButton to="/" />
        <div className="flex flex-1">
          <Link to="/">
            <h1 className="text-xl font-semibold">
              {translate("resources.companies.forcedCaseName")}
            </h1>
          </Link>
        </div>
      </MobileHeader>

      <MobileContent>
        <div className="mb-6">
          <div className="flex items-center mb-4">
            <CompanyAvatar />
            <div className="mx-3 flex-1">
              <h2 className="text-2xl font-bold">{record.name}</h2>
              <BusinessNumber value={record.customer_number} />
            </div>
          </div>
        </div>
        <CompanyInfo record={record} />
        <AddressInfo record={record} />
        <ContextInfo record={record} />
        <AdditionalInfo record={record} />
      </MobileContent>
    </>
  );
};

const CompanyShowContent = () => {
  const translate = useTranslate();
  const { record } = useShowContext<Company>();
  const navigate = useNavigate();

  // CompanyShow is mounted under the German Nora alias route
  // (/kunden/:id/show/*, see NoraResourceAliasRoutes.tsx). Navigating to the
  // legacy English /companies/... path here would be caught by the
  // LegacyPathRedirect route and rewritten back to /kunden/..., which this
  // useMatch would then fail to match — so both must use the German path.
  const tabMatch = useMatch("/kunden/:id/show/:tab");
  const currentTab = tabMatch?.params?.tab || "activity";

  const handleTabChange = (value: string) => {
    if (value === currentTab) return;
    const showPath = noraCreatePath({
      resource: "companies",
      type: "show",
      id: record?.id,
    });
    navigate(value === "activity" ? showPath : `${showPath}/${value}`);
  };

  if (!record) return null;

  return (
    <div className="mt-2 flex pb-2 gap-8">
      <div className="flex-1">
        <Card>
          <CardContent>
            <div className="flex mb-3">
              <CompanyAvatar />
              <div className="ml-2 flex-1">
                <h5 className="text-xl">{record.name}</h5>
                <BusinessNumber value={record.customer_number} />
              </div>
            </div>
            <Tabs defaultValue={currentTab} onValueChange={handleTabChange}>
              <TabsList
                className={
                  record.nb_deals
                    ? "grid w-full grid-cols-5"
                    : "grid w-full grid-cols-4"
                }
              >
                <TabsTrigger value="activity">
                  {translate("crm.common.activity")}
                </TabsTrigger>
                <TabsTrigger value="history">
                  {translate("crm.audit.history_title")}
                </TabsTrigger>
                <TabsTrigger value="contacts">
                  {record.nb_contacts === 0
                    ? translate("resources.companies.no_contacts")
                    : translate("resources.companies.nb_contacts", {
                        smart_count: record.nb_contacts ?? 0,
                      })}
                </TabsTrigger>
                <TabsTrigger value="tasks">
                  {translate("resources.tasks.name", { smart_count: 2 })}
                </TabsTrigger>
                {record.nb_deals ? (
                  <TabsTrigger value="deals">
                    {translate("resources.companies.nb_deals", {
                      smart_count: record.nb_deals ?? 0,
                    })}
                  </TabsTrigger>
                ) : null}
              </TabsList>
              <TabsContent value="activity" className="pt-2">
                <ActivityLog companyId={record.id} context="company" />
              </TabsContent>
              <TabsContent value="history" className="pt-2">
                <EntityAuditHistory
                  entityType="company"
                  entityId={Number(record.id)}
                  embedded
                />
              </TabsContent>
              <TabsContent value="tasks" className="pt-2">
                <CompanyTasksList />
              </TabsContent>
              <TabsContent value="contacts">
                {record.nb_contacts ? (
                  <ReferenceManyField
                    reference="contacts_summary"
                    target="company_id"
                    sort={{ field: "last_name", order: "ASC" }}
                  >
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-row justify-end space-x-2 mt-1">
                        <SortButton
                          fields={["last_name", "first_name", "last_seen"]}
                        />
                        <CreateRelatedContactButton />
                      </div>
                      <SelfContactCard company={record} />
                      <ContactsIterator />
                    </div>
                  </ReferenceManyField>
                ) : (
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-row justify-end space-x-2 mt-1">
                      <CreateRelatedContactButton />
                    </div>
                    <SelfContactCard company={record} />
                  </div>
                )}
              </TabsContent>
              <TabsContent value="deals">
                {record.nb_deals ? (
                  <ReferenceManyField
                    reference="deals"
                    target="company_id"
                    sort={{ field: "name", order: "ASC" }}
                  >
                    <DealsIterator />
                  </ReferenceManyField>
                ) : null}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
      <CompanyAside />
    </div>
  );
};

/**
 * Self Contact Wave (2026-08-26): the Kontakte-Tab's ReferenceManyField only
 * queries by company_id, which misses a self_contact_id whose own
 * company_id points elsewhere (the Freddie scenario — he stays
 * Ansprechpartner of a different company). Rendered only when that contact
 * isn't already part of the company_id-based list, so nb_contacts and the
 * visibly listed contacts stay consistent (Acceptance Check "Kontaktzähler
 * konsistent halten").
 */
const SelfContactCard = ({ company }: { company: Company }) => {
  const translate = useTranslate();
  const { data: selfContact } = useGetOne<Contact>(
    "contacts",
    { id: company.self_contact_id as string | number },
    { enabled: company.self_contact_id != null },
  );

  if (!selfContact || String(selfContact.company_id) === String(company.id)) {
    return null;
  }

  return (
    <RecordContextProvider value={selfContact}>
      <RouterLink
        to={`/contacts/${selfContact.id}/show`}
        className="nora-card p-4 flex items-center justify-between hover:bg-muted transition-colors"
      >
        <div>
          <p className="font-medium">
            {selfContact.first_name} {selfContact.last_name}
          </p>
          <p className="text-sm text-muted-foreground">
            {translate("resources.companies.self_contact_hint", {
              _: "Diese Kundenakte gehört zu dieser Person",
            })}
          </p>
        </div>
      </RouterLink>
    </RecordContextProvider>
  );
};

const ContactsIterator = () => {
  const translate = useTranslate();
  const [locale = "en"] = useLocaleState();
  const location = useLocation();
  const { data: contacts, error, isPending } = useListContext<Contact>();

  if (isPending || error) return null;

  return (
    <div className="pt-0">
      {contacts.map((contact) => (
        <RecordContextProvider key={contact.id} value={contact}>
          <div className="p-0 text-sm">
            <RouterLink
              to={`/contacts/${contact.id}/show`}
              state={{ from: location.pathname }}
              className="flex items-center justify-between hover:bg-muted py-2 transition-colors"
            >
              <div className="mr-4">
                <Avatar />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium flex items-center gap-2">
                  {`${contact.first_name} ${contact.last_name}`}
                  {contact.is_primary && (
                    <span className="text-xs font-normal border rounded-full px-2 py-0.5 text-primary border-primary/40">
                      {translate("resources.contacts.fields.is_primary")}
                    </span>
                  )}
                </div>
                <div className="text-sm text-muted-foreground">
                  {contact.title}
                  {contact.nb_tasks
                    ? ` - ${translate("crm.common.task_count", {
                        smart_count: contact.nb_tasks ?? 0,
                      })}`
                    : ""}
                  &nbsp; &nbsp;
                  <TagsList />
                </div>
              </div>
              {contact.last_seen && (
                <div className="text-right">
                  <div className="text-sm text-muted-foreground">
                    {translate("crm.common.last_activity_with_date", {
                      date: formatRelativeDate(contact.last_seen, locale),
                    })}{" "}
                    <Status status={contact.status} />
                  </div>
                </div>
              )}
            </RouterLink>
          </div>
        </RecordContextProvider>
      ))}
    </div>
  );
};

const CreateRelatedContactButton = () => {
  const translate = useTranslate();
  const company = useRecordContext<Company>();
  return (
    <Button variant="outline" asChild size="sm" className="h-9">
      <RouterLink
        to="/contacts/create"
        state={company ? { record: { company_id: company.id } } : undefined}
        className="flex items-center gap-2"
      >
        <UserPlus className="h-4 w-4" />
        {translate("resources.contacts.action.add")}
      </RouterLink>
    </Button>
  );
};

const DealsIterator = () => {
  const translate = useTranslate();
  const [locale = "en"] = useLocaleState();
  const { data: deals, error, isPending } = useListContext<Deal>();
  const { dealStages, dealCategories, currency } = useConfigurationContext();
  if (isPending || error) return null;
  return (
    <div>
      <div>
        {deals.map((deal) => (
          <div key={deal.id} className="p-0 text-sm">
            <RouterLink
              to={`/deals/${deal.id}/show`}
              className="flex items-center justify-between hover:bg-muted py-2 px-4 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium">{deal.name}</div>
                <div className="text-sm text-muted-foreground">
                  {findDealLabel(dealStages, deal.stage)},{" "}
                  {formatDealAmount(deal.amount, currency, {
                    notation: "compact",
                    minimumSignificantDigits: 3,
                  })}
                  {deal.category
                    ? `, ${dealCategories.find((c) => c.value === deal.category)?.label ?? deal.category}`
                    : ""}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm text-muted-foreground">
                  {translate("crm.common.last_activity_with_date", {
                    date: formatRelativeDate(deal.updated_at, locale),
                  })}{" "}
                </div>
              </div>
            </RouterLink>
          </div>
        ))}
      </div>
    </div>
  );
};
