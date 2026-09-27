import { render } from "vitest-browser-react";

import { NoteAttachments } from "./NoteAttachments";
import { NoteAttachmentsRecovery } from "./NoteAttachmentsRecovery";
import {
  recoveryAttachments,
  verifiedAttachments,
} from "../providers/commons/noteAttachmentReadModel";
import { StoryWrapper } from "@/test/StoryWrapper";
import type { AttachmentNote } from "../types";

const attachment = (
  path: string,
  title: string,
  type: string,
): AttachmentNote =>
  ({ path, title, type, src: `https://cdn.test/${path}` }) as AttachmentNote;

const IMAGE = attachment("k1.png", "photo.png", "image/png");
const DOCUMENT = attachment("k2.pdf", "angebot.pdf", "application/pdf");

/**
 * W8-C S5 — the host decides trust, the renderer only presents. This mirrors
 * what `Note.tsx` / `NoteShowPage.tsx` do.
 */
const NoteAttachmentsHost = ({ note }: { note: any }) => {
  const verified = verifiedAttachments(note);
  return (
    <StoryWrapper>
      {verified ? (
        <NoteAttachments attachments={verified} />
      ) : (
        <NoteAttachmentsRecovery attachments={recoveryAttachments(note)} />
      )}
    </StoryWrapper>
  );
};

describe("NoteAttachments (verified renderer)", () => {
  it("renders images inline and documents as links", async () => {
    const screen = await render(
      <StoryWrapper>
        <NoteAttachments attachments={[IMAGE, DOCUMENT]} />
      </StoryWrapper>,
    );

    await expect.element(screen.getByAltText("photo.png")).toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "angebot.pdf" }))
      .toBeVisible();
  });

  it("renders nothing for a verified but empty note", async () => {
    const screen = await render(
      <StoryWrapper>
        <NoteAttachments attachments={[]} />
      </StoryWrapper>,
    );

    expect(screen.container.querySelector("img")).toBeNull();
    expect(screen.container.querySelector("a")).toBeNull();
  });
});

