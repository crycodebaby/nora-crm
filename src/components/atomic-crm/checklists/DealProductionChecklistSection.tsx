import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import {
  useDataProvider,
  useCanAccess,
  useGetIdentity,
  useGetList,
  useNotify,
  useRecordContext,
  useRefresh,
  useTranslate,
  useUpdate,
} from "ra-core";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useIsMobile } from "@/hooks/use-mobile";

import type { CrmDataProvider } from "../providers/types";
import type { ChecklistRun, ChecklistRunItem, Deal } from "../types";
import { NoraQueryError } from "../misc/NoraQueryError";
import { FENS_PRODUCTION_RELEASE_TEMPLATE_CODE } from "../types/checklists";
import {
  allRequiredItemsChecked,
  computeChecklistProgress,
  shouldShowDealChecklistSection,
} from "./checklistUtils";

const isDemoMode = import.meta.env.VITE_IS_DEMO === "true";

export const DealProductionChecklistSection = () => {
  const deal = useRecordContext<Deal>();
  const translate = useTranslate();

  const {
    data: runs,
    isPending: runsPending,
    error: runsError,
    refetch: refetchRuns,
  } = useGetList<ChecklistRun>(
    "checklist_runs",
    {
      filter: deal?.id ? { deal_id: deal.id } : {},
      pagination: { page: 1, perPage: 20 },
      sort: { field: "started_at", order: "DESC" },
    },
    { enabled: !!deal?.id && !isDemoMode },
  );

  if (!deal) return null;

  if (runsError && !isDemoMode) {
    return (
      <section className="space-y-3">
        <ChecklistSectionHeader />
        <NoraQueryError error={runsError} onRetry={() => refetchRuns()} />
      </section>
    );
  }

  const hasAnyRuns = (runs?.length ?? 0) > 0;
  const showSection = shouldShowDealChecklistSection(deal.category, hasAnyRuns);

  if (!showSection) {
    if (deal.category !== "fensterservice" && runsPending) return null;
    if (!showSection) return null;
  }

  if (isDemoMode) {
    return (
      <section className="space-y-3">
        <ChecklistSectionHeader />
        <p className="nora-muted text-sm nora-card p-4">
          {translate("resources.deals.checklist.demo_disabled")}
        </p>
      </section>
    );
  }

  return <DealProductionChecklistContent deal={deal} runs={runs ?? []} />;
};

const ChecklistSectionHeader = () => {
  const translate = useTranslate();
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-semibold tracking-tight">
        {translate("resources.deals.checklist.title")}
      </h3>
      <p className="nora-muted text-sm">
        {translate("resources.deals.checklist.subtitle")}
      </p>
    </div>
  );
};

