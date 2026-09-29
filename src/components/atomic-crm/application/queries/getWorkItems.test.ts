import { describe, expect, it, vi } from "vitest";

import {
  WorkQueryError,
  getWorkItems,
  type GetWorkItemsInput,
  type WorkItemsCursor,
  type WorkItemsPage,
  type WorkItemsReader,
  type WorkItemsRequest,
} from "./getWorkItems";

/**
 * Alpha Work 2 — the Application query. The reader is a test double of the
 * port; what is asserted is the Application contract around it: the
 * resolved request, the actor boundary, and that a failure is never an
 * empty page.
 */

const page = (overrides: Partial<WorkItemsPage> = {}): WorkItemsPage => ({
  items: [],
  scope: "mine",
  stateScope: "open",
  pageSize: 50,
  nextCursor: null,
  ...overrides,
});

const readerAnswering = (answer: (request: WorkItemsRequest) => unknown) => {
  const getWorkItemsSpy = vi.fn(async (request: WorkItemsRequest) =>
    answer(request),
  );
  return {
    reader: { getWorkItems: getWorkItemsSpy } as unknown as WorkItemsReader,
    getWorkItemsSpy,
  };
};

const echo = (request: WorkItemsRequest) =>
  page({ scope: request.scope, stateScope: request.stateScope });

const rejectsWith = async (
  promise: Promise<unknown>,
  reason: WorkQueryError["reason"],
): Promise<WorkQueryError> => {
  const error = await promise.then(
    (value) => {
      throw new Error(`expected ${reason}, got ${JSON.stringify(value)}`);
    },
    (rejection: unknown) => rejection,
  );
  expect(error).toBeInstanceOf(WorkQueryError);
  expect((error as WorkQueryError).reason).toBe(reason);
  return error as WorkQueryError;
};

describe("getWorkItems — request resolution", () => {
  it("asks for open Work by default and leaves page size and position to the authority", async () => {
    const { reader, getWorkItemsSpy } = readerAnswering(echo);
    await getWorkItems(reader, { scope: "mine" });
    expect(getWorkItemsSpy).toHaveBeenCalledTimes(1);
    expect(getWorkItemsSpy).toHaveBeenCalledWith({
      scope: "mine",
      stateScope: "open",
      pageSize: null,
      cursor: null,
    });
  });

  it("passes an explicit state scope, page size and cursor through unchanged", async () => {
    const { reader, getWorkItemsSpy } = readerAnswering(echo);
    const cursor = "wc1.opaque" as WorkItemsCursor;
    await getWorkItems(reader, {
      scope: "team",
      stateScope: "done",
      pageSize: 10,
      cursor,
    });
    expect(getWorkItemsSpy).toHaveBeenCalledWith({
      scope: "team",
      stateScope: "done",
      pageSize: 10,
      cursor,
    });
  });

  it("returns the reader's page exactly as answered", async () => {
    const answered = page({
      scope: "team",
      stateScope: "all",
      nextCursor: "wc1.next" as WorkItemsCursor,
    });
    const { reader } = readerAnswering(() => answered);
    await expect(
      getWorkItems(reader, { scope: "team", stateScope: "all" }),
    ).resolves.toBe(answered);
  });

  it("returns a genuinely empty page as empty — [] is an answer, not a failure", async () => {
    const { reader } = readerAnswering(echo);
    await expect(getWorkItems(reader, { scope: "mine" })).resolves.toEqual(
      page(),
    );
  });
});

describe("getWorkItems — the actor is never a caller input", () => {
  it.each([
    ["salesId", 17],
    ["sales_id", 17],
    ["actorId", 17],
    ["actor", { id: 17 }],
    ["userId", "c0ffee"],
    ["holder", 17],
    ["employeeId", 17],
  ])(
    "refuses an input carrying %s instead of ignoring it, and asks nothing",
    async (key, value) => {
      const { reader, getWorkItemsSpy } = readerAnswering(echo);
      const error = await rejectsWith(
        getWorkItems(reader, {
          scope: "mine",
          [key]: value,
        } as unknown as GetWorkItemsInput),
        "invalid_request",
      );
      expect(error.message).toContain(key);
      expect(getWorkItemsSpy).not.toHaveBeenCalled();
    },
  );

  it("offers no scope beyond mine and team — no free-work queue, no employee lookup", async () => {
    for (const scope of ["unassigned", "free", "all", "employee", "", null]) {
      const { reader, getWorkItemsSpy } = readerAnswering(echo);
      await rejectsWith(
        getWorkItems(reader, { scope } as unknown as GetWorkItemsInput),
        "invalid_request",
      );
      expect(getWorkItemsSpy).not.toHaveBeenCalled();
    }
  });
});

describe("getWorkItems — input validation", () => {
  it.each<[string, unknown]>([
    ["no input", undefined],
    ["null", null],
    ["an array", []],
    ["a bare scope string", "mine"],
    ["a missing scope", {}],
    ["an unknown state scope", { scope: "mine", stateScope: "deferred" }],
    ["a zero page size", { scope: "mine", pageSize: 0 }],
    ["a negative page size", { scope: "mine", pageSize: -5 }],
    ["a fractional page size", { scope: "mine", pageSize: 2.5 }],
    ["a page size string", { scope: "mine", pageSize: "10" }],
    ["an empty cursor", { scope: "mine", cursor: "" }],
    ["a non-string cursor", { scope: "mine", cursor: { due_at: null } }],
  ])("refuses %s before asking anything", async (_label, input) => {
    const { reader, getWorkItemsSpy } = readerAnswering(echo);
    await rejectsWith(
      getWorkItems(reader, input as GetWorkItemsInput),
      "invalid_request",
    );
    expect(getWorkItemsSpy).not.toHaveBeenCalled();
  });
});

describe("getWorkItems — failures are never an empty page", () => {
  it("rethrows a reader's WorkQueryError unchanged", async () => {
    const denied = new WorkQueryError("permission_denied", "no session");
    const { reader } = readerAnswering(() => Promise.reject(denied));
    await expect(getWorkItems(reader, { scope: "mine" })).rejects.toBe(denied);
  });

  it("turns any other reader failure into `failed`, keeping it as the cause", async () => {
    const boom = new TypeError("reader exploded");
    const { reader } = readerAnswering(() => Promise.reject(boom));
    const error = await rejectsWith(
      getWorkItems(reader, { scope: "mine" }),
      "failed",
    );
    expect(error.cause).toBe(boom);
  });

  it("refuses an answer to a different question", async () => {
    const otherScope = readerAnswering(() => page({ scope: "team" }));
    await rejectsWith(
      getWorkItems(otherScope.reader, { scope: "mine" }),
      "malformed_response",
    );

    const otherState = readerAnswering(() => page({ stateScope: "all" }));
    await rejectsWith(
      getWorkItems(otherState.reader, { scope: "mine" }),
      "malformed_response",
    );

    const nothing = readerAnswering(() => undefined);
    await rejectsWith(
      getWorkItems(nothing.reader, { scope: "mine" }),
      "malformed_response",
    );
  });

  it("reports what to branch on — reason and code — not message text", () => {
    const error = new WorkQueryError("unavailable", "demo");
    expect(error.reason).toBe("unavailable");
    expect(error.code).toBeNull();
    expect(error.normalized).toBeNull();
    expect(error.name).toBe("WorkQueryError");
  });
});
