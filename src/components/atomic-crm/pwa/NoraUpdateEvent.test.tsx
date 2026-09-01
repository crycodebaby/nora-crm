import { StrictMode, act } from "react";
import { render } from "vitest-browser-react";
import { I18nContextProvider, type TranslationMessages } from "ra-core";
import polyglotI18nProvider from "ra-i18n-polyglot";

import { germanCrmMessages } from "../providers/commons/germanCrmMessages";
import { englishCrmMessages } from "../providers/commons/englishCrmMessages";
import { NoraUpdateEvent } from "./NoraUpdateEvent";
import { pwaUpdateStore, type RegisterSwLike } from "./pwaUpdateStore";
import {
  ACTIVATION_WATCHDOG_MS,
  CHOREOGRAPHY_COMMIT_MS,
  CHOREOGRAPHY_TIMELINE,
  RELOAD_FALLBACK_MS,
} from "./useUpdateChoreography";

/**
 * Die sichtbare Flaeche gegen den ECHTEN Store, mit Browser-Fakten als
 * Attrappe derselben Aussagekraft wie im Browser (Controller, wartender und
 * aktiver Worker als `EventTarget`s).
 *
 * Grenze: `window.location.reload` ist in einem echten Browser nicht
 * ersetzbar. Deshalb spulen die Tests nach einer Uebernahme nie ueber die
 * Reload-Frist hinaus — dass der Reload dann genau einmal faellt, prueft
 * `useUpdateChoreography.test.tsx`, wo er injizierbar ist.
 */

const makeWorker = () => new EventTarget() as unknown as ServiceWorker;

let oldWorker = makeWorker();
let newWorker = makeWorker();
const facts = {
  waiting: null as ServiceWorker | null,
  installing: null as ServiceWorker | null,
  active: null as ServiceWorker | null,
  controller: null as ServiceWorker | null,
};
const fakeRegistration = new EventTarget();
Object.defineProperties(fakeRegistration, {
  waiting: { get: () => facts.waiting },
  installing: { get: () => facts.installing },
  active: { get: () => facts.active },
  update: { value: () => Promise.resolve() },
});

let needRefresh: (() => void) | undefined;
let applyCalls = 0;
let rejectApply = false;

const fakeRegisterSW: RegisterSwLike = (opts) => {
  needRefresh = opts.onNeedRefresh;
  opts.onRegisteredSW?.(
    "/sw.js",
    fakeRegistration as unknown as ServiceWorkerRegistration,
  );
  return () => {
    applyCalls += 1;
    if (rejectApply) return Promise.reject(new Error("activation refused"));
    return Promise.resolve();
  };
};

const activateNewWorker = ({ notify }: { notify: boolean }) => {
  facts.waiting = null;
  facts.active = newWorker;
  if (notify) facts.controller = newWorker;
  newWorker.dispatchEvent(new Event("statechange"));
  if (notify)
    navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
};

// Die reinen Nora-Kataloge ohne die `ra.*`-Basis: fuer diesen Test reichen die
// `crm.pwa.*`-Schluessel, `allowMissing` deckt den Rest ab.
const makeI18n = (locale: "de" | "en") =>
  polyglotI18nProvider(
    () =>
      (locale === "en"
        ? englishCrmMessages
        : germanCrmMessages) as unknown as TranslationMessages,
    locale,
    [{ locale, name: locale }],
    { allowMissing: true },
  );

const renderEvent = (locale: "de" | "en" = "de") =>
  render(
    <I18nContextProvider value={makeI18n(locale)}>
      <NoraUpdateEvent />
    </I18nContextProvider>,
  );

const renderStrict = () =>
  render(
    <StrictMode>
      <I18nContextProvider value={makeI18n("de")}>
        <NoraUpdateEvent />
      </I18nContextProvider>
    </StrictMode>,
  );

const panel = () =>
  document.querySelector<HTMLElement>('[data-testid="nora-pwa-update-event"]');
const testId = (id: string) =>
  document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const title = () => panel()?.querySelector("h2")?.textContent ?? "";
