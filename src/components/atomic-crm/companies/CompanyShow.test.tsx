import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { buildCompany, buildContact, StoryWrapper } from "@/test/StoryWrapper";

// Regression coverage for the Nora /kunden tab-routing bug: CompanyShow used
// to navigate to the internal English /companies/... path on tab change,
// which the LegacyPathRedirect route (registered for the same German
// /kunden/* alias tree) rewrote back to /kunden/..., breaking the
// useMatch("/companies/...") tab detection and bouncing the UI back to the
// "activity" tab a moment after the click.
//
// Uses the desktop CompanyShow (tabbed layout) — the mobile view has no
// tab-selection mechanism, so the bug is desktop-only.
describe("CompanyShow tab routing (Nora /kunden alias)", () => {
  beforeAll(() => {
    page.viewport(1600, 1200);
  });

  it("keeps the Kontakte tab active after clicking it on /kunden/:id/show", async () => {
    const company = buildCompany({ id: 1, nb_contacts: 1 });
    const contact = buildContact({
      id: 10,
      company_id: 1,
      company_name: company.name,
      first_name: "Freddie",
      last_name: "Krüger",
    });

    const screen = await render(
      <StoryWrapper
        initialEntries={["/kunden/1/show"]}
        data={{ companies: [company], contacts: [contact] }}
      >
        <div />
      </StoryWrapper>,
    );

    const contactsTab = screen.getByRole("tab", { name: /1 contact/i });
    await contactsTab.click();

    await expect.element(contactsTab).toHaveAttribute("aria-selected", "true");
    await expect.element(screen.getByText("Freddie Krüger")).toBeVisible();

    // Give any stray redirect/useMatch mismatch a chance to fire before
    // asserting the tab is still active — this is the exact bounce-back
    // window observed live.
    await new Promise((resolve) => setTimeout(resolve, 100));

    await expect.element(contactsTab).toHaveAttribute("aria-selected", "true");
    await expect.element(screen.getByText("Freddie Krüger")).toBeVisible();
  });

  it("keeps the Änderungsverlauf (history) tab active after clicking it", async () => {
    const company = buildCompany({ id: 2, nb_contacts: 0 });

    const screen = await render(
      <StoryWrapper
        initialEntries={["/kunden/2/show"]}
        data={{ companies: [company] }}
      >
        <div />
      </StoryWrapper>,
    );

    const historyTab = screen.getByRole("tab", { name: /change history/i });
    await historyTab.click();

    await expect.element(historyTab).toHaveAttribute("aria-selected", "true");

    await new Promise((resolve) => setTimeout(resolve, 100));

    await expect.element(historyTab).toHaveAttribute("aria-selected", "true");
  });
});
