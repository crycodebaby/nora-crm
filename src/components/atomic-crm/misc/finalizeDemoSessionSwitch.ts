import type { QueryClient } from "@tanstack/react-query";

import type { NoraRole } from "../providers/commons/canAccess";
import { resolveDemoPostSwitchUrl } from "../providers/fakerest/demoSession";

const normalizeHashTarget = (target: string): string => {
  if (target.startsWith("#")) return target;
  if (target.startsWith("/")) return `#${target}`;
  return `#/${target}`;
};

/** Picks a safe hash path after demo session change for the given role. */
export const resolveDemoReloadPath = (
  currentHash: string,
  role: NoraRole,
  redirectTo?: string,
): string => {
  const baseRedirect = redirectTo
    ? normalizeHashTarget(redirectTo)
    : currentHash || "#/";
  const pathFromHash = baseRedirect.replace(/^#/, "") || "/";
  return resolveDemoPostSwitchUrl(pathFromHash, role) ?? pathFromHash;
};

/**
 * Clears the in-memory query cache and reloads the demo app at a safe hash URL.
 * Used by DemoRoleSwitcher and demo LoginPage after session changes.
 *
 * No browser-storage cleanup is needed here: since SEC-B2 Nora persists no
 * React Query cache at all, so clearing the client plus the controlled reload
 * is all that makes identity/canAccess refetch for the new role.
 */
export const finalizeDemoSessionSwitch = async (
  queryClient: QueryClient,
  options: {
    role: NoraRole;
    redirectTo?: string;
    currentHash?: string;
  },
): Promise<void> => {
  const { role, redirectTo, currentHash = window.location.hash } = options;

  await queryClient.cancelQueries();
  queryClient.clear();

  const safePath = resolveDemoReloadPath(currentHash, role, redirectTo);
  const hashBase = window.location.pathname;
  const target = `${hashBase}#${safePath.startsWith("/") ? safePath : `/${safePath}`}`;

  window.location.assign(target);
};
