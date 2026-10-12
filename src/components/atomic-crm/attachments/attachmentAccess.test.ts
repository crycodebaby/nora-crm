import {
  ATTACHMENT_URL_RENEWAL_MS,
  getSignedAttachmentCapability,
  getSignedAttachmentUrl,
  resetAttachmentUrlCache,
} from "./attachmentAccess";
import { ATTACHMENT_SIGNED_URL_TTL_SECONDS } from "../providers/commons/attachments";

/**
 * W8-E — the derivation cache.
 *
 * The properties under test are not performance niceties. Signing storms are
 * how a note with many attachments turns into a burst of Storage API calls,
 * and a cached failure is how a transient network error becomes a permanently
 * broken attachment until reload.
 */

beforeEach(() => resetAttachmentUrlCache());

describe("getSignedAttachmentUrl", () => {
  it("signs once and serves the cached URL afterwards", async () => {
    let calls = 0;
    const signer = async (key: string) => {
      calls += 1;
      return `https://signed.test/${key}?t=${calls}`;
    };

    expect(await getSignedAttachmentUrl("k1.png", signer)).toBe(
      "https://signed.test/k1.png?t=1",
    );
    expect(await getSignedAttachmentUrl("k1.png", signer)).toBe(
      "https://signed.test/k1.png?t=1",
    );
    expect(calls).toBe(1);
  });

  it("deduplicates concurrent requests for the same key", async () => {
    let calls = 0;
    let release: (url: string) => void = () => {};
    const signer = () => {
      calls += 1;
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    };

    const a = getSignedAttachmentUrl("k1.png", signer);
    const b = getSignedAttachmentUrl("k1.png", signer);
    const c = getSignedAttachmentUrl("k1.png", signer);
    release("https://signed.test/k1.png");

    expect(await Promise.all([a, b, c])).toEqual([
      "https://signed.test/k1.png",
      "https://signed.test/k1.png",
      "https://signed.test/k1.png",
    ]);
    // Ten components showing one image must not issue ten signing requests.
    expect(calls).toBe(1);
  });

  it("keeps different keys apart", async () => {
    const signer = async (key: string) => `https://signed.test/${key}`;
    expect(await getSignedAttachmentUrl("a.png", signer)).toBe(
      "https://signed.test/a.png",
    );
    expect(await getSignedAttachmentUrl("b.png", signer)).toBe(
      "https://signed.test/b.png",
    );
  });

  it("never caches a failure, so the next attempt can recover", async () => {
    let calls = 0;
    const signer = async (key: string) => {
      calls += 1;
      if (calls === 1) throw new Error("network");
      return `https://signed.test/${key}`;
    };

    await expect(getSignedAttachmentUrl("k1.png", signer)).rejects.toThrow(
      "network",
    );
    expect(await getSignedAttachmentUrl("k1.png", signer)).toBe(
      "https://signed.test/k1.png",
    );
    expect(calls).toBe(2);
  });

  it("re-signs when forced, which is the expiry recovery path", async () => {
    let calls = 0;
    const signer = async (key: string) => {
      calls += 1;
      return `https://signed.test/${key}?t=${calls}`;
    };

    expect(await getSignedAttachmentUrl("k1.png", signer)).toBe(
      "https://signed.test/k1.png?t=1",
    );
    expect(await getSignedAttachmentUrl("k1.png", signer, true)).toBe(
      "https://signed.test/k1.png?t=2",
    );
    expect(calls).toBe(2);
  });

  it("re-signs once the cached URL is past its refresh horizon", async () => {
    let calls = 0;
    const signer = async (key: string) => {
      calls += 1;
      return `https://signed.test/${key}?t=${calls}`;
    };
    const realNow = Date.now;
    try {
      let now = realNow();
      Date.now = () => now;

      await getSignedAttachmentUrl("k1.png", signer);
      // Just inside the horizon: still the cached value.
      now += (ATTACHMENT_SIGNED_URL_TTL_SECONDS - 60) * 1000;
      expect(await getSignedAttachmentUrl("k1.png", signer)).toBe(
        "https://signed.test/k1.png?t=1",
      );
      // Past it: a fresh capability rather than a URL about to die.
      now += 120 * 1000;
      expect(await getSignedAttachmentUrl("k1.png", signer)).toBe(
        "https://signed.test/k1.png?t=2",
      );
      expect(calls).toBe(2);
    } finally {
      Date.now = realNow;
    }
  });

  it("renews exactly when the cache stops serving, never later", async () => {
    // The proactive-renewal timer and the cache horizon must be the SAME
    // instant. If renewal fired later, a rendered anchor would briefly carry a
    // URL the cache already refuses to hand out — the stale-link bug this
    // mechanism exists to prevent. Asserted as an identity, not a magic number.
    let signedAt = 0;
    const signer = async (key: string) => {
      signedAt = Date.now();
      return `https://signed.test/${key}`;
    };
    const realNow = Date.now;
    try {
      let now = realNow();
      Date.now = () => now;
      await getSignedAttachmentUrl("k1.png", signer);
      const issuedAt = signedAt;

      // One millisecond before the renewal instant: still served from cache.
      now = issuedAt + ATTACHMENT_URL_RENEWAL_MS - 1;
      await getSignedAttachmentUrl("k1.png", signer);
      expect(signedAt).toBe(issuedAt);

      // At the renewal instant: a new capability.
      now = issuedAt + ATTACHMENT_URL_RENEWAL_MS;
      await getSignedAttachmentUrl("k1.png", signer);
      expect(signedAt).toBe(now);
    } finally {
      Date.now = realNow;
    }
  });

  it("never persists anything — the cache is process-local and clearable", async () => {
    const signer = async (key: string) => `https://signed.test/${key}`;
    await getSignedAttachmentUrl("k1.png", signer);
    resetAttachmentUrlCache();

    let calls = 0;
    const counting = async (key: string) => {
      calls += 1;
      return `https://signed.test/${key}`;
    };
    await getSignedAttachmentUrl("k1.png", counting);
    expect(calls).toBe(1);
  });
});

