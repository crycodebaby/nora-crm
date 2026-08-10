/**
 * Gate 2b structural proof (independent of TaskEdit component).
 *
 * BEFORE fix, TaskEdit used Form className="contents" wrapping NoraDialogContent,
 * so the visible SaveButton had button.form === null.
 */
import type { FormEvent } from "react";
import { render } from "vitest-browser-react";
import { describe, expect, it, vi } from "vitest";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

describe("TaskEdit-shaped portal form ownership (Gate 2b)", () => {
  it("BEFORE: Form outside portal → SaveButton.form === null", async () => {
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
    });

    await render(
      <Dialog open>
        <form id="task-outer-form" className="contents" onSubmit={onSubmit}>
          <DialogContent showClose={false} aria-describedby={undefined}>
            <DialogTitle>Aufgabe bearbeiten</DialogTitle>
            <DialogDescription className="sr-only">Test</DialogDescription>
            <textarea name="text" defaultValue="Kunde anrufen" />
            <button type="submit">Speichern</button>
          </DialogContent>
        </form>
      </Dialog>,
    );

    const saveButton = document.querySelector(
      '[data-slot="dialog-content"] button[type="submit"]',
    ) as HTMLButtonElement | null;
    const outerForm = document.getElementById("task-outer-form");

    expect(saveButton).toBeTruthy();
    expect(outerForm).toBeTruthy();
    expect(outerForm!.contains(saveButton!)).toBe(false);
    expect(saveButton!.form).toBeNull();

    await saveButton!.click();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("AFTER pattern: Form inside portal → SaveButton owns form", async () => {
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
    });

    await render(
      <Dialog open>
        <DialogContent showClose={false} aria-describedby={undefined}>
          <DialogTitle>Aufgabe bearbeiten</DialogTitle>
          <DialogDescription className="sr-only">Test</DialogDescription>
          <form id="task-inner-form" onSubmit={onSubmit}>
            <textarea name="text" defaultValue="Kunde anrufen" />
            <button type="submit">Speichern</button>
          </form>
        </DialogContent>
      </Dialog>,
    );

    const saveButton = document.querySelector(
      '[data-slot="dialog-content"] button[type="submit"]',
    ) as HTMLButtonElement | null;
    const innerForm = document.getElementById(
      "task-inner-form",
    ) as HTMLFormElement | null;

    expect(saveButton).toBeTruthy();
    expect(innerForm).toBeTruthy();
    expect(saveButton!.form).toBe(innerForm);
    expect(innerForm!.contains(saveButton!)).toBe(true);

    await saveButton!.click();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
