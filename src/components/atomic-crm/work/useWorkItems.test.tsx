import { render } from "vitest-browser-react";
import { CoreAdminContext, memoryStore } from "ra-core";
import { MemoryRouter } from "react-router";
import { QueryClient } from "@tanstack/react-query";

import type { WorkScope } from "../application/queries/getWorkItems";
import { createDataProvider } from "../providers/fakerest";
import { createCrmDb } from "@/test/StoryWrapper";
import {
  buildWorkItem,
  createControlledReader,
  createSwitchableAuthProvider,
  cursor,
} from "./testing/workTestKit";
import { useWorkItems, type WorkItemsState } from "./useWorkItems";
import { workItemsQueryKey } from "./workItemsQueryKey";

/**
 * D1 — query seam (docs/nora/26 §5, AC-02/06/07/09/17/18). Level I: the real
 * ra-core Admin context and QueryClient, the real `getWorkItems`
 * Application query, the real hook; only the Work transport is stubbed.
 */

const Probe = ({
  scope,
  onState,
}: {
  scope: WorkScope;
  onState: (state: WorkItemsState) => void;
}) => {
  onState(useWorkItems(scope));
  return null;
};

const setup = async ({
  identity = 7 as number | Error,
  scope = "mine" as WorkScope,
} = {}) => {
  const work = createControlledReader();
  const auth = createSwitchableAuthProvider(identity);
  const queryClient = new QueryClient();
  const dataProvider = {
    ...createDataProvider({ db: createCrmDb({}), silent: true }),
    getWorkItems: work.reader.getWorkItems,
  };
  let latest: WorkItemsState | undefined;
  const Tree = ({ scope }: { scope: WorkScope }) => (
    <MemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        authProvider={auth.authProvider}
        queryClient={queryClient}
        store={memoryStore()}
      >
        <Probe scope={scope} onState={(state) => (latest = state)} />
      </CoreAdminContext>
    </MemoryRouter>
  );
  const screen = await render(<Tree scope={scope} />);
  const state = () => {
    if (!latest) throw new Error("hook not rendered");
    return latest;
  };
  const ids = () => state().items?.map((item) => item.workId);
  return {
    work,
    auth,
    queryClient,
    state,
    ids,
    setScope: (next: WorkScope) => screen.rerender(<Tree scope={next} />),
    waitForRequests: (count: number) =>
      expect.poll(() => work.calls.length).toBe(count),
  };
};

describe("useWorkItems — Application boundary and request shape", () => {
  it("sends exactly { scope, stateScope: open, pageSize: 50, cursor: null } and no actor", async () => {
    const t = await setup({ identity: 7 });
    await t.waitForRequests(1);
    expect(t.work.requests()[0]).toStrictEqual({
      scope: "mine",
      stateScope: "open",
      pageSize: 50,
      cursor: null,
    });
    // The identity partitions the cache only; it never travels with the request.
    expect(JSON.stringify(t.work.requests())).not.toMatch(/sales|actor|\b7\b/);
    expect(
      t.queryClient.getQueryCache().find({
        queryKey: workItemsQueryKey(7, "mine"),
        exact: true,
      }),
    ).toBeDefined();
  });

  it("does not query before the identity is resolved, and reports an unresolvable identity as an error", async () => {
    const t = await setup({ identity: new Error("no identity") });
    // ra-core's identity query keeps its default retries (~7 s) — slow, but
    // it ends in an error, never in an endless skeleton or an empty list.
    await expect
      .poll(() => t.state().identityError, { timeout: 15_000 })
      .toBeTruthy();
    expect(t.work.calls).toHaveLength(0);
    expect(t.state().items).toBeUndefined();
  });

  it("applies the frozen freshness policy to the Work query", async () => {
    const t = await setup();
    await t.waitForRequests(1);
    const entry = t.queryClient
      .getQueryCache()
      .find({ queryKey: workItemsQueryKey(7, "mine"), exact: true });
    const options = entry!.options as Record<string, unknown>;
    expect(options.staleTime).toBe(30_000);
    expect(options.gcTime).toBe(300_000);
    expect(options.retry).toBe(false);
    expect(options.networkMode).toBe("online");
    expect(options.refetchInterval).toBeUndefined();
    const observer = entry!.observers[0].options as unknown as Record<
      string,
      unknown
    >;
    expect(observer.refetchOnMount).toBe("always");
    expect(observer.refetchOnWindowFocus).toBe(true);
    expect(observer.refetchOnReconnect).toBe(true);
  });
});

