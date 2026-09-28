import {
  ATTACHMENT_URL_RENEWAL_MS,
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
