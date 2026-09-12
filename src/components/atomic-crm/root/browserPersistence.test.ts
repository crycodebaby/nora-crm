import { describe, expect, it, beforeEach, afterEach } from "vitest";

import {
  LEGACY_REACT_QUERY_PERSIST_KEY,
  purgeLegacyReactQueryPersistence,
} from "./browserPersistence";

/**
 * Synthetic neighbours that share `localStorage` with the legacy key and must
 * survive the purge byte-identically. Values are invented placeholders — never
 * real tokens, real drafts or real customer data.
 */
const NEIGHBOUR_KEYS = {
  supabaseAuth: "sb-testproject-auth-token",
  quickCaptureDraft: "nora-quick-capture-draft:4711",
  raStore: "RaStoreCRM.configuration",
  pwaSession: "chunk-reload",
} as const;

const NEIGHBOUR_VALUES = {
  [NEIGHBOUR_KEYS.supabaseAuth]: JSON.stringify({
    access_token: "synthetic-not-a-real-token",
    refresh_token: "synthetic-not-a-real-token",
  }),
  [NEIGHBOUR_KEYS.quickCaptureDraft]: JSON.stringify({
    schemaVersion: 3,
    dealTitle: "Synthetischer Entwurf",
  }),
  [NEIGHBOUR_KEYS.raStore]: JSON.stringify({ title: "Nora" }),
  [NEIGHBOUR_KEYS.pwaSession]: "1",
} as const;

const seedNeighbours = (): void => {
  for (const [key, value] of Object.entries(NEIGHBOUR_VALUES)) {
    localStorage.setItem(key, value);
  }
};

const expectNeighboursUntouched = (): void => {
  for (const [key, value] of Object.entries(NEIGHBOUR_VALUES)) {
    expect(localStorage.getItem(key)).toBe(value);
  }
};

/** A dehydrated React Query snapshot in the shape the removed persister wrote. */
const legacySnapshot = JSON.stringify({
  buster: "",
  timestamp: Date.now(),
  clientState: {
    mutations: [],
    queries: [
      {
        queryKey: ["contacts", "getList", { pagination: { page: 1 } }],
        queryHash: '["contacts","getList"]',
        state: {
          data: { data: [{ id: 1, first_name: "Synthetisch" }], total: 1 },
          status: "success",
        },
      },
    ],
  },
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("purgeLegacyReactQueryPersistence", () => {
  it("removes the legacy React Query persistence key", () => {
    localStorage.setItem(LEGACY_REACT_QUERY_PERSIST_KEY, legacySnapshot);
    expect(localStorage.getItem(LEGACY_REACT_QUERY_PERSIST_KEY)).not.toBeNull();

    purgeLegacyReactQueryPersistence();

    expect(localStorage.getItem(LEGACY_REACT_QUERY_PERSIST_KEY)).toBeNull();
  });

  it("targets exactly the library default key name", () => {
    expect(LEGACY_REACT_QUERY_PERSIST_KEY).toBe("REACT_QUERY_OFFLINE_CACHE");
  });

  it("is idempotent and does not throw when the key is absent", () => {
    expect(localStorage.getItem(LEGACY_REACT_QUERY_PERSIST_KEY)).toBeNull();

    expect(() => {
      purgeLegacyReactQueryPersistence();
      purgeLegacyReactQueryPersistence();
      purgeLegacyReactQueryPersistence();
    }).not.toThrow();

    expect(localStorage.getItem(LEGACY_REACT_QUERY_PERSIST_KEY)).toBeNull();
  });

  it("leaves auth, Quick Capture, store and PWA keys byte-identical", () => {
    seedNeighbours();
    localStorage.setItem(LEGACY_REACT_QUERY_PERSIST_KEY, legacySnapshot);
    const before = localStorage.length;

    purgeLegacyReactQueryPersistence();

    expect(localStorage.getItem(LEGACY_REACT_QUERY_PERSIST_KEY)).toBeNull();
    expectNeighboursUntouched();
    // Exactly one key removed — no clear(), no wildcard sweep.
    expect(localStorage.length).toBe(before - 1);
  });

  it("removes nothing at all when only neighbour keys are present", () => {
    seedNeighbours();
    const before = localStorage.length;

    purgeLegacyReactQueryPersistence();

    expectNeighboursUntouched();
    expect(localStorage.length).toBe(before);
  });
});
