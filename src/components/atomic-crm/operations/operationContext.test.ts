import { describe, expect, it } from "vitest";
import {
  createOperationContext,
  createOperationId,
  formatOperationIdShort,
  isValidOperationId,
  NORA_OPERATION_ID_HEADER,
} from "./operationContext";
import {
  applyOperationIdRpcHeader,
  operationIdInvokeHeaders,
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

describe("operationTransport", () => {
  it("injects x-nora-operation-id into meta.headers", () => {
    const ctx = createOperationContext({
      operationType: "deal.update",
      resourceType: "deals",
      resourceId: 1,
      operationId: "11111111-2222-4333-8444-555555555555",
    });
    const meta = withOperationMeta({ schema: "public" }, ctx);
    expect(meta.headers[NORA_OPERATION_ID_HEADER]).toBe(
      "11111111-2222-4333-8444-555555555555",
    );
    expect(meta.schema).toBe("public");
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

  it("builds Edge invoke headers", () => {
    const ctx = createOperationContext({
      operationType: "deal.update",
      resourceType: "deals",
      operationId: "99999999-8888-4777-8666-555555555555",
    });
    expect(operationIdInvokeHeaders(ctx, { "x-extra": "yes" })).toEqual({
      "x-extra": "yes",
      [NORA_OPERATION_ID_HEADER]: "99999999-8888-4777-8666-555555555555",
    });
  });

  it("applies setHeader on RPC builders", () => {
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
});
