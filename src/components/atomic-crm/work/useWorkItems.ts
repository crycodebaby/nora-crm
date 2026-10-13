/**
 * Arbeitskorb query orchestration (Alpha UI 2, docs/nora/26 §5).
 *
 *   UI → useWorkItems (here) → getWorkItems (Application) → WorkItemsReader
 *     → configured CrmDataProvider → Work infrastructure adapter
 *
 * This hook is orchestration only — cache key, pagination, refresh,
 * lifecycle/freshness and query status. It is NOT an Application or Domain
 * layer: it never filters, sorts, deduplicates or classifies Work, never
 * builds or reads a cursor, never names an actor, and never turns a failure
 * into an empty list. Future consumers (MCP) call `getWorkItems`, not this.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { useDataProvider, useGetIdentity, type Identifier } from "ra-core";
import {
  hashKey,
  onlineManager,
  useInfiniteQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import {
  getWorkItems,
  isWorkQueryError,
  WorkQueryError,
  type WorkItem,
  type WorkItemsCursor,
  type WorkScope,
} from "../application/queries/getWorkItems";
import type { CrmDataProvider } from "../providers/types";
import {
  DAY_CHANGE_GRACE_MS,
  isSameBerlinDay,
  nextBerlinMidnight,
} from "./berlinCalendar";
import {
  WORK_ITEMS_PAGE_SIZE,
  workItemsIdentityPrefix,
  workItemsQueryKey,
} from "./workItemsQueryKey";

/** Frozen freshness policy (docs/nora/26 §5.3). */
export const WORK_ITEMS_FRESHNESS = {
  staleTime: 30_000,
  gcTime: 300_000,
  refetchOnMount: "always",
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
  networkMode: "online",
  retry: false,
} as const;

/**
 * Per-key denial marker (docs/nora/26 §5.4): set when the authority refuses
 * a key with `permission_denied`, cleared only by a later success. It lets
 * the surface tell "a denied entry is revalidating" from a plain first load
 * (no extra loading announcement). Scoped to the QueryClient, so it dies
 * with the Admin's cache; it never holds Work data.
 */
const deniedKeysByClient = new WeakMap<QueryClient, Set<string>>();
const deniedKeys = (client: QueryClient): Set<string> => {
  let keys = deniedKeysByClient.get(client);
  if (!keys) {
    keys = new Set();
    deniedKeysByClient.set(client, keys);
  }
  return keys;
};

const subscribeOnline = (onChange: () => void) =>
  onlineManager.subscribe(onChange);
const getOnline = () => onlineManager.isOnline();

export type WorkItemsErrorPhase = "initial" | "refresh" | "next-page";

export type WorkItemsState = {
  scope: WorkScope;
  /** Identity of the signed-in employee is still being resolved. */
  isIdentityPending: boolean;
  /** The signed-in identity could not be resolved — a load error, never empty. */
  identityError: unknown;
  /**
   * The loaded snapshot in delivery order (pages concatenated, rows as
   * delivered), or `undefined` when there is nothing that may be shown.
   * After a `permission_denied` it is `undefined` until a later success.
   */
  items: WorkItem[] | undefined;
  /** Number of loaded pages of the shown snapshot (0 without snapshot). */
  pageCount: number;
  /** `true` exactly while the last loaded page has a non-null `nextCursor`. */
  hasNextPage: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  /** A fetch is waiting for the network (`networkMode: "online"`). */
  isPaused: boolean;
  isOnline: boolean;
  /** The current failure, always a WorkQueryError (never an empty list). */
  error: WorkQueryError | null;
  errorPhase: WorkItemsErrorPhase | null;
  errorUpdatedAt: number;
  /** The authority refused this key; no row from before the refusal is shown. */
  isDenied: boolean;
  /** A previously denied key is being fetched again (first-load look, no new announcement). */
  isDeniedRevalidation: boolean;
  /** Instant of the last successful fetch of the shown snapshot, `0` without one. */
  dataUpdatedAt: number;
  /** Manual "Aktualisieren". */
  refresh: () => Promise<WorkActionResult>;
  /** "Erneut versuchen" (first-load error or unresolved identity). */
  retry: () => Promise<WorkActionResult>;
  /** "Weitere laden"; a no-op (`ok: false`, no error) while any fetch of the list runs. */
  loadMore: () => Promise<WorkActionResult>;
};

