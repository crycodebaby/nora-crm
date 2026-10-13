/**
 * The Arbeitskorb surface (Alpha UI 2, docs/nora/26), shared by the desktop
 * page and the mobile page. Read-only: it presents what `useWorkItems`
 * delivered and offers navigation to the context records — nothing more.
 *
 * Owns: the view tabs (URL-backed), the status line, the states of §11, the
 * live announcements of §13.5, the focus rules of §13.4 and the mobile sheet.
 * Owns NOT: any Work fact (§2.1).
 */
import { RefreshCw } from "lucide-react";
import { useTranslate } from "ra-core";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
} from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { WorkScope } from "../application/queries/getWorkItems";
import { isNoraDemoMode } from "../misc/noraDemoMode";
import {
  formatBerlinClock,
  formatStand,
  isSameBerlinDay,
} from "./berlinCalendar";
import { useArbeitskorbSicht } from "./useArbeitskorbSicht";
import { useDelayedFlag } from "./useDelayedFlag";
import { useLiveAnnouncer } from "./useLiveAnnouncer";
import { useWorkContextNames } from "./useWorkContextNames";
import { useWorkItems, type WorkItemsErrorPhase } from "./useWorkItems";
import {
  revalidationOutcome,
  snapshotSignature,
  successAnnouncement,
} from "./workAnnouncements";
import { WorkList, type WorkListVariant } from "./WorkList";
import {
  presentationGroups,
  summarizeWork,
  toWorkRowView,
  type WorkRowView,
} from "./workRowView";
import { WorkSheet } from "./WorkSheet";

type Phase =
  | "loading"
  | "denied-loading"
  | "identity-error"
  | "denied"
  | "error"
  | "offline-empty"
  | "data";

const SCOPES: WorkScope[] = ["mine", "team"];

