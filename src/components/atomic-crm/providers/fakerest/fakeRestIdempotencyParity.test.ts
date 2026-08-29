import { createDataProvider } from "./dataProvider";
import { buildCompany, createCrmDb } from "@/test/StoryWrapper";
import { NORA_ERROR_CODES } from "../../domain/noraErrorCodes";
import {
  getDefaultOperationManager,
  resetDefaultOperationManagerForTests,
} from "../../operations/operationManager";

/**
 * Idempotency Wave (2026-08-29): FakeRest must mirror the real RPCs'
 * idempotency contract for the two write commands — same key + same
 * request replays without a second write; same key + different request
 * raises DETAIL=NORA_IDEMPOTENCY_CONFLICT; the Quick Capture Core scope and
 * Task scope are independent under the SAME key. Not a concurrency proof
 * (FakeRest is single-threaded JS — see providers/fakerest/dataProvider.ts
 * runWithFakeRestIdempotency comment) — that proof lives in the real
 * Postgres RPCs (supabase/tests/*_verification.sql).
 */
describe("FakeRest idempotency parity", () => {
  afterEach(() => {
    resetDefaultOperationManagerForTests();
  });

  const getDetails = (error: unknown): unknown =>
    (error as { details?: unknown } | null)?.details;

  it("quick_capture_case.core — same key + same request replays without a second write", async () => {
    const dataProvider = createDataProvider({
      db: createCrmDb({ companies: [] }),
      silent: true,
      latency: 0,
    });

    const params = {
      company: { name: "Idempotency GmbH" },
      existingCompanyId: null,
      contact: null,
      existingContactId: null,
      selfContactId: null,
      deal: { name: "Idempotency Deal", category: "fensterservice" },
      idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    };

    const first = await dataProvider.createQuickCaptureCase(params);
    const replay = await dataProvider.createQuickCaptureCase(params);

    expect(replay).toEqual(first);

    const { total } = await dataProvider.getList("companies", {
      filter: { name: "Idempotency GmbH" },
      pagination: { page: 1, perPage: 10 },
      sort: { field: "id", order: "ASC" },
    });
    expect(total).toBe(1);
  });

  it("quick_capture_case.core — same key + different request raises NORA_IDEMPOTENCY_CONFLICT", async () => {
    const dataProvider = createDataProvider({
      db: createCrmDb({ companies: [] }),
      silent: true,
      latency: 0,
    });

    const key = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await dataProvider.createQuickCaptureCase({
      company: { name: "Original GmbH" },
      existingCompanyId: null,
      contact: null,
      existingContactId: null,
      selfContactId: null,
      deal: { name: "Deal", category: "fensterservice" },
      idempotencyKey: key,
    });

    let caught: unknown;
    try {
      await dataProvider.createQuickCaptureCase({
        company: { name: "Different GmbH" },
        existingCompanyId: null,
        contact: null,
        existingContactId: null,
        selfContactId: null,
        deal: { name: "Deal", category: "fensterservice" },
        idempotencyKey: key,
      });
    } catch (error) {
      caught = error;
    }

    expect(getDetails(caught)).toBe(NORA_ERROR_CODES.IDEMPOTENCY_CONFLICT);
  });

  it("quick_capture_case.task — same key + same request replays the existing task (no duplicate)", async () => {
    const company = buildCompany({ id: 1, name: "Task Idem Co" });
    const dataProvider = createDataProvider({
      db: createCrmDb({ companies: [company] }),
      silent: true,
      latency: 0,
    });

    const params = {
      companyId: company.id,
      type: "rueckruf",
      text: "Rückruf",
      dueDate: "2026-09-01",
      idempotencyKey: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    };

    const first = await dataProvider.createQuickCaptureTask(params);
    const replay = await dataProvider.createQuickCaptureTask(params);

    expect(replay).toEqual(first);

    const { total } = await dataProvider.getList("tasks", {
      filter: { company_id: company.id },
      pagination: { page: 1, perPage: 10 },
      sort: { field: "id", order: "ASC" },
    });
    expect(total).toBe(1);
  });

  it("quick_capture_case.task — same key + different task payload raises NORA_IDEMPOTENCY_CONFLICT (task changed, core untouched)", async () => {
    const company = buildCompany({ id: 1, name: "Task Conflict Co" });
    const dataProvider = createDataProvider({
      db: createCrmDb({ companies: [company] }),
      silent: true,
      latency: 0,
    });

    const key = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    await dataProvider.createQuickCaptureTask({
      companyId: company.id,
      type: "rueckruf",
      text: "Kunde zurückrufen",
      idempotencyKey: key,
    });

    let caught: unknown;
    try {
      await dataProvider.createQuickCaptureTask({
        companyId: company.id,
        type: "angebot_erstellen",
        text: "Angebot senden",
        idempotencyKey: key,
      });
    } catch (error) {
      caught = error;
    }

    expect(getDetails(caught)).toBe(NORA_ERROR_CODES.IDEMPOTENCY_CONFLICT);

    const { total } = await dataProvider.getList("tasks", {
      filter: { company_id: company.id },
      pagination: { page: 1, perPage: 10 },
      sort: { field: "id", order: "ASC" },
    });
    expect(total).toBe(1);
  });

  it("different idempotency keys with an otherwise identical request create independent writes", async () => {
    const dataProvider = createDataProvider({
      db: createCrmDb({ companies: [] }),
      silent: true,
      latency: 0,
    });

    const basePayload = {
      company: { name: "Repeatable GmbH" },
      existingCompanyId: null,
      contact: null,
      existingContactId: null,
      selfContactId: null,
      deal: { name: "Deal", category: "fensterservice" },
    };

    await dataProvider.createQuickCaptureCase({
      ...basePayload,
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    });
    await dataProvider.createQuickCaptureCase({
      ...basePayload,
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
    });

    const { total } = await dataProvider.getList("companies", {
      filter: { name: "Repeatable GmbH" },
      pagination: { page: 1, perPage: 10 },
      sort: { field: "id", order: "ASC" },
    });
    expect(total).toBe(2);
  });

  /**
   * Operation Status Contract v1 (2026-08-29): FakeRest must mirror the same
   * execution disposition ("executed"/"replayed") the real RPCs now report,
   * without leaking `_meta` into the business result FakeRest already
   * returns (see runWithFakeRestIdempotency in dataProvider.ts).
   */
  it("reports execution=executed on first write and execution=replayed on replay via the Operation Manager", async () => {
    resetDefaultOperationManagerForTests();
    const dataProvider = createDataProvider({
      db: createCrmDb({ companies: [] }),
      silent: true,
      latency: 0,
    });

    const params = {
      company: { name: "Disposition GmbH" },
      existingCompanyId: null,
      contact: null,
      existingContactId: null,
      selfContactId: null,
      deal: { name: "Disposition Deal", category: "fensterservice" },
      idempotencyKey: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    };

    const first = await dataProvider.createQuickCaptureCase(params);
    expect(first).not.toHaveProperty("_meta");

    const manager = getDefaultOperationManager();
    const afterFirst = manager
      .getOperations()
      .find((op) => op.operationType === "quickCapture.createCase");
    expect(afterFirst?.execution).toBe("executed");

    const replay = await dataProvider.createQuickCaptureCase(params);
    expect(replay).toEqual(first);
    expect(replay).not.toHaveProperty("_meta");

    const afterReplay = manager
      .getOperations()
      .filter((op) => op.operationType === "quickCapture.createCase")
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0];
    expect(afterReplay?.execution).toBe("replayed");
  });

  it("does not report an execution disposition for a legacy call without idempotencyKey", async () => {
    resetDefaultOperationManagerForTests();
    const dataProvider = createDataProvider({
      db: createCrmDb({ companies: [] }),
      silent: true,
      latency: 0,
    });

    await dataProvider.createQuickCaptureCase({
      company: { name: "Legacy GmbH" },
      existingCompanyId: null,
      contact: null,
      existingContactId: null,
      selfContactId: null,
      deal: { name: "Legacy Deal", category: "fensterservice" },
    });

    const manager = getDefaultOperationManager();
    const op = manager
      .getOperations()
      .find((entry) => entry.operationType === "quickCapture.createCase");
    expect(op?.execution).toBeUndefined();
  });
});
