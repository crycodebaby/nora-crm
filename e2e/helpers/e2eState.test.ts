import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  BUSINESS_TABLES,
  E2eStateError,
  ensureE2eAdmin,
  resetBusinessState,
  type AuthUserSummary,
  type SalesRow,
} from "./e2eState";

const EMAIL = "admin@nora-e2e.local";
const CREDENTIALS = {
  email: EMAIL,
  password: "password",
  first_name: "Nora",
  last_name: "Admin",
};
const ADMIN_USER_ID = "00000000-0000-0000-0000-000000000001";

const canonicalAuthUser: AuthUserSummary = { id: ADMIN_USER_ID, email: EMAIL };
const canonicalSales: SalesRow = {
  id: 1,
  user_id: ADMIN_USER_ID,
  email: EMAIL,
  role: "admin",
  administrator: true,
  disabled: false,
};
const foreignAuthUser: AuthUserSummary = {
  id: "00000000-0000-0000-0000-000000000002",
  email: "someone@example.com",
};

type SupabaseError = { code?: string; message: string } | null;

/**
 * In-memory stand-in for the few Supabase calls the E2E state helper makes.
 * `service` and `adminSession` are two clients over the same database state;
 * every mutation is recorded with the client that issued it, so tests can
 * prove who deleted what and that fail-closed paths change nothing.
 */
const createFakeStack = ({
  authUsers = [],
  sales = [],
  businessCounts = {},
  deleteErrors = {},
  keepRowsAfterDelete = [],
  createUserAssignsRole = "admin",
}: {
  authUsers?: AuthUserSummary[];
  sales?: SalesRow[];
  businessCounts?: Record<string, number>;
  deleteErrors?: Record<string, SupabaseError>;
  keepRowsAfterDelete?: string[];
  createUserAssignsRole?: "admin" | "viewer";
} = {}) => {
  const state = {
    authUsers: [...authUsers],
    sales: [...sales],
    counts: { ...businessCounts } as Record<string, number>,
  };
  const mutations: string[] = [];

  const clientFor = (actor: "service" | "admin") =>
    ({
      from: (table: string) => ({
        select: (_columns: string, options?: { head?: boolean }) => {
          if (options?.head) {
            return Promise.resolve({
              count: state.counts[table] ?? 0,
              error: null,
            });
          }
          if (table === "configuration") {
            return Promise.resolve({
              data: [{ id: 1, config: {} }],
              error: null,
            });
          }
          return {
            order: () => Promise.resolve({ data: state.sales, error: null }),
            eq: (_column: string, userId: string) => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: state.sales.find((row) => row.user_id === userId),
                  error: null,
                }),
            }),
          };
        },
        delete: () => ({
          not: () => {
            mutations.push(`${actor}:delete:${table}`);
            const error = deleteErrors[table] ?? null;
            if (!error && !keepRowsAfterDelete.includes(table)) {
              state.counts[table] = 0;
            }
            return Promise.resolve({ error });
          },
        }),
      }),
      auth: {
        getSession: () =>
          Promise.resolve({
            data: { session: { user: { id: ADMIN_USER_ID } } },
            error: null,
          }),
        admin: {
          listUsers: () =>
            Promise.resolve({ data: { users: state.authUsers }, error: null }),
          createUser: ({ email }: { email: string }) => {
            mutations.push(`${actor}:createUser`);
            const user = { id: ADMIN_USER_ID, email };
            state.authUsers.push(user);
            state.sales.push({
              ...canonicalSales,
              role: createUserAssignsRole,
              administrator: createUserAssignsRole === "admin",
            });
            return Promise.resolve({ data: { user }, error: null });
          },
        },
      },
    }) as unknown as SupabaseClient;

  return {
    service: clientFor("service"),
    adminSession: clientFor("admin"),
    mutations,
    state,
  };
};

const expectStateError = async (promise: Promise<unknown>, code: string) => {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(E2eStateError);
  expect((error as E2eStateError).code).toBe(code);
};

