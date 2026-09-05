import { describe, expect, it } from "vitest";

import { createCrmDb } from "@/test/StoryWrapper";
import { DEFAULT_USER } from "./authProvider";
import { createDataProvider } from "./dataProvider";
import generateData from "./dataGenerator";
import type { Sale } from "../../types";

/**
 * User Lifecycle W2 — FakeRest mirrors the two database read models:
 *   sales_directory  = active employees only  (assignment pickers)
 *   sales_identities = every employee, `disabled` flag included (history)
 */
const erika: Sale = {
  id: 77,
  first_name: "Erika",
  last_name: "Ehemalig",
  email: "erika@nora.test",
  role: "office",
  administrator: false,
  disabled: false,
  user_id: "77",
};

const list = (perPage = 100) => ({
  pagination: { page: 1, perPage },
  sort: { field: "id" as const, order: "ASC" as const },
  filter: {},
});

describe("FakeRest sales_identities (W2)", () => {
  it("generated demo data exposes every employee as an identity and only active ones as choices", () => {
    const db = generateData();
    expect(db.sales_identities.map((s) => s.id).sort()).toEqual(
      db.sales.map((s) => s.id).sort(),
    );
    expect(db.sales_directory.map((s) => s.id).sort()).toEqual(
      db.sales
        .filter((s) => !s.disabled)
        .map((s) => s.id)
        .sort(),
    );
    for (const identity of db.sales_identities) {
      expect(typeof identity.disabled).toBe("boolean");
      expect(identity).not.toHaveProperty("email");
      expect(identity).not.toHaveProperty("role");
      expect(identity).not.toHaveProperty("user_id");
    }
  });

  it("disabling an employee removes them from the directory but keeps their identity", async () => {
    const db = createCrmDb();
    db.sales = [...db.sales, erika];
    db.sales_directory = [
      ...db.sales_directory,
      {
        id: erika.id,
        first_name: erika.first_name,
        last_name: erika.last_name,
        avatar: erika.avatar,
      },
    ];
    db.sales_identities = [
      ...db.sales_identities,
      {
        id: erika.id,
        first_name: erika.first_name,
        last_name: erika.last_name,
        avatar: erika.avatar,
        disabled: false,
      },
    ];
    const dataProvider = createDataProvider({ db, silent: true, latency: 0 });
    const identity = { id: DEFAULT_USER.id };

    await dataProvider.update("sales", {
      id: erika.id,
      data: { ...erika, disabled: true },
      previousData: erika,
      meta: { identity },
    });

    const directory = await dataProvider.getList("sales_directory", list());
    expect(directory.data.map((row) => row.id)).not.toContain(erika.id);

    const identities = await dataProvider.getMany("sales_identities", {
      ids: [erika.id],
    });
    expect(identities.data).toHaveLength(1);
    expect(identities.data[0]).toMatchObject({
      first_name: "Erika",
      last_name: "Ehemalig",
      disabled: true,
    });

    await dataProvider.update("sales", {
      id: erika.id,
      data: { ...erika, disabled: false },
      previousData: { ...erika, disabled: true },
      meta: { identity },
    });
    const directoryAfter = await dataProvider.getList(
      "sales_directory",
      list(),
    );
    expect(directoryAfter.data.map((row) => row.id)).toContain(erika.id);
    const identitiesAfter = await dataProvider.getMany("sales_identities", {
      ids: [erika.id],
    });
    expect(identitiesAfter.data[0]).toMatchObject({ disabled: false });
  });
});
