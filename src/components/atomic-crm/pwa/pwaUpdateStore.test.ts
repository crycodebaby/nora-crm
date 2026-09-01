import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  createPwaUpdateStore,
  DISMISS_RESHOW_AFTER_MS,
  UPDATE_CHECK_MIN_INTERVAL_MS,
  type RegisterSwLike,
} from "./pwaUpdateStore";

/**
 * Browser-Fakten als Attrappe — mit derselben Aussagekraft wie im Browser.
 *
 * `waiting`, `installing` und `active` sind Getter auf einem veraenderbaren
 * Faktenobjekt, die Worker sind echte `EventTarget`s: ein Test kann damit
 * genau den Uebergang absetzen, den der Store beobachtet (`statechange`),
 * statt einen unmoeglichen Zustand einfach zu behaupten.
 */
const makeWorker = () => new EventTarget() as unknown as ServiceWorker;

interface Facts {
  waiting: ServiceWorker | null;
  installing: ServiceWorker | null;
  active: ServiceWorker | null;
  controller: ServiceWorker | null;
}

const createFakeRegistration = (facts: Facts) => {
  const registration = new EventTarget();
  Object.defineProperties(registration, {
    waiting: { get: () => facts.waiting },
    installing: { get: () => facts.installing },
    active: { get: () => facts.active },
    update: { value: vi.fn(() => Promise.resolve()) },
  });
  return registration as unknown as ServiceWorkerRegistration & {
    update: ReturnType<typeof vi.fn>;
  };
};

/**
 * Ersatz fuer `virtual:pwa-register`: gibt die Callbacks nach aussen, damit
 * ein Test „Update entdeckt" ausloesen kann, und zaehlt die
 * Aktivierungsanfragen — jeder Aufruf ist genau ein SKIP_WAITING.
 */
const createFakeRegisterSW = (
  options: {
    registration?: ServiceWorkerRegistration;
    updateServiceWorker?: () => Promise<void>;
  } = {},
) => {
  const handle = {
    needRefresh: undefined as (() => void) | undefined,
    registerError: undefined as ((error: unknown) => void) | undefined,
    updateCalls: 0,
  };

  const registerSw: RegisterSwLike = (opts) => {
    handle.needRefresh = opts.onNeedRefresh;
    handle.registerError = opts.onRegisterError;
    opts.onRegisteredSW?.("/sw.js", options.registration);
    return () => {
      handle.updateCalls += 1;
      return options.updateServiceWorker?.() ?? Promise.resolve();
    };
  };

  return { registerSw, handle };
};

// Ein fester Zeitgeber macht die Ablauf-Regel von "Spaeter" pruefbar.
let clock = 1_000_000;
const now = () => clock;

const listenerTarget = () => {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    target: {
      addEventListener: (type: string, listener: EventListener) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(listener);
      },
      removeEventListener: (type: string, listener: EventListener) => {
        listeners.get(type)?.delete(listener);
      },
    },
    dispatch: (type: string) => {
      for (const l of listeners.get(type) ?? []) l(new Event(type));
    },
    count: (type: string) => listeners.get(type)?.size ?? 0,
  };
};

/**
 * Der Standard-Harness: ein KONTROLLIERTES Dokument (Controller = aktiver
 * Worker), ein neu installierter Worker wartet. Das ist der
 * production-bewiesene Happy Path. Jeder Test verbiegt davon nur die Fakten,
 * die er braucht.
 */
