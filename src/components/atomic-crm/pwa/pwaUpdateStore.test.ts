import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  createPwaUpdateStore,
  DISMISS_RESHOW_AFTER_MS,
  UPDATE_CHECK_MIN_INTERVAL_MS,
  type RegisterSwLike,
} from "./pwaUpdateStore";

/**
 * Kleiner Ersatz fuer `virtual:pwa-register`: gibt die Callbacks nach aussen,
 * damit ein Test „Worker wartet" und „Update wird angewendet" ausloesen kann,
 * ohne einen echten Service Worker zu brauchen.
 */
const createFakeRegisterSW = (
  options: {
    registration?: Partial<ServiceWorkerRegistration>;
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
    opts.onRegisteredSW?.(
      "/sw.js",
      options.registration as ServiceWorkerRegistration | undefined,
    );
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

describe("pwaUpdateStore", () => {
  beforeEach(() => {
    clock = 1_000_000;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("meldet idle, solange kein Worker wartet", () => {
    const { registerSw } = createFakeRegisterSW();
    const store = createPwaUpdateStore({ now });
    store.start(registerSw);

    expect(store.getSnapshot()).toEqual({
      state: "idle",
      updateAvailable: false,
      applying: false,
      activated: false,
    });
    store.stop();
  });

  it("meldet updateAvailable, sobald ein Worker wartet", () => {
    const { registerSw, handle } = createFakeRegisterSW();
    const store = createPwaUpdateStore({ now });
    const listener = vi.fn();
    store.subscribe(listener);
    store.start(registerSw);

    handle.needRefresh!();

    expect(store.getSnapshot().state).toBe("updateAvailable");
    expect(store.getSnapshot().updateAvailable).toBe(true);
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

  it("aktiviert den wartenden Worker bei applyUpdate", () => {
    const { registerSw, handle } = createFakeRegisterSW();
    const store = createPwaUpdateStore({ now });
    store.start(registerSw);
    handle.needRefresh!();

    store.applyUpdate();

    expect(handle.updateCalls).toBe(1);
    expect(store.getSnapshot().state).toBe("applying");
    expect(store.getSnapshot().applying).toBe(true);
    store.stop();
  });

  it("ignoriert einen zweiten applyUpdate-Aufruf (Doppelklick)", () => {
    const { registerSw, handle } = createFakeRegisterSW();
    const store = createPwaUpdateStore({ now });
    store.start(registerSw);
    handle.needRefresh!();

    store.applyUpdate();
    store.applyUpdate();
    store.applyUpdate();

    expect(handle.updateCalls).toBe(1);
    store.stop();
  });

  it("tut nichts, wenn applyUpdate ohne wartenden Worker aufgerufen wird", () => {
    const { registerSw, handle } = createFakeRegisterSW();
    const store = createPwaUpdateStore({ now });
    store.start(registerSw);

    store.applyUpdate();

    expect(handle.updateCalls).toBe(0);
    expect(store.getSnapshot().state).toBe("idle");
    store.stop();
  });

  it("faellt auf updateAvailable zurueck, wenn die Aktivierung fehlschlaegt", async () => {
    const { registerSw, handle } = createFakeRegisterSW({
      updateServiceWorker: () => Promise.reject(new Error("worker weg")),
    });
    const store = createPwaUpdateStore({ now });
    store.start(registerSw);
    handle.needRefresh!();

    store.applyUpdate();
    expect(store.getSnapshot().state).toBe("applying");

    await vi.waitFor(() =>
      expect(store.getSnapshot().state).toBe("updateAvailable"),
    );
    expect(store.getSnapshot().applying).toBe(false);
    store.stop();
  });

  it("behaelt den wartenden Worker bei dismissForNow und zeigt ihn spaeter erneut", () => {
    const { registerSw, handle } = createFakeRegisterSW();
    const store = createPwaUpdateStore({ now });
    store.start(registerSw);
    handle.needRefresh!();

    store.dismissForNow();
    expect(store.getSnapshot().state).toBe("idle");
    // Der Worker ist nicht verworfen: applyUpdate wuerde ihn weiterhin aktivieren.
    expect(handle.updateCalls).toBe(0);

    clock += DISMISS_RESHOW_AFTER_MS;
    vi.advanceTimersByTime(DISMISS_RESHOW_AFTER_MS);

    expect(store.getSnapshot().state).toBe("updateAvailable");
    store.stop();
  });

  it("hebt eine Ablehnung auf, wenn danach ein neues Update gefunden wird", () => {
    const { registerSw, handle } = createFakeRegisterSW();
    const store = createPwaUpdateStore({ now });
    store.start(registerSw);
    handle.needRefresh!();
    store.dismissForNow();
    expect(store.getSnapshot().state).toBe("idle");

    handle.needRefresh!();

    expect(store.getSnapshot().state).toBe("updateAvailable");
    store.stop();
  });

  it("liefert einen referenziell stabilen Snapshot ohne Zustandswechsel", () => {
    const { registerSw } = createFakeRegisterSW();
    const store = createPwaUpdateStore({ now });
    store.start(registerSw);

    expect(store.getSnapshot()).toBe(store.getSnapshot());
    store.stop();
  });

  it("prueft beim Zurueckkehren auf den Tab, aber nicht oefter als erlaubt", () => {
    const update = vi.fn(() => Promise.resolve());
    const target = listenerTarget();
    const { registerSw } = createFakeRegisterSW({
      registration: { update } as unknown as ServiceWorkerRegistration,
    });
    const store = createPwaUpdateStore({
      now,
      target: target.target,
      isOnline: () => true,
    });
    store.start(registerSw);

    expect(document.visibilityState).toBe("visible");

    // Direkt nach der Registrierung greift die Drosselung.
    target.dispatch("visibilitychange");
    expect(update).toHaveBeenCalledTimes(0);

    // Nach Ablauf des Mindestabstands wird genau einmal geprueft ...
    clock += UPDATE_CHECK_MIN_INTERVAL_MS;
    target.dispatch("visibilitychange");
    expect(update).toHaveBeenCalledTimes(1);

    // ... ein sofortiger zweiter Tabwechsel loest keine weitere Pruefung aus.
    target.dispatch("visibilitychange");
    expect(update).toHaveBeenCalledTimes(1);
    store.stop();
  });

  it("prueft offline nicht auf Updates", () => {
    const update = vi.fn(() => Promise.resolve());
    const target = listenerTarget();
    const { registerSw } = createFakeRegisterSW({
      registration: { update } as unknown as ServiceWorkerRegistration,
    });
    const store = createPwaUpdateStore({
      now,
      target: target.target,
      isOnline: () => false,
    });
    store.start(registerSw);

    clock += UPDATE_CHECK_MIN_INTERVAL_MS * 2;
    target.dispatch("visibilitychange");

    expect(update).not.toHaveBeenCalled();
    store.stop();
  });

  it("baut Listener und Timer bei stop wieder ab", () => {
    const target = listenerTarget();
    const { registerSw } = createFakeRegisterSW({
      registration: {
        update: vi.fn(() => Promise.resolve()),
      } as unknown as ServiceWorkerRegistration,
    });
    const store = createPwaUpdateStore({ now, target: target.target });
    store.start(registerSw);
    expect(target.count("visibilitychange")).toBe(1);

    store.stop();

    expect(target.count("visibilitychange")).toBe(0);
  });

  it("bleibt nach einem Registrierungsfehler nutzbar und still", () => {
    const { registerSw, handle } = createFakeRegisterSW();
    const store = createPwaUpdateStore({ now });
    store.start(registerSw);

    handle.registerError!(new Error("kein Worker"));

    expect(store.getSnapshot().state).toBe("idle");
    store.stop();
  });

  // --- Aktivierungsanfrage vs. tatsaechliche Uebernahme --------------------
  //
  // Der Defekt aus dem Final Review des ersten RC: das Promise von
  // `updateServiceWorker()` wurde als Erfolgssignal gelesen, obwohl der
  // ausgelieferte Client es praktisch nie ablehnt. Diese Tests halten die
  // Trennung fest.

  it("meldet nach applyUpdate NICHT aktiviert, solange keine Uebernahme kam", async () => {
    const swTarget = listenerTarget();
    const { registerSw, handle } = createFakeRegisterSW({
      // Genau wie der echte Client: resolved sofort, sagt nichts ueber Erfolg.
      updateServiceWorker: () => Promise.resolve(),
    });
    const store = createPwaUpdateStore({
      now,
      serviceWorkerTarget: swTarget.target,
    });
    store.start(registerSw);
    handle.needRefresh!();

    store.applyUpdate();
    await vi.waitFor(() => expect(handle.updateCalls).toBe(1));

    expect(store.getSnapshot().applying).toBe(true);
    // Das ist der Kern: die Anfrage ist raus, die Uebernahme nicht bestaetigt.
    expect(store.getSnapshot().activated).toBe(false);
    store.stop();
  });

  it("meldet aktiviert, sobald controllerchange eintrifft", () => {
    const swTarget = listenerTarget();
    const { registerSw, handle } = createFakeRegisterSW();
    const store = createPwaUpdateStore({
      now,
      serviceWorkerTarget: swTarget.target,
    });
    const listener = vi.fn();
    store.subscribe(listener);
    store.start(registerSw);
    handle.needRefresh!();
    store.applyUpdate();

    expect(store.getSnapshot().activated).toBe(false);
    swTarget.dispatch("controllerchange");

    expect(store.getSnapshot().activated).toBe(true);
    expect(listener).toHaveBeenCalled();
    store.stop();
  });

  // --------------------------------------------------------------------------
  // `activated` ist monoton (PWA-1C.3).
  //
  // Frueher setzte `applyUpdate()` es als erste Amtshandlung wieder auf `false`
  // — mit der Begruendung, ein frueheres `controllerchange` duerfe den Erfolg
  // dieses Versuchs nicht vorwegnehmen. Das verwechselte den VERSUCH mit dem
  // DOKUMENT: die Beobachtung „hier hat eine Uebernahme stattgefunden" wird
  // durch einen neuen Versuch nicht falsch. Traf sie waehrend einer laufenden
  // Retry-Choreografie ein, loeschte deren Commit sie wieder.
  // --------------------------------------------------------------------------

  it("nimmt eine bestaetigte Uebernahme nie wieder zurueck", () => {
    const swTarget = listenerTarget();
    const { registerSw, handle } = createFakeRegisterSW();
    const store = createPwaUpdateStore({
      now,
      serviceWorkerTarget: swTarget.target,
    });
    store.start(registerSw);
    handle.needRefresh!();

    // Etwa aus einem anderen Tab, bevor der Benutzer hier entschieden hat.
    swTarget.dispatch("controllerchange");
    expect(store.getSnapshot().activated).toBe(true);

    store.applyUpdate();
    store.applyUpdate();

    expect(store.getSnapshot().activated).toBe(true);
    store.stop();
  });

  it("schickt keinen Aktivierungsversuch mehr, wenn schon uebernommen wurde", () => {
    const swTarget = listenerTarget();
    const { registerSw, handle } = createFakeRegisterSW();
    const store = createPwaUpdateStore({
      now,
      serviceWorkerTarget: swTarget.target,
    });
    store.start(registerSw);
    handle.needRefresh!();
    swTarget.dispatch("controllerchange");

    store.applyUpdate();

    // Es gibt nichts mehr zu aktivieren: sauberer No-op statt einer Anfrage
    // ins Leere. `applying` bleibt unberuehrt, damit die Praesentation nicht
    // faelschlich in eine Wartelage geraet — der Reload-Pfad haengt an
    // `commitRequested && activated` und greift ohnehin.
    expect(handle.updateCalls).toBe(0);
    expect(store.getSnapshot().applying).toBe(false);
    store.stop();
  });

  it("meldet, ob ein erneuter Versuch ueberhaupt etwas anstossen kann", () => {
    const waiting = {} as ServiceWorker;
    const withWaiting = createFakeRegisterSW({
      registration: { waiting } as unknown as ServiceWorkerRegistration,
    });
    const storeA = createPwaUpdateStore({ now });
    storeA.start(withWaiting.registerSw);
    expect(storeA.hasWaitingWorker()).toBe(true);
    storeA.stop();

    const withoutWaiting = createFakeRegisterSW({
      registration: {} as unknown as ServiceWorkerRegistration,
    });
    const storeB = createPwaUpdateStore({ now });
    storeB.start(withoutWaiting.registerSw);
    expect(storeB.hasWaitingWorker()).toBe(false);
    storeB.stop();
  });

  // --------------------------------------------------------------------------
  // Der steckengebliebene Versuch (PWA-1C.2).
  //
  // Vorher fiel `applying` auf dem Watchdog-Pfad nie wieder auf `false`, und
  // weil `applyUpdate()` genau darauf sperrt, war „Erneut versuchen" ein Knopf
  // ohne technische Wirkung. Diese Tests halten den Uebergang fest, der das
  // schliesst — und die Grenzen, an denen er ausdruecklich NICHT greifen darf.
  // --------------------------------------------------------------------------

  /** Eine Registration, deren `waiting` sich wie im Browser aendern kann. */
  const stallHarness = (options: { waiting: boolean }) => {
    const swTarget = listenerTarget();
    const worker = {} as ServiceWorker;
    const registration = {
      get waiting() {
        return options.waiting ? worker : null;
      },
    } as unknown as ServiceWorkerRegistration;
    const { registerSw, handle } = createFakeRegisterSW({ registration });
    const store = createPwaUpdateStore({
      now,
      serviceWorkerTarget: swTarget.target,
    });
    store.start(registerSw);
    handle.needRefresh!();
    return { store, handle, swTarget, options };
  };

  it("beendet den steckengebliebenen Versuch, solange ein Worker wartet", () => {
    const { store, handle } = stallHarness({ waiting: true });

    store.applyUpdate();
    expect(handle.updateCalls).toBe(1);
    expect(store.getSnapshot().applying).toBe(true);

    expect(store.endStalledActivation()).toBe(true);

    expect(store.getSnapshot().applying).toBe(false);
    // Kein Reset: das Update ist weiterhin verfuegbar, der Hinweis bleibt.
    expect(store.getSnapshot().updateAvailable).toBe(true);
    store.stop();
  });

  it("laesst danach einen echten zweiten Aktivierungsversuch zu", () => {
    const { store, handle } = stallHarness({ waiting: true });

    store.applyUpdate();
    expect(handle.updateCalls).toBe(1);
    store.endStalledActivation();

    store.applyUpdate();

    // Das ist der eigentliche BLOCKER-Regressionstest: nicht ein neuer
    // Animationslauf, sondern eine zweite Anfrage an den Worker.
    expect(handle.updateCalls).toBe(2);
    expect(store.getSnapshot().applying).toBe(true);
    store.stop();
  });

  it("erlaubt beliebig viele Versuche, solange wirklich ein Worker wartet", () => {
    const { store, handle } = stallHarness({ waiting: true });

    for (let attempt = 1; attempt <= 3; attempt++) {
      store.applyUpdate();
      expect(handle.updateCalls).toBe(attempt);
      expect(store.endStalledActivation()).toBe(true);
    }
    // Bewusst keine kuenstliche Versuchsgrenze: die Wahrheit ist der wartende
    // Worker, nicht ein Zaehler.
    store.stop();
  });

  it("blockiert Doppelklicks waehrend eines laufenden Versuchs weiterhin", () => {
    const { store, handle } = stallHarness({ waiting: true });

    store.applyUpdate();
    store.applyUpdate();
    store.applyUpdate();

    expect(handle.updateCalls).toBe(1);
    store.stop();
  });

  it("beendet nichts, wenn die Uebernahme doch noch eingetreten ist", () => {
    const { store, handle, swTarget } = stallHarness({ waiting: true });

    store.applyUpdate();
    swTarget.dispatch("controllerchange");
    expect(store.getSnapshot().activated).toBe(true);

    // `activated` gewinnt: es gibt nichts zu wiederholen, und der laufende
    // Versuch darf nicht nachtraeglich fuer gescheitert erklaert werden.
    expect(store.endStalledActivation()).toBe(false);
    expect(store.getSnapshot().applying).toBe(true);
    expect(handle.updateCalls).toBe(1);
    store.stop();
  });

  it("macht ohne wartenden Worker nicht faelschlich retryable", () => {
    const { store, handle } = stallHarness({ waiting: false });

    store.applyUpdate();
    expect(handle.updateCalls).toBe(1);

    // Fall B: ein zweites SKIP_WAITING taete nachweislich nichts. Der Versuch
    // bleibt stehen, und die Oberflaeche bietet stattdessen den Reload an.
    expect(store.endStalledActivation()).toBe(false);
    expect(store.getSnapshot().applying).toBe(true);
    store.stop();
  });

  it("verliert den wartenden Worker zwischen Recovery und Retry nicht still", () => {
    const harness = stallHarness({ waiting: true });
    const { store, handle } = harness;

    store.applyUpdate();
    expect(store.endStalledActivation()).toBe(true);

    // Der Worker verschwindet, bevor der Benutzer klickt.
    harness.options.waiting = false;

    expect(store.hasWaitingWorker()).toBe(false);
    // Der Store wuerde die Anfrage zwar durchlassen — deshalb liest die
    // Oberflaeche `hasWaitingWorker()` im Moment des Klicks noch einmal und
    // laedt dann statt zu wiederholen (siehe `NoraUpdateEvent`).
    expect(handle.updateCalls).toBe(1);
    store.stop();
  });

  it("laesst eine Uebernahme mitten im zweiten Versuch stehen", () => {
    const { store, handle, swTarget } = stallHarness({ waiting: true });

    // Versuch 1 bleibt stecken, der Watchdog macht ihn wiederholbar.
    store.applyUpdate();
    expect(handle.updateCalls).toBe(1);
    expect(store.endStalledActivation()).toBe(true);

    // Die Uebernahme von Versuch 1 trifft verspaetet ein — waehrend die
    // Retry-Choreografie schon laeuft, aber vor ihrem Commit.
    swTarget.dispatch("controllerchange");
    expect(store.getSnapshot().activated).toBe(true);

    // Der Commit des zweiten Laufs. Vorher loeschte genau dieser Aufruf die
    // Uebernahme und schickte ein zweites SKIP_WAITING ins Leere.
    store.applyUpdate();

    expect(store.getSnapshot().activated).toBe(true);
    expect(handle.updateCalls).toBe(1);
    store.stop();
  });

  it("erklaert einen Versuch nach bestaetigter Uebernahme nicht fuer steckengeblieben", () => {
    const { store, swTarget } = stallHarness({ waiting: true });

    store.applyUpdate();
    swTarget.dispatch("controllerchange");

    // `activated` gewinnt: es gibt nichts zu wiederholen, und der Versuch darf
    // nicht nachtraeglich fuer gescheitert erklaert werden.
    expect(store.endStalledActivation()).toBe(false);
    expect(store.getSnapshot().activated).toBe(true);
    store.stop();
  });

  it("antwortet bei doppeltem Aufruf gleich (StrictMode)", () => {
    const { store } = stallHarness({ waiting: true });

    store.applyUpdate();

    expect(store.endStalledActivation()).toBe(true);
    // Der zweite Aufruf veraendert nichts mehr, muss aber dieselbe Antwort
    // geben — sonst kippte die Recovery-Aktion im StrictMode auf „reload".
    expect(store.endStalledActivation()).toBe(true);
    expect(store.getSnapshot().applying).toBe(false);
    store.stop();
  });

  it("baut auch den controllerchange-Listener bei stop wieder ab", () => {
    const swTarget = listenerTarget();
    const { registerSw } = createFakeRegisterSW();
    const store = createPwaUpdateStore({
      now,
      serviceWorkerTarget: swTarget.target,
    });
    store.start(registerSw);
    expect(swTarget.count("controllerchange")).toBe(1);

    store.stop();

    expect(swTarget.count("controllerchange")).toBe(0);
  });
});