describe("useWorkItems — pagination", () => {
  it("hands the opaque cursor through unchanged, keeps delivery order and ends exactly at nextCursor === null", async () => {
    const t = await setup();
    const p1 = [buildWorkItem(), buildWorkItem()];
    const p2 = [buildWorkItem()];
    const opaque = cursor("opaque/äö+=%cursor");
    await t.waitForRequests(1);
    t.work.respond(0, p1, opaque);
    await expect.poll(() => t.ids()).toEqual(p1.map((i) => i.workId));
    expect(t.state().hasNextPage).toBe(true);

    // Double activation → exactly one request.
    void t.state().loadMore();
    void t.state().loadMore();
    await t.waitForRequests(2);
    expect(t.work.requests()[1].cursor).toBe(opaque);
    t.work.respond(1, p2, null);
    await expect
      .poll(() => t.ids())
      .toEqual([...p1, ...p2].map((i) => i.workId));
    expect(t.state().hasNextPage).toBe(false);
    expect(t.state().pageCount).toBe(2);
    expect(t.work.calls).toHaveLength(2);
  });

  it("refuses load-more while a revalidation runs (no request, no append to old pages)", async () => {
    const t = await setup();
    await t.waitForRequests(1);
    t.work.respond(0, [buildWorkItem()], cursor("c1"));
    await expect.poll(() => t.state().hasNextPage).toBe(true);
    void t.state().refresh();
    await t.waitForRequests(2);
    await expect.poll(() => t.state().isFetching).toBe(true);
    expect(await t.state().loadMore()).toEqual({ ok: false, error: null });
    expect(t.work.calls).toHaveLength(2);
  });
});

describe("useWorkItems — coherent revalidation", () => {
  it("restarts at page 1 with null, takes every further cursor from the fresh answers, and swaps the snapshot as a whole", async () => {
    const t = await setup();
    const old = [buildWorkItem(), buildWorkItem(), buildWorkItem()];
    await t.waitForRequests(1);
    t.work.respond(0, [old[0]], cursor("old-1"));
    await expect.poll(() => t.state().hasNextPage).toBe(true);
    void t.state().loadMore();
    await t.waitForRequests(2);
    t.work.respond(1, [old[1]], cursor("old-2"));
    await expect.poll(() => t.ids()?.length).toBe(2);
    void t.state().loadMore();
    await t.waitForRequests(3);
    t.work.respond(2, [old[2]], null);
    await expect.poll(() => t.ids()?.length).toBe(3);

    const fresh = [buildWorkItem(), buildWorkItem(), buildWorkItem()];
    const refreshed = t.state().refresh();
    await t.waitForRequests(4);
    expect(t.work.requests()[3].cursor).toBeNull();
    t.work.respond(3, [fresh[0]], cursor("new-1"));
    await t.waitForRequests(5);
    // Old snapshot stays visible until the whole revalidation succeeded.
    expect(t.ids()).toEqual(old.map((i) => i.workId));
    expect(t.work.requests()[4].cursor).toBe("new-1");
    t.work.respond(4, [fresh[1]], cursor("new-2"));
    await t.waitForRequests(6);
    expect(t.work.requests()[5].cursor).toBe("new-2");
    t.work.respond(5, [fresh[2]], null);
    expect(await refreshed).toEqual({ ok: true, error: null });
    await expect.poll(() => t.ids()).toEqual(fresh.map((i) => i.workId));
    // No old continuation page was combined with the fresh page 1.
    expect(t.ids()).not.toContain(old[1].workId);
  });

  it("keeps the previous snapshot, flagged as refresh failure, when a revalidation fails (not permission_denied)", async () => {
    const t = await setup();
    const rows = [buildWorkItem()];
    await t.waitForRequests(1);
    t.work.respond(0, rows, null);
    await expect.poll(() => t.ids()).toEqual(rows.map((r) => r.workId));
    const fetchedAt = t.state().dataUpdatedAt;
    void t.state().refresh();
    await t.waitForRequests(2);
    t.work.fail(1, "unavailable");
    await expect.poll(() => t.state().errorPhase).toBe("refresh");
    expect(t.ids()).toEqual(rows.map((r) => r.workId));
    expect(t.state().dataUpdatedAt).toBe(fetchedAt);
    expect(t.state().error?.reason).toBe("unavailable");
  });
});

