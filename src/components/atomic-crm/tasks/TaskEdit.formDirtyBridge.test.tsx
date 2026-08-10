/**
 * Pre-push Gate 2b: FormDirtyBridge is a one-way mirror of RHF isDirty.
 * Does not invent a second authoritative form truth.
 *
 * Does not touch Foundation Wave 3 working-tree files.
 */
import { ResourceContextProvider, type UpdateParams } from "ra-core";
import { useCallback, useState } from "react";
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

const discardTitle = /Discard changes\?|Änderungen verwerfen\?/i;
const keepEditing = /Keep editing|Weiter bearbeiten/i;
const confirmDiscard = /^Discard changes$|^Änderungen verwerfen$/i;

const TaskEditHost = ({
  onClose,
  unmountOnClose = true,
}: {
  onClose?: () => void;
  /** When false, close() is observed but dialog stays mounted (success/reset assertions). */
  unmountOnClose?: boolean;
}) => {
  const [open, setOpen] = useState(true);
  const close = useCallback(() => {
    onClose?.();
    if (unmountOnClose) setOpen(false);
  }, [onClose, unmountOnClose]);

  return (
    <>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)}>
          Reopen task
        </button>
      ) : null}
      <ResourceContextProvider value="tasks">
        <TaskEdit open={open} taskId={7} close={close} />
      </ResourceContextProvider>
      <span data-testid="task-edit-host" data-open={open ? "1" : "0"} />
    </>
  );
};

