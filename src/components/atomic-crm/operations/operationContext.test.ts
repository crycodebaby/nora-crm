import { describe, expect, it } from "vitest";
import {
  createOperationContext,
  createOperationId,
  formatOperationIdShort,
  isValidOperationId,
  normalizeOperationId,
  NORA_OPERATION_ID_HEADER,
} from "./operationContext";
import {
  applyOperationIdRpcHeader,
  operationIdInvokeHeaders,
  readOperationIdFromMeta,
  withOperationIdParams,
  withOperationMeta,
} from "./operationTransport";

describe("operationContext", () => {
  it("creates a UUID operation id without PII", () => {
    const id = createOperationId();
    expect(isValidOperationId(id)).toBe(true);
    expect(id).not.toMatch(/@/);
    expect(id.toLowerCase()).not.toContain("admin");
  });

  it("formats a short display id without replacing the technical UUID", () => {
    const id = "7a31c92f-1234-4abc-8def-0123456789ab";
    expect(formatOperationIdShort(id)).toBe("OP-7A31-C92F");
  });

  it("rejects invalid operation ids", () => {
    expect(isValidOperationId("not-a-uuid")).toBe(false);
    expect(isValidOperationId("")).toBe(false);
    expect(isValidOperationId(null)).toBe(false);
    expect(normalizeOperationId("not-a-uuid")).toBeNull();
  });

  it("A: mints a new UUID when no operationId is provided", () => {
    const ctx = createOperationContext({
      operationType: "deal.update",
      resourceType: "deals",
      resourceId: 1,
    });
    expect(isValidOperationId(ctx.operationId)).toBe(true);
  });

  it("B: reuses an existing valid operationId exactly (lowercased)", () => {
    const existing = "11111111-2222-4333-8444-555555555555";
    const ctx = createOperationContext({
      operationType: "deal.update",
      resourceType: "deals",
      resourceId: 2,
      operationId: existing.toUpperCase(),
    });
    expect(ctx.operationId).toBe(existing);
  });

  it("F: invalid operationId is soft — mints a new UUID, never throws", () => {
    const ctx = createOperationContext({
      operationType: "deal.update",
      resourceType: "deals",
      operationId: "not-a-uuid",
    });
    expect(isValidOperationId(ctx.operationId)).toBe(true);
    expect(ctx.operationId).not.toBe("not-a-uuid");
  });

  it("builds a typed OperationContext for deal.update", () => {
    const ctx = createOperationContext({
      operationType: "deal.update",
      resourceType: "deals",
      resourceId: 42,
    });
    expect(ctx.operationType).toBe("deal.update");
    expect(ctx.resourceType).toBe("deals");
    expect(ctx.resourceId).toBe(42);
    expect(isValidOperationId(ctx.operationId)).toBe(true);
    expect(ctx.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("operationTransport ownership", () => {
  it("C: preserves existing meta keys and other headers while adding operation id", () => {
    const ctx = createOperationContext({
      operationType: "deal.update",
      resourceType: "deals",
      resourceId: 1,
      operationId: "11111111-2222-4333-8444-555555555555",
    });
    const meta = withOperationMeta(
      {
        schema: "public",
        preferReturn: "representation",
        headers: { "x-custom": "1" },
      },
      ctx,
    );
    expect(meta.schema).toBe("public");
    expect(meta.preferReturn).toBe("representation");
    expect(meta.headers).toEqual({
      "x-custom": "1",
      [NORA_OPERATION_ID_HEADER]: "11111111-2222-4333-8444-555555555555",
    });
  });

  it("D: keeps an already-valid x-nora-operation-id (no silent swap)", () => {
    const owned = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const other = "11111111-2222-4333-8444-555555555555";
    const ctx = createOperationContext({
      operationType: "deal.update",
      resourceType: "deals",
      operationId: other,
    });
    const meta = withOperationMeta(
      { headers: { [NORA_OPERATION_ID_HEADER]: owned.toUpperCase() } },
      ctx,
    );
    expect(meta.headers[NORA_OPERATION_ID_HEADER]).toBe(owned);
    expect(meta.headers[NORA_OPERATION_ID_HEADER]).not.toBe(other);
  });

  it("D: replaces an invalid existing header with the context id", () => {
    const ctx = createOperationContext({
      operationType: "deal.update",
      resourceType: "deals",
      operationId: "123e4567-e89b-12d3-a456-426614174000",
    });
    const meta = withOperationMeta(
      { headers: { [NORA_OPERATION_ID_HEADER]: "garbage" } },
      ctx,
    );
    expect(meta.headers[NORA_OPERATION_ID_HEADER]).toBe(
      "123e4567-e89b-12d3-a456-426614174000",
    );
  });

  it("E: two mutations with the same OperationContext share one UUID", () => {
    const ctx = createOperationContext({
      operationType: "deal.update",
      resourceType: "deals",
      resourceId: 9,
      operationId: "99999999-8888-4777-8666-555555555555",
    });
    const first = withOperationIdParams({ id: 9, data: { a: 1 } }, ctx);
    const second = withOperationIdParams({ id: 9, data: { b: 2 } }, ctx);
    expect(first.meta.headers[NORA_OPERATION_ID_HEADER]).toBe(ctx.operationId);
    expect(second.meta.headers[NORA_OPERATION_ID_HEADER]).toBe(ctx.operationId);
    expect(first.meta.headers[NORA_OPERATION_ID_HEADER]).toBe(
      second.meta.headers[NORA_OPERATION_ID_HEADER],
    );
  });

  it("preserves existing headers when wrapping params", () => {
    const ctx = createOperationContext({
      operationType: "deal.update",
      resourceType: "deals",
      operationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    });
    const params = withOperationIdParams(
      {
        id: 9,
        data: { name: "x" },
        meta: { headers: { "x-custom": "1" } },
      },
      ctx,
    );
    expect(params.meta?.headers).toEqual({
      "x-custom": "1",
      [NORA_OPERATION_ID_HEADER]: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    });
  });

  it("builds Edge invoke headers without minting; existing valid wins", () => {
    const owned = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const ctx = createOperationContext({
      operationType: "deal.update",
      resourceType: "deals",
      operationId: "99999999-8888-4777-8666-555555555555",
    });
    expect(operationIdInvokeHeaders(ctx, { "x-extra": "yes" })).toEqual({
      "x-extra": "yes",
      [NORA_OPERATION_ID_HEADER]: "99999999-8888-4777-8666-555555555555",
    });
    expect(
      operationIdInvokeHeaders(ctx, {
        "x-extra": "yes",
        [NORA_OPERATION_ID_HEADER]: owned,
      }),
    ).toEqual({
      "x-extra": "yes",
      [NORA_OPERATION_ID_HEADER]: owned,
    });
  });

  it("applies setHeader on RPC builders from context only", () => {
    const calls: Array<[string, string]> = [];
    const builder = {
      setHeader(name: string, value: string) {
        calls.push([name, value]);
        return this;
      },
    };
    const ctx = createOperationContext({
      operationType: "deal.update",
      resourceType: "deals",
      operationId: "123e4567-e89b-12d3-a456-426614174000",
    });
    applyOperationIdRpcHeader(builder, ctx);
    expect(calls).toEqual([
      [NORA_OPERATION_ID_HEADER, "123e4567-e89b-12d3-a456-426614174000"],
    ]);
  });

  it("reads operation id from mutation meta", () => {
    expect(readOperationIdFromMeta(undefined)).toBeNull();
    expect(
      readOperationIdFromMeta({
        headers: { [NORA_OPERATION_ID_HEADER]: "not-uuid" },
      }),
    ).toBeNull();
    expect(
      readOperationIdFromMeta({
        headers: {
          [NORA_OPERATION_ID_HEADER]: "123E4567-E89B-12D3-A456-426614174000",
        },
      }),
    ).toBe("123e4567-e89b-12d3-a456-426614174000");
  });
});
