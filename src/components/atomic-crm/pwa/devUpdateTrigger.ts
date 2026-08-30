import { pwaUpdateStore, type RegisterSwLike } from "./pwaUpdateStore";

/**
 * Entwicklerwerkzeug zum Auslösen und Prüfen des Nora-Systemereignisses
 * (Welle PWA-1C.1). **Nur im Dev-Server. Niemals in Production.**
 *
 * **Warum es das gibt.** Das Update-Ereignis erscheint im echten Betrieb nur
 * dann, wenn ein neuer Service Worker installiert ist und WAITING steht — also
 * frühestens nach einem Deployment. Ohne dieses Werkzeug ließe sich die
 * Gestaltung (Orb, Warnsymbol, Achtsekundenchoreografie, Hell/Dunkel, Reduced
 * Motion) nur nach einem echten Release beurteilen, und Nachbessern hieße:
 * wieder deployen.
 *
 * **Wie die Production-Freiheit garantiert ist.** Dieses Modul wird in
 * `src/main.tsx` ausschließlich über einen dynamischen Import innerhalb von
 * `if (import.meta.env.DEV)` geladen. Vite ersetzt `import.meta.env.DEV` beim
 * Bauen statisch durch `false`; Rollup entfernt den toten Zweig samt dem
 * dynamischen Import, sodass aus diesem Modul **kein einziges Byte** im
 * Production-Bundle landet. Ein statischer Import wäre schwächer — der bliebe
 * am Modulanfang stehen und würde nur durch Tree-Shaking entfernt, das
 * Nebenwirkungsfreiheit voraussetzt. Zusätzlich prüft `mount()` das Flag
 * selbst noch einmal.
 *
 * **Bewusst kein Hostname-Check.** Der Dev-Server ist mit `--host` auch unter
 * der LAN-Adresse erreichbar — genau so testet man auf einem echten Telefon.
 * Eine Einschränkung auf `localhost` würde ausgerechnet den mobilen Testfall
 * blockieren. Das Build-Flag ist die richtige und schärfere Grenze.
 *
 * **Bewusst reines DOM, kein React und kein Eintrag in `index.css`.** Das
 * Werkzeug hängt an keinem Kontext, es überlebt jeden Routenwechsel, und es
 * kann per Konstruktion nichts an der ausgelieferten CSS ändern. Es fasst
 * ausschließlich `pwaUpdateStore` an — dieselbe Schnittstelle, die auch die
 * echte Oberfläche benutzt.
 */

/**
 * Ersatz für `virtual:pwa-register`.
 *
 * Im Dev-Server ist in `vite.config.ts` kein `devOptions` gesetzt, es wird also
 * ohnehin kein Service Worker registriert — `registerSW` ist dort ein Stub, der
 * `onNeedRefresh` nie aufruft. Diese Fälschung zu setzen kostet deshalb nichts
 * Echtes, holt aber den Verfügbar-Zustand her.
 */
const createFakeRegisterSw = (state: { fail: boolean }): RegisterSwLike => {
  return (options) => {
    needRefresh = options.onNeedRefresh;
    options.onRegisteredSW?.("/sw.js", undefined);
    return () =>
      state.fail
        ? // Führt in den Recovery-Zustand („Erneut versuchen"), von dem aus sich
          // die Choreografie beliebig oft wiederholen lässt.
          Promise.reject(new Error("devUpdateTrigger: simulierter Fehlschlag"))
        : // Im echten Betrieb lädt der Client an dieser Stelle die Seite neu.
          // Hier bleibt der Store in „applying", damit die Szene stehen bleibt
          // und beurteilt werden kann.
          new Promise<void>(() => {});
  };
};

let needRefresh: (() => void) | undefined;

/**
 * Liest die **echte** `@media (prefers-reduced-motion: reduce)`-Regel aus den
 * geladenen Stylesheets und gibt sie ohne die Bedingung zurück.
 *
 * Bewusst nicht von Hand nachgebaut: eine Kopie würde beim nächsten
 * CSS-Umbau still von der Wahrheit abweichen und dann etwas anderes zeigen als
 * der Browser. So ist es per Konstruktion dieselbe Regel.
 *
 * Grenze: das simuliert die CSS-Regel, nicht die Browsereinstellung. Code, der
 * `matchMedia("(prefers-reduced-motion: reduce)")` abfragt, sieht davon nichts.
 */
const extractReducedMotionCss = (): string => {
  const parts: string[] = [];

  const walk = (rules: CSSRuleList) => {
    for (const rule of rules) {
      const grouping = rule as CSSGroupingRule & {
        conditionText?: string;
        media?: MediaList;
      };
      const condition =
        grouping.conditionText ?? grouping.media?.mediaText ?? "";

      if (condition.includes("prefers-reduced-motion")) {
        const body = [...grouping.cssRules]
          .map((inner) => inner.cssText)
          .join("\n");
        // Tailwinds `motion-reduce:`-Varianten liegen als Media-Block INNERHALB
        // einer Regel. Ohne den Selektor des Elternteils wären das nackte
        // Deklarationen und der Browser würfe sie weg.
        const parent = rule.parentRule as CSSStyleRule | null;
        parts.push(
          parent?.selectorText ? `${parent.selectorText} { ${body} }` : body,
        );
        continue;
      }

      if (grouping.cssRules) walk(grouping.cssRules);
    }
  };

  for (const sheet of document.styleSheets) {
    try {
      walk(sheet.cssRules);
    } catch {
      // Fremde Stylesheets (CDN, Erweiterungen) sind nicht lesbar. Irrelevant —
      // Noras eigene CSS ist es.
    }
  }

  return parts.join("\n");
};

