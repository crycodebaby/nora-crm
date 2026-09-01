/**
 * Technischer Lifecycle fuer PWA-Updates (Wellen PWA-1B, PWA-1C.2/1C.3,
 * PWA Update State Contract V2).
 *
 * Nora laeuft als PWA mit `vite-plugin-pwa` im `generateSW`-Modus und seit
 * PWA-1B mit `registerType: "prompt"`. Ein neuer Service Worker installiert
 * sich, bleibt aber WAITING, solange ein kontrolliertes Dokument den alten
 * Worker benutzt. Erst die Aktivierung raeumt den Precache des alten Builds
 * weg — solange die alte Version laeuft, bleiben ihre Lazy Chunks verfuegbar.
 *
 * Dieses Modul ist bewusst framework- und UI-frei:
 * - keine React-Abhaengigkeit (der Hook liegt in `usePwaUpdate.ts`)
 * - keine sichtbaren Texte (die liegen in den i18n-Katalogen)
 * - kein direkter Zugriff auf `navigator.serviceWorker` aus der UI
 *
 * WICHTIG: Ein PWA-Update ist KEINE Business-Operation. Es wird bewusst nicht
 * ueber den OperationManager, `operationId` oder Idempotency-Keys modelliert.
 *
 * ---------------------------------------------------------------------------
 * DER BROWSER IST DIE WAHRHEIT (V2)
 * ---------------------------------------------------------------------------
 *
 * `onNeedRefresh` aus `virtual:pwa-register` ist nur ein ENTDECKUNGSSIGNAL.
 * Es bedeutet NICHT, dass ein Worker wartet, NICHT, dass SKIP_WAITING etwas
 * bewirken wird, und NICHT, dass dieses Dokument jemals ein
 * `controllerchange` sehen wird. Im ausgelieferten Client (vite-plugin-pwa
 * 1.2.0, Prompt-Modus) feuert der Callback fuer „externe" Funde — bei Noras
 * stuendlicher Pruefung der Normalfall — bereits beim `installed`-Ereignis,
 * 200 ms bevor workbox-window ueberhaupt entscheidet, ob der Worker wartet.
 *
 * Reproduziert (Chromium, zwei echte Builds): ist dieses Dokument nicht
 * kontrolliert (`navigator.serviceWorker.controller === null` — Erstbesuch,
 * Hard Reload, geloeschte Site-Daten), benutzt kein Client die
 * Registrierung, und der neue Worker aktiviert sich 2 ms nach `installed`
 * von selbst. `registration.waiting` ist danach null, ein SKIP_WAITING geht
 * ins Leere, und `controllerchange` erreicht ein unkontrolliertes Dokument
 * per Spezifikation nie. Die neue Version ist dann laengst aktiv — das
 * Dokument braucht nur einen Reload. Genau das ist `reloadRequired`.
 *
 * Deshalb liest der Store an jedem Entscheidungspunkt die Browser-Fakten
 * selbst (`syncFacts()`): Controller, wartender Worker, aktiver Worker. Kein
 * Polling — Zustandswechsel des Workers (`statechange`), `controllerchange`
 * und die Rueckkehr auf den Tab sind die Resynchronisationspunkte.
 *
 * ZWEI GETRENNTE WAHRHEITEN bleiben erhalten:
 *
 *   `applying`  — die Aktivierung wurde ANGEFORDERT (SKIP_WAITING gesendet).
 *   `activated` — der Browser hat die Uebernahme tatsaechlich VOLLZOGEN
 *                 (`controllerchange` auf `navigator.serviceWorker`).
 *
 * `activated` ist MONOTON: einmal `true`, bleibt es bis zum Reload `true`
 * (PWA-1C.3). Kein Retry, kein Commit, kein Watchdog nimmt es zurueck;
 * `reset()` ist die Testentsprechung des Reloads.
 *
 * `updateServiceWorker()` aus `virtual:pwa-register` lehnt in Production
 * praktisch nie ab (`register()` faengt alles, `messageSkipWaiting()` ist ein
 * void postMessage). Das Promise traegt KEINE Information ueber Erfolg. Lehnt
 * es doch ab, ist das der einzige positive Fehlerbeweis — und nur dann gilt
 * `failed`. Ein Timeout allein ist nie ein Fehler.
 *
 * Einzige Nebenwirkung ausserhalb des Snapshots (2026-09-01): eine
 * vollzogene Uebernahme hinterlaesst ein Bit im `sessionStorage`, damit die
 * frisch geladene Version den Abschluss einmal bestaetigen kann
 * (`pwaUpdateCompletion.ts`). Der State Contract selbst ist unveraendert.
 */

