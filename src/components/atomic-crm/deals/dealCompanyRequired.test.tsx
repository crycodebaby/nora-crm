import { ListBase, ResourceContextProvider } from "ra-core";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoryWrapper } from "@/test/StoryWrapper";
import { setDefaultOperationErrorRecorder } from "../operations/errorObservatory";
import { resetDefaultOperationManagerForTests } from "../operations/operationManager";
import type { Deal } from "../types";
import { DealCreate } from "./DealCreate";
import { DealEdit } from "./DealEdit";

/**
 * W7-R1B (2026-09-13): every Nora deal belongs to exactly one company. The
 * deal form already requires a customer (`DealInputs`, `required()`); these
 * tests pin that the form never submits a deal without one, and that company
 * id 0 counts as a chosen customer (nullish, not truthiness).
 */

const companies = [
  { id: 0, name: "Null-Id Kunde GmbH", customer_number: "KD-100000" },
  { id: 1, name: "Portal Test GmbH", customer_number: "KD-100001" },
];

const baseDeal: Deal = {
  id: 15,
  name: "Fenster Wartung",
  company_id: 1,
  contact_ids: [],
  category: "fensterservice",
  stage: "neue-anfrage",
  description: "Ausgangstext",
  amount: 100,
  created_at: "2026-08-01T10:00:00.000Z",
  updated_at: "2026-08-01T10:00:00.000Z",
  expected_closing_date: "2026-08-10",
  sales_id: 0,
  index: 0,
  case_number: "VG-100015",
};

type FormSpy = {
  values: Record<string, unknown>;
  errors: Record<string, unknown>;
  isValid: boolean;
};

const getEditFormSpy = () =>
  (
    window as unknown as { __noraDealEditForm?: () => FormSpy }
  ).__noraDealEditForm?.();

const selectCompany = async (name: string) => {
  await userEvent.click(page.getByRole("combobox", { name: /Company|Kunde/i }));
  await userEvent.click(page.getByRole("option", { name }));
  await expect
    .element(page.getByRole("combobox", { name: /Company|Kunde/i }))
    .toHaveTextContent(name);
};

const clickSave = async () => {
  await userEvent.click(page.getByRole("button", { name: /Speichern|Save/i }));
};

describe("Deal form requires a company (W7-R1B)", () => {
  beforeEach(() => {
    resetDefaultOperationManagerForTests();
    setDefaultOperationErrorRecorder(null);
  });

  afterEach(() => {
    resetDefaultOperationManagerForTests();
    setDefaultOperationErrorRecorder(null);
  });

  describe("DealCreate", () => {
    const renderCreate = async (create: ReturnType<typeof vi.fn>) => {
      await render(
        <StoryWrapper
          data={{ companies: companies as never }}
          dataProvider={{ create: create as never }}
        >
          <ListBase resource="deals" disableSyncWithLocation>
            <DealCreate open />
          </ListBase>
        </StoryWrapper>,
      );
      await expect
        .element(page.getByRole("button", { name: /Speichern|Save/i }))
        .toBeVisible();
      const nameInput = document.querySelector(
        'input[name="name"]',
      ) as HTMLInputElement | null;
      expect(nameInput).toBeTruthy();
      await userEvent.fill(nameInput!, "Haustür klemmt");
    };

    it("does not submit without a customer", async () => {
      const create = vi.fn(async (_resource: string, params: any) => ({
        data: { ...params.data, id: 99 },
      }));
      await renderCreate(create);

      await clickSave();

      await expect.element(page.getByText("Required")).toBeVisible();
      // Give a would-be submit time to reach the provider.
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(create).not.toHaveBeenCalled();
    });

    it("submits once a customer is chosen", async () => {
      const create = vi.fn(async (_resource: string, params: any) => ({
        data: { ...params.data, id: 99 },
      }));
      await renderCreate(create);
      await selectCompany("Portal Test GmbH");

      await clickSave();

      await expect.poll(() => create.mock.calls.length).toBe(1);
      expect(create.mock.calls[0]?.[0]).toBe("deals");
      expect(create.mock.calls[0]?.[1]?.data).toMatchObject({
        company_id: 1,
        name: "Haustür klemmt",
      });
    });

    it("treats company id 0 as a chosen customer", async () => {
      const create = vi.fn(async (_resource: string, params: any) => ({
        data: { ...params.data, id: 99 },
      }));
      await renderCreate(create);
      await selectCompany("Null-Id Kunde GmbH");

      await clickSave();

      await expect.poll(() => create.mock.calls.length).toBe(1);
      expect(create.mock.calls[0]?.[1]?.data).toMatchObject({ company_id: 0 });
    });
  });

  describe("DealEdit", () => {
    const renderEdit = async (deal: Deal, update: ReturnType<typeof vi.fn>) => {
      await render(
        <StoryWrapper
          data={{ companies: companies as never, deals: [deal] }}
          dataProvider={{ update: update as never }}
        >
          <ResourceContextProvider value="deals">
            <DealEdit open id={String(deal.id)} />
          </ResourceContextProvider>
        </StoryWrapper>,
      );
      await expect
        .poll(() => {
          const spy = getEditFormSpy();
          return (
            spy?.values.name === deal.name &&
            spy.values.company_id === deal.company_id
          );
        })
        .toBe(true);
      // Let EditBase settle so the edit below isn't overwritten by a reset.
      await new Promise((resolve) => setTimeout(resolve, 300));
      const description = page.getByLabelText(/Beschreibung|Description/i);
      await userEvent.clear(description);
      await userEvent.fill(description, "Geänderte Beschreibung");
      await expect
        .poll(
          () =>
            getEditFormSpy()?.values.description === "Geänderte Beschreibung",
        )
        .toBe(true);
    };

    it("blocks saving when the customer field is empty", async () => {
      const update = vi.fn(async (_resource: string, params: any) => ({
        data: { ...params.previousData, ...params.data },
      }));
      await renderEdit(
        {
          ...baseDeal,
          company_id: null as unknown as Deal["company_id"],
        },
        update,
      );

      await clickSave();

      await expect
        .poll(() => getEditFormSpy()?.errors.company_id != null)
        .toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(update).not.toHaveBeenCalled();
    });

    it("saves normally while the customer is kept, including company id 0", async () => {
      const update = vi.fn(async (_resource: string, params: any) => ({
        data: { ...params.previousData, ...params.data },
      }));
      await renderEdit({ ...baseDeal, company_id: 0 }, update);

      await clickSave();

      await expect.poll(() => update.mock.calls.length).toBe(1);
      expect(update.mock.calls[0]?.[1]?.data).toMatchObject({
        company_id: 0,
        description: "Geänderte Beschreibung",
      });
    });
  });
});
