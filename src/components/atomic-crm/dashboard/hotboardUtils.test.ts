/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import {
  filterFollowUpDeals,
  filterNewInquiryDeals,
  filterOfferFollowUpDeals,
  filterWaitingManufacturerDeals,
  getActiveDeals,
  resolveHotboardContactIds,
  resolveHotboardCompanyIds,
} from "./hotboardUtils";
import type { Deal, Task } from "../types";

const today = new Date();
today.setHours(0, 0, 0, 0);
const todayIso = today.toISOString().slice(0, 10);

const yesterday = new Date(today);
yesterday.setDate(yesterday.getDate() - 1);
const yesterdayIso = yesterday.toISOString().slice(0, 10);

const baseDeal = (overrides: Partial<Deal>): Deal =>
  ({
    id: 1,
    name: "Test",
    company_id: 1,
    contact_ids: [],
    category: "sonstiges",
    stage: "neue-anfrage",
    description: "",
    amount: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    expected_closing_date: todayIso,
    sales_id: 1,
    index: 0,
    case_number: "VG-2026-000001",
    ...overrides,
  }) as Deal;

describe("getActiveDeals", () => {
  it("excludes archived and terminal stages", () => {
    const deals = [
      baseDeal({ id: 1, stage: "neue-anfrage" }),
      baseDeal({ id: 2, stage: "abgeschlossen" }),
      baseDeal({ id: 3, archived_at: "2026-01-02", stage: "neue-anfrage" }),
    ];
    expect(getActiveDeals(deals).map((d) => d.id)).toEqual([1]);
  });
});

describe("filterFollowUpDeals", () => {
  it("includes overdue and today", () => {
    const deals = [
      baseDeal({ id: 1, expected_closing_date: yesterdayIso }),
      baseDeal({ id: 2, expected_closing_date: todayIso }),
      baseDeal({
        id: 3,
        expected_closing_date: "2099-12-31",
        stage: "nachfassen",
      }),
    ];
    expect(filterFollowUpDeals(deals).map((d) => d.id)).toEqual([1, 2]);
  });
});

describe("filterNewInquiryDeals", () => {
  it("only neue-anfrage", () => {
    const deals = [
      baseDeal({ id: 1, stage: "neue-anfrage" }),
      baseDeal({ id: 2, stage: "kontaktiert" }),
    ];
    expect(filterNewInquiryDeals(deals).map((d) => d.id)).toEqual([1]);
  });
});

describe("filterWaitingManufacturerDeals", () => {
  it("only wartet-auf-hersteller", () => {
    const deals = [
      baseDeal({ id: 1, stage: "wartet-auf-hersteller" }),
      baseDeal({ id: 2, stage: "angebot-gesendet" }),
    ];
    expect(filterWaitingManufacturerDeals(deals).map((d) => d.id)).toEqual([1]);
  });
});

describe("filterOfferFollowUpDeals", () => {
  it("includes angebot-gesendet and nachfassen", () => {
    const deals = [
      baseDeal({ id: 1, stage: "angebot-gesendet" }),
      baseDeal({ id: 2, stage: "nachfassen" }),
      baseDeal({ id: 3, stage: "neue-anfrage" }),
    ];
    expect(filterOfferFollowUpDeals(deals).map((d) => d.id)).toEqual([1, 2]);
  });

  it("excludes ids in exclude set", () => {
    const deals = [
      baseDeal({ id: 1, stage: "angebot-gesendet" }),
      baseDeal({ id: 2, stage: "nachfassen" }),
    ];
    expect(
      filterOfferFollowUpDeals(deals, new Set([1])).map((d) => d.id),
    ).toEqual([2]);
  });
});

describe("resolveHotboardContactIds", () => {
  const task = (id: number, contactId: Task["contact_id"]): Task => ({
    id,
    contact_id: contactId,
    company_id: 1,
    type: "Anruf",
    text: `Aufgabe ${id}`,
    due_date: "2026-01-01",
    done_date: null,
    sales_id: 0,
  });

  it("drops blank ids and duplicates but keeps first-seen order", () => {
    expect(
      resolveHotboardContactIds([
        task(1, 1),
        task(2, 1),
        task(3, null),
        task(4, 29),
        task(5, undefined),
        task(6, ""),
        task(7, 29),
      ]),
    ).toEqual([1, 29]);
  });

  it("returns an empty list when no task references a contact", () => {
    expect(
      resolveHotboardContactIds([task(1, null), task(2, undefined)]),
    ).toEqual([]);
    expect(resolveHotboardContactIds([])).toEqual([]);
  });

  it("keeps string identifiers and does not sort", () => {
    expect(
      resolveHotboardContactIds([
        task(1, "c-9"),
        task(2, "c-2"),
        task(3, "c-9"),
      ]),
    ).toEqual(["c-9", "c-2"]);
  });

  it("does not mutate the given tasks", () => {
    const tasks = [task(1, 1), task(2, null)];
    const snapshot = JSON.parse(JSON.stringify(tasks));
    resolveHotboardContactIds(tasks);
    expect(tasks).toEqual(snapshot);
  });
});

describe("resolveHotboardCompanyIds", () => {
  const deal = (id: number, companyId: unknown): Deal =>
    ({
      id,
      company_id: companyId,
      name: `Vorgang ${id}`,
      stage: "neue-anfrage",
      created_at: "2026-01-01T00:00:00.000Z",
      expected_closing_date: "2026-01-01",
    }) as unknown as Deal;

  it("drops company-less deals and duplicates, keeping first-seen order", () => {
    expect(
      resolveHotboardCompanyIds([
        deal(1, 7),
        deal(2, null),
        deal(3, 7),
        deal(4, 2),
        deal(5, undefined),
      ]),
    ).toEqual([7, 2]);
  });

  it("returns an empty list when no deal has a customer", () => {
    expect(resolveHotboardCompanyIds([deal(1, null)])).toEqual([]);
    expect(resolveHotboardCompanyIds([])).toEqual([]);
  });
});