const harness = (
  overrides: Partial<Facts> & {
    updateServiceWorker?: () => Promise<void>;
  } = {},
) => {
  const oldWorker = makeWorker();
  const newWorker = makeWorker();
  const facts: Facts = {
    waiting: newWorker,
    installing: null,
    active: oldWorker,
    controller: oldWorker,
    ...overrides,
  };
  const swTarget = listenerTarget();
  const target = listenerTarget();
  const registration = createFakeRegistration(facts);
  const { registerSw, handle } = createFakeRegisterSW({
    registration,
    updateServiceWorker: overrides.updateServiceWorker,
  });
  const store = createPwaUpdateStore({
    now,
    target: target.target,
    serviceWorkerTarget: swTarget.target,
    isOnline: () => true,
    getController: () => facts.controller,
  });
  store.start(registerSw);

  /** Der Browser aktiviert den wartenden Worker (ohne/mit controllerchange). */
  const activateNewWorker = ({ notify }: { notify: boolean }) => {
    facts.waiting = null;
    facts.active = newWorker;
    if (notify) facts.controller = newWorker;
    newWorker.dispatchEvent(new Event("statechange"));
    if (notify) swTarget.dispatch("controllerchange");
  };

  return {
    store,
    handle,
    facts,
    swTarget,
    target,
    registration,
    oldWorker,
    newWorker,
    activateNewWorker,
  };
};

