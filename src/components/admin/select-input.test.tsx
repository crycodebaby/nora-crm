import type { ReactNode } from "react";
import { CoreAdminContext } from "ra-core";
import fakeDataProvider from "ra-data-fakerest";
import { render } from "vitest-browser-react";

import { SimpleForm } from "./simple-form";
import { SelectInput } from "./select-input";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <CoreAdminContext
    dataProvider={fakeDataProvider({})}
    i18nProvider={{
      translate: (key, options) =>
        typeof options?._ === "string" ? options._ : key,
      changeLocale: () => Promise.resolve(),
      getLocale: () => "en",
    }}
  >
    {children}
  </CoreAdminContext>
);

const SelectInputHarness = ({ clearable }: { clearable?: boolean }) => (
  <SimpleForm defaultValues={{ status: "open" }} toolbar={null}>
    <SelectInput
      source="status"
      choices={[
        { id: "open", name: "Open" },
        { id: "closed", name: "Closed" },
      ]}
      clearable={clearable}
    />
  </SimpleForm>
);

describe("SelectInput", () => {
  it("renders the clear action as a separate accessible button", async () => {
    const screen = await render(<SelectInputHarness />, { wrapper: Wrapper });

    const trigger = screen.getByRole("combobox", { name: "status" });
    const clearButton = screen.getByRole("button", { name: "Clear selection" });

    await expect.element(trigger).toHaveTextContent("Open");
    await expect.element(clearButton).toBeVisible();
    expect(trigger.element().querySelector('[role="button"]')).toBeNull();

    await clearButton.click();

    await expect.element(clearButton).not.toBeInTheDocument();
  });

  it("can suppress independent clearing for row-owned type values", async () => {
    const screen = await render(<SelectInputHarness clearable={false} />, {
      wrapper: Wrapper,
    });

    await expect
      .element(screen.getByRole("combobox", { name: "status" }))
      .toHaveTextContent("Open");
    await expect
      .element(screen.getByRole("button", { name: "Clear selection" }))
      .not.toBeInTheDocument();
  });
});
