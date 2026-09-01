import { useCallback, useSyncExternalStore } from "react";

import {
  pwaUpdateStore,
  type PwaActivationAssessment,
  type PwaApplyOutcome,
  type PwaUpdateSnapshot,
  type PwaUpdateState,
} from "./pwaUpdateStore";

export interface PwaUpdate {
  state: PwaUpdateState;
  updateAvailable: boolean;
  /** Die Aktivierung wurde angefordert. NICHT: sie ist gelungen. */
  applying: boolean;
  /** Die Uebernahme ist tatsaechlich eingetreten (`controllerchange`). */
  activated: boolean;
  /** Neue Version bereit/aktiv — dieses Dokument braucht nur einen Reload. */
  reloadRequired: boolean;
  /** Positiver Fehlerbeweis (abgelehnte Aktivierungsanfrage). */
  failed: boolean;
  /** Browser-Fakt der letzten Synchronisation. */
  waiting: boolean;
  /** Browser-Fakt der letzten Synchronisation. */
  controlled: boolean;
  /** Fakten neu lesen, Snapshot zurueckgeben. */
  syncFacts: () => PwaUpdateSnapshot;
  applyUpdate: () => PwaApplyOutcome;
  /** Kann ein erneuter Aktivierungsversuch ueberhaupt etwas anstossen? */
  hasWaitingWorker: () => boolean;
  /** Beim Ablauf des Watchdogs: Fakten lesen und einordnen. */
  assessActivation: () => PwaActivationAssessment;
  dismissForNow: () => void;
}

/**
 * Praesentations-Schnittstelle fuer den PWA-Update-Lifecycle.
 *
 * Die UI bekommt genau diese Angaben und fasst weder
 * `navigator.serviceWorker` noch Workbox oder die Registration selbst an.
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

  const syncFacts = useCallback(() => pwaUpdateStore.syncFacts(), []);
  const applyUpdate = useCallback(() => pwaUpdateStore.applyUpdate(), []);
  const dismissForNow = useCallback(() => pwaUpdateStore.dismissForNow(), []);
  const hasWaitingWorker = useCallback(
    () => pwaUpdateStore.hasWaitingWorker(),
    [],
  );
  const assessActivation = useCallback(
    () => pwaUpdateStore.assessActivation(),
    [],
  );

  return {
    state: snapshot.state,
    updateAvailable: snapshot.updateAvailable,
    applying: snapshot.applying,
    activated: snapshot.activated,
    reloadRequired: snapshot.reloadRequired,
    failed: snapshot.failed,
    waiting: snapshot.waiting,
    controlled: snapshot.controlled,
    syncFacts,
    applyUpdate,
    hasWaitingWorker,
    assessActivation,
    dismissForNow,
  };
};
