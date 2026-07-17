import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type AuthPreflightStep = "A" | "B" | "C" | "D";

type ErrorFields = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

type AdminProfile = {
  user_id: string;
  role: string;
  administrator: boolean;
  disabled: boolean;
};

type AuthPreflightOptions = {
  adminSupabase: SupabaseClient;
  userId: string;
  email: string;
  password: string;
};

const redactDiagnostic = (
  value: unknown,
  sensitiveValues: string[],
): string | undefined => {
  if (value == null) return undefined;

  let redacted = String(value)
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      "[REDACTED_JWT]",
    )
    .replace(
      /(password|service[_-]?role(?:[_-]?key)?|apikey|authorization)\s*[:=]\s*["']?[^,\s"']+/gi,
      "$1=[REDACTED]",
    );

  for (const sensitiveValue of sensitiveValues.filter(Boolean)) {
    redacted = redacted.replaceAll(sensitiveValue, "[REDACTED]");
  }

  return redacted;
};

export const formatAuthPreflightFailure = (
  step: AuthPreflightStep,
  resource: string,
  error: unknown,
  sensitiveValues: string[] = [],
) => {
  const fields =
    error && typeof error === "object" ? (error as ErrorFields) : undefined;
  const message =
    fields?.message ??
    (error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown preflight failure");

  return `E2E auth/RBAC preflight step ${step} failed: ${JSON.stringify({
    step,
    resource,
    code: redactDiagnostic(fields?.code, sensitiveValues) ?? null,
    message: redactDiagnostic(message, sensitiveValues) ?? null,
    details: redactDiagnostic(fields?.details, sensitiveValues) ?? null,
    hint: redactDiagnostic(fields?.hint, sensitiveValues) ?? null,
  })}`;
};

const failPreflight = (
  step: AuthPreflightStep,
  resource: string,
  error: unknown,
  sensitiveValues: string[],
): never => {
  throw new Error(
    formatAuthPreflightFailure(step, resource, error, sensitiveValues),
  );
};

const runPreflightRequest = async <Result>(
  step: AuthPreflightStep,
  resource: string,
  request: () => PromiseLike<Result>,
  sensitiveValues: string[],
) => {
  try {
    return await request();
  } catch (error) {
    return failPreflight(step, resource, error, sensitiveValues);
  }
};

const assertAdminProfile = (
  step: "B" | "D",
  resource: string,
  profile: AdminProfile | null,
  userId: string,
  sensitiveValues: string[],
) => {
  if (
    profile?.user_id !== userId ||
    profile.role !== "admin" ||
    profile.administrator !== true ||
    profile.disabled !== false
  ) {
    failPreflight(
      step,
      resource,
      {
        code: "E2E_PROFILE_MISMATCH",
        message: "Expected exactly one active administrator sales profile",
        details: profile
          ? JSON.stringify({
              user_id_matches: profile.user_id === userId,
              role: profile.role,
              administrator: profile.administrator,
              disabled: profile.disabled,
            })
          : "Profile row missing",
      },
      sensitiveValues,
    );
  }
};

export const runAuthRbacPreflight = async ({
  adminSupabase,
  userId,
  email,
  password,
}: AuthPreflightOptions) => {
  const sensitiveValues = [
    password,
    process.env.SERVICE_ROLE_KEY ?? "",
    process.env.VITE_SB_PUBLISHABLE_KEY ?? "",
  ];

  const {
    data: { user: adminUser },
    error: adminUserError,
  } = await runPreflightRequest(
    "A",
    "auth.users",
    () => adminSupabase.auth.admin.getUserById(userId),
    sensitiveValues,
  );

  if (adminUserError) {
    failPreflight("A", "auth.users", adminUserError, sensitiveValues);
  }
  if (
    !adminUser?.id ||
    adminUser.id !== userId ||
    !adminUser.email_confirmed_at
  ) {
    failPreflight(
      "A",
      "auth.users",
      {
        code: "E2E_AUTH_USER_INVALID",
        message: "Auth user is missing, mismatched, or not email-confirmed",
      },
      sensitiveValues,
    );
  }

  const { data: serviceProfile, error: serviceProfileError } =
    await runPreflightRequest(
      "B",
      "public.sales (service_role)",
      () =>
        adminSupabase
          .from("sales")
          .select("user_id, role, administrator, disabled")
          .eq("user_id", userId)
          .single<AdminProfile>(),
      sensitiveValues,
    );

  if (serviceProfileError) {
    failPreflight(
      "B",
      "public.sales (service_role)",
      serviceProfileError,
      sensitiveValues,
    );
  }
  assertAdminProfile(
    "B",
    "public.sales (service_role)",
    serviceProfile,
    userId,
    sensitiveValues,
  );

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54341";
  const publishableKey = process.env.VITE_SB_PUBLISHABLE_KEY;
  if (!publishableKey) {
    failPreflight(
      "C",
      "E2E environment",
      {
        code: "E2E_ENV_MISSING",
        message: "VITE_SB_PUBLISHABLE_KEY is required",
      },
      sensitiveValues,
    );
  }

  const userSupabase = createClient(supabaseUrl, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  try {
    const { data: signInData, error: signInError } = await runPreflightRequest(
      "C",
      "auth.sessions",
      () => userSupabase.auth.signInWithPassword({ email, password }),
      sensitiveValues,
    );

    if (signInError) {
      failPreflight("C", "auth.sessions", signInError, sensitiveValues);
    }
    if (
      !signInData.session ||
      !signInData.user?.id ||
      signInData.user.id !== userId
    ) {
      failPreflight(
        "C",
        "auth.sessions",
        {
          code: "E2E_SESSION_INVALID",
          message:
            "Authenticated session is missing or belongs to another user",
        },
        sensitiveValues,
      );
    }

    const { data: authenticatedProfile, error: authenticatedProfileError } =
      await runPreflightRequest(
        "D",
        "public.sales (authenticated)",
        () =>
          userSupabase
            .from("sales")
            .select("user_id, role, administrator, disabled")
            .eq("user_id", userId)
            .single<AdminProfile>(),
        sensitiveValues,
      );

    if (authenticatedProfileError) {
      failPreflight(
        "D",
        "public.sales (authenticated)",
        authenticatedProfileError,
        sensitiveValues,
      );
    }
    assertAdminProfile(
      "D",
      "public.sales (authenticated)",
      authenticatedProfile,
      userId,
      sensitiveValues,
    );
  } finally {
    await userSupabase.auth.signOut({ scope: "local" });
  }
};
