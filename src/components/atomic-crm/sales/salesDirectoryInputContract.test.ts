import { describe, expect, it } from "vitest";

import { SALES_DIRECTORY_REFERENCE_PROPS } from "./salesDirectoryReference";

describe("sales_directory ReferenceInput contract", () => {
  it("targets sales_directory with stable sort and pagination", () => {
    expect(SALES_DIRECTORY_REFERENCE_PROPS.reference).toBe("sales_directory");
    expect(SALES_DIRECTORY_REFERENCE_PROPS.sort).toEqual({
      field: "last_name",
      order: "ASC",
    });
    expect(SALES_DIRECTORY_REFERENCE_PROPS.perPage).toBeGreaterThanOrEqual(100);
  });

  it("does not include a disabled filter (column not exposed by the view)", () => {
    expect(SALES_DIRECTORY_REFERENCE_PROPS).not.toHaveProperty("filter");
    expect(JSON.stringify(SALES_DIRECTORY_REFERENCE_PROPS)).not.toMatch(
      /disabled/,
    );
  });
});
