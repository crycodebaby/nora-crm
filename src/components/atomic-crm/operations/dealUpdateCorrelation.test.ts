/**
 * Unit-level documentation of the PostgREST header → Postgres correlation path.
 *
 * Full HTTP verification requires local Docker (`npx supabase start`) then:
 *   node scripts/verify-operation-header.mjs
 *   and/or supabase/tests/operation_correlation_verification.sql
 *
 * This file locks the client-side contract used by the Wave 1 vertical slice.
 */
import { describe, expect, it } from "vitest";
import {
  createOperationContext,
  NORA_OPERATION_ID_HEADER,
} from "../operations/operationContext";
import { withOperationIdParams } from "../operations/operationTransport";

describe("deal.update operation correlation contract", () => {
  it("builds PostgREST-ready meta.headers for a deal update", () => {
    const context = createOperationContext({
      operationType: "deal.update",
      resourceType: "deals",
      resourceId: 15,
      operationId: "abcdef01-2345-6789-abcd-ef0123456789",
    });

    const params = withOperationIdParams(
      {
        id: 15,
        data: { description: "Kontakttermin angepasst" },
        previousData: { id: 15, description: "alt" },
      },
      context,
    );

    expect(params.meta?.headers?.[NORA_OPERATION_ID_HEADER]).toBe(
      "abcdef01-2345-6789-abcd-ef0123456789",
    );
    // Correlation only — no auth material in meta
    expect(JSON.stringify(params.meta)).not.toMatch(/Bearer|password|service_role/i);
  });
});
