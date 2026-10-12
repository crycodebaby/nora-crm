import type { AuthProvider } from "ra-core";
import { supabaseAuthProvider } from "ra-supabase-core";

import { canAccess, resolveNoraRole } from "../commons/canAccess";
import { getSupabaseClient } from "./supabase";
import {
  getSignedAttachmentUrl,
  resetAttachmentUrlCache,
  supabaseAttachmentSigner,
} from "../../attachments/attachmentAccess";
import { classifyStorageReference } from "../commons/storageReference";

/** Local-storage key for the signed-in sales profile used by getIdentity(). */
export const CURRENT_SALE_CACHE_KEY = "RaStore.auth.current_sale";

const IS_INITIALIZED_CACHE_KEY = "RaStore.auth.is_initialized";

/** Shape stored for identity / canAccess (subset of public.sales). */
export type CurrentSaleCache = {
  id: number | string;
  first_name: string;
  last_name: string;
  /**
   * W8-E: the identity cache carries the storage KEY as well as `src`.
   *
   * An employee photo is personal data, so it belongs in the private bucket,
   * and a private object is addressed by its key — access derives from the
   * key; a persisted `src` is inert N-1 compatibility metadata, never used
   * when a key is present. Caching the key is safe: it is an opaque
   * identifier, not a capability, and is worthless without an active session.
   * A signed URL, by contrast, IS a capability and is never persisted anywhere.
   */
  avatar?: { src?: string; path?: string } | null;
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

/**
 * W8-E — the header avatar is a plain string, not a React tree, so it cannot
 * use `useAttachmentUrl`. It resolves through the same classifier instead, so
 * there is still exactly one rule for what a stored file value may become.
 *
 * Today every employee avatar in Production is an inline `data:` image, which
 * needs no round trip. The private branch exists so that an avatar that DOES
 * carry a storage key renders instead of silently disappearing — without it,
 * W8-E would leave the avatar upload path able to store a photo that Nora can
 * never display again.
 *
 * Failure is not an error here: an avatar that cannot be resolved simply
 * falls back to the initials the UI already shows.
 */
const resolveIdentityAvatar = async (
  avatar: CurrentSaleCache["avatar"],
): Promise<string | undefined> => {
  const reference = classifyStorageReference(avatar, "private");
  if (reference.kind === "private") {
    try {
      return await getSignedAttachmentUrl(
        reference.storageKey,
        supabaseAttachmentSigner,
      );
    } catch {
      return undefined;
    }
  }
  return reference.kind === "none" ? undefined : reference.url;
};

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
        avatar: await resolveIdentityAvatar(sale.avatar),
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

/**
 * Call IMMEDIATELY BEFORE any call that establishes a new authenticated
 * session in this document — `login`, the invite code (`verifyOtp`) and the
 * access link (`setSession`). Drops the cached identity and every attachment
 * capability minted, or still being minted, for a session that may have
 * existed in this tab before (W8-E U-3; Alpha Storage 3C F-5: the invite path
 * establishes a session without going through `login`). Deliberately not
 * wired to token refreshes: a refresh keeps the same user and session.
 */
export function resetSessionScopedCaches(): void {
  clearCurrentSaleCache();
  resetAttachmentUrlCache();
}

function clearAuthBootstrapCaches() {
  const storage = getLocalStorage();
  storage?.removeItem(IS_INITIALIZED_CACHE_KEY);
  clearCurrentSaleCache();
  // W8-E: derived attachment capabilities are per-session. They live only in
  // memory and are never persisted, but a signed URL minted by the employee
  // who just logged out must not be handed to whoever logs in next in the
  // same tab — neither from the cache nor from a signing request that is
  // still in flight and resolves after this point (U-3). This does not
  // retract URLs already issued — that is a bearer capability and expires on
  // its own — it stops Nora reusing them.
  resetAttachmentUrlCache();
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
      // Drop stale identity before a new session is established — including
      // any attachment capability minted, or still being minted, for a
      // session that may have existed in this tab before (W8-E U-3).
      resetSessionScopedCaches();
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
      // Users just followed an access email — the callback only forwards
      // tokens to /set-password and must not be bounced to login first.
      if (
        window.location.pathname === "/zugang-einrichten" ||
        window.location.hash.includes("#/zugang-einrichten")
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
