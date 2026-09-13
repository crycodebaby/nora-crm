import { createDataProvider } from "./dataProvider";
import { buildCompany, createCrmDb } from "@/test/StoryWrapper";
import type { Company, Deal } from "../../types";

/**
 * W7-R1B (2026-09-13): every Nora deal belongs to exactly one company.
 * Supabase enforces `public.deals.company_id NOT NULL`; FakeRest must reject
 * the same writes with the same shape (SQLSTATE 23502), must keep updates that
 * don't touch company_id working, and must treat company id 0 as a real id.
 */
describe("FakeRest deal company parity (W7-R1B)", () => {
  const NOT_NULL_MESSAGE =
    'null value in column "company_id" of relation "deals" violates not-null constraint';

  const setup = (companies: Company[] = [buildCompany({ id: 1 })]) => {
    const dataProvider = createDataProvider({
      db: createCrmDb({ companies, deals: [] }),
      silent: true,
      latency: 0,
    });
    return dataProvider;
  };

  const dealData = (overrides: Partial<Deal> = {}): Partial<Deal> => ({
    name: "Fenster klemmt",
    stage: "neue-anfrage",
    category: "fensterservice",
    contact_ids: [],
    amount: 0,
    expected_closing_date: "2026-09-20",
    index: 0,
    ...overrides,
  });

  const captureError = async (run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (error) {
      return error as { code?: unknown; message?: unknown };
    }
    return undefined;
  };

  const expectNotNullViolation = (error: unknown) => {
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ code: "23502", message: NOT_NULL_MESSAGE });
  };

  it("T-FR-1 create with a valid company_id succeeds", async () => {
    const dataProvider = setup();
    const { data } = await dataProvider.create<Deal>("deals", {
      data: dealData({ company_id: 1 }),
    });
    expect(data.company_id).toBe(1);
  });

  it("T-FR-2 create with company_id = null is rejected and nothing is stored", async () => {
    const dataProvider = setup();
    const error = await captureError(() =>
      dataProvider.create("deals", {
        data: dealData({ company_id: null as unknown as Deal["company_id"] }),
      }),
    );
    expectNotNullViolation(error);
    const { total } = await dataProvider.getList("deals", {
      pagination: { page: 1, perPage: 10 },
      sort: { field: "id", order: "ASC" },
      filter: {},
    });
    expect(total).toBe(0);
  });

  it("T-FR-3 create without company_id is rejected", async () => {
    const dataProvider = setup();
    const error = await captureError(() =>
      dataProvider.create("deals", { data: dealData() }),
    );
    expectNotNullViolation(error);
  });

  it("T-FR-4 update whose patch does not carry company_id keeps working", async () => {
    const dataProvider = setup();
    const { data: deal } = await dataProvider.create<Deal>("deals", {
      data: dealData({ company_id: 1 }),
    });

    const { data: updated } = await dataProvider.update<Deal>("deals", {
      id: deal.id,
      data: { stage: "kontaktiert" },
      previousData: deal,
    });

    expect(updated.stage).toBe("kontaktiert");
    expect(updated.company_id).toBe(1);
  });

  it("T-FR-5 update with company_id = null is rejected and the customer is kept", async () => {
    const dataProvider = setup();
    const { data: deal } = await dataProvider.create<Deal>("deals", {
      data: dealData({ company_id: 1 }),
    });

    for (const companyId of [null, undefined]) {
      const error = await captureError(() =>
        dataProvider.update("deals", {
          id: deal.id,
          data: { company_id: companyId as unknown as Deal["company_id"] },
          previousData: deal,
        }),
      );
      expectNotNullViolation(error);
    }

    const { data: stored } = await dataProvider.getOne<Deal>("deals", {
      id: deal.id,
    });
    expect(stored.company_id).toBe(1);
  });

  it("T-FR-5b update to another existing company succeeds", async () => {
    const dataProvider = setup([
      buildCompany({ id: 1 }),
      buildCompany({ id: 2 }),
    ]);
    const { data: deal } = await dataProvider.create<Deal>("deals", {
      data: dealData({ company_id: 1 }),
    });

    const { data: updated } = await dataProvider.update<Deal>("deals", {
      id: deal.id,
      data: { company_id: 2 },
      previousData: deal,
    });

    expect(updated.company_id).toBe(2);
  });

  it("T-FR-6 company_id = 0 is a valid identifier on create and update", async () => {
    const dataProvider = setup([
      buildCompany({ id: 0 }),
      buildCompany({ id: 1 }),
    ]);
    const { data: deal } = await dataProvider.create<Deal>("deals", {
      data: dealData({ company_id: 0 }),
    });
    expect(deal.company_id).toBe(0);

    const { data: moved } = await dataProvider.update<Deal>("deals", {
      id: deal.id,
      data: { company_id: 1 },
      previousData: deal,
    });
    const { data: movedBack } = await dataProvider.update<Deal>("deals", {
      id: deal.id,
      data: { company_id: 0 },
      previousData: moved,
    });
    expect(movedBack.company_id).toBe(0);
  });

  it("T-FR-7 create + delete on company 0 keeps the nb_deals counter correct", async () => {
    const dataProvider = setup([buildCompany({ id: 0, nb_deals: 0 })]);

    const { data: deal } = await dataProvider.create<Deal>("deals", {
      data: dealData({ company_id: 0 }),
    });
    const afterCreate = await dataProvider.getOne<Company>("companies", {
      id: 0,
    });
    expect(afterCreate.data.nb_deals).toBe(1);

    await dataProvider.delete("deals", { id: deal.id, previousData: deal });
    const afterDelete = await dataProvider.getOne<Company>("companies", {
      id: 0,
    });
    expect(afterDelete.data.nb_deals).toBe(0);
  });
});
