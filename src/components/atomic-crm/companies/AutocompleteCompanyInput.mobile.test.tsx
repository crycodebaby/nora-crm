import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { ContactCreateMobile } from "../contacts/ContactCreate.stories";

describe("AutocompleteCompanyInput mobile customer search", () => {
  beforeAll(() => {
    page.viewport(390, 844);
  });

  it("uses a focused bottom sheet with a separate create action", async () => {
    const screen = await render(<ContactCreateMobile />);

    await expect
      .element(
        screen.getByRole("button", {
          name: /additional details/i,
        }),
      )
      .toHaveAttribute("aria-expanded", "false");

    await screen.getByRole("combobox", { name: /company/i }).click();

    await expect
      .element(screen.getByRole("heading", { name: "Select customer" }))
      .toBeVisible();
    const search = screen.getByPlaceholder(/customer name or number/i);
    await expect.element(search).toBeVisible();

    await search.fill("Traum und Horror UG");
    await expect
      .element(screen.getByRole("option", { name: "Familie Krüger" }))
      .not.toBeInTheDocument();
    await expect
      .element(
        screen.getByRole("option", {
          name: 'Create new company "Traum und Horror UG"',
        }),
      )
      .toBeVisible();
  });
});
