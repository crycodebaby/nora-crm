/**
 * Warnsymbol des Nora-Systemereignisses (Welle PWA-1C.1).
 *
 * **Herkunft.** Die Geometrie stammt unveraendert aus dem vom Product Owner
 * gelieferten SVG. Das Original liegt als Design-Asset unter
 * `docs/nora/assets/pwa-update-warning-source.svg` und wird nicht ueberschrieben.
 * Beim Ueberfuehren in Nora wurde ausschliesslich der Export-Ballast entfernt:
 *
 * - `fill="#000000"` am Wurzelelement (die vollflaechig dunkle Exportfarbe, die
 *   alle vier Teile schwarz einfaerbte) → durch `fill="none"` ersetzt, die
 *   Farbe kommt jetzt pro Teil aus den Nora-Tokens
 * - Adobe-`DOCTYPE`/Entities, `<metadata>`, `x`/`i`/`graph`-Namespaces,
 *   `enable-background`, `xml:space` und die feste 800×800-Pixelgroesse entfernt
 * - die vier verschachtelten `<g>`-Huellen aufgeloest (sie trugen keine
 *   Transformation)
 *
 * Die `viewBox="0 0 24 24"` und jeder Pfad-`d`-String sind byteweise identisch
 * zum Original. Es wurde nichts nachgezeichnet, nichts gerastert und nichts
 * durch ein Lucide-Icon ersetzt.
 *
 * **Vier Teile, vier Auftritte.** Das Original zerfaellt in genau die Teile, die
 * die Choreografie braucht — `frame` (aeussere Dreieckskontur), `bar`
 * (Warnstrich), `ring` (Kontur um den Punkt) und `dot` (Punktkern). Sie treten
 * in dieser Reihenfolge leicht versetzt auf (Regeln in `index.css`), danach
 * steht das Symbol still. Ein dauerhaft pulsierendes Warnsymbol erzeugt
 * Nervositaet statt Aufmerksamkeit.
 *
 * **Accessibility.** Bewusst `aria-hidden`: der Text unmittelbar daneben sagt
 * bereits vollstaendig, dass offene Eingaben gespeichert werden sollen. Das
 * Symbol traegt keine eigenstaendige Information, eine Bezeichnung waere eine
 * zweite Screenreader-Ansage derselben Warnung.
 */
export const NoraSafetyMark = () => (
  <svg
    className="nora-safety-mark"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    <path
      data-mark-part="frame"
      d="M23,23H1c-0.4,0-0.7-0.2-0.9-0.5c-0.2-0.3-0.2-0.7,0-1l11-20c0.4-0.6,1.4-0.6,1.8,0l11,20c0.2,0.3,0.2,0.7,0,1
			C23.7,22.8,23.4,23,23,23z M2.7,21h18.6L12,4.1L2.7,21z"
    />
    <path
      data-mark-part="bar"
      d="M12,16c-0.6,0-1-0.4-1-1v-5c0-0.6,0.4-1,1-1s1,0.4,1,1v5C13,15.6,12.6,16,12,16z"
    />
    <path
      data-mark-part="ring"
      d="M12,19.5c-0.8,0-1.5-0.7-1.5-1.5s0.7-1.5,1.5-1.5s1.5,0.7,1.5,1.5S12.8,19.5,12,19.5z M12,17.5c-0.3,0-0.5,0.2-0.5,0.5
				s0.2,0.5,0.5,0.5s0.5-0.2,0.5-0.5S12.3,17.5,12,17.5z"
    />
    <circle data-mark-part="dot" cx="12" cy="18" r="1" />
  </svg>
);
