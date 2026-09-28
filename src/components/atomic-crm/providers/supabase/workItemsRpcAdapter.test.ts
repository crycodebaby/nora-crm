import { describe, expect, it, vi } from "vitest";

import waMigration from "../../../../../supabase/migrations/20260922120000_nora_work_read_model.sql?raw";
import applicationSource from "../../application/queries/getWorkItems.ts?raw";
import adapterSource from "./workItemsRpcAdapter.ts?raw";
import {
  GET_WORK_ITEMS_RPC,
  encodeWorkItemsCursor,
  readWorkItemsViaRpc,
  type GetWorkItemsRpc,
  type GetWorkItemsRpcArgs,
} from "./workItemsRpcAdapter";
import {
  WORK_SCOPES,
  WORK_STATE_SCOPES,
  WorkQueryError,
  getWorkItems,
  type WorkItemsCursor,
  type WorkItemsRequest,
} from "../../application/queries/getWorkItems";
import { NORA_ERROR_CODES } from "../../domain/noraErrorCodes";

/**
 * Alpha Work 2 — the Supabase adapter over the W-A Work query.
 * The fixtures mirror the jsonb projection of public.get_work_items
 * (migration 20260922120000) field for field.
 */

const WORK_A = "0b3f6d4e-1a2b-5c3d-8e4f-000000000001";
const WORK_B = "0b3f6d4e-1a2b-5c3d-8e4f-000000000002";
const WORK_C = "0b3f6d4e-1a2b-5c3d-8e4f-000000000003";
const WORK_D = "0b3f6d4e-1a2b-5c3d-8e4f-000000000004";
const WORK_E = "0b3f6d4e-1a2b-5c3d-8e4f-000000000005";

/** A complete, valid, open row exactly as the RPC projects it. */
const rawItem = (overrides: Record<string, unknown> = {}) => ({
  work_id: WORK_A,
  carrier: "task",
  title: "Rückruf Frau Keller",
  work_type: "Anruf",
  validity: "valid",
  invalid_reason: null,
  state: "open",
  context: { customer: 12, contact: 34 },
  holder: { sales_id: 3, display_name: "Erika Muster" },
  is_mine: true,
  is_unassigned: false,
  due_at: "2026-09-28T08:00:00.123456+00:00",
  due_precision: "unknown",
  actionable: true,
  overdue: true,
  due_today: false,
  ...overrides,
});

const envelope = (
  data: unknown[],
  overrides: Record<string, unknown> = {},
) => ({
  data,
  limit: 50,
  scope: "mine",
  state_scope: "open",
  next_cursor: null,
  ...overrides,
});

const request = (
  overrides: Partial<WorkItemsRequest> = {},
): WorkItemsRequest => ({
  scope: "mine",
  stateScope: "open",
  pageSize: null,
  cursor: null,
  ...overrides,
});

const answering = (
  data: unknown,
  error: unknown = null,
  status = error ? 400 : 200,
) => {
  const rpc = vi.fn<GetWorkItemsRpc>(async () => ({ data, error, status }));
  return rpc;
};

const expectWorkQueryError = async (
  promise: Promise<unknown>,
  reason: WorkQueryError["reason"],
): Promise<WorkQueryError> => {
  const error = await promise.then(
    (value) => {
      throw new Error(
        `expected a ${reason} failure, got a result: ${JSON.stringify(value)}`,
      );
    },
    (rejection: unknown) => rejection,
  );
  expect(error).toBeInstanceOf(WorkQueryError);
  expect((error as WorkQueryError).reason).toBe(reason);
  return error as WorkQueryError;
};

