import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { ContactCreateBasic } from "../contacts/ContactCreate.stories";

// Regression coverage for the Nora autocomplete UX finding: the "create a
// new company" row must be clearly distinguishable from a normal search
// result (its own group, a Plus icon, distinct styling) and must show the
// entered name in an unambiguous German-style action label, not a generic
// hint that could be mistaken for a search result.
describe("AutocompleteCompanyInput create action (/kontakte/create)", () => {
  beforeAll(() => {
    page.viewport(1600, 900);
  });

  it("shows the create action as a distinct, labelled option instead of a plain hint", async () => {
    const screen = await render(<ContactCreateBasic silent />);

    await screen.getByRole("combobox", { name: /company/i }).click();
    await screen.getByPlaceholder(/search/i).fill("Traum und Horror UG");

    await expect
      .element(screen.getByRole("option", { name: "Familie Krüger" }))
      .not.toBeInTheDocument();

    const createOption = screen.getByRole("option", {
      name: 'Create new company "Traum und Horror UG"',
    });
    await expect.element(createOption).toBeVisible();
  });

  it("still creates the company and selects it when the create action is chosen", async () => {
    // Exercise the real (fakerest) dataProvider.create so the newly created
    // company is actually persisted and can be re-selected, the way it
    // behaves in the app.
    const screen = await render(<ContactCreateBasic silent />);

    await screen.getByRole("combobox", { name: /company/i }).click();
    await screen.getByPlaceholder(/search/i).fill("Traum und Horror UG");

    await screen
      .getByRole("option", {
        name: 'Create new company "Traum und Horror UG"',
      })
      .click();

    // ContactInputs only renders the "Primary contact" toggle once
    // company_id holds a real (truthy) value, so its appearance confirms
    // the newly created company id — not the "@@ra-create" placeholder —
    // was written back onto the field.
    await expect
      .element(screen.getByLabelText(/primary contact/i))
      .toBeInTheDocument();
  });
});
