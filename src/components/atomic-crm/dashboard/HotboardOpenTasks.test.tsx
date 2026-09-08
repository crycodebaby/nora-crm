import { render } from "vitest-browser-react";

import { buildContact, createCrmDb, StoryWrapper } from "@/test/StoryWrapper";
import { createDataProvider } from "@/components/atomic-crm/providers/fakerest";
import type { Db } from "@/components/atomic-crm/providers/fakerest/dataGenerator/types";
import type { Contact, Task } from "../types";

import { HotboardOpenTasks } from "./HotboardOpenTasks";

const ADMIN_SALES_ID = 0;

const buildTask = (overrides: Partial<Task> & Pick<Task, "id">): Task => ({
  type: "Anruf",
  text: "Rückruf vereinbaren",
  due_date: "2026-01-01",
  done_date: null,
  sales_id: ADMIN_SALES_ID,
  contact_id: null,
  company_id: 1,
  ...overrides,
});

/**
 * Startseite reality: open tasks mix company-only rows (contact_id null) with
 * several rows pointing at the same contact. Both shapes must survive id
 * assembly without producing a malformed PostgREST `id=in.(...)` request.
 */
const buildScenario = (): Partial<Db> => {
  const contacts: Contact[] = [
    buildContact({ id: 1, first_name: "Ada", last_name: "Lovelace" }),
    buildContact({ id: 29, first_name: "Grace", last_name: "Hopper" }),
  ];

  const tasks: Task[] = [
    buildTask({ id: 1, contact_id: 1, text: "Aufmass bestaetigen" }),
    buildTask({ id: 2, contact_id: 1, text: "Angebot nachfassen" }),
    buildTask({ id: 3, contact_id: null, text: "Hausmeisterrunde planen" }),
    buildTask({ id: 4, contact_id: 29, text: "Montagetermin abstimmen" }),
    buildTask({ id: 5, contact_id: null, text: "Schluesseluebergabe" }),
  ];

  return { contacts, tasks };
};

describe("HotboardOpenTasks contact resolution", () => {
  it("never asks the data provider for a blank or duplicated contact id", async () => {
    const scenario = buildScenario();
    const base = createDataProvider({
      db: createCrmDb(scenario),
      silent: true,
    });

    const getManyCalls: { resource: string; ids: unknown[] }[] = [];
    const getMany = vi.fn((resource: string, params: { ids?: unknown[] }) => {
      getManyCalls.push({ resource, ids: [...(params.ids ?? [])] });
      return base.getMany(resource, params as never);
    });

    const screen = await render(
      <StoryWrapper data={scenario} dataProvider={{ getMany }}>
        <HotboardOpenTasks />
      </StoryWrapper>,
    );

    const row = (text: string) =>
      screen.getByRole("button", { name: new RegExp(text) });

    // Ansprechpartner names must actually resolve on the contact-bound rows.
    await expect
      .element(row("Aufmass bestaetigen"))
      .toHaveTextContent("Ada Lovelace");
    await expect
      .element(row("Angebot nachfassen"))
      .toHaveTextContent("Ada Lovelace");
    await expect
      .element(row("Montagetermin abstimmen"))
      .toHaveTextContent("Grace Hopper");

    // Company-only rows stay contact-less instead of breaking the whole list.
    await expect
      .element(row("Hausmeisterrunde planen"))
      .not.toHaveTextContent("Lovelace");

    const contactCalls = getManyCalls.filter((c) => c.resource === "contacts");
    expect(contactCalls.length).toBeGreaterThan(0);

    for (const call of contactCalls) {
      // No null/undefined/empty element may ever reach `id=in.(...)`.
      expect(
        call.ids.filter((id) => id == null || id === ""),
        `malformed ids forwarded: ${JSON.stringify(call.ids)}`,
      ).toEqual([]);
      // No duplicate ids either — they only bloat the request.
      expect(
        call.ids.length,
        `duplicate ids forwarded: ${JSON.stringify(call.ids)}`,
      ).toBe(new Set(call.ids).size);
    }
  });
});
