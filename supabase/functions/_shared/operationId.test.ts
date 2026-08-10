import { describe, expect, it } from "vitest";
import {
  isValidNoraOperationId,
  NORA_OPERATION_ID_HEADER,
  operationIdForwardHeaders,
  readOperationIdFromRequest,
} from "./operationId.ts";

describe("operationId edge helper", () => {
  it("accepts valid UUIDs only", () => {
    expect(isValidNoraOperationId("123e4567-e89b-12d3-a456-426614174000")).toBe(
      true,
    );
    expect(isValidNoraOperationId("nope")).toBe(false);
    expect(isValidNoraOperationId("")).toBe(false);
  });

  it("reads a valid header from Request", () => {
    const req = new Request("https://example.test", {
      headers: {
        [NORA_OPERATION_ID_HEADER]: "123E4567-E89B-12D3-A456-426614174000",
      },
    });
    expect(readOperationIdFromRequest(req)).toBe(
      "123e4567-e89b-12d3-a456-426614174000",
    );
  });

  it("returns null for missing or invalid headers", () => {
    expect(
      readOperationIdFromRequest(new Request("https://example.test")),
    ).toBe(null);
    const bad = new Request("https://example.test", {
      headers: { [NORA_OPERATION_ID_HEADER]: "not-uuid" },
    });
    expect(readOperationIdFromRequest(bad)).toBe(null);
  });

  it("forwards only valid ids", () => {
    expect(
      operationIdForwardHeaders("123e4567-e89b-12d3-a456-426614174000", {
        apikey: "x",
      }),
    ).toEqual({
      apikey: "x",
      [NORA_OPERATION_ID_HEADER]: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(operationIdForwardHeaders("bad", { apikey: "x" })).toEqual({
      apikey: "x",
    });
  });
});
