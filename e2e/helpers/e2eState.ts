import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * E2E state contract for the disposable local Supabase stack.
 *
 * - One canonical E2E administrator lives for the whole stack. It is created
 *   once on a pristine stack and reused afterwards (worker restarts, retries,
 *   repeated suite runs). Employees are never deleted: W6-B guards forbid it.
 * - Business test data is removed between tests through the canonical admin's
 *   own authenticated session, i.e. through the real admin RLS policies —
 *   service_role holds no DELETE on these tables.
 * - Any unexpected identity state or cleanup failure throws. Nothing here
 *   repairs, adopts or deletes foreign state.
 */

export type E2eAdminCredentials = {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
};

export type SalesRow = {
  id: number;
  user_id: string;
  email: string;
  role: string;
  administrator: boolean;
  disabled: boolean;
};

export type AuthUserSummary = {
  id: string;
  email: string | undefined;
};

export type IdentitySnapshot = {
  authUsers: AuthUserSummary[];
  sales: SalesRow[];
};

export type E2eAdmin = {
  id: number;
  userId: string;
  email: string;
  password: string;
  bootstrap: "created" | "reused";
};

/**
 * Business tables a test may fill, in FK-safe deletion order (children first).
 * A new E2E data type must be added here deliberately — the postcondition gate
 * only proves emptiness for the tables listed. Employees (`sales`, auth users),
 * `configuration`, seed/lookup data and `audit_events` are intentionally absent.
 */
export const BUSINESS_TABLES = [
  "tasks",
  "contact_notes",
  "deal_notes",
  "deals",
  "contacts",
  "companies",
  "tags",
] as const;

export class E2eStateError extends Error {
  constructor(
    readonly code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(
      `[${code}] ${message}${details ? ` ${JSON.stringify(details)}` : ""}`,
    );
    this.name = "E2eStateError";
  }
}

const SALES_COLUMNS = "id, user_id, email, role, administrator, disabled";
const AUTH_USERS_PAGE_SIZE = 1000;
const SALES_BOOTSTRAP_TIMEOUT_MS = 5_000;

const sameEmail = (a: string | undefined, b: string) =>
  a?.trim().toLowerCase() === b.trim().toLowerCase();

const describeIdentity = (snapshot: IdentitySnapshot, email: string) => ({
  auth_users: snapshot.authUsers.map((user) => ({
    id: user.id,
    canonical_email: sameEmail(user.email, email),
  })),
  sales: snapshot.sales.map((row) => ({
    id: row.id,
    user_id: row.user_id,
    canonical_email: sameEmail(row.email, email),
    role: row.role,
    administrator: row.administrator,
    disabled: row.disabled,
  })),
});

// ---------------------------------------------------------------------------
// A. State policy (pure)
// ---------------------------------------------------------------------------

/**
 * Exact canonical invariant: one auth user and one sales row, both canonical,
 * linked, and an active administrator. Throws on anything else.
 */
export const assertCanonicalAdmin = (
  snapshot: IdentitySnapshot,
  email: string,
  expectedUserId?: string,
) => {
  const details = describeIdentity(snapshot, email);
  const { authUsers, sales } = snapshot;

  if (authUsers.length !== 1 || sales.length !== 1) {
    throw new E2eStateError(
      "E2E_IDENTITY_UNEXPECTED",
      "Expected exactly one auth user and one sales row for the canonical E2E admin",
      details,
    );
  }

  const [authUser] = authUsers;
  const [row] = sales;

  if (!sameEmail(authUser.email, email) || !sameEmail(row.email, email)) {
    throw new E2eStateError(
      "E2E_IDENTITY_FOREIGN",
      "Auth user or sales row does not belong to the canonical E2E admin",
      details,
    );
  }
  if (row.user_id !== authUser.id) {
    throw new E2eStateError(
      "E2E_IDENTITY_MISMATCH",
      "Canonical sales row is not linked to the canonical auth user",
      details,
    );
  }
  if (expectedUserId !== undefined && authUser.id !== expectedUserId) {
    throw new E2eStateError(
      "E2E_IDENTITY_REPLACED",
      "Canonical E2E admin identity changed during the run",
      details,
    );
  }
  if (
    row.role !== "admin" ||
    row.administrator !== true ||
    row.disabled !== false
  ) {
    throw new E2eStateError(
      "E2E_ADMIN_NOT_ACTIVE_ADMIN",
      "Canonical E2E user is not an active administrator",
      details,
    );
  }

  return { userId: authUser.id, sales: row };
};

