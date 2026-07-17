import { useQueryClient } from "@tanstack/react-query";

import type { NoraRole } from "../providers/commons/canAccess";
import {
  getActiveDemoRole,
  switchDemoUserByRole,
} from "../providers/fakerest/demoSession";
import { finalizeDemoSessionSwitch } from "./finalizeDemoSessionSwitch";
import { isNoraDemoMode } from "./noraDemoMode";

/**
 * Switches the active FakeRest demo user and reloads UI state.
 * Only available when VITE_IS_DEMO=true.
 */
export const useSwitchDemoRole = () => {
  const queryClient = useQueryClient();

  const switchRole = async (nextRole: NoraRole, currentRole: NoraRole) => {
    if (!isNoraDemoMode || nextRole === currentRole) return;

    switchDemoUserByRole(nextRole);
    await finalizeDemoSessionSwitch(queryClient, {
      role: nextRole,
    });
  };

  return { switchRole };
};

/** Reload UI after demo login so identity/canAccess match localStorage. */
export const useFinalizeDemoLogin = () => {
  const queryClient = useQueryClient();

  return async (redirectTo?: string) => {
    if (!isNoraDemoMode) return;
    await finalizeDemoSessionSwitch(queryClient, {
      role: getActiveDemoRole(),
      redirectTo,
    });
  };
};
