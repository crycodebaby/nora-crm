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
 * ueber den OperationManager, `operationId` oder Idempotency-Keys modelliert:
 * es berichtet ueber die Anwendung, nicht ueber eine Aktion des Benutzers, und
 * hat weder fachliches Ergebnis noch Wiederholbarkeit im Sinne eines Commands.
 *
 * ZWEI GETRENNTE WAHRHEITEN (Korrektur nach dem Final Review des ersten RC):
 *
 *   `applying`  — die Aktivierung wurde ANGEFORDERT (SKIP_WAITING gesendet).
 *   `activated` — der Browser hat die Uebernahme tatsaechlich VOLLZOGEN
 *                 (`controllerchange` auf `navigator.serviceWorker`).
 *
 * Das eine folgt nicht aus dem anderen. `updateServiceWorker()` aus
 * `virtual:pwa-register` sieht im ausgelieferten Production-Client
 * (vite-plugin-pwa 1.2.0, `dist/client/build/register.js`) so aus:
 *
 *     const updateServiceWorker = async () => {
 *       await registerPromise;            // lehnt nie ab: register() faengt alles
 *       if (!auto) sendSkipWaitingMessage?.();   // void postMessage, kein await
 *     };
 *
 * und `Workbox.messageSkipWaiting()` verwirft das Promise von `messageSW()`
 * und tut ohne wartenden Worker sogar gar nichts. Das Promise traegt also
 * KEINE Information darueber, ob aktiviert wurde. Wer daraus „erfolgreich"
 * ableitet, baut eine Luege in den Contract — genau das war der Defekt, den
 * der Review gefunden hat.
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
  /** Die Aktivierung wurde angefordert — nicht: sie ist gelungen. */
  applying: boolean;
  /**
   * Der Browser hat einen neuen Worker die Kontrolle uebernehmen lassen.
   * Einziges belastbares Erfolgssignal; im Normalfall laedt der Client die
   * Seite unmittelbar danach neu.
   */
  activated: boolean;
}

export interface PwaUpdateStoreOptions {
  /** Nur fuer Tests: sonst `Date.now`. */
  now?: () => number;
  /**
   * Nur fuer Tests: sonst `window`. Traegt `visibilitychange`, damit die
   * Rueckkehr auf den Tab eine (gedrosselte) Update-Pruefung ausloesen kann.
   */
  target?: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  /**
   * Nur fuer Tests: sonst `navigator.serviceWorker`. Traegt
   * `controllerchange` — das einzige Signal, das eine tatsaechliche
   * Worker-Uebernahme belegt.
   */
  serviceWorkerTarget?: Pick<
    EventTarget,
    "addEventListener" | "removeEventListener"
  >;
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
  activated: false,
};