const REDUCED_MOTION_STYLE_ID = "nora-dev-reduced-motion";

const PANEL_STYLE = `
  position: fixed;
  left: 12px;
  bottom: 12px;
  z-index: 90;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  width: 208px;
  border-radius: 12px;
  border: 1px solid rgb(255 255 255 / 0.14);
  background: rgb(24 24 27 / 0.94);
  color: rgb(244 244 245);
  font: 12px/1.4 ui-sans-serif, system-ui, sans-serif;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.4);
  backdrop-filter: blur(6px);
`;

const BUTTON_STYLE = `
  appearance: none;
  border: 1px solid rgb(255 255 255 / 0.14);
  border-radius: 8px;
  background: rgb(255 255 255 / 0.07);
  color: inherit;
  font: inherit;
  text-align: left;
  padding: 7px 9px;
  cursor: pointer;
`;

export const mountUpdateDevTrigger = () => {
  // Zweiter Riegel. Der erste ist der dynamische Import in `main.tsx`.
  if (!import.meta.env.DEV) return;
  if (document.getElementById("nora-dev-pwa-panel")) return;

  const state = { fail: false, hijacked: false, fast: false };

  const panel = document.createElement("div");
  panel.id = "nora-dev-pwa-panel";
  panel.setAttribute("style", PANEL_STYLE);

  const title = document.createElement("div");
  title.textContent = "PWA-Update (nur Dev)";
  title.setAttribute(
    "style",
    "font-weight:600;letter-spacing:.01em;opacity:.85",
  );

  const status = document.createElement("div");
  status.setAttribute(
    "style",
    "opacity:.65;font-variant-numeric:tabular-nums;min-height:1.4em",
  );

  const addButton = (label: string, onClick: () => void) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.setAttribute("style", BUTTON_STYLE);
    button.addEventListener("click", onClick);
    panel.append(button);
    return button;
  };

  panel.append(title, status);

  addButton("▶  Update anzeigen", () => {
    // Erst beim Klick übernehmen, nicht schon beim Laden: solange niemand das
    // Werkzeug benutzt, bleibt der echte Registrierungsweg unangetastet.
    if (!state.hijacked) {
      pwaUpdateStore.reset();
      pwaUpdateStore.start(createFakeRegisterSw(state));
      state.hijacked = true;
    }
    needRefresh?.();
  });

  const replayButton = addButton("⟲  Replay: aus", () => {
    state.fail = !state.fail;
    replayButton.textContent = state.fail ? "⟲  Replay: an" : "⟲  Replay: aus";
  });
  replayButton.title =
    "An: nach der Sequenz erscheint „Erneut versuchen“ statt des Reloads — " +
    "damit lässt sich die Choreografie beliebig oft ansehen.";

  addButton("◐  Hell / Dunkel", () => {
    document.documentElement.classList.toggle("dark");
  });

  const speedButton = addButton("⏩  Orb-Tempo ×1", () => {
    state.fast = !state.fast;
    const rate = state.fast ? 8 : 1;
    document
      .querySelector(".nora-orb")
      ?.getAnimations({ subtree: true })
      .forEach((animation) => {
        animation.playbackRate = rate;
      });
    speedButton.textContent = `⏩  Orb-Tempo ×${rate}`;
  });
  speedButton.title =
    "Die Orb-Ebenen laufen mit Perioden bis 89 Sekunden. ×8 zeigt den " +
    "vollständigen Morph-Zyklus in Sekunden statt in anderthalb Minuten.";

  const reducedButton = addButton("♿  Reduced Motion: aus", () => {
    const existing = document.getElementById(REDUCED_MOTION_STYLE_ID);
    existing?.remove();
    if (existing) {
      reducedButton.textContent = "♿  Reduced Motion: aus";
      return;
    }
    const style = document.createElement("style");
    style.id = REDUCED_MOTION_STYLE_ID;
    style.textContent = extractReducedMotionCss();
    document.head.append(style);
    reducedButton.textContent = "♿  Reduced Motion: an";
  });

  addButton("↻  Neu laden", () => window.location.reload());

  // Der Store ist die einzige Quelle für die Statuszeile — dieselbe
  // Schnittstelle, die auch die echte Oberfläche liest.
  const render = () => {
    const snapshot = pwaUpdateStore.getSnapshot();
    const event = document.querySelector<HTMLElement>(
      '[data-testid="nora-pwa-update-event"]',
    );
    const shown = event
      ? `${event.dataset.presentation} · ${event.dataset.phase}`
      : state.hijacked
        ? "nicht sichtbar"
        : "bereit";
    status.textContent = `Store: ${snapshot.state} — Panel: ${shown}`;
  };

  const unsubscribe = pwaUpdateStore.subscribe(render);
  // Die Phase lebt lokal in der Komponente, nicht im Store — sie ändert sich
  // also ohne Store-Ereignis. Ein ruhiger Takt hält die Zeile trotzdem aktuell,
  // ohne pro Frame zu arbeiten.
  const ticker = window.setInterval(render, 250);
  render();

  document.body.append(panel);

  // Vite tauscht Module im Betrieb aus; ohne dieses Aufräumen sammelten sich
  // bei jedem Speichern ein weiteres Panel und ein weiterer Timer an.
  import.meta.hot?.dispose(() => {
    unsubscribe();
    window.clearInterval(ticker);
    panel.remove();
    document.getElementById(REDUCED_MOTION_STYLE_ID)?.remove();
  });
};
