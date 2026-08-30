import { act, useState } from "react";
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
 * Der letzte Schritt eines Updates ist der Reload — und der gehoert Nora.
 *
 * **Warum es diese Datei gibt.** Der Client aus `virtual:pwa-register` laedt
 * nur dann selbst neu, wenn Workbox die gefundene Aktualisierung als „intern"
 * fuehrt. Im Zwei-Build-Harness ist real gemessen worden: nach `SKIP_WAITING`
 * feuert `controllerchange`, der neue Worker uebernimmt, der alte Precache
 * verschwindet — und die Seite bleibt trotzdem stehen. „Uebernommen" ist also
 * nicht „fertig". Diese Tests halten fest, dass Nora den Reload in dem Fall
 * selbst ausloest, und zwar genau einmal.
 *
 * Gegen den Hook statt gegen die Komponente, weil `window.location.reload` in
 * einem echten Browser nicht ersetzbar ist (unforgeable). Der Hook nimmt den
 * Reload deshalb als Parameter — dieselbe Naht, die die Komponente benutzt.
 */

type Controls = { setActivated: (value: boolean) => void };
let controls: Controls | null = null;

const Harness = ({
  applyUpdate,
  reload,
}: {
  applyUpdate: () => void;
  reload: () => void;
}) => {
  const [activated, setActivated] = useState(false);
  controls = { setActivated };
  const { phase, presentation, start, retry } = useUpdateChoreography({
    applyUpdate,
    // `applying` traegt hier nichts bei: solange eine Phase laeuft, ist die
    // Praesentation ohnehin „choreography". Bewusst false, damit dieser Test
    // nicht versehentlich am falschen Signal haengt.
    applying: false,
    activated,
    reload,
  });
  return (
    <div
      data-testid="probe"
      data-phase={phase}
      data-presentation={presentation}
    >
      <button data-testid="go" onClick={start}>
        go
      </button>
      <button data-testid="again" onClick={retry}>
        again
      </button>
    </div>
  );
};

/**
 * Derselbe Hook, aber an den ECHTEN Store gekoppelt (PWA-1C.3).
 *
 * **Warum es diesen zweiten Harness braucht.** Der obige `Harness` haelt
 * `activated` in lokalem React-State und uebergibt ein `vi.fn()` als
 * `applyUpdate`. Genau diese Vereinfachung hat den Race verdeckt, den der Last
 * Delta Review gefunden hat: in Production setzte `applyUpdate()` selbst
 * `activated` zurueck, und ein Harness, in dem die beiden Groessen nichts
 * miteinander zu tun haben, kann das per Konstruktion nicht sehen.
 *
 * Hier kommen `applying`, `activated` und `applyUpdate` deshalb aus
 * `usePwaUpdate()` — also aus `pwaUpdateStore` selbst, mit derselben
 * Kopplung wie in der Anwendung. `controllerchange` wird ueber
 * `navigator.serviceWorker` abgesetzt, den echten Weg. Nur der Reload bleibt
 * injizierbar, weil `window.location.reload` im Browser nicht ersetzbar ist —
 * und genau deswegen wird dieser Fall hier geprueft und nicht in
 * `NoraUpdateEvent.test.tsx`.
 *
 * Wuerde jemand `activated = false` in `applyUpdate()` wieder einfuehren,
 * faellt der Test rot: der Commit des zweiten Laufs saehe dann `activated`
 * false, `reload` bliebe ungerufen und der Watchdog brachte Recovery zurueck.
 */
let storeControls: { start: () => void; retry: () => void } | null = null;

const StoreHarness = ({ reload }: { reload: () => void }) => {
  const { applying, activated, applyUpdate } = usePwaUpdate();
  const { phase, presentation, start, retry } = useUpdateChoreography({
    applyUpdate,
    applying,
    activated,
    reload,
  });
  storeControls = { start, retry };
  return (
    <div
      data-testid="probe"
      data-phase={phase}
      data-presentation={presentation}
      data-applying={String(applying)}
      data-activated={String(activated)}
    />
  );
};

/** Zaehlt die Aktivierungsanfragen: ein Aufruf ist genau ein SKIP_WAITING. */
let storeApplyCalls = 0;
let storeNeedRefresh: (() => void) | undefined;
let storeWaiting = true;

const storeRegisterSw: RegisterSwLike = (opts) => {
  storeNeedRefresh = opts.onNeedRefresh;
  opts.onRegisteredSW?.("/sw.js", {
    get waiting() {
      return storeWaiting ? ({} as ServiceWorker) : null;
    },
    update: () => Promise.resolve(),
  } as unknown as ServiceWorkerRegistration);
  return () => {
    storeApplyCalls += 1;
    return Promise.resolve();
  };
};

