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
