import { render } from "vitest-browser-react";

import { NoteAttachments } from "./NoteAttachments";
import { NoteAttachmentsRecovery } from "./NoteAttachmentsRecovery";
import {
  recoveryAttachments,
  verifiedAttachments,
} from "../providers/commons/noteAttachmentReadModel";
import { AttachmentSignerProvider } from "../attachments/useAttachmentUrl";
import { resetAttachmentUrlCache } from "../attachments/attachmentAccess";
import { StoryWrapper } from "@/test/StoryWrapper";
import type { AttachmentNote } from "../types";

/**
 * W8-E — note attachments are reached through a DERIVED capability.
 *
 * Every fixture below deliberately carries a legacy `src` as well as a
 * `path`, because that is exactly what Production data looks like. The point
 * of most of these tests is that the `src` is never what ends up in the DOM.
 */

const SIGNED = (key: string) => `https://signed.test/${key}?token=abc`;

/** A deterministic stand-in for the Supabase signer. */
const fakeSigner = async (storageKey: string) => SIGNED(storageKey);

const attachment = (
  path: string,
  title: string,
  type: string,
): AttachmentNote =>
  ({ path, title, type, src: `https://cdn.test/${path}` }) as AttachmentNote;

const IMAGE = attachment("k1.png", "photo.png", "image/png");
const DOCUMENT = attachment("k2.pdf", "angebot.pdf", "application/pdf");

const withSigner = (children: React.ReactNode, signer = fakeSigner) => (
  <StoryWrapper>
    <AttachmentSignerProvider signer={signer}>
      {children}
    </AttachmentSignerProvider>
  </StoryWrapper>
);

const anchors = (screen: { container: HTMLElement }) =>
  [...screen.container.querySelectorAll("a")].map((a) =>
    a.getAttribute("href"),
  );

beforeEach(() => resetAttachmentUrlCache());

/**
 * W8-C S5 — the host decides trust, the renderer only presents. This mirrors
 * what `Note.tsx` / `NoteShowPage.tsx` do.
 */
const NoteAttachmentsHost = ({ note }: { note: any }) => {
  const verified = verifiedAttachments(note);
  return verified ? (
    <NoteAttachments attachments={verified} />
  ) : (
    <NoteAttachmentsRecovery attachments={recoveryAttachments(note)} />
  );
};

