import { useCallback, useEffect, useRef, useState } from "react";

import type {
  PwaActivationAssessment,
  PwaApplyOutcome,
  PwaUpdateSnapshot,
} from "./pwaUpdateStore";

/**
 * Praesentations-Zustandsmaschine der Update-Choreografie (PWA-1C.1, seit
 * dem Update State Contract V2 mit fuenf sichtbaren Zustaenden).
 *
 * **Warum das hier und nicht im Store.** `pwaUpdateStore` bildet den echten
 * Service-Worker-Lifecycle ab — technische Wahrheit. Die acht Sekunden
 * zwischen Klick und Aktivierung beschreiben dagegen, was *Nora zeigt*. Die
 * Choreografie lebt deshalb lokal zur Komponente; der Store liefert die
 * Fakten, dieser Hook leitet daraus die Praesentation ab. Die Komponente
 * enthaelt keine Service-Worker-Logik mehr.
 *
 * **Was die acht Sekunden NICHT sind.** Kein Download-Fortschritt, keine
 * Messung. Der wartende Worker ist zu diesem Zeitpunkt bereits vollstaendig
 * installiert. Die Sequenz ist eine bewusste Uebergangsinszenierung — und sie
 * laeuft nur, wenn wirklich ein Worker wartet. Zeigen die Browser-Fakten beim
 * Klick, dass die neue Version laengst aktiv ist, gibt es keine acht Sekunden
 * Schein-Update: dann ist `reloadRequired` die ehrliche Praesentation.
 *
 * **Genau ein `applyUpdate()` pro Lauf.** `start()` ist gegen Wiedereintritt
 * gesperrt, die Aktionen verschwinden mit dem ersten Klick aus dem Tab-Index,
 * und der Commit haengt an einem Lauf-Token (traegt auch StrictMode).
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
  | "applying"
  | "slow"
  | "reloadRequired"
  | "failed";

/**
 * Wie lange die Uebernahme schon ausbleibt.
 * - `slow`: erste Frist verstrichen, ein stiller zweiter Versuch laeuft.
 * - `prolonged`: auch der ist ohne Uebernahme geblieben; die Oberflaeche
 *   bietet jetzt zusaetzlich den Reload an.
 */
export type ChoreographyStall = "none" | "slow" | "prolonged";

/**
 * Start jeder Phase in Millisekunden nach dem Klick.
 *
 * - `settling` (0–1,2 s): Aktionen und Hinweis falten sich weg.
 * - `converging` (1,2–2,8 s): die Komposition zieht sich aufs Zentrum
 *   zusammen, der Orb waechst, der Titel loest sich auf.
 * - `sustaining` (2,8–7,5 s): ruhige Update-Szene — Orb, ein Titel, Punkte.
 * - `committing` (7,5–8,0 s): der Orb stabilisiert sich.
 */
export const CHOREOGRAPHY_TIMELINE = {
  settling: 0,
  converging: 1200,
  sustaining: 2800,
  committing: 7500,
} as const;

/** Zeitpunkt des einzigen `applyUpdate()`-Aufrufs eines Laufs. */
export const CHOREOGRAPHY_COMMIT_MS = 8000;

/**
 * Wartezeit NACH `applyUpdate()`, bevor der Watchdog die Browser-Fakten neu
 * liest und einordnet.
 *
 * Gemessen gegen das echte generierte `sw.js` (Chromium): vom SKIP_WAITING
 * bis zum `controllerchange` 2–34 ms, im Zwei-Build-Repro der V2-Diagnose
 * 14 ms. Fuenf Sekunden sind davon weit entfernt. Die Frist ist KEIN
 * Fehlerkriterium: beim Ablauf wird nur neu gelesen — wartet der Worker
 * weiterhin, gilt das Update als langsam (nicht als gescheitert), ist die
 * neue Version inzwischen aktiv, braucht das Dokument einen Reload.
 */
export const ACTIVATION_WATCHDOG_MS = 5000;

