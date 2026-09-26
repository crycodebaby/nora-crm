import {
  Form,
  RecordContextProvider,
  ResourceContextProvider,
  useRefresh,
} from "ra-core";
import { useFormContext } from "react-hook-form";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { describe, expect, it, vi } from "vitest";
import { StoryWrapper } from "@/test/StoryWrapper";
import type { Deal } from "../types";
import { DealSiteAddressInputs } from "./DealSiteAddressInputs";
import { DealSiteAddress } from "./DealSiteAddress";

const Controls = () => {
  const { setValue } = useFormContext();
  const refresh = useRefresh();
  return (
    <>
      <button type="button" onClick={() => setValue("company_id", 0)}>
        Kunde null-id
      </button>
      <button type="button" onClick={() => setValue("company_id", 1)}>
        Anderer Kunde
      </button>
      <button type="button" onClick={() => setValue("company_id", null)}>
        Kein Kunde
      </button>
      <button type="button" onClick={() => refresh()}>
        Kundendaten aktualisieren
      </button>
    </>
  );
};
const street = () =>
  page.getByRole("textbox", { name: "Straße und Hausnummer", exact: true });
const city = () => page.getByRole("textbox", { name: "Ort", exact: true });
const setup = async (record: Partial<Deal> = {}, getOneOverride?: any) => {
  const getOne =
    getOneOverride ??
    vi.fn(async (_resource: string, { id }: { id: number }) => ({
      data: {
        id,
        name: `Kunde ${id}`,
        address: Number(id) === 0 ? "Erste Straße 1" : "Zweite Straße 2",
        city: Number(id) === 0 ? "Bonn" : "Köln",
      },
    }));
  await render(
    <StoryWrapper dataProvider={{ getOne }}>
      <ResourceContextProvider value="deals">
        <RecordContextProvider value={record}>
          <Form defaultValues={{ company_id: null, ...record }}>
            <Controls />
            <DealSiteAddressInputs />
          </Form>
        </RecordContextProvider>
      </ResourceContextProvider>
    </StoryWrapper>,
  );
  await expect.element(street()).toBeVisible();
  return getOne;
};
const chooseFirst = async () => {
  await userEvent.click(page.getByRole("button", { name: "Kunde null-id" }));
  await expect.element(street()).toHaveValue("Erste Straße 1");
};

