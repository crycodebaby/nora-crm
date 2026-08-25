import { createDataProvider } from "./dataProvider";
import { buildCompany, buildContact, createCrmDb } from "@/test/StoryWrapper";

// Unified Tasks Wave: FakeRest must mirror the Postgres trigger semantics in
// supabase/migrations/*_unified_tasks_wave.sql — company_id derivation on
// create, context-change-only validation, and historical stability once a
// task's context is no longer touched. See docs/nora/06-decision-log.md.
describe("FakeRest tasks: historical company context", () => {
  const setup = () => {
    const company = buildCompany({ id: 1, name: "Traum und Horror UG" });
    const otherCompany = buildCompany({ id: 2, name: "Andere GmbH" });
    const contact = buildContact({ id: 10, company_id: 1 });
    const unassignedContact = buildContact({ id: 11, company_id: null });
    const dataProvider = createDataProvider({
      db: createCrmDb({
        companies: [company, otherCompany],
        contacts: [contact, unassignedContact],
      }),
      silent: true,
      latency: 0,
    });
    return { dataProvider, company, otherCompany, contact, unassignedContact };
  };

  it("derives company_id from the contact when only contact_id is given", async () => {
    const { dataProvider, contact } = setup();

    const { data: task } = await dataProvider.create("tasks", {
      data: {
        text: "Angebot mit Freddie nachfassen",
        due_date: new Date().toISOString(),
        contact_id: contact.id,
        sales_id: 0,
      },
    });

    expect(task.company_id).toBe(1);
    expect(task.contact_id).toBe(contact.id);
  });

  it("allows a company-only task with no contact", async () => {
    const { dataProvider, company } = setup();

    const { data: task } = await dataProvider.create("tasks", {
      data: {
        text: "Rechnung prüfen",
        due_date: new Date().toISOString(),
        company_id: company.id,
        sales_id: 0,
      },
    });

    expect(task.company_id).toBe(company.id);
    expect(task.contact_id ?? null).toBeNull();
  });

  it("allows a contact-only task for an unassigned contact", async () => {
    const { dataProvider, unassignedContact } = setup();

    const { data: task } = await dataProvider.create("tasks", {
      data: {
        text: "Zoe zurückrufen",
        due_date: new Date().toISOString(),
        contact_id: unassignedContact.id,
        sales_id: 0,
      },
    });

    expect(task.company_id ?? null).toBeNull();
    expect(task.contact_id).toBe(unassignedContact.id);
  });

  it("rejects a task with neither company_id nor contact_id", async () => {
    const { dataProvider } = setup();

    await expect(
      dataProvider.create("tasks", {
        data: {
          text: "Invalid",
          due_date: new Date().toISOString(),
          sales_id: 0,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects combining a company with a contact from a different company", async () => {
    const { dataProvider, otherCompany, contact } = setup();

    await expect(
      dataProvider.create("tasks", {
        data: {
          text: "Mismatch",
          due_date: new Date().toISOString(),
          company_id: otherCompany.id,
          contact_id: contact.id,
          sales_id: 0,
        },
      }),
    ).rejects.toThrow();
  });

  it("keeps the historical company_id stable after the contact moves to another company", async () => {
    const { dataProvider, contact, otherCompany } = setup();

    const { data: task } = await dataProvider.create("tasks", {
      data: {
        text: "Angebot mit Freddie nachfassen",
        due_date: new Date().toISOString(),
        contact_id: contact.id,
        sales_id: 0,
      },
    });
    expect(task.company_id).toBe(1);

    // Contact reassigned to a different company afterwards.
    await dataProvider.update("contacts", {
      id: contact.id,
      data: { company_id: otherCompany.id },
      previousData: contact,
    });

    // A routine field-only update (not touching contact_id/company_id) must
    // not re-derive or reject based on the contact's new company.
    const { data: updated } = await dataProvider.update("tasks", {
      id: task.id,
      data: { text: "Angebot mit Freddie nachfassen (aktualisiert)" },
      previousData: task,
    });

    expect(updated.company_id).toBe(1);
    expect(updated.contact_id).toBe(contact.id);
  });
});