/** Outcome of a user-triggered fetch; `error` is set only for a real failure. */
export type WorkActionResult = { ok: boolean; error: WorkQueryError | null };

const outcome = (result: {
  status: string;
  error: unknown;
}): WorkActionResult =>
  result.status === "success" && result.error == null
    ? { ok: true, error: null }
    : { ok: false, error: toWorkQueryError(result.error) };

/**
 * permission_denied: drop the shown entry's data WITHOUT removing the entry —
 * removing it would immediately refetch and loop (docs/nora/26 §5.4) — and
 * reset `dataUpdatedAt` with it (R3-19), so no "Stand" or day-change logic
 * can still read the refused snapshot.
 */
const dropRefusedSnapshot = (
  queryClient: QueryClient,
  queryKey: readonly unknown[],
) => {
  const entry = queryClient.getQueryCache().find({ queryKey, exact: true });
  const error = entry?.state.error;
  if (
    entry &&
    isWorkQueryError(error) &&
    error.reason === "permission_denied" &&
    entry.state.data !== undefined
  ) {
    entry.setState({ data: undefined, dataUpdatedAt: 0 });
  }
};

const toWorkQueryError = (error: unknown): WorkQueryError | null => {
  if (error == null) return null;
  if (isWorkQueryError(error)) return error;
  return new WorkQueryError("failed", "the Arbeitskorb query failed", {
    cause: error,
  });
};

