import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { buildCompany, buildContact, StoryWrapper } from "@/test/StoryWrapper";
import { Task } from "./Task";

// Unified Tasks Wave: a task's company_id is its historical context and is
// never re-synced when the linked contact later changes company. The UI
// must surface that as a quiet note, not an error — see
// docs/nora/06-decision-log.md "2026-08-25 – Unified Tasks Wave".
describe("Task historical contact/company mismatch", () => {
  beforeAll(() => {
    page.viewport(1000, 800);
  });

  it("shows a quiet note when the task's historical company differs from the contact's current company", async () => {
    const companyA = buildCompany({ id: 1, name: "Traum und Horror UG" });
    const companyB = buildCompany({ id: 2, name: "Andere GmbH" });
    // Freddie is on company B today, but the task was historically created
    // while he was on company A.
    const contact = buildContact({
      id: 30,
      company_id: 2,
      company_name: companyB.name,
      first_name: "Freddie",
      last_name: "Krüger",
    });
    const task = {
      id: 100,
      text: "Angebot mit Freddie nachfassen",
      type: "none",
      due_date: new Date().toISOString(),
      done_date: null,
      company_id: 1,
      contact_id: 30,
      sales_id: 0,
    } as any;

    const screen = await render(
      <StoryWrapper
        data={{ companies: [companyA, companyB], contacts: [contact] }}
      >
        <Task task={task} showContact />
      </StoryWrapper>,
    );

    await expect.element(screen.getByText(/Andere GmbH/)).toBeVisible();
  });

  it("does not show the note when the contact's company still matches the task's history", async () => {
    const company = buildCompany({ id: 1, name: "Traum und Horror UG" });
    const contact = buildContact({
      id: 30,
      company_id: 1,
      company_name: company.name,
      first_name: "Freddie",
      last_name: "Krüger",
    });
    const task = {
      id: 100,
      text: "Angebot mit Freddie nachfassen",
      type: "none",
      due_date: new Date().toISOString(),
      done_date: null,
      company_id: 1,
      contact_id: 30,
      sales_id: 0,
    } as any;

    const screen = await render(
      <StoryWrapper data={{ companies: [company], contacts: [contact] }}>
        <Task task={task} showContact />
      </StoryWrapper>,
    );

    await expect.element(screen.getByText(/Freddie Krüger/)).toBeVisible();
    await expect
      .element(screen.getByText(/Traum und Horror UG/))
      .not.toBeInTheDocument();
  });
});
