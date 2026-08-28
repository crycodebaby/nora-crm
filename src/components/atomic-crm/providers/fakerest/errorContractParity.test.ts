import { createDataProvider } from "./dataProvider";
import { buildCompany, buildContact, createCrmDb } from "@/test/StoryWrapper";
import { NORA_ERROR_CODES } from "../../domain/noraErrorCodes";

/**
 * Error Contract Wave (2026-08-28): FakeRest must raise the same
 * NoraErrorCode as the real Postgres RPCs/triggers for the same fachliche
 * scenario, carried via `.details` (mirroring PostgrestError's shape) so
 * normalizeCrmError() classifies both identically — Contract Parität
 * (Postgres \ NoraErrorCode / FakeRest), not two independent regexes.
 */
describe("FakeRest Error Contract parity", () => {
  const getDetails = (error: unknown): unknown =>
    (error as { details?: unknown } | null)?.details;

  it("contact_not_in_customer_context — task company/contact mismatch", async () => {
    const company = buildCompany({ id: 1, name: "Company A" });
    const otherCompany = buildCompany({ id: 2, name: "Company B" });
    const contact = buildContact({ id: 10, company_id: 1 });
    const dataProvider = createDataProvider({
      db: createCrmDb({
        companies: [company, otherCompany],
        contacts: [contact],
      }),
      silent: true,
      latency: 0,
    });

    let caught: unknown;
    try {
      await dataProvider.create("tasks", {
        data: {
          text: "Mismatch",
          due_date: new Date().toISOString(),
          company_id: otherCompany.id,
          contact_id: contact.id,
          sales_id: 0,
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(getDetails(caught)).toBe(
      NORA_ERROR_CODES.CONTACT_NOT_IN_CUSTOMER_CONTEXT,
    );
  });

  it("contact_not_in_customer_context — quick capture existing contact outside effective context", async () => {
    const company = buildCompany({ id: 1, name: "Company A" });
    const otherCompany = buildCompany({ id: 2, name: "Company B" });
    const contact = buildContact({ id: 10, company_id: 1 });
    const dataProvider = createDataProvider({
      db: createCrmDb({
        companies: [company, otherCompany],
        contacts: [contact],
      }),
      silent: true,
      latency: 0,
    });

    let caught: unknown;
    try {
      await dataProvider.createQuickCaptureCase({
        company: null,
        existingCompanyId: otherCompany.id,
        contact: null,
        existingContactId: contact.id,
        selfContactId: null,
        deal: { name: "Should not be created", category: "fensterservice" },
      } as any);
    } catch (error) {
      caught = error;
    }

    expect(getDetails(caught)).toBe(
      NORA_ERROR_CODES.CONTACT_NOT_IN_CUSTOMER_CONTEXT,
    );
  });

  it("individual_name_required — CREATE path (blank representing contact name)", async () => {
    const dataProvider = createDataProvider({
      db: createCrmDb({ companies: [], contacts: [] }),
      silent: true,
      latency: 0,
    });

    let caught: unknown;
    try {
      await dataProvider.createCustomerWithContact({
        company: { name: "placeholder", customer_kind: "individual" },
        contact: { first_name: "", last_name: "" },
      } as any);
    } catch (error) {
      caught = error;
    }

    expect(getDetails(caught)).toBe(NORA_ERROR_CODES.INDIVIDUAL_NAME_REQUIRED);
  });

  it("individual_name_required — rename path (blanking the representing contact's name)", async () => {
    const company = buildCompany({
      id: 1,
      name: "Placeholder",
      customer_kind: "individual",
      self_contact_id: 10,
    } as any);
    const contact = buildContact({
      id: 10,
      first_name: "Rename",
      last_name: "Target",
    });
    const dataProvider = createDataProvider({
      db: createCrmDb({ companies: [company], contacts: [contact] }),
      silent: true,
      latency: 0,
    });

    let caught: unknown;
    try {
      await dataProvider.update("contacts", {
        id: contact.id,
        data: { first_name: "", last_name: "" },
        previousData: contact,
      });
    } catch (error) {
      caught = error;
    }

    expect(getDetails(caught)).toBe(NORA_ERROR_CODES.INDIVIDUAL_NAME_REQUIRED);
  });

  it("self_contact_delete_blocked — deleting the representing contact of a Privatkundenakte", async () => {
    const company = buildCompany({
      id: 1,
      name: "Placeholder",
      customer_kind: "individual",
      self_contact_id: 10,
    } as any);
    const contact = buildContact({
      id: 10,
      first_name: "Self",
      last_name: "Contact",
    });
    const dataProvider = createDataProvider({
      db: createCrmDb({ companies: [company], contacts: [contact] }),
      silent: true,
      latency: 0,
    });

    let caught: unknown;
    try {
      await dataProvider.delete("contacts", {
        id: contact.id,
        previousData: contact,
      });
    } catch (error) {
      caught = error;
    }

    expect(getDetails(caught)).toBe(
      NORA_ERROR_CODES.SELF_CONTACT_DELETE_BLOCKED,
    );
  });

  it("private_customer_already_exists — same person marked self_contact_id of a second individual customer record", async () => {
    const existingCompany = buildCompany({
      id: 1,
      name: "Existing Privatkundenakte",
      customer_kind: "individual",
      self_contact_id: 10,
    } as any);
    const contact = buildContact({
      id: 10,
      first_name: "Already",
      last_name: "Private",
    });
    const dataProvider = createDataProvider({
      db: createCrmDb({ companies: [existingCompany], contacts: [contact] }),
      silent: true,
      latency: 0,
    });

    let caught: unknown;
    try {
      await dataProvider.createCustomerWithContact({
        company: { name: "placeholder", customer_kind: "individual" },
        selfContactId: contact.id,
      } as any);
    } catch (error) {
      caught = error;
    }

    expect(getDetails(caught)).toBe(
      NORA_ERROR_CODES.PRIVATE_CUSTOMER_ALREADY_EXISTS,
    );
  });
});
