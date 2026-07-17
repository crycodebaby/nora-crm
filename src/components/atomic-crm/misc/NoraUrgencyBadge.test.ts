/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { getFollowUpStatus } from "../deals/dealUtils";

describe("getFollowUpStatus", () => {
  it("classifies overdue dates", () => {
    expect(getFollowUpStatus("2000-01-01")).toBe("overdue");
  });

  it("classifies today", () => {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    expect(getFollowUpStatus(iso)).toBe("today");
  });

  it("classifies upcoming dates", () => {
    const future = new Date();
    future.setDate(future.getDate() + 5);
    const iso = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}-${String(future.getDate()).padStart(2, "0")}`;
    expect(getFollowUpStatus(iso)).toBe("upcoming");
  });

  it("returns null for invalid dates", () => {
    expect(getFollowUpStatus("invalid")).toBeNull();
  });
});