const DealProductionChecklistContent = ({
  deal,
  runs,
}: {
  deal: Deal;
  runs: ChecklistRun[];
}) => {
  const translate = useTranslate();
  const { canAccess: canEditChecklist } = useCanAccess({
    resource: "deals",
    action: "edit",
  });
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const refresh = useRefresh();
  const queryClient = useQueryClient();

  const { data: templates, isPending: templatesPending } = useGetList(
    "checklist_templates",
    {
      filter: { code: FENS_PRODUCTION_RELEASE_TEMPLATE_CODE },
      pagination: { page: 1, perPage: 1 },
      sort: { field: "code", order: "ASC" },
    },
  );

  const templateId = templates?.[0]?.id as string | undefined;
  const openRun = runs.find(
    (run) => run.template_id === templateId && run.status === "open",
  );

  const { data: items, isPending: itemsPending } = useGetList<ChecklistRunItem>(
    "checklist_run_items",
    {
      filter: openRun ? { checklist_run_id: openRun.id } : {},
      pagination: { page: 1, perPage: 50 },
      sort: { field: "sort_index", order: "ASC" },
    },
    { enabled: !!openRun?.id },
  );

  const { mutate: startRun, isPending: isStarting } = useMutation({
    mutationFn: () =>
      dataProvider.startChecklistRunFromTemplate({
        p_template_code: FENS_PRODUCTION_RELEASE_TEMPLATE_CODE,
        p_deal_id: Number(deal.id),
        p_contact_id:
          deal.contact_ids?.[0] != null ? Number(deal.contact_ids[0]) : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklist_runs"] });
      queryClient.invalidateQueries({ queryKey: ["checklist_run_items"] });
      refresh();
    },
    onError: () => {
      notify("resources.deals.checklist.start_error", { type: "error" });
    },
  });

  const sortedItems = items ?? [];
  const progress = computeChecklistProgress(sortedItems);
  const requiredComplete =
    sortedItems.length > 0 && allRequiredItemsChecked(sortedItems);
  const isLoading = templatesPending || (openRun && itemsPending) || isStarting;

  return (
    <section className="space-y-3">
      <ChecklistSectionHeader />

      <div className="nora-card p-4 space-y-4">
        {openRun ? (
          <>
            <p className="text-sm text-muted-foreground">
              {translate("resources.deals.checklist.progress", {
                done: progress.done,
                total: progress.total,
              })}
            </p>

            {requiredComplete ? (
              <p className="text-sm text-muted-foreground border border-border rounded-md px-3 py-2 bg-muted/40">
                {translate("resources.deals.checklist.required_complete")}
              </p>
            ) : null}

            <ul className="divide-y divide-border border border-border rounded-md overflow-hidden">
              {sortedItems.map((runItem) => (
                <DealProductionChecklistItem
                  key={runItem.id}
                  item={runItem}
                  disabled={isLoading || !canEditChecklist}
                />
              ))}
            </ul>

            {itemsPending ? (
              <div className="flex justify-center py-2">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : null}
          </>
        ) : canEditChecklist ? (
          <Button
            type="button"
            className="nora-primary-action nora-touch-target"
            disabled={isStarting || templatesPending || !templateId}
            onClick={() => startRun()}
          >
            {isStarting ? <Loader2 className="size-4 animate-spin" /> : null}
            {translate("resources.deals.checklist.start")}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            {translate("resources.deals.checklist.not_started")}
          </p>
        )}
      </div>
    </section>
  );
};

const DealProductionChecklistItem = ({
  item,
  disabled,
}: {
  item: ChecklistRunItem;
  disabled?: boolean;
}) => {
  const translate = useTranslate();
  const isMobile = useIsMobile();
  const notify = useNotify();
  const refresh = useRefresh();
  const queryClient = useQueryClient();
  const { data: identity } = useGetIdentity();
  const [update, { isPending: isUpdatePending }] = useUpdate();
  const [noteOpen, setNoteOpen] = useState(false);
  const [draftNote, setDraftNote] = useState(item.note ?? "");

  const isBusy = disabled || isUpdatePending;
  const labelId = `checklist-item-${item.id}`;

  const invalidateItems = () => {
    queryClient.invalidateQueries({ queryKey: ["checklist_run_items"] });
    refresh();
  };

  const handleToggle = () => {
    const nextChecked = !item.is_checked;
    update(
      "checklist_run_items",
      {
        id: item.id,
        data: nextChecked
          ? {
              is_checked: true,
              checked_at: new Date().toISOString(),
              checked_by: identity?.id ?? null,
            }
          : {
              is_checked: false,
              checked_at: null,
              checked_by: null,
            },
        previousData: item,
      },
      {
        onSuccess: invalidateItems,
        onError: () => {
          notify("resources.deals.checklist.update_error", { type: "error" });
        },
      },
    );
  };

  const handleSaveNote = () => {
    const trimmed = draftNote.trim();
    update(
      "checklist_run_items",
      {
        id: item.id,
        data: { note: trimmed.length ? trimmed : null },
        previousData: item,
      },
      {
        onSuccess: () => {
          setNoteOpen(false);
          invalidateItems();
        },
        onError: () => {
          notify("resources.deals.checklist.update_error", { type: "error" });
        },
      },
    );
  };

  const handleCancelNote = () => {
    setDraftNote(item.note ?? "");
    setNoteOpen(false);
  };

  return (
    <li className="bg-background">
      <div
        className="flex items-start gap-3 px-3 py-3 min-h-[var(--nora-touch-min)]"
        onClick={isMobile && !noteOpen ? handleToggle : undefined}
      >
        <Checkbox
          id={labelId}
          checked={item.is_checked}
          onCheckedChange={handleToggle}
          disabled={isBusy}
          className="mt-0.5 shrink-0"
          aria-labelledby={labelId}
        />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              id={labelId}
              className={`text-sm leading-snug ${
                item.is_checked ? "line-through text-muted-foreground" : ""
              }`}
            >
              {item.label_snapshot}
            </span>
            <Badge variant="outline" className="text-[11px] font-normal">
              {item.is_required
                ? translate("resources.deals.checklist.required")
                : translate("resources.deals.checklist.optional")}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {item.is_checked
                ? translate("resources.deals.checklist.done")
                : translate("resources.deals.checklist.open")}
            </span>
          </div>

          {!noteOpen ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs text-muted-foreground"
              disabled={isBusy}
              onClick={(event) => {
                event.stopPropagation();
                setDraftNote(item.note ?? "");
                setNoteOpen(true);
              }}
            >
              {translate("resources.deals.checklist.note")}
              {item.note ? " · …" : ""}
            </Button>
          ) : (
            <div
              className="space-y-2 pt-1"
              onClick={(event) => event.stopPropagation()}
            >
              <Textarea
                value={draftNote}
                onChange={(event) => setDraftNote(event.target.value)}
                rows={2}
                className="text-sm resize-none"
                disabled={isBusy}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="h-9"
                  disabled={isBusy}
                  onClick={handleSaveNote}
                >
                  {translate("resources.deals.checklist.save_note")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-9"
                  disabled={isBusy}
                  onClick={handleCancelNote}
                >
                  {translate("resources.deals.checklist.cancel")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  );
};
