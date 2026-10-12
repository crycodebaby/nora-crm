import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { StoryWrapper } from "@/test/StoryWrapper";
import {
  getSignedAttachmentCapability,
  resetAttachmentUrlCache,
} from "../attachments/attachmentAccess";
import { StartPage } from "./StartPage";

/**
 * Alpha Storage 3C F-5 — the invite code establishes a session through
 * `supabase.auth.verifyOtp`, NOT through `authProvider.login`. That path must
 * be a session boundary for derived attachment capabilities too: whatever
 * session A cached (or is still signing) in this document must never be
 * handed to session B.
 */
const onVerifyOtp = vi.hoisted(() => ({ current: async () => {} }));
const verifyOtp = vi.hoisted(() =>
  vi.fn(async () => {
    await onVerifyOtp.current();
    return { data: { session: {} }, error: null };
  }),
);
vi.mock("@/components/atomic-crm/providers/supabase/supabase", () => ({
  getSupabaseClient: () => ({ auth: { verifyOtp } }),
}));

afterEach(() => {
  resetAttachmentUrlCache();
  verifyOtp.mockClear();
  onVerifyOtp.current = async () => {};
});

const activateInvite = async () => {
  const screen = await render(
    <StoryWrapper initialEntries={["/login?mode=einladung"]}>
      <StartPage />
    </StoryWrapper>,
  );
  await screen
    .getByLabelText(/Geschäftliche E-Mail-Adresse/)
    .fill("b@nora.test");
  await screen.getByLabelText(/Einmalcode aus der Einladung/).fill("123456");
  await screen.getByRole("button", { name: "Einladung prüfen" }).click();
  await expect.poll(() => verifyOtp.mock.calls.length).toBe(1);
};

describe("invite-code sign-in is an attachment capability boundary", () => {
  it("session B signs fresh instead of receiving session A's cached capability", async () => {
    let calls = 0;
    const signer = async (key: string) => {
      calls += 1;
      return `https://signed.test/${key}?session=${calls}`;
    };
    const a = await getSignedAttachmentCapability("k1.pdf", signer);
    expect(calls).toBe(1);

    await activateInvite();

    const b = await getSignedAttachmentCapability("k1.pdf", signer);
    expect(calls).toBe(2);
    expect(b.url).not.toBe(a.url);
  });

  it("the reset happens BEFORE the new session is established", async () => {
    let calls = 0;
    const signer = async (key: string) => {
      calls += 1;
      return `https://signed.test/${key}?session=${calls}`;
    };
    await getSignedAttachmentCapability("k1.pdf", signer);
    let cachedWhenSessionStarts: boolean | undefined;
    onVerifyOtp.current = async () => {
      const before = calls;
      await getSignedAttachmentCapability("k1.pdf", signer);
      cachedWhenSessionStarts = calls === before;
    };

    await activateInvite();

    expect(cachedWhenSessionStarts).toBe(false);
  });

  it("a signing request of session A that resolves during the switch is discarded", async () => {
    const pending: ((url: string) => void)[] = [];
    const signer = (_key: string) =>
      new Promise<string>((resolve) => pending.push(resolve));

    const outcome = getSignedAttachmentCapability("k1.pdf", signer).then(
      (capability) => capability.url,
      (error: Error) => error.message,
    );
    onVerifyOtp.current = async () => {
      pending[0]("https://signed.test/k1.pdf?session=A");
    };
    await activateInvite();
    expect(await outcome).toMatch(/ended session/);

    const next = getSignedAttachmentCapability("k1.pdf", signer);
    expect(pending).toHaveLength(2);
    pending[1]("https://signed.test/k1.pdf?session=B");
    expect((await next).url).toBe("https://signed.test/k1.pdf?session=B");
  });
});