export const useWorkItems = (scope: WorkScope): WorkItemsState => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const {
    identity,
    isPending: isIdentityPending,
    error: identityError,
    refetch: refetchIdentity,
  } = useGetIdentity();

  const identityPartition: Identifier | null = identity?.id ?? null;
  const queryKey = workItemsQueryKey(identityPartition ?? "", scope);
  const queryHash = hashKey(queryKey);

  const query = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam }) => {
      try {
        return await getWorkItems(dataProvider, {
          scope,
          stateScope: "open",
          pageSize: WORK_ITEMS_PAGE_SIZE,
          cursor: pageParam,
        });
      } catch (error) {
        if (isWorkQueryError(error) && error.reason === "permission_denied") {
          deniedKeys(queryClient).add(queryHash);
        }
        throw error;
      }
    },
    initialPageParam: null as WorkItemsCursor | null,
    // The cursor is handed back exactly as delivered; `null` ends the list.
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: identityPartition != null,
    ...WORK_ITEMS_FRESHNESS,
  });

  const error = toWorkQueryError(query.error);
  const isDenied = error?.reason === "permission_denied";

  // permission_denied: drop the refused snapshot and discard the inactive
  // entries of this identity (the other view).
  useEffect(() => {
    if (!isDenied || identityPartition == null) return;
    dropRefusedSnapshot(queryClient, queryKey);
    queryClient.removeQueries({
      queryKey: workItemsIdentityPrefix(identityPartition),
      type: "inactive",
    });
    // queryKey is fully described by queryHash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDenied, query.errorUpdatedAt, queryHash, queryClient]);

  const isSettledSuccess = query.status === "success" && !query.isFetching;
  useEffect(() => {
    if (isSettledSuccess) deniedKeys(queryClient).delete(queryHash);
  }, [isSettledSuccess, query.dataUpdatedAt, queryClient, queryHash]);

  // A view switch revalidates a view that is served from its own cache entry
  // (docs/nora/26 §5.2); a never-loaded or denied entry fetches by itself.
  const previousScope = useRef(scope);
  const { refetch } = query;
  useEffect(() => {
    if (previousScope.current === scope) return;
    previousScope.current = scope;
    if (query.data !== undefined && !query.isFetching) {
      void refetch({ cancelRefetch: false });
    }
    // Only a scope change triggers this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  useBerlinDayRevalidation(
    queryClient,
    queryKey,
    queryHash,
    query.dataUpdatedAt,
  );

  const isOnline = useSyncExternalStore(subscribeOnline, getOnline, getOnline);

  const items = useMemo(
    () =>
      isDenied || query.data === undefined
        ? undefined
        : query.data.pages.flatMap((page) => page.items),
    [isDenied, query.data],
  );

  const errorPhase: WorkItemsErrorPhase | null =
    error == null
      ? null
      : query.isFetchNextPageError
        ? "next-page"
        : items !== undefined
          ? "refresh"
          : "initial";

  const { fetchNextPage, hasNextPage, isFetching } = query;

  // A revalidation of a refused entry must start from "no snapshot", even when
  // it is triggered before the denial effect above has run.
  const refresh = useCallback(async () => {
    dropRefusedSnapshot(queryClient, queryKey);
    return outcome(await refetch({ cancelRefetch: false }));
    // queryKey is fully described by queryHash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, queryHash, refetch]);

  const retry = useCallback(async () => {
    if (identityError) {
      const result = await refetchIdentity();
      return result.status === "success"
        ? { ok: true, error: null }
        : { ok: false, error: toWorkQueryError(result.error) };
    }
    return refresh();
  }, [identityError, refetchIdentity, refresh]);

  const loadMore = useCallback(async () => {
    // Never during any running fetch of the list: a load-more must not cancel
    // a revalidation and append to old pages (docs/nora/26 §8). With
    // `cancelRefetch: false` a second activation joins the first one.
    if (isFetching || !hasNextPage) return { ok: false, error: null };
    return outcome(await fetchNextPage({ cancelRefetch: false }));
  }, [fetchNextPage, hasNextPage, isFetching]);

  return {
    scope,
    isIdentityPending: identityPartition == null && isIdentityPending,
    identityError: identityPartition == null ? (identityError ?? null) : null,
    items,
    pageCount: items === undefined ? 0 : (query.data?.pages.length ?? 0),
    hasNextPage: items !== undefined && hasNextPage,
    isFetching,
    isFetchingNextPage: query.isFetchingNextPage,
    isPaused: query.isPaused,
    isOnline,
    error,
    errorPhase,
    errorUpdatedAt: query.errorUpdatedAt,
    isDenied,
    isDeniedRevalidation:
      !isDenied && query.isFetching && deniedKeys(queryClient).has(queryHash),
    dataUpdatedAt: items === undefined ? 0 : query.dataUpdatedAt,
    refresh,
    retry,
    loadMore,
  };
};

/**
 * Berlin day change (docs/nora/26 §5.5): if the Berlin calendar day of the
 * last successful fetch differs from today's, invalidate the key — checked on
 * focus, on `visibilitychange` and by one timer at the next Berlin midnight
 * plus 2 minutes. Compares two clock instants only, never a row.
 */
const useBerlinDayRevalidation = (
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  queryHash: string,
  dataUpdatedAt: number,
) => {
  const invalidatedFor = useRef<string | null>(null);

  useEffect(() => {
    if (dataUpdatedAt <= 0) return;

    const check = () => {
      const now = Date.now();
      if (isSameBerlinDay(dataUpdatedAt, now)) return;
      // Once per (snapshot, day): focus and timer may both fire.
      const marker = `${queryHash}|${dataUpdatedAt}`;
      if (invalidatedFor.current === marker) return;
      invalidatedFor.current = marker;
      void queryClient.invalidateQueries(
        { queryKey, exact: true },
        { cancelRefetch: false },
      );
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") check();
    };
    const delay = Math.max(
      0,
      nextBerlinMidnight(dataUpdatedAt) + DAY_CHANGE_GRACE_MS - Date.now(),
    );
    const timer = window.setTimeout(check, delay);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // queryKey is fully described by queryHash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataUpdatedAt, queryClient, queryHash]);
};