/**
 * Kurze Frist nach der Uebernahme (oder nach dem Befund `reloadRequired`
 * im Anschluss an einen Commit), bevor Nora selbst neu laedt.
 *
 * Im kontrollierten Tab laedt der Client aus `virtual:pwa-register` beim
 * `controlling`-Ereignis in der Regel selbst neu (Workbox fuehrt den Fund
 * dann als `isUpdate`); dieser Timer kommt dann nie zum Zug. Er ist das
 * Sicherheitsnetz fuer alle anderen Faelle — insbesondere fuer ein
 * unkontrolliertes Dokument, das nach dem eigenen SKIP_WAITING nie ein
 * `controllerchange` sieht: dort ist der Befund `reloadRequired` nach dem
 * Commit die Vollendung dessen, was der Benutzer angestossen hat.
 */
export const RELOAD_FALLBACK_MS = 1500;

export interface UpdateChoreography {
  phase: ChoreographyPhase;
  presentation: ChoreographyPresentation;
  stall: ChoreographyStall;
  /**
   * Startet die Sequenz — nachdem die Browser-Fakten neu gelesen wurden.
   * Zeigt der Store danach `reloadRequired`/`activated`, startet nichts.
   * Waehrend eines laufenden Laufs wirkungslos.
   */
  start: () => void;
  /** Manueller zweiter Anlauf aus `slow`/`prolonged`: eine neue Anfrage, keine neue Choreografie. */
  retry: () => void;
  /** Sequenz-Zustand verwerfen (nach „Weiterarbeiten" im Fehlerfall). */
  reset: () => void;
}

export interface UpdateChoreographyInput {
  applyUpdate: () => PwaApplyOutcome;
  syncFacts: () => PwaUpdateSnapshot;
  assessActivation: () => PwaActivationAssessment;
  /** Aktivierung wurde angefordert. */
  applying: boolean;
  /** Uebernahme ist tatsaechlich eingetreten. */
  activated: boolean;
  /** Neue Version bereit — dieses Dokument braucht nur einen Reload. */
  reloadRequired: boolean;
  /** Positiver Fehlerbeweis. */
  failed: boolean;
  /** Letzter Schritt, falls der Client nicht selbst neu laedt. */
  reload: () => void;
}