describe("pwaUpdateStore", () => {
  beforeEach(() => {
    clock = 1_000_000;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("meldet idle, solange kein Update entdeckt ist", () => {
    const { store } = harness({ waiting: null });
    expect(store.getSnapshot()).toEqual({
      state: "idle",
      updateAvailable: false,
      applying: false,
      activated: false,
      reloadRequired: false,
      failed: false,
      waiting: false,
      controlled: true,
    });
    store.stop();
  });

  it("meldet updateAvailable, sobald ein Update entdeckt ist und ein Worker wartet", () => {
    const { store, handle } = harness();
    const listener = vi.fn();
    store.subscribe(listener);

    handle.needRefresh!();

    expect(store.getSnapshot().state).toBe("updateAvailable");
    expect(store.getSnapshot().waiting).toBe(true);
    expect(store.getSnapshot().reloadRequired).toBe(false);
    expect(listener).toHaveBeenCalled();
    store.stop();
  });

  it("registriert den Worker nur einmal, auch bei doppeltem start (StrictMode)", () => {
    const registerSpy = vi.fn(() => vi.fn(() => Promise.resolve()));
    const store = createPwaUpdateStore({ now });

    store.start(registerSpy as unknown as RegisterSwLike);
    store.start(registerSpy as unknown as RegisterSwLike);

    expect(registerSpy).toHaveBeenCalledTimes(1);
    store.stop();
  });

  it("sendet bei applyUpdate genau eine Anfrage, wenn ein Worker wartet", () => {
    const { store, handle } = harness();
    handle.needRefresh!();

    expect(store.applyUpdate()).toBe("requested");

    expect(handle.updateCalls).toBe(1);
    expect(store.getSnapshot().state).toBe("applying");
    expect(store.getSnapshot().applying).toBe(true);
    store.stop();
  });

  it("ignoriert einen zweiten applyUpdate-Aufruf (Doppelklick)", () => {
    const { store, handle } = harness();
    handle.needRefresh!();

    store.applyUpdate();
    expect(store.applyUpdate()).toBe("noop");
    store.applyUpdate();

    expect(handle.updateCalls).toBe(1);
    store.stop();
  });

  it("tut nichts, wenn applyUpdate ohne entdecktes Update aufgerufen wird", () => {
    const { store, handle } = harness({ waiting: null });

    expect(store.applyUpdate()).toBe("noop");

    expect(handle.updateCalls).toBe(0);
    expect(store.getSnapshot().state).toBe("idle");
    store.stop();
  });

  it("meldet failed nur bei positivem Fehlerbeweis — der abgelehnten Anfrage", async () => {
    const { store, handle } = harness({
      updateServiceWorker: () => Promise.reject(new Error("worker weg")),
    });
    handle.needRefresh!();

    store.applyUpdate();
    expect(store.getSnapshot().state).toBe("applying");

    await vi.waitFor(() => expect(store.getSnapshot().state).toBe("failed"));
    expect(store.getSnapshot().applying).toBe(false);
    expect(store.getSnapshot().failed).toBe(true);
    // Ein Fehler ist kein Reload-Befund.
    expect(store.getSnapshot().reloadRequired).toBe(false);
    expect(store.assessActivation()).toBe("failed");
    expect(store.applyUpdate()).toBe("noop");
    store.stop();
  });

  it("behaelt den wartenden Worker bei dismissForNow und zeigt ihn spaeter erneut", () => {
    const { store, handle } = harness();
    handle.needRefresh!();

    store.dismissForNow();
    expect(store.getSnapshot().state).toBe("idle");
    expect(handle.updateCalls).toBe(0);

    clock += DISMISS_RESHOW_AFTER_MS;
    vi.advanceTimersByTime(DISMISS_RESHOW_AFTER_MS);

    expect(store.getSnapshot().state).toBe("updateAvailable");
    store.stop();
  });

  it("hebt eine Ablehnung auf, wenn danach ein neues Update gefunden wird", () => {
    const { store, handle } = harness();
    handle.needRefresh!();
    store.dismissForNow();
    expect(store.getSnapshot().state).toBe("idle");

    handle.needRefresh!();

    expect(store.getSnapshot().state).toBe("updateAvailable");
    store.stop();
  });

  it("liefert einen referenziell stabilen Snapshot ohne Zustandswechsel", () => {
    const { store } = harness();
    expect(store.getSnapshot()).toBe(store.getSnapshot());
    store.syncFacts();
    expect(store.getSnapshot()).toBe(store.getSnapshot());
    store.stop();
  });

  it("veraendert bei wiederholtem onNeedRefresh nichts (installed + waiting)", () => {
    const { store, handle } = harness();
    handle.needRefresh!();
    const before = store.getSnapshot();
    const listener = vi.fn();
    store.subscribe(listener);

    // register.js ruft den Callback fuer externe Funde zweimal: bei
    // `installed` und noch einmal bei `waiting`.
    handle.needRefresh!();

    expect(store.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    store.stop();
  });

  it("prueft beim Zurueckkehren auf den Tab, aber nicht oefter als erlaubt", () => {
    const { store, target, registration } = harness();
    expect(document.visibilityState).toBe("visible");

    target.dispatch("visibilitychange");
    expect(registration.update).toHaveBeenCalledTimes(0);

    clock += UPDATE_CHECK_MIN_INTERVAL_MS;
    target.dispatch("visibilitychange");
    expect(registration.update).toHaveBeenCalledTimes(1);

    target.dispatch("visibilitychange");
    expect(registration.update).toHaveBeenCalledTimes(1);
    store.stop();
  });

  it("liest beim Zurueckkehren auf den Tab die Fakten neu", () => {
    const h = harness();
    h.handle.needRefresh!();
    expect(h.store.getSnapshot().state).toBe("updateAvailable");

    // Waehrend der Tab im Hintergrund war, hat ein anderer Tab aktiviert —
    // und dieses Dokument hat (etwa als unkontrolliertes) nichts gehoert.
    h.facts.waiting = null;
    h.facts.active = h.newWorker;
    h.facts.controller = null;
    h.target.dispatch("visibilitychange");

    expect(h.store.getSnapshot().reloadRequired).toBe(true);
    expect(h.store.getSnapshot().state).toBe("reloadRequired");
    h.store.stop();
  });

  it("prueft offline nicht auf Updates", () => {
    const facts: Facts = {
      waiting: null,
      installing: null,
      active: null,
      controller: null,
    };
    const target = listenerTarget();
    const registration = createFakeRegistration(facts);
    const { registerSw } = createFakeRegisterSW({ registration });
    const store = createPwaUpdateStore({
      now,
      target: target.target,
      isOnline: () => false,
      getController: () => null,
    });
    store.start(registerSw);

    clock += UPDATE_CHECK_MIN_INTERVAL_MS * 2;
    target.dispatch("visibilitychange");

    expect(registration.update).not.toHaveBeenCalled();
    store.stop();
  });

  it("baut Listener und Timer bei stop wieder ab", () => {
    const { store, target, swTarget } = harness();
    expect(target.count("visibilitychange")).toBe(1);
    expect(swTarget.count("controllerchange")).toBe(1);

    store.stop();

    expect(target.count("visibilitychange")).toBe(0);
    expect(swTarget.count("controllerchange")).toBe(0);
  });

  it("bleibt nach einem Registrierungsfehler nutzbar und still", () => {
    const { registerSw, handle } = createFakeRegisterSW();
    const store = createPwaUpdateStore({ now, getController: () => null });
    store.start(registerSw);

    handle.registerError!(new Error("kein Worker"));

    expect(store.getSnapshot().state).toBe("idle");
    store.stop();
  });

  // --- Anfrage vs. Uebernahme ------------------------------------------------

  it("meldet nach applyUpdate NICHT aktiviert, solange keine Uebernahme kam", async () => {
    const { store, handle } = harness();
    handle.needRefresh!();

    store.applyUpdate();
    await vi.waitFor(() => expect(handle.updateCalls).toBe(1));

    expect(store.getSnapshot().applying).toBe(true);
    expect(store.getSnapshot().activated).toBe(false);
    expect(store.getSnapshot().reloadRequired).toBe(false);
    store.stop();
  });

  it("meldet aktiviert und reloadRequired, sobald controllerchange eintrifft", () => {
    const h = harness();
    const listener = vi.fn();
    h.store.subscribe(listener);
    h.handle.needRefresh!();
    h.store.applyUpdate();

    expect(h.store.getSnapshot().activated).toBe(false);
    h.activateNewWorker({ notify: true });

    expect(h.store.getSnapshot().activated).toBe(true);
    // Uebernommen ist nicht fertig: fertig ist das neu geladene Dokument.
    expect(h.store.getSnapshot().reloadRequired).toBe(true);
    expect(h.store.assessActivation()).toBe("activated");
    expect(listener).toHaveBeenCalled();
    h.store.stop();
  });

  it("nimmt eine bestaetigte Uebernahme nie wieder zurueck und fordert nichts mehr an", () => {
    const h = harness();
    h.handle.needRefresh!();

    // Etwa aus einem anderen Tab, bevor der Benutzer hier entschieden hat.
    h.activateNewWorker({ notify: true });
    expect(h.store.getSnapshot().activated).toBe(true);

    expect(h.store.applyUpdate()).toBe("activated");
    expect(h.store.applyUpdate()).toBe("activated");

    expect(h.store.getSnapshot().activated).toBe(true);
    expect(h.store.getSnapshot().applying).toBe(false);
    expect(h.handle.updateCalls).toBe(0);
    h.store.stop();
  });

  // --- Das unkontrollierte Dokument (V2) ---------------------------------------
  //
  // Reproduziert in Chromium: kein Controller, ein neuer Worker wird entdeckt,
  // `onNeedRefresh` kommt beim `installed` — und 2 ms spaeter aktiviert der
  // Worker sich selbst, weil kein Client die Registrierung benutzt.
  // `controllerchange` erreicht dieses Dokument nie.

  it("erkennt im unkontrollierten Dokument, dass nur noch ein Reload noetig ist", () => {
    const h = harness({ controller: null });
    h.handle.needRefresh!();
    // Im Moment des Callbacks wartet der Worker noch: ehrlich „verfuegbar".
    expect(h.store.getSnapshot().state).toBe("updateAvailable");
    expect(h.store.getSnapshot().controlled).toBe(false);

    // Der Browser aktiviert ohne uns — kein controllerchange.
    h.activateNewWorker({ notify: false });

    expect(h.store.getSnapshot().activated).toBe(false);
    expect(h.store.getSnapshot().reloadRequired).toBe(true);
    expect(h.store.getSnapshot().state).toBe("reloadRequired");
    expect(h.store.getSnapshot().failed).toBe(false);

    // Und applyUpdate spielt keinen Versuch vor.
    expect(h.store.applyUpdate()).toBe("reloadRequired");
    expect(h.handle.updateCalls).toBe(0);
    expect(h.store.getSnapshot().applying).toBe(false);
    h.store.stop();
  });

  it("liest die Fakten auch dann, wenn der Benutzer vor dem Uebergang klickt", () => {
    const h = harness({ controller: null });
    h.handle.needRefresh!();

    // Klick, bevor der Worker aktiviert hat: ein Worker wartet wirklich, die
    // Anfrage ist berechtigt.
    expect(h.store.applyUpdate()).toBe("requested");
    expect(h.handle.updateCalls).toBe(1);

    // Der Worker aktiviert (durch unsere Anfrage) — ohne controllerchange.
    h.activateNewWorker({ notify: false });

    expect(h.store.getSnapshot().reloadRequired).toBe(true);
    expect(h.store.assessActivation()).toBe("reloadRequired");
    // Kein zweites SKIP_WAITING mehr.
    expect(h.store.applyUpdate()).toBe("reloadRequired");
    expect(h.handle.updateCalls).toBe(1);
    h.store.stop();
  });

  it("zeigt im unkontrollierten Dokument ohne entdecktes Update nichts", () => {
    // Erstbesuch: der erste Worker installiert und aktiviert sich, ohne dass
    // je ein Update entdeckt wurde. Kein Grund, den Nutzer zu stoeren.
    const h = harness({ controller: null, waiting: null });
    expect(h.store.getSnapshot().state).toBe("idle");
    expect(h.store.getSnapshot().reloadRequired).toBe(false);
    h.store.stop();
  });

  it("wertet einen fremden aktiven Worker im kontrollierten Dokument als Reload-Befund", () => {
    const h = harness();
    h.handle.needRefresh!();

    // Ein anderer Tab hat aktiviert; der Fakt ist da, bevor (oder ohne dass)
    // dieses Dokument sein controllerchange verarbeitet hat.
    h.facts.waiting = null;
    h.facts.active = h.newWorker;
    h.store.syncFacts();

    expect(h.store.getSnapshot().reloadRequired).toBe(true);
    expect(h.store.applyUpdate()).toBe("reloadRequired");
    expect(h.handle.updateCalls).toBe(0);
    h.store.stop();
  });

  it("macht aus `waiting === null` allein keinen Reload-Befund", () => {
    // Kontrolliert, entdeckt, aber der entdeckte Worker ist verschwunden und
    // der Controller ist weiterhin der aktive Worker: kein neuer Build aktiv.
    const h = harness({ waiting: null });
    h.handle.needRefresh!();

    expect(h.store.getSnapshot().reloadRequired).toBe(false);
    expect(h.store.applyUpdate()).toBe("noop");
    expect(h.handle.updateCalls).toBe(0);
    h.store.stop();
  });

  it("wartet ab, solange ein noch neuerer Worker installiert", () => {
    const h = harness({ controller: null, waiting: null });
    h.facts.installing = makeWorker();
    h.handle.needRefresh!();

    expect(h.store.getSnapshot().reloadRequired).toBe(false);
    expect(h.store.applyUpdate()).toBe("noop");
    h.store.stop();
  });

  it("beobachtet einen erst spaeter gefundenen Worker (updatefound)", () => {
    const h = harness({ controller: null, waiting: null });
    const found = makeWorker();
    h.facts.installing = found;
    h.registration.dispatchEvent(new Event("updatefound"));

    // Installiert, wartet kurz, aktiviert sich — der Store haengt am
    // `statechange` des Workers, nicht an einem Timer.
    h.facts.installing = null;
    h.facts.waiting = found;
    h.handle.needRefresh!();
    expect(h.store.getSnapshot().state).toBe("updateAvailable");

    h.facts.waiting = null;
    h.facts.active = found;
    found.dispatchEvent(new Event("statechange"));

    expect(h.store.getSnapshot().state).toBe("reloadRequired");
    h.store.stop();
  });

  // --- Der Watchdog-Befund ------------------------------------------------------

  it("beendet den laufenden Versuch, solange ein Worker wartet — und laesst einen zweiten zu", () => {
    const { store, handle } = harness();
    handle.needRefresh!();

    store.applyUpdate();
    expect(handle.updateCalls).toBe(1);
    expect(store.getSnapshot().applying).toBe(true);

    expect(store.assessActivation()).toBe("waiting");
    expect(store.getSnapshot().applying).toBe(false);
    // Kein Reset: das Update ist weiterhin verfuegbar.
    expect(store.getSnapshot().updateAvailable).toBe(true);

    // Der zweite Versuch ist eine echte zweite Anfrage.
    expect(store.applyUpdate()).toBe("requested");
    expect(handle.updateCalls).toBe(2);
    store.stop();
  });

  it("antwortet bei doppeltem Aufruf gleich (StrictMode)", () => {
    const { store, handle } = harness();
    handle.needRefresh!();
    store.applyUpdate();

    expect(store.assessActivation()).toBe("waiting");
    expect(store.assessActivation()).toBe("waiting");
    expect(store.getSnapshot().applying).toBe(false);
    expect(handle.updateCalls).toBe(1);
    store.stop();
  });

  it("blockiert Doppelklicks waehrend eines laufenden Versuchs weiterhin", () => {
    const { store, handle } = harness();
    handle.needRefresh!();

    store.applyUpdate();
    store.applyUpdate();
    store.applyUpdate();

    expect(handle.updateCalls).toBe(1);
    store.stop();
  });

  it("erklaert einen Versuch nach bestaetigter Uebernahme nicht fuer steckengeblieben", () => {
    const h = harness();
    h.handle.needRefresh!();
    h.store.applyUpdate();
    h.activateNewWorker({ notify: true });

    expect(h.store.assessActivation()).toBe("activated");
    expect(h.store.getSnapshot().activated).toBe(true);
    // Der Versuch bleibt stehen — es gibt nichts zu wiederholen.
    expect(h.store.getSnapshot().applying).toBe(true);
    expect(h.handle.updateCalls).toBe(1);
    h.store.stop();
  });

  it("laesst eine Uebernahme mitten im zweiten Versuch stehen", () => {
    const h = harness();
    h.handle.needRefresh!();

    h.store.applyUpdate();
    expect(h.store.assessActivation()).toBe("waiting");

    // Die Uebernahme von Versuch 1 trifft verspaetet ein.
    h.activateNewWorker({ notify: true });

    // Der Commit des zweiten Laufs fordert nichts mehr an.
    expect(h.store.applyUpdate()).toBe("activated");
    expect(h.store.getSnapshot().activated).toBe(true);
    expect(h.handle.updateCalls).toBe(1);
    h.store.stop();
  });

  // --- Ablehnung und Wiedervorlage im Reload-Zustand ---------------------------

  it("hebt eine Ablehnung auf, wenn die Uebernahme danach eintrifft", () => {
    const h = harness();
    h.handle.needRefresh!();
    h.store.dismissForNow();
    expect(h.store.getSnapshot().state).toBe("idle");

    h.activateNewWorker({ notify: true });

    // Ein neuer Fakt, nicht derselbe Hinweis: der Reload-Befund wird sichtbar.
    expect(h.store.getSnapshot().state).toBe("reloadRequired");
    h.store.stop();
  });

  it("laesst den Reload-Hinweis verschieben und bringt ihn spaeter wieder", () => {
    const h = harness({ controller: null });
    h.handle.needRefresh!();
    h.activateNewWorker({ notify: false });
    expect(h.store.getSnapshot().state).toBe("reloadRequired");

    h.store.dismissForNow();
    expect(h.store.getSnapshot().state).toBe("idle");
    // Der Fakt selbst bleibt lesbar.
    expect(h.store.getSnapshot().reloadRequired).toBe(true);

    clock += DISMISS_RESHOW_AFTER_MS;
    vi.advanceTimersByTime(DISMISS_RESHOW_AFTER_MS);
    expect(h.store.getSnapshot().state).toBe("reloadRequired");
    h.store.stop();
  });

  it("setzt reset auf den Anfangszustand zurueck — die einzige Stelle, die activated loescht", () => {
    const h = harness();
    h.handle.needRefresh!();
    h.activateNewWorker({ notify: true });
    expect(h.store.getSnapshot().activated).toBe(true);

    h.store.reset();

    expect(h.store.getSnapshot().state).toBe("idle");
    expect(h.store.getSnapshot().activated).toBe(false);
    expect(h.store.getSnapshot().reloadRequired).toBe(false);
  });
});
