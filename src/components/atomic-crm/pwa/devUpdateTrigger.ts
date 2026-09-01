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
 * Der wartende Worker als Attrappe.
 *
 * Bis PWA-1C.2 reichte das Werkzeug `undefined` als Registration durch. Damit
 * lieferte `hasWaitingWorker()` immer `false`, und die Recovery-Variante mit
 * „Erneut versuchen" war weder fuer QA noch fuer die Tests jemals erreichbar —
 * genau dort sass der BLOCKER, den niemand sehen konnte. Jetzt gibt es eine
 * Registration mit derselben Aussagekraft wie im Browser: ein `waiting`, das
 * verschwindet, sobald die Uebernahme stattfindet.
 *
 * Bewusst nur die zwei Eigenschaften, die der Store liest — kein nachgebauter
 * Browser. `update()` muss dabei sein, weil die stuendliche Pruefung des Stores
 * sie sonst auf `undefined` aufruft.
 */
const FAKE_WAITING_WORKER = {} as ServiceWorker;
/** Der bereits aktive Worker der Attrappe — im Browser der Controller des Dokuments. */
const FAKE_ACTIVE_WORKER = {} as ServiceWorker;

const createFakeRegistration = (state: { waiting: boolean }) =>
  ({
    get waiting() {
      return state.waiting ? FAKE_WAITING_WORKER : null;
    },
    installing: null,
    active: FAKE_ACTIVE_WORKER,
    update: () => Promise.resolve(),
  }) as unknown as ServiceWorkerRegistration;

/**
 * Ersatz für `virtual:pwa-register`.
 *
 * Im Dev-Server ist in `vite.config.ts` kein `devOptions` gesetzt, es wird also
 * ohnehin kein Service Worker registriert — `registerSW` ist dort ein Stub, der
 * `onNeedRefresh` nie aufruft. Diese Fälschung zu setzen kostet deshalb nichts
 * Echtes, holt aber den Verfügbar-Zustand her.
 */
const createFakeRegisterSw = (state: {
  reject: boolean;
  waiting: boolean;
  requests: number;
}): RegisterSwLike => {
  return (options) => {
    needRefresh = options.onNeedRefresh;
    options.onRegisteredSW?.("/sw.js", createFakeRegistration(state));
    return () => {
      // Die technische Beobachtungsgröße: jeder Aufruf ist genau ein
      // Aktivierungsversuch (SKIP_WAITING). Ein Retry, der diese Zahl nicht
      // erhöht, hat nichts getan — egal wie vollständig die Animation lief.
      state.requests += 1;
      return state.reject
        ? // Der theoretische Zweig: das Promise lehnt ab. Im ausgelieferten
          // Production-Client passiert das praktisch nie (siehe Modulkopf von
          // `pwaUpdateStore.ts`) — der Zweig existiert als Absicherung und
          // wird hier nur geprüft, damit er nicht ungetestet verrottet.
          Promise.reject(new Error("devUpdateTrigger: simulierte Ablehnung"))
        : // DER REALE PRODUCTION-FEHLERFALL, und deshalb der Standardweg
          // dieses Werkzeugs: die Anfrage geht raus und das Promise verhält
          // sich genau wie in Production — es sagt nichts über den Erfolg.
          // Ohne simulierte Übernahme bleibt `controllerchange` aus, und nach
          // der Watchdog-Frist muss der Recovery-Zustand erscheinen.
          new Promise<void>(() => {});
    };
  };
};

/**
 * Simuliert die echte Worker-Übernahme.
 *
 * `navigator.serviceWorker` ist ein normales `EventTarget`; ein hier
 * abgesetztes `controllerchange` erreicht denselben Listener, den der Store
 * auch in Production benutzt. Dadurch lässt sich der Erfolgspfad prüfen, ohne
 * eine einzige Zeile Production-Logik zu verändern oder aufzuweichen.
 */
