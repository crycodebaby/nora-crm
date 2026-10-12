import { afterEach, describe, expect, it, vi } from "vitest";

import { getAuthProvider } from "./authProvider";
import {
  getSignedAttachmentCapability,
  resetAttachmentUrlCache,
} from "../../attachments/attachmentAccess";

/**
 * W8-E — derived attachment capabilities are per session.
 *
 * A signed URL minted for the employee who just logged out must never be
 * handed to whoever signs in next in the same tab. Logout clears the in-memory
 * capability cache, so the next session derives its own capability through
 * its own Storage policy check.
 */
const signOut = vi.hoisted(() => vi.fn(async () => ({ error: null })));
const signInWithPassword = vi.hoisted(() =>
  vi.fn(async () => ({ data: {}, error: null })),
);
vi.mock("./supabase", () => ({
  getSupabaseClient: () => ({
    auth: {
      signOut,
      signInWithPassword,
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
    },
  }),
}));

afterEach(() => {
  resetAttachmentUrlCache();
  signOut.mockClear();
  signInWithPassword.mockClear();
});

describe("logout clears the attachment capability cache", () => {
  it("forces the next session to derive a new capability", async () => {
    let calls = 0;
    const signer = async (key: string) => {
      calls += 1;
      return `https://signed.test/${key}?session=${calls}`;
    };

    const before = await getSignedAttachmentCapability("k1.pdf", signer);
    // cached within the same session
    await getSignedAttachmentCapability("k1.pdf", signer);
    expect(calls).toBe(1);

    await getAuthProvider().logout(undefined);
    expect(signOut).toHaveBeenCalled();

    const after = await getSignedAttachmentCapability("k1.pdf", signer);
    expect(calls).toBe(2);
    expect(after.url).not.toBe(before.url);
  });
});

/**
 * Alpha Storage 5 U-3 — the reset must also beat a signing request that is
 * already in flight when the session ends, and a new login in the same tab is
 * a boundary too.
 */
describe("auth boundaries invalidate in-flight attachment signing", () => {
  const deferredSigner = () => {
    const pending: ((url: string) => void)[] = [];
    const signer = (_key: string) =>
      new Promise<string>((resolve) => {
        pending.push(resolve);
      });
    return { pending, signer };
  };

  it("drops a capability whose signing resolves after logout", async () => {
    const { pending, signer } = deferredSigner();

    const inFlight = getSignedAttachmentCapability("k1.pdf", signer);
    await getAuthProvider().logout(undefined);
    pending[0]("https://signed.test/k1.pdf?session=old");

    await expect(inFlight).rejects.toThrow(/ended session/);

    // the next consumer signs through its own session
    const next = getSignedAttachmentCapability("k1.pdf", signer);
    expect(pending).toHaveLength(2);
    pending[1]("https://signed.test/k1.pdf?session=new");
    expect((await next).url).toBe("https://signed.test/k1.pdf?session=new");
  });

  it("treats a new login in the same tab as a boundary", async () => {
    let calls = 0;
    const signer = async (key: string) => {
      calls += 1;
      return `https://signed.test/${key}?session=${calls}`;
    };
    await getSignedAttachmentCapability("k1.pdf", signer);
    expect(calls).toBe(1);

    await getAuthProvider().login({ email: "b@nora.test", password: "x" });
    expect(signInWithPassword).toHaveBeenCalled();

    const after = await getSignedAttachmentCapability("k1.pdf", signer);
    expect(calls).toBe(2);
    expect(after.url).toBe("https://signed.test/k1.pdf?session=2");
  });
});