/** Die echte Uebernahme, auf demselben EventTarget wie in Production. */
const dispatchControllerChange = () =>
  navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));

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

describe("useUpdateChoreography — Reload-Verantwortung", () => {
  beforeEach(() => {
    controls = null;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("laedt selbst neu, wenn nach der Uebernahme nichts passiert", async () => {
    const applyUpdate = vi.fn();
    const reload = vi.fn();
    const screen = await render(
      <Harness applyUpdate={applyUpdate} reload={reload} />,
    );

    await flush(() =>
      document.querySelector<HTMLElement>('[data-testid="go"]')!.click(),
    );
    await advance(CHOREOGRAPHY_COMMIT_MS);
    expect(applyUpdate).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();

    // Der Browser meldet die Uebernahme — der Client laedt aber nicht neu.
    await flush(() => controls!.setActivated(true));
    expect(reload).not.toHaveBeenCalled();

    await advance(RELOAD_FALLBACK_MS - 1);
    expect(reload).not.toHaveBeenCalled();

    await advance(1);
    expect(reload).toHaveBeenCalledTimes(1);

    // Und danach nicht noch einmal.
    await advance(RELOAD_FALLBACK_MS * 5);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(probe()?.dataset.presentation).toBe("choreography");

    await screen.unmount();
  });

  it("laedt nicht neu, solange die Uebernahme ausbleibt — sondern zeigt Recovery", async () => {
    const reload = vi.fn();
    const screen = await render(
      <Harness applyUpdate={vi.fn()} reload={reload} />,
    );

    await flush(() =>
      document.querySelector<HTMLElement>('[data-testid="go"]')!.click(),
    );
    await advance(CHOREOGRAPHY_COMMIT_MS);
    await advance(ACTIVATION_WATCHDOG_MS);

    expect(reload).not.toHaveBeenCalled();
    expect(probe()?.dataset.presentation).toBe("recovery");

    await screen.unmount();
  });

  // --------------------------------------------------------------------------
  // Der zweite Anlauf (PWA-1C.2). Der Store-Teil liegt in
  // `pwaUpdateStore.test.ts`; hier zaehlt, dass die Sequenz den zweiten Aufruf
  // ueberhaupt ausloest und dass daraus genau ein Reload wird.
  // --------------------------------------------------------------------------

  const click = (id: string) =>
    flush(() =>
      document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!.click(),
    );

  /**
   * Commit und Watchdog bewusst in zwei Schritten: der Watchdog-Timer entsteht
   * erst in dem Effekt, den der Commit ausloest. Ein einziger grosser Sprung
   * wuerde ihn nie sehen und faelschlich „kein Recovery" melden.
   */
  const runFailedAttempt = async () => {
    await advance(CHOREOGRAPHY_COMMIT_MS);
    await advance(ACTIVATION_WATCHDOG_MS);
  };

  it("loest beim zweiten Anlauf einen zweiten applyUpdate aus", async () => {
    const applyUpdate = vi.fn();
    const screen = await render(
      <Harness applyUpdate={applyUpdate} reload={vi.fn()} />,
    );

    await click("go");
    await advance(CHOREOGRAPHY_COMMIT_MS);
    await advance(ACTIVATION_WATCHDOG_MS);
    expect(probe()?.dataset.presentation).toBe("recovery");
    expect(applyUpdate).toHaveBeenCalledTimes(1);

    await click("again");

    // Die Sequenz laeuft wieder von vorn — und commitet nicht frueher.
    expect(probe()?.dataset.presentation).toBe("choreography");
    await advance(CHOREOGRAPHY_COMMIT_MS - 1);
    expect(applyUpdate).toHaveBeenCalledTimes(1);

    await advance(1);
    expect(applyUpdate).toHaveBeenCalledTimes(2);

    await screen.unmount();
  });

  it("laedt nach einem erfolgreichen zweiten Anlauf genau einmal neu", async () => {
    const applyUpdate = vi.fn();
    const reload = vi.fn();
    const screen = await render(
      <Harness applyUpdate={applyUpdate} reload={reload} />,
    );

    await click("go");
    await runFailedAttempt();
    await click("again");
    await advance(CHOREOGRAPHY_COMMIT_MS);
    expect(applyUpdate).toHaveBeenCalledTimes(2);

    // Diesmal uebernimmt der Worker.
    await flush(() => controls!.setActivated(true));
    await advance(RELOAD_FALLBACK_MS);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(probe()?.dataset.presentation).toBe("choreography");

    // Kein zweiter Reload aus einem Rest des ersten Laufs.
    await advance(RELOAD_FALLBACK_MS * 5);
    expect(reload).toHaveBeenCalledTimes(1);

    await screen.unmount();
  });

  it("zeigt nach einem zweiten Fehlschlag wieder Recovery und bleibt wiederholbar", async () => {
    const applyUpdate = vi.fn();
    const reload = vi.fn();
    const screen = await render(
      <Harness applyUpdate={applyUpdate} reload={reload} />,
    );

    await click("go");
    await runFailedAttempt();
    await click("again");
    await runFailedAttempt();

    expect(applyUpdate).toHaveBeenCalledTimes(2);
    expect(probe()?.dataset.presentation).toBe("recovery");
    expect(reload).not.toHaveBeenCalled();

    // Ein dritter Anlauf bleibt moeglich — keine kuenstliche Versuchsgrenze.
    await click("again");
    await advance(CHOREOGRAPHY_COMMIT_MS);
    expect(applyUpdate).toHaveBeenCalledTimes(3);

    await screen.unmount();
  });

  it("macht aus einem spaeten controllerchange im zweiten Lauf keinen zweiten Reload", async () => {
    const applyUpdate = vi.fn();
    const reload = vi.fn();
    const screen = await render(
      <Harness applyUpdate={applyUpdate} reload={reload} />,
    );

    // Getrennte Schritte, sonst entsteht der Watchdog-Timer nie und der Lauf
    // startet gar nicht aus Recovery — die fruehere Fassung sprang mit einem
    // einzigen `advance()` ueber beides und bewies deshalb nichts.
    await click("go");
    await runFailedAttempt();
    expect(probe()?.dataset.presentation).toBe("recovery");
    expect(applyUpdate).toHaveBeenCalledTimes(1);

    await click("again");

    // Mitten in der zweiten Choreografie trifft die Uebernahme des ERSTEN
    // Versuchs doch noch ein.
    await advance(2000);
    await flush(() => controls!.setActivated(true));

    // Vor dem Commit passiert nichts — der Reload haengt an `commitRequested`.
    await advance(RELOAD_FALLBACK_MS * 2);
    expect(reload).not.toHaveBeenCalled();

    // Dann faellt der Commit. Der Store liefert `activated` weiterhin (die
    // Groesse ist monoton, siehe `pwaUpdateStore`), also greift der
    // Reload-Pfad statt des Watchdogs.
    await advance(CHOREOGRAPHY_COMMIT_MS - RELOAD_FALLBACK_MS * 2 - 2000);
    await advance(RELOAD_FALLBACK_MS);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(probe()?.dataset.presentation).toBe("choreography");

    // Kein zweiter Reload, und auch nach der vollen Frist kein Recovery.
    await advance(ACTIVATION_WATCHDOG_MS * 3);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(probe()?.dataset.presentation).toBe("choreography");

    await screen.unmount();
  });

  // --------------------------------------------------------------------------
  // Gegen den echten Store (PWA-1C.3). Siehe den Kommentar an `StoreHarness`:
  // dieselbe Kopplung von `applyUpdate`, `applying` und `activated` wie in der
  // Anwendung — nur der Reload bleibt injizierbar.
  // --------------------------------------------------------------------------

  describe("am echten Store", () => {
    beforeEach(() => {
      pwaUpdateStore.reset();
      storeApplyCalls = 0;
      storeWaiting = true;
      storeControls = null;
      pwaUpdateStore.start(storeRegisterSw);
    });

    afterEach(() => {
      pwaUpdateStore.reset();
    });

    /** Bis in den Recovery-Zustand: Anfrage raus, Uebernahme bleibt aus. */
    const toRecovery = async () => {
      await flush(() => storeNeedRefresh!());
      await flush(() => storeControls!.start());
      await advance(CHOREOGRAPHY_COMMIT_MS);
      expect(storeApplyCalls).toBe(1);
      await advance(ACTIVATION_WATCHDOG_MS);
      expect(probe()?.dataset.presentation).toBe("recovery");
    };

    it("haelt eine Uebernahme, die waehrend des zweiten Laufs eintrifft", async () => {
      const reload = vi.fn();
      const screen = await render(<StoreHarness reload={reload} />);

      await toRecovery();
      // Der Watchdog macht den Versuch wiederholbar — sonst liefe der Retry in
      // den `applying`-Guard (das war der BLOCKER aus PWA-1C.2).
      await flush(() => pwaUpdateStore.endStalledActivation());
      await flush(() => storeControls!.retry());

      // Mitten im zweiten Lauf trifft die Uebernahme des ERSTEN Versuchs ein.
      await advance(2000);
      await flush(() => dispatchControllerChange());
      expect(probe()?.dataset.activated).toBe("true");
      expect(probe()?.dataset.presentation).toBe("choreography");

      // Die Choreografie laeuft sauber zu Ende — kein abrupter Abbruch, kein
      // vorgezogener Reload. Der Commit bleibt der Uebergabepunkt.
      await advance(CHOREOGRAPHY_COMMIT_MS - 2000 - 1);
      expect(reload).not.toHaveBeenCalled();
      expect(probe()?.dataset.presentation).toBe("choreography");

      await advance(1);
      // Der Commit fordert nichts mehr an, und die Uebernahme steht noch.
      expect(storeApplyCalls).toBe(1);
      expect(probe()?.dataset.activated).toBe("true");

      await advance(RELOAD_FALLBACK_MS);
      expect(reload).toHaveBeenCalledTimes(1);

      // Weit ueber die Watchdog-Frist hinaus: kein Recovery, kein zweiter
      // Reload, keine zweite Anfrage.
      await advance(ACTIVATION_WATCHDOG_MS * 3);
      expect(reload).toHaveBeenCalledTimes(1);
      expect(storeApplyCalls).toBe(1);
      expect(probe()?.dataset.presentation).toBe("choreography");

      await screen.unmount();
    });

    it("laesst den legitimen Retry weiterhin senden", async () => {
      const reload = vi.fn();
      const screen = await render(<StoreHarness reload={reload} />);

      await toRecovery();
      await flush(() => pwaUpdateStore.endStalledActivation());
      await flush(() => storeControls!.retry());

      // Keine Uebernahme diesmal: der `activated`-Guard darf den echten
      // zweiten Versuch nicht blockieren.
      await advance(CHOREOGRAPHY_COMMIT_MS);
      expect(storeApplyCalls).toBe(2);
      expect(reload).not.toHaveBeenCalled();

      await screen.unmount();
    });

    it("laedt nach einem erfolgreichen zweiten Versuch genau einmal", async () => {
      const reload = vi.fn();
      const screen = await render(<StoreHarness reload={reload} />);

      await toRecovery();
      await flush(() => pwaUpdateStore.endStalledActivation());
      await flush(() => storeControls!.retry());
      await advance(CHOREOGRAPHY_COMMIT_MS);
      expect(storeApplyCalls).toBe(2);

      // Die Uebernahme kommt NACH Anfrage 2.
      storeWaiting = false;
      await flush(() => dispatchControllerChange());
      await advance(RELOAD_FALLBACK_MS);
      expect(reload).toHaveBeenCalledTimes(1);

      await advance(ACTIVATION_WATCHDOG_MS * 3);
      expect(reload).toHaveBeenCalledTimes(1);
      expect(probe()?.dataset.presentation).toBe("choreography");

      await screen.unmount();
    });

    it("bringt bei bestaetigter Uebernahme keinen Watchdog mehr zurueck", async () => {
      const reload = vi.fn();
      const screen = await render(<StoreHarness reload={reload} />);

      await flush(() => storeNeedRefresh!());
      await flush(() => storeControls!.start());
      await advance(CHOREOGRAPHY_COMMIT_MS);
      storeWaiting = false;
      await flush(() => dispatchControllerChange());

      // Ab hier darf keine Frist mehr Recovery erzeugen.
      await advance(ACTIVATION_WATCHDOG_MS * 4);
      expect(probe()?.dataset.presentation).toBe("choreography");
      expect(reload).toHaveBeenCalledTimes(1);
      expect(storeApplyCalls).toBe(1);

      await screen.unmount();
    });

    it("sendet nach bestaetigter Uebernahme auch bei weiteren Commits nichts", async () => {
      const reload = vi.fn();
      const screen = await render(<StoreHarness reload={reload} />);

      await flush(() => storeNeedRefresh!());
      storeWaiting = false;
      await flush(() => dispatchControllerChange());
      expect(probe()?.dataset.activated).toBe("true");

      // Dreifacher Start, danach noch ein Retry: jeder Lauf commitet, und
      // trotzdem geht keine einzige Anfrage raus.
      await flush(() => {
        storeControls!.start();
        storeControls!.start();
        storeControls!.start();
      });
      await advance(CHOREOGRAPHY_COMMIT_MS);
      await flush(() => storeControls!.retry());
      await advance(CHOREOGRAPHY_COMMIT_MS);

      expect(storeApplyCalls).toBe(0);
      expect(probe()?.dataset.activated).toBe("true");

      await screen.unmount();
    });
  });

  it("raeumt den Reload-Timer beim Unmount ab", async () => {
    const reload = vi.fn();
    const screen = await render(
      <Harness applyUpdate={vi.fn()} reload={reload} />,
    );

    await flush(() =>
      document.querySelector<HTMLElement>('[data-testid="go"]')!.click(),
    );
    await advance(CHOREOGRAPHY_COMMIT_MS);
    await flush(() => controls!.setActivated(true));

    await screen.unmount();
    await flush(() => vi.advanceTimersByTime(RELOAD_FALLBACK_MS * 4));

    expect(reload).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
