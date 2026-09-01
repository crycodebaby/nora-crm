import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";

import { NoraUpdateOrb, type OrbPresentation } from "./NoraUpdateOrb";
import {
  acknowledgeUpdateCompletion,
  consumeUpdateCompletion,
  markUpdateCompleted,
} from "./pwaUpdateCompletion";
import { usePwaUpdate } from "./usePwaUpdate";
import { useUpdateChoreography } from "./useUpdateChoreography";

/**
 * Die einzige Live-Region dieser Schicht.
 *
 * Das sichtbare Panel ist bewusst KEINE Live-Region: `role="status"` braechte
 * `aria-atomic` mit und liesse Screenreader die komplette Flaeche bei jeder
 * Mutation erneut vorlesen. Angesagt wird nur der Zustandswechsel selbst,
 * aus einer eigenen, winzigen Region. `sequence` ist die Identitaet des
 * EREIGNISSES und wird als React-Key gerendert — eine Wiederholung tauscht
 * den Knoten aus und die Region feuert erneut.
 */
const UpdateAnnouncer = ({
  announcement,
}: {
  announcement: { sequence: number; text: string } | null;
}) => (
  <div
    data-testid="nora-pwa-update-announcer"
    role="status"
    aria-live="polite"
    aria-atomic="true"
    className="sr-only"
  >
    {announcement ? (
      <span key={announcement.sequence}>{announcement.text}</span>
    ) : null}
  </div>
);

/**
 * Der letzte Schritt eines Updates, an genau einer Stelle. Modulweit und
 * stabil, damit die Choreografie-Abhaengigkeiten sich nicht bei jedem Render
 * aendern; im Test tritt eine Attrappe an dieselbe Stelle.
 */
const reloadPage = () => {
  // Jeder Reload, den Nora hier selbst ausloest, vollendet ein Update: der
  // Fallback nach dem Commit (Uebernahme oder Reload-Befund) und der Klick
  // auf „Nora neu laden" im Zustand `reloadRequired`. Das Bit steht, bevor
  // das Dokument endet — die naechste Version bestaetigt es einmal.
  markUpdateCompleted();
  window.location.reload();
};

/**
 * Was die Flaeche zeigt: die fuenf Praesentationen der Choreografie plus
 * die Abschlussbestaetigung, die nur in der frisch geladenen Version
 * existiert und nie aus dem Store kommt.
 */
type PanelPresentation = OrbPresentation;

const TITLE_KEY: Record<PanelPresentation, string> = {
  available: "crm.pwa.available_title",
  applying: "crm.pwa.applying_title",
  slow: "crm.pwa.slow_title",
  reloadRequired: "crm.pwa.reload_title",
  failed: "crm.pwa.failed_title",
  completed: "crm.pwa.completed_title",
};

/**
 * Wie lange „Aktualisierung abgeschlossen" steht, bevor es sich von selbst
 * ausblendet. Zwei kurze Zeilen brauchen zwei Sekunden; der Rest ist Ruhe,
 * damit die Bestaetigung nicht wie ein Toast vorbeihuscht. Keine Aktion,
 * nichts zu entscheiden — deshalb darf sie von selbst gehen.
 */
export const COMPLETION_DISMISS_MS = 6000;

/** Dauer des Ausblendens (`nora-system-event-out` in `index.css`). */
export const COMPLETION_LEAVE_MS = 420;

