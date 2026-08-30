import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Praesentations-Zustandsmaschine der Update-Choreografie (Welle PWA-1C.1).
 *
 * **Warum das hier und nicht im Store.** `pwaUpdateStore` bildet den echten
 * Service-Worker-Lifecycle ab: `idle` / `updateAvailable` / `applying`. Diese
 * drei Zustaende sind technische Wahrheit — sie beschreiben, was der Browser
 * tut. Die acht Sekunden zwischen Klick und Aktivierung sind das genaue
 * Gegenteil: sie beschreiben, was *Nora zeigt*. Sie in den Store zu legen
 * hiesse, eine Praesentationsentscheidung als Worker-Zustand auszugeben; jeder
 * spaetere Leser des Stores muesste dann raten, welche Zustaende real sind.
 * Deshalb lebt die Choreografie ausschliesslich hier, lokal zur Komponente, und
 * der Store bleibt unangetastet.
 *
 * **Was die acht Sekunden NICHT sind.** Kein Download-Fortschritt, keine
 * Installationsphase, keine Messung. Der wartende Worker ist zu diesem
 * Zeitpunkt bereits vollstaendig installiert — es gibt technisch nichts zu
 * warten. Die Sequenz ist eine bewusste Uebergangsinszenierung. Genau deshalb
 * behauptet die Oberflaeche waehrenddessen keine Prozente, keine Schritte und
 * keinen Abschluss: sie zeigt nur, dass etwas vorbereitet wird. Eine
 * Fortschrittsanzeige ohne Messgroesse waere eine Luege ueber den eigenen
 * Zustand, und das ist der eine Fehler, den ein Systemereignis nicht machen
 * darf.
 *
 * **Genau ein `applyUpdate()`.** Abgesichert auf drei Ebenen: `start()` ist
 * gegen Wiedereintritt gesperrt (Doppelklick), die Aktionen verschwinden mit
 * dem ersten Klick aus dem Tab-Index, und der Commit selbst haengt an einem
 * Lauf-Token, das ihn pro Lauf einmal zulaesst. Letzteres traegt auch
 * React StrictMode: der Effekt wird dort doppelt montiert, die Refs ueberleben
 * das aber, weil es dieselbe Fiber ist.
 */

export type ChoreographyPhase =
  | "idle"
  | "settling"
  | "converging"
  | "sustaining"
  | "committing";

/** Was der Benutzer gerade sieht — abgeleitet, nicht gespeichert. */
export type ChoreographyPresentation =
  | "available"
  | "choreography"
  | "recovery";

/**
 * Start jeder Phase in Millisekunden nach dem Klick.
 *
 * - `settling` (0–1,2 s): Aktionen, Sicherheitshinweis und Zusicherung falten
 *   sich weg, das Panel beginnt sich neu zu proportionieren.
 * - `converging` (1,2–2,8 s): die Komposition zieht sich aufs Zentrum zusammen,
 *   der Orb waechst, die Aura breitet sich aus, der Titel loest sich auf.
 * - `sustaining` (2,8–7,5 s): ruhige Update-Szene — Orb, ein Titel, drei Punkte.
 * - `committing` (7,5–8,0 s): der Orb stabilisiert sich, die Aura zieht leicht
 *   nach innen und hellt auf. Optische Vorbereitung des Uebergangs.
 */
export const CHOREOGRAPHY_TIMELINE = {
  settling: 0,
  converging: 1200,
  sustaining: 2800,
  committing: 7500,
} as const;

/** Zeitpunkt des einzigen `applyUpdate()`-Aufrufs. */
export const CHOREOGRAPHY_COMMIT_MS = 8000;