describe("NoteAttachments (verified renderer)", () => {
  it("renders images inline and documents as links, both from a derived URL", async () => {
    const screen = await render(
      withSigner(<NoteAttachments attachments={[IMAGE, DOCUMENT]} />),
    );

    await expect.element(screen.getByAltText("photo.png")).toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "angebot.pdf" }))
      .toBeVisible();

    expect(screen.container.querySelector("img")?.getAttribute("src")).toBe(
      SIGNED("k1.png"),
    );
    expect(anchors(screen)).toEqual([SIGNED("k1.png"), SIGNED("k2.pdf")]);
  });

  it("renders nothing for a verified but empty note", async () => {
    const screen = await render(
      withSigner(<NoteAttachments attachments={[]} />),
    );

    expect(screen.container.querySelector("img")).toBeNull();
    expect(screen.container.querySelector("a")).toBeNull();
  });

  it("signs each distinct object exactly once, even across renderers", async () => {
    let calls = 0;
    const counting = async (key: string) => {
      calls += 1;
      return SIGNED(key);
    };

    // Documents only. An <img> whose URL does not resolve fires `onError`,
    // which deliberately re-derives access (see the expiry test below) and
    // would make this a test of two different things at once.
    const OTHER = attachment("k3.pdf", "aufmass.pdf", "application/pdf");
    const screen = await render(
      withSigner(
        <>
          <NoteAttachments attachments={[DOCUMENT, OTHER]} />
          <NoteAttachments attachments={[DOCUMENT, OTHER]} />
        </>,
        counting,
      ),
    );

    // Both renderers show the same two objects: four anchors, two objects.
    await expect
      .poll(() => screen.container.querySelectorAll("a").length)
      .toBe(4);
    expect(calls).toBe(2);
    expect(anchors(screen)).toEqual([
      SIGNED("k2.pdf"),
      SIGNED("k3.pdf"),
      SIGNED("k2.pdf"),
      SIGNED("k3.pdf"),
    ]);
  });

  it("re-derives access when a rendered capability no longer resolves", async () => {
    // The expiry recovery path. A tab left open past the TTL renders an image
    // whose signed URL is dead; the browser fires `onError` and the component
    // asks for a fresh capability instead of showing a permanently broken
    // image until reload.
    const keys: string[] = [];
    const signer = async (key: string) => {
      keys.push(key);
      // Never resolvable, so `onError` fires — which is the point.
      return `https://signed.test/${key}?token=${keys.length}`;
    };

    const screen = await render(
      withSigner(<NoteAttachments attachments={[IMAGE]} />, signer),
    );

    await expect.poll(() => keys.length).toBeGreaterThanOrEqual(2);
    // Each retry is a NEW capability, not the cached dead one.
    expect(keys.every((key) => key === "k1.png")).toBe(true);
    expect(screen.container.querySelector("img")?.getAttribute("src")).not.toBe(
      "https://signed.test/k1.png?token=1",
    );
  });

  it("shows a placeholder instead of a broken image when signing fails", async () => {
    const screen = await render(
      withSigner(<NoteAttachments attachments={[IMAGE]} />, async () => {
        throw new Error("no session");
      }),
    );

    await expect.element(screen.getByText(/not available/i)).toBeVisible();
    expect(screen.container.querySelector("img")).toBeNull();
    expect(anchors(screen)).toEqual([]);
  });

  it("does not link a document whose access could not be derived", async () => {
    const screen = await render(
      withSigner(<NoteAttachments attachments={[DOCUMENT]} />, async () => {
        throw new Error("no session");
      }),
    );

    await expect.element(screen.getByText("angebot.pdf")).toBeVisible();
    expect(anchors(screen)).toEqual([]);
  });
});

describe("verified renderer trust boundary (W8-C S5)", () => {
  it("shows a verified note through the inline image renderer", async () => {
    const screen = await render(
      withSigner(
        <NoteAttachmentsHost
          note={{ attachments: [IMAGE], attachments_state: "ok" }}
        />,
      ),
    );

    await expect.element(screen.getByAltText("photo.png")).toBeVisible();
  });

  it("never renders an unverified image — recovery takes over", async () => {
    const screen = await render(
      withSigner(
        <NoteAttachmentsHost
          note={{
            attachments: null,
            attachments_state: "drift",
            attachments_unverified_legacy: [IMAGE, DOCUMENT],
          }}
        />,
      ),
    );

    await expect.element(screen.getByText("angebot.pdf")).toBeVisible();
    // the whole point: no <img> may be produced from quarantined data
    expect(screen.container.querySelector("img")).toBeNull();
  });

  it("does not pass recovery data to the verified renderer", async () => {
    const note = {
      attachments: null,
      attachments_state: "unverified" as const,
      attachments_unverified_legacy: [IMAGE],
    };

    // `null` is what keeps NoteAttachments from ever being called
    expect(verifiedAttachments(note)).toBeNull();
    expect(recoveryAttachments(note)).toEqual([IMAGE]);
  });
});

/**
 * W8-E Decision B — a degraded attachment mints NO content capability.
 *
 * Before W8-E the recovery view still offered an "open file" link built from
 * the legacy public `src`. Once the bucket is private that URL is dead, and
 * keeping it would be an alternate route around the very gate that declared
 * the record untrustworthy. The affordance is gone on purpose.
 */
