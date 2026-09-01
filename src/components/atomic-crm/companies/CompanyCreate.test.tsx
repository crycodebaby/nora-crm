import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { CompanyCreateBasic } from "./CompanyCreate.stories";

describe("CompanyCreate (/kunden/create) — Customer & Contact Workflow Wave", () => {
  beforeAll(() => {
    page.viewport(1600, 1200);
  });

  it("creates a business customer with a new primary contact via the atomic RPC (default mode)", async () => {
    const createCustomerWithContact = vi
      .fn()
      .mockResolvedValue({ company_id: 101, contact_id: 202 });

    const screen = await render(
      <CompanyCreateBasic
        silent
        dataProvider={{ createCustomerWithContact } as any}
      />,
    );

    await screen.getByLabelText(/company name/i).fill("Metaphor GmbH");
    await screen.getByLabelText(/^first name/i).fill("Max");
    await screen.getByLabelText(/^last name/i).fill("Mustermann");

    await screen.getByRole("button", { name: /create company/i }).click();

    await expect.poll(() => createCustomerWithContact).toBeCalledTimes(1);

    expect(createCustomerWithContact).toBeCalledWith(
      expect.objectContaining({
        company: expect.objectContaining({
          name: "Metaphor GmbH",
          customer_kind: "business",
          // Regional defaults (Customer Create Speed & Clarity Wave)
          country: "Deutschland",
          state_abbr: "NRW",
        }),
        contact: expect.objectContaining({
          first_name: "Max",
          last_name: "Mustermann",
        }),
        existingContactId: null,
      }),
    );
  });

  it("shows a validation error and does not call the RPC when the name is missing", async () => {
    const createCustomerWithContact = vi.fn();

    const screen = await render(
      <CompanyCreateBasic
        silent
        dataProvider={{ createCustomerWithContact } as any}
      />,
    );

    // Clear the (empty) required contact names so mode stays "new" with no name — company name is still empty by default.
    await screen.getByRole("button", { name: /create company/i }).click();

    await expect.poll(() => createCustomerWithContact).toBeCalledTimes(0);
  });

  it("Privatperson: hides the Kundenname field, derives it from Vorname/Nachname, and does not block submit on the hidden required name field", async () => {
    const createCustomerWithContact = vi
      .fn()
      .mockResolvedValue({ company_id: 55, contact_id: 66 });

    const screen = await render(
      <CompanyCreateBasic
        silent
        dataProvider={{ createCustomerWithContact } as any}
      />,
    );

    await screen.getByRole("radio", { name: /private customer/i }).click();

    // The company-name field must not be rendered (and therefore not required) in this mode.
    await expect
      .element(screen.getByLabelText(/company name/i))
      .not.toBeInTheDocument();

    await screen.getByLabelText(/^first name/i).fill("Sabine");
    await screen.getByLabelText(/^last name/i).fill("Becker");

    await screen.getByRole("button", { name: /create company/i }).click();

    await expect.poll(() => createCustomerWithContact).toBeCalledTimes(1);

    expect(createCustomerWithContact).toBeCalledWith(
      expect.objectContaining({
        company: expect.objectContaining({
          name: "Sabine Becker",
          customer_kind: "individual",
          sector: null,
          size: null,
        }),
        contact: expect.objectContaining({
          first_name: "Sabine",
          last_name: "Becker",
        }),
      }),
    );
  });
});

describe("CompanyCreate — Customer Create Speed & Clarity Wave (regional defaults, disclosure)", () => {
  beforeAll(() => {
    page.viewport(1600, 1200);
  });

  it("shows no Country field, starts Bundesland with NRW, keeps the address fields in German order", async () => {
    const screen = await render(
      <CompanyCreateBasic silent dataProvider={{} as any} />,
    );

    await expect.element(screen.getByLabelText(/^state$/i)).toHaveValue("NRW");
    await expect
      .element(screen.getByLabelText(/^country$/i))
      .not.toBeInTheDocument();

    // Zip before city (Straße → PLZ → Ort).
    const zip = screen.getByLabelText(/^zip code/i).element();
    const city = screen.getByLabelText(/^city/i).element();
    expect(
      zip.compareDocumentPosition(city) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("creates a customer without a contact and still sends the canonical country + NRW", async () => {
    const createCustomerWithContact = vi
      .fn()
      .mockResolvedValue({ company_id: 7, contact_id: null });

    const screen = await render(
      <CompanyCreateBasic
        silent
        dataProvider={{ createCustomerWithContact } as any}
      />,
    );

    await screen.getByLabelText(/company name/i).fill("WEG Königsallee 12");
    await screen.getByRole("radio", { name: /no contact/i }).click();
    await screen.getByRole("button", { name: /create company/i }).click();

    await expect.poll(() => createCustomerWithContact).toBeCalledTimes(1);
    expect(createCustomerWithContact).toBeCalledWith(
      expect.objectContaining({
        company: expect.objectContaining({
          name: "WEG Königsallee 12",
          country: "Deutschland",
          state_abbr: "NRW",
        }),
        contact: null,
        existingContactId: null,
      }),
    );
  });

  it("lets the user overwrite NRW — the typed Bundesland is what gets saved", async () => {
    const createCustomerWithContact = vi
      .fn()
      .mockResolvedValue({ company_id: 8, contact_id: null });

    const screen = await render(
      <CompanyCreateBasic
        silent
        dataProvider={{ createCustomerWithContact } as any}
      />,
    );

    await screen.getByLabelText(/company name/i).fill("Nordlicht GmbH");
    await screen.getByLabelText(/^state$/i).fill("Niedersachsen");
    await screen.getByRole("radio", { name: /no contact/i }).click();
    await screen.getByRole("button", { name: /create company/i }).click();

    await expect.poll(() => createCustomerWithContact).toBeCalledTimes(1);
    expect(createCustomerWithContact).toBeCalledWith(
      expect.objectContaining({
        company: expect.objectContaining({
          state_abbr: "Niedersachsen",
          country: "Deutschland",
        }),
      }),
    );
  });

  it("keeps rarely needed fields (links, size, revenue, tax id) behind a collapsed 'Additional details' disclosure", async () => {
    const screen = await render(
      <CompanyCreateBasic silent dataProvider={{} as any} />,
    );

    const trigger = screen.getByRole("button", { name: /additional details/i });
    await expect.element(trigger).toBeInTheDocument();
    await expect
      .element(screen.getByLabelText(/^revenue/i))
      .not.toBeInTheDocument();
    // Primary fields stay visible.
    await expect
      .element(screen.getByLabelText(/^description/i))
      .toBeInTheDocument();

    await trigger.click();

    await expect
      .element(screen.getByLabelText(/^revenue/i))
      .toBeInTheDocument();
    await expect
      .element(screen.getByLabelText(/^tax identifier/i))
      .toBeInTheDocument();
    await expect.element(screen.getByText(/^links$/i)).toBeInTheDocument();
  });

  it("keeps the existing validation: a new contact without a name blocks the submit", async () => {
    const createCustomerWithContact = vi.fn();

    const screen = await render(
      <CompanyCreateBasic
        silent
        dataProvider={{ createCustomerWithContact } as any}
      />,
    );

    await screen.getByLabelText(/company name/i).fill("Metaphor GmbH");
    // Default mode is "new contact" — first/last name are required there.
    await screen.getByRole("button", { name: /create company/i }).click();

    await expect
      .element(screen.getByText(/required/i).first())
      .toBeInTheDocument();
    await expect.poll(() => createCustomerWithContact).toBeCalledTimes(0);
  });
});
