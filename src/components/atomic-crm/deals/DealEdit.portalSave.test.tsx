import { ResourceContextProvider } from "ra-core";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoryWrapper } from "@/test/StoryWrapper";
import {
  setDefaultOperationErrorRecorder,
  type OperationErrorPersistInput,
  type OperationErrorPersistResult,
} from "../operations/errorObservatory";
import { executeDealUpdate } from "../operations/executeDealUpdate";
import {
  getDefaultOperationManager,
  resetDefaultOperationManagerForTests,
} from "../operations/operationManager";
import { NORA_OPERATION_ID_HEADER } from "../operations/operationContext";
import type { Deal } from "../types";
import { DealEdit } from "./DealEdit";

const company = {
  id: 1,
  name: "Portal Test GmbH",
  customer_number: "KD-100001",
};

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

type DealEditFormSpy = {
  values: Record<string, unknown>;
  errors: Record<string, unknown>;
  isValid: boolean;
  isDirty: boolean;
};

const getFormSpy = () =>
  (
    window as unknown as {
      __noraDealEditForm?: () => DealEditFormSpy;
    }
  ).__noraDealEditForm?.();

const renderDealEdit = async (
  update: ReturnType<
    typeof vi.fn<
      (
        resource: string,
        params: {
          id: string | number;
          data: Record<string, unknown>;
          previousData: Record<string, unknown>;
          meta?: { headers?: Record<string, string> };
        },
      ) => Promise<{ data: Deal }>
    >
  >,
) => {
  // Stay on `/` so StoryWrapper dashboard mounts DealEdit (not resource routes).
  // Keep Wave-2 executeDealUpdate wrapper so operation headers stay on the path.
  const updateWithOperations = async (
    resource: string,
    params: {
      id: string | number;
      data: Record<string, unknown>;
      previousData: Record<string, unknown>;
      meta?: { headers?: Record<string, string> };
    },
  ) => {
    if (resource !== "deals") {
      return update(resource, params);
    }
    return executeDealUpdate(params, (res, nextParams) =>
      update(res, nextParams as typeof params),
    );
  };

  await render(
    <StoryWrapper
      data={{
        companies: [company as never],
        deals: [baseDeal],
      }}
      dataProvider={{ update: updateWithOperations as never }}
    >
      <ResourceContextProvider value="deals">
        <DealEdit open id="15" />
      </ResourceContextProvider>
    </StoryWrapper>,
  );

  await expect
    .element(page.getByRole("button", { name: /Speichern|Save/i }))
    .toBeVisible();

  // Wait until EditBase + references have populated a valid RHF form.
  await expect
    .poll(() => {
      const spy = getFormSpy();
      return (
        spy?.isValid === true &&
        spy.values.company_id === 1 &&
        spy.values.stage === "neue-anfrage"
      );
    })
    .toBe(true);

  const saveButton = document.querySelector(
    '[data-slot="dialog-content"] button[type="submit"]',
  ) as HTMLButtonElement | null;
  expect(saveButton).toBeTruthy();
  // Portal ownership: Save must be a real descendant of the <form>.
  expect(saveButton!.form).not.toBeNull();
  expect(saveButton!.form!.contains(saveButton!)).toBe(true);
};

