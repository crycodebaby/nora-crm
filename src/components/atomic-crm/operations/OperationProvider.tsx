/**
 * React integration for Operation Manager (Foundation Wave 2).
 *
 * Provider does NOT create a competing manager. It exposes the process-wide
 * default (or an explicit test inject) via context and useSyncExternalStore.
 *
 * execute / pending / success / error / cleanup work without this Provider.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { OperationRecord } from "./operationModel";
import {
  getDefaultOperationManager,
  setDefaultOperationManager,
  type OperationManager,
} from "./operationManager";

const OperationManagerContext = createContext<OperationManager | null>(null);

export type OperationProviderProps = {
  children: ReactNode;
  /**
   * Test-only inject. When set, also becomes the default singleton so
   * dataProvider and hooks observe the same instance.
   */
  manager?: OperationManager;
};

export const OperationProvider = ({
  children,
  manager: injected,
}: OperationProviderProps) => {
  // Production: always the process singleton — never createOperationManager() here.
  const manager = useMemo(
    () => injected ?? getDefaultOperationManager(),
    [injected],
  );

  useEffect(() => {
    if (!injected) {
      return undefined;
    }
    setDefaultOperationManager(injected);
    return () => {
      if (getDefaultOperationManager() === injected) {
        setDefaultOperationManager(null);
      }
    };
  }, [injected]);

  return (
    <OperationManagerContext.Provider value={manager}>
      {children}
    </OperationManagerContext.Provider>
  );
};

export const useOperationManager = (): OperationManager => {
  const fromContext = useContext(OperationManagerContext);
  return fromContext ?? getDefaultOperationManager();
};

/** Subscribe to the full in-memory operation list (future Feedback UI). */
export const useOperations = (): readonly OperationRecord[] => {
  const manager = useOperationManager();
  return useSyncExternalStore(
    manager.subscribe,
    manager.getSnapshot,
    manager.getSnapshot,
  );
};

export const useOperation = (
  operationId: string | null | undefined,
): OperationRecord | undefined => {
  const operations = useOperations();
  if (!operationId) return undefined;
  return operations.find((op) => op.operationId === operationId);
};
