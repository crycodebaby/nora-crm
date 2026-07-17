import type { Sale } from "../../types";
import {
  canAccess,
  resolveNoraRole,
  type NoraRole,
} from "../commons/canAccess";
import { isNoraDemoMode } from "../../misc/noraDemoMode";

/**
 * Canonical FakeRest demo session storage.
 *
 * Single source of truth for the active demo user in `npm run dev:demo`:
 * - Written by: login(), DemoRoleSwitcher, switchDemoUserByRole()
 * - Read by: authProvider.getIdentity(), canAccess(), checkAuth()
 * - Not duplicated in React state — useGetIdentity mirrors this via authProvider
 */
export const NORA_DEMO_USER_STORAGE_KEY = "user";

/** React Query persist key used by MobileAdmin (must be cleared on role switch). */
export const REACT_QUERY_PERSIST_KEY = "REACT_QUERY_OFFLINE_CACHE";

const baseAvatar = {
  src: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
};

/** Static demo users — avoids async sales lookup races during role switch. */
export const DEMO_SALES_BY_ROLE: Record<NoraRole, Sale> = {
  admin: {
    id: 0,
    user_id: "0",
    first_name: "Anna",
    last_name: "Admin",
    email: "admin@nora.demo",
    password: "demo",
    administrator: true,
    role: "admin",
    disabled: false,
    avatar: baseAvatar as Sale["avatar"],
  },
  office: {
    id: 1,
    user_id: "1",
    first_name: "Otto",
    last_name: "Office",
    email: "office@nora.demo",
    password: "demo",
    administrator: false,
    role: "office",
    disabled: false,
  },
  viewer: {
    id: 2,
    user_id: "2",
    first_name: "Vera",
    last_name: "Viewer",
    email: "viewer@nora.demo",
    password: "demo",
    administrator: false,
    role: "viewer",
    disabled: false,
  },
};

export const DEMO_SALES_BY_EMAIL: Record<string, Sale> = {
  [DEMO_SALES_BY_ROLE.admin.email]: DEMO_SALES_BY_ROLE.admin,
  [DEMO_SALES_BY_ROLE.office.email]: DEMO_SALES_BY_ROLE.office,
  [DEMO_SALES_BY_ROLE.viewer.email]: DEMO_SALES_BY_ROLE.viewer,
};

export const DEMO_ROLE_EMAILS = {
  admin: DEMO_SALES_BY_ROLE.admin.email,
  office: DEMO_SALES_BY_ROLE.office.email,
  viewer: DEMO_SALES_BY_ROLE.viewer.email,
} as const;

export type DemoIdentity = {
  id: number;
  fullName: string;
  avatar?: string;
  role: NoraRole;
  email: string;
};

export const saleToDemoIdentity = (sale: Sale): DemoIdentity => ({
  id: sale.id as number,
  fullName: `${sale.first_name} ${sale.last_name}`,
  avatar: sale.avatar?.src,
  role: resolveNoraRole(sale),
  email: sale.email,
});

export const getActiveDemoSale = (): Sale | null => {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(NORA_DEMO_USER_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Sale;
  } catch {
    return null;
  }
};

export const setActiveDemoSale = (sale: Sale): void => {
  localStorage.setItem(NORA_DEMO_USER_STORAGE_KEY, JSON.stringify(sale));
};

export const clearActiveDemoSale = (): void => {
  localStorage.removeItem(NORA_DEMO_USER_STORAGE_KEY);
};

/** Ensures a demo session exists without overwriting an active login. */
export const ensureDemoSession = (): Sale => {
  const existing = getActiveDemoSale();
  if (existing) return existing;
  const initial = DEMO_SALES_BY_ROLE.admin;
  setActiveDemoSale(initial);
  return initial;
};

export const getActiveDemoRole = (): NoraRole => {
  const sale = getActiveDemoSale();
  return resolveNoraRole(sale ?? DEMO_SALES_BY_ROLE.admin);
};

export const resolveDemoSaleByEmail = (email: string): Sale | null => {
  const normalized = email.trim().toLowerCase();
  if (DEMO_SALES_BY_EMAIL[normalized]) {
    return DEMO_SALES_BY_EMAIL[normalized];
  }
  return null;
};

export const switchDemoUserByRole = (role: NoraRole): Sale => {
  const sale = DEMO_SALES_BY_ROLE[role];
  setActiveDemoSale(sale);
  return sale;
};

export const switchDemoUserByEmail = (email: string): Sale | null => {
  const sale = resolveDemoSaleByEmail(email);
  if (!sale) return null;
  setActiveDemoSale(sale);
  return sale;
};

/** Clears persisted React Query cache so identity/canAccess refetch after role switch. */
export const clearDemoQueryPersistCache = (): void => {
  try {
    localStorage.removeItem(REACT_QUERY_PERSIST_KEY);
  } catch {
    // ignore
  }
};

const FORBIDDEN_PREFIXES_FOR_NON_ADMIN = ["/settings", "/import", "/sales"];

/** Returns a safe post-switch URL when the current path is forbidden for the new role. */
export const resolveDemoPostSwitchUrl = (
  pathname: string,
  role: NoraRole,
): string | null => {
  if (role === "admin") return null;

  const normalized = pathname.replace(/\/$/, "") || "/";

  for (const prefix of FORBIDDEN_PREFIXES_FOR_NON_ADMIN) {
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      return "/";
    }
  }

  if (role === "viewer") {
    if (normalized.endsWith("/create")) return "/";
    const editPatterns = [/^\/kunden\/[^/]+$/, /^\/kontakte\/[^/]+$/, /^\/vorgaenge\/[^/]+$/];
    const legacyEditPatterns = [
      /^\/companies\/[^/]+$/,
      /^\/contacts\/[^/]+$/,
      /^\/deals\/[^/]+$/,
    ];
    if (
      editPatterns.some((p) => p.test(normalized)) ||
      legacyEditPatterns.some((p) => p.test(normalized))
    ) {
      return "/";
    }
  }

  return null;
};

export const isRouteAllowedForDemoRole = (
  pathname: string,
  role: NoraRole,
): boolean => resolveDemoPostSwitchUrl(pathname, role) == null;

/** Whether an action is allowed for the active demo role (UI guard mirror). */
export const isDemoActionAllowed = (
  role: NoraRole,
  resource: string,
  action: string,
): boolean => canAccess(role, { resource, action });

if (isNoraDemoMode && typeof localStorage !== "undefined") {
  ensureDemoSession();
}
