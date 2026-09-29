import { useState } from "react";
import { render } from "vitest-browser-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ATTACHMENT_URL_RENEWAL_MS,
  getSignedAttachmentCapability,
  resetAttachmentUrlCache,
} from "./attachmentAccess";
import { AttachmentSignerProvider, useAttachmentUrl } from "./useAttachmentUrl";

/**
 * Alpha Storage 3 L-1 — proactive renewal is timed by the capability the
 * consumer HOLDS, not by when the consumer mounted.
 *
 * The cache hands a late consumer the URL it already has, with whatever life
 * that URL has left. Before the remediation the hook then waited a fresh full
 * interval (~14.5 min) from its own mount, so a URL served with seconds left
 * sat in the DOM long after it died. Every scenario below runs on a fake
 * clock (`setTimeout` + `Date` only; React's MessageChannel scheduler stays
 * real), so each instant is asserted exactly, not approximately.
 */

const T0 = Date.UTC(2026, 8, 29, 8, 0, 0);

/** Lets resolved promises and React's real scheduler commit. */
const settle = async () => {
  for (let i = 0; i < 5; i += 1) {
    await vi.advanceTimersByTimeAsync(0);
    await new Promise<void>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve();
      channel.port2.postMessage(0);
    });
  }
};

/** Advances the fake clock and lets everything it triggered commit. */
const advance = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
  await settle();
};

const countingSigner = () => {
  const state = { calls: 0, fail: false };
  const signer = async (key: string) => {
    state.calls += 1;
    if (state.fail) throw new Error("signing refused");
    return `https://signed.test/${key}?v=${state.calls}`;
  };
  return { state, signer };
};

/** Records every value the hook produced, so a stale URL cannot hide. */
const seen: string[] = [];
const Probe = ({ id, storageKey }: { id: string; storageKey: string }) => {
  const [value] = useState(() => ({ path: storageKey }));
  const access = useAttachmentUrl(value);
  const current = access.href ?? access.status;
  seen.push(`${id}:${current}`);
  return (
    <span>
      <span data-testid={id}>{current}</span>
      <button type="button" onClick={access.refresh}>
        refresh-{id}
      </button>
    </span>
  );
};

const shown = (screen: { container: HTMLElement }, id: string) =>
  screen.container.querySelector(`[data-testid="${id}"]`)?.textContent;

const clickRefresh = async (screen: { container: HTMLElement }, id: string) => {
  const button = [...screen.container.querySelectorAll("button")].find(
    (b) => b.textContent === `refresh-${id}`,
  );
  button?.click();
  await settle();
};

const mount = async (
  signer: (key: string) => Promise<string>,
  probes: { id: string; storageKey: string }[],
) => {
  const screen = await render(
    <AttachmentSignerProvider signer={signer}>
      {probes.map((p) => (
        <Probe key={p.id} {...p} />
      ))}
    </AttachmentSignerProvider>,
  );
  await settle();
  return screen;
};

