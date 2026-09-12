import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { memoryStore, useGetList } from "ra-core";
import { MemoryRouter } from "react-router";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import { CRM } from "./CRM";
import { LEGACY_REACT_QUERY_PERSIST_KEY } from "./browserPersistence";
import { createDataProvider } from "../providers/fakerest";
import { testI18nProvider } from "../providers/commons/i18nProvider";
import {
  createCrmDb,
  createTestAuthProvider,
  buildContact,
} from "@/test/StoryWrapper";

/**
 * SEC-B2 — browser persistence boundary of the real mobile surface.
 *
 * These tests mount the actual `CRM` root at a phone viewport, which is the
 * only wiring that ever attached a React Query persister, and assert the two
 * properties the product decision requires: nothing dehydrates business data
 * into browser storage, and an already persisted legacy snapshot is never
 * rehydrated back into a business QueryClient.
 */

/** Marks the synthetic legacy snapshot so a rehydration would be unmistakable. */
const LEGACY_GHOST_NAME = "LegacySnapshotGhost";

/** A dehydrated snapshot in the shape the removed persister wrote. */
const legacySnapshot = JSON.stringify({
  buster: "",
  timestamp: Date.now(),
  clientState: {
    mutations: [],
    queries: [
      {
        queryKey: [
          "contacts",
          "getList",
          { pagination: { page: 1, perPage: 10 }, filter: {} },
        ],
        queryHash: '["contacts","getList",{"filter":{},"pagination":{}}]',
        state: {
          data: {
            data: [
              { id: 99, first_name: LEGACY_GHOST_NAME, last_name: "Ghost" },
            ],
            total: 1,
          },
          dataUpdatedAt: Date.now(),
          status: "success",
          fetchStatus: "idle",
        },
      },
    ],
  },
});

/** The mobile surface is the only one configuring a 24h in-memory gcTime. */
const MOBILE_GC_TIME = 1000 * 60 * 60 * 24;
const isMobileQueryClient = (client: QueryClient): boolean =>
  client.getDefaultOptions().queries?.gcTime === MOBILE_GC_TIME;

let seenClients: QueryClient[] = [];

/** Renders inside the admin so it observes the client actually in context. */
const QueryClientProbe = () => {
  const client = useQueryClient();
  if (seenClients[seenClients.length - 1] !== client) {
    seenClients.push(client);
  }
  const { data } = useGetList("contacts", {
    pagination: { page: 1, perPage: 10 },
  });
  return (
    <ul>
      {data?.map((contact) => (
        <li key={contact.id}>{`${contact.first_name} ${contact.last_name}`}</li>
      ))}
    </ul>
  );
};

const mobileClients = (): QueryClient[] =>
  seenClients.filter(isMobileQueryClient);

const dehydratedEntries = (): string[] => {
  const found: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key) continue;
    const value = localStorage.getItem(key) ?? "";
    if (value.includes("clientState")) found.push(key);
  }
  return found;
};

const Harness = ({
  dataProvider,
  authProvider,
  store,
}: {
  dataProvider: ReturnType<typeof createDataProvider>;
  authProvider: ReturnType<typeof createTestAuthProvider>;
  store: ReturnType<typeof memoryStore>;
}) => (
  <MemoryRouter initialEntries={["/"]}>
    <CRM
      dataProvider={dataProvider}
      authProvider={authProvider}
      i18nProvider={testI18nProvider}
      store={store}
      disableTelemetry
      dashboard={QueryClientProbe}
      layout={({ children }) => <>{children}</>}
    />
  </MemoryRouter>
);

const renderMobileCrm = async () => {
  const dataProvider = createDataProvider({
    db: createCrmDb({
      contacts: [
        buildContact({ id: 1, first_name: "Ada", last_name: "Lovelace" }),
      ],
    }),
    silent: true,
  });
  const authProvider = createTestAuthProvider();
  const store = memoryStore();
  const props = { dataProvider, authProvider, store };
  const screen = await render(<Harness {...props} />);
  await expect.element(screen.getByText("Ada Lovelace")).toBeVisible();
  return { screen, props };
};

describe("CRM mobile surface browser persistence", () => {
  beforeAll(() => {
    page.viewport(390, 844);
  });

  beforeEach(() => {
    seenClients = [];
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("does not write a React Query cache to localStorage", async () => {
    await renderMobileCrm();

    // The probe rendered business data, so a business query really did succeed
    // in the mobile client — the assertions below are not vacuous.
    await expect.poll(() => mobileClients().length).toBeGreaterThan(0);
    expect(mobileClients()[0].getQueryCache().getAll().length).toBeGreaterThan(
      0,
    );

    expect(localStorage.getItem(LEGACY_REACT_QUERY_PERSIST_KEY)).toBeNull();
    expect(dehydratedEntries()).toEqual([]);
  });

  it("purges a pre-existing legacy snapshot and never rehydrates it", async () => {
    localStorage.setItem(LEGACY_REACT_QUERY_PERSIST_KEY, legacySnapshot);

    await renderMobileCrm();

    // Purged from storage ...
    await expect
      .poll(() => localStorage.getItem(LEGACY_REACT_QUERY_PERSIST_KEY))
      .toBeNull();

    // ... and never restored into the business cache.
    const cached = JSON.stringify(
      mobileClients().flatMap((client) =>
        client
          .getQueryCache()
          .getAll()
          .map((query) => query.state.data ?? null),
      ),
    );
    expect(cached).not.toContain(LEGACY_GHOST_NAME);
    await expect
      .element(page.getByText(`${LEGACY_GHOST_NAME} Ghost`))
      .not.toBeInTheDocument();
  });

  it("keeps one QueryClient instance across re-renders of the mobile admin", async () => {
    const { screen, props } = await renderMobileCrm();

    const before = mobileClients();
    expect(before.length).toBe(1);

    await screen.rerender(<Harness {...props} />);
    await screen.rerender(<Harness {...props} />);
    await expect.element(screen.getByText("Ada Lovelace")).toBeVisible();

    const after = mobileClients();
    expect(after.length).toBeGreaterThan(0);
    expect(new Set(after).size).toBe(1);
    expect(after[0]).toBe(before[0]);
  });
});
