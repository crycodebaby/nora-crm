import { StrictMode, act } from "react";
import { render } from "vitest-browser-react";

import { pwaUpdateStore, type RegisterSwLike } from "./pwaUpdateStore";
import { usePwaUpdate } from "./usePwaUpdate";
import {
  ACTIVATION_WATCHDOG_MS,
  CHOREOGRAPHY_COMMIT_MS,
  RELOAD_FALLBACK_MS,
  useUpdateChoreography,
} from "./useUpdateChoreography";

/**
 * Die Praesentations-Zustandsmaschine — gegen den ECHTEN Store.
 *
 * **Warum kein lokaler Fake-Harness mehr.** Ein Harness, in dem `activated`,
 * `reloadRequired` und `applyUpdate` nichts miteinander zu tun haben, kann
 * genau die Kopplungen nicht sehen, um die es hier geht (PWA-1C.3-Race,
 * V2-Reload-Befund). Hier kommen alle Fakten aus `usePwaUpdate()`, also aus
 * `pwaUpdateStore` selbst; die Browser-Fakten (Controller, wartender/aktiver
 * Worker) sind eine Attrappe mit derselben Aussagekraft wie im Browser.
 *
 * Nur der Reload bleibt injizierbar, weil `window.location.reload` in einem
 * echten Browser nicht ersetzbar ist — dieselbe Naht, die die Komponente
 * benutzt. Deshalb wird der Reload HIER geprueft und nicht in
 * `NoraUpdateEvent.test.tsx`.
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

let applyCalls = 0;
let needRefresh: (() => void) | undefined;
let rejectApply = false;

const registerSw: RegisterSwLike = (opts) => {
  needRefresh = opts.onNeedRefresh;
  opts.onRegisteredSW?.(
    "/sw.js",
    fakeRegistration as unknown as ServiceWorkerRegistration,
  );
  return () => {
    applyCalls += 1;
    return rejectApply
      ? Promise.reject(new Error("activation refused"))
      : Promise.resolve();
  };
};

/** Der Browser aktiviert den wartenden Worker — mit oder ohne Benachrichtigung. */
const activateNewWorker = ({ notify }: { notify: boolean }) => {
  facts.waiting = null;
  facts.active = newWorker;
  if (notify) facts.controller = newWorker;
  newWorker.dispatchEvent(new Event("statechange"));
  if (notify)
    navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
};

let controls: { start: () => void; retry: () => void } | null = null;

const Harness = ({ reload }: { reload: () => void }) => {
  const {
    applying,
    activated,
    reloadRequired,
    failed,
    applyUpdate,
    syncFacts,
    assessActivation,
  } = usePwaUpdate();
  const { phase, presentation, stall, start, retry } = useUpdateChoreography({
    applyUpdate,
    syncFacts,
    assessActivation,
    applying,
    activated,
    reloadRequired,
    failed,
    reload,
  });
  controls = { start, retry };
  return (
    <div
      data-testid="probe"
      data-phase={phase}
      data-presentation={presentation}
      data-stall={stall}
      data-applying={String(applying)}
      data-activated={String(activated)}
    />
  );
};

const probe = () =>
  document.querySelector<HTMLElement>('[data-testid="probe"]');

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

