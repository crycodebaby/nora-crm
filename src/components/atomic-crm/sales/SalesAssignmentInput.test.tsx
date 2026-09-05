import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { CoreAdminContext, Form, RecordContextProvider } from "ra-core";
import fakeDataProvider from "ra-data-fakerest";

import { SalesAssignmentInput } from "./SalesAssignmentInput";

/**
 * User Lifecycle W2 hardening: an existing record owned by a since-disabled
 * employee keeps showing that employee by name, while the choice list only
 * offers active employees and never re-offers the disabled one.
 */
const ANNA = { id: 1, first_name: "Anna", last_name: "Aktiv", avatar: null };
const BEN = { id: 3, first_name: "Ben", last_name: "Bereit", avatar: null };
const ERIKA = {
  id: 2,
  first_name: "Erika",
  last_name: "Ehemalig",
  avatar: null,
};

const createProvider = () =>
  fakeDataProvider({
    sales_directory: [ANNA, BEN],
    sales_identities: [
      { ...ANNA, disabled: false },
      { ...BEN, disabled: false },
      { ...ERIKA, disabled: true },
    ],
  });

const Harness = ({ record }: { record: Record<string, unknown> }) => (
  <CoreAdminContext dataProvider={createProvider()}>
    <RecordContextProvider value={record}>
      <Form record={record} onSubmit={() => undefined}>
        <SalesAssignmentInput />
      </Form>
    </RecordContextProvider>
  </CoreAdminContext>
);

const optionByName = (name: string) =>
  page.getByRole("option", { name, exact: false });

describe("SalesAssignmentInput (W2 hardening)", () => {
  it("keeps the disabled current owner visible but not selectable, offers active employees", async () => {
    const screen = await render(<Harness record={{ id: 10, sales_id: 2 }} />);

    await vi.waitFor(() => {
      expect(screen.container.textContent).toContain("Erika Ehemalig");
    });

    await page.getByRole("combobox").click();
    await vi.waitFor(async () => {
      await expect.element(optionByName("Anna Aktiv")).toBeInTheDocument();
    });
    await expect.element(optionByName("Ben Bereit")).toBeInTheDocument();

    const erika = optionByName("Erika Ehemalig");
    await expect.element(erika).toBeInTheDocument();
    await expect.element(erika).toHaveAttribute("aria-disabled", "true");
    await expect
      .element(optionByName("Anna Aktiv"))
      .not.toHaveAttribute("aria-disabled", "true");
  });

  it("does not add a disabled employee when the record is owned by an active one", async () => {
    const screen = await render(<Harness record={{ id: 11, sales_id: 1 }} />);

    await vi.waitFor(() => {
      expect(screen.container.textContent).toContain("Anna Aktiv");
    });
    await page.getByRole("combobox").click();
    await vi.waitFor(async () => {
      await expect.element(optionByName("Ben Bereit")).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain("Erika Ehemalig");
  });
});