const renderHost = async (
  update: ReturnType<
    typeof vi.fn<
      (
        resource: string,
        params: UpdateParams<Task>,
      ) => Promise<{ data: Task }>
    >
  >,
  options?: { onClose?: () => void; unmountOnClose?: boolean },
) => {
  await render(
    <StoryWrapper
      data={{
        contacts: [contact],
        tasks: [baseTask],
      }}
      dataProvider={{ update: update as never }}
    >
      <TaskEditHost
        onClose={options?.onClose}
        unmountOnClose={options?.unmountOnClose}
      />
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
};

const clickDialogClose = async () => {
  // Exact "Close" — not DeleteButton and not toast "Close toast".
  await userEvent.click(page.getByRole("button", { name: "Close", exact: true }));
};

/**
 * RHF isDirty flips synchronously; Dialog mirror updates after FormDirtyBridge's
 * useEffect + parent re-render. Wait until that settle so discard guard is armed.
 */
const waitForDirtyMirror = async () => {
  await expect.poll(() => getFormSpy()?.isDirty === true).toBe(true);
  await new Promise((r) => setTimeout(r, 50));
};

const expectDiscardConfirmVisible = async () => {
  await expect
    .element(page.getByRole("heading", { name: discardTitle }))
    .toBeVisible();
};

describe("TaskEdit FormDirtyBridge single source of truth (Gate 2b pre-push)", () => {
  it("A: initial open → RHF isDirty false (mirror starts clean)", async () => {
    const update = vi.fn(async (_r, params: UpdateParams<Task>) => ({
      data: { ...baseTask, ...params.data } as Task,
    }));
    await renderHost(update);

    expect(getFormSpy()?.isDirty).toBe(false);

    await clickDialogClose();
    await expect
      .poll(() => document.body.textContent?.match(discardTitle) ?? null)
      .toBeNull();
    await expect
      .poll(
        () =>
          document
            .querySelector('[data-testid="task-edit-host"]')
            ?.getAttribute("data-open") === "0",
      )
      .toBe(true);
  });

  it("B/C: field change → RHF dirty; close shows discard guard", async () => {
    const update = vi.fn(async (_r, params: UpdateParams<Task>) => ({
      data: { ...baseTask, ...params.data } as Task,
    }));
    await renderHost(update);

    const textField = page.getByLabelText(/Beschreibung|Description|Text/i);
    await userEvent.clear(textField);
    await userEvent.fill(textField, "Geändert");

    await waitForDirtyMirror();
    await expect.poll(() => getFormSpy()?.values.text === "Geändert").toBe(true);

    await clickDialogClose();
    await expectDiscardConfirmVisible();
  });

  it("D: keep editing → values + RHF dirty preserved; mirror still guards", async () => {
    const update = vi.fn(async (_r, params: UpdateParams<Task>) => ({
      data: { ...baseTask, ...params.data } as Task,
    }));
    await renderHost(update);

    const textField = page.getByLabelText(/Beschreibung|Description|Text/i);
    await userEvent.clear(textField);
    await userEvent.fill(textField, "Noch offen");
    await waitForDirtyMirror();

    await clickDialogClose();
    await expectDiscardConfirmVisible();
    await userEvent.click(page.getByRole("button", { name: keepEditing }));

    await expect
      .poll(() => document.body.textContent?.match(discardTitle) ?? null)
      .toBeNull();
    await expect.element(textField).toHaveValue("Noch offen");
    await expect.poll(() => getFormSpy()?.isDirty === true).toBe(true);

    await clickDialogClose();
    await expectDiscardConfirmVisible();
  });

  it("E: successful Speichern → one update; RHF becomes clean (bridge does not clear early)", async () => {
    let resolveUpdate!: (value: { data: Task }) => void;
    const update = vi.fn(
      (_resource: string, params: UpdateParams<Task>) =>
        new Promise<{ data: Task }>((resolve) => {
          resolveUpdate = resolve;
          void params;
        }),
    );

    // Keep mounted after onSuccess close() so we can observe RHF reset → clean.
    await renderHost(update, { unmountOnClose: false });

    const textField = page.getByLabelText(/Beschreibung|Description|Text/i);
    await userEvent.clear(textField);
    await userEvent.fill(textField, "Gespeichert");
    await waitForDirtyMirror();

    await userEvent.click(page.getByRole("button", { name: /Speichern|Save/i }));
    await expect.poll(() => update.mock.calls.length).toBe(1);

    // While server pending: still dirty — bridge must not fake clean.
    expect(getFormSpy()?.isDirty).toBe(true);

    resolveUpdate({
      data: { ...baseTask, text: "Gespeichert" },
    });

    await expect.poll(() => getFormSpy()?.isDirty === false).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);

    // After clean: close must not show discard (mirror followed RHF to false).
    await clickDialogClose();
    await expect
      .poll(() => document.body.textContent?.match(discardTitle) ?? null)
      .toBeNull();
  });

  it("F: failed Speichern → values retained; RHF + discard guard stay dirty", async () => {
    const update = vi.fn(async () => {
      throw { status: 500, message: "boom" };
    });
    await renderHost(update);

    const textField = page.getByLabelText(/Beschreibung|Description|Text/i);
    await userEvent.clear(textField);
    await userEvent.fill(textField, "Fehlerpfad");
    await waitForDirtyMirror();

    await userEvent.click(page.getByRole("button", { name: /Speichern|Save/i }));
    await expect.poll(() => update.mock.calls.length).toBe(1);

    await expect.element(textField).toHaveValue("Fehlerpfad");
    await expect.poll(() => getFormSpy()?.isDirty === true).toBe(true);

    await clickDialogClose();
    await expectDiscardConfirmVisible();
  });

  it("G: discard → close; reopen starts clean (no stale dirty mirror)", async () => {
    const onClose = vi.fn();
    const update = vi.fn(async (_r, params: UpdateParams<Task>) => ({
      data: { ...baseTask, ...params.data } as Task,
    }));
    await renderHost(update, { onClose });

    const textField = page.getByLabelText(/Beschreibung|Description|Text/i);
    await userEvent.clear(textField);
    await userEvent.fill(textField, "Verwerfen");
    await waitForDirtyMirror();

    await clickDialogClose();
    await expectDiscardConfirmVisible();
    await userEvent.click(page.getByRole("button", { name: confirmDiscard }));

    await expect.poll(() => onClose.mock.calls.length).toBe(1);
    await expect
      .poll(
        () =>
          document
            .querySelector('[data-testid="task-edit-host"]')
            ?.getAttribute("data-open") === "0",
      )
      .toBe(true);

    await userEvent.click(page.getByRole("button", { name: /Reopen task/i }));
    await expect
      .element(page.getByRole("button", { name: /Speichern|Save/i }))
      .toBeVisible();
    await expect
      .poll(() => getFormSpy()?.values.text === "Kunde anrufen")
      .toBe(true);
    await expect.poll(() => getFormSpy()?.isDirty === false).toBe(true);

    await clickDialogClose();
    await expect
      .poll(() => document.body.textContent?.match(discardTitle) ?? null)
      .toBeNull();
  });
});
