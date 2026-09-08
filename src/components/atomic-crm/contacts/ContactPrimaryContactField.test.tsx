import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { CreateBase, Form } from "ra-core";
import { Route, Routes } from "react-router";

import { SelectInput } from "@/components/admin/select-input";
import { SaveButton } from "@/components/admin/form";
import { buildCompany, buildContact, StoryWrapper } from "@/test/StoryWrapper";
import type { DataProvider } from "ra-core";

import { ContactEdit } from "./ContactEdit";
import { ContactPrimaryContactField } from "./ContactPrimaryContactField";
import { buildContactCreateTransform } from "./contactModel";
import { CONTACT_SAVE_INTENT_FIELD } from "../domain/contactPrimaryIntent";
import { NORA_ERROR_CODES } from "../domain/noraErrorCodes";
import { toCrmError } from "../misc/normalizeCrmError";

/**
 * Atomic Contact Primary Intent (2026-09-08) — the form shows the current
 * Hauptansprechpartner of the selected customer, explains the replacement
 * inline, re-resolves on customer change, and the save is ONE application
 * operation carrying the observed holder. Test i18n is English.
 */

const companies = [
  buildCompany({ id: 10, name: "Familie Krüger" }),
  buildCompany({ id: 11, name: "Rheinbogen Immobilienservice GmbH" }),
  buildCompany({ id: 12, name: "Leerkunde AG" }),
];

const contacts = [
  buildContact({
    id: 1,
    first_name: "Freddie",
    last_name: "Krüger",
    company_id: 10,
    is_primary: true,
    email_jsonb: [],
    phone_jsonb: [],
  }),
  buildContact({
    id: 2,
    first_name: "Hans",
    last_name: "Hilfe",
    company_id: 10,
    is_primary: false,
    email_jsonb: [],
    phone_jsonb: [],
  }),
  buildContact({
    id: 3,
    first_name: "Greta",
    last_name: "Grün",
    company_id: 11,
    is_primary: true,
    email_jsonb: [],
    phone_jsonb: [],
  }),
  buildContact({
    id: 4,
    first_name: "Olga",
    last_name: "Ohne",
    company_id: null,
    is_primary: false,
    email_jsonb: [],
    phone_jsonb: [],
  }),
];

const EditHarness = ({
  contactId,
  dataProvider,
}: {
  contactId: number;
  dataProvider?: Partial<DataProvider>;
}) => (
  <StoryWrapper
    initialEntries={[`/contacts/${contactId}`]}
    data={{ companies, contacts }}
    dataProvider={dataProvider}
    silent
  >
    <Routes>
      <Route path="/contacts/:id" element={<ContactEdit />} />
    </Routes>
  </StoryWrapper>
);

/** Minimal create form with a plain select, so the customer can be switched deterministically. */
const CreateHarness = ({
  dataProvider,
  defaultCompanyId,
}: {
  dataProvider?: Partial<DataProvider>;
  defaultCompanyId?: number | null;
}) => (
  <StoryWrapper
    initialEntries={["/"]}
    data={{ companies, contacts }}
    dataProvider={dataProvider}
    silent
  >
    <CreateBase
      resource="contacts"
      redirect={false}
      transform={buildContactCreateTransform({
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
      })}
    >
      <Form
        defaultValues={{
          first_name: "Träumchen",
          last_name: "Test",
          company_id: defaultCompanyId ?? null,
          sales_id: 0,
        }}
      >
        <SelectInput
          source="company_id"
          choices={companies.map((c) => ({ id: c.id, name: c.name }))}
          helperText={false}
        />
        <ContactPrimaryContactField mode="create" />
        <SaveButton label="Save contact" />
      </Form>
    </CreateBase>
  </StoryWrapper>
);

