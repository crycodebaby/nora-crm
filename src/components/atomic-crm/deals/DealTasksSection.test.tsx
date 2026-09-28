import { RecordContextProvider, ResourceContextProvider } from "ra-core";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { describe, expect, it } from "vitest";

import "@/index.css";
import { StoryWrapper, buildCompany, buildContact } from "@/test/StoryWrapper";
import type { Deal, Task } from "../types";
import { DealTasksSection } from "./DealTasksSection";

const DEAL: Deal = {
  id: 7,
  name: "Fenster tauschen",
  case_number: "VG-2026-000007",
  company_id: 1,
  contact_ids: [1],
  category: "fensterservice",
  stage: "neue-anfrage",
  description: "",
  amount: 100,
  created_at: "2026-09-01T08:00:00.000Z",
  updated_at: "2026-09-01T08:00:00.000Z",
  expected_closing_date: "2099-09-30",
  sales_id: 0,
  index: 0,
};

const TASK: Task = {
  id: 1,
  contact_id: 1,
  company_id: 1,
  type: "rueckruf",
  text: "Herrn Krüger zurückrufen",
  due_date: "2099-01-01T09:00:00.000Z",
  done_date: null,
  sales_id: 0,
};

const addTask = () =>
  page.getByRole("button", { name: /Add task|Aufgabe hinzufügen/i });

const setup = async (deal: Deal = DEAL, tasks: Task[] = [TASK]) => {
  await render(
    <StoryWrapper
      data={{
        companies: [buildCompany({ id: 1 })],
        contacts: [buildContact({ id: 1, company_id: 1 })],
        tasks,
      }}
    >
      <div style={{ padding: 32 }}>
        <ResourceContextProvider value="deals">
          <RecordContextProvider value={deal}>
            <DealTasksSection />
          </RecordContextProvider>
        </ResourceContextProvider>
      </div>
    </StoryWrapper>,
  );
};

describe("DealTasksSection (Alpha UI 1)", () => {
  it("offers exactly one primary action and no per-type quick buttons", async () => {
    await setup();
    await expect.element(addTask()).toBeVisible();
    expect(document.querySelectorAll(".nora-section-head button").length).toBe(
      1,
    );
    for (const legacy of [
      "Rückruf",
      "Besichtigung",
      "Rückmeldung zu Angebot",
      "Termin vereinbaren",
    ]) {
      expect(
        Array.from(document.querySelectorAll("button")).some(
          (b) => b.textContent?.trim() === legacy,
        ),
      ).toBe(false);
    }
  });

  it("renders compact task rows whose overflow control sits inside the row", async () => {
    await setup();
    await expect
      .element(page.getByText("Herrn Krüger zurückrufen"))
      .toBeVisible();
    const row = document.querySelector(".nora-task-row");
    expect(row).not.toBeNull();
    const menu = row!.querySelector(
      'button[aria-haspopup="menu"]',
    ) as HTMLButtonElement | null;
    expect(menu).not.toBeNull();
    const rect = menu!.getBoundingClientRect();
    expect(rect.width).toBeGreaterThanOrEqual(44);
    expect(rect.height).toBeGreaterThanOrEqual(44);
    // the completion control: 16 px box, 44 px hit area around it
    const checkbox = row!.querySelector('[role="checkbox"]') as HTMLElement;
    const box = checkbox.getBoundingClientRect();
    expect(
      document.elementFromPoint(box.right + 10, box.top + box.height / 2),
    ).toBe(checkbox);
    expect(
      document.elementFromPoint(box.left + box.width / 2, box.bottom + 10),
    ).toBe(checkbox);
    const wrap = row!.querySelector(".nora-task-check") as HTMLElement;
    expect(wrap.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    // type is shown as a quiet prefix, not as a second heading
    expect(row!.querySelector(".nora-task-type")?.textContent).toBe("Rückruf");
    // the open count is shown in the section head
    expect(document.querySelector(".nora-section-count")?.textContent).toBe(
      "1",
    );
  });

  it("opens the task dialog with the type still selectable", async () => {
    await setup();
    await userEvent.click(addTask());
    const dialog = page.getByRole("dialog");
    await expect.element(dialog).toBeVisible();
    await expect
      .element(dialog.getByRole("combobox", { name: /Type|Art/ }))
      .toBeVisible();
    await expect
      .element(
        dialog.getByRole("textbox", { name: /Description|Beschreibung/ }),
      )
      .toBeVisible();
  });

  it("explains itself when the Vorgang has no contact and offers no action", async () => {
    await setup({ ...DEAL, contact_ids: [] }, []);
    await expect
      .element(page.getByText(/Add a contact|Ansprechpartner/))
      .toBeVisible();
    await expect.element(addTask()).not.toBeInTheDocument();
  });
});
