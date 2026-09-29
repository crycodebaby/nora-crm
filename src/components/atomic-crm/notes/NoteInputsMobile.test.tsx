import { composeStories } from "@storybook/react-vite";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import * as stories from "./NoteInputsMobile.stories";
import { AttachmentSignerProvider } from "../attachments/useAttachmentUrl";
import { resetAttachmentUrlCache } from "../attachments/attachmentAccess";
import { NoteInputsMobileStory } from "./NoteInputsMobile.stories";

const {
  AttachmentsNotEditable,
  Default,
  WithAttachmentDefault,
  WithSelectContact,
} = composeStories(stories);

describe("NoteInputsMobile", () => {
  it("renders the note textarea", async () => {
    const screen = await render(<Default />);

    await expect.element(screen.getByPlaceholder("Add a note")).toBeVisible();
  });

  it("renders the attach document button", async () => {
    const screen = await render(<Default />);

    await expect
      .element(screen.getByRole("button", { name: "Attach document" }))
      .toBeVisible();
  });

  it("does not render the contact selector by default", async () => {
    const screen = await render(<Default />);

    await expect.element(screen.getByText("Contact")).not.toBeInTheDocument();
  });

  it("renders the contact selector when selectContact is true", async () => {
    const screen = await render(<WithSelectContact />);

    await expect.element(screen.getByText("Contact")).toBeVisible();
  });

  it("shows a validation error when submitting an empty note without attachments", async () => {
    const screen = await render(<Default />);

    await screen.getByRole("button", { name: "Save" }).click();

    await expect
      .element(screen.getByText("A note or an attachment is required"))
      .toBeVisible();
  });

  it("treats whitespace-only note text as empty", async () => {
    const screen = await render(<Default />);

    await screen.getByPlaceholder("Add a note").fill("   ");
    await screen.getByRole("button", { name: "Save" }).click();

    await expect
      .element(screen.getByText("A note or an attachment is required"))
      .toBeVisible();
  });

  it("allows submitting a note with text only", async () => {
    const screen = await render(<Default />);

    await screen.getByPlaceholder("Add a note").fill("Call summary");
    await screen.getByRole("button", { name: "Save" }).click();

    await expect
      .element(screen.getByText("A note or an attachment is required"))
      .not.toBeInTheDocument();
  });

  it("allows submitting a note with an attachment and no text", async () => {
    const screen = await render(<WithAttachmentDefault />);

    await screen.getByRole("button", { name: "Save" }).click();

    await expect
      .element(screen.getByText("A note or an attachment is required"))
      .not.toBeInTheDocument();
  });

  // W8-C S5 — this component is shared verbatim by the create sheet and the
  // edit sheet, so the host prop is the only thing that tells them apart.
  describe("attachment editability (W8-C S5)", () => {
    it("offers the attach button when the host allows it (CREATE)", async () => {
      const screen = await render(<Default />);

      await expect
        .element(screen.getByRole("button", { name: "Attach document" }))
        .toBeVisible();
    });

    it("hides the attach button and previews for an unverified note", async () => {
      const screen = await render(<AttachmentsNotEditable />);

      await expect
        .element(screen.getByRole("button", { name: "Attach document" }))
        .not.toBeInTheDocument();
      expect(screen.container.querySelector('input[type="file"]')).toBeNull();
      // the stored attachment is not offered through the normal preview
      await expect
        .element(screen.getByRole("link", { name: "evidence.pdf" }))
        .not.toBeInTheDocument();
    });

    it("keeps text editing available while attachments are blocked", async () => {
      const screen = await render(<AttachmentsNotEditable />);

      const textarea = screen.getByPlaceholder("Add a note");
      await textarea.fill("Text edit stays possible");

      await expect.element(textarea).toHaveValue("Text edit stays possible");
    });
  });

  it("restricts the file picker to the attachment allowlist", async () => {
    const screen = await render(<Default />);
    await expect
      .element(screen.getByRole("button", { name: "Attach document" }))
      .toBeVisible();

    const accept = screen.container
      .querySelector('input[type="file"]')
      ?.getAttribute("accept")
      ?.split(",");
    expect(accept).toContain("application/pdf");
    expect(accept).not.toContain("image/svg+xml");
    expect(accept).not.toContain("text/html");
  });

  it("attaches allowed files and refuses disallowed ones with a message", async () => {
    const screen = await render(<Default />);
    await expect
      .element(screen.getByRole("button", { name: "Attach document" }))
      .toBeVisible();
    const input = screen.container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;

    await userEvent.upload(input, [
      new File(["%PDF"], "angebot.pdf", { type: "application/pdf" }),
      new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" }),
    ]);

    await expect
      .element(
        page.getByText(/Not attached – file type not allowed: logo\.svg/),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "angebot.pdf" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "logo.svg" }))
      .not.toBeInTheDocument();
  });
});