describe("DealEdit portal form save (Stabilization Gate 2 + Wave 3)", () => {
  beforeEach(() => {
    resetDefaultOperationManagerForTests();
    // CRM imports supabase provider (side-effect wires default recorder).
    // Isolate FakeRest portal tests from real Supabase RPC.
    setDefaultOperationErrorRecorder(null);
  });

  afterEach(() => {
    resetDefaultOperationManagerForTests();
    setDefaultOperationErrorRecorder(null);
  });

  it("clicks visible Speichern and updates expected_closing_date once", async () => {
    const recordError = vi.fn<
      (
        input: OperationErrorPersistInput,
      ) => Promise<OperationErrorPersistResult>
    >(async () => ({
      errorId: "should-not-call",
      publicRef: "NORA-E00000000",
    }));
    setDefaultOperationErrorRecorder(recordError);

    const update = vi.fn(
      async (
        _resource: string,
        params: {
          id: string | number;
          data: Record<string, unknown>;
          previousData: Record<string, unknown>;
          meta?: { headers?: Record<string, string> };
        },
      ) => ({
        data: { ...baseDeal, ...params.data } as Deal,
      }),
    );

    await renderDealEdit(update);

    const dateField = page.getByLabelText(
      /Kontakttermin|contact date|closing/i,
    );
    await expect.element(dateField).toBeVisible();
    await userEvent.fill(dateField, "2026-09-01");
    await userEvent.tab();

    await expect
      .poll(() => getFormSpy()?.values.expected_closing_date === "2026-09-01")
      .toBe(true);

    // Click the actual visible Save control — do NOT call submit handlers directly.
    await userEvent.click(page.getByRole("button", { name: /Speichern|Save/i }));

    await expect.poll(() => update.mock.calls.length).toBe(1);

    expect(update.mock.calls[0]?.[0]).toBe("deals");
    expect(update.mock.calls[0]?.[1]?.data).toMatchObject({
      expected_closing_date: "2026-09-01",
    });
    expect(
      update.mock.calls[0]?.[1]?.meta?.headers?.[NORA_OPERATION_ID_HEADER],
    ).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    // Wave 3: one managed deal.update → success; no Error Observatory row/attempt.
    const ops = getDefaultOperationManager().getOperations();
    expect(ops).toHaveLength(1);
    expect(ops[0].operationType).toBe("deal.update");
    expect(ops[0].status).toBe("success");
    expect(ops[0].persistentErrorId).toBeUndefined();
    expect(recordError).not.toHaveBeenCalled();
  });

  it("clicks Speichern for description change", async () => {
    const update = vi.fn(
      async (
        _resource: string,
        params: {
          id: string | number;
          data: Record<string, unknown>;
          previousData: Record<string, unknown>;
          meta?: { headers?: Record<string, string> };
        },
      ) => ({
        data: { ...baseDeal, ...params.data } as Deal,
      }),
    );

    await renderDealEdit(update);

    const description = page.getByLabelText(/Beschreibung|Description/i);
    await userEvent.clear(description);
    await userEvent.fill(description, "Neue Beschreibung");

    await expect
      .poll(() => getFormSpy()?.values.description === "Neue Beschreibung")
      .toBe(true);

    await userEvent.click(page.getByRole("button", { name: /Speichern|Save/i }));

    await expect.poll(() => update.mock.calls.length).toBe(1);
    expect(update.mock.calls[0]?.[1]?.data).toMatchObject({
      description: "Neue Beschreibung",
    });
  });

  it("keeps React Admin error path when update rejects", async () => {
    const recordError = vi.fn<
      (
        input: OperationErrorPersistInput,
      ) => Promise<OperationErrorPersistResult>
    >(async () => ({
      errorId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      publicRef: "NORA-E7K4M2PD",
    }));
    setDefaultOperationErrorRecorder(recordError);

    const serverError = { status: 500, message: "boom" };
    const update = vi.fn(async () => {
      throw serverError;
    });

    await renderDealEdit(update);

    const description = page.getByLabelText(/Beschreibung|Description/i);
    await userEvent.clear(description);
    await userEvent.fill(description, "Fehlerpfad");
    await expect
      .poll(() => getFormSpy()?.values.description === "Fehlerpfad")
      .toBe(true);
    await expect.poll(() => getFormSpy()?.isDirty === true).toBe(true);

    await userEvent.click(page.getByRole("button", { name: /Speichern|Save/i }));

    await expect.poll(() => update.mock.calls.length).toBe(1);
    await expect.poll(() => recordError.mock.calls.length).toBe(1);

    await expect
      .poll(() => {
        const op = getDefaultOperationManager().getOperations()[0];
        return (
          op?.status === "error" &&
          op.persistentErrorId === "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" &&
          op.publicErrorRef === "NORA-E7K4M2PD"
        );
      })
      .toBe(true);

    const op = getDefaultOperationManager().getOperations()[0];
    expect(op.operationType).toBe("deal.update");

    await expect.element(description).toHaveValue("Fehlerpfad");
    await expect.poll(() => getFormSpy()?.isDirty === true).toBe(true);

    await expect
      .poll(
        () =>
          document.body.textContent?.includes("Vorgang gespeichert") ?? false,
      )
      .toBe(false);
  });
});