describe("Frozen deal site address contract", () => {
  it("does not fetch for null; suggests for company 0 and follows a pristine customer change", async () => {
    const getOne = await setup();
    expect(getOne).not.toHaveBeenCalled();
    await chooseFirst();
    await expect.element(city()).toHaveValue("Bonn");
    await userEvent.click(page.getByRole("button", { name: "Anderer Kunde" }));
    await expect.element(street()).toHaveValue("Zweite Straße 2");
    await expect.element(city()).toHaveValue("Köln");
  });
  for (const field of [
    "Straße und Hausnummer",
    "Ort",
    "Etage",
    "Klingelschild / Mietername",
  ]) {
    it(`preserves all site fields after manually editing ${field}`, async () => {
      await setup();
      await chooseFirst();
      await userEvent.click(
        page.getByRole("button", { name: "Etage oder Klingelschild ergänzen" }),
      );
      await userEvent.fill(
        page.getByRole("textbox", { name: field, exact: true }),
        "Eigener Wert",
      );
      await userEvent.click(
        page.getByRole("button", { name: "Anderer Kunde" }),
      );
      await userEvent.click(
        page.getByRole("button", { name: "Kundendaten aktualisieren" }),
      );
      await expect
        .element(page.getByRole("textbox", { name: field, exact: true }))
        .toHaveValue("Eigener Wert");
      await expect
        .element(street())
        .toHaveValue(
          field === "Straße und Hausnummer" ? "Eigener Wert" : "Erste Straße 1",
        );
      await expect
        .element(city())
        .toHaveValue(field === "Ort" ? "Eigener Wert" : "Bonn");
    });
  }
  it("never repopulates an explicitly cleared individual field", async () => {
    await setup();
    await chooseFirst();
    await userEvent.clear(street());
    await userEvent.click(page.getByRole("button", { name: "Anderer Kunde" }));
    await expect.element(street()).toHaveValue("");
    await expect.element(city()).toHaveValue("Bonn");
  });
  it("clears all four fields and keeps them empty across customer changes", async () => {
    await setup();
    await chooseFirst();
    await userEvent.click(
      page.getByRole("button", { name: "Etage oder Klingelschild ergänzen" }),
    );
    await userEvent.fill(
      page.getByRole("textbox", { name: "Etage", exact: true }),
      "2. OG",
    );
    await userEvent.fill(
      page.getByRole("textbox", {
        name: "Klingelschild / Mietername",
        exact: true,
      }),
      "Mustermann",
    );
    await userEvent.click(
      page.getByRole("button", { name: "Einsatzadresse vollständig löschen" }),
    );
    await userEvent.click(page.getByRole("button", { name: "Anderer Kunde" }));
    await expect.element(street()).toHaveValue("");
    await expect.element(city()).toHaveValue("");
    await userEvent.click(
      page.getByRole("button", { name: "Etage oder Klingelschild ergänzen" }),
    );
    await expect
      .element(page.getByRole("textbox", { name: "Etage", exact: true }))
      .toHaveValue("");
    await expect
      .element(
        page.getByRole("textbox", {
          name: "Klingelschild / Mietername",
          exact: true,
        }),
      )
      .toHaveValue("");
  });
  it("does not overwrite user input when the initial customer read arrives late", async () => {
    let resolve!: (result: any) => void;
    const pending = new Promise((resolvePromise) => {
      resolve = resolvePromise;
    });
    const getOne = vi.fn(() => pending);
    await setup({}, getOne);
    await userEvent.click(page.getByRole("button", { name: "Kunde null-id" }));
    await expect.poll(() => getOne.mock.calls.length).toBeGreaterThan(0);
    await userEvent.fill(street(), "Schon eingegeben");
    resolve({ data: { id: 0, address: "Späte Antwort", city: "Bonn" } });
    await expect.element(street()).toHaveValue("Schon eingegeben");
    await expect.element(city()).toHaveValue("");
  });
  it("never copies while editing, including an existing deal with id 0 and empty site", async () => {
    const getOne = await setup({
      id: 0,
      company_id: 0,
      site_street: null,
      site_city: null,
    });
    await userEvent.click(page.getByRole("button", { name: "Anderer Kunde" }));
    await userEvent.click(
      page.getByRole("button", { name: "Kundendaten aktualisieren" }),
    );
    expect(getOne).not.toHaveBeenCalled();
    await expect.element(street()).toHaveValue("");
    await expect.element(city()).toHaveValue("");
  });
  it("preserves a stored site after later customer changes", async () => {
    await setup({
      id: 23,
      company_id: 0,
      site_street: "Gespeicherter Einsatzort",
      site_city: "Essen",
      site_floor: "3",
      site_tenant_name: "Alt",
    });
    await userEvent.click(page.getByRole("button", { name: "Anderer Kunde" }));
    await userEvent.click(
      page.getByRole("button", { name: "Kundendaten aktualisieren" }),
    );
    await expect.element(street()).toHaveValue("Gespeicherter Einsatzort");
    await expect.element(city()).toHaveValue("Essen");
    await expect
      .element(page.getByRole("textbox", { name: "Etage", exact: true }))
      .toHaveValue("3");
  });
  it("renders only the stored deal site", async () => {
    await render(
      <DealSiteAddress
        deal={{ site_street: "Gespeicherte Straße", site_city: "Essen" }}
      />,
    );
    await expect
      .element(page.getByText("Gespeicherte Straße · Essen"))
      .toBeVisible();
  });
});