describe("NoteAttachmentsRecovery is metadata-only", () => {
  it("lists the file names and offers no link at all", async () => {
    const screen = await render(
      withSigner(<NoteAttachmentsRecovery attachments={[IMAGE, DOCUMENT]} />),
    );

    await expect.element(screen.getByText("angebot.pdf")).toBeVisible();
    await expect.element(screen.getByText("photo.png")).toBeVisible();
    expect(anchors(screen)).toEqual([]);
  });

  it("is read-only: no image, no file input, no remove control", async () => {
    const screen = await render(
      withSigner(<NoteAttachmentsRecovery attachments={[IMAGE, DOCUMENT]} />),
    );

    await expect.element(screen.getByText("angebot.pdf")).toBeVisible();
    expect(screen.container.querySelector("img")).toBeNull();
    expect(screen.container.querySelector('input[type="file"]')).toBeNull();
    expect(screen.container.querySelector("input")).toBeNull();
    expect(screen.container.querySelector("button")).toBeNull();
  });

  it("never signs — a degraded record must not reach private storage", async () => {
    let calls = 0;
    const counting = async (key: string) => {
      calls += 1;
      return SIGNED(key);
    };

    const screen = await render(
      withSigner(
        <NoteAttachmentsRecovery attachments={[IMAGE, DOCUMENT]} />,
        counting,
      ),
    );

    await expect.element(screen.getByText("angebot.pdf")).toBeVisible();
    expect(calls).toBe(0);
  });

  it("warns that the attachments could not be verified", async () => {
    const screen = await render(
      withSigner(<NoteAttachmentsRecovery attachments={[DOCUMENT]} />),
    );

    await expect
      .element(screen.getByText(/could not be verified/i))
      .toBeVisible();
  });

  it("renders nothing when there is nothing to recover", async () => {
    const screen = await render(
      withSigner(<NoteAttachmentsRecovery attachments={[]} />),
    );

    expect(screen.container.querySelector("a")).toBeNull();
    expect(screen.container.querySelector("svg")).toBeNull();
  });
});

/**
 * Security closure 2026-09-27, carried forward and tightened by W8-E.
 *
 * `attachment.src` is legacy note JSON and attacker-influenceable. Before
 * W8-E the defence was `safeHref`. After W8-E there is a stronger one for
 * anything that has a storage key: the key wins, so the hostile `src` is
 * never consulted in the first place. Both halves are asserted — the second
 * because `safeHref` still guards every value that has NO key.
 *
 * NOTE ON THE ASSERTIONS. `render()` resolves before React has committed, so a
 * bare `container.querySelector(...)` runs against an empty div and would pass
 * no matter what the component does. Every check below therefore first awaits
 * something that must be on screen, and only then asserts what must be absent.
 */
const hostile = (src: string, title: string, type: string): AttachmentNote =>
  ({ path: `p-${title}`, title, type, src }) as AttachmentNote;

const keylessHostile = (
  src: string,
  title: string,
  type: string,
): AttachmentNote => ({ title, type, src }) as AttachmentNote;

const UNSAFE_SCHEMES: [string, string][] = [
  ["javascript:", "javascript:alert(document.cookie)"],
  ["mixed-case JavaScript", "JaVaScRiPt:alert(1)"],
  ["javascript: with padding", "   javascript:alert(1)   "],
  ["data:", "data:text/html,<script>alert(1)</script>"],
  ["vbscript:", "vbscript:msgbox(1)"],
  ["file:", "file:///etc/passwd"],
];