/**
 * Alpha Storage 3 M-1 — the mobile note-edit list with W8-E stored elements.
 *
 * Every element is `{ path, title, type }` with no `src`: before the
 * remediation these rendered nothing, and the list keyed them by `src`/index.
 * Each must stay visible, derive its own link from its own key, and keep its
 * own identity when a neighbour is removed.
 */
describe("mobile note-edit list with path-only attachments (M-1)", () => {
  beforeEach(() => resetAttachmentUrlCache());

  const signer = async (key: string) => `https://signed.test/${key}?token=t`;
  const stored = [
    { path: "k-a.pdf", title: "a.pdf", type: "application/pdf" },
    { path: "k-b.pdf", title: "b.pdf", type: "application/pdf" },
  ];

  it("shows every stored attachment, each linked through its own key", async () => {
    const screen = await render(
      <AttachmentSignerProvider signer={signer}>
        <NoteInputsMobileStory defaultValues={{ attachments: stored }} />
      </AttachmentSignerProvider>,
    );

    await expect
      .element(screen.getByRole("link", { name: "a.pdf" }))
      .toHaveAttribute("href", "https://signed.test/k-a.pdf?token=t");
    await expect
      .element(screen.getByRole("link", { name: "b.pdf" }))
      .toHaveAttribute("href", "https://signed.test/k-b.pdf?token=t");
  });

  it("keeps the remaining attachment's own link after a neighbour is removed", async () => {
    const screen = await render(
      <AttachmentSignerProvider signer={signer}>
        <NoteInputsMobileStory defaultValues={{ attachments: stored }} />
      </AttachmentSignerProvider>,
    );

    await expect
      .element(screen.getByRole("link", { name: "a.pdf" }))
      .toBeVisible();

    await screen.getByRole("button", { name: "Delete" }).first().click();

    await expect
      .element(screen.getByRole("link", { name: "a.pdf" }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: "b.pdf" }))
      .toHaveAttribute("href", "https://signed.test/k-b.pdf?token=t");
  });

  /**
   * Alpha Storage 5 U-1 — the list must really be keyed by file identity.
   *
   * The link text and href alone cannot tell identity from position: a
   * position-keyed list re-renders the neighbour into the removed row and ends
   * up showing the same text. The DOM node can: with identity keys the
   * surviving row keeps its node (and with it its component state — derived
   * URL, retry budget); with index or `src` keys it is torn down.
   */
  it("keeps the surviving attachment's own row when a neighbour is removed", async () => {
    const screen = await render(
      <AttachmentSignerProvider signer={signer}>
        <NoteInputsMobileStory defaultValues={{ attachments: stored }} />
      </AttachmentSignerProvider>,
    );
    await expect
      .element(screen.getByRole("link", { name: "b.pdf" }))
      .toHaveAttribute("href", "https://signed.test/k-b.pdf?token=t");
    const rowB = screen.getByRole("link", { name: "b.pdf" }).element();

    await screen.getByRole("button", { name: "Delete" }).first().click();
    await expect
      .element(screen.getByRole("link", { name: "a.pdf" }))
      .not.toBeInTheDocument();

    expect(rowB.isConnected).toBe(true);
    expect(screen.getByRole("link", { name: "b.pdf" }).element()).toBe(rowB);
  });
});