export const ArbeitskorbSurface = ({
  variant,
}: {
  variant: WorkListVariant;
}) => {
  const translate = useTranslate();
  const { scope, setScope } = useArbeitskorbSicht();
  const work = useWorkItems(scope);
  const names = useWorkContextNames(work.items);
  const { polite, alert, say } = useLiveAnnouncer();

  const complete = work.items !== undefined && !work.hasNextPage;
  const rows = useMemo(
    () => work.items?.map((item) => toWorkRowView(item, scope)),
    [work.items, scope],
  );
  const groups = useMemo(() => (rows ? presentationGroups(rows) : []), [rows]);
  const offline = !work.isOnline || work.isPaused;

  const phase: Phase = work.identityError
    ? "identity-error"
    : work.isDenied
      ? "denied"
      : work.items !== undefined
        ? "data"
        : work.error
          ? "error"
          : offline
            ? "offline-empty"
            : work.isDeniedRevalidation
              ? "denied-loading"
              : "loading";

  const now = Date.now();
  const stand =
    work.dataUpdatedAt > 0 ? formatStand(work.dataUpdatedAt, now) : null;

  // --- focus targets -------------------------------------------------------
  const panels = useRef<Record<WorkScope, HTMLDivElement | null>>({
    mine: null,
    team: null,
  });
  const teamTab = useRef<HTMLButtonElement>(null);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const focusPanel = useCallback(() => {
    panels.current[scopeRef.current]?.focus();
  }, []);
  const focusRow = useCallback((workId: string) => {
    const target = panels.current[scopeRef.current]?.querySelector<HTMLElement>(
      `[data-work-focus="${CSS.escape(workId)}"]`,
    );
    target?.focus();
    return target != null;
  }, []);

  /**
   * §13.4: a vanished focused row hands focus to the next row, else the
   * previous one, else the tab panel.
   */
  const order = useMemo(
    () => work.items?.map((item) => item.workId) ?? [],
    [work.items],
  );
  const previousOrder = useRef<string[]>([]);
  const focusRowOrNeighbour = useCallback(
    (workId: string, oldOrder: string[]) => {
      if (focusRow(workId)) return;
      const index = oldOrder.indexOf(workId);
      for (let next = index + 1; index >= 0 && next < oldOrder.length; next++) {
        if (focusRow(oldOrder[next])) return;
      }
      for (let previous = index - 1; previous >= 0; previous--) {
        if (focusRow(oldOrder[previous])) return;
      }
      focusPanel();
    },
    [focusPanel, focusRow],
  );

  /** The focused element inside a row, as long as focus stays there. */
  const lastFocusedRow = useRef<{
    workId: string;
    element: HTMLElement;
  } | null>(null);
  /** Any focused element inside the tab panel (rows, state controls, "Weitere laden"). */
  const lastFocusedInPanel = useRef<HTMLElement | null>(null);
  const onFocusIn = (event: FocusEvent<HTMLElement>) => {
    const element = event.target as HTMLElement;
    lastFocusedInPanel.current = element;
    const row = element.closest<HTMLElement>("[data-work-id]");
    lastFocusedRow.current = row?.dataset.workId
      ? { workId: row.dataset.workId, element }
      : null;
  };
  const onFocusOut = (event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && !event.currentTarget.contains(next)) {
      lastFocusedRow.current = null;
      lastFocusedInPanel.current = null;
      return;
    }
    if (!next) {
      // Focus went to the page itself. If the element is still there, the
      // user left the list (e.g. clicked plain text) — never pull focus back.
      // If it was removed by a re-render, the layout effect below hands focus
      // on first (it runs within the same commit, before this check).
      const left = lastFocusedRow.current;
      const leftElement = event.target as HTMLElement;
      queueMicrotask(() => {
        if (!leftElement.isConnected) return;
        if (lastFocusedRow.current === left) lastFocusedRow.current = null;
        if (lastFocusedInPanel.current === leftElement) {
          lastFocusedInPanel.current = null;
        }
      });
    }
  };

  useLayoutEffect(() => {
    const active = document.activeElement;
    const lost = !active || active === document.body;
    const focused = lastFocusedRow.current;
    // §13.4: only a focused element that disappeared hands focus on.
    if (lost && focused !== null && !focused.element.isConnected) {
      lastFocusedRow.current = null;
      if (phase === "data") {
        focusRowOrNeighbour(focused.workId, previousOrder.current);
      } else {
        focusPanel();
      }
    }
    previousOrder.current = order;
    // Runs when the delivered sequence or the state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, phase]);

  // A refusal removes the list: focus that was in it goes to the tab panel.
  useEffect(() => {
    if (phase !== "denied") return;
    const active = document.activeElement;
    const panel = panels.current[scopeRef.current];
    const lost = !active || active === document.body;
    const vanished = lastFocusedInPanel.current?.isConnected === false;
    if (panel?.contains(active) || (lost && vanished)) focusPanel();
  }, [phase, focusPanel]);

  // --- announcements (§13.5) ----------------------------------------------
  const manualRefresh = useRef(false);
  const manualRetry = useRef(false);
  const loadMoreFrom = useRef<number | null>(null);
  const lastSignature = useRef<string | null>(null);
  const lastErrorPhase = useRef<WorkItemsErrorPhase | null>(null);
  const [retryFailedAt, setRetryFailedAt] = useState<number | null>(null);
  /** First row index appended by the last "Weitere laden" (M4 fade-in). */
  const [appendedFrom, setAppendedFrom] = useState<number | null>(null);

  // R2-29: only a plain first load is announced as loading. A previously
  // denied entry that revalidates shows the first-load look silently.
  const loadingTooLong = useDelayedFlag(phase === "loading", 1000);
  useEffect(() => {
    if (loadingTooLong) say("polite", translate("crm.work.states.loading"));
  }, [loadingTooLong, say, translate]);

  useEffect(() => {
    lastSignature.current = null;
    setRetryFailedAt(null);
  }, [scope]);

  useEffect(() => {
    if (work.items === undefined || work.dataUpdatedAt === 0) {
      lastSignature.current = null;
      return;
    }
    const signature = snapshotSignature(work.items, complete);
    const summary = successAnnouncement(translate, scope, work.items, complete);
    if (loadMoreFrom.current !== null) {
      const from = loadMoreFrom.current;
      const added = work.items.length - from;
      loadMoreFrom.current = null;
      setAppendedFrom(added > 0 ? from : null);
      if (added > 0) {
        say(
          "polite",
          translate("crm.work.announce.more_loaded", { smart_count: added }),
        );
        // §13.4: focus the first appended row.
        const firstNew = work.items[from]?.workId;
        if (firstNew) requestAnimationFrame(() => focusRow(firstNew));
      }
    } else if (lastSignature.current === null) {
      setAppendedFrom(null);
      say("polite", summary);
    } else {
      setAppendedFrom(null);
      const outcome = revalidationOutcome(
        lastSignature.current,
        signature,
        manualRefresh.current,
      );
      if (outcome === "changed") {
        say("polite", `${translate("crm.work.announce.updated")} ${summary}`);
      } else if (outcome === "unchanged-manual") {
        say("polite", translate("crm.work.announce.updated_none"));
      }
    }
    manualRefresh.current = false;
    lastSignature.current = signature;
    setRetryFailedAt(null);
    // Announce per settled snapshot only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work.dataUpdatedAt, work.items]);

  useEffect(() => {
    const error = work.error;
    if (!error) {
      lastErrorPhase.current = null;
      return;
    }
    if (error.reason === "permission_denied") {
      say("alert", translate("crm.work.states.denied"));
    } else if (work.errorPhase === "initial") {
      if (!manualRetry.current) {
        if (error.reason === "unavailable" && isNoraDemoMode) {
          say("polite", translate("crm.work.states.demo"));
        } else {
          say(
            "alert",
            translate(
              error.reason === "unavailable"
                ? "crm.work.states.unavailable"
                : "crm.work.states.failed",
            ),
          );
        }
      }
    } else if (work.errorPhase === "refresh") {
      if (manualRefresh.current || lastErrorPhase.current !== "refresh") {
        say(
          "polite",
          translate("crm.work.announce.refresh_failed", { stand: stand ?? "" }),
        );
      }
    } else if (work.errorPhase === "next-page") {
      loadMoreFrom.current = null;
      say("polite", translate("crm.work.load_more_failed"));
    }
    manualRefresh.current = false;
    manualRetry.current = false;
    lastErrorPhase.current = work.errorPhase;
    // One announcement per failure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work.errorUpdatedAt, work.error]);

  useEffect(() => {
    if (phase === "identity-error" && !manualRetry.current) {
      say("alert", translate("crm.work.states.failed"));
    }
  }, [phase, say, translate]);

  const offlineWithData = phase === "data" && offline;
  useEffect(() => {
    if (offlineWithData) {
      say(
        "polite",
        translate("crm.work.announce.offline_data", { stand: stand ?? "" }),
      );
    }
    // Only the transition into offline is announced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offlineWithData]);

  useEffect(() => {
    if (phase === "offline-empty") {
      say("polite", translate("crm.work.states.offline_empty"));
    }
  }, [phase, say, translate]);

  useEffect(() => {
    if (names.failedAt > 0) say("polite", translate("crm.work.names_failed"));
  }, [names.failedAt, say, translate]);

  // --- actions -------------------------------------------------------------
  // No refresh without a resolved identity (§5.2), and none that would only
  // join a running "Weitere laden" instead of restarting at page 1.
  const refreshBlocked =
    work.isIdentityPending ||
    work.identityError != null ||
    work.isFetchingNextPage;
  const onRefresh = async () => {
    if (refreshBlocked) return;
    manualRefresh.current = true;
    await work.refresh();
  };

  const onRetry = async () => {
    manualRetry.current = true;
    const result = await work.retry();
    if (result.ok) {
      manualRetry.current = false;
      setRetryFailedAt(null);
      focusPanel();
      return;
    }
    if (result.error?.reason === "permission_denied") return;
    const at = Date.now();
    setRetryFailedAt(at);
    say(
      "alert",
      translate("crm.work.states.failed_again", {
        time: formatBerlinClock(at),
      }),
    );
  };

  const onLoadMore = async () => {
    if (work.isFetching || !work.hasNextPage) return;
    loadMoreFrom.current = work.items?.length ?? 0;
    const result = await work.loadMore();
    if (!result.ok && result.error === null) loadMoreFrom.current = null;
  };

  const onShowTeam = () => {
    setScope("team");
    teamTab.current?.focus();
  };

  const onNamesRetry = async () => {
    const results = (await names.retry()) as ({ status: string } | undefined)[];
    if (results.every((result) => !result || result.status === "success")) {
      focusPanel();
    }
  };

  // --- mobile sheet --------------------------------------------------------
  const [sheetWorkId, setSheetWorkId] = useState<string | null>(null);
  const lastSeenRow = useRef<WorkRowView | null>(null);
  /** The sequence in which the sheet's row was last seen (neighbour rule). */
  const lastSeenOrder = useRef<string[]>([]);
  const sheetFocus = useRef<"row" | "panel">("row");
  const currentSheetRow =
    sheetWorkId !== null && rows
      ? (rows.find((row) => row.workId === sheetWorkId) ?? null)
      : null;
  if (currentSheetRow) {
    lastSeenRow.current = currentSheetRow;
    lastSeenOrder.current = order;
  }
  // Render invariant (§5.4): outside the data state the sheet shows nothing.
  const sheetRow =
    phase === "data" && sheetWorkId !== null
      ? (currentSheetRow ?? lastSeenRow.current)
      : null;

  useEffect(() => {
    if (phase !== "data" && sheetWorkId !== null) {
      sheetFocus.current = "panel";
      setSheetWorkId(null);
    }
  }, [phase, sheetWorkId]);
  useEffect(() => {
    setSheetWorkId(null);
  }, [scope]);

  const onOpenRow = (workId: string) => {
    lastSeenRow.current = rows?.find((row) => row.workId === workId) ?? null;
    lastSeenOrder.current = order;
    sheetFocus.current = "row";
    setSheetWorkId(workId);
  };
  const closingWorkId = useRef<string | null>(null);
  const onCloseSheet = () => {
    closingWorkId.current = sheetWorkId;
    setSheetWorkId(null);
  };
  const onSheetCloseAutoFocus = (event: Event) => {
    event.preventDefault();
    const workId = closingWorkId.current ?? lastSeenRow.current?.workId;
    if (sheetFocus.current === "panel" || !workId) focusPanel();
    else focusRowOrNeighbour(workId, lastSeenOrder.current);
    closingWorkId.current = null;
  };

  // --- render --------------------------------------------------------------
  const isRefreshing =
    phase === "data" && work.isFetching && !work.isFetchingNextPage;
  const statusText =
    phase !== "data" || stand === null
      ? null
      : isRefreshing
        ? translate("crm.work.status.updating")
        : offline
          ? translate("crm.work.status.offline", { stand })
          : work.errorPhase === "refresh"
            ? translate("crm.work.status.refresh_failed", { stand })
            : !isSameBerlinDay(work.dataUpdatedAt, now)
              ? translate("crm.work.status.outdated", { stand })
              : translate("crm.work.status.stand", { stand });

  const isLoadingPhase = phase === "loading" || phase === "denied-loading";
  const showSkeleton = useDelayedFlag(isLoadingPhase, 300);

  const header = (
    <>
      <TabsList
        aria-label={translate("crm.work.views.label")}
        className={cn(
          "nora-arbeitskorb-tabs relative grid h-auto grid-cols-2 p-[3px]",
          variant === "mobile" ? "w-full" : "w-full sm:w-80",
        )}
        data-selected={scope}
      >
        <span aria-hidden="true" className="nora-arbeitskorb-tab-indicator" />
        {SCOPES.map((value) => (
          <TabsTrigger
            key={value}
            value={value}
            ref={value === "team" ? teamTab : undefined}
            className="relative z-10 h-11 min-h-11 data-[state=active]:bg-transparent data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent"
          >
            {translate(
              value === "mine" ? "crm.work.views.mine" : "crm.work.views.team",
            )}
          </TabsTrigger>
        ))}
      </TabsList>
      <div className="flex min-h-11 items-center justify-between gap-2">
        <p className="text-sm text-[var(--nora-text-muted)]">{statusText}</p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="nora-touch-target shrink-0"
          aria-label={translate("crm.work.refresh")}
          aria-disabled={refreshBlocked ? "true" : undefined}
          onClick={onRefresh}
        >
          <RefreshCw
            aria-hidden="true"
            className={cn("size-4", isRefreshing && "animate-spin")}
          />
        </Button>
      </div>
    </>
  );

  const loadMoreErrorId = `arbeitskorb-weitere-fehler-${scope}`;
  const loadMoreFailed =
    work.errorPhase === "next-page" &&
    work.error?.reason !== "permission_denied";

  const body = (() => {
    switch (phase) {
      case "loading":
      case "denied-loading":
        return (
          <div aria-busy="true" className="min-h-40">
            {showSkeleton ? <SkeletonRows /> : null}
          </div>
        );
      case "identity-error":
        return (
          <StatePanel>
            <p>{translate("crm.work.states.failed")}</p>
            <RetryBlock
              onRetry={onRetry}
              failedAt={retryFailedAt}
              busy={work.isFetching}
            />
          </StatePanel>
        );
      case "denied":
        return (
          <StatePanel>
            <p>{translate("crm.work.states.denied")}</p>
            <Button asChild variant="outline" className="min-h-11 self-start">
              <Link to="/">{translate("crm.work.states.home")}</Link>
            </Button>
          </StatePanel>
        );
      case "error": {
        const error = work.error!;
        if (error.reason === "unavailable" && isNoraDemoMode) {
          return (
            <StatePanel>
              <p>{translate("crm.work.states.demo")}</p>
            </StatePanel>
          );
        }
        return (
          <StatePanel>
            <p>
              {translate(
                error.reason === "unavailable"
                  ? "crm.work.states.unavailable"
                  : "crm.work.states.failed",
              )}
            </p>
            {error.reason !== "unavailable" ? (
              <p className="text-xs text-[var(--nora-text-muted)]">
                {translate("crm.work.states.code", {
                  code: [error.reason, error.code].filter(Boolean).join(" · "),
                })}
              </p>
            ) : null}
            <RetryBlock
              onRetry={onRetry}
              failedAt={retryFailedAt}
              busy={work.isFetching}
            />
          </StatePanel>
        );
      }
      case "offline-empty":
        return (
          <StatePanel>
            <p>{translate("crm.work.states.offline_empty")}</p>
          </StatePanel>
        );
      case "data": {
        const items = work.items!;
        if (complete && items.length === 0) {
          return (
            <StatePanel className="nora-arbeitskorb-rise">
              <p>
                {translate(
                  scope === "mine"
                    ? "crm.work.states.empty_mine"
                    : "crm.work.states.empty_team",
                )}
              </p>
              {scope === "mine" ? (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 self-start"
                  onClick={onShowTeam}
                >
                  {translate("crm.work.states.show_team")}
                </Button>
              ) : null}
            </StatePanel>
          );
        }
        return (
          <div className="nora-arbeitskorb-rise flex flex-col gap-3">
            <WorkSummaryLine items={items} complete={complete} />
            <WorkList
              groups={groups}
              scope={scope}
              variant={variant}
              names={names}
              appendedFrom={appendedFrom}
              onOpenRow={onOpenRow}
            />
            {complete ? (
              <p className="px-1 text-sm text-[var(--nora-text-muted)]">
                {translate("crm.work.list_end", { smart_count: items.length })}
              </p>
            ) : (
              <div className="flex flex-col items-start gap-2">
                {loadMoreFailed ? (
                  <p id={loadMoreErrorId} className="text-sm">
                    {translate("crm.work.load_more_failed")}
                  </p>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  aria-disabled={work.isFetching ? "true" : undefined}
                  aria-describedby={
                    loadMoreFailed ? loadMoreErrorId : undefined
                  }
                  onClick={onLoadMore}
                >
                  {translate("crm.work.load_more")}
                </Button>
              </div>
            )}
          </div>
        );
      }
    }
  })();

  return (
    <div
      data-arbeitskorb=""
      className="flex w-full max-w-[55rem] flex-col gap-3"
    >
      {variant === "desktop" ? (
        <h1 className="text-2xl font-semibold tracking-tight">
          {translate("crm.work.page_title")}
        </h1>
      ) : null}
      <Tabs
        value={scope}
        onValueChange={(value) => setScope(value as WorkScope)}
        className="gap-3"
      >
        {variant === "desktop" ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            {header}
          </div>
        ) : (
          <div className="flex flex-col gap-2">{header}</div>
        )}
        {names.failed && phase === "data" ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2 text-sm">
            <p>{translate("crm.work.names_failed")}</p>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 px-2"
              onClick={onNamesRetry}
            >
              {translate("crm.work.retry")}
            </Button>
          </div>
        ) : null}
        {SCOPES.map((value) => (
          <TabsContent
            key={value}
            value={value}
            ref={(element) => {
              panels.current[value] = element;
            }}
            onFocusCapture={onFocusIn}
            onBlurCapture={onFocusOut}
            className="rounded-md focus-visible:ring-2 focus-visible:ring-[var(--nora-brand-ring)]"
          >
            {value === scope ? body : null}
          </TabsContent>
        ))}
      </Tabs>
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-arbeitskorb-live="polite"
      >
        {polite ? <span key={polite.nonce}>{polite.text}</span> : null}
      </div>
      <div
        className="sr-only"
        role="alert"
        aria-atomic="true"
        data-arbeitskorb-live="alert"
      >
        {alert ? <span key={alert.nonce}>{alert.text}</span> : null}
      </div>
      {variant === "mobile" ? (
        <WorkSheet
          row={sheetRow}
          keepOnClose={phase === "data"}
          vanished={sheetRow !== null && currentSheetRow === null}
          names={names}
          onClose={onCloseSheet}
          onCloseAutoFocus={onSheetCloseAutoFocus}
        />
      ) : null}
    </div>
  );
};

const StatePanel = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "flex flex-col gap-3 rounded-md border border-border bg-card px-4 py-4 text-sm",
      className,
    )}
  >
    {children}
  </div>
);

const RetryBlock = ({
  onRetry,
  failedAt,
  busy,
}: {
  onRetry: () => void;
  failedAt: number | null;
  busy: boolean;
}) => {
  const translate = useTranslate();
  return (
    <div className="flex flex-col items-start gap-2">
      {failedAt !== null ? (
        <p className="text-sm text-[var(--nora-text-muted)]">
          {translate("crm.work.states.failed_again", {
            time: formatBerlinClock(failedAt),
          })}
        </p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        aria-disabled={busy ? "true" : undefined}
        onClick={() => {
          if (!busy) onRetry();
        }}
      >
        <RefreshCw
          aria-hidden="true"
          className={cn("size-4", busy && "animate-spin")}
        />
        {translate("crm.work.retry")}
      </Button>
    </div>
  );
};

/** §6.6 — text only, counts from flags, a total only over a complete set. */
const WorkSummaryLine = ({
  items,
  complete,
}: {
  items: Parameters<typeof summarizeWork>[0];
  complete: boolean;
}) => {
  const translate = useTranslate();
  const summary = summarizeWork(items, complete);
  if (!summary.complete) {
    return (
      <p className="px-1 text-sm text-[var(--nora-text-muted)]">
        {translate("crm.work.summary.partial", {
          smart_count: summary.loaded,
        })}
      </p>
    );
  }
  const parts: string[] = [];
  if (summary.overdue > 0) {
    parts.push(
      translate("crm.work.summary.overdue", { count: summary.overdue }),
    );
  }
  if (summary.today > 0) {
    parts.push(translate("crm.work.summary.today", { count: summary.today }));
  }
  parts.push(translate("crm.work.summary.open", { count: summary.total }));
  return (
    <p className="px-1 text-sm text-[var(--nora-text-muted)]">
      {parts.join(" · ")}
    </p>
  );
};

/** Static placeholders — no pulse, no decorative animation (§12). */
const SkeletonRows = () => (
  <div aria-hidden="true" className="flex flex-col gap-2 py-1">
    {[0, 1, 2, 3].map((index) => (
      <div key={index} className="flex flex-col gap-1.5 rounded-md px-3 py-2.5">
        <div className="h-4 w-2/3 rounded bg-muted" />
        <div className="h-3 w-1/3 rounded bg-muted" />
      </div>
    ))}
  </div>
);