describe("useUpdateChoreography", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    pwaUpdateStore.reset();
    oldWorker = makeWorker();
    newWorker = makeWorker();
    facts.waiting = newWorker;
    facts.installing = null;
    facts.active = oldWorker;
    facts.controller = oldWorker;
    applyCalls = 0;
    rejectApply = false;
    controls = null;
    pwaUpdateStore.start(registerSw, { getController: () => facts.controller });
  });

  afterEach(() => {
    vi.useRealTimers();
    pwaUpdateStore.reset();
  });

  const announce = () => flush(() => needRefresh!());
  const start = () => flush(() => controls!.start());
  /** Commit und Watchdog in zwei Schritten: der Watchdog-Timer entsteht erst im Effekt nach dem Commit. */
  const commit = () => advance(CHOREOGRAPHY_COMMIT_MS);
  const watchdog = () => advance(ACTIVATION_WATCHDOG_MS);

  it("Happy Path: eine Anfrage, eine Uebernahme, genau ein Reload", async () => {
    const reload = vi.fn();
    const screen = await render(<Harness reload={reload} />);
    await announce();
    expect(probe()?.dataset.presentation).toBe("available");

    await start();
    expect(probe()?.dataset.presentation).toBe("applying");
    expect(probe()?.dataset.phase).toBe("settling");

    await advance(CHOREOGRAPHY_COMMIT_MS - 1);
    expect(applyCalls).toBe(0);
    await advance(1);
    expect(applyCalls).toBe(1);
    expect(reload).not.toHaveBeenCalled();

    await flush(() => activateNewWorker({ notify: true }));
    expect(probe()?.dataset.activated).toBe("true");
    expect(probe()?.dataset.presentation).toBe("applying");

    await advance(RELOAD_FALLBACK_MS - 1);
    expect(reload).not.toHaveBeenCalled();
    await advance(1);
    expect(reload).toHaveBeenCalledTimes(1);

    // Weit ueber jede Frist hinaus: kein zweiter Reload, keine zweite Anfrage,
    // kein „Gleich bereit".
    await advance(ACTIVATION_WATCHDOG_MS * 3);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(applyCalls).toBe(1);
    expect(probe()?.dataset.presentation).toBe("applying");
    expect(probe()?.dataset.stall).toBe("none");

    await screen.unmount();
  });

  it("wird bei ausbleibender Uebernahme langsam — nicht fehlgeschlagen — und versucht es genau einmal still erneut", async () => {
    const reload = vi.fn();
    const screen = await render(<Harness reload={reload} />);
    await announce();
    await start();
    await commit();
    expect(applyCalls).toBe(1);

    await advance(ACTIVATION_WATCHDOG_MS - 1);
    expect(probe()?.dataset.presentation).toBe("applying");
    await advance(1);

    expect(probe()?.dataset.presentation).toBe("slow");
    expect(probe()?.dataset.stall).toBe("slow");
    // Der stille zweite Versuch ist eine echte zweite Anfrage.
    expect(applyCalls).toBe(2);
    expect(reload).not.toHaveBeenCalled();

    // Zweite Frist: weiterhin langsam, jetzt mit Reload-Angebot — und kein
    // dritter Automatismus.
    await watchdog();
    expect(probe()?.dataset.presentation).toBe("slow");
    expect(probe()?.dataset.stall).toBe("prolonged");
    expect(applyCalls).toBe(2);

    await advance(ACTIVATION_WATCHDOG_MS * 3);
    expect(applyCalls).toBe(2);
    expect(reload).not.toHaveBeenCalled();
    expect(probe()?.dataset.presentation).toBe("slow");

    await screen.unmount();
  });

  it("nimmt „Gleich bereit“ zurueck, sobald die Uebernahme doch eintrifft", async () => {
    const reload = vi.fn();
    const screen = await render(<Harness reload={reload} />);
    await announce();
    await start();
    await commit();
    await watchdog();
    expect(probe()?.dataset.presentation).toBe("slow");

    await flush(() => activateNewWorker({ notify: true }));
    expect(probe()?.dataset.presentation).toBe("applying");
    expect(probe()?.dataset.stall).toBe("slow");

    await advance(RELOAD_FALLBACK_MS);
    expect(reload).toHaveBeenCalledTimes(1);
    // Die zweite Frist erzeugt danach nichts mehr.
    await advance(ACTIVATION_WATCHDOG_MS * 2);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(applyCalls).toBe(2);

    await screen.unmount();
  });

  it("erzeugt kein „Gleich bereit“, wenn die Uebernahme kurz vor der Frist eintrifft", async () => {
    const reload = vi.fn();
    const screen = await render(<Harness reload={reload} />);
    await announce();
    await start();
    await commit();
    await advance(ACTIVATION_WATCHDOG_MS - 100);
    await flush(() => activateNewWorker({ notify: true }));

    await advance(200);
    expect(probe()?.dataset.presentation).toBe("applying");
    expect(probe()?.dataset.stall).toBe("none");
    expect(applyCalls).toBe(1);

    await advance(RELOAD_FALLBACK_MS);
    expect(reload).toHaveBeenCalledTimes(1);

    await screen.unmount();
  });

  // --- Das unkontrollierte Dokument (V2) ---------------------------------------

  it("laedt nach dem Commit selbst neu, wenn die Fakten reloadRequired zeigen (unkontrolliert, kein controllerchange)", async () => {
    facts.controller = null;
    const reload = vi.fn();
    const screen = await render(<Harness reload={reload} />);
    await announce();
    await start();
    await commit();
    expect(applyCalls).toBe(1);

    // Der Worker aktiviert durch unsere Anfrage — dieses Dokument hoert nichts.
    await flush(() => activateNewWorker({ notify: false }));
    expect(probe()?.dataset.activated).toBe("false");
    expect(probe()?.dataset.presentation).toBe("applying");

    await advance(RELOAD_FALLBACK_MS);
    expect(reload).toHaveBeenCalledTimes(1);
    // Kein „Gleich bereit", keine zweite Anfrage.
    await advance(ACTIVATION_WATCHDOG_MS * 2);
    expect(applyCalls).toBe(1);
    expect(probe()?.dataset.stall).toBe("none");

    await screen.unmount();
  });

  it("findet den Reload-Befund spaetestens beim Watchdog, wenn kein statechange kam", async () => {
    facts.controller = null;
    const reload = vi.fn();
    const screen = await render(<Harness reload={reload} />);
    await announce();
    await start();
    await commit();

    // Fakten aendern sich still (ohne Ereignis): der Watchdog liest sie.
    facts.waiting = null;
    facts.active = newWorker;
    await watchdog();
    expect(probe()?.dataset.presentation).toBe("applying");
    expect(probe()?.dataset.stall).toBe("none");
    await advance(RELOAD_FALLBACK_MS);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(applyCalls).toBe(1);

    await screen.unmount();
  });

  it("startet keine Choreografie, wenn die neue Version beim Klick bereits aktiv ist", async () => {
    facts.controller = null;
    const reload = vi.fn();
    const screen = await render(<Harness reload={reload} />);
    await announce();
    // Der Worker hat sich 2 ms nach der Entdeckung selbst aktiviert.
    await flush(() => activateNewWorker({ notify: false }));
    expect(probe()?.dataset.presentation).toBe("reloadRequired");

    await start();
    expect(probe()?.dataset.phase).toBe("idle");
    expect(probe()?.dataset.presentation).toBe("reloadRequired");
    await advance(CHOREOGRAPHY_COMMIT_MS + ACTIVATION_WATCHDOG_MS);
    expect(applyCalls).toBe(0);
    // Ohne Commit kein automatischer Reload — der Benutzer klickt.
    expect(reload).not.toHaveBeenCalled();

    await screen.unmount();
  });

  it("liest beim Klick die Fakten, auch wenn sich seit der Anzeige nichts gemeldet hat", async () => {
    facts.controller = null;
    const reload = vi.fn();
    const screen = await render(<Harness reload={reload} />);
    await announce();
    expect(probe()?.dataset.presentation).toBe("available");

    // Stiller Faktenwechsel ohne Ereignis.
    facts.waiting = null;
    facts.active = newWorker;
    await start();

    expect(probe()?.dataset.presentation).toBe("reloadRequired");
    expect(probe()?.dataset.phase).toBe("idle");
    expect(applyCalls).toBe(0);

    await screen.unmount();
  });

  // --- Fremde Aktivierung (anderer Tab) ----------------------------------------

  it("korrigiert sich selbst, wenn ein anderer Tab aktiviert hat — keine Schein-Choreografie", async () => {
    const reload = vi.fn();
    const screen = await render(<Harness reload={reload} />);
    await announce();
    expect(probe()?.dataset.presentation).toBe("available");

    await flush(() => activateNewWorker({ notify: true }));
    expect(probe()?.dataset.presentation).toBe("reloadRequired");

    await start();
    expect(probe()?.dataset.phase).toBe("idle");
    await advance(CHOREOGRAPHY_COMMIT_MS);
    expect(applyCalls).toBe(0);
    expect(reload).not.toHaveBeenCalled();

    await screen.unmount();
  });

  it("verwirft eine Uebernahme nicht, die waehrend der Choreografie eintrifft", async () => {
    const reload = vi.fn();
    const screen = await render(<Harness reload={reload} />);
    await announce();
    await start();
    await advance(2000);

    await flush(() => activateNewWorker({ notify: true }));
    expect(probe()?.dataset.activated).toBe("true");
    // Die Choreografie laeuft sauber zu Ende — kein abrupter Abbruch, kein
    // Umspringen auf „Neu laden" mitten in der Sequenz.
    expect(probe()?.dataset.presentation).toBe("applying");

    await advance(CHOREOGRAPHY_COMMIT_MS - 2000 - 1);
    expect(reload).not.toHaveBeenCalled();
    await advance(1);
    // Der Commit fordert nichts mehr an.
    expect(applyCalls).toBe(0);
    await advance(RELOAD_FALLBACK_MS);
    expect(reload).toHaveBeenCalledTimes(1);

    await advance(ACTIVATION_WATCHDOG_MS * 3);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(probe()?.dataset.stall).toBe("none");

    await screen.unmount();
  });

  // --- Echter Fehler -----------------------------------------------------------

  it("zeigt failed nur bei abgelehnter Anfrage — ohne Reload und ohne Warten", async () => {
    rejectApply = true;
    const reload = vi.fn();
    const screen = await render(<Harness reload={reload} />);
    await announce();
    await start();
    await commit();
    await flush(() => {});

    expect(probe()?.dataset.presentation).toBe("failed");
    await advance(ACTIVATION_WATCHDOG_MS * 3);
    expect(probe()?.dataset.presentation).toBe("failed");
    expect(probe()?.dataset.stall).toBe("none");
    expect(reload).not.toHaveBeenCalled();
    expect(applyCalls).toBe(1);

    await screen.unmount();
  });

  // --- Manueller zweiter Anlauf ------------------------------------------------

  it("sendet bei retry genau eine weitere Anfrage ohne neue Choreografie", async () => {
    const reload = vi.fn();
    const screen = await render(<Harness reload={reload} />);
    await announce();
    await start();
    await commit();
    await watchdog();
    await watchdog();
    expect(probe()?.dataset.stall).toBe("prolonged");
    expect(applyCalls).toBe(2);

    await flush(() => controls!.retry());
    expect(applyCalls).toBe(3);
    expect(probe()?.dataset.phase).toBe("committing");
    expect(probe()?.dataset.stall).toBe("slow");

    await flush(() => activateNewWorker({ notify: true }));
    await advance(RELOAD_FALLBACK_MS);
    expect(reload).toHaveBeenCalledTimes(1);

    await screen.unmount();
  });

  it("sendet bei retry nichts, wenn kein Worker mehr wartet", async () => {
    const reload = vi.fn();
    const screen = await render(<Harness reload={reload} />);
    await announce();
    await start();
    await commit();
    await watchdog();
    expect(applyCalls).toBe(2);

    facts.waiting = null;
    facts.active = newWorker;
    await flush(() => controls!.retry());
    expect(applyCalls).toBe(2);
    // Der Retry hat die Fakten gelesen: Reload-Befund nach Commit → Reload.
    await advance(RELOAD_FALLBACK_MS);
    expect(reload).toHaveBeenCalledTimes(1);

    await screen.unmount();
  });

  // --- Robustheit --------------------------------------------------------------

  it("commitet auch unter StrictMode genau einmal", async () => {
    const reload = vi.fn();
    const screen = await render(
      <StrictMode>
        <Harness reload={reload} />
      </StrictMode>,
    );
    await announce();
    await start();
    await commit();
    expect(applyCalls).toBe(1);
    await watchdog();
    // Auch der stille zweite Versuch nur einmal.
    expect(applyCalls).toBe(2);

    await screen.unmount();
  });

  it("raeumt alle Timer beim Unmount ab", async () => {
    const reload = vi.fn();
    const screen = await render(<Harness reload={reload} />);
    await announce();
    await start();
    await commit();
    await flush(() => activateNewWorker({ notify: true }));

    await screen.unmount();
    await flush(() => vi.advanceTimersByTime(RELOAD_FALLBACK_MS * 4));

    expect(reload).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
