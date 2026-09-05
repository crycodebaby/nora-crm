import { describe, expect, it } from "vitest";

import { createCrmDb } from "@/test/StoryWrapper";
import { DEFAULT_USER } from "./authProvider";
import { createDataProvider } from "./dataProvider";
import generateData from "./dataGenerator";
import { NORA_ERROR_CODES } from "../../domain/noraErrorCodes";
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

  it("refuses to newly assign a disabled employee but keeps existing ownership editable (W2 hardening)", async () => {
    const db = createCrmDb();
    const disabledErika = { ...erika, disabled: true };
    db.sales = [...db.sales, disabledErika];
    db.companies = [
      {
        id: 500,
        name: "Bestand GmbH",
        sales_id: erika.id,
        customer_number: "K-500",
      } as any,
    ];
    const dataProvider = createDataProvider({ db, silent: true, latency: 0 });
    const expectNotAssignable = async (run: () => Promise<unknown>) => {
      await expect(run()).rejects.toMatchObject({
        details: NORA_ERROR_CODES.EMPLOYEE_NOT_ASSIGNABLE,
      });
    };

    // INSERT with a disabled employee → denied, with an active one → allowed
    await expectNotAssignable(() =>
      dataProvider.create("deals", {
        data: {
          name: "Neu",
          company_id: 500,
          stage: "opportunity",
          sales_id: erika.id,
        },
      }),
    );
    const { data: deal } = await dataProvider.create("deals", {
      data: {
        name: "Neu",
        company_id: 500,
        stage: "opportunity",
        sales_id: DEFAULT_USER.id,
      },
    });
    for (const resource of ["companies", "contacts", "tasks"] as const) {
      await expectNotAssignable(() =>
        dataProvider.create(resource, {
          data: {
            name: "x",
            first_name: "x",
            last_name: "y",
            company_id: 500,
            text: "x",
            sales_id: erika.id,
          },
        }),
      );
    }

    // UPDATE active → disabled denied
    await expectNotAssignable(() =>
      dataProvider.update("deals", {
        id: deal.id,
        data: { sales_id: erika.id },
        previousData: deal,
      }),
    );

    // unrelated update of a record still owned by the disabled employee stays allowed
    const { data: company } = await dataProvider.getOne("companies", {
      id: 500,
    });
    expect(company.sales_id).toBe(erika.id);
    const { data: updated } = await dataProvider.update("companies", {
      id: 500,
      data: { ...company, description: "Beschreibung nachgetragen" },
      previousData: company,
    });
    expect(updated.sales_id).toBe(erika.id);

    // disabled → active allowed
    const { data: moved } = await dataProvider.update("companies", {
      id: 500,
      data: { ...updated, sales_id: DEFAULT_USER.id },
      previousData: updated,
    });
    expect(moved.sales_id).toBe(DEFAULT_USER.id);

    // historical authorship is not guarded: a note by the disabled employee
    const { data: note } = await dataProvider.create("contact_notes", {
      data: { contact_id: 1, text: "alte Notiz", sales_id: erika.id },
    });
    expect(note.sales_id).toBe(erika.id);
  });
});
