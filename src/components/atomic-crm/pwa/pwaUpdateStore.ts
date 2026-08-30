/**
 * Technischer Lifecycle fuer PWA-Updates (Welle PWA-1B).
 *
 * Nora laeuft als PWA mit `vite-plugin-pwa` im `generateSW`-Modus und seit
 * PWA-1B mit `registerType: "prompt"`. Ein neuer Service Worker installiert
 * sich, bleibt aber WAITING, bis der Benutzer bewusst aktualisiert. Erst die
 * Aktivierung raeumt den Precache des alten Builds weg — solange die alte
 * Version laeuft, bleiben ihre Lazy Chunks verfuegbar.
 *
 * Dieses Modul ist bewusst framework- und UI-frei:
 * - keine React-Abhaengigkeit (der Hook liegt in `usePwaUpdate.ts`)
 * - keine sichtbaren Texte (die liegen in den i18n-Katalogen)
 * - kein direkter Zugriff auf `navigator.serviceWorker` aus der UI
 *
 * WICHTIG: Ein PWA-Update ist KEINE Business-Operation. Es wird bewusst nicht
 * ueber den OperationManager, `operationId` oder Idempotency-Keys modelliert —
 * siehe docs/nora/03-data-model-guardrails.md, Falle 37.
 */

/** Registrierungsfunktion aus `virtual:pwa-register` (injiziert, s. `pwaRegistration.ts`). */
export interface RegisterSwLike {
  (options: {
    onNeedRefresh?: () => void;
    onRegisteredSW?: (
      swUrl: string,
      registration?: ServiceWorkerRegistration,
    ) => void;
    onRegisterError?: (error: unknown) => void;
  }): (reloadPage?: boolean) => Promise<void>;
}

export type PwaUpdateState = "idle" | "updateAvailable" | "applying";

export interface PwaUpdateSnapshot {
  state: PwaUpdateState;
  updateAvailable: boolean;
  applying: boolean;
}

export interface PwaUpdateStoreOptions {
  /** Nur fuer Tests: sonst `Date.now`. */
  now?: () => number;
  /**
   * Nur fuer Tests: sonst `window`. Traegt `visibilitychange`, damit die
   * Rueckkehr auf den Tab eine (gedrosselte) Update-Pruefung ausloesen kann.
   */
  target?: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  /** Nur fuer Tests: sonst `() => navigator.onLine`. */
  isOnline?: () => boolean;
}

/**
 * Nora bleibt als Arbeitsanwendung lange geoeffnet. Der Browser prueft von sich
 * aus nur bei Navigationen auf einen neuen Worker — ohne eigene Pruefung wuerde
 * ein Deployment in einem tagelang offenen Tab nie ankommen. Gleichzeitig darf
 * daraus keine Polling-Schleife werden: `sw.js` wird mit `max-age=0` als
 * bedingter Request ausgeliefert, aber jeder Check kostet trotzdem eine
 * Verbindung. Ein Stundenintervall plus eine gedrosselte Pruefung beim
 * Zurueckkehren auf den Tab deckt den realen Release-Rhythmus (wenige Deploys
 * pro Tag) ab, ohne im Leerlauf Last zu erzeugen.
 */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Mindestabstand zwischen zwei Pruefungen, egal wodurch sie ausgeloest werden. */
export const UPDATE_CHECK_MIN_INTERVAL_MS = 30 * 60 * 1000;

/**
 * „Spaeter" verwirft das Update nicht — der Worker bleibt WAITING und der
 * Hinweis darf spaeter erneut erscheinen.
 *
 * Zwei Stunden (PWA-1C, vorher eine Stunde): das Panel ist seit PWA-1C ein
 * prominentes Systemereignis, kein kleiner Toast mehr. Bei einer Stunde
 * erschiene es an einem Arbeitstag bis zu achtmal — bei einem Ereignis dieser
 * Groesse waere das Draengeln. Zwei Stunden ergeben hoechstens drei bis vier
 * Gelegenheiten pro Tag: der Hinweis verschwindet nicht praktisch fuer immer,
 * ohne zur Wiedervorlage-Maschine zu werden. Eine einfache, deterministische
 * Regel — bewusst keine Eskalationsstufen.
 *
 * Zusaetzlich erscheint der Hinweis beim naechsten App-Start ohnehin wieder,
 * weil die Ablehnung bewusst nur im Speicher lebt (kein LocalStorage), und ein
 * *neu* gefundenes Update hebt eine fruehere Ablehnung sofort auf.
 */
export const DISMISS_RESHOW_AFTER_MS = 2 * 60 * 60 * 1000;

const IDLE_SNAPSHOT: PwaUpdateSnapshot = {
  state: "idle",
  updateAvailable: false,
  applying: false,
};

export interface PwaUpdateStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => PwaUpdateSnapshot;
  /** Registriert den Service Worker. Mehrfachaufrufe sind wirkungslos. */
  start: (registerSw: RegisterSwLike) => void;
  /** Aktiviert den wartenden Worker; der Reload erfolgt danach durch den Client. */
  applyUpdate: () => void;
  /** Hinweis vorerst ausblenden; der wartende Worker bleibt erhalten. */
  dismissForNow: () => void;
  /** Timer/Listener abbauen (Tests, HMR). */
  stop: () => void;
  /**
   * Vollstaendig auf den Anfangszustand zuruecksetzen (`stop()` plus Zustand).
   *
   * Existiert fuer Tests: `pwaUpdateStore` ist prozessweit, und `applying` ist
   * im echten Betrieb ein Endzustand — die Seite laedt danach neu. Ohne Reset
   * wuerde ein Test, der einmal aktualisiert hat, alle folgenden vergiften.
   * Im Produktionscode wird das nie aufgerufen.
   */
  reset: () => void;
}