/**
 * Bootstrap decision. Only a completely pristine stack may create the admin;
 * only the exact canonical state may be reused; everything else throws.
 */
export const decideAdminBootstrap = (
  snapshot: IdentitySnapshot,
  email: string,
): { kind: "create" } | { kind: "reuse"; userId: string; sales: SalesRow } => {
  const { authUsers, sales } = snapshot;

  if (authUsers.length === 0 && sales.length === 0) {
    return { kind: "create" };
  }
  if (sales.length === 0) {
    throw new E2eStateError(
      "E2E_SALES_MISSING",
      "Auth user(s) exist without any sales row; refusing to repair",
      describeIdentity(snapshot, email),
    );
  }
  if (authUsers.length === 0) {
    throw new E2eStateError(
      "E2E_AUTH_MISSING",
      "Sales row(s) exist without any auth user; refusing to repair",
      describeIdentity(snapshot, email),
    );
  }

  return { kind: "reuse", ...assertCanonicalAdmin(snapshot, email) };
};

// ---------------------------------------------------------------------------
// B. Supabase I/O
// ---------------------------------------------------------------------------

export const readIdentitySnapshot = async (
  serviceClient: SupabaseClient,
): Promise<IdentitySnapshot> => {
  const { data: authData, error: authError } =
    await serviceClient.auth.admin.listUsers({
      page: 1,
      perPage: AUTH_USERS_PAGE_SIZE,
    });
  if (authError) {
    throw new E2eStateError("E2E_READ_FAILED", "Failed to list auth users", {
      message: authError.message,
    });
  }
  if (authData.users.length >= AUTH_USERS_PAGE_SIZE) {
    throw new E2eStateError(
      "E2E_IDENTITY_UNEXPECTED",
      "Auth user count reached the listing page size",
      { count: authData.users.length },
    );
  }

  const { data: sales, error: salesError } = await serviceClient
    .from("sales")
    .select(SALES_COLUMNS)
    .order("id");
  if (salesError) {
    throw new E2eStateError("E2E_READ_FAILED", "Failed to read sales", {
      message: salesError.message,
    });
  }

  return {
    authUsers: authData.users.map((user) => ({
      id: user.id,
      email: user.email,
    })),
    sales: (sales ?? []) as SalesRow[],
  };
};

const waitForSalesBootstrap = async (
  serviceClient: SupabaseClient,
  userId: string,
) => {
  const deadline = Date.now() + SALES_BOOTSTRAP_TIMEOUT_MS;
  let lastState = "sales row not found";

  while (Date.now() < deadline) {
    const { data, error } = await serviceClient
      .from("sales")
      .select(SALES_COLUMNS)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      lastState = error.message;
    } else if (data) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new E2eStateError(
    "E2E_SALES_BOOTSTRAP_TIMEOUT",
    "First-admin trigger did not create the sales row",
    { lastState },
  );
};

type PreflightRunner = (options: {
  adminSupabase: SupabaseClient;
  userId: string;
  email: string;
  password: string;
}) => Promise<void>;

/**
 * Ensures the stack holds exactly the canonical active E2E admin: creates it on
 * a pristine stack (letting the first-admin trigger assign the role), reuses it
 * when the canonical state is intact, and throws on any other state.
 */
