import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";

import { NoraSafetyMark } from "./NoraSafetyMark";
import { NoraUpdateOrb } from "./NoraUpdateOrb";
import { usePwaUpdate } from "./usePwaUpdate";
import { useUpdateChoreography } from "./useUpdateChoreography";

/**
 * Die einzige Live-Region dieser Schicht.
 *
 * Das sichtbare Panel ist bewusst KEINE Live-Region mehr. Es trug frueher
 * `role="status"`, und `role="status"` bringt `aria-atomic="true"` mit: jede
 * Mutation im Teilbaum liess Screenreader die komplette Flaeche erneut
 * vorlesen — waehrend der Achtsekundensequenz gleich mehrfach, weil
 * Sicherheitshinweis und Aktionen verschwinden, die Punkte auftauchen und der
 * Titel wechselt. Angesagt wird deshalb nur noch der Zustandswechsel selbst,
 * aus einer eigenen, winzigen Region.
 *
 * Dieselbe Trennung wie in Phase 7B (`NoraNotificationAnnouncer`), aber ohne
 * deren Store: hier gibt es genau drei moegliche Ansagen.
 *
 * `sequence` ist die Identitaet des EREIGNISSES, nicht des Wortlauts, und wird
 * als React-Key des einzigen Kindes gerendert — eine Wiederholung tauscht den
 * Knoten aus und die Region feuert erneut, ohne dass ein Zeichen am Text
 * geaendert werden muesste (kein Whitespace-Trick).
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

/** Was in der Recovery-Flaeche wirklich helfen kann. */
type RecoveryAction = "retry" | "reload";

/**
 * Der letzte Schritt eines Updates, an genau einer Stelle.
 *
 * Modulweit und stabil, damit die Choreografie-Abhaengigkeiten sich nicht bei
 * jedem Render aendern. Ausgelagert vor allem, damit im Test eine Attrappe an
 * dieselbe Stelle tritt statt `window.location` zu ersetzen.
 */
const reloadPage = () => window.location.reload();

/**
 * Nora-Systemereignis „neue Version verfuegbar" (Wellen PWA-1C / PWA-1C.1).
 *
 * **Was das hier ist — und was nicht.** Ein PWA-Update ist ein
 * *Application System Event*: es berichtet ueber die Anwendung selbst, nicht
 * ueber eine Aktion des Benutzers. Es ist deshalb bewusst weder eine
 * Statusmeldung aus Phase 7B noch eine Business-Operation — kein
 * `operationId`, kein Idempotency-Key, kein OperationManager, kein
 * `pending/success/error`. Geteilt werden nur Design-Primitive (Typografie,
 * Radius, Surface, Motion-Tokens), nicht die Semantik.
 *
 * **Eine Flaeche, vier Zustaende, kein Komponententausch.** Verfuegbar,
 * Choreografie und Recovery leben in *demselben* DOM-Baum. Was verschwindet,
 * faltet sich weg (`nora-system-event-fold`, `grid-template-rows` 1fr → 0fr);
 * der Orb waechst, statt ersetzt zu werden; der Titel loest sich auf und der
 * neue setzt sich weich, statt umzuspringen. Es wird kein zweites Fenster
 * montiert — genau deshalb liest sich der Uebergang als Verwandlung derselben
 * Oberflaeche und nicht als Bildwechsel.
 *
 * **Orb im Zentrum.** Die Komposition ist eine zentrierte Spalte: Orb, Titel,
 * Text, Sicherheitshinweis, Aktionen. Der Orb steht horizontal exakt in der
 * Mitte und ist der visuelle Mittelpunkt — nicht ein Icon links neben Text.
 * Dieselbe DNA auf allen Breakpoints, mobil nur kompakter (siehe `index.css`).
 *
 * **Nicht-modal, aber prominent.** Das Panel nimmt keinen Fokus, kapselt
 * keinen, setzt kein `aria-hidden` und hat keinen Scrim. Prominenz entsteht
 * ueber Flaeche, Position und das Motiv — nicht darueber, dem Benutzer die
 * Anwendung zu entziehen. Er darf „Spaeter" waehlen und normal weiterarbeiten.
 *
 * **Verhalten bei offenem Dialog.** Solange ein Radix-Dialog oder -Sheet offen
 * ist, wird das Panel nicht angezeigt (CSS-Regel in `index.css`, gesteuert
 * ueber Radix' eigenes `data-state` — keine zweite Modal-Zustandsmaschine).
 * Grund: mitten in Schnellerfassung oder Vorgangsakte ist der denkbar
 * schlechteste Moment, um zu einem Reload einzuladen, und ein zweiter Layer
 * ueber einem Radix-Dialog bringt Fokus- und `aria-hidden`-Semantik in Gefahr.
 * Der Hinweis erscheint, sobald der Benutzer wieder auf einer normalen
 * Oberflaeche ist — der wartende Worker geht dabei nicht verloren.
 */