export const createPwaUpdateStore = (
  options: PwaUpdateStoreOptions = {},
): PwaUpdateStore => {
  const now = options.now ?? (() => Date.now());
  const isOnline = options.isOnline ?? (() => navigator.onLine);
  const target =
    options.target ?? (typeof window === "undefined" ? undefined : window);

  const listeners = new Set<() => void>();

  let started = false;
  let needRefresh = false;
  let applying = false;
  let dismissedUntil = 0;
  let registration: ServiceWorkerRegistration | undefined;
  let updateServiceWorker:
    | ((reloadPage?: boolean) => Promise<void>)
    | undefined;
  let lastCheckedAt = 0;
  let intervalId: ReturnType<typeof setInterval> | undefined;
  let reshowTimeoutId: ReturnType<typeof setTimeout> | undefined;
  let snapshot: PwaUpdateSnapshot = IDLE_SNAPSHOT;

  const emit = () => {
    for (const listener of listeners) listener();
  };

  /**
   * Der Snapshot muss referenziell stabil bleiben, sonst rendert
   * `useSyncExternalStore` endlos.
   */
  const refresh = () => {
    const visible = needRefresh && dismissedUntil <= now();
    const state: PwaUpdateState = applying
      ? "applying"
      : visible
        ? "updateAvailable"
        : "idle";
    if (
      snapshot.state === state &&
      snapshot.updateAvailable === visible &&
      snapshot.applying === applying
    ) {
      return;
    }
    snapshot =
      state === "idle"
        ? IDLE_SNAPSHOT
        : { state, updateAvailable: visible, applying };
    emit();
  };

  const checkForUpdate = () => {
    // Offline liefert `registration.update()` keinen sinnvollen Befund und darf
    // vor allem keinen falschen „neue Version"-Hinweis erzeugen.
    if (!registration || !isOnline()) return;
    const timestamp = now();
    if (timestamp - lastCheckedAt < UPDATE_CHECK_MIN_INTERVAL_MS) return;
    lastCheckedAt = timestamp;
    void registration.update().catch(() => {
      // Ein fehlgeschlagener Check ist kein Anwendungsfehler: die laufende
      // Version bleibt gueltig, der naechste Versuch folgt ohnehin.
    });
  };

  const handleVisibility = () => {
    if (document.visibilityState === "visible") checkForUpdate();
  };

  const start: PwaUpdateStore["start"] = (registerSw) => {
    // StrictMode montiert Effekte doppelt — der Worker darf trotzdem nur einmal
    // registriert werden.
    if (started) return;
    started = true;

    updateServiceWorker = registerSw({
      onNeedRefresh: () => {
        needRefresh = true;
        // Ein neu gefundenes Update hebt eine fruehere Ablehnung auf: sie galt
        // der damaligen Version, nicht dieser.
        dismissedUntil = 0;
        refresh();
      },
      onRegisteredSW: (_swUrl, r) => {
        registration = r;
        lastCheckedAt = now();
        if (!r) return;
        intervalId = setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
        target?.addEventListener("visibilitychange", handleVisibility);
      },
      onRegisterError: () => {
        // Ohne Registrierung gibt es kein Update-Signal. Die laufende Version
        // funktioniert unveraendert weiter — kein Grund, den Nutzer zu stoeren.
      },
    });
  };

  const applyUpdate: PwaUpdateStore["applyUpdate"] = () => {
    // Doppelklick, bereits laufendes Update oder gar kein wartender Worker:
    // in allen drei Faellen darf nichts passieren.
    if (applying || !needRefresh || !updateServiceWorker) return;
    applying = true;
    refresh();
    // Der Client aus `virtual:pwa-register` schickt SKIP_WAITING und laedt die
    // Seite neu, sobald der neue Worker die Kontrolle uebernimmt. Ein eigener
    // Reload wuerde damit kollidieren.
    void updateServiceWorker().catch(() => {
      applying = false;
      refresh();
    });
  };

  const dismissForNow: PwaUpdateStore["dismissForNow"] = () => {
    if (!needRefresh || applying) return;
    dismissedUntil = now() + DISMISS_RESHOW_AFTER_MS;
    if (reshowTimeoutId !== undefined) clearTimeout(reshowTimeoutId);
    reshowTimeoutId = setTimeout(refresh, DISMISS_RESHOW_AFTER_MS);
    refresh();
  };

  const stop: PwaUpdateStore["stop"] = () => {
    if (intervalId !== undefined) clearInterval(intervalId);
    if (reshowTimeoutId !== undefined) clearTimeout(reshowTimeoutId);
    intervalId = undefined;
    reshowTimeoutId = undefined;
    target?.removeEventListener("visibilitychange", handleVisibility);
  };

  const reset: PwaUpdateStore["reset"] = () => {
    stop();
    started = false;
    needRefresh = false;
    applying = false;
    dismissedUntil = 0;
    registration = undefined;
    updateServiceWorker = undefined;
    lastCheckedAt = 0;
    snapshot = IDLE_SNAPSHOT;
    emit();
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    start,
    applyUpdate,
    dismissForNow,
    stop,
    reset,
  };
};

/**
 * Prozessweit genau ein Store: die Service-Worker-Registrierung ist ein
 * Fensterzustand, kein Komponentenzustand. Dadurch ueberlebt `updateAvailable`
 * jeden React-Remount, ohne dass dafuer LocalStorage noetig waere.
 */
export const pwaUpdateStore = createPwaUpdateStore();