describe("Work read adapter — transport → Application DTO", () => {
  it("maps a complete Work item field for field", async () => {
    const page = await readWorkItemsViaRpc(
      request(),
      answering(envelope([rawItem()])),
    );

    expect(page).toEqual({
      items: [
        {
          workId: WORK_A,
          carrier: "task",
          title: "Rückruf Frau Keller",
          workType: "Anruf",
          validity: "valid",
          invalidReason: null,
          state: "open",
          holder: { salesId: 3, displayName: "Erika Muster" },
          dueAt: "2026-09-28T08:00:00.123456+00:00",
          duePrecision: "unknown",
          context: { customerId: 12, contactId: 34 },
          derived: {
            actionable: true,
            overdue: true,
            dueToday: false,
            isMine: true,
            isUnassigned: false,
          },
        },
      ],
      scope: "mine",
      stateScope: "open",
      pageSize: 50,
      nextCursor: null,
    });
  });

  it("keeps the server's work_id as the stable identity", async () => {
    const rpc = answering(envelope([rawItem({ work_id: WORK_C })]));
    const first = await readWorkItemsViaRpc(request(), rpc);
    const second = await readWorkItemsViaRpc(request(), rpc);
    expect(first.items[0].workId).toBe(WORK_C);
    expect(second.items[0].workId).toBe(first.items[0].workId);
  });

  it("preserves every null the authority returns — no default, no substitute", async () => {
    const page = await readWorkItemsViaRpc(
      request({ scope: "team" }),
      answering(
        envelope(
          [
            rawItem({
              work_type: null,
              due_at: null,
              holder: null,
              is_mine: false,
              is_unassigned: true,
              context: { customer: null, contact: 34 },
              overdue: false,
            }),
          ],
          { scope: "team" },
        ),
      ),
    );
    const [item] = page.items;
    expect(item.workType).toBeNull();
    expect(item.dueAt).toBeNull();
    expect(item.holder).toBeNull();
    expect(item.context).toEqual({ customerId: null, contactId: 34 });
    expect(item.derived.isUnassigned).toBe(true);
  });

  it("keeps an incomplete row in the page, in place, as incomplete Work — never repaired, never dropped", async () => {
    const page = await readWorkItemsViaRpc(
      request(),
      answering(
        envelope([
          rawItem({ work_id: WORK_A }),
          rawItem({
            work_id: WORK_B,
            title: null,
            validity: "incomplete",
            invalid_reason: "missing_title",
            actionable: false,
          }),
          rawItem({ work_id: WORK_C }),
        ]),
      ),
    );
    expect(page.items.map((item) => item.workId)).toEqual([
      WORK_A,
      WORK_B,
      WORK_C,
    ]);
    const incomplete = page.items[1];
    expect(incomplete).toMatchObject({
      validity: "incomplete",
      title: null,
      invalidReason: "missing_title",
      state: "open",
    });
    expect(incomplete.derived.actionable).toBe(false);
  });

  it("copies server-derived flags verbatim — it never re-evaluates them against the clock or the row", async () => {
    // Deliberately "surprising" combinations: a client that recomputed
    // overdue/due_today/actionable from due_at or state would change them.
    const page = await readWorkItemsViaRpc(
      request({ stateScope: "all" }),
      answering(
        envelope(
          [
            rawItem({
              work_id: WORK_A,
              due_at: "2099-01-01T00:00:00+00:00",
              overdue: true,
              due_today: true,
            }),
            rawItem({
              work_id: WORK_B,
              due_at: "2001-01-01T00:00:00+00:00",
              overdue: false,
              due_today: false,
              actionable: false,
              is_mine: false,
            }),
            rawItem({
              work_id: WORK_C,
              state: "done",
              actionable: true,
            }),
          ],
          { state_scope: "all" },
        ),
      ),
    );
    expect(page.items.map((item) => item.derived)).toEqual([
      {
        actionable: true,
        overdue: true,
        dueToday: true,
        isMine: true,
        isUnassigned: false,
      },
      {
        actionable: false,
        overdue: false,
        dueToday: false,
        isMine: false,
        isUnassigned: false,
      },
      {
        actionable: true,
        overdue: true,
        dueToday: false,
        isMine: true,
        isUnassigned: false,
      },
    ]);
  });

  it("keeps the authority's order exactly — no client re-sort", async () => {
    // Not in any order a client would produce: later due first, the undated
    // row in the middle, ids descending.
    const page = await readWorkItemsViaRpc(
      request(),
      answering(
        envelope([
          rawItem({ work_id: WORK_E, due_at: "2026-12-01T00:00:00+00:00" }),
          rawItem({ work_id: WORK_D, due_at: null }),
          rawItem({ work_id: WORK_A, due_at: "2026-01-01T00:00:00+00:00" }),
        ]),
      ),
    );
    expect(page.items.map((item) => item.workId)).toEqual([
      WORK_E,
      WORK_D,
      WORK_A,
    ]);
  });

  it("accepts the full frozen due-precision vocabulary without interpreting it", async () => {
    const page = await readWorkItemsViaRpc(
      request(),
      answering(
        envelope([
          rawItem({ work_id: WORK_A, due_precision: "unknown" }),
          rawItem({ work_id: WORK_B, due_precision: "day" }),
          rawItem({ work_id: WORK_C, due_precision: "instant" }),
        ]),
      ),
    );
    expect(page.items.map((item) => item.duePrecision)).toEqual([
      "unknown",
      "day",
      "instant",
    ]);
  });

  it("ignores fields the contract does not know and never propagates them — no deal, no allowed_actions", async () => {
    const page = await readWorkItemsViaRpc(
      request(),
      answering(
        envelope(
          [
            rawItem({
              deal_id: 9,
              case: { id: 9 },
              allowed_actions: ["work.complete"],
              context: { customer: 12, contact: 34, deal: 9 },
              holder: { sales_id: 3, display_name: "Erika Muster", role: "x" },
            }),
          ],
          { total: 99, attention: [] },
        ),
      ),
    );
    expect(Object.keys(page).sort()).toEqual(
      ["items", "nextCursor", "pageSize", "scope", "stateScope"].sort(),
    );
    const [item] = page.items;
    expect(Object.keys(item).sort()).toEqual(
      [
        "carrier",
        "context",
        "derived",
        "dueAt",
        "duePrecision",
        "holder",
        "invalidReason",
        "state",
        "title",
        "validity",
        "workId",
        "workType",
      ].sort(),
    );
    expect(Object.keys(item.context).sort()).toEqual([
      "contactId",
      "customerId",
    ]);
    expect(Object.keys(item.holder ?? {}).sort()).toEqual([
      "displayName",
      "salesId",
    ]);
    expect(JSON.stringify(page)).not.toMatch(/deal|case|allowed/i);
  });

  it("returns a genuinely empty page as an empty page", async () => {
    const page = await readWorkItemsViaRpc(request(), answering(envelope([])));
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });
});