describe("ensureE2eAdmin", () => {
  it("creates the canonical admin once on a pristine stack", async () => {
    const stack = createFakeStack();
    const runPreflight = vi.fn().mockResolvedValue(undefined);

    const admin = await ensureE2eAdmin({
      serviceClient: stack.service,
      credentials: CREDENTIALS,
      runPreflight,
    });

    expect(admin).toMatchObject({
      id: 1,
      userId: ADMIN_USER_ID,
      bootstrap: "created",
    });
    expect(stack.mutations).toEqual(["service:createUser"]);
    expect(runPreflight).toHaveBeenCalledTimes(1);
  });

  it("reuses a valid canonical admin without creating a user", async () => {
    const stack = createFakeStack({
      authUsers: [canonicalAuthUser],
      sales: [canonicalSales],
    });
    const runPreflight = vi.fn().mockResolvedValue(undefined);

    const admin = await ensureE2eAdmin({
      serviceClient: stack.service,
      credentials: CREDENTIALS,
      runPreflight,
    });

    expect(admin).toMatchObject({ userId: ADMIN_USER_ID, bootstrap: "reused" });
    expect(stack.mutations).toEqual([]);
    expect(runPreflight).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the first-admin trigger does not produce an admin", async () => {
    const stack = createFakeStack({ createUserAssignsRole: "viewer" });
    const runPreflight = vi.fn();

    await expectStateError(
      ensureE2eAdmin({
        serviceClient: stack.service,
        credentials: CREDENTIALS,
        runPreflight,
      }),
      "E2E_ADMIN_NOT_ACTIVE_ADMIN",
    );
    expect(runPreflight).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "a foreign second employee",
      code: "E2E_IDENTITY_UNEXPECTED",
      authUsers: [canonicalAuthUser, foreignAuthUser],
      sales: [
        canonicalSales,
        {
          id: 2,
          user_id: foreignAuthUser.id,
          email: foreignAuthUser.email!,
          role: "viewer",
          administrator: false,
          disabled: false,
        },
      ],
    },
    {
      name: "only a foreign admin",
      code: "E2E_IDENTITY_FOREIGN",
      authUsers: [foreignAuthUser],
      sales: [
        {
          ...canonicalSales,
          user_id: foreignAuthUser.id,
          email: foreignAuthUser.email!,
        },
      ],
    },
    {
      name: "the canonical user as viewer",
      code: "E2E_ADMIN_NOT_ACTIVE_ADMIN",
      authUsers: [canonicalAuthUser],
      sales: [{ ...canonicalSales, role: "viewer", administrator: false }],
    },
    {
      name: "the canonical admin disabled",
      code: "E2E_ADMIN_NOT_ACTIVE_ADMIN",
      authUsers: [canonicalAuthUser],
      sales: [{ ...canonicalSales, disabled: true }],
    },
    {
      name: "an auth user without sales row",
      code: "E2E_SALES_MISSING",
      authUsers: [canonicalAuthUser],
      sales: [],
    },
    {
      name: "a sales row without auth user",
      code: "E2E_AUTH_MISSING",
      authUsers: [],
      sales: [canonicalSales],
    },
    {
      name: "a canonical sales row linked to another auth user",
      code: "E2E_IDENTITY_MISMATCH",
      authUsers: [canonicalAuthUser],
      sales: [{ ...canonicalSales, user_id: foreignAuthUser.id }],
    },
  ])(
    "throws and changes nothing for $name",
    async ({ code, authUsers, sales }) => {
      const stack = createFakeStack({ authUsers, sales });
      const runPreflight = vi.fn();

      await expectStateError(
        ensureE2eAdmin({
          serviceClient: stack.service,
          credentials: CREDENTIALS,
          runPreflight,
        }),
        code,
      );

      expect(stack.mutations).toEqual([]);
      expect(stack.state.authUsers).toEqual(authUsers);
      expect(stack.state.sales).toEqual(sales);
      expect(runPreflight).not.toHaveBeenCalled();
    },
  );
});

describe("resetBusinessState", () => {
  const admin = { userId: ADMIN_USER_ID, email: EMAIL };
  const dirtyCounts = Object.fromEntries(
    BUSINESS_TABLES.map((table) => [table, 3]),
  );

  it("deletes every business table through the admin session only", async () => {
    const stack = createFakeStack({
      authUsers: [canonicalAuthUser],
      sales: [canonicalSales],
      businessCounts: dirtyCounts,
    });

    await resetBusinessState({
      adminClient: stack.adminSession,
      serviceClient: stack.service,
      admin,
    });

    expect(stack.mutations).toEqual(
      BUSINESS_TABLES.map((table) => `admin:delete:${table}`),
    );
    expect(stack.state.authUsers).toEqual([canonicalAuthUser]);
    expect(stack.state.sales).toEqual([canonicalSales]);
  });

  it("throws when a business DELETE returns an error", async () => {
    const stack = createFakeStack({
      authUsers: [canonicalAuthUser],
      sales: [canonicalSales],
      businessCounts: dirtyCounts,
      deleteErrors: { deals: { code: "42501", message: "permission denied" } },
    });

    await expectStateError(
      resetBusinessState({
        adminClient: stack.adminSession,
        serviceClient: stack.service,
        admin,
      }),
      "E2E_RESET_DELETE_FAILED",
    );
    expect(stack.mutations.at(-1)).toBe("admin:delete:deals");
  });

  it("throws when a business table is not empty after a successful DELETE", async () => {
    // RLS matching zero rows is not an error: DELETE succeeds, rows remain.
    const stack = createFakeStack({
      authUsers: [canonicalAuthUser],
      sales: [canonicalSales],
      businessCounts: dirtyCounts,
      keepRowsAfterDelete: ["contacts"],
    });

    await expectStateError(
      resetBusinessState({
        adminClient: stack.adminSession,
        serviceClient: stack.service,
        admin,
      }),
      "E2E_RESET_POSTCONDITION_FAILED",
    );
  });

  it("throws when the employee state changed since the admin was ensured", async () => {
    const stack = createFakeStack({
      authUsers: [canonicalAuthUser, foreignAuthUser],
      sales: [canonicalSales],
    });

    await expectStateError(
      resetBusinessState({
        adminClient: stack.adminSession,
        serviceClient: stack.service,
        admin,
      }),
      "E2E_IDENTITY_UNEXPECTED",
    );
    expect(stack.state.authUsers).toEqual([canonicalAuthUser, foreignAuthUser]);
  });
});
