import { render } from "vitest-browser-react";

import { buildCompany, StoryWrapper } from "@/test/StoryWrapper";
import { DEFAULT_USER } from "@/components/atomic-crm/providers/fakerest/authProvider";

import type { Task } from "../types";
import { HotboardOpenTasks } from "./HotboardOpenTasks";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

const buildTask = (overrides: Partial<Task>): Task => ({
  id: 1,
  type: "call",
  text: "Task",
  due_date: "2026-09-10",
  done_date: null,
  sales_id: DEFAULT_USER.id,
  company_id: 1,
  contact_id: null,
  ...overrides,
});

/**
 * PERF-01A: contact ids are normalized before useGetMany. These tests pin the
 * integration behavior at the boundary — no contacts request at all when
 * every task is company-only, exactly one normalized request otherwise.
 */
describe("HotboardOpenTasks contact lookup", () => {
  it("issues no contacts getMany when all tasks have no contact", async () => {
    const getMany = vi.fn(async () => ({ data: [] }));

    const screen = await render(
      <StoryWrapper
        data={{
          companies: [buildCompany({ id: 1 })],
          tasks: [
            buildTask({ id: 1, text: "Fenster pruefen", contact_id: null }),
            buildTask({ id: 2, text: "Angebot senden", contact_id: undefined }),
          ],
        }}
        dataProvider={{ getMany } as any}
      >
        <HotboardOpenTasks />
      </StoryWrapper>,
    );

    await expect.element(screen.getByText("Fenster pruefen")).toBeVisible();
    await expect.element(screen.getByText("Angebot senden")).toBeVisible();
    expect(getMany).not.toHaveBeenCalled();
  });

  it("requests each contact once with normalized ids", async () => {
    const getMany = vi.fn(async (_resource: string, params: any) => ({
      data: params.ids.map((id: number) => ({
        id,
        first_name: "Erika",
        last_name: "Muster",
      })),
    }));

    const screen = await render(
      <StoryWrapper
        data={{
          companies: [buildCompany({ id: 1 })],
          tasks: [
            buildTask({ id: 1, text: "Rueckruf", contact_id: 1 }),
            buildTask({ id: 2, text: "Termin", contact_id: 1 }),
            buildTask({ id: 3, text: "Ohne Kontakt", contact_id: null }),
          ],
        }}
        dataProvider={{ getMany } as any}
      >
        <HotboardOpenTasks />
      </StoryWrapper>,
    );

    await expect.element(screen.getByText("Ohne Kontakt")).toBeVisible();
    await vi.waitFor(() => expect(getMany).toHaveBeenCalledTimes(1));
    expect(getMany.mock.calls[0][0]).toBe("contacts");
    expect(getMany.mock.calls[0][1].ids).toEqual([1]);
    await expect
      .element(screen.getByText(/Erika Muster/).first())
      .toBeVisible();
  });
});