describe("verified renderer trust boundary (W8-C S5)", () => {
  it("shows a verified note through the inline image renderer", async () => {
    const screen = await render(
      <NoteAttachmentsHost
        note={{ attachments: [IMAGE], attachments_state: "ok" }}
      />,
    );

    await expect.element(screen.getByAltText("photo.png")).toBeVisible();
  });

  it("never renders an unverified image — recovery takes over", async () => {
    const screen = await render(
      <NoteAttachmentsHost
        note={{
          attachments: null,
          attachments_state: "drift",
          attachments_unverified_legacy: [IMAGE, DOCUMENT],
        }}
      />,
    );

    // the whole point: no <img> may be produced from quarantined data
    expect(screen.container.querySelector("img")).toBeNull();
    await expect
      .element(screen.getByRole("link", { name: "photo.png" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "angebot.pdf" }))
      .toBeVisible();
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

describe("NoteAttachmentsRecovery", () => {
  it("is read-only: no file input, no image, no remove control", async () => {
    const screen = await render(
      <StoryWrapper>
        <NoteAttachmentsRecovery attachments={[IMAGE, DOCUMENT]} />
      </StoryWrapper>,
    );

    await expect
      .element(screen.getByRole("link", { name: "angebot.pdf" }))
      .toBeVisible();
    expect(screen.container.querySelector("img")).toBeNull();
    expect(screen.container.querySelector('input[type="file"]')).toBeNull();
    expect(screen.container.querySelector("input")).toBeNull();
    expect(screen.container.querySelector("button")).toBeNull();
  });

  it("warns that the attachments could not be verified", async () => {
    const screen = await render(
      <StoryWrapper>
        <NoteAttachmentsRecovery attachments={[DOCUMENT]} />
      </StoryWrapper>,
    );

    await expect
      .element(screen.getByText(/could not be verified/i))
      .toBeVisible();
  });

  it("renders nothing when there is nothing to recover", async () => {
    const screen = await render(
      <StoryWrapper>
        <NoteAttachmentsRecovery attachments={[]} />
      </StoryWrapper>,
    );

    expect(screen.container.querySelector("a")).toBeNull();
    expect(screen.container.querySelector("svg")).toBeNull();
  });
});
/**
 * Security closure 2026-09-27 — stored XSS through a note attachment link.
 *
 * `attachment.src` is legacy note JSON. It is attacker-influenceable: anyone
 * who could write a note, any import, and every historical row predating the
 * relational attachment foundation can carry an arbitrary string. Rendering it
 * straight into `href` meant a stored `javascript:` value executed in the
 * signed-in employee's session on click — including in the RECOVERY view,
 * whose input is by definition unverified.
 *
 * The rule: an unsafe scheme must not produce a clickable anchor anywhere. The
 * title still renders, so nothing silently disappears from the UI.
 *
 * NOTE ON THE ASSERTIONS. `render()` resolves before React has committed, so a
 * bare `container.querySelector(...)` runs against an empty div and would pass
 * no matter what the component does. Every check below therefore first awaits
 * something that must be on screen, and only then asserts what must be absent.
 */
const hostile = (src: string, title: string, type: string): AttachmentNote =>
  ({ path: `p-${title}`, title, type, src }) as AttachmentNote;

const UNSAFE_SCHEMES: [string, string][] = [
  ["javascript:", "javascript:alert(document.cookie)"],
  ["mixed-case JavaScript", "JaVaScRiPt:alert(1)"],
  ["javascript: with padding", "   javascript:alert(1)   "],
  ["data:", "data:text/html,<script>alert(1)</script>"],
  ["vbscript:", "vbscript:msgbox(1)"],
  ["file:", "file:///etc/passwd"],
];

const anchors = (screen: { container: HTMLElement }) =>
  [...screen.container.querySelectorAll("a")].map((a) =>
    a.getAttribute("href"),
  );

describe("attachment links never carry an unsafe scheme", () => {
  describe("verified renderer", () => {
    it.each(UNSAFE_SCHEMES)(
      "renders a document with %s as text, not a link",
      async (_label, src) => {
        const screen = await render(
          <StoryWrapper>
            <NoteAttachments
              attachments={[hostile(src, "rechnung.pdf", "application/pdf")]}
            />
          </StoryWrapper>,
        );

        // the title is on screen => the component has committed
        await expect.element(screen.getByText("rechnung.pdf")).toBeVisible();
        expect(anchors(screen)).toEqual([]);
      },
    );

    it.each(UNSAFE_SCHEMES)(
      "does not wrap an image with %s in a clickable anchor",
      async (_label, src) => {
        const screen = await render(
          <StoryWrapper>
            <NoteAttachments
              attachments={[hostile(src, "bild.png", "image/png")]}
            />
          </StoryWrapper>,
        );

        // the preview is still shown, it just must not be clickable
        await expect.element(screen.getByAltText("bild.png")).toBeVisible();
        expect(anchors(screen)).toEqual([]);
      },
    );

    it("keeps a normal HTTPS attachment link working", async () => {
      const screen = await render(
        <StoryWrapper>
          <NoteAttachments attachments={[DOCUMENT]} />
        </StoryWrapper>,
      );

      await expect
        .element(screen.getByRole("link", { name: "angebot.pdf" }))
        .toBeVisible();
      expect(anchors(screen)).toEqual(["https://cdn.test/k2.pdf"]);
    });

    it("keeps a legacy signed HTTPS URL with query parameters intact", async () => {
      const url =
        "https://project.supabase.co/storage/v1/object/sign/attachments/k9.pdf?token=abc.def-ghi";
      const screen = await render(
        <StoryWrapper>
          <NoteAttachments
            attachments={[hostile(url, "alt.pdf", "application/pdf")]}
          />
        </StoryWrapper>,
      );

      await expect
        .element(screen.getByRole("link", { name: "alt.pdf" }))
        .toBeVisible();
      expect(anchors(screen)).toEqual([url]);
    });

    it("still links the safe attachment when a hostile one sits next to it", async () => {
      const screen = await render(
        <StoryWrapper>
          <NoteAttachments
            attachments={[
              hostile("javascript:alert(1)", "boese.pdf", "application/pdf"),
              DOCUMENT,
            ]}
          />
        </StoryWrapper>,
      );

      await expect
        .element(screen.getByRole("link", { name: "angebot.pdf" }))
        .toBeVisible();
      await expect.element(screen.getByText("boese.pdf")).toBeVisible();
      expect(anchors(screen)).toEqual(["https://cdn.test/k2.pdf"]);
    });
  });

  describe("recovery renderer", () => {
    it.each(UNSAFE_SCHEMES)(
      "renders quarantined %s as text, not a link",
      async (_label, src) => {
        const screen = await render(
          <StoryWrapper>
            <NoteAttachmentsRecovery
              attachments={[hostile(src, "alt-anhang.pdf", "application/pdf")]}
            />
          </StoryWrapper>,
        );

        await expect.element(screen.getByText("alt-anhang.pdf")).toBeVisible();
        expect(anchors(screen)).toEqual([]);
      },
    );

    it("keeps a normal HTTPS recovery link working", async () => {
      const screen = await render(
        <StoryWrapper>
          <NoteAttachmentsRecovery attachments={[DOCUMENT]} />
        </StoryWrapper>,
      );

      await expect
        .element(screen.getByRole("link", { name: "angebot.pdf" }))
        .toBeVisible();
      expect(anchors(screen)).toEqual(["https://cdn.test/k2.pdf"]);
    });
  });
});
