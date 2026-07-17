import { render } from "vitest-browser-react";
import { buildContact, StoryWrapper } from "@/test/StoryWrapper";
import { DashboardStepper } from "./DashboardStepper";
import { resolveFirstContactId } from "./dashboardStepperUtils";

const mockIsMobile = vi.hoisted(() => vi.fn(() => false));
vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: mockIsMobile,
}));

describe("resolveFirstContactId", () => {
  it("rejects missing and invalid ids", () => {
    expect(resolveFirstContactId(undefined)).toBeUndefined();
    expect(resolveFirstContactId(null)).toBeUndefined();
    expect(resolveFirstContactId("")).toBeUndefined();
    expect(resolveFirstContactId("undefined")).toBeUndefined();
    expect(resolveFirstContactId("null")).toBeUndefined();
  });

  it("keeps valid ids", () => {
    expect(resolveFirstContactId(42)).toBe(42);
    expect(resolveFirstContactId("contact-1")).toBe("contact-1");
  });
});

describe("DashboardStepper note action", () => {
  beforeEach(() => {
    mockIsMobile.mockReturnValue(false);
  });

  it("renders a real disabled button without href in first-run state", async () => {
    const screen = await render(
      <StoryWrapper>
        <DashboardStepper step={1} />
      </StoryWrapper>,
    );

    const addNote = screen.getByRole("button", { name: "Add note" });
    await expect.element(addNote).toBeDisabled();
    expect(addNote.element().tagName).toBe("BUTTON");
    expect(addNote.element().getAttribute("href")).toBeNull();
  });

  it("links to the canonical Nora contact show route when a contact exists", async () => {
    const contact = buildContact({ id: 17 });
    const screen = await render(
      <StoryWrapper data={{ contacts: [contact] }}>
        <DashboardStepper step={2} contactId={contact.id} />
      </StoryWrapper>,
    );

    const addNote = screen.getByRole("link", { name: "Add note" });
    await expect.element(addNote).toBeVisible();
    expect(addNote.element().getAttribute("href")).toBe("/kontakte/17/show");
  });

  it("uses a disabled button on mobile without a valid contact", async () => {
    mockIsMobile.mockReturnValue(true);

    const screen = await render(
      <StoryWrapper>
        <DashboardStepper step={1} />
      </StoryWrapper>,
    );

    const addNote = screen.getByRole("button", { name: "Add note" });
    await expect.element(addNote).toBeDisabled();
    expect(addNote.element().tagName).toBe("BUTTON");
    expect(addNote.element().getAttribute("href")).toBeNull();
  });
});