beforeEach(() => {
  vi.useFakeTimers({
    now: T0,
    toFake: ["setTimeout", "clearTimeout", "Date"],
  });
  resetAttachmentUrlCache();
  seen.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAttachmentUrl renewal follows the capability's own expiry (L-1)", () => {
  it("renews a freshly signed capability exactly at its horizon", async () => {
    const { state, signer } = countingSigner();
    const screen = await mount(signer, [{ id: "a", storageKey: "k1.pdf" }]);

    expect(shown(screen, "a")).toBe("https://signed.test/k1.pdf?v=1");
    expect(state.calls).toBe(1);

    await advance(ATTACHMENT_URL_RENEWAL_MS - 1);
    expect(state.calls).toBe(1);
    expect(shown(screen, "a")).toBe("https://signed.test/k1.pdf?v=1");

    await advance(1);
    expect(state.calls).toBe(2);
    expect(shown(screen, "a")).toBe("https://signed.test/k1.pdf?v=2");
  });

  it("renews a cached almost-expired capability when THAT capability lapses", async () => {
    const { state, signer } = countingSigner();
    // Another consumer signed the object at T0 and has since gone away.
    await getSignedAttachmentCapability("k1.pdf", signer);
    const remaining = 5_000;
    await advance(ATTACHMENT_URL_RENEWAL_MS - remaining);

    const screen = await mount(signer, [{ id: "a", storageKey: "k1.pdf" }]);
    // served from the cache, no new request
    expect(state.calls).toBe(1);
    expect(shown(screen, "a")).toBe("https://signed.test/k1.pdf?v=1");

    // Renewal lands when the HELD URL lapses — 5 s, not another ~14.5 min.
    await advance(remaining - 1);
    expect(state.calls).toBe(1);
    await advance(1);
    expect(state.calls).toBe(2);
    expect(shown(screen, "a")).toBe("https://signed.test/k1.pdf?v=2");
  });

  it("never hands out an already stale capability", async () => {
    const { state, signer } = countingSigner();
    await getSignedAttachmentCapability("k1.pdf", signer);
    await advance(ATTACHMENT_URL_RENEWAL_MS);

    const screen = await mount(signer, [{ id: "a", storageKey: "k1.pdf" }]);

    expect(state.calls).toBe(2);
    expect(shown(screen, "a")).toBe("https://signed.test/k1.pdf?v=2");
    expect(seen).not.toContain("a:https://signed.test/k1.pdf?v=1");
  });

  it("deduplicates concurrent consumers of the same object", async () => {
    const { state, signer } = countingSigner();
    const screen = await mount(signer, [
      { id: "a", storageKey: "k1.pdf" },
      { id: "b", storageKey: "k1.pdf" },
      { id: "c", storageKey: "k1.pdf" },
    ]);

    expect(state.calls).toBe(1);
    for (const id of ["a", "b", "c"]) {
      expect(shown(screen, id)).toBe("https://signed.test/k1.pdf?v=1");
    }
  });

  it("renews shared consumers with ONE request per horizon, not one each", async () => {
    const { state, signer } = countingSigner();
    const screen = await mount(signer, [
      { id: "a", storageKey: "k1.pdf" },
      { id: "b", storageKey: "k1.pdf" },
      { id: "c", storageKey: "k1.pdf" },
    ]);

    for (let cycle = 1; cycle <= 3; cycle += 1) {
      await advance(ATTACHMENT_URL_RENEWAL_MS);
      expect(state.calls).toBe(1 + cycle);
    }
    for (const id of ["a", "b", "c"]) {
      expect(shown(screen, id)).toBe("https://signed.test/k1.pdf?v=4");
    }
  });

  it("keeps a consumer that recovered from an error on the shared cache", async () => {
    const { state, signer } = countingSigner();
    const screen = await mount(signer, [{ id: "a", storageKey: "k1.pdf" }]);
    expect(state.calls).toBe(1);

    // one bounded reactive retry, e.g. an <img> onError
    await clickRefresh(screen, "a");
    expect(state.calls).toBe(2);

    // a second consumer arrives and shares the recovered capability
    await screen.rerender(
      <AttachmentSignerProvider signer={signer}>
        <Probe key="a" id="a" storageKey="k1.pdf" />
        <Probe key="b" id="b" storageKey="k1.pdf" />
      </AttachmentSignerProvider>,
    );
    await settle();
    expect(state.calls).toBe(2);

    // At the shared horizon both renew through ONE request: the recovered
    // consumer must not force a private re-sign on every later renewal.
    await advance(ATTACHMENT_URL_RENEWAL_MS);
    expect(state.calls).toBe(3);
    expect(shown(screen, "a")).toBe("https://signed.test/k1.pdf?v=3");
    expect(shown(screen, "b")).toBe("https://signed.test/k1.pdf?v=3");
  });

  it("does not loop when a renewal fails, and keeps the reactive retry bounded", async () => {
    const { state, signer } = countingSigner();
    const screen = await mount(signer, [{ id: "a", storageKey: "k1.pdf" }]);
    expect(state.calls).toBe(1);

    state.fail = true;
    await advance(ATTACHMENT_URL_RENEWAL_MS);
    expect(state.calls).toBe(2);
    expect(shown(screen, "a")).toBe("error");

    // no timer keeps re-signing a capability that cannot be obtained
    await advance(10 * ATTACHMENT_URL_RENEWAL_MS);
    expect(state.calls).toBe(2);

    // the reactive retry still works — exactly once
    await clickRefresh(screen, "a");
    expect(state.calls).toBe(3);
    await clickRefresh(screen, "a");
    await advance(10 * ATTACHMENT_URL_RENEWAL_MS);
    expect(state.calls).toBe(3);
    expect(shown(screen, "a")).toBe("error");
  });

  it("never caches a failed signing as success", async () => {
    const { state, signer } = countingSigner();
    state.fail = true;
    const first = await mount(signer, [{ id: "a", storageKey: "k1.pdf" }]);
    expect(shown(first, "a")).toBe("error");
    await first.unmount();

    state.fail = false;
    const second = await mount(signer, [{ id: "b", storageKey: "k1.pdf" }]);
    expect(state.calls).toBe(2);
    expect(shown(second, "b")).toBe("https://signed.test/k1.pdf?v=2");
  });
});
