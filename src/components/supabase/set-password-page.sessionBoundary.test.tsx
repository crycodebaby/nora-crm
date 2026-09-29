import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { StoryWrapper } from "@/test/StoryWrapper";
import {
  getSignedAttachmentCapability,
  resetAttachmentUrlCache,
} from "@/components/atomic-crm/attachments/attachmentAccess";
import { SetPasswordPage } from "./set-password-page";

/**
 * Alpha Storage 3C F-5 — the access link establishes a session through
 * `supabase.auth.setSession`, not through `authProvider.login`. The
 * attachment capabilities of any earlier session in this document must be
 * gone BEFORE that session exists.
 */
const probe = vi.hoisted(() => ({
  onSetSession: async () => {},
  setSessionCalls: 0,
}));
vi.mock("@/components/atomic-crm/providers/supabase/supabase", () => ({
  getSupabaseClient: () => ({
    auth: {
      setSession: async () => {
        probe.setSessionCalls += 1;
        await probe.onSetSession();
        return { error: null };
      },
      getSession: async () => ({ data: { session: null } }),
      getUser: async () => ({ data: { user: null } }),
    },
  }),
}));

beforeEach(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("VITE_SB_PUBLISHABLE_KEY", "sb_publishable_test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetAttachmentUrlCache();
  probe.setSessionCalls = 0;
  probe.onSetSession = async () => {};
});

describe("access-link sign-in is an attachment capability boundary", () => {
  it("drops the previous session's capabilities before setSession", async () => {
    let calls = 0;
    const signer = async (key: string) => {
      calls += 1;
      return `https://signed.test/${key}?session=${calls}`;
    };
    await getSignedAttachmentCapability("k1.pdf", signer);
    let cachedWhenSessionStarts: boolean | undefined;
    probe.onSetSession = async () => {
      const before = calls;
      await getSignedAttachmentCapability("k1.pdf", signer);
      cachedWhenSessionStarts = calls === before;
    };

    await render(
      <StoryWrapper
        initialEntries={["/set-password?access_token=at-1&refresh_token=rt-1"]}
      >
        <SetPasswordPage />
      </StoryWrapper>,
    );

    await expect.poll(() => probe.setSessionCalls).toBe(1);
    expect(cachedWhenSessionStarts).toBe(false);
  });
});