/**
 * Wartezeit NACH `applyUpdate()`, bevor eine ausbleibende Uebernahme als
 * „dauert laenger als erwartet" gilt.
 *
 * **Warum es diesen Watchdog ueberhaupt braucht.** Die erste Fassung hat den
 * Fehlschlag am Zurueckfallen von `applying` erkannt, also am `catch` des
 * Promise von `updateServiceWorker()`. Der Final Review hat gezeigt, dass der
 * ausgelieferte Production-Client dieses Promise praktisch nie ablehnt (siehe
 * Modulkopf von `pwaUpdateStore.ts`) — die Erkennung lief damit ins Leere, und
 * der reale Fall „SKIP_WAITING gesendet, Uebernahme kommt nie" haette Nora
 * dauerhaft auf „wird aktualisiert" stehen lassen. Der Watchdog haengt deshalb
 * am einzigen belastbaren Erfolgssignal: `activated` (`controllerchange`).
 *
 * **Warum 5 Sekunden.** Gemessen gegen das echte generierte `sw.js` (38
 * Precache-Eintraege, `cleanupOutdatedCaches`) in Chromium 148, jeweils vom
 * `postMessage(SKIP_WAITING)` bis zum `controllerchange`:
 *
 *   ohne Drosselung      n=6   2–3 ms   (Median 2 ms)
 *   CPU-Drosselung 4x    n=5   2–34 ms  (Median 3 ms)
 *   CPU-Drosselung 20x   n=4   9–26 ms  (Median 11 ms)
 *
 * Der schlechteste beobachtete Wert liegt bei 34 ms. Fuenf Sekunden sind davon
 * rund das 150-Fache und decken zusaetzlich die Zeitgeber-Drosselung eines
 * Hintergrund-Tabs ab (Chrome rastert dort auf etwa eine Sekunde). Ein
 * falsch-positiver Recovery-Zustand ist damit praktisch ausgeschlossen, ohne
 * den Benutzer nach der ohnehin schon vergangenen Achtsekundensequenz noch
 * einmal minutenlang warten zu lassen.
 *
 * Die Frist beginnt bewusst erst NACH `applyUpdate()` — die acht Sekunden
 * Choreografie sind nicht eingerechnet.
 */
export const ACTIVATION_WATCHDOG_MS = 5000;

/**
 * Kurze Frist nach der Uebernahme, bevor Nora selbst neu laedt.
 *
 * **Warum Nora sich darauf nicht verlassen darf, dass der Client neu laedt.**
 * Der Client aus `virtual:pwa-register` haengt seinen Reload an das
 * `controlling`-Ereignis von Workbox — aber nur, wenn dieses `isUpdate` traegt.
 * Workbox setzt das nicht, sobald es die gefundene Aktualisierung als *extern*
 * einstuft (u. a. wenn seit der Registrierung mehr als eine Minute vergangen
 * ist — bei Nora der Normalfall, weil die eigene Pruefung stuendlich bzw. bei
 * Tab-Rueckkehr laeuft, also lange nach dem Seitenaufbau).
 *
 * Real gemessen im Zwei-Build-Harness (Chromium 148, echtes generiertes
 * `sw.js`): nach `SKIP_WAITING` feuert `controllerchange` genau einmal, der
 * neue Worker uebernimmt, der Precache des alten Builds wird aufgeraeumt — und
 * die Seite laedt **nicht** von selbst neu. Identisch gemessen am Code vor
 * dieser Korrektur; es ist also kein Regressionseffekt, sondern der Zustand,
 * den niemand geprueft hatte.
 *
 * Ohne diese Frist bliebe die Oberflaeche danach dauerhaft auf „Nora wird
 * aktualisiert" stehen: der Watchdog greift nicht, weil die Uebernahme ja
 * stattgefunden hat. „Uebernommen" ist eben nicht „fertig" — fertig ist erst
 * das neu geladene Dokument.
 *
 * 1,5 s reichen mit grossem Abstand: laedt der Client selbst neu, tut er das
 * synchron im `controlling`-Handler, und dieser Timer kommt nie zum Zug.
 */
export const RELOAD_FALLBACK_MS = 1500;

export interface UpdateChoreography {
  phase: ChoreographyPhase;
  presentation: ChoreographyPresentation;
  /** Startet die Sequenz. Waehrend eines laufenden Laufs wirkungslos. */
  start: () => void;
  /** Startet nach einem Fehlschlag von vorn. */
  retry: () => void;
}

