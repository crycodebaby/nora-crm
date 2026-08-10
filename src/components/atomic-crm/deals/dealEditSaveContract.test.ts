import { describe, expect, it } from "vitest";

import { isNoraRecordId } from "../routing/noraRoutes";

/** Mirrors DateInput sync rule after Stabilization Gate 1. */
const isSyncableDateInputValue = (value: string) =>
  value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value);

describe("DealEdit Kontakttermin save contract", () => {
  it("rejects create as a deal record id so EditBase cannot getOne(create)", () => {
    expect(isNoraRecordId("create")).toBe(false);
    expect(isNoraRecordId(15)).toBe(true);
  });

  it("syncs complete YYYY-MM-DD values without relying on valueAsDate", () => {
    expect(isSyncableDateInputValue("2026-08-20")).toBe(true);
    expect(isSyncableDateInputValue("")).toBe(true);
    expect(isSyncableDateInputValue("2026-8-20")).toBe(false);
    expect(isSyncableDateInputValue("not-a-date")).toBe(false);
  });
});