export const useUpdateChoreography = ({
  applyUpdate,
  syncFacts,
  assessActivation,
  applying,
  activated,
  reloadRequired,
  failed,
  reload,
}: UpdateChoreographyInput): UpdateChoreography => {
  const [phase, setPhase] = useState<ChoreographyPhase>("idle");
  const [runToken, setRunToken] = useState(0);
  const [commitRequested, setCommitRequested] = useState(false);
  const [stall, setStall] = useState<ChoreographyStall>("none");

  const runningRef = useRef(false);
  const committedRunRef = useRef(0);
  const autoRetriedRunRef = useRef(0);

  // Ueber Refs, nicht ueber die Effekt-Dependencies: neue Identitaeten der
  // Store-Funktionen duerfen die laufende Sequenz niemals neu starten.
  const applyRef = useRef(applyUpdate);
  const assessRef = useRef(assessActivation);
  const reloadRef = useRef(reload);
  useEffect(() => {
    applyRef.current = applyUpdate;
    assessRef.current = assessActivation;
    reloadRef.current = reload;
  }, [applyUpdate, assessActivation, reload]);

  const start = useCallback(() => {
    if (runningRef.current) return;
    // Erst die Wahrheit lesen: ist die neue Version inzwischen aktiv (anderer
    // Tab, unkontrolliertes Dokument), gibt es nichts zu inszenieren.
    const facts = syncFacts();
    if (facts.activated || facts.reloadRequired || facts.failed) return;
    runningRef.current = true;
    setRunToken((token) => token + 1);
  }, [syncFacts]);

  const retry = useCallback(() => {
    // Kein zweiter Achtsekundenlauf: der Benutzer wartet bereits. Eine neue
    // Anfrage, und der Watchdog beginnt von vorn.
    if (assessRef.current() !== "waiting") return;
    applyRef.current();
    setStall("slow");
  }, []);

  const reset = useCallback(() => {
    runningRef.current = false;
    setPhase("idle");
    setCommitRequested(false);
    setStall("none");
  }, []);

  useEffect(() => {
    if (runToken === 0) return;

    setPhase("settling");
    setCommitRequested(false);
    setStall("none");

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
        // `applyUpdate()` liest die Fakten selbst noch einmal: ist die neue
        // Version inzwischen aktiv, geht keine Anfrage raus, und der Store
        // meldet `reloadRequired` — der Reload-Effekt unten uebernimmt.
        applyRef.current();
      }, CHOREOGRAPHY_COMMIT_MS),
    ];

    // Unmount waehrend der Sequenz (Logout, Routenwechsel, HMR): alle Timer
    // fallen weg, `applyUpdate()` wird nicht mehr aufgerufen.
    return () => timers.forEach(window.clearTimeout);
  }, [runToken]);

  // Ein Erfolg oder ein Reload-Befund beendet jede Wartelage — auch eine, die
  // der Watchdog gerade erst festgestellt hat.
  const settled = activated || reloadRequired || failed;

  // Watchdog. Laeuft nur, solange nach dem Commit noch nichts entschieden ist.
  // Beim Ablauf wird nicht „Fehler" gesetzt, sondern der Browser gefragt.
  useEffect(() => {
    if (!commitRequested || settled || stall !== "none") return;
    const timer = window.setTimeout(() => {
      const verdict = assessRef.current();
      if (verdict !== "waiting") return; // der Store hat den Snapshot geaendert
      setStall("slow");
      // Genau ein stiller zweiter Versuch pro Lauf.
      if (autoRetriedRunRef.current !== runToken) {
        autoRetriedRunRef.current = runToken;
        applyRef.current();
      }
    }, ACTIVATION_WATCHDOG_MS);
    return () => window.clearTimeout(timer);
  }, [commitRequested, settled, stall, runToken]);

  // Zweite Frist nach dem stillen Versuch: bleibt die Uebernahme weiter aus,
  // bekommt der Benutzer den Reload angeboten. Kein weiterer Automatismus.
  useEffect(() => {
    if (stall !== "slow" || settled) return;
    const timer = window.setTimeout(() => {
      if (assessRef.current() === "waiting") setStall("prolonged");
    }, ACTIVATION_WATCHDOG_MS);
    return () => window.clearTimeout(timer);
  }, [stall, settled]);

  // Uebernahme oder Reload-Befund nach dem Commit, Seite immer noch hier:
  // dann laedt Nora selbst neu. Genau einmal — der Reload beendet das Dokument.
  const reloadPending = commitRequested && (activated || reloadRequired);
  useEffect(() => {
    if (!reloadPending) return;
    const timer = window.setTimeout(
      () => reloadRef.current(),
      RELOAD_FALLBACK_MS,
    );
    return () => window.clearTimeout(timer);
  }, [reloadPending]);

  // Nach einem Fehlschlag ist die Sperre wieder offen. Bewusst im Effekt und
  // nicht im Render-Koerper.
  useEffect(() => {
    if (failed) runningRef.current = false;
  }, [failed]);

  // Ein laufender Lauf wird nicht abgebrochen: trifft die Uebernahme (oder
  // der Reload-Befund) mitten in der Choreografie ein, laeuft sie ruhig zu
  // Ende, der Commit fordert nichts mehr an, und der Reload folgt danach.
  const inRun = phase !== "idle";
  const presentation: ChoreographyPresentation = failed
    ? "failed"
    : activated || reloadRequired
      ? inRun
        ? "applying"
        : "reloadRequired"
      : stall !== "none"
        ? "slow"
        : inRun || applying
          ? "applying"
          : "available";

  return { phase, presentation, stall, start, retry, reset };
};