export const NoraUpdateEvent = () => {
  const translate = useTranslate();
  const {
    updateAvailable,
    applying,
    activated,
    applyUpdate,
    hasWaitingWorker,
    dismissForNow,
  } = usePwaUpdate();
  const { phase, presentation, start, retry } = useUpdateChoreography({
    applyUpdate,
    applying,
    activated,
    // Der Client aus `virtual:pwa-register` laedt nur neu, wenn Workbox die
    // Aktualisierung als „intern" fuehrt — bei Noras eigener Pruefung ist das
    // messbar nicht der Fall. Also besitzt Nora den letzten Schritt selbst.
    reload: reloadPage,
  });
  const titleId = useId();
  const bodyId = useId();

  const rootRef = useRef<HTMLDivElement | null>(null);
  const recoveryActionRef = useRef<HTMLButtonElement | null>(null);
  // Nur uebernehmen, was ohnehin uns gehoert: der Fokus wird ausschliesslich
  // dann verschoben, wenn er beim Ausloesen bereits im Panel lag. Ein Klick
  // fokussiert den Button in Chrome mit, also deckt das Maus wie Tastatur ab —
  // ohne dass das Ereignis jemandem den Fokus wegnehmen kann.
  const focusWasOursRef = useRef(false);

  // Die Sequenz haelt das Panel offen, auch wenn der Store schon weiter ist:
  // zwischen Klick und `applyUpdate()` steht er noch auf `updateAvailable`,
  // danach auf `applying`. Beides zeigt dieselbe Szene.
  const mounted = updateAvailable || applying || phase !== "idle";

  const running = presentation === "choreography";
  const recovery = presentation === "recovery";

  // Alles, was nur im Verfuegbar-Zustand gilt, bleibt durch Phase 1 montiert,
  // damit es sich sichtbar wegfalten kann — ein sofortiges Unmount waere das
  // harte `display:none`, das Abschnitt 15 ausdruecklich ausschliesst. Ab
  // Phase 2 ist es unsichtbar und verlaesst den Baum.
  const safetyMounted = presentation === "available" || phase === "settling";
  const safetyOpen = presentation === "available";
  // Die Aktionszeile ueberlebt zusaetzlich den Recovery-Zustand: dort traegt
  // sie „Erneut versuchen" statt der beiden Update-Aktionen.
  const actionsMounted = safetyMounted || recovery;

  // Escape nur, wenn der Fokus im Panel liegt und noch etwas zu verwerfen ist.
  // Bewusst kein globaler Key-Listener: das Panel ist nicht modal und darf
  // Escape niemandem wegnehmen. Waehrend der Sequenz gibt es kein Zurueck —
  // `applyUpdate()` ist ab Sekunde acht unterwegs.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || presentation !== "available") return;
    event.stopPropagation();
    dismissForNow();
  };

  // Der Textwechsel haengt an der PHASE, nicht am Start der Sequenz. Wuerde er
  // schon beim Klick fallen, spraenge der Titel bei voller Deckkraft um —
  // genau der harte Wechsel, den die Auflösung-per-Blur vermeiden soll.
  // Waehrend „converging" faehrt der Titel auf Deckkraft 0; erst ab
  // „sustaining" steht dort der neue Text, und der setzt sich aus dem
  // Unsichtbaren heraus. Der Sonderfall `applying && phase === "idle"` kann
  // nur eintreten, wenn der Store von aussen aktiviert wurde — dann ist die
  // Update-Copy trotzdem die richtige.
  const focused =
    phase === "sustaining" ||
    phase === "committing" ||
    (applying && phase === "idle");

  const title = recovery
    ? "crm.pwa.recovery_title"
    : focused
      ? "crm.pwa.applying_title"
      : "crm.pwa.available_title";

  const lede = recovery
    ? "crm.pwa.recovery_intro"
    : focused
      ? "crm.pwa.applying_intro"
      : "crm.pwa.available_intro";

  // --- Recovery: welche Aktion hier ueberhaupt etwas bewirken kann ---------
  //
  // Bewusst KEIN „Spaeter": SKIP_WAITING ist zu diesem Zeitpunkt bereits
  // gesendet: den Worker wieder verlaesslich auf WAITING zu setzen, ist keine
  // Faehigkeit, die Nora hat. Ein Knopf, der das verspraeche, waere eine Luege
  // ueber den eigenen Zustand. Der Ausweg ist deshalb die Aktion selbst.
  const [recoveryAction, setRecoveryAction] = useState<RecoveryAction>("retry");
  useEffect(() => {
    if (presentation !== "recovery") return;
    // Wartet noch ein Worker, kann ein zweiter Anlauf die Aktivierung erneut
    // anstossen. Ist keiner mehr da, laeuft `messageSkipWaiting()` nachweislich
    // ins Leere — dann ist ein kontrollierter Reload die ehrlichere Aktion.
    setRecoveryAction(hasWaitingWorker() ? "retry" : "reload");
  }, [presentation, hasWaitingWorker]);

  // --- Fokus nach der vom Benutzer ausgeloesten Aktion ---------------------
  //
  // Die Aktionszeile faltet sich ab Phase 2 weg; ohne Zutun faellt der Fokus
  // auf `<body>` und der Benutzer steht nach der Sequenz — und erst recht im
  // Recovery-Zustand — am Dokumentanfang. Kein unerwarteter Autofokus: der
  // Benutzer hat den Zustandswechsel gerade selbst ausgeloest.
  useEffect(() => {
    if (!mounted || !focusWasOursRef.current) return;
    if (presentation === "recovery") recoveryActionRef.current?.focus();
    else if (presentation === "choreography") rootRef.current?.focus();
  }, [presentation, mounted]);

  // --- Screenreader: genau eine Ansage pro Zustandswechsel -----------------
  const announcementKey = !mounted
    ? null
    : recovery
      ? "crm.pwa.recovery_title"
      : focused
        ? "crm.pwa.applying_title"
        : "crm.pwa.available_title";
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
      text: translate(announcementKey),
    });
  }, [announcementKey, translate]);

  const beginSequence = (action: () => void) => {
    focusWasOursRef.current =
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
        // Bewusst NICHT `role="status"`: das brachte `aria-atomic` mit und
        // liess die ganze Flaeche bei jeder Mutation erneut vorlesen. Die
        // Live-Semantik liegt jetzt allein beim Announcer oben.
        role="group"
        // Programmatisch fokussierbar, damit der Fokus nach der Primaeraktion
        // nicht ins Nichts faellt. Nicht in der Tab-Reihenfolge.
        tabIndex={-1}
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-presentation={presentation}
        data-phase={phase}
        // Bestandsvertrag aus PWA-1C: „applying" heisst fuer jeden Leser dieses
        // Attributs unveraendert „der Benutzer hat das Update ausgeloest".
        data-state={running ? "applying" : "available"}
        data-testid="nora-pwa-update-event"
        onKeyDown={handleKeyDown}
      >
        <div className="nora-system-event-stage">
          <NoraUpdateOrb phase={phase} />
        </div>

        <div className="nora-system-event-copy">
          {/* Ein einziges h2 — der Textwechsel faellt in das Fenster, in dem der
            Titel ohnehin auf Deckkraft 0 steht (Phase „converging"). Dadurch
            gibt es keinen sichtbaren Sprung, keinen zweiten Titel im
            Accessibility-Baum und keine Typewriter-Spielerei. */}
          <h2 id={titleId} className="nora-system-event-title">
            {translate(title)}
          </h2>

          <p id={bodyId} className="nora-system-event-lede">
            {translate(lede)}
          </p>

          {/* Inside the copy block, not a sibling of it: as a top-level fold the
            reassurance sat a full composition gap away from the sentence it
            belongs to and read as a third, unrelated statement. */}
          {safetyMounted ? (
            <div
              className="nora-system-event-fold nora-system-event-fold-tight"
              data-open={safetyOpen}
            >
              <div className="nora-system-event-fold-inner">
                <p className="nora-system-event-reassure">
                  {translate("crm.pwa.available_keeps_running")}
                </p>
              </div>
            </div>
          ) : null}

          {focused ? (
            /* Die drei Punkte tragen die fortlaufende Aktivitaetssemantik,
             damit der Text stabil lesbar bleiben kann. Sie treten mit dem
             neuen Titel auf, nicht schon beim Klick: waehrend sich die
             Komposition noch zusammenzieht, traegt der wachsende Orb das
             Ereignis allein. Rein dekorativ — der Titel sagt bereits
             vollstaendig, dass aktualisiert wird, eine zweite Ansage waere
             Laerm. */
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

        {/* Kein Danger-State: das Update ist kein Fehler. Warme, ruhige Flaeche —
          „bitte beachten", nicht „Gefahr". Das Symbol steht links neben dem
          Text, damit das Auge in einem Zug von der Warnung zur
          Handlungsanweisung liest. */}
        {safetyMounted ? (
          <div
            className="nora-system-event-fold"
            data-open={safetyOpen}
            data-testid="nora-pwa-update-safety"
          >
            <div className="nora-system-event-fold-inner">
              <div className="nora-system-event-safety">
                <NoraSafetyMark />
                <div className="nora-system-event-safety-copy">
                  <p className="nora-system-event-safety-lead">
                    {translate("crm.pwa.available_unsaved_hint")}
                  </p>
                  <p className="nora-system-event-safety-note">
                    {translate("crm.pwa.available_unsaved_detail")}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {actionsMounted ? (
          <div
            className="nora-system-event-fold"
            data-open={safetyOpen || recovery}
          >
            <div className="nora-system-event-fold-inner">
              <div className="nora-system-event-actions">
                {recovery ? (
                  <Button
                    ref={recoveryActionRef}
                    size="lg"
                    className="nora-system-event-action nora-primary-action"
                    onClick={
                      recoveryAction === "reload"
                        ? reloadPage
                        : () => beginSequence(retry)
                    }
                    data-testid="nora-pwa-update-retry"
                    data-recovery-action={recoveryAction}
                  >
                    {translate(
                      recoveryAction === "reload"
                        ? "crm.pwa.reload_action"
                        : "crm.pwa.retry_action",
                    )}
                  </Button>
                ) : (
                  <>
                    <Button
                      size="lg"
                      variant="ghost"
                      className="nora-system-event-action"
                      onClick={dismissForNow}
                      data-testid="nora-pwa-update-later"
                    >
                      {translate("crm.pwa.update_later")}
                    </Button>
                    {/* Nora's established primary treatment, not the shadcn
                      default: the update is the same kind of affirmative
                      action as „Speichern" elsewhere and must look like it. */}
                    <Button
                      size="lg"
                      className="nora-system-event-action nora-primary-action"
                      onClick={() => beginSequence(start)}
                      data-testid="nora-pwa-update-apply"
                    >
                      {translate("crm.pwa.update_now")}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
};
