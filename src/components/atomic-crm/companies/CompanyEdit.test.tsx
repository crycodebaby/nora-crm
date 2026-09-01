import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { CompanyEditBasic } from "./CompanyEdit.stories";

/**
 * Customer Create Speed & Clarity Wave (2026-09-01): die regionalen Defaults
 * (Bundesland NRW, Land ausgeblendet) gelten NUR für den Create-Flow. Ein
 * bestehender Kunde behält im Edit-Formular seine gespeicherten Werte und das
 * Land bleibt sichtbar/editierbar.
 */
describe("CompanyEdit — regional create defaults must not leak into edit", () => {
  beforeAll(() => {
    page.viewport(1600, 1200);
  });

  it("keeps the stored Bundesland (no NRW override) and still shows the Country field", async () => {
    const screen = await render(
      <CompanyEditBasic
        silent
        company={{
          name: "Nordlicht Hausverwaltung GmbH",
          state_abbr: "Niedersachsen",
          country: "Deutschland",
        }}
      />,
    );

    await expect
      .element(screen.getByLabelText(/^state$/i))
      .toHaveValue("Niedersachsen");
    await expect
      .element(screen.getByLabelText(/^country$/i))
      .toHaveValue("Deutschland");
  });

  it("does not fill in NRW for a stored customer whose Bundesland is empty", async () => {
    const screen = await render(
      <CompanyEditBasic
        silent
        company={{ name: "Altkunde ohne Bundesland", state_abbr: "" }}
      />,
    );

    await expect
      .element(screen.getByLabelText(/^company name/i))
      .toHaveValue("Altkunde ohne Bundesland");
    await expect.element(screen.getByLabelText(/^state$/i)).toHaveValue("");
    // Edit keeps the full Kontext block inline (no "Additional details" disclosure).
    await expect
      .element(screen.getByRole("button", { name: /additional details/i }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByLabelText(/^revenue/i))
      .toBeInTheDocument();
  });
});