/**
 * A signer whose every request stays pending until the test settles it, so
 * the order "request starts -> boundary -> request resolves" is exact.
 */
const deferredSigner = () => {
  const requests: {
    key: string;
    resolve: (url: string) => void;
    reject: (error: Error) => void;
  }[] = [];
  const signer = (key: string) =>
    new Promise<string>((resolve, reject) => {
      requests.push({ key, resolve, reject });
    });
  return { requests, signer };
};

describe("force joins a signing already in flight (Alpha Storage 5 U-1)", () => {
  it("does not start a second request while one is pending", async () => {
    const { requests, signer } = deferredSigner();

    const first = getSignedAttachmentCapability("k1.png", signer);
    const forced = getSignedAttachmentCapability("k1.png", signer, true);
    expect(requests).toHaveLength(1);

    requests[0].resolve("https://signed.test/k1.png?v=1");
    expect((await first).url).toBe("https://signed.test/k1.png?v=1");
    expect((await forced).url).toBe("https://signed.test/k1.png?v=1");
    expect(requests).toHaveLength(1);
  });

  it("still re-signs when forced with nothing in flight", async () => {
    const { requests, signer } = deferredSigner();
    const first = getSignedAttachmentCapability("k1.png", signer);
    requests[0].resolve("https://signed.test/k1.png?v=1");
    await first;

    const forced = getSignedAttachmentCapability("k1.png", signer, true);
    expect(requests).toHaveLength(2);
    requests[1].resolve("https://signed.test/k1.png?v=2");
    expect((await forced).url).toBe("https://signed.test/k1.png?v=2");
  });
});

/**
 * Alpha Storage 5 U-3 — a reset on an auth boundary must also invalidate the
 * signing requests that are still in flight. Clearing the map alone is not
 * enough: an old promise resolving afterwards would write the previous
 * session's capability straight back into the fresh cache.
 */
describe("auth-boundary reset invalidates in-flight signing (U-3)", () => {
  it("never caches or hands out a capability that resolves after logout", async () => {
    const { requests, signer } = deferredSigner();

    const stale = getSignedAttachmentCapability("k1.png", signer);
    resetAttachmentUrlCache(); // logout while the request is pending
    requests[0].resolve("https://signed.test/k1.png?session=A");

    await expect(stale).rejects.toThrow(/ended session/);

    // A later consumer must not receive session A's URL: it signs afresh.
    const later = getSignedAttachmentCapability("k1.png", signer);
    expect(requests).toHaveLength(2);
    requests[1].resolve("https://signed.test/k1.png?session=B");
    expect((await later).url).toBe("https://signed.test/k1.png?session=B");
  });

  it("makes the next session sign for itself instead of joining the old request", async () => {
    const { requests, signer } = deferredSigner();

    const sessionA = getSignedAttachmentCapability("k1.png", signer);
    resetAttachmentUrlCache(); // new login in the same tab
    const sessionB = getSignedAttachmentCapability("k1.png", signer);
    expect(requests).toHaveLength(2);

    // B resolves first; A's late answer must neither replace nor evict it.
    requests[1].resolve("https://signed.test/k1.png?session=B");
    expect((await sessionB).url).toBe("https://signed.test/k1.png?session=B");
    requests[0].resolve("https://signed.test/k1.png?session=A");
    await expect(sessionA).rejects.toThrow(/ended session/);

    const again = await getSignedAttachmentCapability("k1.png", signer);
    expect(again.url).toBe("https://signed.test/k1.png?session=B");
    expect(requests).toHaveLength(2);
  });

  it("keeps a new session's in-flight request when the old one fails late", async () => {
    const { requests, signer } = deferredSigner();

    const sessionA = getSignedAttachmentCapability("k1.png", signer);
    resetAttachmentUrlCache();
    const sessionB = getSignedAttachmentCapability("k1.png", signer);

    // The stale failure settles cleanly (awaited, no unhandled rejection)
    // and does not evict session B's pending entry.
    requests[0].reject(new Error("JWT expired"));
    await expect(sessionA).rejects.toThrow("JWT expired");

    const joined = getSignedAttachmentCapability("k1.png", signer);
    expect(requests).toHaveLength(2);
    requests[1].resolve("https://signed.test/k1.png?session=B");
    expect((await sessionB).url).toBe("https://signed.test/k1.png?session=B");
    expect((await joined).url).toBe("https://signed.test/k1.png?session=B");
    // no retry storm: two requests in total, one per session
    expect(requests).toHaveLength(2);
  });

  it("leaves ordinary dedupe and caching untouched within one session", async () => {
    const { requests, signer } = deferredSigner();
    resetAttachmentUrlCache();

    const a = getSignedAttachmentCapability("k1.png", signer);
    const b = getSignedAttachmentCapability("k1.png", signer);
    expect(requests).toHaveLength(1);
    requests[0].resolve("https://signed.test/k1.png?v=1");
    expect((await a).url).toBe("https://signed.test/k1.png?v=1");
    expect((await b).url).toBe("https://signed.test/k1.png?v=1");

    expect((await getSignedAttachmentCapability("k1.png", signer)).url).toBe(
      "https://signed.test/k1.png?v=1",
    );
    expect(requests).toHaveLength(1);
  });
});
