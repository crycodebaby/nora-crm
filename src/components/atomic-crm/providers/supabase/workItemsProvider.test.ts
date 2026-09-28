import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WorkQueryError,
  getWorkItems,
} from "../../application/queries/getWorkItems";
import { NORA_ERROR_CODES } from "../../domain/noraErrorCodes";
import { getDataProvider } from "./dataProvider";

/**
 * Alpha Work 2 — the Supabase data provider as the Work read port, end to
 * end through its real wrappers (lifecycle callbacks, CRM error proxy):
 * exactly one call to the W-A RPC, no raw table access, and a
 * WorkQueryError that reaches the caller intact.
 */

const client = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(() => {
    throw new Error("raw table access is not part of the Work read");
  }),
  functions: {
    invoke: vi.fn(() => {
      throw new Error("Edge Functions are not part of the Work read");
    }),
  },
}));

vi.mock("./supabase", () => ({ getSupabaseClient: () => client }));

beforeEach(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("VITE_SB_PUBLISHABLE_KEY", "sb_publishable_test");
  client.rpc.mockReset();
  client.from.mockClear();
  client.functions.invoke.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const WORK_ID = "0b3f6d4e-1a2b-5c3d-8e4f-0000000000aa";

describe("Supabase provider — Work read port", () => {
  it("answers the Application query through exactly one get_work_items call and nothing else", async () => {
    client.rpc.mockResolvedValue({
      data: {
        data: [
          {
            work_id: WORK_ID,
            carrier: "task",
            title: "Aufmaß vereinbaren",
            work_type: null,
            validity: "valid",
            invalid_reason: null,
            state: "open",
            context: { customer: 5, contact: null },
            holder: { sales_id: 2, display_name: "Max Büro" },
            is_mine: false,
            is_unassigned: false,
            due_at: null,
            due_precision: "unknown",
            actionable: true,
            overdue: false,
            due_today: false,
          },
        ],
        limit: 50,
        scope: "team",
        state_scope: "open",
        next_cursor: null,
      },
      error: null,
      status: 200,
    });

    const page = await getWorkItems(getDataProvider(), { scope: "team" });

    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("get_work_items", {
      p_scope: "team",
      p_state_scope: "open",
      p_limit: null,
      p_cursor_due_at: null,
      p_cursor_work_id: null,
    });
    expect(client.from).not.toHaveBeenCalled();
    expect(client.functions.invoke).not.toHaveBeenCalled();
    expect(page.items.map((item) => item.workId)).toEqual([WORK_ID]);
    expect(page.items[0].context).toEqual({ customerId: 5, contactId: null });
  });

  it("delivers the W-A permission refusal as a WorkQueryError — the provider wrappers do not flatten it", async () => {
    client.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "42501",
        details: "NORA_PERMISSION_DENIED",
        hint: null,
        message: "forbidden",
      },
      status: 403,
    });

    const failure = await getWorkItems(getDataProvider(), {
      scope: "mine",
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(WorkQueryError);
    expect((failure as WorkQueryError).reason).toBe("permission_denied");
    expect((failure as WorkQueryError).code).toBe(
      NORA_ERROR_CODES.PERMISSION_DENIED,
    );
    expect(client.from).not.toHaveBeenCalled();
  });
});
