import { useMemo, useState, type ReactNode } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { History, RotateCcw } from "lucide-react";
import {
  useDataProvider,
  useGetList,
  useTranslate,
} from "ra-core";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { useIsMobile } from "@/hooks/use-mobile";

import { MobileContent } from "../layout/MobileContent";
import MobileHeader from "../layout/MobileHeader";
import { MobileBackButton } from "../misc/MobileBackButton";
import { NoraAccessGuard } from "../misc/NoraEditGuard";
import { NoraPageLoading } from "../misc/NoraPageLoading";
import { NoraQueryError } from "../misc/NoraQueryError";
import type { CrmDataProvider } from "../providers/types";
import { useConfigurationContext } from "../root/ConfigurationContext";
import {
  formatAuditActor,
  formatAuditDateTime,
  formatAuditEventLabel,
  formatAuditSource,
  formatBytes,
  parseAuditChanges,
} from "./auditFormatters";
import { AUDIT_PAGE_PATH } from "./auditPagePath";
import type { AuditEvent } from "./auditTypes";

const GLOBAL_PAGE_SIZE = 50;

const EVENT_TYPE_OPTIONS = [
  "company.created",
  "company.updated",
  "company.deleted",
  "contact.created",
  "contact.updated",
  "contact.deleted",
  "deal.created",
  "deal.updated",
  "deal.status_changed",
  "deal.archived",
  "deal.restored",
  "deal.deleted",
  "task.created",
  "task.completed",
  "task.updated",
  "deal_note.created",
  "deal_note.updated",
  "user.role_changed",
];

export const AuditPage = () => {
  const isMobile = useIsMobile();
  const translate = useTranslate();

  const content = (
    <NoraAccessGuard resource="audit_events" action="list" fallbackPath="/">
      <AuditPageContent />
    </NoraAccessGuard>
  );

  if (isMobile) {
    return (
      <>
        <MobileHeader>
          <MobileBackButton to="/" />
          <div className="flex flex-1 min-w-0">
            <h1 className="text-xl font-semibold truncate">
              {translate("crm.audit.page_title")}
            </h1>
          </div>
        </MobileHeader>
        <MobileContent>{content}</MobileContent>
      </>
    );
  }

  return (
    <div className="max-w-5xl mx-auto my-8 px-4 space-y-6">
      <div className="flex items-center gap-2">
        <History className="h-6 w-6 text-muted-foreground" aria-hidden />
        <h1 className="text-2xl font-semibold">
          {translate("crm.audit.page_title")}
        </h1>
      </div>
      {content}
    </div>
  );
};

AuditPage.path = AUDIT_PAGE_PATH;

