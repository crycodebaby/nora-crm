import type { ChoreographyPhase } from "./useUpdateChoreography";

/**
 * Der Nora Update Orb — Mittelpunkt des Systemereignisses (Welle PWA-1C.1).
 *
 * **Warum kein Spinner.** Ein Spinner sagt „warte". Dieses Ereignis sagt „Nora
 * erneuert sich". Deshalb eine organische Form, die ruhig lebt, statt eines
 * Indikators, der Zeit vergehen laesst.
 *
 * **Warum so viele Ebenen.** Der erste Entwurf (PWA-1C) hatte zwei rotierende
 * Schichten und einen atmenden Kern — das las sich als „animiertes Icon", nicht
 * als Organismus. Tiefe entsteht nicht durch mehr Bewegung, sondern durch
 * mehrere Ebenen mit *unterschiedlichen* Perioden:
 *
 *   aura      weiche, weit auslaufende Aura            11 s
 *   halo      zweite, groessere Aura, gegenlaeufig     17 s
 *   membrane  zwei morphende Aussenformen              19 s / 26 s
 *   body      innere Form                              23 s
 *   sheen     Oberflaechen-Highlight (statisch)          —
 *   core      lebender Kern: Drift 15 s, Masse 9,5 s, Morph 21 s
 *
 * Keine dieser Zahlen ist ein Vielfaches einer anderen. Die Ebenen laufen
 * deshalb nie wieder synchron zusammen — genau das trennt „lebendig" von
 * „animiert". Der Kern faehrt bewusst *keine* Kreisbahn: seine Keyframes liegen
 * auf ungleichen Zeitpunkten (23 %, 41 %, 62 %, 81 %) und ungleichen Abstaenden
 * vom Zentrum, sodass keine erkennbare Bahn entsteht.
 *
 * **Technik.** Alles CSS. Animiert werden `transform` und `opacity`
 * (compositor-freundlich) sowie kontrolliert `border-radius` fuer das Morphing.
 * Kein Canvas, keine Animationsbibliothek, kein JavaScript pro Frame.
 *
 * **Phasen.** `phase` steuert ausschliesslich CSS-Variablen am Panel
 * (Groesse, Aura-Ausdehnung, Aura-Deckkraft) — die Ebenen selbst laufen
 * durchgehend weiter. Dadurch gibt es beim Uebergang in die Update-Szene keinen
 * Zustandsbruch: dieselbe Form waechst, sie wird nicht ausgetauscht.
 *
 * Bei `prefers-reduced-motion: reduce` steht der Orb still (Regeln in
 * `index.css`). Er traegt keine Information, die nur ueber Bewegung entsteht.
 */
export const NoraUpdateOrb = ({
  phase = "idle",
}: {
  phase?: ChoreographyPhase;
}) => (
  <span className="nora-orb" data-phase={phase} aria-hidden="true">
    {/* Separate wrapper on purpose: it carries the phase-driven spread, the
        two gradients inside carry their own breathing. An animation always
        beats a transition on the same property, so combining the two on one
        element would make the aura jump open instead of spreading. */}
    <span className="nora-orb-field">
      <span className="nora-orb-aura" />
      <span className="nora-orb-halo" />
    </span>
    <span className="nora-orb-membrane nora-orb-membrane-a" />
    <span className="nora-orb-membrane nora-orb-membrane-b" />
    <span className="nora-orb-body" />
    <span className="nora-orb-sheen" />
    <span className="nora-orb-core">
      <span className="nora-orb-core-mass" />
    </span>
  </span>
);
