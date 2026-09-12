import { render } from "vitest-browser-react";

import { StoryWrapper } from "@/test/StoryWrapper";

import { Dashboard } from "./Dashboard";
import { MobileDashboard } from "./MobileDashboard";

/** Keeps every list query pending so the initial loading state stays on screen. */
const neverResolvingList = () => vi.fn(() => new Promise<never>(() => {}));

const skeletons = () =>
  Array.from(document.querySelectorAll('[data-slot="skeleton"]'));

describe("Startseite initial loading state", () => {
  it("shows a calm skeleton instead of a blank desktop page", async () => {
    await render(
      <StoryWrapper dataProvider={{ getList: neverResolvingList() as never }}>
        <Dashboard />
      </StoryWrapper>,
    );

    // A blank page reads as broken — the loading state must be perceivable
    // right away, not after an arbitrary delay. Polled rather than asserted
    // synchronously: since SEC-B2 removed the mobile React Query persister,
    // `render()` returns one commit earlier (ra-core is still evaluating
    // `requireAuth`), and the skeleton lands on the next animation frame —
    // before the first paint, so there is no blank page. The tight default
    // poll window keeps this a first-frame guarantee, not "eventually".
    await expect.poll(() => skeletons().length).toBeGreaterThan(0);
    await expect
      .poll(() => document.querySelectorAll("[aria-busy]").length)
      .toBeGreaterThan(0);
  });

  it("shows a calm skeleton instead of a blank mobile page", async () => {
    await render(
      <StoryWrapper dataProvider={{ getList: neverResolvingList() as never }}>
        <MobileDashboard />
      </StoryWrapper>,
    );

    await expect.poll(() => skeletons().length).toBeGreaterThan(0);
  });
});
