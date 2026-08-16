/**
 * DOM-level proof that Radix DialogPortal breaks native form ownership
 * when <form> wraps the portal instead of living inside DialogContent.
 *
 * This is the structural root cause behind DealEdit Save (Stabilization Gate 2).
 */
import type { FormEvent } from "react";
import { render } from "vitest-browser-react";
import { describe, expect, it, vi } from "vitest";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

describe("Radix portal vs HTML form ownership", () => {
  it("BROKEN pattern: form outside portal → submit button has no form owner", async () => {
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
    });

    await render(
      <Dialog open>
        <form id="outer-form" className="contents" onSubmit={onSubmit}>
          <DialogContent showClose={false} aria-describedby={undefined}>
            <DialogTitle className="sr-only">Test</DialogTitle>
            <input name="note" defaultValue="x" />
            <button type="submit">Speichern</button>
          </DialogContent>
        </form>
      </Dialog>,
    );

    const saveButton = document.querySelector(
      '[data-slot="dialog-content"] button[type="submit"]',
    ) as HTMLButtonElement | null;
    const formEl = document.getElementById("outer-form");

    expect(saveButton).toBeTruthy();
    expect(formEl).toBeTruthy();
    // Portal moved content out of the form in the real DOM tree.
    expect(formEl!.contains(saveButton!)).toBe(false);
    expect(saveButton!.form).toBeNull();

    await saveButton!.click();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("FIXED pattern: form inside portal → submit button owns the form", async () => {
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
    });

    await render(
      <Dialog open>
        <DialogContent showClose={false} aria-describedby={undefined}>
          <DialogTitle className="sr-only">Test</DialogTitle>
          <form id="inner-form" onSubmit={onSubmit}>
            <input name="note" defaultValue="x" />
            <button type="submit">Speichern</button>
          </form>
        </DialogContent>
      </Dialog>,
    );

    const saveButton = document.querySelector(
      '[data-slot="dialog-content"] button[type="submit"]',
    ) as HTMLButtonElement | null;
    const formEl = document.getElementById(
      "inner-form",
    ) as HTMLFormElement | null;

    expect(saveButton).toBeTruthy();
    expect(formEl).toBeTruthy();
    expect(formEl!.contains(saveButton!)).toBe(true);
    expect(saveButton!.form).toBe(formEl);

    await saveButton!.click();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
