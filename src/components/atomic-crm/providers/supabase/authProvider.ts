import type { AuthProvider } from "ra-core";
import { supabaseAuthProvider } from "ra-supabase-core";

import { canAccess, resolveNoraRole } from "../commons/canAccess";
import { getSupabaseClient } from "./supabase";

/** Local-storage key for the signed-in sales profile used by getIdentity(). */
export const CURRENT_SALE_CACHE_KEY = "RaStore.auth.current_sale";

const IS_INITIALIZED_CACHE_KEY = "RaStore.auth.is_initialized";

/** Shape stored for identity / canAccess (subset of public.sales). */
export type CurrentSaleCache = {
  id: number | string;
  first_name: string;
  last_name: string;
  avatar?: { src?: string } | null;
  administrator?: boolean;
  role?: string;
  disabled?: boolean;
};

function getLocalStorage(): Storage | null {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

/** Clears only the cached sales identity — not session tokens or other RaStore keys. */
export function clearCurrentSaleCache(): void {
  getLocalStorage()?.removeItem(CURRENT_SALE_CACHE_KEY);
}

/**
 * Writes the identity cache from a DB-backed sales row.
 * Callers should pass the updated row returned from PostgREST / edge functions.
 */
export function setCurrentSaleCache(sale: CurrentSaleCache): void {
  const storage = getLocalStorage();
  if (!storage) return;
  storage.setItem(
    CURRENT_SALE_CACHE_KEY,
    JSON.stringify({
      id: sale.id,
      first_name: sale.first_name,
      last_name: sale.last_name,
      avatar: sale.avatar ?? null,
      administrator: sale.administrator,
      role: sale.role,
      disabled: sale.disabled,
    }),
  );
}

/**
 * Updates the identity cache only when the changed sale is the signed-in user.
 * Prevents admin edits of other users from overwriting the header identity.
 */
export function syncCurrentSaleCacheIfSelf(
  sale: CurrentSaleCache,
  currentSaleId: number | string | undefined | null,
): void {
  if (currentSaleId == null) return;
  if (String(sale.id) !== String(currentSaleId)) return;
  setCurrentSaleCache(sale);
}

const getBaseAuthProvider = () =>
  supabaseAuthProvider(getSupabaseClient(), {
    getIdentity: async () => {
      const sale = await getSale();

      if (sale == null) {
        throw new Error();
      }

      return {
        id: sale.id,
        fullName: `${sale.first_name} ${sale.last_name}`,
        avatar: sale.avatar?.src,
        role: resolveNoraRole(sale),
      };
    },
  });

export async function getIsInitialized() {
  const storage = getLocalStorage();
  const cachedValue = storage?.getItem(IS_INITIALIZED_CACHE_KEY);
  if (cachedValue != null) {
    return cachedValue === "true";
  }

  const { data } = await getSupabaseClient()
    .from("init_state")
    .select("is_initialized");
  const isInitialized = data?.at(0)?.is_initialized > 0;

  if (isInitialized) {
    storage?.setItem(IS_INITIALIZED_CACHE_KEY, "true");
  }

  return isInitialized;
}

const getSale = async () => {
  const storage = getLocalStorage();
  const cachedValue = storage?.getItem(CURRENT_SALE_CACHE_KEY);
  if (cachedValue != null) {
    return JSON.parse(cachedValue);
  }

  const { data: dataSession, error: errorSession } =
    await getSupabaseClient().auth.getSession();

  // Shouldn't happen after login but just in case
  if (dataSession?.session?.user == null || errorSession) {
    return undefined;
  }

  const { data: dataSale, error: errorSale } = await getSupabaseClient()
    .from("sales")
    .select("id, first_name, last_name, avatar, administrator, role, disabled")
    .match({ user_id: dataSession?.session?.user.id })
    .single();

  // Shouldn't happen either as all users are sales but just in case
  if (dataSale == null || errorSale) {
    return undefined;
  }

  setCurrentSaleCache(dataSale);
  return dataSale;
};

function clearAuthBootstrapCaches() {
  const storage = getLocalStorage();
  storage?.removeItem(IS_INITIALIZED_CACHE_KEY);
  clearCurrentSaleCache();
}

export const getAuthProvider = (): AuthProvider => {
  const baseAuthProvider = getBaseAuthProvider();
  return {
    ...baseAuthProvider,
    login: async (params) => {
      if (params.ssoDomain) {
        const { error } = await getSupabaseClient().auth.signInWithSSO({
          domain: params.ssoDomain,
        });
        if (error) {
          throw error;
        }
        return;
      }
      // Drop stale identity before a new session is established.
      clearCurrentSaleCache();
      return baseAuthProvider.login(params);
    },
    logout: async (params) => {
      clearAuthBootstrapCaches();
      return baseAuthProvider.logout(params);
    },
    checkAuth: async (params) => {
      // Users are on the set-password page, nothing to do
      if (
        window.location.pathname === "/set-password" ||
        window.location.hash.includes("#/set-password")
      ) {
        return;
      }
      // Users are on the forgot-password page, nothing to do
      if (
        window.location.pathname === "/forgot-password" ||
        window.location.hash.includes("#/forgot-password")
      ) {
        return;
      }
      // Users are on invite activation / legacy sign-up redirect — allow through
      if (
        window.location.pathname === "/sign-up" ||
        window.location.hash.includes("#/sign-up") ||
        window.location.hash.includes("mode=einladung")
      ) {
        return;
      }

      const isInitialized = await getIsInitialized();

      if (!isInitialized) {
        await getSupabaseClient().auth.signOut();
        throw {
          // First admin is created in Supabase Dashboard — no public signup.
          redirectTo: "/login?mode=anmelden",
          message: false,
        };
      }

      const sale = await getSale();
      if (sale == null || sale.disabled) {
        await getSupabaseClient().auth.signOut();
        clearAuthBootstrapCaches();
        throw {
          redirectTo: "/login",
          message: false,
        };
      }

      return baseAuthProvider.checkAuth(params);
    },
    canAccess: async (params) => {
      const isInitialized = await getIsInitialized();
      if (!isInitialized) return false;

      const sale = await getSale();
      if (sale == null || sale.disabled) return false;

      return canAccess(resolveNoraRole(sale), params);
    },
    getAuthorizationDetails(authorizationId: string) {
      return getSupabaseClient().auth.oauth.getAuthorizationDetails(
        authorizationId,
      );
    },
    approveAuthorization(authorizationId: string) {
      return getSupabaseClient().auth.oauth.approveAuthorization(
        authorizationId,
      );
    },
    denyAuthorization(authorizationId: string) {
      return getSupabaseClient().auth.oauth.denyAuthorization(authorizationId);
    },
  };
};
