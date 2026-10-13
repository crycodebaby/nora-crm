/**
 * Test kit for the Arbeitskorb (test-only; never imported by runtime code).
 *
 * The stub reader stands in for the configured provider's Work port, so
 * tests run the real `getWorkItems` Application query, the real Admin
 * QueryClient wiring and the real hook — only the transport is faked.
 */
import type { AuthProvider, Identifier } from "ra-core";

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
