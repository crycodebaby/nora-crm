/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import {
  isNoraRecordId,
  matchNoraEditPath,
  matchesNoraSubPath,
} from "./noraRoutes";

describe("isNoraRecordId", () => {
  it("rejects create / empty / null", () => {
    expect(isNoraRecordId("create")).toBe(false);
    expect(isNoraRecordId("Create")).toBe(false);
    expect(isNoraRecordId("")).toBe(false);
    expect(isNoraRecordId(null)).toBe(false);
    expect(isNoraRecordId(undefined)).toBe(false);
  });

  it("accepts numeric and string deal ids", () => {
    expect(isNoraRecordId(42)).toBe(true);
    expect(isNoraRecordId("42")).toBe(true);
  });
});

describe("matchNoraEditPath", () => {
  it("does not treat /vorgaenge/create as an edit id", () => {
    expect(matchNoraEditPath("deals", "/vorgaenge/create")).toBeNull();
    expect(matchNoraEditPath("deals", "/deals/create")).toBeNull();
    expect(matchesNoraSubPath("deals", "create", "/vorgaenge/create")).toBe(
      true,
    );
  });

  it("matches real edit paths and ignores show", () => {
    expect(matchNoraEditPath("deals", "/vorgaenge/15")?.params.id).toBe("15");
    expect(matchNoraEditPath("deals", "/deals/15")?.params.id).toBe("15");
    expect(matchNoraEditPath("deals", "/vorgaenge/15/show")).toBeNull();
  });
});