export interface PwaUpdateStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => PwaUpdateSnapshot;
  /** Registriert den Service Worker. Mehrfachaufrufe sind wirkungslos. */
  start: (registerSw: RegisterSwLike) => void;
  /**
   * Fordert die Aktivierung des wartenden Workers an (SKIP_WAITING).
   *
   * Bewusst nicht „aktiviert den Worker": ob die Uebernahme gelingt, sagt erst
   * `activated`. Der Reload erfolgt danach durch den Client von
   * `virtual:pwa-register`, sobald `controllerchange` eintritt.
   */
  applyUpdate: () => void;
  /**
   * Steht aktuell ein Worker WAITING?
   *
   * Fuer die Recovery-Oberflaeche: nur dann kann ein erneuter
   * Aktivierungsversuch ueberhaupt etwas anstossen — `messageSkipWaiting()`
   * tut ohne wartenden Worker nachweislich gar nichts. Bewusst eine Abfrage
   * und kein Snapshot-Feld: der Wert wird genau einmal gebraucht, im Moment
   * des Wechsels in den Recovery-Zustand.
   */
  hasWaitingWorker: () => boolean;
  /**
   * Beendet den Aktivierungsversuch, dessen Uebernahme ausgeblieben ist, und
   * meldet, ob ein zweiter Versuch technisch ueberhaupt etwas bewirken kann.
   *
   * **Warum es das geben muss.** `applyUpdate()` sperrt auf `applying`, und
   * `applying` fiel auf dem Watchdog-Pfad nie wieder auf `false`: das Promise
   * lehnt in Production praktisch nie ab (siehe Modulkopf), und `reset()` wird
   * dort nie aufgerufen. „Erneut versuchen" lief damit in genau diesen Guard
   * und schickte kein zweites SKIP_WAITING — der Knopf spielte acht Sekunden
   * Choreografie ab und tat nichts. Genau dieser Uebergang schliesst das.
   *
   * **Bewusst kein `reset()`.** Beendet wird ausschliesslich der eine Versuch.
   * `needRefresh`, die Registration, der wartende Worker, die Listener und die
   * Update-Callbacks bleiben unangetastet — ein Retry darf keinen technischen
   * Zustand verlieren.
   *
   * Fall A, ein Worker wartet weiterhin: der Versuch endet, `applying` faellt
   * kontrolliert auf `false`, ein zweiter `applyUpdate()` ist wieder moeglich.
   * Rueckgabe `true`.
   *
   * Fall B, kein wartender Worker mehr: ein zweites SKIP_WAITING waere
   * nachweislich wirkungslos (`messageSkipWaiting()` tut dann gar nichts). Der
   * Versuch bleibt stehen, und die Oberflaeche bietet den kontrollierten
   * Reload an. Rueckgabe `false`. Ebenso, wenn die Uebernahme doch noch
   * eingetreten ist — dann gibt es nichts zu wiederholen.
   *
   * Idempotent: der Rueckgabewert haengt am Weltzustand, nicht daran, ob
   * dieser Aufruf etwas veraendert hat. React StrictMode ruft Effekte doppelt
   * auf, und der zweite Aufruf muss dieselbe Antwort geben wie der erste.
   */
  endStalledActivation: () => boolean;
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
  const serviceWorkerTarget =
    options.serviceWorkerTarget ??
    (typeof navigator === "undefined" || !("serviceWorker" in navigator)
      ? undefined
      : navigator.serviceWorker);

  const listeners = new Set<() => void>();

  let started = false;
  let needRefresh = false;
  let applying = false;
  let activated = false;
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
      snapshot.applying === applying &&
      snapshot.activated === activated
    ) {
      return;
    }
    snapshot =
      state === "idle" && !activated
        ? IDLE_SNAPSHOT
        : { state, updateAvailable: visible, applying, activated };
    emit();
  };

  /**
   * Das einzige belastbare Erfolgssignal.
   *
   * Der Client von `virtual:pwa-register` haengt seinen Reload an dasselbe
   * Ereignis; im Normalfall ist die Seite deshalb Sekundenbruchteile spaeter
   * ohnehin weg. Der Store haelt es trotzdem fest, damit der Watchdog in der
   * Praesentation den Erfolgsfall sicher vom Ausbleiben unterscheiden kann —
   * auch wenn der Reload selbst noch etwas braucht.
   */
  const handleControllerChange = () => {
    if (activated) return;
    activated = true;
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
    if (document.visibilityState === "visible") checkForUpdate();
  };

  const start: PwaUpdateStore["start"] = (registerSw) => {
    // StrictMode montiert Effekte doppelt — der Worker darf trotzdem nur einmal
    // registriert werden.
    if (started) return;
    started = true;

    // Bewusst hier und nicht erst in `onRegisteredSW`: `controllerchange` ist
    // ein Ereignis des Containers, nicht der Registrierung, und muss auch dann
    // ankommen, wenn der Client keine Registration durchreicht.
    serviceWorkerTarget?.addEventListener(
      "controllerchange",
      handleControllerChange,
    );

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
    // Ab hier zaehlt nur, was NACH der Anfrage passiert. Ein frueheres
    // `controllerchange` (etwa aus einem anderen Tab) darf den Erfolg dieses
    // Versuchs nicht vorwegnehmen.
    activated = false;
    refresh();
    // Der Client aus `virtual:pwa-register` schickt SKIP_WAITING und laedt die
    // Seite neu, sobald der neue Worker die Kontrolle uebernimmt. Ein eigener
    // Reload wuerde damit kollidieren.
    //
    // Das Promise wird bewusst NICHT als Erfolg gelesen — es resolved auch
    // dann, wenn gar kein Worker wartete und `messageSkipWaiting()` nichts
    // getan hat (siehe Modulkopf). Der `catch` bleibt trotzdem stehen: lehnt
    // es doch einmal ab, ist das ein echter, sofort bekannter Fehlschlag.
    void updateServiceWorker().catch(() => {
      applying = false;
      refresh();
    });
  };

  const hasWaitingWorker: PwaUpdateStore["hasWaitingWorker"] = () =>
    Boolean(registration?.waiting);

  const endStalledActivation: PwaUpdateStore["endStalledActivation"] = () => {
    // Die Uebernahme ist doch noch eingetreten: dann ist nichts steckengeblieben.
    // `activated` gewinnt, und die Praesentation verlaesst den Recovery-Zustand
    // ohnehin von selbst.
    if (activated) return false;
    const retryable = hasWaitingWorker();
    if (retryable && applying) {
      applying = false;
      refresh();
    }
    return retryable;
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
    serviceWorkerTarget?.removeEventListener(
      "controllerchange",
      handleControllerChange,
    );
  };

  const reset: PwaUpdateStore["reset"] = () => {
    stop();
    started = false;
    needRefresh = false;
    applying = false;
    activated = false;
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
    hasWaitingWorker,
    endStalledActivation,
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
