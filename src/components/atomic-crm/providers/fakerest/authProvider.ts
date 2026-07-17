import type { AuthProvider } from "ra-core";

import type { Sale } from "../../types";
import { canAccess, resolveNoraRole } from "../commons/canAccess";
import { dataProvider } from "./dataProvider";
import {
  clearActiveDemoSale,
  DEMO_SALES_BY_ROLE,
  ensureDemoSession,
  getActiveDemoSale,
  NORA_DEMO_USER_STORAGE_KEY,
  resolveDemoSaleByEmail,
  saleToDemoIdentity,
  setActiveDemoSale,
} from "./demoSession";

/** @deprecated Use NORA_DEMO_USER_STORAGE_KEY from demoSession */
export const USER_STORAGE_KEY = NORA_DEMO_USER_STORAGE_KEY;

export const DEFAULT_USER = DEMO_SALES_BY_ROLE.admin;

async function getUser(email: string): Promise<Sale> {
  const staticUser = resolveDemoSaleByEmail(email);
  if (staticUser) {
    return staticUser;
  }

  const sales = await dataProvider.getList("sales", {
    pagination: { page: 1, perPage: 200 },
    sort: { field: "first_name", order: "ASC" },
  });

  if (!sales.data.length) {
    return { ...DEFAULT_USER };
  }

  const user = sales.data.find((sale) => sale.email === email);
  if (!user || user.disabled) {
    return { ...DEFAULT_USER };
  }
  return user;
}

export const authProvider: AuthProvider = {
  login: async ({ email }) => {
    const user = await getUser(email);
    setActiveDemoSale(user);
    return Promise.resolve();
  },
  resetPassword: async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    return;
  },
  setPassword: async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    return;
  },
  logout: () => {
    clearActiveDemoSale();
    return Promise.resolve();
  },
  checkAuth: () => (getActiveDemoSale() ? Promise.resolve() : Promise.reject()),
  checkError: () => Promise.resolve(),
  canAccess: async ({ signal: _signal, ...params }) => {
    const localUser = getActiveDemoSale();
    if (!localUser) return false;
    return canAccess(resolveNoraRole(localUser), params);
  },
  getIdentity: () => {
    const user = getActiveDemoSale() ?? ensureDemoSession();
    return Promise.resolve(saleToDemoIdentity(user));
  },
  async getAuthorizationDetails() {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return {
      data: {
        authorization_id: "dummy",
        user: {
          id: "0",
          email: "johndoe@example.com",
        },
        client: {
          name: "Dummy Client",
        },
        scope: "openid profile email phone",
        redirect_uri: "https://example.com/auth_callback",
      },
      error: null,
    };
  },
  async approveAuthorization() {
    return {
      data: {
        redirect_url: "https://example.com/auth_callback",
      },
      error: null,
    };
  },
  async denyAuthorization() {
    return {
      data: {
        redirect_url: "https://example.com/denied",
      },
      error: null,
    };
  },
};