describe("useWorkItems — errors are never an empty list", () => {
  for (const reason of [
    "invalid_request",
    "permission_denied",
    "unavailable",
    "malformed_response",
    "failed",
  ] as const) {
    it(`first-load ${reason} yields an error without items`, async () => {
      const t = await setup();
      await t.waitForRequests(1);
      t.work.fail(0, reason);
      await expect.poll(() => t.state().error?.reason).toBe(reason);
      expect(t.state().items).toBeUndefined();
      expect(t.state().errorPhase).toBe("initial");
      expect(t.work.calls).toHaveLength(1);
    });
  }

  it("treats a malformed page (wrong scope) as an error, never as data", async () => {
    const t = await setup();
    await t.waitForRequests(1);
    t.work.calls[0].resolve({
      items: [],
      scope: "team",
      stateScope: "open",
      pageSize: 50,
      nextCursor: null,
    });
    await expect.poll(() => t.state().error?.reason).toBe("malformed_response");
    expect(t.state().items).toBeUndefined();
  });
});

describe("useWorkItems — view isolation", () => {
  it("never shows a late mine answer under team", async () => {
    const t = await setup({ scope: "mine" });
    await t.waitForRequests(1);
    await t.setScope("team");
    await t.waitForRequests(2);
    expect(t.work.requests()[1].scope).toBe("team");
    const teamRows = [buildWorkItem()];
    const mineRows = [buildWorkItem()];
    t.work.respond(1, teamRows, null);
    await expect.poll(() => t.ids()).toEqual(teamRows.map((r) => r.workId));
    t.work.respond(0, mineRows, null); // the late answer of the old view
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(t.state().scope).toBe("team");
    expect(t.ids()).toEqual(teamRows.map((r) => r.workId));
    // It filled only its own entry.
    const mine = t.queryClient.getQueryData<{
      pages: { items: { workId: string }[] }[];
    }>(workItemsQueryKey(7, "mine"));
    expect(mine?.pages[0].items.map((i) => i.workId)).toEqual(
      mineRows.map((r) => r.workId),
    );
  });

  it("shows no rows of the other view as placeholder while the new view loads", async () => {
    const t = await setup({ scope: "mine" });
    await t.waitForRequests(1);
    t.work.respond(0, [buildWorkItem()], null);
    await expect.poll(() => t.ids()?.length).toBe(1);
    await t.setScope("team");
    await t.waitForRequests(2);
    expect(t.state().items).toBeUndefined();
  });

  it("revalidates a view served from its own cache entry when switching back", async () => {
    const t = await setup({ scope: "mine" });
    const mineRows = [buildWorkItem()];
    await t.waitForRequests(1);
    t.work.respond(0, mineRows, null);
    await expect.poll(() => t.ids()?.length).toBe(1);
    await t.setScope("team");
    await t.waitForRequests(2);
    t.work.respond(1, [buildWorkItem()], null);
    await expect.poll(() => t.state().items?.length).toBe(1);
    await t.setScope("mine");
    // The cached mine snapshot may show at once …
    expect(t.ids()).toEqual(mineRows.map((r) => r.workId));
    // … and is revalidated.
    await t.waitForRequests(3);
    expect(t.work.requests()[2]).toMatchObject({ scope: "mine", cursor: null });
  });

  it("never shows the previous identity's rows after an identity change", async () => {
    const t = await setup({ identity: 7 });
    await t.waitForRequests(1);
    t.work.respond(0, [buildWorkItem()], null);
    await expect.poll(() => t.ids()?.length).toBe(1);

    // Worst case: no cache clear — only the identity partition protects.
    t.auth.setIdentity(8);
    await t.queryClient.invalidateQueries({
      queryKey: ["auth", "getIdentity"],
    });
    await t.waitForRequests(2);
    expect(t.state().items).toBeUndefined();
    expect(JSON.stringify(t.work.requests()[1])).not.toMatch(/\b8\b/);
    const otherRows = [buildWorkItem()];
    t.work.respond(1, otherRows, null);
    await expect.poll(() => t.ids()).toEqual(otherRows.map((r) => r.workId));
    expect(
      t.queryClient.getQueryCache().find({
        queryKey: workItemsQueryKey(8, "mine"),
        exact: true,
      }),
    ).toBeDefined();
  });
});

