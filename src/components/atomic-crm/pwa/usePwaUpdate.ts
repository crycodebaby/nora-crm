import { useCallback, useSyncExternalStore } from "react";

import { pwaUpdateStore, type PwaUpdateState } from "./pwaUpdateStore";

export interface PwaUpdate {
  state: PwaUpdateState;
  updateAvailable: boolean;
  /** Die Aktivierung wurde angefordert. NICHT: sie ist gelungen. */
  applying: boolean;
  /** Die Uebernahme ist tatsaechlich eingetreten (`controllerchange`). */
  activated: boolean;
  applyUpdate: () => void;
  /** Kann ein erneuter Aktivierungsversuch ueberhaupt etwas anstossen? */
  hasWaitingWorker: () => boolean;
  /**
   * Beendet den steckengebliebenen Versuch und meldet, ob ein Retry technisch
   * etwas bewirken kann. Aufzurufen genau beim Ablauf des Watchdogs.
   */
  endStalledActivation: () => boolean;
  dismissForNow: () => void;
}

/**
 * Praesentations-Schnittstelle fuer den PWA-Update-Lifecycle (Welle PWA-1B).
 *
 * Die UI bekommt genau diese vier Angaben und fasst weder
 * `navigator.serviceWorker` noch Workbox oder die Registration selbst an.
 * PWA-1C baut die eigentliche Update-Darstellung auf dieser Schnittstelle auf,
 * ohne die Lifecycle-Logik anzufassen.
 *
 * Der Hook liest nur. Registriert wird der Service Worker beim App-Start in
 * `src/main.tsx` — bewusst nicht hier: Nora rendert die Layouts erst nach dem
 * Login, eine Registrierung im Hook wuerde den Worker fuer abgemeldete Nutzer
 * und die Login-Seite gar nicht erst installieren.
 */
export const usePwaUpdate = (): PwaUpdate => {
  const snapshot = useSyncExternalStore(
    pwaUpdateStore.subscribe,
    pwaUpdateStore.getSnapshot,
  );

  const applyUpdate = useCallback(() => pwaUpdateStore.applyUpdate(), []);
  const dismissForNow = useCallback(() => pwaUpdateStore.dismissForNow(), []);
  const hasWaitingWorker = useCallback(
    () => pwaUpdateStore.hasWaitingWorker(),
    [],
  );
  const endStalledActivation = useCallback(
    () => pwaUpdateStore.endStalledActivation(),
    [],
  );

  return {
    state: snapshot.state,
    updateAvailable: snapshot.updateAvailable,
    applying: snapshot.applying,
    activated: snapshot.activated,
    applyUpdate,
    hasWaitingWorker,
    endStalledActivation,
    dismissForNow,
  };
};