/**
 * Nora-Systemereignis „neue Version verfuegbar" (PWA-1C / 1C.1, Presentation
 * Contract V2).
 *
 * **Was das hier ist — und was nicht.** Ein PWA-Update ist ein
 * *Application System Event*: es berichtet ueber die Anwendung selbst, nicht
 * ueber eine Aktion des Benutzers. Kein `operationId`, kein OperationManager.
 *
 * **Fuenf Zustaende, eine Flaeche, kein Komponententausch.** Verfuegbar,
 * Aktualisieren, Gleich bereit, Neu laden und Nicht moeglich leben in
 * *demselben* DOM-Baum. Was verschwindet, faltet sich weg; der Orb waechst,
 * statt ersetzt zu werden; der Titel loest sich auf und der neue setzt sich
 * weich. Die Komponente enthaelt keine Service-Worker-Logik: sie liest den
 * Praesentationsvertrag aus `useUpdateChoreography`, das seinerseits die
 * Browser-Fakten aus `pwaUpdateStore` bezieht.
 *
 * **Ruhig, nicht alarmierend.** Kein Warnsymbol, keine Warnbox, keine
 * Fehlersprache ohne Fehlerbeweis. Ein Titel, hoechstens eine ruhige Zeile,
 * genau eine Primaeraktion. Seit Visual Polish 2 traegt der Orb den
 * Zustand: ein umlaufender Bogen waehrend der Aktualisierung, ein ruhig
 * geschlossener Ring, wenn die neue Version bereit ist, ein gedaempfter Orb
 * im Fehlerfall. Im Zustand „Gleich bereit" gibt es bewusst keinen
 * Reload-Knopf und keinen Reparaturtipp — ein Reload loest einen wirklich
 * wartenden Worker nachweislich nicht (siehe Decision Log, Visual Polish 2).
 *
 * **Nicht-modal, aber prominent.** Das Panel nimmt keinen Fokus, kapselt
 * keinen, setzt kein `aria-hidden` und hat keinen Scrim. Bei offenem
 * Radix-Dialog/-Sheet wird es gar nicht angezeigt (CSS in `index.css`, ueber
 * Radix' eigenes `data-state`).
 */