describe("useWorkItems — permission_denied (docs/nora/26 §5.4, R3-19)", () => {
  const loadThenDeny = async (phase: "refresh" | "next-page") => {
    const t = await setup({ scope: "team" });
    const rows = [buildWorkItem()];
    await t.waitForRequests(1);
    t.work.respond(0, rows, phase === "next-page" ? cursor("c1") : null);
    await expect.poll(() => t.ids()?.length).toBe(1);
    // A second, inactive view of the same identity.
    t.queryClient.setQueryData(workItemsQueryKey(7, "mine"), {
      pages: [
        {
          items: [buildWorkItem()],
          scope: "mine",
          stateScope: "open",
          pageSize: 50,
          nextCursor: null,
        },
      ],
      pageParams: [null],
    });
    if (phase === "refresh") void t.state().refresh();
    else void t.state().loadMore();
    await t.waitForRequests(2);
    t.work.fail(1, "permission_denied");
    await expect.poll(() => t.state().isDenied).toBe(true);
    return t;
  };

  for (const phase of ["refresh", "next-page"] as const) {
    it(`drops the snapshot on denial during ${phase}, without removing the entry and without a further request`, async () => {
      const t = await loadThenDeny(phase);
      expect(t.state().items).toBeUndefined();
      const entry = t.queryClient
        .getQueryCache()
        .find({ queryKey: workItemsQueryKey(7, "team"), exact: true });
      await expect.poll(() => entry?.state.data).toBeUndefined();
      // R3-19: the refused snapshot's fetch instant goes with its data.
      expect(entry?.state.dataUpdatedAt).toBe(0);
      expect(t.state().dataUpdatedAt).toBe(0);
      // Inactive entries of this identity are discarded.
      await expect
        .poll(() => t.queryClient.getQueryData(workItemsQueryKey(7, "mine")))
        .toBeUndefined();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(t.work.calls).toHaveLength(2);
    });
  }

  it("shows no pre-denial row while the denied entry revalidates, nor after a later failure; a later success restores rows", async () => {
    const t = await loadThenDeny("refresh");
    void t.state().retry();
    await t.waitForRequests(3);
    await expect.poll(() => t.state().isDeniedRevalidation).toBe(true);
    expect(t.state().isDenied).toBe(false);
    expect(t.state().items).toBeUndefined();
    t.work.fail(2, "failed");
    await expect.poll(() => t.state().error?.reason).toBe("failed");
    // A first-load error, not a stale snapshot (R3-19).
    expect(t.state().errorPhase).toBe("initial");
    expect(t.state().items).toBeUndefined();
    expect(t.state().dataUpdatedAt).toBe(0);

    void t.state().retry();
    await t.waitForRequests(4);
    await expect.poll(() => t.state().isDeniedRevalidation).toBe(true);
    const fresh = [buildWorkItem()];
    t.work.respond(3, fresh, null);
    await expect.poll(() => t.ids()).toEqual(fresh.map((r) => r.workId));
    await expect.poll(() => t.state().isDeniedRevalidation).toBe(false);
    expect(t.state().isDenied).toBe(false);
  });
});

describe("useWorkItems — Berlin day change (docs/nora/26 §5.5)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("invalidates exactly once after Berlin midnight (+2 min timer or focus), without looking at any row", async () => {
    // 2026-10-12 23:58:00 Berlin (CEST, UTC+2)
    vi.useFakeTimers({
      toFake: ["Date", "setTimeout", "clearTimeout"],
      shouldAdvanceTime: true,
      now: Date.UTC(2026, 9, 12, 21, 58, 0),
    });
    const t = await setup();
    await t.waitForRequests(1);
    // A row whose dueAt/flags would say anything — it must not matter.
    t.work.respond(0, [buildWorkItem({ dueAt: "infinity" })], null);
    await expect.poll(() => t.ids()?.length).toBe(1);

    // Same Berlin day: focus does nothing.
    vi.advanceTimersByTime(20_000);
    window.dispatchEvent(new Event("focus"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(t.work.calls).toHaveLength(1);

    // Midnight passes; nothing until the single timer at 00:02 Berlin fires.
    vi.advanceTimersByTime(2 * 60_000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(t.work.calls).toHaveLength(1);
    vi.advanceTimersByTime(2 * 60_000);
    await t.waitForRequests(2);
    expect(t.work.requests()[1]).toMatchObject({ cursor: null });
    // Focus on the same new day while the revalidation runs: no second one.
    window.dispatchEvent(new Event("focus"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(t.work.calls).toHaveLength(2);
  });
});