export const useUpdateChoreography = ({
  applyUpdate,
  applying,
  activated,
  reload,
}: {
  applyUpdate: () => void;
  /** Aktivierung wurde angefordert. */
  applying: boolean;
  /** Uebernahme ist tatsaechlich eingetreten. Das einzige Erfolgssignal. */
  activated: boolean;
  /** Letzter Schritt, falls der Client nicht selbst neu laedt. */
  reload: () => void;
}): UpdateChoreography => {
  const [phase, setPhase] = useState<ChoreographyPhase>("idle");
  const [runToken, setRunToken] = useState(0);
  const [commitRequested, setCommitRequested] = useState(false);
  const [watchdogElapsed, setWatchdogElapsed] = useState(false);

  const runningRef = useRef(false);
  const committedRunRef = useRef(0);

  // Ueber eine Ref, nicht ueber die Effekt-Dependencies: eine neue
  // `applyUpdate`-Identitaet darf die laufende Sequenz niemals neu starten.
  const applyRef = useRef(applyUpdate);
  useEffect(() => {
    applyRef.current = applyUpdate;
  }, [applyUpdate]);

  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);

  const begin = useCallback(() => setRunToken((token) => token + 1), []);

  const start = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    begin();
  }, [begin]);

  const retry = useCallback(() => {
    runningRef.current = true;
    begin();
  }, [begin]);

  useEffect(() => {
    if (runToken === 0) return;

    setPhase("settling");
    setCommitRequested(false);
    setWatchdogElapsed(false);

    const timers = [
      window.setTimeout(
        () => setPhase("converging"),
        CHOREOGRAPHY_TIMELINE.converging,
      ),
      window.setTimeout(
        () => setPhase("sustaining"),
        CHOREOGRAPHY_TIMELINE.sustaining,
      ),
      window.setTimeout(
        () => setPhase("committing"),
        CHOREOGRAPHY_TIMELINE.committing,
      ),
      window.setTimeout(() => {
        // Pro Lauf genau einmal — auch wenn StrictMode den Effekt doppelt
        // montiert und die Timer dabei neu setzt.
        if (committedRunRef.current === runToken) return;
        committedRunRef.current = runToken;
        setCommitRequested(true);
        applyRef.current();
      }, CHOREOGRAPHY_COMMIT_MS),
    ];

    // Unmount waehrend der Sequenz (Logout, Routenwechsel, HMR): alle Timer
    // fallen weg, `applyUpdate()` wird nicht mehr aufgerufen. Der wartende
    // Worker bleibt unangetastet und der Hinweis kommt spaeter wieder.
    return () => timers.forEach(window.clearTimeout);
  }, [runToken]);

  // Der Watchdog laeuft nur, solange die Uebernahme noch aussteht. Trifft sie
  // ein, wird der Timer abgeraeumt — auf dem Erfolgspfad laedt die Seite
  // ohnehin gleich neu, aber so kann selbst ein langsamer Reload keinen
  // Recovery-Zustand aufblitzen lassen.
  useEffect(() => {
    if (!commitRequested || activated) return;
    const timer = window.setTimeout(
      () => setWatchdogElapsed(true),
      ACTIVATION_WATCHDOG_MS,
    );
    return () => window.clearTimeout(timer);
  }, [commitRequested, activated]);

  // Uebernahme da, Seite immer noch hier: dann laedt Nora selbst neu. Genau
  // einmal pro Lauf — der Effekt haengt nur an zwei Booleschen, die nach dem
  // Wechsel stehen bleiben, und der Reload beendet das Dokument ohnehin.
  useEffect(() => {
    if (!commitRequested || !activated) return;
    const timer = window.setTimeout(
      () => reloadRef.current(),
      RELOAD_FALLBACK_MS,
    );
    return () => window.clearTimeout(timer);
  }, [commitRequested, activated]);

  // `activated` ist das Erfolgssignal — nicht `applying`. Ein spaeter doch noch
  // eintreffendes `controllerchange` macht diesen Zustand von selbst wieder
  // rueckgaengig, statt eine widerspruechliche Oberflaeche stehen zu lassen.
  const failed = commitRequested && watchdogElapsed && !activated;

  // Nach einem Fehlschlag ist die Sperre wieder offen: „Erneut versuchen" darf
  // eine neue Sequenz starten. Bewusst im Effekt und nicht im Render-Koerper —
  // eine Ref-Mutation waehrend des Renderns ueberlebt einen verworfenen
  // Render-Versuch und wuerde die Wiedereintrittssperre still aushebeln.
  useEffect(() => {
    if (failed) runningRef.current = false;
  }, [failed]);

  const presentation: ChoreographyPresentation = failed
    ? "recovery"
    : phase !== "idle" || applying
      ? "choreography"
      : "available";

  return { phase, presentation, start, retry };
};