describe("Work read adapter — RPC invocation and pagination", () => {
  it("asks the authority once, with the complete named signature and no actor", async () => {
    const rpc = answering(envelope([]));
    await readWorkItemsViaRpc(
      request({ scope: "team", stateScope: "done", pageSize: 25 }),
      rpc,
    );
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(GET_WORK_ITEMS_RPC, {
      p_scope: "team",
      p_state_scope: "done",
      p_limit: 25,
      p_cursor_due_at: null,
      p_cursor_work_id: null,
    });
    expect(GET_WORK_ITEMS_RPC).toBe("get_work_items");
  });

  it("leaves the page size to the authority when none is asked for, and reports the applied size", async () => {
    const rpc = answering(envelope([], { limit: 50 }));
    const page = await readWorkItemsViaRpc(request({ pageSize: null }), rpc);
    expect(rpc.mock.calls[0][1].p_limit).toBeNull();
    expect(page.pageSize).toBe(50);
  });

  it("hands the next cursor back with the exact microsecond due_at — never through a JS Date", async () => {
    const dueAt = "2026-09-28T08:00:00.123456+00:00";
    const first = await readWorkItemsViaRpc(
      request(),
      answering(
        envelope([rawItem({ work_id: WORK_B, due_at: dueAt })], {
          next_cursor: { due_at: dueAt, work_id: WORK_B },
        }),
      ),
    );
    expect(typeof first.nextCursor).toBe("string");

    const rpc = answering(envelope([]));
    await readWorkItemsViaRpc(request({ cursor: first.nextCursor }), rpc);
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_cursor_due_at: dueAt,
      p_cursor_work_id: WORK_B,
    });
  });

  it("continues inside the NULLS LAST tail with a null due_at and a work_id", async () => {
    const first = await readWorkItemsViaRpc(
      request(),
      answering(
        envelope([rawItem({ work_id: WORK_D, due_at: null })], {
          next_cursor: { due_at: null, work_id: WORK_D },
        }),
      ),
    );
    const rpc = answering(envelope([]));
    await readWorkItemsViaRpc(request({ cursor: first.nextCursor }), rpc);
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_cursor_due_at: null,
      p_cursor_work_id: WORK_D,
    });
  });

  it("walks every page through the Application query without duplicates or gaps and ends on next_cursor = null", async () => {
    const tie = "2026-09-29T10:00:00+00:00";
    const a = rawItem({ work_id: WORK_A, due_at: "2026-09-28T10:00:00+00:00" });
    const b = rawItem({ work_id: WORK_B, due_at: tie });
    const c = rawItem({ work_id: WORK_C, due_at: tie });
    const d = rawItem({ work_id: WORK_D, due_at: null });
    const e = rawItem({ work_id: WORK_E, due_at: null });

    // The fake authority answers only the exact keyset positions it expects;
    // any other cursor is an error, so a dropped component fails the walk.
    const script = new Map<string, unknown>([
      [
        JSON.stringify([null, null]),
        envelope([a, b], {
          limit: 2,
          scope: "team",
          next_cursor: { due_at: tie, work_id: WORK_B },
        }),
      ],
      [
        JSON.stringify([tie, WORK_B]),
        envelope([c, d], {
          limit: 2,
          scope: "team",
          next_cursor: { due_at: null, work_id: WORK_D },
        }),
      ],
      [
        JSON.stringify([null, WORK_D]),
        envelope([e], { limit: 2, scope: "team", next_cursor: null }),
      ],
    ]);
    const rpc = vi.fn<GetWorkItemsRpc>(async (_fn, args) => {
      const key = JSON.stringify([args.p_cursor_due_at, args.p_cursor_work_id]);
      return script.has(key)
        ? { data: script.get(key), error: null, status: 200 }
        : {
            data: null,
            error: { code: "P0001", message: `unexpected cursor ${key}` },
            status: 400,
          };
    });
    const reader = {
      getWorkItems: (req: WorkItemsRequest) => readWorkItemsViaRpc(req, rpc),
    };

    const seen: string[] = [];
    let cursor: WorkItemsCursor | null = null;
    let pages = 0;
    do {
      const page = await getWorkItems(reader, {
        scope: "team",
        pageSize: 2,
        cursor,
      });
      seen.push(...page.items.map((item) => item.workId));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null && pages < 10);

    expect(pages).toBe(3);
    expect(seen).toEqual([WORK_A, WORK_B, WORK_C, WORK_D, WORK_E]);
    expect(new Set(seen).size).toBe(seen.length);
    expect(rpc.mock.calls.map(([, args]) => args)).toEqual<
      GetWorkItemsRpcArgs[]
    >([
      {
        p_scope: "team",
        p_state_scope: "open",
        p_limit: 2,
        p_cursor_due_at: null,
        p_cursor_work_id: null,
      },
      {
        p_scope: "team",
        p_state_scope: "open",
        p_limit: 2,
        p_cursor_due_at: tie,
        p_cursor_work_id: WORK_B,
      },
      {
        p_scope: "team",
        p_state_scope: "open",
        p_limit: 2,
        p_cursor_due_at: null,
        p_cursor_work_id: WORK_D,
      },
    ]);
  });

  it.each([
    ["an arbitrary string", "abc"],
    ["the right prefix with garbage", "wc1.!!!"],
    [
      "a payload without a valid work_id",
      `wc1.${btoa(JSON.stringify({ s: "mine", t: "open", d: null, w: "7" }))}`,
    ],
    [
      "a payload whose due_at is not a timestamp",
      `wc1.${btoa(
        JSON.stringify({ s: "mine", t: "open", d: "morgen", w: WORK_A }),
      )}`,
    ],
  ])(
    "refuses %s as a cursor before asking anything",
    async (_label, cursor) => {
      const rpc = answering(envelope([]));
      await expectWorkQueryError(
        readWorkItemsViaRpc(
          request({ cursor: cursor as WorkItemsCursor }),
          rpc,
        ),
        "invalid_request",
      );
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it("refuses a cursor taken from another scope or state scope", async () => {
    const mineCursor = encodeWorkItemsCursor({
      s: "mine",
      t: "open",
      d: null,
      w: WORK_A,
    });
    const rpc = answering(envelope([]));
    await expectWorkQueryError(
      readWorkItemsViaRpc(request({ scope: "team", cursor: mineCursor }), rpc),
      "invalid_request",
    );
    await expectWorkQueryError(
      readWorkItemsViaRpc(
        request({ stateScope: "done", cursor: mineCursor }),
        rpc,
      ),
      "invalid_request",
    );
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("Work read adapter — failures are failures, never an empty list", () => {
  it("maps the W-A actor refusal (42501 / NORA_PERMISSION_DENIED) to permission_denied and keeps the diagnostics", async () => {
    const transportError = {
      code: "42501",
      details: "NORA_PERMISSION_DENIED",
      hint: null,
      message: "forbidden",
    };
    const error = await expectWorkQueryError(
      readWorkItemsViaRpc(request(), answering(null, transportError, 403)),
      "permission_denied",
    );
    expect(error.code).toBe(NORA_ERROR_CODES.PERMISSION_DENIED);
    expect(error.normalized?.messageKey).toBe("crm.errors.permission_denied");
    expect(error.normalized?.status).toBe(403);
    expect(error.cause).toBe(transportError);
  });

  it("maps an expired or missing session (401) to permission_denied without inventing a Nora code", async () => {
    const error = await expectWorkQueryError(
      readWorkItemsViaRpc(
        request(),
        answering(
          null,
          {
            code: "PGRST303",
            details: null,
            hint: null,
            message: "JWT expired",
          },
          401,
        ),
      ),
      "permission_denied",
    );
    expect(error.code).toBeNull();
    expect(error.normalized?.messageKey).toBe("crm.errors.not_authenticated");
  });

  it("keeps the transport class of other failures (network, service, rejected parameters)", async () => {
    const network = await expectWorkQueryError(
      readWorkItemsViaRpc(
        request(),
        answering(
          null,
          {
            code: "",
            details: "TypeError: Failed to fetch",
            hint: "",
            message: "TypeError: Failed to fetch",
          },
          0,
        ),
      ),
      "failed",
    );
    expect(network.normalized?.kind).toBe("network");

    const service = await expectWorkQueryError(
      readWorkItemsViaRpc(
        request(),
        answering(null, { message: "Service Unavailable" }, 503),
      ),
      "failed",
    );
    expect(service.normalized?.kind).toBe("service_unavailable");

    const rejected = await expectWorkQueryError(
      readWorkItemsViaRpc(
        request(),
        answering(
          null,
          {
            code: "22023",
            details: null,
            hint: null,
            message: "unknown work scope: everything",
          },
          400,
        ),
      ),
      "failed",
    );
    expect(rejected.code).toBeNull();
    expect(rejected.normalized?.technicalMessage).toBe(
      "unknown work scope: everything",
    );
  });

  it("tells an absent field from an explicit null and names the missing field", async () => {
    const { context: _omitted, ...withoutContext } = rawItem();
    const noContext = await expectWorkQueryError(
      readWorkItemsViaRpc(request(), answering(envelope([withoutContext]))),
      "malformed_response",
    );
    expect(noContext.message).toContain("envelope.data[0].context is missing");

    const noCustomer = await expectWorkQueryError(
      readWorkItemsViaRpc(
        request(),
        answering(envelope([rawItem({ context: { contact: 34 } })])),
      ),
      "malformed_response",
    );
    expect(noCustomer.message).toContain(
      "envelope.data[0].context.customer is missing",
    );
  });

  it("maps a throwing transport to failed and keeps the thrown error as cause", async () => {
    const boom = new Error("socket hang up");
    const error = await expectWorkQueryError(
      readWorkItemsViaRpc(request(), () => Promise.reject(boom)),
      "failed",
    );
    expect(error.cause).toBe(boom);
  });

  const malformedAnswers: Array<[string, unknown]> = [
    ["no data at all", null],
    ["an array instead of the envelope", []],
    ["an envelope without data", { ...envelope([]), data: undefined }],
    ["data that is not an array", envelope({} as unknown as unknown[])],
    [
      "an envelope without next_cursor",
      (() => {
        const { next_cursor: _omit, ...rest } = envelope([]);
        return rest;
      })(),
    ],
    ["a non-positive limit", envelope([], { limit: 0 })],
    ["an unknown scope", envelope([], { scope: "everyone" })],
    ["an unknown state scope", envelope([], { state_scope: "deferred" })],
    [
      "more items than the applied limit",
      envelope([rawItem({ work_id: WORK_A }), rawItem({ work_id: WORK_B })], {
        limit: 1,
      }),
    ],
    ["a fractional limit", envelope([], { limit: 0.5 })],
    ["an item that is not an object", envelope(["x"])],
    [
      "an item without context",
      envelope([
        (() => {
          const { context: _omit, ...rest } = rawItem();
          return rest;
        })(),
      ]),
    ],
    [
      "a context without the customer key (absent is not null)",
      envelope([rawItem({ context: { contact: 34 } })]),
    ],
    ["an unknown carrier", envelope([rawItem({ carrier: "checklist" })])],
    ["an unknown state", envelope([rawItem({ state: "deferred" })])],
    [
      "an unknown due precision",
      envelope([rawItem({ due_precision: "hour" })]),
    ],
    [
      "a work_id that is not a UUID",
      envelope([rawItem({ work_id: "task:7" })]),
    ],
    [
      "a due_at that is not a timestamp",
      envelope([rawItem({ due_at: "morgen" })]),
    ],
    [
      "a holder id sent as a string",
      envelope([rawItem({ holder: { sales_id: "3", display_name: null } })]),
    ],
    [
      "an id beyond the safe integer range",
      envelope([rawItem({ context: { customer: 2 ** 60, contact: null } })]),
    ],
    [
      "a derived flag that is not a boolean",
      envelope([rawItem({ overdue: "yes" })]),
    ],
    ["a valid row without a title", envelope([rawItem({ title: null })])],
    [
      "an incomplete row with a title",
      envelope([
        rawItem({ validity: "incomplete", invalid_reason: "missing_title" }),
      ]),
    ],
    [
      "an incomplete row without its reason",
      envelope([
        rawItem({ title: null, validity: "incomplete", invalid_reason: null }),
      ]),
    ],
    [
      "a next_cursor on an empty page",
      envelope([], { next_cursor: { due_at: null, work_id: WORK_A } }),
    ],
    [
      "a next_cursor that is not the last item",
      envelope([rawItem({ work_id: WORK_A })], {
        next_cursor: {
          due_at: "2026-09-28T08:00:00.123456+00:00",
          work_id: WORK_B,
        },
      }),
    ],
    [
      "a next_cursor whose due_at lost precision",
      envelope([rawItem({ work_id: WORK_A })], {
        next_cursor: { due_at: "2026-09-28T08:00:00.123Z", work_id: WORK_A },
      }),
    ],
  ];

  it.each(malformedAnswers)(
    "fails closed on %s — the page is refused, not trimmed",
    async (_label, data) => {
      await expectWorkQueryError(
        readWorkItemsViaRpc(request(), answering(data)),
        "malformed_response",
      );
    },
  );
});

describe("Work read adapter — alignment with the W-A authority", () => {
  const signature = waMigration.match(
    /create or replace function public\.get_work_items\(([\s\S]*?)\)\s*returns jsonb/,
  );

  it("sends exactly the named arguments of public.get_work_items", () => {
    expect(signature).not.toBeNull();
    const argumentNames = [
      ...(signature?.[1] ?? "").matchAll(/(p_\w+)\s/g),
    ].map((match) => match[1]);
    const sent: Array<keyof GetWorkItemsRpcArgs> = [
      "p_scope",
      "p_state_scope",
      "p_limit",
      "p_cursor_due_at",
      "p_cursor_work_id",
    ];
    expect(argumentNames).toEqual(sent);
  });

  it("reads exactly the envelope and row keys the authority projects", () => {
    for (const key of [
      "data",
      "limit",
      "scope",
      "state_scope",
      "next_cursor",
    ]) {
      expect(waMigration).toContain(`'${key}',`);
    }
    for (const key of [
      "work_id",
      "carrier",
      "title",
      "work_type",
      "validity",
      "invalid_reason",
      "state",
      "context",
      "customer",
      "contact",
      "holder",
      "sales_id",
      "display_name",
      "is_mine",
      "is_unassigned",
      "due_at",
      "due_precision",
      "actionable",
      "overdue",
      "due_today",
    ]) {
      expect(waMigration).toContain(`'${key}',`);
      expect(adapterSource).toContain(`"${key}"`);
    }
  });

  it("uses exactly the authority's closed scope vocabularies", () => {
    const vocabulary = (guard: RegExp) =>
      [...(waMigration.match(guard)?.[1] ?? "").matchAll(/'(\w+)'/g)].map(
        (match) => match[1],
      );
    expect(vocabulary(/v_scope not in \(([^)]*)\)/)).toEqual([...WORK_SCOPES]);
    expect(vocabulary(/v_state_scope not in \(([^)]*)\)/)).toEqual([
      ...WORK_STATE_SCOPES,
    ]);
  });

  it("contains no raw task read, no client-side date classification and no task predicate", () => {
    for (const source of [adapterSource, applicationSource]) {
      expect(source).not.toMatch(/\.from\(\s*["']tasks["']/);
      expect(source).not.toMatch(/tasksPredicate/);
      expect(source).not.toMatch(/new Date\(|getTimezoneOffset|toLocale/);
    }
  });
});
