import { ListChecks } from "lucide-react";
import { useGetList, useGetMany, useRedirect, useTranslate } from "ra-core";
import { useMemo } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { BusinessNumber } from "../misc/BusinessNumber";
import { noraCreatePath } from "../routing/noraRoutes";
import type {
  ChecklistRun,
  ChecklistRunItem,
  ChecklistTemplate,
  Company,
  Deal,
} from "../types";
import { FENS_PRODUCTION_RELEASE_TEMPLATE_CODE } from "../types/checklists";
import {
  buildProductionReleaseHotboardEntries,
  groupItemsByRunId,
  limitProductionReleaseHotboardEntries,
  sortProductionReleaseHotboardEntries,
  type ProductionReleaseHotboardEntry,
} from "./productionReleaseHotboardUtils";

const isDemoMode = import.meta.env.VITE_IS_DEMO === "true";

export const HotboardOpenProductionReleases = ({
  className,
}: {
  className?: string;
}) => {
  const translate = useTranslate();

  const { data: templates, isPending: templatesPending } =
    useGetList<ChecklistTemplate>(
      "checklist_templates",
      {
        filter: { code: FENS_PRODUCTION_RELEASE_TEMPLATE_CODE },
        pagination: { page: 1, perPage: 1 },
        sort: { field: "code", order: "ASC" },
      },
      { enabled: !isDemoMode },
    );

  const templateId = templates?.[0]?.id as string | undefined;

  const { data: runs, isPending: runsPending } = useGetList<ChecklistRun>(
    "checklist_runs",
    {
      filter: templateId ? { template_id: templateId, status: "open" } : {},
      pagination: { page: 1, perPage: 100 },
      sort: { field: "started_at", order: "ASC" },
    },
    { enabled: !isDemoMode && !!templateId },
  );

  const runIds = useMemo(
    () => (runs ?? []).map((entry) => String(entry.id)),
    [runs],
  );

  const runIdsFilter = runIds.length > 0 ? `(${runIds.join(",")})` : undefined;

  const { data: runItems, isPending: itemsPending } =
    useGetList<ChecklistRunItem>(
      "checklist_run_items",
      {
        filter: runIdsFilter ? { "checklist_run_id@in": runIdsFilter } : {},
        pagination: { page: 1, perPage: 500 },
        sort: { field: "sort_index", order: "ASC" },
      },
      { enabled: !isDemoMode && !!runIdsFilter },
    );

  const dealIds = useMemo(
    () => [...new Set((runs ?? []).map((entry) => entry.deal_id))],
    [runs],
  );

  const { data: deals, isPending: dealsPending } = useGetMany<Deal>(
    "deals",
    { ids: dealIds },
    { enabled: !isDemoMode && dealIds.length > 0 },
  );

  const companyIds = useMemo(
    () => [...new Set((deals ?? []).map((entry) => entry.company_id))],
    [deals],
  );

  const { data: companies } = useGetMany<Company>(
    "companies",
    { ids: companyIds },
    { enabled: !isDemoMode && companyIds.length > 0 },
  );

  const entries = useMemo(() => {
    if (!templateId || !runs?.length) return [];

    const dealById = new Map<number, Deal>();
    for (const entry of deals ?? []) {
      dealById.set(Number(entry.id), entry);
    }

    const itemsByRunId = groupItemsByRunId(runItems ?? []);
    const built = buildProductionReleaseHotboardEntries(
      runs,
      templateId,
      itemsByRunId,
      dealById,
    );

    return limitProductionReleaseHotboardEntries(
      sortProductionReleaseHotboardEntries(built),
    );
  }, [deals, runItems, runs, templateId]);

  const companyById = useMemo(() => {
    const map = new Map<string | number, Company>();
    for (const company of companies ?? []) {
      map.set(company.id, company);
    }
    return map;
  }, [companies]);

  const isPending =
    !isDemoMode &&
    (templatesPending || runsPending || itemsPending || dealsPending);

  if (isDemoMode) {
    return null;
  }

  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center gap-2">
        <ListChecks
          className="h-5 w-5 text-muted-foreground shrink-0"
          aria-hidden
        />
        <h2 className="text-base font-semibold tracking-tight">
          {translate("crm.dashboard.hotboard.open_production_releases")}
        </h2>
      </div>
      <Card className="nora-card divide-y overflow-hidden">
        {isPending ? (
          <p className="px-4 py-6 text-sm text-center text-muted-foreground">
            {translate("crm.common.loading")}
          </p>
        ) : entries.length > 0 ? (
          entries.map((entry) => (
            <HotboardProductionReleaseRow
              key={entry.runId}
              entry={entry}
              companyName={companyById.get(entry.deal.company_id)?.name}
            />
          ))
        ) : (
          <p className="px-4 py-6 text-sm text-center text-muted-foreground nora-readable">
            {translate("crm.dashboard.hotboard.no_open_production_releases")}
          </p>
        )}
      </Card>
    </section>
  );
};

const HotboardProductionReleaseRow = ({
  entry,
  companyName,
}: {
  entry: ProductionReleaseHotboardEntry;
  companyName?: string;
}) => {
  const translate = useTranslate();
  const redirect = useRedirect();
  const { deal, requiredDone, requiredTotal, missingRequiredLabels, priority } =
    entry;

  const openDeal = () => {
    redirect(
      noraCreatePath({ resource: "deals", type: "show", id: deal.id }),
      undefined,
      undefined,
      undefined,
      { _scrollToTop: false },
    );
  };

  const allRequiredDone = priority === "optional_only";

  return (
    <button
      type="button"
      onClick={openDeal}
      className="w-full text-left px-4 py-3.5 hover:bg-muted/60 transition-colors nora-touch-target flex flex-col gap-1.5"
      aria-label={`${translate("crm.dashboard.hotboard.open_directly")}: ${deal.name}`}
    >
      <BusinessNumber value={deal.case_number} />
      <span className="nora-list-title text-sm leading-snug">{deal.name}</span>
      {companyName ? (
        <span className="nora-muted text-xs">{companyName}</span>
      ) : null}
      <span className="text-xs text-muted-foreground">
        {translate("crm.dashboard.hotboard.required_progress", {
          done: requiredDone,
          total: requiredTotal,
        })}
      </span>
      {allRequiredDone ? (
        <span className="text-xs text-muted-foreground">
          {translate("crm.dashboard.hotboard.required_complete")}
        </span>
      ) : missingRequiredLabels.length > 0 ? (
        <span className="text-xs text-muted-foreground">
          {translate("crm.dashboard.hotboard.still_missing")}:{" "}
          {missingRequiredLabels.join(" · ")}
        </span>
      ) : null}
    </button>
  );
};
