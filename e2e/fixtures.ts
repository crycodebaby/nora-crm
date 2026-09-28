import { test as base, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loginAsAdmin } from "./helpers/auth";
import { runAuthRbacPreflight } from "./helpers/authPreflight";
import {
  ensureE2eAdmin,
  resetBusinessState,
  type E2eAdmin,
  type E2eAdminCredentials,
} from "./helpers/e2eState";

const supabaseUrl = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54341";

// Seeding/reading only: service_role holds no DELETE on business tables and
// must not be used for resets (see helpers/e2eState.ts).
const adminSupabase = createClient(supabaseUrl, process.env.SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// The one employee of the disposable E2E stack. Tests needing a second
// employee must model it explicitly; the admin state gate rejects extra rows.
const E2E_ADMIN_CREDENTIALS: E2eAdminCredentials = {
  email: "admin@nora-e2e.local",
  password: "password",
  first_name: "Nora",
  last_name: "Admin",
};

const signInAsE2eAdmin = async (admin: E2eAdmin) => {
  const publishableKey = process.env.VITE_SB_PUBLISHABLE_KEY;
  if (!publishableKey) {
    throw new Error("VITE_SB_PUBLISHABLE_KEY is required for the E2E reset");
  }
  const client = createClient(supabaseUrl, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: admin.email,
    password: admin.password,
  });
  if (error || data.user?.id !== admin.userId) {
    throw new Error(
      `Canonical E2E admin sign-in for the business reset failed: ${error?.message ?? "session belongs to another user"}`,
    );
  }
  return client;
};

async function createNotes({
  contactId,
  salesId,
  notes,
}: {
  contactId: string | number;
  salesId: string | number;
  notes: {
    text: string;
    date?: string;
    status?: "cold" | "warm" | "hot";
  }[];
}) {
  if (notes.length === 0) return;

  const { error } = await adminSupabase.from("contact_notes").insert(
    notes.map(({ text, date, status = "cold" }) => ({
      contact_id: contactId,
      sales_id: salesId,
      text,
      date,
      status,
    })),
  );

  if (error) {
    throw new Error(`Failed to create notes: ${error.message}`);
  }
}

async function createCompany({
  name,
  salesId,
}: {
  name: string;
  salesId: string | number;
}) {
  const { data, error } = await adminSupabase
    .from("companies")
    .insert({ name, sales_id: salesId })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to create company: ${error.message}`);
  }

  return data;
}

async function createContact({
  first_name,
  last_name,
  title = "",
  company_id = null,
  sales_id,
  notes = [],
}: {
  first_name: string;
  last_name: string;
  title?: string;
  company_id?: string | number | null;
  sales_id: string | number;
  notes?: {
    text: string;
    date?: string;
    status?: "cold" | "warm" | "hot";
  }[];
}) {
  const { data, error } = await adminSupabase
    .from("contacts")
    .insert({
      first_name,
      last_name,
      title,
      company_id,
      sales_id,
      first_seen: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      has_newsletter: false,
      tags: [],
      gender: "unknown",
      status: "cold",
      background: "",
      email_jsonb: [],
      phone_jsonb: [],
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to create contact: ${error.message}`);
  }

  await createNotes({
    contactId: data.id,
    salesId: sales_id,
    notes,
  });

  return data;
}

const getMenuMethod = ({ page }: { page: Page; isMobile: boolean }) => ({
  goToDashboard: async () => {
    await page.goto("/#/");
    await page.waitForLoadState("networkidle");
  },
  goToContacts: async () => {
    await page.goto("/#/kontakte");
    // Neither the URL nor networkidle proves the target page is rendered: the
    // previous page (e.g. the dashboard, which links contacts too) can still be
    // on screen. Wait for the contacts list surface itself — its rows
    // (`nora-list-row` is only used by the contacts list, desktop and mobile)
    // or its empty state. It replaces the previous page in one render.
    await expect(page).toHaveURL(/\/#\/kontakte(?:\?.*)?$/);
    await expect(
      page
        .locator(".nora-list-row")
        .or(page.getByRole("heading", { name: "Keine Kontakte gefunden" }))
        .first(),
    ).toBeVisible();
  },
});

const dismissToast = async (page: Page, content: string) => {
  await expect(page.getByText(content)).toBeVisible();
  await page.getByLabel("Close toast").first().click();
  // Since we are in optimistic UI, dismissing the toast trigger the request to the api linked to the toast message
  await page.waitForLoadState("networkidle");
};

export const test = base.extend<
  {
    resetBusinessState: void;
    createCompany: typeof createCompany;
    createContact: typeof createContact;
    createNotes: typeof createNotes;
    menu: ReturnType<typeof getMenuMethod>;
    loginAsAdmin: (credentials: {
      email: string;
      password: string;
    }) => Promise<void>;
    dismissToast: (content: string) => Promise<void>;
  },
  {
    e2eAdmin: E2eAdmin;
    e2eAdminSupabase: SupabaseClient;
  }
>({
  e2eAdmin: [
    // The first argument to a Playwright fixture function must use object destructuring ({}) — _ is not allowed.
    // Playwright uses this to statically analyze which fixtures are requested.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      // Supabase state is the source of truth: a restarted worker (retry,
      // next project, next run) re-derives and reuses the same admin.
      await use(
        await ensureE2eAdmin({
          serviceClient: adminSupabase,
          credentials: E2E_ADMIN_CREDENTIALS,
          runPreflight: runAuthRbacPreflight,
        }),
      );
    },
    { scope: "worker" },
  ],
  e2eAdminSupabase: [
    async ({ e2eAdmin }, use) => {
      const client = await signInAsE2eAdmin(e2eAdmin);
      try {
        await use(client);
      } finally {
        await client.auth.signOut({ scope: "local" });
      }
    },
    { scope: "worker" },
  ],
  resetBusinessState: [
    async ({ e2eAdmin, e2eAdminSupabase }, use) => {
      await resetBusinessState({
        adminClient: e2eAdminSupabase,
        serviceClient: adminSupabase,
        admin: e2eAdmin,
      });
      await use();
    },
    { auto: true },
  ],
  // eslint-disable-next-line no-empty-pattern
  createCompany: async ({}, cb) => {
    await cb(createCompany);
  },
  // eslint-disable-next-line no-empty-pattern
  createContact: async ({}, cb) => {
    await cb(createContact);
  },
  // eslint-disable-next-line no-empty-pattern
  createNotes: async ({}, cb) => {
    await cb(createNotes);
  },
  menu: async ({ page, isMobile }, cb) => {
    await cb(getMenuMethod({ page, isMobile }));
  },
  loginAsAdmin: async ({ page }, cb) => {
    await cb((credentials) => loginAsAdmin(page, credentials));
  },
  dismissToast: async ({ page }, cb) => {
    await cb((content: string) => dismissToast(page, content));
  },
});

export { expect };