const AuditPageContent = () => {
  const translate = useTranslate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { dealStages, currency } = useConfigurationContext();

  const [entityType, setEntityType] = useState<string>("");
  const [eventType, setEventType] = useState<string>("");
  const [actorSalesId, setActorSalesId] = useState<string>("");
  const [businessNumber, setBusinessNumber] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const filters = useMemo(
    () => ({
      entityType: entityType || null,
      eventType: eventType || null,
      actorSalesId: actorSalesId ? Number(actorSalesId) : null,
      from: fromDate ? new Date(fromDate).toISOString() : null,
      to: toDate ? new Date(`${toDate}T23:59:59`).toISOString() : null,
      businessNumber: businessNumber.trim() || null,
    }),
    [actorSalesId, businessNumber, entityType, eventType, fromDate, toDate],
  );

  const eventsQuery = useInfiniteQuery({
    queryKey: ["globalAuditEvents", filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      dataProvider.getGlobalAuditEvents({
        limit: GLOBAL_PAGE_SIZE,
        before: pageParam,
        ...filters,
      }),
    getNextPageParam: (lastPage) => {
      if (lastPage.data.length < lastPage.limit) return undefined;
      return lastPage.data[lastPage.data.length - 1]?.created_at;
    },
  });

  const statsQuery = useQuery({
    queryKey: ["auditStorageStats"],
    queryFn: () => dataProvider.getAuditStorageStats(),
  });

  const { data: salesList } = useGetList("sales", {
    pagination: { page: 1, perPage: 100 },
    sort: { field: "last_name", order: "ASC" },
  });

  const events = useMemo(
    () => eventsQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [eventsQuery.data],
  );

  const formatContext = useMemo(
    () => ({
      dealStages,
      currency,
      translateEvent: (type: string) =>
        translate(`crm.audit.events.${type}`, { _: type }),
      translateField: (field: string) =>
        translate(`crm.audit.fields.${field}`, { _: field }),
    }),
    [currency, dealStages, translate],
  );

  const resetFilters = () => {
    setEntityType("");
    setEventType("");
    setActorSalesId("");
    setBusinessNumber("");
    setFromDate("");
    setToDate("");
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {translate("crm.audit.filters.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FilterField label={translate("crm.audit.filters.entity_type")}>
            <Select
              value={entityType || "all"}
              onValueChange={(value) =>
                setEntityType(value === "all" ? "" : value)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {translate("crm.audit.filters.all")}
                </SelectItem>
                <SelectItem value="company">
                  {translate("resources.companies.forcedCaseName")}
                </SelectItem>
                <SelectItem value="contact">
                  {translate("resources.contacts.forcedCaseName")}
                </SelectItem>
                <SelectItem value="deal">
                  {translate("resources.deals.forcedCaseName", { _: "Vorgang" })}
                </SelectItem>
                <SelectItem value="task">
                  {translate("resources.tasks.name", { smart_count: 1 })}
                </SelectItem>
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label={translate("crm.audit.filters.event_type")}>
            <Select
              value={eventType || "all"}
              onValueChange={(value) =>
                setEventType(value === "all" ? "" : value)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {translate("crm.audit.filters.all")}
                </SelectItem>
                {EVENT_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {translate(`crm.audit.events.${option}`, { _: option })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label={translate("crm.audit.filters.actor")}>
            <Select
              value={actorSalesId || "all"}
              onValueChange={(value) =>
                setActorSalesId(value === "all" ? "" : value)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {translate("crm.audit.filters.all")}
                </SelectItem>
                {(salesList ?? []).map((sale) => (
                  <SelectItem key={sale.id} value={String(sale.id)}>
                    {sale.first_name} {sale.last_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label={translate("crm.audit.filters.business_number")}>
            <Input
              value={businessNumber}
              onChange={(event) => setBusinessNumber(event.target.value)}
              placeholder={translate("crm.audit.filters.business_number_hint")}
            />
          </FilterField>

          <FilterField label={translate("crm.audit.filters.from")}>
            <Input
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
            />
          </FilterField>

          <FilterField label={translate("crm.audit.filters.to")}>
            <Input
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
            />
          </FilterField>

          <div className="sm:col-span-2 lg:col-span-3 flex justify-end">
            <Button type="button" variant="outline" onClick={resetFilters}>
              <RotateCcw className="h-4 w-4 mr-2" aria-hidden />
              {translate("crm.audit.filters.reset")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <AuditStorageStatsPanel
        isPending={statsQuery.isPending}
        error={statsQuery.error}
        stats={statsQuery.data}
        onRetry={() => statsQuery.refetch()}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {translate("crm.audit.events_heading")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {eventsQuery.isPending ? (
            <NoraPageLoading variant="inline" className="py-8" />
          ) : eventsQuery.error ? (
            <NoraQueryError
              error={eventsQuery.error}
              onRetry={() => eventsQuery.refetch()}
            />
          ) : !events.length ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {translate("crm.audit.empty.title")}
            </p>
          ) : (
            <div className="space-y-4">
              {events.map((event, index) => (
                <div key={event.id}>
                  <GlobalAuditEventRow
                    event={event}
                    formatContext={formatContext}
                  />
                  {index < events.length - 1 ? <Separator className="mt-4" /> : null}
                </div>
              ))}

              {eventsQuery.hasNextPage ? (
                <div className="flex justify-center pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={eventsQuery.isFetchingNextPage}
                    onClick={() => eventsQuery.fetchNextPage()}
                  >
                    {eventsQuery.isFetchingNextPage ? (
                      <Spinner />
                    ) : (
                      translate("crm.audit.load_more")
                    )}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

const FilterField = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  <div className="space-y-2">
    <Label>{label}</Label>
    {children}
  </div>
);

const AuditStorageStatsPanel = ({
  isPending,
  error,
  stats,
  onRetry,
}: {
  isPending: boolean;
  error: unknown;
  stats?: {
    event_count: number;
    oldest_event: string | null;
    newest_event: string | null;
    events_last_30_days: number;
    total_bytes: number;
    growth_hint: string;
    projection_note: string;
  };
  onRetry: () => void;
}) => {
  const translate = useTranslate();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {translate("crm.audit.stats.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <NoraPageLoading variant="inline" className="py-4" />
        ) : error ? (
          <NoraQueryError error={error} onRetry={onRetry} />
        ) : stats ? (
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <StatItem
              label={translate("crm.audit.stats.event_count")}
              value={String(stats.event_count)}
            />
            <StatItem
              label={translate("crm.audit.stats.last_30_days")}
              value={String(stats.events_last_30_days)}
            />
            <StatItem
              label={translate("crm.audit.stats.storage")}
              value={formatBytes(stats.total_bytes)}
            />
            <StatItem
              label={translate("crm.audit.stats.growth_hint")}
              value={translate(`crm.audit.stats.hints.${stats.growth_hint}`, {
                _: stats.growth_hint,
              })}
            />
            {stats.oldest_event ? (
              <StatItem
                label={translate("crm.audit.stats.oldest")}
                value={formatAuditDateTime(stats.oldest_event)}
              />
            ) : null}
            {stats.newest_event ? (
              <StatItem
                label={translate("crm.audit.stats.newest")}
                value={formatAuditDateTime(stats.newest_event)}
              />
            ) : null}
            <div className="sm:col-span-2 lg:col-span-4 text-xs text-muted-foreground">
              {stats.projection_note}
            </div>
          </dl>
        ) : null}
      </CardContent>
    </Card>
  );
};

const StatItem = ({ label, value }: { label: string; value: string }) => (
  <div>
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="font-medium">{value}</dd>
  </div>
);

const GlobalAuditEventRow = ({
  event,
  formatContext,
}: {
  event: AuditEvent;
  formatContext: Parameters<typeof formatAuditEventLabel>[1];
}) => {
  const translate = useTranslate();
  const changeCount = Object.keys(parseAuditChanges(event)).length;
  const meta = event.metadata ?? {};
  const businessRef =
    (meta.case_number as string | undefined) ??
    (meta.customer_number as string | undefined);

  return (
    <article className="space-y-1 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          {formatAuditEventLabel(event.event_type, formatContext)}
        </p>
        <span className="text-xs text-muted-foreground">
          {formatAuditDateTime(event.created_at)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {formatAuditActor(event)}
        {" · "}
        {translate(`crm.audit.entity_types.${event.entity_type}`, {
          _: event.entity_type,
        })}
        {businessRef ? ` · ${businessRef}` : ""}
        {event.source
          ? ` · ${formatAuditSource(event.source, (key) => translate(key))}`
          : ""}
        {changeCount
          ? ` · ${translate("crm.audit.change_count", { count: changeCount })}`
          : ""}
      </p>
    </article>
  );
};
