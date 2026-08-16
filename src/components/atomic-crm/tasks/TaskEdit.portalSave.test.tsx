import { ResourceContextProvider, type UpdateParams } from "ra-core";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { describe, expect, it, vi } from "vitest";

import { buildContact, StoryWrapper } from "@/test/StoryWrapper";
import type { Task } from "../types";
import { TaskEdit } from "./TaskEdit";

const contact = buildContact({ id: 1 });

const baseTask: Task = {
  id: 7,
  contact_id: 1,
  type: "rueckruf",
  text: "Kunde anrufen",
  due_date: "2026-08-15T10:00:00.000Z",
  sales_id: 0,
};

type TaskEditFormSpy = {
  values: Record<string, unknown>;
  errors: Record<string, unknown>;
  isValid: boolean;
  isDirty: boolean;
};

const getFormSpy = () =>
  (
    window as unknown as {
      __noraTaskEditForm?: () => TaskEditFormSpy;
    }
  ).__noraTaskEditForm?.();

const renderTaskEdit = async (
  update: ReturnType<
    typeof vi.fn<
      (resource: string, params: UpdateParams<Task>) => Promise<{ data: Task }>
    >
  >,
) => {
  await render(
    <StoryWrapper
      data={{
        contacts: [contact],
        tasks: [baseTask],
      }}
      dataProvider={{ update: update as never }}
    >
      <ResourceContextProvider value="tasks">
        <TaskEdit open taskId={7} close={() => undefined} />
      </ResourceContextProvider>
    </StoryWrapper>,
  );

  await expect
    .element(page.getByRole("button", { name: /Speichern|Save/i }))
    .toBeVisible();

  await expect
    .poll(() => {
      const spy = getFormSpy();
      return spy?.isValid === true && spy.values.text === "Kunde anrufen";
    })
    .toBe(true);

  const saveButton = document.querySelector(
    '[data-slot="dialog-content"] button[type="submit"]',
  ) as HTMLButtonElement | null;
  expect(saveButton).toBeTruthy();
  expect(saveButton!.form).not.toBeNull();
  expect(saveButton!.form!.contains(saveButton!)).toBe(true);
};

describe("TaskEdit portal form save (Stabilization Gate 2b)", () => {
  it("clicks visible Speichern and updates text once", async () => {
    const update = vi.fn(
      async (_resource: string, params: UpdateParams<Task>) => ({
        data: { ...baseTask, ...params.data } as Task,
      }),
    );

    await renderTaskEdit(update);

    const textField = page.getByLabelText(/Beschreibung|Description|Text/i);
    await userEvent.clear(textField);
    await userEvent.fill(textField, "Neuer Aufgabentext");

    await expect
      .poll(() => getFormSpy()?.values.text === "Neuer Aufgabentext")
      .toBe(true);
    await expect.poll(() => getFormSpy()?.isValid === true).toBe(true);

    await userEvent.click(
      page.getByRole("button", { name: /Speichern|Save/i }),
    );

    await expect.poll(() => update.mock.calls.length).toBe(1);
    expect(update.mock.calls[0]?.[0]).toBe("tasks");
    expect(update.mock.calls[0]?.[1]).toMatchObject({
      data: expect.objectContaining({ text: "Neuer Aufgabentext" }),
    });
  });

  it("keeps values when update rejects", async () => {
    const serverError = { status: 500, message: "boom" };
    const update = vi.fn(async () => {
      throw serverError;
    });

    await renderTaskEdit(update);

    const textField = page.getByLabelText(/Beschreibung|Description|Text/i);
    await userEvent.clear(textField);
    await userEvent.fill(textField, "Fehlerpfad");
    await expect
      .poll(() => getFormSpy()?.values.text === "Fehlerpfad")
      .toBe(true);
    await expect.poll(() => getFormSpy()?.isValid === true).toBe(true);

    await userEvent.click(
      page.getByRole("button", { name: /Speichern|Save/i }),
    );

    await expect.poll(() => update.mock.calls.length).toBe(1);
    await expect.element(textField).toHaveValue("Fehlerpfad");

    await expect
      .poll(
        () =>
          document.body.textContent?.includes("Aufgabe aktualisiert") ||
          document.body.textContent?.includes("Task updated") ||
          false,
      )
      .toBe(false);
  });
});
