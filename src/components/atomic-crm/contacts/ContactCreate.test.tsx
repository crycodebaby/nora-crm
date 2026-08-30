import { render } from "vitest-browser-react";

import "@/index.css";
import {
  ContactCreateBasic,
  ContactCreateMobile,
} from "./ContactCreate.stories";
import { page } from "vitest/browser";

describe("ContactCreate", () => {
  beforeEach(() => {
    page.viewport(1600, 900);
  });
  it("shows empty email and phone placeholder inputs", async () => {
    const screen = await render(<ContactCreateBasic />);

    await expect
      .element(screen.getByRole("heading", { name: "New Contact" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Person", { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Customer and role"))
      .toBeInTheDocument();
    await expect.element(screen.getByText("Reachability")).toBeInTheDocument();
    await expect.element(screen.getByPlaceholder("Email")).toBeInTheDocument();
    await expect
      .element(screen.getByPlaceholder("Phone number"))
      .toBeInTheDocument();
  });

  it("presents one calm, sequential contact-entry flow", async () => {
    const screen = await render(<ContactCreateBasic />);

    const person = screen.getByText("Person", { exact: true });
    await expect.element(person).toBeInTheDocument();
    const personHeading = person.element() as HTMLElement;
    const flow = personHeading.closest(".nora-contact-create-flow");
    const sections = Array.from(
      flow?.querySelectorAll<HTMLElement>("[data-contact-create-section]") ??
        [],
    ).map((section) => section.dataset.contactCreateSection);

    expect(flow).not.toBeNull();
    expect(sections).toEqual([
      "person",
      "customer",
      "contact-methods",
      "additional",
    ]);
    expect(
      flow?.parentElement?.querySelectorAll(".nora-contact-create-flow"),
    ).toHaveLength(1);
  });

  it("keeps the same hierarchy and touch-safe primary action on mobile", async () => {
    page.viewport(390, 844);
    const screen = await render(<ContactCreateMobile />);

    const firstName = screen.getByLabelText(/first name/i);
    const lastName = screen.getByLabelText(/last name/i);
    await expect.element(firstName).toBeInTheDocument();

    const firstRect = firstName.element().getBoundingClientRect();
    const lastRect = lastName.element().getBoundingClientRect();
    expect(Math.abs(firstRect.left - lastRect.left)).toBeLessThan(3);
    expect(lastRect.top).toBeGreaterThanOrEqual(firstRect.bottom);

    await expect.element(screen.getByText("Required")).toBeVisible();
    await expect.element(screen.getByText("Optional").first()).toBeVisible();
    const save = screen.getByRole("button", { name: /create contact/i });
    expect(
      save.element().getBoundingClientRect().height,
    ).toBeGreaterThanOrEqual(44);
  });

  it("keeps contact method type selection separate from row deletion", async () => {
    const screen = await render(<ContactCreateBasic />);

    await expect
      .element(screen.getByRole("combobox").filter({ hasText: "Work" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("combobox").filter({ hasText: "Mobile" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Clear selection" }))
      .not.toBeInTheDocument();

    await expect
      .element(screen.getByRole("button", { name: "Remove" }).first())
      .toBeVisible();
  });

  it("does not render a redundant 'Position' section heading above the title field (Self Contact Wave regression)", async () => {
    const screen = await render(<ContactCreateBasic />);

    // The section heading duplicated the title field's own auto-derived
    // label (both "Position" in German) — removed at the source, keeping
    // the field's real accessible label (a11y) instead of hiding via CSS.
    await expect
      .element(screen.getByRole("heading", { name: "Position" }))
      .not.toBeInTheDocument();
    await expect.element(screen.getByLabelText("Title")).toBeInTheDocument();
  });

  it("does not submit empty email and phone entries", async () => {
    const createMock = vi
      .fn()
      .mockImplementation(async (resource: string, params: any) => {
        if (resource === "contacts") {
          return { data: { id: 1, ...params.data } as any };
        }
      });

    const screen = await render(
      <ContactCreateBasic silent dataProvider={{ create: createMock }} />,
    );

    await expect.element(screen.getByPlaceholder("Email")).toBeInTheDocument();

    // Fill required fields only
    await screen.getByLabelText(/first name/i).fill("Ada");
    await screen.getByLabelText(/last name/i).fill("Lovelace");

    await screen.getByRole("button", { name: /create contact/i }).click();

    await expect
      .poll(() => screen.getByText("Element created"))
      .toBeInTheDocument();
    await screen.getByLabelText("Close toast").click();

    await expect(createMock).toBeCalledTimes(1);

    await expect(createMock).toBeCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: expect.objectContaining({
          email_jsonb: null,
          phone_jsonb: null,
        }),
      }),
    );
  });

  it("submits only filled email and phone entries, stripping empty ones", async () => {
    const createMock = vi.fn().mockResolvedValue({ data: {} });
    const screen = await render(
      <ContactCreateBasic
        dataProvider={{
          create: createMock,
        }}
        silent
      />,
    );

    await expect.element(screen.getByPlaceholder("Email")).toBeInTheDocument();

    // Fill required fields
    await screen.getByLabelText(/first name/i).fill("Ada");
    await screen.getByLabelText(/last name/i).fill("Lovelace");

    // Fill email but leave phone empty
    await screen.getByPlaceholder("Email").fill("ada@example.com");

    await screen.getByRole("button", { name: /create contact/i }).click();

    await expect.poll(() => createMock).toBeCalledTimes(1);

    expect(createMock).toBeCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: expect.objectContaining({
          email_jsonb: [{ email: "ada@example.com", type: "Work" }],
          phone_jsonb: null,
        }),
      }),
    );
  });

  it("submits both email and phone when filled", async () => {
    const createMock = vi.fn().mockResolvedValue({ data: {} });

    const screen = await render(
      <ContactCreateBasic
        silent
        dataProvider={{
          create: createMock,
        }}
      />,
    );

    await expect.element(screen.getByPlaceholder("Email")).toBeInTheDocument();

    // Fill required fields
    await screen.getByLabelText(/first name/i).fill("Ada");
    await screen.getByLabelText(/last name/i).fill("Lovelace");

    // Fill both email and phone
    await screen.getByPlaceholder("Email").fill("ada@example.com");
    await screen.getByPlaceholder("Phone number").fill("+1234567890");

    await screen.getByRole("button", { name: /create contact/i }).click();

    await expect.poll(() => createMock).toBeCalledTimes(1);

    expect(createMock).toBeCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: expect.objectContaining({
          email_jsonb: [{ email: "ada@example.com", type: "Work" }],
          phone_jsonb: [{ number: "+1234567890", type: "Mobile" }],
        }),
      }),
    );
  });
});
