import { StrictMode, act } from "react";
import { render } from "vitest-browser-react";
import { I18nContextProvider, type TranslationMessages } from "ra-core";
import polyglotI18nProvider from "ra-i18n-polyglot";

import { germanCrmMessages } from "../providers/commons/germanCrmMessages";
import { englishCrmMessages } from "../providers/commons/englishCrmMessages";
import { NoraUpdateEvent } from "./NoraUpdateEvent";
import { pwaUpdateStore, type RegisterSwLike } from "./pwaUpdateStore";
import {
  CHOREOGRAPHY_COMMIT_MS,
  CHOREOGRAPHY_RECOVERY_GRACE_MS,
  CHOREOGRAPHY_TIMELINE,
} from "./useUpdateChoreography";

/**
 * Die Praesentation wird gegen den echten Store getestet, nicht gegen einen
 * gemockten Hook: so ist mitgeprueft, dass die UI wirklich nur ueber
 * `usePwaUpdate()` an den Lifecycle kommt.
 *
 * **Was diese Datei NICHT behauptet.** Kein Test hier sagt aus, dass das
 * Ergebnis hochwertig aussieht — das ist eine Product-Owner-Entscheidung. Die
 * Tests decken Verhalten ab: welche Inhalte existieren, wann `applyUpdate()`
 * faellt und wann ausdruecklich nicht. Geometrie, Layer (`z-index: 70`),
 * Touch-Ziele, das Ausblenden bei offenem Dialog und Reduced Motion haengen an
 * `index.css`; im Browser-Test-Bundle sind die Tailwind-Utilities nicht
 * kompiliert, eine Zusicherung darauf waere aus dem falschen Grund gruen. Diese
 * Punkte werden in der echten gestylten App nachgemessen (siehe
 * `07-agent-change-checklist.md` und den PWA-1C.1-Abschlussbericht).
 */
let needRefresh: (() => void) | undefined;
let applyCalls = 0;
/** Steuert, ob die Aktivierung gelingt — fuer den Recovery-Pfad. */
let rejectApply = false;

