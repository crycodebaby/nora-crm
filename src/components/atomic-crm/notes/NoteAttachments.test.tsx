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