export const NoraUpdateEvent = () => {
  const translate = useTranslate();
  const {
    state,
    applying,
    activated,
    reloadRequired,
    failed,
    syncFacts,
    applyUpdate,
    assessActivation,
    dismissForNow,
  } = usePwaUpdate();
  // `retry` (manueller zweiter Anlauf) bleibt Teil des Hook-Vertrags, ist
  // aber bewusst nicht als Knopf exponiert: der stille zweite Versuch laeuft
  // automatisch, danach ist der Reload die ehrlichere Aktion.
  const { phase, presentation, stall, start, reset } = useUpdateChoreography({
    applyUpdate,
    syncFacts,
    assessActivation,
    applying,
    activated,
    reloadRequired,
    failed,
    // Im kontrollierten Tab laedt der Client aus `virtual:pwa-register`
    // meist selbst; fuer alle anderen Faelle besitzt Nora den letzten
    // Schritt.
    reload: reloadPage,
  });
  const titleId = useId();
  const bodyId = useId();

  const rootRef = useRef<HTMLDivElement | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  // Nur uebernehmen, was uns AKTUELL gehoert — siehe den Besitz-Effekt.
  const focusOwnedRef = useRef(false);

  // --- Abschlussbestaetigung (nur in der frisch geladenen Version) ---------
  // Der Initialisierer liest das Bit aus dem vorigen Dokument; StrictMode
  // ruft ihn doppelt, und beide Aufrufe antworten gleich (Modulspeicher in
  // `pwaUpdateCompletion.ts`). Kein Store-Zustand: der Abschluss ist ein
  // Ereignis dieser Dokument-Lebensdauer, nicht des Update-Lifecycles.
  const [completion, setCompletion] = useState(consumeUpdateCompletion);
  const [leaving, setLeaving] = useState(false);
  const storeQuiet = state === "idle" && phase === "idle";
  const completed = completion && storeQuiet;

  // Meldet der Store etwas (ein weiteres Update, direkt nach dem Reload),
  // hat dessen Wahrheit Vorrang: die Bestaetigung tritt ohne Ausblenden
  // zurueck und kommt nicht wieder.
  useEffect(() => {
    if (!completion || storeQuiet) return;
    acknowledgeUpdateCompletion();
    setCompletion(false);
    setLeaving(false);
  }, [completion, storeQuiet]);

  // Von selbst gehen: nach der Lesezeit beginnt das Ausblenden, danach ist
  // die Bestaetigung quittiert. Unter Reduced Motion faellt nur die
  // Bewegung weg (CSS), die Zeiten bleiben.
  useEffect(() => {
    if (!completed || leaving) return;
    const timer = window.setTimeout(
      () => setLeaving(true),
      COMPLETION_DISMISS_MS,
    );
    return () => window.clearTimeout(timer);
  }, [completed, leaving]);

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => {
      acknowledgeUpdateCompletion();
      setCompletion(false);
      setLeaving(false);
    }, COMPLETION_LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  // Die Sequenz haelt das Panel offen, auch wenn der Store schon weiter ist;
  // die Bestaetigung oeffnet es, ohne dass der Store etwas weiss.
  const mounted = !storeQuiet || completed;

  /** Was die Flaeche zeigt: der Abschluss ueberlagert nur einen stillen Store. */
  const shown: PanelPresentation = completed ? "completed" : presentation;

  const running = presentation === "applying" || presentation === "slow";
  // Die Bestaetigung hat keine Aktion — nichts zu entscheiden, nichts zu
  // verschieben. Escape blendet sie lediglich frueher aus.
  const actionable = !running && !completed;

  // Der Textwechsel haengt an der PHASE, nicht am Start der Sequenz: waehrend
  // `converging` faehrt der Titel auf Deckkraft 0, erst ab `sustaining` steht
  // dort der neue Text. Der Sonderfall `applying && phase === "idle"` kann nur
  // eintreten, wenn der Store von aussen aktiviert wurde.
  const focused =
    phase === "sustaining" ||
    phase === "committing" ||
    (applying && phase === "idle");

  const titleKey =
    shown === "applying" && !focused
      ? "crm.pwa.available_title"
      : TITLE_KEY[shown];

  // Visual Polish 2: eine Zeile pro Zustand, und im langsamen Zustand
  // ausdruecklich KEIN Reparaturtipp — solange ein Worker wirklich wartet,
  // waere „neu laden" ein Rat, der nachweislich nichts loest.
  const hintKey =
    shown === "available"
      ? "crm.pwa.available_hint"
      : shown === "reloadRequired"
        ? "crm.pwa.reload_hint"
        : shown === "slow"
          ? "crm.pwa.slow_hint"
          : shown === "failed"
            ? "crm.pwa.failed_hint"
            : shown === "completed"
              ? "crm.pwa.completed_hint"
              : null;

  // Alles, was nur im handlungsfaehigen Zustand gilt, bleibt durch Phase 1
  // montiert, damit es sich sichtbar wegfalten kann.
  const hintMounted = hintKey !== null || phase === "settling";
  const hintOpen = hintKey !== null;
  const actionsMounted =
    actionable || phase === "settling" || stall === "prolonged";
  const actionsOpen = actionable || stall === "prolonged";
  // Die beiden Update-Aktionen bleiben durch Phase 1 montiert, damit sie sich
  // sichtbar wegfalten koennen — ein sofortiges Unmount waere das harte
  // `display:none`. Ein zweiter Klick in diesem Fenster laeuft in die
  // Wiedereintrittssperre von `start()`.
  const showUpdateActions =
    presentation === "available" ||
    (presentation === "applying" && phase === "settling");

  // Escape nur, wenn der Fokus im Panel liegt und es etwas zu schliessen gibt.
  // Bewusst kein globaler Key-Listener: das Panel ist nicht modal.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    if (completed) {
      event.stopPropagation();
      setLeaving(true);
      return;
    }
    if (!actionable) return;
    event.stopPropagation();
    dismiss();
  };

  const dismiss = () => {
    // Fehler und verlaengertes Warten haben eine laufende Sequenz hinter
    // sich: erst die Choreografie verwerfen, dann denselben sicheren
    // Verschiebe-Pfad wie „Spaeter" nehmen. Der wartende Worker bleibt
    // unangetastet; eine spaetere Uebernahme hebt die Verschiebung auf.
    if (presentation === "failed" || presentation === "slow") reset();
    dismissForNow();
  };

  // --- Fokus-Besitz --------------------------------------------------------
  // Nora fuehrt den Fokus nur weiter, solange er dem Systemereignis GEHOERT:
  // ab der vom Benutzer ausgeloesten Aktion, bis er ihn selbst nach draussen
  // traegt. `<body>` (Rueckfall beim Wegfalten) zaehlt nicht als Entscheidung.
  useEffect(() => {
    if (!mounted) return;
    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as Node | null;
      if (!target || target === document.body) return;
      focusOwnedRef.current = rootRef.current?.contains(target) ?? false;
    };
    document.addEventListener("focusin", handleFocusIn, true);
    return () => document.removeEventListener("focusin", handleFocusIn, true);
  }, [mounted]);

  // Nach der Primaeraktion: der Fokus faellt nicht ins Nichts. Waehrend der
  // Sequenz auf die Flaeche, in jedem handlungsfaehigen Zustand auf die
  // Primaeraktion — nur, solange der Besitz bei Nora liegt.
  useEffect(() => {
    if (!mounted || !focusOwnedRef.current) return;
    if (shown === "applying") rootRef.current?.focus();
    else if (shown !== "available" && shown !== "completed")
      primaryRef.current?.focus();
  }, [shown, stall, mounted]);

  // --- Screenreader: genau eine Ansage pro Zustandswechsel -----------------
  // Der Abschluss wird als ein Satz angesagt: Titel und Zeile zusammen, denn
  // „Aktualisierung abgeschlossen" allein liesse offen, ob man weitermachen
  // darf.
  const announcementKey = !mounted
    ? null
    : shown === "applying"
      ? focused
        ? "crm.pwa.applying_title"
        : "crm.pwa.available_title"
      : TITLE_KEY[shown];
  const announcedKeyRef = useRef<string | null>(null);
  const announcementSequence = useRef(0);
  const [announcement, setAnnouncement] = useState<{
    sequence: number;
    text: string;
  } | null>(null);
  useEffect(() => {
    if (announcedKeyRef.current === announcementKey) return;
    announcedKeyRef.current = announcementKey;
    if (!announcementKey) {
      setAnnouncement(null);
      return;
    }
    announcementSequence.current += 1;
    setAnnouncement({
      sequence: announcementSequence.current,
      text:
        announcementKey === TITLE_KEY.completed
          ? `${translate(TITLE_KEY.completed)}. ${translate("crm.pwa.completed_hint")}`
          : translate(announcementKey),
    });
  }, [announcementKey, translate]);

  const beginSequence = (action: () => void) => {
    // Der Klick hat den Knopf im Panel mitfokussiert, bei Tastaturbedienung
    // lag er ohnehin dort. Ein von aussen ausgeloester Aufruf erhaelt keinen
    // Besitz.
    focusOwnedRef.current =
      rootRef.current?.contains(document.activeElement) ?? false;
    action();
  };

  if (!mounted) return <UpdateAnnouncer announcement={null} />;

  return (
    <>
      <UpdateAnnouncer announcement={announcement} />
      <div
        ref={rootRef}
        className="nora-system-event"
        role="group"
        tabIndex={-1}
        aria-labelledby={titleId}
        aria-describedby={hintKey ? bodyId : undefined}
        data-presentation={shown}
        data-phase={phase}
        data-stall={stall}
        // Bestandsvertrag aus PWA-1C: „applying" heisst fuer jeden Leser
        // dieses Attributs „der Benutzer hat das Update ausgeloest".
        data-state={
          completed ? "completed" : running ? "applying" : "available"
        }
        data-leaving={completed && leaving ? "true" : undefined}
        data-testid="nora-pwa-update-event"
        onKeyDown={handleKeyDown}
      >
        <div className="nora-system-event-stage">
          <NoraUpdateOrb phase={phase} presentation={shown} />
        </div>

        <div className="nora-system-event-copy">
          {/* Ein einziges h2 — der Textwechsel faellt in das Fenster, in dem
            der Titel ohnehin auf Deckkraft 0 steht. */}
          <h2 id={titleId} className="nora-system-event-title">
            {translate(titleKey)}
          </h2>

          {hintMounted ? (
            <div
              className="nora-system-event-fold nora-system-event-fold-tight"
              data-open={hintOpen}
              data-testid="nora-pwa-update-hint"
            >
              <div className="nora-system-event-fold-inner">
                <p id={bodyId} className="nora-system-event-hint">
                  {hintKey ? translate(hintKey) : null}
                </p>
              </div>
            </div>
          ) : null}

          {(focused && presentation === "applying") ||
          presentation === "slow" ? (
            /* Drei atmende Punkte tragen die fortlaufende Aktivitaet, damit
             der Titel stabil lesbar bleibt. Rein dekorativ. */
            <span
              className="nora-system-event-dots"
              aria-hidden="true"
              data-testid="nora-pwa-update-dots"
            >
              <span className="nora-system-event-dot" />
              <span className="nora-system-event-dot" />
              <span className="nora-system-event-dot" />
            </span>
          ) : null}
        </div>

        {actionsMounted ? (
          <div className="nora-system-event-fold" data-open={actionsOpen}>
            <div className="nora-system-event-fold-inner">
              <div className="nora-system-event-actions">
                {showUpdateActions ? (
                  <>
                    <Button
                      size="lg"
                      variant="ghost"
                      className="nora-system-event-action nora-system-event-action-quiet"
                      onClick={dismiss}
                      data-testid="nora-pwa-update-later"
                    >
                      {translate("crm.pwa.update_later")}
                    </Button>
                    {/* Nora's established primary treatment: the update is
                      the same kind of affirmative action as „Speichern". */}
                    <Button
                      ref={primaryRef}
                      size="lg"
                      className="nora-system-event-action nora-primary-action"
                      onClick={() => beginSequence(start)}
                      data-testid="nora-pwa-update-apply"
                    >
                      {translate("crm.pwa.update_now")}
                    </Button>
                  </>
                ) : presentation === "reloadRequired" ? (
                  <>
                    <Button
                      size="lg"
                      variant="ghost"
                      className="nora-system-event-action nora-system-event-action-quiet"
                      onClick={dismiss}
                      data-testid="nora-pwa-update-later"
                    >
                      {translate("crm.pwa.update_later")}
                    </Button>
                    <Button
                      ref={primaryRef}
                      size="lg"
                      className="nora-system-event-action nora-primary-action"
                      onClick={reloadPage}
                      data-testid="nora-pwa-update-reload"
                    >
                      {translate("crm.pwa.reload_action")}
                    </Button>
                  </>
                ) : presentation === "slow" ? (
                  /* Erst nach der zweiten Frist, und bewusst kein Reload:
                    solange ein Worker wartet, laedt ein Reload nachweislich
                    denselben alten Build. Der einzige ehrliche Ausweg ist,
                    den Hinweis ruhig zu verschieben und weiterzuarbeiten. */
                  <Button
                    ref={primaryRef}
                    size="lg"
                    variant="ghost"
                    className="nora-system-event-action nora-system-event-action-quiet"
                    onClick={dismiss}
                    data-testid="nora-pwa-update-continue"
                  >
                    {translate("crm.pwa.slow_action")}
                  </Button>
                ) : presentation === "failed" ? (
                  <Button
                    ref={primaryRef}
                    size="lg"
                    variant="ghost"
                    className="nora-system-event-action nora-system-event-action-quiet"
                    onClick={dismiss}
                    data-testid="nora-pwa-update-continue"
                  >
                    {translate("crm.pwa.failed_action")}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
};
