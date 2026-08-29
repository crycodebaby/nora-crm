/**
 * React binding for the NotificationStore (Phase 7B.4).
 *
 * The store derives its state from the Operation Manager, so it must live
 * INSIDE the existing OperationProvider and consume the very same manager
 * instance — never a second one. Mounting order in Nora is therefore:
 *
 *   CRM → OperationProvider → NotificationProvider → Admin (Layout, dialogs)
 *
 * Consequences that matter for 7B.4:
 * - The store outlives the Quick Capture dialog and every route change, so a
 *   card survives "submit → dialog closes → redirect to the Vorgangsakte".
 * - There is exactly one store per app tree; the visible stack
 *   (NoraNotificationOutlet) and the intent registration
 *   (useNotifiedQuickCapture) read the same instance.
 */

import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

import { useOperationManager } from "../operations/OperationProvider";
import type { OperationManager } from "../operations/operationManager";
import {
  createNotificationStore,
  type NotificationStore,
} from "./notificationStore";

const NotificationStoreContext = createContext<NotificationStore | null>(null);

type StoreHolder = {
  manager: OperationManager;
  store: NotificationStore;
  alive: boolean;
};

export type NotificationProviderProps = {
  children: ReactNode;
  /** Test-only inject. An injected store is owned by the caller, never destroyed here. */
  store?: NotificationStore;
};

export const NotificationProvider = ({
  children,
  store: injected,
}: NotificationProviderProps) => {
  const manager = useOperationManager();
  const holder = useRef<StoreHolder | null>(null);
  const [, rebuild] = useReducer((n: number) => n + 1, 0);

  // Render-time, idempotent: a destroyed store is never handed out again.
  if (
    !holder.current ||
    !holder.current.alive ||
    holder.current.manager !== manager
  ) {
    holder.current = {
      manager,
      store: createNotificationStore({ manager }),
      alive: true,
    };
  }
  const store = injected ?? holder.current.store;

  useEffect(() => {
    if (injected) return undefined;
    const entry = holder.current;
    if (!entry) return undefined;
    if (!entry.alive) {
      // StrictMode remounts effects (setup → cleanup → setup) without an
      // intervening render, so this second setup would otherwise adopt the
      // store its own cleanup just destroyed. Re-render to build a fresh one.
      rebuild();
      return undefined;
    }
    return () => {
      entry.alive = false;
      entry.store.destroy();
    };
  }, [injected, store]);

  return (
    <NotificationStoreContext.Provider value={store}>
      {children}
    </NotificationStoreContext.Provider>
  );
};

/**
 * The store for the current app tree. Throws when no provider is mounted —
 * a silently missing notification layer would turn a failed write into no
 * feedback at all, which is worse than a loud boot error.
 */
export const useNotificationStore = (): NotificationStore => {
  const store = useContext(NotificationStoreContext);
  if (!store) {
    throw new Error(
      "useNotificationStore must be used within a NotificationProvider",
    );
  }
  return store;
};