import { markUpdateCompleted } from "./pwaUpdateCompletion";

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

export type PwaUpdateState =
  | "idle"
  | "updateAvailable"
  | "applying"
  | "reloadRequired"
  | "failed";

export interface PwaUpdateSnapshot {
  state: PwaUpdateState;
  /** Ein Update ist entdeckt und der Hinweis nicht verschoben. */
  updateAvailable: boolean;
  /** Die Aktivierung wurde angefordert — nicht: sie ist gelungen. */
  applying: boolean;
  /**
   * Der Browser hat einen neuen Worker die Kontrolle uebernehmen lassen.
   * MONOTON innerhalb einer Dokument-Lebensdauer (siehe Modulkopf).
   */
  activated: boolean;
  /**
   * Die neue Version ist bereit oder bereits aktiv, und DIESES Dokument
   * braucht nur noch einen Reload. Kein Fehler. Siehe `deriveReloadRequired`.
   */
  reloadRequired: boolean;
  /** Positiver Fehlerbeweis: die Aktivierungsanfrage wurde abgelehnt. */
  failed: boolean;
  /** Browser-Fakt: `registration.waiting` existiert (Stand der letzten Sync). */
  waiting: boolean;
  /** Browser-Fakt: `navigator.serviceWorker.controller` existiert. */
  controlled: boolean;
}

/** Was `applyUpdate()` tatsaechlich getan hat. */
export type PwaApplyOutcome =
  | "requested"
  | "reloadRequired"
  | "activated"
  | "noop";

/** Was der Watchdog beim Ablauf der Frist vorfindet. */
export type PwaActivationAssessment =
  | "activated"
  | "reloadRequired"
  | "waiting"
  | "failed"
  | "nothing";

export interface PwaUpdateStoreOptions {
  /** Nur fuer Tests: sonst `Date.now`. */
  now?: () => number;
  /** Nur fuer Tests: sonst `window`. Traegt `visibilitychange`. */
  target?: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  /** Nur fuer Tests: sonst `navigator.serviceWorker`. Traegt `controllerchange`. */
  serviceWorkerTarget?: Pick<
    EventTarget,
    "addEventListener" | "removeEventListener"
  >;
  /** Nur fuer Tests: sonst `() => navigator.onLine`. */
  isOnline?: () => boolean;
  /**
   * Nur fuer Tests und den DEV-Harness: sonst
   * `() => navigator.serviceWorker.controller`.
   */
  getController?: () => ServiceWorker | null | undefined;
}

/**
 * Nora bleibt als Arbeitsanwendung lange geoeffnet. Der Browser prueft von sich
 * aus nur bei Navigationen auf einen neuen Worker — ohne eigene Pruefung wuerde
 * ein Deployment in einem tagelang offenen Tab nie ankommen. Ein Stundenintervall
 * plus eine gedrosselte Pruefung beim Zurueckkehren auf den Tab deckt den realen
 * Release-Rhythmus ab, ohne im Leerlauf Last zu erzeugen.
 */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Mindestabstand zwischen zwei Pruefungen, egal wodurch sie ausgeloest werden. */
export const UPDATE_CHECK_MIN_INTERVAL_MS = 30 * 60 * 1000;

/**
 * „Spaeter" verwirft das Update nicht — der Worker bleibt WAITING und der
 * Hinweis darf spaeter erneut erscheinen. Zwei Stunden (PWA-1C): hoechstens
 * drei bis vier Gelegenheiten pro Arbeitstag. Die Ablehnung lebt nur im
 * Speicher, und ein NEUER Fakt (neues Update, Uebernahme) hebt sie auf.
 */
export const DISMISS_RESHOW_AFTER_MS = 2 * 60 * 60 * 1000;

