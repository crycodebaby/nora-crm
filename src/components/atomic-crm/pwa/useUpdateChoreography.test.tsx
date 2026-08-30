import { act, useState } from "react";
import { render } from "vitest-browser-react";

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
  const { phase, presentation, start } = useUpdateChoreography({
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
    </div>
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