const simulateTakeover = (state: { waiting: boolean }) => {
  // Eine echte Übernahme räumt den wartenden Worker weg. Ohne diese Zeile
  // behauptete das Werkzeug einen Zustand, den es im Browser nicht gibt:
  // „übernommen, und trotzdem wartet noch einer".
  state.waiting = false;
  navigator.serviceWorker?.dispatchEvent(new Event("controllerchange"));
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

  const state = {
    reject: false,
    hijacked: false,
    fast: false,
    // Seit V2: ob dieses Dokument einen Controller hat. „aus" ist der
    // reproduzierte Production-Fall (Erstbesuch, Hard Reload): der Worker
    // aktiviert sich von selbst, und die Oberflaeche muss auf „Neu laden"
    // statt auf eine Schein-Choreografie laufen.
    controlled: true,
    // Standard: ein Worker wartet. Das ist der reale Fehlerfall, für den der
    // Watchdog gebaut wurde, und damit die Recovery-Variante „Erneut
    // versuchen" — bis PWA-1C.2 war genau sie hier nicht herstellbar.
    waiting: true,
    requests: 0,
  };

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
      pwaUpdateStore.start(createFakeRegisterSw(state), {
        getController: () => (state.controlled ? FAKE_ACTIVE_WORKER : null),
      });
      state.hijacked = true;
    }
    needRefresh?.();
  });

  const waitingButton = addButton("⏻  Wartender Worker: an", () => {
    state.waiting = !state.waiting;
    waitingButton.textContent = state.waiting
      ? "⏻  Wartender Worker: an"
      : "⏻  Wartender Worker: aus";
  });
  waitingButton.title =
    "Steuert registration.waiting. An → das Update ist aktivierbar. Aus → " +
    "nichts wartet mehr; zusammen mit „Dokument kontrolliert: aus“ ergibt " +
    "das den Zustand „Neue Version bereit / Nora neu laden“.";

  const controlledButton = addButton("⎈  Dokument kontrolliert: an", () => {
    state.controlled = !state.controlled;
    controlledButton.textContent = state.controlled
      ? "⎈  Dokument kontrolliert: an"
      : "⎈  Dokument kontrolliert: aus";
    // Ein Fakt hat sich geaendert — genau wie im Browser wird neu gelesen.
    if (state.hijacked) pwaUpdateStore.syncFacts();
  });
  controlledButton.title =
    "Steuert navigator.serviceWorker.controller. Aus = Erstbesuch / Hard " +
    "Reload: dieses Dokument bekommt nie ein controllerchange. Wartender " +
    "Worker aus + kontrolliert aus → Neue Version bereit (Reload statt " +
    "Choreografie).";

  const takeoverButton = addButton("✔  Übernahme simulieren", () => {
    simulateTakeover(state);
    if (state.hijacked) pwaUpdateStore.syncFacts();
  });
  takeoverButton.title =
    "Setzt ein echtes „controllerchange“ ab — der Erfolgsfall. Ohne diesen " +
    "Klick bleibt die Übernahme aus: nach der Watchdog-Frist muss „Gleich " +
    "bereit“ (Worker wartet) erscheinen, nicht ein Fehler.";

  const rejectButton = addButton("⟲  Ablehnung: aus", () => {
    state.reject = !state.reject;
    rejectButton.textContent = state.reject
      ? "⟲  Ablehnung: an"
      : "⟲  Ablehnung: aus";
  });
  rejectButton.title =
    "An: das Promise von updateServiceWorker() lehnt ab. In Production " +
    "passiert das praktisch nie — der Schalter prüft nur, dass der " +
    "Absicherungszweig im Store nicht verrottet.";

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
    status.textContent =
      `Store: ${snapshot.state}` +
      `${snapshot.activated ? " +übernommen" : ""}` +
      `${snapshot.reloadRequired ? " +reload" : ""} — Panel: ${shown}` +
      // Ohne diese Zahl lässt sich am Bildschirm nicht unterscheiden, ob
      // „Erneut versuchen" wirklich einen zweiten Aktivierungsversuch
      // ausgelöst oder nur die Choreografie noch einmal abgespielt hat.
      ` — Anfragen: ${state.requests}`;
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
