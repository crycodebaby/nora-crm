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
  normalizeReferenceIds,
} from "./hotboardUtils";
import type { Deal } from "../types";

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

describe("normalizeReferenceIds (PERF-01A)", () => {
  it("drops null and undefined so no empty bigint reaches the in.() filter", () => {
    expect(normalizeReferenceIds([1, 1, null, undefined])).toEqual([1]);
  });

  it("drops empty strings and NaN", () => {
    expect(normalizeReferenceIds(["", "  ", Number.NaN, 7])).toEqual([7]);
  });

  it("removes duplicates without losing any valid id", () => {
    expect(normalizeReferenceIds([3, 1, 3, 2, 1])).toEqual([1, 2, 3]);
  });

  it("keeps mixed valid and invalid input intact for the valid part", () => {
    expect(normalizeReferenceIds([5, null, 2, undefined, 5, ""])).toEqual([
      2, 5,
    ]);
  });

  it("returns an empty array for no ids", () => {
    expect(normalizeReferenceIds([])).toEqual([]);
    expect(normalizeReferenceIds([null, undefined])).toEqual([]);
  });

  it("normalizes equivalent id sets to the same representation", () => {
    const a = normalizeReferenceIds([2, 13, 5]);
    const b = normalizeReferenceIds([2, 5, 13]);
    const c = normalizeReferenceIds([13, 5, 2, 2]);
    expect(a).toEqual([2, 5, 13]);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("sorts numerically, not lexicographically", () => {
    expect(normalizeReferenceIds([10, 9, 100])).toEqual([9, 10, 100]);
  });

  it("orders string ids (uuids) deterministically", () => {
    const x = normalizeReferenceIds(["b-2", "a-1", "b-2"]);
    const y = normalizeReferenceIds(["a-1", "b-2"]);
    expect(x).toEqual(["a-1", "b-2"]);
    expect(y).toEqual(x);
  });
});
