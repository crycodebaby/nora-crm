/**
 * Test kit for the Arbeitskorb (test-only; never imported by runtime code).
 *
 * The stub reader stands in for the configured provider's Work port, so
 * tests run the real `getWorkItems` Application query, the real Admin
 * QueryClient wiring and the real hook — only the transport is faked.
 */
/* eslint-disable react-refresh/only-export-components -- test-only kit, never hot-reloaded */
import {
  CoreAdminContext,
  memoryStore,
  mergeTranslations,
  type AuthProvider,
  type GetManyParams,
  type Identifier,
} from "ra-core";
import polyglotI18nProvider from "ra-i18n-polyglot";
import englishMessages from "ra-language-english";
import germanMessages from "ra-language-german";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { QueryClient } from "@tanstack/react-query";
import { render } from "vitest-browser-react";

import { createCrmDb } from "@/test/StoryWrapper";
import { germanCrmMessages } from "../../providers/commons/germanCrmMessages";
import { createDataProvider } from "../../providers/fakerest";
import type { Company, Contact } from "../../types";
import { ArbeitskorbSurface } from "../ArbeitskorbSurface";

import {
  WorkQueryError,
  type WorkItem,
  type WorkItemsCursor,
  type WorkItemsPage,
  type WorkItemsReader,
  type WorkItemsRequest,
  type WorkQueryFailureReason,
} from "../../application/queries/getWorkItems";

let sequence = 0;

/** A valid open Work row; every field can be overridden per test. */
export const buildWorkItem = (
  overrides: Partial<WorkItem> & { workId?: string } = {},
): WorkItem => {
  sequence += 1;
  const base = {
    workId: `00000000-0000-5000-8000-${String(sequence).padStart(12, "0")}`,
    carrier: "task" as const,
    workType: null,
    state: "open" as const,
    holder: { salesId: 1, displayName: "Nora Admin" },
    dueAt: "2026-10-20T00:00:00+02:00",
    duePrecision: "unknown" as const,
    context: { customerId: 1, contactId: null },
    derived: {
      actionable: true,
      overdue: false,
      dueToday: false,
      isMine: true,
      isUnassigned: false,
    },
    validity: "valid" as const,
    title: `Aufgabe ${sequence}`,
    invalidReason: null,
  };
  return { ...base, ...overrides } as WorkItem;
};

export const buildIncompleteWorkItem = (
  overrides: Partial<WorkItem> = {},
): WorkItem =>
  buildWorkItem({
    ...overrides,
    validity: "incomplete",
    title: null,
    invalidReason: "missing_title",
    derived: {
      actionable: false,
      overdue: false,
      dueToday: false,
      isMine: true,
      isUnassigned: false,
      ...overrides.derived,
    },
  } as Partial<WorkItem>);

export const cursor = (value: string) => value as WorkItemsCursor;

export const page = (
  request: WorkItemsRequest,
  items: WorkItem[],
  nextCursor: WorkItemsCursor | null = null,
): WorkItemsPage => ({
  items,
  scope: request.scope,
  stateScope: request.stateScope,
  pageSize: request.pageSize ?? 50,
  nextCursor,
});

type PendingCall = {
  request: WorkItemsRequest;
  resolve: (page: WorkItemsPage) => void;
  reject: (error: unknown) => void;
};

/**
 * A reader whose every call stays pending until the test answers it, so
 * ordering and races are explicit.
 */
export const createControlledReader = () => {
  const calls: PendingCall[] = [];
  const reader: WorkItemsReader = {
    getWorkItems: (request) =>
      new Promise<WorkItemsPage>((resolve, reject) => {
        calls.push({ request, resolve, reject });
      }),
  };
  const call = (index: number) => {
    const found = calls[index];
    if (!found)
      throw new Error(`no Work request #${index} (have ${calls.length})`);
    return found;
  };
  return {
    reader,
    calls,
    requests: () => calls.map((c) => c.request),
    respond: (
      index: number,
      items: WorkItem[],
      next: WorkItemsCursor | null = null,
    ) => call(index).resolve(page(call(index).request, items, next)),
    fail: (index: number, reason: WorkQueryFailureReason) =>
      call(index).reject(new WorkQueryError(reason, `stub ${reason}`)),
  };
};