describe("ContactPrimaryContactField", () => {
  beforeAll(() => {
    page.viewport(1400, 900);
  });

  it("edit: shows the current holder for the customer when editing another contact", async () => {
    const screen = await render(<EditHarness contactId={2} />);
    await expect
      .element(screen.getByText("Currently: Freddie Krüger"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByLabelText("Primary contact"))
      .not.toBeChecked();
  });

  it("edit: editing the current primary says so", async () => {
    const screen = await render(<EditHarness contactId={1} />);
    await expect
      .element(
        screen.getByText("This person is currently the primary contact."),
      )
      .toBeInTheDocument();
    await expect
      .element(screen.getByLabelText("Primary contact"))
      .toBeChecked();
  });

  it("edit: no customer → no primary control at all", async () => {
    const screen = await render(<EditHarness contactId={4} />);
    await expect.element(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(
      screen.container.querySelector('[data-testid="contact-primary-field"]'),
    ).toBeNull();
  });

  it("edit: turning the switch on shows the replacement consequence and saves ONE operation with the observed holder", async () => {
    const updateMock = vi
      .fn()
      .mockImplementation(async (_resource: string, params: any) => ({
        data: { ...params.previousData, ...params.data, id: params.id },
      }));
    const setPrimaryMock = vi.fn();
    const screen = await render(
      <EditHarness
        contactId={2}
        dataProvider={
          { update: updateMock, setPrimaryContact: setPrimaryMock } as any
        }
      />,
    );
    await expect
      .element(screen.getByText("Currently: Freddie Krüger"))
      .toBeInTheDocument();

    await screen.getByLabelText("Primary contact").click();
    await expect
      .element(
        screen.getByText(
          "Freddie Krüger will be replaced as primary contact when you save.",
        ),
      )
      .toBeInTheDocument();
    // the inline explanation is not an error box
    expect(
      screen.container
        .querySelector('[data-testid="contact-primary-status"]')
        ?.getAttribute("data-tone"),
    ).toBe("emphasis");

    await screen.getByRole("button", { name: /^save$/i }).click();
    // undoable mutation: the provider call is deferred until the toast closes
    await screen.getByLabelText("Close toast").click();
    await expect.poll(() => updateMock.mock.calls.length).toBe(1);
    expect(setPrimaryMock).not.toHaveBeenCalled();
    const [, params] = updateMock.mock.calls[0];
    expect(params.data[CONTACT_SAVE_INTENT_FIELD]).toEqual({
      primary: { kind: "make_primary", expectedCurrentPrimaryContactId: 1 },
    });
    expect(params.data.is_primary).toBe(true);
  });

  it("edit: switching the current primary off saves a clear intent", async () => {
    const updateMock = vi
      .fn()
      .mockImplementation(async (_resource: string, params: any) => ({
        data: { ...params.previousData, ...params.data, id: params.id },
      }));
    const screen = await render(
      <EditHarness contactId={1} dataProvider={{ update: updateMock }} />,
    );
    await expect
      .element(
        screen.getByText("This person is currently the primary contact."),
      )
      .toBeInTheDocument();
    await screen.getByLabelText("Primary contact").click();
    await screen.getByRole("button", { name: /^save$/i }).click();
    await screen.getByLabelText("Close toast").click();
    await expect.poll(() => updateMock.mock.calls.length).toBe(1);
    expect(updateMock.mock.calls[0][1].data[CONTACT_SAVE_INTENT_FIELD]).toEqual(
      {
        primary: { kind: "clear" },
      },
    );
  });

  it("create: no holder state, replacement copy, and ONE create carrying the observed holder + idempotency key", async () => {
    const createMock = vi
      .fn()
      .mockImplementation(async (_resource: string, params: any) => ({
        data: { id: 99, ...params.data },
      }));
    const screen = await render(
      <CreateHarness
        defaultCompanyId={12}
        dataProvider={{ create: createMock }}
      />,
    );
    await expect
      .element(screen.getByText("No primary contact set yet."))
      .toBeInTheDocument();

    await screen.getByLabelText("Primary contact").click();
    // no holder → nothing to replace, copy stays calm
    await expect
      .element(screen.getByText("No primary contact set yet."))
      .toBeInTheDocument();

    await screen.getByRole("button", { name: "Save contact" }).click();
    await expect.poll(() => createMock.mock.calls.length).toBe(1);
    const [, params] = createMock.mock.calls[0];
    expect(params.data[CONTACT_SAVE_INTENT_FIELD]).toEqual({
      primary: { kind: "make_primary", expectedCurrentPrimaryContactId: null },
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    });
    expect(params.data).not.toHaveProperty("__nora_primary_observed");
  });

  it("create: changing the customer refreshes the holder, resets the switch, and the saved expectation belongs to the NEW customer", async () => {
    const createMock = vi
      .fn()
      .mockImplementation(async (_resource: string, params: any) => ({
        data: { id: 99, ...params.data },
      }));
    const screen = await render(
      <CreateHarness
        defaultCompanyId={10}
        dataProvider={{ create: createMock }}
      />,
    );
    await expect
      .element(screen.getByText("Currently: Freddie Krüger"))
      .toBeInTheDocument();
    await screen.getByLabelText("Primary contact").click();
    await expect
      .element(
        screen.getByText(
          "Freddie Krüger will be replaced as primary contact when you save.",
        ),
      )
      .toBeInTheDocument();

    // switch customer to Rheinbogen (holder Greta)
    await screen.getByRole("combobox", { name: /company/i }).click();
    await screen
      .getByRole("option", { name: "Rheinbogen Immobilienservice GmbH" })
      .click();

    await expect
      .element(screen.getByText("Currently: Greta Grün"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByLabelText("Primary contact"))
      .not.toBeChecked();
    expect(screen.container.textContent).not.toContain("Freddie Krüger");

    await screen.getByLabelText("Primary contact").click();
    await expect
      .element(
        screen.getByText(
          "Greta Grün will be replaced as primary contact when you save.",
        ),
      )
      .toBeInTheDocument();

    await screen.getByRole("button", { name: "Save contact" }).click();
    await expect.poll(() => createMock.mock.calls.length).toBe(1);
    const [, params] = createMock.mock.calls[0];
    expect(String(params.data.company_id)).toBe("11");
    expect(params.data[CONTACT_SAVE_INTENT_FIELD].primary).toEqual({
      kind: "make_primary",
      expectedCurrentPrimaryContactId: 3,
    });
  });

  it("stale conflict is presented with the stable product message, never the generic load error", async () => {
    const updateMock = vi.fn().mockImplementation(async () => {
      throw toCrmError({
        code: "P0001",
        message:
          "primary contact of customer 10 changed since the form was loaded",
        details: NORA_ERROR_CODES.PRIMARY_CONTACT_CHANGED,
      });
    });
    const screen = await render(
      <EditHarness contactId={2} dataProvider={{ update: updateMock }} />,
    );
    await expect
      .element(screen.getByText("Currently: Freddie Krüger"))
      .toBeInTheDocument();
    await screen.getByLabelText("Primary contact").click();
    await screen.getByRole("button", { name: /^save$/i }).click();
    await expect
      .element(
        screen.getByText(
          "The primary contact has changed in the meantime. Please review your selection.",
        ),
      )
      .toBeInTheDocument();
    expect(screen.container.textContent).not.toContain("could not be loaded");
  });

  it("a legacy raw-constraint conflict is presented as 'already has a primary contact'", async () => {
    const updateMock = vi.fn().mockImplementation(async () => {
      throw toCrmError({
        code: "23505",
        message:
          'duplicate key value violates unique constraint "uq_contacts_one_primary_per_company"',
        details: "Key (company_id)=(10) already exists.",
      });
    });
    const screen = await render(
      <EditHarness contactId={2} dataProvider={{ update: updateMock }} />,
    );
    await expect
      .element(screen.getByText("Currently: Freddie Krüger"))
      .toBeInTheDocument();
    await screen.getByLabelText("Primary contact").click();
    await screen.getByRole("button", { name: /^save$/i }).click();
    await expect
      .element(screen.getByText("This customer already has a primary contact."))
      .toBeInTheDocument();
  });
});
