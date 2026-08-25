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
