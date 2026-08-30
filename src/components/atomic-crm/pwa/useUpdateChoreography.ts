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
 * Schonfrist nach dem Commit, bevor ein ausbleibender `applying`-Zustand als
 * Fehlschlag gilt.
 *
 * Der Contract ist eindeutig: `pwaUpdateStore.applyUpdate()` setzt `applying`
 * **synchron** auf `true` und laesst es dort — auf dem Erfolgspfad laedt die
 * Seite neu, bevor sich daran etwas aendert. Es gibt genau zwei Wege zurueck:
 * der Store lehnt den Aufruf sofort ab (kein wartender Worker mehr), oder die
 * Aktivierung wird abgelehnt und der `catch` setzt `applying` zurueck. Beide
 * sind echte Fehlschlaege. Ein falsch-positiver Recovery-Zustand ist damit
 * ausgeschlossen — die Schonfrist deckt nur die Latenz einer schnellen
 * Ablehnung ab.
 */
export const CHOREOGRAPHY_RECOVERY_GRACE_MS = 1500;

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
}: {
  applyUpdate: () => void;
  applying: boolean;
}): UpdateChoreography => {
  const [phase, setPhase] = useState<ChoreographyPhase>("idle");
  const [runToken, setRunToken] = useState(0);
  const [commitRequested, setCommitRequested] = useState(false);
  const [graceElapsed, setGraceElapsed] = useState(false);

  const runningRef = useRef(false);
  const committedRunRef = useRef(0);

  // Ueber eine Ref, nicht ueber die Effekt-Dependencies: eine neue
  // `applyUpdate`-Identitaet darf die laufende Sequenz niemals neu starten.
  const applyRef = useRef(applyUpdate);
  useEffect(() => {
    applyRef.current = applyUpdate;
  }, [applyUpdate]);

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
    setGraceElapsed(false);

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

  useEffect(() => {
    if (!commitRequested) return;
    const timer = window.setTimeout(
      () => setGraceElapsed(true),
      CHOREOGRAPHY_RECOVERY_GRACE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [commitRequested]);

  const failed = commitRequested && graceElapsed && !applying;

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
