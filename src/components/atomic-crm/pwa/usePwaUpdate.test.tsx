import { render } from "vitest-browser-react";

import { pwaUpdateStore, type RegisterSwLike } from "./pwaUpdateStore";
import { usePwaUpdate } from "./usePwaUpdate";

/**
 * Der Store ist prozessweit — genau das ist die Zusage, die hier geprueft wird:
 * `updateAvailable` haengt am Fenster, nicht am Komponentenbaum, und ueberlebt
 * deshalb einen Remount ohne LocalStorage.
 */
let needRefresh: (() => void) | undefined;
let updateCalls = 0;

const activeWorker = {} as ServiceWorker;
const fakeRegistration = {
  waiting: {} as ServiceWorker,
  installing: null,
  active: activeWorker,
  update: () => Promise.resolve(),
} as unknown as ServiceWorkerRegistration;

const fakeRegisterSW: RegisterSwLike = (opts) => {
  needRefresh = opts.onNeedRefresh;
  opts.onRegisteredSW?.("/sw.js", fakeRegistration);
  return () => {
    updateCalls += 1;
    return Promise.resolve();
  };
};

const Probe = () => {
  const { state, updateAvailable, applying, applyUpdate, dismissForNow } =
    usePwaUpdate();
  return (
    <div>
      <span data-testid="state">{state}</span>
      <span data-testid="available">{String(updateAvailable)}</span>
      <span data-testid="applying">{String(applying)}</span>
      <button data-testid="apply" onClick={applyUpdate}>
        apply
      </button>
      <button data-testid="dismiss" onClick={dismissForNow}>
        dismiss
      </button>
    </div>
  );
};

describe("usePwaUpdate", () => {
  it("spiegelt den Lifecycle und ueberlebt einen Remount", async () => {
    pwaUpdateStore.reset();
    // Ein kontrolliertes Dokument, wie im production-bewiesenen Happy Path.
    pwaUpdateStore.start(fakeRegisterSW, { getController: () => activeWorker });

    const first = await render(<Probe />);
    await expect.element(first.getByTestId("state")).toHaveTextContent("idle");

    // Ein wartender Worker wird sichtbar.
    needRefresh!();
    await expect
      .element(first.getByTestId("state"))
      .toHaveTextContent("updateAvailable");

    // Remount: der Hinweis darf nicht verlorengehen.
    await first.unmount();
    const second = await render(<Probe />);
    await expect
      .element(second.getByTestId("state"))
      .toHaveTextContent("updateAvailable");
    await expect
      .element(second.getByTestId("available"))
      .toHaveTextContent("true");

    // Die UI loest die Aktivierung ueber die Schnittstelle aus, nicht ueber
    // navigator.serviceWorker.
    const before = updateCalls;
    await second.getByTestId("apply").click();
    await expect
      .element(second.getByTestId("applying"))
      .toHaveTextContent("true");
    expect(updateCalls).toBe(before + 1);

    await second.unmount();
    pwaUpdateStore.reset();
  });
});