const fakeRegisterSW: RegisterSwLike = (opts) => {
  needRefresh = opts.onNeedRefresh;
  opts.onRegisteredSW?.("/sw.js", undefined);
  return () => {
    applyCalls += 1;
    if (rejectApply) return Promise.reject(new Error("activation failed"));
    // Im echten Betrieb laedt der Client die Seite neu; hier bleibt der Store
    // in "applying", damit genau dieser Zustand pruefbar ist.
    return new Promise<void>(() => {});
  };
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

/**
 * Nur `setTimeout`/`clearTimeout` faelschen. Wuerde man alles faelschen,
 * geriete Reacts eigenes Scheduling mit in die Kontrolle des Tests und
 * `act()` koennte nicht mehr sauber flushen.
 */
const useSequenceTimers = () =>
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

/**
 * `act()` mit gesetztem Umgebungsflag.
 *
 * `vitest-browser-react` setzt `IS_REACT_ACT_ENVIRONMENT` um jeden eigenen
 * `act()`-Aufruf herum und danach wieder auf `false` zurueck — ein einmaliges
 * Setzen in `beforeAll` ueberlebt das erste `render()` also nicht. Deshalb
 * wird das Flag hier pro Aufruf gesetzt und wieder auf den vorherigen Wert
 * zurueckgestellt, sonst warnt React bei jedem Vorspulen.
 */
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

/** Zeit vorspulen und alle daraus folgenden React-Updates flushen. */
const advance = (ms: number) => flush(() => vi.advanceTimersByTime(ms));

/**
 * Der Store meldet ein wartendes Update. Bewusst durch `act()` gefuehrt: das
 * ist ein externer Store-Push, der React-State erzeugt — ohne `act()` liefe
 * die Assertion gegen einen noch nicht geflushten Baum.
 */
const announceUpdate = () => flush(() => needRefresh!());

const click = async (id: string) => {
  const node = testId(id);
  expect(node, `${id} sollte im DOM sein`).not.toBeNull();
  await flush(() => node!.click());
};

describe("NoraUpdateEvent", () => {
  beforeEach(() => {
    // Der Store ist prozessweit und `applying` ist im echten Betrieb ein
    // Endzustand (die Seite laedt neu). Ohne Reset wuerde ein Test, der
    // aktualisiert hat, alle folgenden vergiften.
    pwaUpdateStore.reset();
    applyCalls = 0;
    rejectApply = false;
    pwaUpdateStore.start(fakeRegisterSW);
  });

  afterEach(() => {
    vi.useRealTimers();
    pwaUpdateStore.reset();
  });

  it("zeigt nichts, solange kein Update wartet", async () => {
    const screen = await renderEvent();
    await expect
      .element(screen.getByTestId("nora-pwa-update-event"))
      .not.toBeInTheDocument();
    await screen.unmount();
  });

  it("zeigt Titel, Sicherheitshinweis und beide Aktionen bei updateAvailable", async () => {
    const screen = await renderEvent();
    await announceUpdate();

    await expect
      .element(screen.getByTestId("nora-pwa-update-event"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Neue Nora-Version verfügbar"))
      .toBeVisible();
    // Die Handlungsanweisung …
    await expect
      .element(screen.getByText(/Bitte speichern Sie offene Eingaben/))
      .toBeVisible();
    // … und die Begruendung darunter.
    await expect
      .element(screen.getByText(/Ungespeicherte Änderungen/))
      .toBeVisible();
    // Und die Zusicherung, dass die laufende Version weiterläuft.
    await expect
      .element(screen.getByText(/läuft weiter, bis Sie aktualisieren/))
      .toBeVisible();
    await expect
      .element(screen.getByTestId("nora-pwa-update-apply"))
      .toBeVisible();
    await expect
      .element(screen.getByTestId("nora-pwa-update-later"))
      .toBeVisible();

    // Systemereignis, nicht Statusmeldung: eigener Layer, keine 7B-Karte,
    // und kein zweites Feedback-System daneben.
    await expect
      .element(screen.getByTestId("nora-pwa-update-event"))
      .toHaveAttribute("role", "status");
    expect(
      document.querySelectorAll('[data-testid="nora-notification-card"]')
        .length,
    ).toBe(0);
    expect(document.querySelectorAll("[data-sonner-toast]").length).toBe(0);

    await screen.unmount();
  });

  it("zeigt die Warnsymbol-Geometrie des Product Owners, dekorativ ausgezeichnet", async () => {
    const screen = await renderEvent();
    await announceUpdate();
    await expect
      .element(screen.getByTestId("nora-pwa-update-safety"))
      .toBeInTheDocument();

    const mark = document.querySelector<SVGSVGElement>(".nora-safety-mark");
    expect(mark).not.toBeNull();
    // Die Original-viewBox, nicht neu gezeichnet.
    expect(mark!.getAttribute("viewBox")).toBe("0 0 24 24");
    // Alle vier Teile der Original-Geometrie, einzeln ansprechbar fuer die
    // gestaffelte Einblendung.
    expect(
      [...mark!.querySelectorAll("[data-mark-part]")].map((node) =>
        node.getAttribute("data-mark-part"),
      ),
    ).toEqual(["frame", "bar", "ring", "dot"]);
    // Der Text daneben sagt bereits alles — keine zweite Screenreader-Ansage.
    expect(mark!.getAttribute("aria-hidden")).toBe("true");

    await screen.unmount();
  });

  it("startet beim Klick die Choreografie, ohne sofort zu aktualisieren", async () => {
    useSequenceTimers();
    const screen = await renderEvent();
    await announceUpdate();

    await click("nora-pwa-update-apply");

    // Der Kern der Welle: der Klick loest die Sequenz aus, nicht den Reload.
    expect(applyCalls).toBe(0);
    expect(panel()?.dataset.presentation).toBe("choreography");
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

    // Phase 1 und 2 tragen noch den alten Titel bei voller bzw. abfallender
    // Deckkraft. Wuerde er hier schon umspringen, waere die ganze
    // Auflösung-per-Blur wirkungslos.
    const title = () => panel()!.querySelector("h2")!.textContent;
    expect(title()).toBe("Neue Nora-Version verfügbar");
    expect(testId("nora-pwa-update-dots")).toBeNull();

    await advance(CHOREOGRAPHY_TIMELINE.converging);
    expect(title()).toBe("Neue Nora-Version verfügbar");

    // Erst mit Phase 3 — der Titel steht dann auf Deckkraft 0 und setzt sich
    // mit dem neuen Text wieder.
    await advance(
      CHOREOGRAPHY_TIMELINE.sustaining - CHOREOGRAPHY_TIMELINE.converging,
    );
    expect(title()).toBe("Nora wird aktualisiert");
    expect(testId("nora-pwa-update-dots")).not.toBeNull();

    await screen.unmount();
  });

  it("durchläuft alle vier Phasen und aktualisiert erst nach der vollen Dauer", async () => {
    useSequenceTimers();
    const screen = await renderEvent();
    await announceUpdate();
    await click("nora-pwa-update-apply");

    await advance(CHOREOGRAPHY_TIMELINE.converging);
    expect(panel()?.dataset.phase).toBe("converging");
    expect(applyCalls).toBe(0);

    await advance(
      CHOREOGRAPHY_TIMELINE.sustaining - CHOREOGRAPHY_TIMELINE.converging,
    );
    expect(panel()?.dataset.phase).toBe("sustaining");
    // Die ruhige Update-Szene: Titel, drei Punkte, keine Aktionen mehr.
    expect(panel()?.textContent).toContain("Nora wird aktualisiert");
    expect(testId("nora-pwa-update-dots")?.children.length).toBe(3);
    expect(testId("nora-pwa-update-apply")).toBeNull();
    expect(testId("nora-pwa-update-later")).toBeNull();
    expect(testId("nora-pwa-update-safety")).toBeNull();
    expect(applyCalls).toBe(0);

    await advance(
      CHOREOGRAPHY_TIMELINE.committing - CHOREOGRAPHY_TIMELINE.sustaining,
    );
    expect(panel()?.dataset.phase).toBe("committing");
    expect(applyCalls).toBe(0);

    // Eine Millisekunde vor Schluss ist immer noch nichts passiert.
    await advance(
      CHOREOGRAPHY_COMMIT_MS - CHOREOGRAPHY_TIMELINE.committing - 1,
    );
    expect(applyCalls).toBe(0);

    await advance(1);
    expect(applyCalls).toBe(1);

    // Die Szene laeuft weiter, bis der Browser tatsaechlich neu laedt —
    // kein leeres Fenster nach Sekunde acht.
    expect(panel()).not.toBeNull();
    expect(panel()?.textContent).toContain("Nora wird aktualisiert");
    expect(testId("nora-pwa-update-dots")).not.toBeNull();

    await screen.unmount();
  });

  it("ruft applyUpdate genau einmal, auch bei Doppelklick", async () => {
    useSequenceTimers();
    const screen = await renderEvent();
    await announceUpdate();

    // Beide Klicks fallen in Phase 1, in der die Aktionen noch montiert sind
    // und sich sichtbar wegfalten — genau das Fenster, in dem ein zweiter
    // Klick technisch moeglich waere.
    await click("nora-pwa-update-apply");
    await click("nora-pwa-update-apply");

    await advance(CHOREOGRAPHY_COMMIT_MS * 2);
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

    // Alle Timer sind abgeraeumt: der wartende Worker bleibt unangetastet.
    await advance(CHOREOGRAPHY_COMMIT_MS * 2);
    expect(applyCalls).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aktualisiert auch unter StrictMode genau einmal", async () => {
    useSequenceTimers();
    const screen = await renderStrict();
    await announceUpdate();

    await click("nora-pwa-update-apply");
    await advance(CHOREOGRAPHY_COMMIT_MS);

    // StrictMode montiert den Effekt doppelt und setzt die Timer dabei neu.
    // Das Lauf-Token verhindert trotzdem einen zweiten Commit.
    expect(applyCalls).toBe(1);

    await screen.unmount();
  });

  it("bietet nach einem fehlgeschlagenen Update einen ruhigen Recovery-Zustand", async () => {
    rejectApply = true;
    useSequenceTimers();
    const screen = await renderEvent();
    await announceUpdate();
    await click("nora-pwa-update-apply");

    await advance(CHOREOGRAPHY_COMMIT_MS);
    expect(applyCalls).toBe(1);

    // Der Store faellt aus `applying` zurueck; nach der Schonfrist zeigt Nora
    // keinen ewigen „wird aktualisiert"-Zustand, sondern einen Ausweg.
    await advance(CHOREOGRAPHY_RECOVERY_GRACE_MS);
    expect(panel()?.dataset.presentation).toBe("recovery");
    expect(panel()?.textContent).toContain(
      "Aktualisierung konnte noch nicht gestartet werden",
    );
    expect(panel()?.textContent).toContain("Nora kann weiterhin verwendet");
    expect(testId("nora-pwa-update-retry")).not.toBeNull();

    // „Erneut versuchen" startet eine neue vollstaendige Sequenz.
    rejectApply = false;
    await click("nora-pwa-update-retry");
    expect(panel()?.dataset.presentation).toBe("choreography");
    expect(applyCalls).toBe(1);

    await advance(CHOREOGRAPHY_COMMIT_MS);
    expect(applyCalls).toBe(2);

    await screen.unmount();
  });

  it("blendet bei 'Später' aus, ohne das Update zu verwerfen", async () => {
    const screen = await renderEvent();
    await announceUpdate();

    await screen.getByTestId("nora-pwa-update-later").click();
    await expect
      .element(screen.getByTestId("nora-pwa-update-event"))
      .not.toBeInTheDocument();
    // Der wartende Worker ist nicht angefasst worden.
    expect(applyCalls).toBe(0);

    // Ein neu gefundenes Update zeigt den Hinweis sofort wieder.
    await announceUpdate();
    await expect
      .element(screen.getByTestId("nora-pwa-update-event"))
      .toBeInTheDocument();

    await screen.unmount();
  });

  it("beschriftet Panel und Beschreibung verknüpft (a11y)", async () => {
    const screen = await renderEvent();
    await announceUpdate();
    // Erst auf das gerenderte Panel warten, dann direkt im DOM messen.
    await expect
      .element(screen.getByTestId("nora-pwa-update-event"))
      .toBeVisible();

    const node = panel()!;
    const labelledBy = node.getAttribute("aria-labelledby")!;
    const describedBy = node.getAttribute("aria-describedby")!;
    expect(document.getElementById(labelledBy)?.tagName).toBe("H2");
    expect(document.getElementById(describedBy)).toBeTruthy();
    // Genau ein Titel im Accessibility-Baum, kein zweiter fuer den Crossfade.
    expect(node.querySelectorAll("h2").length).toBe(1);
    // Kein Fokusdiebstahl: das Panel ist nicht modal.
    expect(node.contains(document.activeElement)).toBe(false);

    await screen.unmount();
  });

  it("traegt die Systemklasse des eigenen Layers", async () => {
    const screen = await renderEvent();
    await announceUpdate();
    await expect
      .element(screen.getByTestId("nora-pwa-update-event"))
      .toBeVisible();

    expect(panel()!.classList.contains("nora-system-event")).toBe(true);

    await screen.unmount();
  });

  it("übersetzt die Copy (i18n, kein Literal in der Komponente)", async () => {
    useSequenceTimers();
    const screen = await renderEvent("en");
    await announceUpdate();

    expect(panel()?.textContent).toContain("New Nora version available");
    expect(panel()?.textContent).toContain(
      "Please save any open entries before you update",
    );

    // Auch die Choreografie-Copy haengt am Katalog.
    await click("nora-pwa-update-apply");
    await advance(CHOREOGRAPHY_TIMELINE.sustaining);
    expect(panel()?.textContent).toContain("Updating Nora");

    await screen.unmount();
  });
});