export interface PwaUpdateStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => PwaUpdateSnapshot;
  /**
   * Registriert den Service Worker. Mehrfachaufrufe sind wirkungslos.
   * `overrides` existiert fuer Tests und den DEV-Harness, die einen
   * abweichenden Controller-Fakt einspeisen muessen.
   */
  start: (
    registerSw: RegisterSwLike,
    overrides?: Pick<PwaUpdateStoreOptions, "getController">,
  ) => void;
  /**
   * Liest die Browser-Fakten neu und gibt den aktuellen Snapshot zurueck.
   * Der eine Synchronisationspunkt, den alle Entscheidungen benutzen.
   */
  syncFacts: () => PwaUpdateSnapshot;
  /**
   * Fordert die Aktivierung des wartenden Workers an (SKIP_WAITING) — aber
   * erst, nachdem die Browser-Fakten neu gelesen wurden.
   *
   * - bereits uebernommen: `activated`, keine Anfrage
   * - nichts wartet, neue Version aktiv oder Dokument unkontrolliert:
   *   `reloadRequired`, keine Anfrage
   * - ein Worker wartet: genau eine Anfrage, `requested`
   * - sonst `noop` (laufender Versuch, kein Update, Fehler)
   */
  applyUpdate: () => PwaApplyOutcome;
  /** Steht aktuell ein Worker WAITING? Liest den Browser, nicht den Snapshot. */
  hasWaitingWorker: () => boolean;
  /**
   * Beim Ablauf des Watchdogs: Fakten neu lesen und einordnen.
   *
   * `waiting`: die Uebernahme steht aus, ein Worker wartet weiterhin. Der
   * laufende Versuch wird beendet (`applying` faellt), damit ein zweiter,
   * begrenzter Versuch eine echte zweite Anfrage senden kann. Idempotent —
   * StrictMode ruft Effekte doppelt auf, beide Aufrufe antworten gleich.
   */
  assessActivation: () => PwaActivationAssessment;
  /** Hinweis vorerst ausblenden; der wartende Worker bleibt erhalten. */
  dismissForNow: () => void;
  /** Timer/Listener abbauen (Tests, HMR). */
  stop: () => void;
  /**
   * Vollstaendig auf den Anfangszustand zuruecksetzen (`stop()` plus Zustand).
   * Existiert fuer Tests: der Store ist prozessweit, und im echten Betrieb
   * beendet der Reload das Dokument. Die einzige Stelle, die `activated`
   * wieder auf `false` setzen darf.
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
  const hasServiceWorker =
    typeof navigator !== "undefined" && "serviceWorker" in navigator;
  const serviceWorkerTarget =
    options.serviceWorkerTarget ??
    (hasServiceWorker ? navigator.serviceWorker : undefined);
  const defaultGetController = () =>
    hasServiceWorker ? navigator.serviceWorker.controller : null;
  let getController = options.getController ?? defaultGetController;

  const listeners = new Set<() => void>();

  let started = false;
  let needRefresh = false;
  let applying = false;
  let activated = false;
  let failed = false;
  let dismissedUntil = 0;
  let registration: ServiceWorkerRegistration | undefined;
  let updateServiceWorker:
    | ((reloadPage?: boolean) => Promise<void>)
    | undefined;
  let lastCheckedAt = 0;
  let intervalId: ReturnType<typeof setInterval> | undefined;
  let reshowTimeoutId: ReturnType<typeof setTimeout> | undefined;

  // Browser-Fakten, Stand der letzten Synchronisation.
  let controlled = false;
  let waiting = false;
  let installing = false;
  let activeIsNotController = false;

  /** Worker, deren `statechange` der Store gerade beobachtet. */
  const observedWorkers = new Set<ServiceWorker>();

  let snapshot: PwaUpdateSnapshot = {
    state: "idle",
    updateAvailable: false,
    applying: false,
    activated: false,
    reloadRequired: false,
    failed: false,
    waiting: false,
    controlled: false,
  };

  const emit = () => {
    for (const listener of listeners) listener();
  };

  /**
   * Die Invariante hinter `reloadRequired`:
   *
   *   activated
   *   ∨ ( discovered ∧ ¬waiting ∧ ¬installing
   *       ∧ ( ¬controlled ∨ active ≠ controller ) )
   *
   * Lesart: Ein Update wurde entdeckt, es wartet und installiert nichts
   * mehr — der entdeckte Worker ist also aktiv geworden — und dieses
   * Dokument haengt nicht an ihm: entweder weil es gar keinen Controller hat
   * (dann wird es auch nie eines bekommen; kein `clients.claim()`), oder weil
   * der aktive Worker nicht sein Controller ist. In beiden Faellen ist
   * SKIP_WAITING sinnlos und ein Reload die einzige ehrliche Aktion.
   *
   * Bewusst NICHT `waiting === null` allein: ohne entdecktes Update sagt ein
   * fehlender wartender Worker nur, dass es nichts zu tun gibt; waehrend
   * `installing` ersetzt gerade ein noch neuerer Worker den entdeckten.
   */
  const deriveReloadRequired = () =>
    !failed &&
    (activated ||
      (needRefresh &&
        !waiting &&
        !installing &&
        (!controlled || activeIsNotController)));

  /** Der Snapshot muss referenziell stabil bleiben (`useSyncExternalStore`). */
  const refresh = () => {
    const hidden = dismissedUntil > now();
    const reloadRequired = deriveReloadRequired();
    const visible = !hidden && !applying;
    const state: PwaUpdateState = failed
      ? visible
        ? "failed"
        : "idle"
      : reloadRequired
        ? visible || applying
          ? "reloadRequired"
          : "idle"
        : applying
          ? "applying"
          : needRefresh && visible
            ? "updateAvailable"
            : "idle";
    const next: PwaUpdateSnapshot = {
      state,
      updateAvailable: state === "updateAvailable",
      applying,
      activated,
      reloadRequired,
      failed,
      waiting,
      controlled,
    };
    if (
      snapshot.state === next.state &&
      snapshot.updateAvailable === next.updateAvailable &&
      snapshot.applying === next.applying &&
      snapshot.activated === next.activated &&
      snapshot.reloadRequired === next.reloadRequired &&
      snapshot.failed === next.failed &&
      snapshot.waiting === next.waiting &&
      snapshot.controlled === next.controlled
    ) {
      return;
    }
    snapshot = next;
    emit();
  };

  const readFacts = () => {
    const controller = getController() ?? null;
    controlled = Boolean(controller);
    waiting = Boolean(registration?.waiting);
    installing = Boolean(registration?.installing);
    const active = registration?.active ?? null;
    activeIsNotController = Boolean(active) && active !== controller;
  };

  const handleWorkerStateChange = () => {
    readFacts();
    refresh();
  };

  /**
   * Beobachtet einen Worker bis zu seinem naechsten Zustandswechsel. Das ist
   * der ereignisbasierte Ersatz fuer Polling: `installed → activating` ist
   * genau der Uebergang, der den Fakt „wartet" in „aktiv" verwandelt.
   */
  const observe = (worker: ServiceWorker | null | undefined) => {
    if (!worker || observedWorkers.has(worker)) return;
    if (typeof worker.addEventListener !== "function") return;
    observedWorkers.add(worker);
    worker.addEventListener("statechange", handleWorkerStateChange);
  };

  const unobserveAll = () => {
    for (const worker of observedWorkers) {
      worker.removeEventListener("statechange", handleWorkerStateChange);
    }
    observedWorkers.clear();
  };

  const syncFacts: PwaUpdateStore["syncFacts"] = () => {
    readFacts();
    observe(registration?.installing);
    observe(registration?.waiting);
    refresh();
    return snapshot;
  };

  /** Das einzige belastbare Erfolgssignal einer Uebernahme in DIESEM Dokument. */
  const handleControllerChange = () => {
    if (activated) return;
    activated = true;
    // Die Uebernahme ist der Erfolg — und der Reload folgt ihr unmittelbar
    // (im kontrollierten Tab laedt der Client aus `virtual:pwa-register`
    // synchron in seinem eigenen `controllerchange`-Listener neu). Deshalb
    // hier, vor jedem `emit()`: dieser Listener steht vor dem Workbox-
    // Listener, das Bit ist also gesetzt, bevor der Reload beginnt. Kein
    // Zustand dieses Stores — nur die Uebergabe an das naechste Dokument
    // (siehe `pwaUpdateCompletion.ts`).
    markUpdateCompleted();
    // Ein neuer Fakt hebt eine fruehere Ablehnung auf: sie galt einem
    // Hinweis, nicht einer vollzogenen Uebernahme.
    dismissedUntil = 0;
    readFacts();
    refresh();
  };

  const handleUpdateFound = () => {
    observe(registration?.installing);
    readFacts();
    refresh();
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
    if (document.visibilityState !== "visible") return;
    // Rueckkehr auf den Tab: erst die Wahrheit neu lesen (ein anderer Tab
    // kann inzwischen aktiviert haben), dann gedrosselt nach Neuem suchen.
    syncFacts();
    checkForUpdate();
  };

  const start: PwaUpdateStore["start"] = (registerSw, overrides) => {
    // StrictMode montiert Effekte doppelt — der Worker darf trotzdem nur einmal
    // registriert werden.
    if (started) return;
    started = true;
    if (overrides?.getController) getController = overrides.getController;

    // Bewusst hier und nicht erst in `onRegisteredSW`: `controllerchange` ist
    // ein Ereignis des Containers, nicht der Registrierung.
    serviceWorkerTarget?.addEventListener(
      "controllerchange",
      handleControllerChange,
    );
    readFacts();

    updateServiceWorker = registerSw({
      onNeedRefresh: () => {
        // Entdeckungssignal, keine Wahrheit: der Callback kommt beim
        // `installed`, und ob daraus ein wartender oder ein aktiver Worker
        // wird, entscheidet der Browser danach. Deshalb sofort die Fakten
        // lesen und den Worker bis zu seinem naechsten Zustandswechsel
        // beobachten.
        needRefresh = true;
        // Ein neu gefundenes Update hebt eine fruehere Ablehnung auf.
        dismissedUntil = 0;
        syncFacts();
      },
      onRegisteredSW: (_swUrl, r) => {
        registration = r;
        lastCheckedAt = now();
        if (!r) {
          refresh();
          return;
        }
        r.addEventListener?.("updatefound", handleUpdateFound);
        intervalId = setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
        target?.addEventListener("visibilitychange", handleVisibility);
        syncFacts();
      },
      onRegisterError: () => {
        // Ohne Registrierung gibt es kein Update-Signal. Die laufende Version
        // funktioniert unveraendert weiter — kein Grund, den Nutzer zu stoeren.
      },
    });
  };

  const applyUpdate: PwaUpdateStore["applyUpdate"] = () => {
    syncFacts();
    if (activated) return "activated";
    // Vor dem `applying`-Guard: auch waehrend eines laufenden Versuchs kann
    // der Browser inzwischen ohne uns aktiviert haben — dann gibt es nichts
    // mehr anzufordern, und die Antwort muss das sagen.
    if (deriveReloadRequired()) return "reloadRequired";
    if (applying || failed || !needRefresh || !updateServiceWorker) {
      return "noop";
    }
    if (!waiting) {
      // Entdeckt, aber nichts wartet und nichts installiert — der entdeckte
      // Worker ist ohne uns verschwunden (etwa durch ein noch neueres
      // Deployment, das noch nicht installiert ist). Ein SKIP_WAITING taete
      // nachweislich nichts; die Anfrage wird gar nicht erst gestellt.
      return "noop";
    }
    applying = true;
    refresh();
    // Das Promise wird bewusst NICHT als Erfolg gelesen (siehe Modulkopf).
    // Lehnt es ab, ist das der einzige positive Fehlerbeweis.
    void updateServiceWorker().catch(() => {
      applying = false;
      failed = true;
      refresh();
    });
    return "requested";
  };

  const hasWaitingWorker: PwaUpdateStore["hasWaitingWorker"] = () =>
    Boolean(registration?.waiting);

  const assessActivation: PwaUpdateStore["assessActivation"] = () => {
    syncFacts();
    if (activated) return "activated";
    if (failed) return "failed";
    if (deriveReloadRequired()) return "reloadRequired";
    if (waiting) {
      // Der Versuch endet kontrolliert, damit ein zweiter eine echte zweite
      // Anfrage senden kann. Kein Reset: Registrierung, Worker und Listener
      // bleiben unangetastet.
      if (applying) {
        applying = false;
        refresh();
      }
      return "waiting";
    }
    return "nothing";
  };

  const dismissForNow: PwaUpdateStore["dismissForNow"] = () => {
    if (applying) return;
    if (!needRefresh && !activated && !failed) return;
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
    serviceWorkerTarget?.removeEventListener(
      "controllerchange",
      handleControllerChange,
    );
    registration?.removeEventListener?.("updatefound", handleUpdateFound);
    unobserveAll();
  };

  const reset: PwaUpdateStore["reset"] = () => {
    stop();
    started = false;
    needRefresh = false;
    applying = false;
    activated = false;
    failed = false;
    dismissedUntil = 0;
    registration = undefined;
    updateServiceWorker = undefined;
    lastCheckedAt = 0;
    controlled = false;
    waiting = false;
    installing = false;
    activeIsNotController = false;
    getController = options.getController ?? defaultGetController;
    refresh();
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    start,
    syncFacts,
    applyUpdate,
    hasWaitingWorker,
    assessActivation,
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