const hint = () => testId("nora-pwa-update-hint")?.textContent ?? "";
const buttons = () => [...(panel()?.querySelectorAll("button") ?? [])];

const useSequenceTimers = () =>
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const flush = async (body: () => void) => {
  const previous = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => {
      body();
    });
  } finally {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previous;
  }
};
const advance = (ms: number) => flush(() => vi.advanceTimersByTime(ms));
const announceUpdate = () => flush(() => needRefresh!());
const click = async (id: string) => {
  const node = testId(id);
  expect(node, `${id} sollte im DOM sein`).not.toBeNull();
  await flush(() => node!.click());
};
/** Commit und Watchdog bewusst getrennt: der Watchdog-Timer entsteht erst im Effekt nach dem Commit. */
const commit = () => advance(CHOREOGRAPHY_COMMIT_MS);
const watchdog = () => advance(ACTIVATION_WATCHDOG_MS);

describe("NoraUpdateEvent", () => {
  beforeEach(() => {
    pwaUpdateStore.reset();
    oldWorker = makeWorker();
    newWorker = makeWorker();
    facts.waiting = newWorker;
    facts.installing = null;
    facts.active = oldWorker;
    facts.controller = oldWorker;
    applyCalls = 0;
    rejectApply = false;
    pwaUpdateStore.start(fakeRegisterSW, {
      getController: () => facts.controller,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    pwaUpdateStore.reset();
  });

  // --- AVAILABLE ---------------------------------------------------------------

  it("zeigt nichts, solange kein Update entdeckt ist", async () => {
    const screen = await renderEvent();
    await expect
      .element(screen.getByTestId("nora-pwa-update-event"))
      .not.toBeInTheDocument();
    await screen.unmount();
  });

  it("zeigt Titel, eine ruhige Speicherzeile und beide Aktionen — sonst nichts", async () => {
    const screen = await renderEvent();
    await announceUpdate();

    await expect
      .element(screen.getByTestId("nora-pwa-update-event"))
      .toBeInTheDocument();
    expect(title()).toBe("Neue Nora-Version verfügbar");
    expect(hint()).toBe(
      "Offene Eingaben vor dem Aktualisieren kurz speichern.",
    );
    expect(buttons().map((b) => b.textContent)).toEqual([
      "Später",
      "Jetzt aktualisieren",
    ]);

    // Weg ist, was der Product Owner abgelehnt hat: der erklaerende Absatz,
    // die Warnbox, das Warnsymbol.
    expect(panel()?.textContent).not.toContain(
      "aktualisierte Version ist bereit",
    );
    expect(panel()?.textContent).not.toContain("läuft weiter");
    expect(panel()?.textContent).not.toContain("verloren gehen");
    expect(panel()?.querySelector("svg")).toBeNull();
    expect(document.querySelector(".nora-safety-mark")).toBeNull();
    expect(document.querySelector(".nora-system-event-safety")).toBeNull();

    // Systemereignis, nicht Statusmeldung: keine 7B-Karte, kein Toast.
    expect(panel()!.getAttribute("role")).toBe("group");
    expect(
      document.querySelectorAll('[data-testid="nora-notification-card"]')
        .length,
    ).toBe(0);
    expect(document.querySelectorAll("[data-sonner-toast]").length).toBe(0);

    await screen.unmount();
  });

  it("blendet bei 'Später' aus, ohne das Update zu verwerfen", async () => {
    const screen = await renderEvent();
    await announceUpdate();

    await click("nora-pwa-update-later");
    await expect
      .element(screen.getByTestId("nora-pwa-update-event"))
      .not.toBeInTheDocument();
    expect(applyCalls).toBe(0);

    await announceUpdate();
    await expect
      .element(screen.getByTestId("nora-pwa-update-event"))
      .toBeInTheDocument();

    await screen.unmount();
  });

  it("schliesst per Escape nur im handlungsfaehigen Zustand", async () => {
    useSequenceTimers();
    const screen = await renderEvent();
    await announceUpdate();

    const esc = () =>
      flush(() =>
        panel()!.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
      );
    await click("nora-pwa-update-apply");
    await esc();
    // Waehrend der Sequenz gibt es kein Zurueck.
    expect(panel()).not.toBeNull();
    expect(panel()?.dataset.presentation).toBe("applying");

    await screen.unmount();
  });

  // --- APPLYING ----------------------------------------------------------------

  it("startet beim Klick die Choreografie, ohne sofort zu aktualisieren", async () => {
    useSequenceTimers();
    const screen = await renderEvent();
    await announceUpdate();

    await click("nora-pwa-update-apply");

    expect(applyCalls).toBe(0);
    expect(panel()?.dataset.presentation).toBe("applying");
    expect(panel()?.dataset.phase).toBe("settling");
    // Der Bestandsvertrag aus PWA-1C bleibt lesbar.
    expect(panel()?.dataset.state).toBe("applying");

    await screen.unmount();
  });

  it("wechselt den Titel erst, wenn er unsichtbar ist — kein harter Sprung", async () => {
    useSequenceTimers();
    const screen = await renderEvent();
    await announceUpdate();
    await click("nora-pwa-update-apply");

    expect(title()).toBe("Neue Nora-Version verfügbar");
    expect(testId("nora-pwa-update-dots")).toBeNull();

    await advance(CHOREOGRAPHY_TIMELINE.converging);
    expect(title()).toBe("Neue Nora-Version verfügbar");

    await advance(
      CHOREOGRAPHY_TIMELINE.sustaining - CHOREOGRAPHY_TIMELINE.converging,
    );
    expect(title()).toBe("Nora wird aktualisiert");
    expect(testId("nora-pwa-update-dots")?.children.length).toBe(3);
    // Kein erklaerender Text neben dem Titel.
    expect(hint()).toBe("");

    await screen.unmount();
  });

  it("durchläuft alle vier Phasen und aktualisiert erst nach der vollen Dauer", async () => {
    useSequenceTimers();
    const screen = await renderEvent();
    await announceUpdate();
    await click("nora-pwa-update-apply");

    await advance(CHOREOGRAPHY_TIMELINE.converging);
    expect(panel()?.dataset.phase).toBe("converging");
    await advance(
      CHOREOGRAPHY_TIMELINE.sustaining - CHOREOGRAPHY_TIMELINE.converging,
    );
    expect(panel()?.dataset.phase).toBe("sustaining");
    expect(testId("nora-pwa-update-apply")).toBeNull();
    expect(testId("nora-pwa-update-later")).toBeNull();
    await advance(
      CHOREOGRAPHY_TIMELINE.committing - CHOREOGRAPHY_TIMELINE.sustaining,
    );
    expect(panel()?.dataset.phase).toBe("committing");
    await advance(
      CHOREOGRAPHY_COMMIT_MS - CHOREOGRAPHY_TIMELINE.committing - 1,
    );
    expect(applyCalls).toBe(0);

    await advance(1);
    expect(applyCalls).toBe(1);
    // Die Szene laeuft weiter, bis der Browser tatsaechlich neu laedt.
    expect(title()).toBe("Nora wird aktualisiert");

    await screen.unmount();
  });

  it("ruft applyUpdate genau einmal, auch bei Doppelklick und unter StrictMode", async () => {
    useSequenceTimers();
    const screen = await renderStrict();
    await announceUpdate();

    await click("nora-pwa-update-apply");
    await click("nora-pwa-update-apply");
    await commit();

    expect(applyCalls).toBe(1);
    await screen.unmount();
  });

  it("bricht die Sequenz beim Unmount ab und aktualisiert dann nicht mehr", async () => {
    useSequenceTimers();
    const screen = await renderEvent();
    await announceUpdate();
    await click("nora-pwa-update-apply");

    await advance(CHOREOGRAPHY_TIMELINE.sustaining);
    await screen.unmount();

    await advance(CHOREOGRAPHY_COMMIT_MS * 2);
    expect(applyCalls).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bleibt nach rechtzeitiger Uebernahme in der Update-Szene", async () => {
    useSequenceTimers();
    const screen = await renderEvent();
    await announceUpdate();
    await click("nora-pwa-update-apply");
    await commit();

    await flush(() => activateNewWorker({ notify: true }));

    // Bewusst nur bis kurz vor die Reload-Frist.
    await advance(RELOAD_FALLBACK_MS - 1);
    expect(panel()?.dataset.presentation).toBe("applying");
    expect(title()).toBe("Nora wird aktualisiert");
    expect(buttons().length).toBe(0);
    expect(applyCalls).toBe(1);

    await screen.unmount();
  });

  // --- SLOW --------------------------------------------------------------------

  it("zeigt „Gleich bereit …“ statt eines Fehlers, wenn die Uebernahme ausbleibt", async () => {
    useSequenceTimers();
    const screen = await renderEvent();
    await announceUpdate();
    await click("nora-pwa-update-apply");
    await commit();
    expect(applyCalls).toBe(1);

    await advance(ACTIVATION_WATCHDOG_MS - 1);
    expect(panel()?.dataset.presentation).toBe("applying");
    await advance(1);

    expect(panel()?.dataset.presentation).toBe("slow");
    expect(title()).toBe("Gleich bereit …");
    expect(hint()).toBe("Nora bereitet die neue Version noch kurz vor.");
    expect(testId("nora-pwa-update-dots")).not.toBeNull();
    // Keine Fehlersprache, keine Aktion — Nora versucht es still erneut.
    expect(panel()?.textContent).not.toContain("länger als erwartet");
    expect(panel()?.textContent).not.toContain("nicht");
    expect(buttons().length).toBe(0);
    expect(applyCalls).toBe(2);

    await screen.unmount();
  });

  it("bietet nach der zweiten Frist ruhig den Reload an — ohne Fehlerbehauptung", async () => {
    useSequenceTimers();
    const screen = await renderEvent();
    await announceUpdate();
    await click("nora-pwa-update-apply");
    await commit();
    await watchdog();
    await watchdog();

    expect(panel()?.dataset.presentation).toBe("slow");
    expect(panel()?.dataset.stall).toBe("prolonged");
    expect(title()).toBe("Gleich bereit …");
    expect(hint()).toBe(
      "Falls es nicht weitergeht, hilft ein kurzes Neuladen.",
    );
    expect(buttons().map((b) => b.textContent)).toEqual(["Nora neu laden"]);
    expect(applyCalls).toBe(2);

    await screen.unmount();
  });

  it("nimmt „Gleich bereit“ zurueck, wenn die Uebernahme verspaetet doch eintrifft", async () => {
    useSequenceTimers();
    const screen = await renderEvent();
    await announceUpdate();
    await click("nora-pwa-update-apply");
    await commit();
    await watchdog();
    expect(panel()?.dataset.presentation).toBe("slow");

    await flush(() => activateNewWorker({ notify: true }));

    expect(panel()?.dataset.presentation).toBe("applying");
    expect(title()).toBe("Nora wird aktualisiert");
    expect(buttons().length).toBe(0);

    await screen.unmount();
  });

  // --- RELOAD_REQUIRED ---------------------------------------------------------

  it("zeigt im unkontrollierten Dokument „Neue Version bereit“ statt einer Schein-Choreografie", async () => {
    facts.controller = null;
    useSequenceTimers();
    const screen = await renderEvent();
    await announceUpdate();
    expect(panel()?.dataset.presentation).toBe("available");

    // 2 ms nach der Entdeckung aktiviert der Worker sich selbst — ohne
    // controllerchange fuer dieses Dokument.
    await flush(() => activateNewWorker({ notify: false }));

    expect(panel()?.dataset.presentation).toBe("reloadRequired");
    expect(title()).toBe("Neue Version bereit");
    expect(hint()).toBe(
      "Offene Eingaben vor dem Aktualisieren kurz speichern.",
    );
    expect(buttons().map((b) => b.textContent)).toEqual([
      "Später",
      "Nora neu laden",
    ]);
    expect(testId("nora-pwa-update-reload")?.textContent).toBe(
      "Nora neu laden",
    );
    // Nichts davon liest sich als Fehler.
    expect(panel()?.textContent).not.toContain("konnte");
    expect(panel()?.textContent).not.toContain("nicht");
    expect(applyCalls).toBe(0);

    await screen.unmount();
  });

  it("korrigiert sich selbst, wenn ein anderer Tab aktiviert hat", async () => {
    useSequenceTimers();
    const screen = await renderEvent();
    await announceUpdate();

    await flush(() => activateNewWorker({ notify: true }));

    expect(panel()?.dataset.presentation).toBe("reloadRequired");
    expect(title()).toBe("Neue Version bereit");
    expect(testId("nora-pwa-update-apply")).toBeNull();
    expect(applyCalls).toBe(0);

    await screen.unmount();
  });

  it("laesst den Reload-Hinweis verschieben", async () => {
    facts.controller = null;
    const screen = await renderEvent();
    await announceUpdate();
    await flush(() => activateNewWorker({ notify: false }));
    expect(panel()?.dataset.presentation).toBe("reloadRequired");

    await click("nora-pwa-update-later");
    await expect
      .element(screen.getByTestId("nora-pwa-update-event"))
      .not.toBeInTheDocument();

    await screen.unmount();
  });

  it("laeuft nach einem Klick vor dem Uebergang ohne Fehler in den Reload", async () => {
    facts.controller = null;
    useSequenceTimers();
    const screen = await renderEvent();
    await announceUpdate();
    await click("nora-pwa-update-apply");
    await commit();
    expect(applyCalls).toBe(1);

    await flush(() => activateNewWorker({ notify: false }));
    // Reload-Befund nach Commit: die Szene bleibt ruhig, Nora laedt gleich.
    expect(panel()?.dataset.presentation).toBe("applying");
    await advance(RELOAD_FALLBACK_MS - 1);
    expect(panel()?.dataset.presentation).toBe("applying");
    expect(applyCalls).toBe(1);

    await screen.unmount();
  });

  // --- FAILED ------------------------------------------------------------------

  it("zeigt bei abgelehnter Anfrage einen ruhigen, ehrlichen Fehlerzustand", async () => {
    rejectApply = true;
    useSequenceTimers();
    const screen = await renderEvent();
    await announceUpdate();
    await click("nora-pwa-update-apply");
    await commit();
    await flush(() => {});

    expect(panel()?.dataset.presentation).toBe("failed");
    expect(title()).toBe("Aktualisierung gerade nicht möglich");
    expect(hint()).toBe("Sie können normal weiterarbeiten.");
    expect(buttons().map((b) => b.textContent)).toEqual(["Weiterarbeiten"]);
    // Keine Aktivitaetspunkte: es laeuft nichts mehr.
    expect(testId("nora-pwa-update-dots")).toBeNull();
    // Kein Warten, keine Wiederholung von allein.
    await watchdog();
    expect(panel()?.dataset.presentation).toBe("failed");
    expect(applyCalls).toBe(1);

    await click("nora-pwa-update-continue");
    await expect
      .element(screen.getByTestId("nora-pwa-update-event"))
      .not.toBeInTheDocument();

    await screen.unmount();
  });

  // --- Fokus -------------------------------------------------------------------

  it("laesst den Fokus nach der Primaeraktion nicht ins Nirgendwo fallen", async () => {
    useSequenceTimers();
    const screen = await renderEvent();
    await announceUpdate();

    const apply = testId("nora-pwa-update-apply")!;
    apply.focus();
    await flush(() => apply.click());

    await advance(CHOREOGRAPHY_TIMELINE.sustaining);
    expect(testId("nora-pwa-update-apply")).toBeNull();
    expect(document.activeElement).toBe(panel());

    // Sobald es wieder eine Aktion gibt, liegt der Fokus darauf.
    await advance(CHOREOGRAPHY_COMMIT_MS - CHOREOGRAPHY_TIMELINE.sustaining);
    await watchdog();
    await watchdog();
    expect(document.activeElement).toBe(testId("nora-pwa-update-reload"));

    await screen.unmount();
  });

  it("gibt den Fokus nicht mehr her, wenn der Benutzer inzwischen woanders arbeitet", async () => {
    useSequenceTimers();
    const field = document.createElement("input");
    document.body.append(field);
    const screen = await renderEvent();
    await announceUpdate();

    const apply = testId("nora-pwa-update-apply")!;
    apply.focus();
    await flush(() => apply.click());
    await flush(() => field.focus());
    expect(document.activeElement).toBe(field);

    await commit();
    await watchdog();
    await watchdog();
    expect(panel()?.dataset.stall).toBe("prolonged");
    expect(document.activeElement).toBe(field);

    await screen.unmount();
    field.remove();
  });

  it("nimmt den Fokus nicht, wenn er ausserhalb des Panels liegt", async () => {
    useSequenceTimers();
    const outside = document.createElement("button");
    document.body.append(outside);
    const screen = await renderEvent();
    await announceUpdate();

    outside.focus();
    await flush(() => testId("nora-pwa-update-apply")!.click());
    await advance(CHOREOGRAPHY_TIMELINE.sustaining);
    expect(document.activeElement).toBe(outside);

    await screen.unmount();
    outside.remove();
  });

  // --- Announcer ---------------------------------------------------------------

  it("haelt die Live-Semantik im Announcer statt in der sichtbaren Flaeche", async () => {
    const screen = await renderEvent();
    await announceUpdate();

    const announcer = testId("nora-pwa-update-announcer")!;
    expect(announcer.getAttribute("aria-live")).toBe("polite");
    expect(announcer.getAttribute("role")).toBe("status");
    expect(panel()!.getAttribute("role")).toBe("group");
    expect(panel()!.querySelectorAll("[aria-live]").length).toBe(0);
    expect(announcer.textContent).toContain("Neue Nora-Version verfügbar");

    await screen.unmount();
  });

  it("sagt pro Zustandswechsel genau einmal an, nicht pro Mutation", async () => {
    useSequenceTimers();
    const screen = await renderEvent();
    await announceUpdate();

    const announcer = () => testId("nora-pwa-update-announcer")!;
    const seen: string[] = [];
    const record = () => {
      const text = announcer().textContent ?? "";
      if (seen[seen.length - 1] !== text) seen.push(text);
    };

    record();
    await click("nora-pwa-update-apply");
    record();
    await advance(CHOREOGRAPHY_TIMELINE.sustaining);
    record();
    await advance(CHOREOGRAPHY_COMMIT_MS - CHOREOGRAPHY_TIMELINE.sustaining);
    record();
    await watchdog();
    record();

    expect(seen).toEqual([
      "Neue Nora-Version verfügbar",
      "Nora wird aktualisiert",
      "Gleich bereit …",
    ]);

    await screen.unmount();
  });

  // --- A11y / i18n -------------------------------------------------------------

  it("beschriftet Panel und Beschreibung verknüpft (a11y)", async () => {
    const screen = await renderEvent();
    await announceUpdate();
    await expect
      .element(screen.getByTestId("nora-pwa-update-event"))
      .toBeVisible();

    const node = panel()!;
    const labelledBy = node.getAttribute("aria-labelledby")!;
    const describedBy = node.getAttribute("aria-describedby")!;
    expect(document.getElementById(labelledBy)?.tagName).toBe("H2");
    expect(document.getElementById(describedBy)?.textContent).toBe(
      "Offene Eingaben vor dem Aktualisieren kurz speichern.",
    );
    expect(node.querySelectorAll("h2").length).toBe(1);
    expect(node.classList.contains("nora-system-event")).toBe(true);
    // Kein Fokusdiebstahl: das Panel ist nicht modal.
    expect(node.contains(document.activeElement)).toBe(false);

    await screen.unmount();
  });

  it("übersetzt die Copy (i18n, kein Literal in der Komponente)", async () => {
    useSequenceTimers();
    const screen = await renderEvent("en");
    await announceUpdate();

    expect(title()).toBe("New Nora version available");
    expect(hint()).toBe("Save any open entries before updating.");

    await click("nora-pwa-update-apply");
    await advance(CHOREOGRAPHY_TIMELINE.sustaining);
    expect(title()).toBe("Updating Nora");

    await screen.unmount();
  });
});