/** Auth provider whose identity can be switched (logout/login simulation). */
export const createSwitchableAuthProvider = (initial: Identifier | Error) => {
  let identity: Identifier | Error = initial;
  const authProvider: AuthProvider = {
    canAccess: async () => true,
    checkAuth: async () => undefined,
    checkError: async () => undefined,
    getIdentity: async () => {
      if (identity instanceof Error) throw identity;
      return { id: identity, fullName: `Mitarbeiter ${String(identity)}` };
    },
    login: async () => undefined,
    logout: async () => undefined,
  };
  return {
    authProvider,
    setIdentity: (next: Identifier | Error) => {
      identity = next;
    },
  };
};

// ---------------------------------------------------------------------------
// Surface harness (component level): real Admin context, German catalog,
// stubbed Work reader, spied name lookups.
// ---------------------------------------------------------------------------

/** German Nora catalog, independent of the test browser's language. */
export const germanTestI18nProvider = polyglotI18nProvider(
  () => mergeTranslations(englishMessages, germanMessages, germanCrmMessages),
  "de",
  [{ locale: "de", name: "Deutsch" }],
  { allowMissing: true },
);

export type GetManyCall = { resource: string; params: GetManyParams };

/** Shows the current router location for assertions. */
export const LocationProbe = () => {
  const location = useLocation();
  return (
    <output data-testid="location" hidden>
      {`${location.pathname}${location.search}`}
    </output>
  );
};

export const renderSurface = async ({
  variant = "desktop",
  initialEntry = "/arbeitskorb",
  identity = 7,
  companies = [],
  contacts = [],
  nameLookup = "normal",
}: {
  variant?: "desktop" | "mobile";
  initialEntry?: string;
  identity?: Identifier;
  companies?: Company[];
  contacts?: Contact[];
  /** `fail` rejects getMany; `hang` never answers. */
  nameLookup?: "normal" | "fail" | "hang";
} = {}) => {
  const work = createControlledReader();
  const auth = createSwitchableAuthProvider(identity);
  const queryClient = new QueryClient();
  const base = createDataProvider({
    db: createCrmDb({ companies, contacts }),
    silent: true,
  });
  const getManyCalls: GetManyCall[] = [];
  let nameMode = nameLookup;
  const dataProvider = {
    ...base,
    getMany: (resource: string, params: GetManyParams) => {
      getManyCalls.push({ resource, params });
      if (nameMode === "fail") {
        return Promise.reject(new Error("name lookup failed"));
      }
      if (nameMode === "hang") return new Promise<never>(() => undefined);
      // Like PostgREST: unknown IDs are simply absent from the answer.
      return Promise.all(
        params.ids.map((id) =>
          base
            .getOne(resource, { id })
            .then((result) => result.data)
            .catch(() => null),
        ),
      ).then((records) => ({ data: records.filter((r) => r !== null) }));
    },
    getWorkItems: work.reader.getWorkItems,
  } as typeof base;
  const screen = await render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <CoreAdminContext
        dataProvider={dataProvider}
        authProvider={auth.authProvider}
        i18nProvider={germanTestI18nProvider}
        queryClient={queryClient}
        store={memoryStore()}
      >
        <Routes>
          <Route
            path="/arbeitskorb"
            element={
              <main>
                <ArbeitskorbSurface variant={variant} />
                <LocationProbe />
              </main>
            }
          />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </CoreAdminContext>
    </MemoryRouter>,
  );
  const region = (channel: "polite" | "alert") =>
    screen.container.querySelector<HTMLElement>(
      `[data-arbeitskorb-live="${channel}"]`,
    );
  const live = (channel: "polite" | "alert") =>
    region(channel)?.textContent ?? "";
  /** Every message placed in a live region, in order. */
  const heard: { channel: "polite" | "alert"; text: string }[] = [];
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        const channel = (mutation.target as HTMLElement).dataset
          ?.arbeitskorbLive as "polite" | "alert" | undefined;
        if (channel && node.textContent) {
          heard.push({ channel, text: node.textContent });
        }
      }
    }
  });
  await expect.poll(() => region("polite") && region("alert")).toBeTruthy();
  observer.observe(region("polite")!, { childList: true });
  observer.observe(region("alert")!, { childList: true });
  const rowIds = () =>
    [...screen.container.querySelectorAll<HTMLElement>("li[data-work-id]")].map(
      (li) => li.dataset.workId,
    );
  return {
    screen,
    work,
    auth,
    queryClient,
    getManyCalls,
    heard,
    live,
    rowIds,
    /** Changes how later name lookups answer. */
    setNameLookup: (mode: "normal" | "fail" | "hang") => {
      nameMode = mode;
    },
    location: () =>
      document.querySelector('[data-testid="location"]')?.textContent ?? "",
    waitForRequests: (count: number) =>
      expect.poll(() => work.calls.length).toBe(count),
  };
};