export const ensureE2eAdmin = async ({
  serviceClient,
  credentials,
  runPreflight,
}: {
  serviceClient: SupabaseClient;
  credentials: E2eAdminCredentials;
  runPreflight: PreflightRunner;
}): Promise<E2eAdmin> => {
  const decision = decideAdminBootstrap(
    await readIdentitySnapshot(serviceClient),
    credentials.email,
  );

  if (decision.kind === "create") {
    const { data, error } = await serviceClient.auth.admin.createUser({
      email: credentials.email,
      password: credentials.password,
      email_confirm: true,
      user_metadata: {
        first_name: credentials.first_name,
        last_name: credentials.last_name,
      },
    });
    if (error || !data.user) {
      throw new E2eStateError(
        "E2E_ADMIN_CREATE_FAILED",
        "Failed to create the canonical E2E auth user on a pristine stack",
        { message: error?.message ?? "no user returned" },
      );
    }
    await waitForSalesBootstrap(serviceClient, data.user.id);
  }

  const { userId, sales } = assertCanonicalAdmin(
    await readIdentitySnapshot(serviceClient),
    credentials.email,
  );

  await runPreflight({
    adminSupabase: serviceClient,
    userId,
    email: credentials.email,
    password: credentials.password,
  });

  return {
    id: sales.id,
    userId,
    email: credentials.email,
    password: credentials.password,
    bootstrap: decision.kind === "create" ? "created" : "reused",
  };
};

/**
 * Deletes business test data through the canonical admin's authenticated
 * session (admin RLS), then proves the postconditions read-only.
 */
export const resetBusinessState = async ({
  adminClient,
  serviceClient,
  admin,
}: {
  adminClient: SupabaseClient;
  serviceClient: SupabaseClient;
  admin: Pick<E2eAdmin, "userId" | "email">;
}) => {
  const { data: sessionData, error: sessionError } =
    await adminClient.auth.getSession();
  if (sessionError || sessionData.session?.user.id !== admin.userId) {
    throw new E2eStateError(
      "E2E_ADMIN_SESSION_INVALID",
      "Business reset requires the canonical admin's authenticated session",
      { message: sessionError?.message ?? null },
    );
  }

  for (const table of BUSINESS_TABLES) {
    // PostgREST refuses an unfiltered DELETE; `id is not null` matches all rows.
    const { error } = await adminClient
      .from(table)
      .delete()
      .not("id", "is", null);
    if (error) {
      throw new E2eStateError(
        "E2E_RESET_DELETE_FAILED",
        `Business reset failed to delete ${table}`,
        { table, code: error.code, message: error.message },
      );
    }
  }

  await verifyBusinessStatePostconditions({ serviceClient, admin });
};

/**
 * Read-only gate after every reset. service_role reads bypass RLS, so the
 * counts cannot hide rows the admin session failed to delete.
 */
export const verifyBusinessStatePostconditions = async ({
  serviceClient,
  admin,
}: {
  serviceClient: SupabaseClient;
  admin: Pick<E2eAdmin, "userId" | "email">;
}) => {
  for (const table of BUSINESS_TABLES) {
    const { count, error } = await serviceClient
      .from(table)
      .select("id", { count: "exact", head: true });
    if (error || count !== 0) {
      throw new E2eStateError(
        "E2E_RESET_POSTCONDITION_FAILED",
        `Business table ${table} is not empty after reset`,
        { table, count, message: error?.message ?? null },
      );
    }
  }

  const { data: configuration, error: configurationError } = await serviceClient
    .from("configuration")
    .select("id, config");
  const config = configuration?.[0]?.config;
  if (
    configurationError ||
    configuration?.length !== 1 ||
    configuration[0].id !== 1 ||
    config == null ||
    typeof config !== "object" ||
    Array.isArray(config) ||
    Object.keys(config).length !== 0
  ) {
    throw new E2eStateError(
      "E2E_RESET_POSTCONDITION_FAILED",
      "configuration is not the migration-seeded canonical row",
      { message: configurationError?.message ?? null },
    );
  }

  assertCanonicalAdmin(
    await readIdentitySnapshot(serviceClient),
    admin.email,
    admin.userId,
  );
};
