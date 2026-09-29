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
vi.mock("./supabase", () => ({
  getSupabaseClient: () => ({
    auth: {
      signOut,
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
