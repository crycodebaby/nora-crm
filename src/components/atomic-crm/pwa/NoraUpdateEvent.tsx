import { useId, type KeyboardEvent } from "react";
import { useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";

import { NoraSafetyMark } from "./NoraSafetyMark";
import { NoraUpdateOrb } from "./NoraUpdateOrb";
import { usePwaUpdate } from "./usePwaUpdate";
import { useUpdateChoreography } from "./useUpdateChoreography";

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
  const { updateAvailable, applying, applyUpdate, dismissForNow } =
    usePwaUpdate();
  const { phase, presentation, start, retry } = useUpdateChoreography({
    applyUpdate,
    applying,
  });
  const titleId = useId();
  const bodyId = useId();

  // Die Sequenz haelt das Panel offen, auch wenn der Store schon weiter ist:
  // zwischen Klick und `applyUpdate()` steht er noch auf `updateAvailable`,
  // danach auf `applying`. Beides zeigt dieselbe Szene.
  if (!updateAvailable && !applying && phase === "idle") return null;

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

  return (
    <div
      className="nora-system-event"
      role="status"
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
                  size="lg"
                  className="nora-system-event-action nora-primary-action"
                  onClick={retry}
                  data-testid="nora-pwa-update-retry"
                >
                  {translate("crm.pwa.retry_action")}
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
                    onClick={start}
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
  );
};