describe("attachment links never carry an unsafe scheme", () => {
  describe("verified renderer, attachment WITH a storage key", () => {
    it.each(UNSAFE_SCHEMES)(
      "ignores a hostile %s src and links the derived URL instead",
      async (_label, src) => {
        const screen = await render(
          withSigner(
            <NoteAttachments
              attachments={[hostile(src, "rechnung.pdf", "application/pdf")]}
            />,
          ),
        );

        await expect
          .element(screen.getByRole("link", { name: "rechnung.pdf" }))
          .toBeVisible();
        expect(anchors(screen)).toEqual([SIGNED("p-rechnung.pdf")]);
      },
    );

    it.each(UNSAFE_SCHEMES)(
      "renders an image with a hostile %s src from the derived URL",
      async (_label, src) => {
        const screen = await render(
          withSigner(
            <NoteAttachments
              attachments={[hostile(src, "bild.png", "image/png")]}
            />,
          ),
        );

        await expect.element(screen.getByAltText("bild.png")).toBeVisible();
        expect(screen.container.querySelector("img")?.getAttribute("src")).toBe(
          SIGNED("p-bild.png"),
        );
        expect(anchors(screen)).toEqual([SIGNED("p-bild.png")]);
      },
    );
  });

  describe("verified renderer, attachment WITHOUT a storage key", () => {
    it.each(UNSAFE_SCHEMES)(
      "renders a document with %s as text, not a link",
      async (_label, src) => {
        const screen = await render(
          withSigner(
            <NoteAttachments
              attachments={[
                keylessHostile(src, "rechnung.pdf", "application/pdf"),
              ]}
            />,
          ),
        );

        await expect.element(screen.getByText("rechnung.pdf")).toBeVisible();
        expect(anchors(screen)).toEqual([]);
      },
    );

    it("rejects an attacker-supplied absolute URL as a preview source", async () => {
      // No key, ordinary https: `safeHref` lets it through as a plain URL —
      // exactly as a foreign avatar URL is allowed. What it must NOT do is
      // become a Nora storage capability.
      const screen = await render(
        withSigner(
          <NoteAttachments
            attachments={[
              keylessHostile(
                "https://evil.test/steal.pdf",
                "extern.pdf",
                "application/pdf",
              ),
            ]}
          />,
        ),
      );

      await expect
        .element(screen.getByRole("link", { name: "extern.pdf" }))
        .toBeVisible();
      expect(anchors(screen)).toEqual(["https://evil.test/steal.pdf"]);
    });

    it("never turns a signed URL supplied as record input into a key", async () => {
      // A signed URL is a temporary capability, never an identity. Supplied as
      // persisted `src` it is just another foreign URL; it must not be mistaken
      // for a storage key and must not be re-derived.
      const injected =
        "https://project.supabase.co/storage/v1/object/sign/attachments/k9.pdf?token=abc.def-ghi";
      let calls = 0;
      const screen = await render(
        withSigner(
          <NoteAttachments
            attachments={[
              keylessHostile(injected, "alt.pdf", "application/pdf"),
            ]}
          />,
          async (key) => {
            calls += 1;
            return SIGNED(key);
          },
        ),
      );

      await expect
        .element(screen.getByRole("link", { name: "alt.pdf" }))
        .toBeVisible();
      expect(anchors(screen)).toEqual([injected]);
      expect(calls).toBe(0);
    });

    it("still links the safe attachment when a hostile one sits next to it", async () => {
      const screen = await render(
        withSigner(
          <NoteAttachments
            attachments={[
              keylessHostile(
                "javascript:alert(1)",
                "boese.pdf",
                "application/pdf",
              ),
              DOCUMENT,
            ]}
          />,
        ),
      );

      await expect
        .element(screen.getByRole("link", { name: "angebot.pdf" }))
        .toBeVisible();
      await expect.element(screen.getByText("boese.pdf")).toBeVisible();
      expect(anchors(screen)).toEqual([SIGNED("k2.pdf")]);
    });
  });

  describe("recovery renderer", () => {
    it.each(UNSAFE_SCHEMES)(
      "renders quarantined %s as text, not a link",
      async (_label, src) => {
        const screen = await render(
          withSigner(
            <NoteAttachmentsRecovery
              attachments={[hostile(src, "alt-anhang.pdf", "application/pdf")]}
            />,
          ),
        );

        await expect.element(screen.getByText("alt-anhang.pdf")).toBeVisible();
        expect(anchors(screen)).toEqual([]);
      },
    );

    it("does not link an otherwise perfectly normal HTTPS value either", async () => {
      // The legacy `src` is no longer an escape hatch: degradation removes the
      // affordance regardless of how harmless the stored URL looks.
      const screen = await render(
        withSigner(<NoteAttachmentsRecovery attachments={[DOCUMENT]} />),
      );

      await expect.element(screen.getByText("angebot.pdf")).toBeVisible();
      expect(anchors(screen)).toEqual([]);
    });
  });
});
