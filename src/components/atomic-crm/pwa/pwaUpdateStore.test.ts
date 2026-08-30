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
});
