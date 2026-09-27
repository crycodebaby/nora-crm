import { RecordContextProvider } from "ra-core";
import { render } from "vitest-browser-react";

import { AttachmentField } from "./AttachmentField";
import { StoryWrapper } from "@/test/StoryWrapper";

/**
 * RC3 closure 2026-09-27 — stored XSS through the attachment EDIT surface.
 *
 * `AttachmentField` is the preview rendered inside the note `<FileInput>`
 * (`NoteInputs` / `NoteInputsMobile`). It received the same treatment as the
 * read-only renderers in `NoteAttachments.test.tsx`: the value it puts into
 * `href` comes from the attachment record, which for legacy and imported notes
 * is an arbitrary attacker-influenceable string. A stored `javascript:` value
 * used to execute in the signed-in employee's session on click.
 *
 * The rule is the same in both branches of this component — the image preview
 * and the plain document link: an unsafe value must not produce a clickable
 * anchor. The attachment stays visible so nothing disappears from the UI.
 *
 * NOTE ON THE ASSERTIONS. `render()` resolves before React has committed, so a
 * bare `container.querySelector(...)` runs against an empty div and would pass
 * no matter what the component does. Every check below therefore first awaits
 * something that must be on screen, and only then asserts what must be absent.
 */
const Host = ({ record }: { record: Record<string, unknown> }) => (
  <StoryWrapper>
    <RecordContextProvider value={record}>
      <AttachmentField source="src" title="title" target="_blank" />
    </RecordContextProvider>
    <span>committed</span>
  </StoryWrapper>
);

const doc = (src?: string) => ({
  title: "angebot.pdf",
  type: "application/pdf",
  ...(src === undefined ? {} : { src }),
});

const image = (src?: string) => ({
  title: "bild.png",
  type: "image/png",
  ...(src === undefined ? {} : { src }),
});

const anchors = (screen: { container: HTMLElement }) =>
  [...screen.container.querySelectorAll("a")].map((a) =>
    a.getAttribute("href"),
  );

const UNSAFE: [string, string][] = [
  ["javascript:", "javascript:alert(document.cookie)"],
  ["mixed-case JavaScript", "JaVaScRiPt:alert(1)"],
  ["javascript: with surrounding whitespace", "   javascript:alert(1)   "],
  ["data:", "data:text/html,<script>alert(1)</script>"],
  ["vbscript:", "vbscript:msgbox(1)"],
  ["file:", "file:///etc/passwd"],
];

describe("AttachmentField never emits an unsafe href", () => {
  it.each(UNSAFE)(
    "renders a document with %s as text, not a link",
    async (_label, src) => {
      const screen = await render(<Host record={doc(src)} />);

      // the title is on screen => the component has committed
      await expect.element(screen.getByText("angebot.pdf")).toBeVisible();
      expect(anchors(screen)).toEqual([]);
    },
  );

  it.each(UNSAFE)(
    "does not wrap an image with %s in a clickable anchor",
    async (_label, src) => {
      const screen = await render(<Host record={image(src)} />);

      // the preview is still shown, it just must not be clickable
      await expect.element(screen.getByAltText("bild.png")).toBeVisible();
      expect(anchors(screen)).toEqual([]);
    },
  );
});

describe("AttachmentField keeps safe attachment links working", () => {
  it("links a normal HTTPS document and keeps the link attributes", async () => {
    const url = "https://cdn.test/k2.pdf";
    const screen = await render(<Host record={doc(url)} />);

    const link = screen.getByRole("link", { name: "angebot.pdf" });
    await expect.element(link).toBeVisible();
    expect(anchors(screen)).toEqual([url]);
    await expect.element(link).toHaveAttribute("target", "_blank");
    await expect.element(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("keeps a legacy signed attachment URL with query parameters intact", async () => {
    const url =
      "https://project.supabase.co/storage/v1/object/sign/attachments/k9.pdf?token=abc.def-ghi";
    const screen = await render(<Host record={doc(url)} />);

    await expect
      .element(screen.getByRole("link", { name: "angebot.pdf" }))
      .toBeVisible();
    expect(anchors(screen)).toEqual([url]);
  });

  it("links an HTTPS image preview", async () => {
    const url = "https://cdn.test/k1.png";
    const screen = await render(<Host record={image(url)} />);

    await expect.element(screen.getByAltText("bild.png")).toBeVisible();
    expect(anchors(screen)).toEqual([url]);
  });

  it("upgrades a protocol-relative URL to https, as safeHref defines", async () => {
    const screen = await render(
      <Host record={doc("//cdn.example.com/x.pdf")} />,
    );

    await expect
      .element(screen.getByRole("link", { name: "angebot.pdf" }))
      .toBeVisible();
    expect(anchors(screen)).toEqual(["https://cdn.example.com/x.pdf"]);
  });
});

/**
 * The in-session preview. `FileInput.transformFile` and
 * `NoteInputsMobile.handleFileChange` build `{ rawFile, src, title }` where
 * `src` is a `blob:` object URL. That value is not stored and not
 * attacker-influenceable, and `NoteInputs` / `NoteInputsMobile` rely on it being
 * clickable. Both halves of the exemption must be load-bearing: stored data can
 * never be a `File` instance, and the value must actually be a `blob:` URL.
 */
const localPreview = (name: string, type: string) => {
  const rawFile = new File(["%PDF"], name, { type });
  return { rawFile, src: URL.createObjectURL(rawFile), title: name };
};

describe("AttachmentField keeps the in-session file preview clickable", () => {
  it("links a freshly picked document through its object URL", async () => {
    const record = localPreview("angebot.pdf", "application/pdf");
    const screen = await render(<Host record={record} />);

    await expect
      .element(screen.getByRole("link", { name: "angebot.pdf" }))
      .toBeVisible();
    expect(anchors(screen)).toEqual([record.src]);
  });

  it("links a freshly picked image through its object URL", async () => {
    const record = localPreview("bild.png", "image/png");
    const screen = await render(<Host record={record} />);

    await expect.element(screen.getByAltText("bild.png")).toBeVisible();
    expect(anchors(screen)).toEqual([record.src]);
  });

  it("does not trust a blob: URL that arrives as stored data", async () => {
    // no rawFile => this is persisted note JSON, so safeHref decides and rejects
    const screen = await render(
      <Host record={{ ...doc("blob:http://localhost/forged"), rawFile: {} }} />,
    );

    await expect.element(screen.getByText("angebot.pdf")).toBeVisible();
    expect(anchors(screen)).toEqual([]);
  });

  it("does not trust a non-blob src even next to a real File", async () => {
    const rawFile = new File(["x"], "angebot.pdf", {
      type: "application/pdf",
    });
    const screen = await render(
      <Host
        record={{ rawFile, src: "javascript:alert(1)", title: "angebot.pdf" }}
      />,
    );

    await expect.element(screen.getByText("angebot.pdf")).toBeVisible();
    expect(anchors(screen)).toEqual([]);
  });
});

describe("AttachmentField degrades safely without a URL", () => {
  it("renders no attachment at all when src is absent", async () => {
    const screen = await render(<Host record={doc(undefined)} />);

    // the sibling marker proves the tree committed before we assert absence
    await expect.element(screen.getByText("committed")).toBeVisible();
    expect(anchors(screen)).toEqual([]);
    expect(screen.container.querySelector("img")).toBeNull();
  });

  it("renders no link for an empty src", async () => {
    const screen = await render(<Host record={doc("   ")} />);

    await expect.element(screen.getByText("committed")).toBeVisible();
    expect(anchors(screen)).toEqual([]);
  });
});
