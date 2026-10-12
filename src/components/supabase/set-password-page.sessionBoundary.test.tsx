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
      // Stops the submit right after its session step; the reset under test
      // happens before that.
      updateUser: async () => ({ error: { message: "stop after setSession" } }),
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

/**
 * Alpha Storage 3D LOW-2D — the SUBMIT fallback of the access link: when the
 * bootstrap left no session, `submitPassword` establishes one itself through
 * `setSession`. Session A's cached AND in-flight capabilities must be gone
 * before that session B exists.
 */
describe("the set-password submit fallback is an attachment capability boundary", () => {
  it("resets session-scoped caches BEFORE its own setSession", async () => {
    const screen = await render(
      <StoryWrapper
        initialEntries={["/set-password?access_token=at-1&refresh_token=rt-1"]}
      >
        <SetPasswordPage />
      </StoryWrapper>,
    );
    await expect.poll(() => probe.setSessionCalls).toBe(1); // bootstrap
    await screen.getByRole("button", { name: "Zugang einrichten" }).click();
    await expect
      .element(screen.getByRole("button", { name: "Passwort speichern" }))
      .toBeVisible();

    // Session A (established by the bootstrap): one cached capability and
    // one whose signing is still in flight.
    await getSignedAttachmentCapability(
      "cached.pdf",
      async (key) => `https://signed.test/${key}?session=A`,
    );
    let releaseA = () => {};
    const inFlightA = getSignedAttachmentCapability(
      "inflight.pdf",
      () =>
        new Promise<string>((resolve) => {
          releaseA = () =>
            resolve("https://signed.test/inflight.pdf?session=A");
        }),
    );

    // Session B asks for both at the moment the submit fallback's
    // setSession runs.
    const signedForB: string[] = [];
    const signerB = async (key: string) => {
      signedForB.push(key);
      return `https://signed.test/${key}?session=B`;
    };
    let cachedUrlAtSubmitSetSession: string | undefined;
    probe.onSetSession = async () => {
      if (probe.setSessionCalls !== 2) return;
      cachedUrlAtSubmitSetSession = (
        await getSignedAttachmentCapability("cached.pdf", signerB)
      ).url;
      // not awaited: joining A's request would never resolve here
      void getSignedAttachmentCapability("inflight.pdf", signerB).catch(
        () => {},
      );
    };

    const password = "sehr-langes-persoenliches-passwort";
    await screen
      .getByRole("textbox", { name: "Passwort", exact: true })
      .fill(password);
    await screen
      .getByRole("textbox", { name: "Passwort wiederholen", exact: true })
      .fill(password);
    await screen.getByRole("checkbox").click();
    await screen.getByRole("button", { name: "Passwort speichern" }).click();

    await expect.poll(() => probe.setSessionCalls).toBe(2); // submit fallback
    await expect.poll(() => cachedUrlAtSubmitSetSession).toBeDefined();
    expect(cachedUrlAtSubmitSetSession).toBe(
      "https://signed.test/cached.pdf?session=B",
    );
    expect(signedForB).toEqual(["cached.pdf", "inflight.pdf"]);

    // A's signing resolving late is discarded, never handed to session B.
    releaseA();
    await expect(inFlightA).rejects.toThrow(/from an ended session/);
    expect(
      (await getSignedAttachmentCapability("inflight.pdf", signerB)).url,
    ).toBe("https://signed.test/inflight.pdf?session=B");
  });
});
