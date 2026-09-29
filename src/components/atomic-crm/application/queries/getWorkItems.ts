/**
 * Application Query: GetWorkItems (Alpha Work 2, 2026-09-29).
 *
 * "Give the authenticated Nora user Work items according to the W-A Work read
 * contract" — the one typed Application entry point for reading Work. The
 * authority is the server-side W-A query (docs/nora/25 §21, 22 §6.13); this
 * module only states the question and carries the answer:
 *
 *   caller (UI, later MCP) → getWorkItems (here) → WorkItemsReader (port)
 *     → Supabase adapter (providers/supabase/workItemsRpcAdapter.ts) → RPC
 *
 * What this layer deliberately does NOT do:
 * - it never names or accepts an actor: the employee comes from the
 *   authenticated session on the server (25 §10.1). An input carrying any key
 *   outside the contract — `salesId`, `actorId`, … — is refused, never
 *   silently ignored, so a caller can never believe it read someone else's
 *   Work (the same refusal the RPC gives a spoofed argument);
 * - it never filters, sorts, classifies or completes Work: order, validity,
 *   `overdue`/`due_today`/`actionable`, holder and context are what the
 *   server returned (25 §16.2 — no consumer computes Core domain rules);
 * - it never turns a failure into an empty page: `[]` means "the authority
 *   answered: nothing", a failure is always a thrown WorkQueryError;
 * - it never infers a Vorgang (25 §14.3), free Work beyond the server's
 *   `isUnassigned`, Attention, or any AI interpretation.
 *
 * Reads are not Operations (docs/nora/23 §1): no operation id, no manager.
 */
import type { NoraErrorCode } from "../../domain/noraErrorCodes";
import type { NormalizedCrmError } from "../../misc/normalizeCrmError";

// ---------------------------------------------------------------------------
// Query vocabulary — exactly what the W-A authority supports (25 §21.1)
// ---------------------------------------------------------------------------

/**
 * `mine` — open Work whose holder is the authenticated employee.
 * `team` — all Work Nora security lets the authenticated employee see
 * (25 §15). There is no third scope: no per-employee lookup, no free-work
 * queue, no service-area team (G-3 / G-8 are unbegun gates).
 */
export type WorkScope = "mine" | "team";

/**
 * `open` is the Arbeitskorb default (25 §17.1); `done` and `all` are the
 * explicit, never-default ways to see completed Work. Validity is never a
 * filter (25 §17.2).
 */
export type WorkStateScope = "open" | "done" | "all";

export const WORK_SCOPES: readonly WorkScope[] = ["mine", "team"];
export const WORK_STATE_SCOPES: readonly WorkStateScope[] = [
  "open",
  "done",
  "all",
];

/** The contract default for the state scope (25 §17.1). */
export const DEFAULT_WORK_STATE_SCOPE: WorkStateScope = "open";

/**
 * Opaque position in the server's total order. Only the Infrastructure
 * adapter mints and reads it; everyone else hands it back unchanged. Never
 * build, parse, compare or persist its contents.
 */
export type WorkItemsCursor = string & {
  readonly __brand: "WorkItemsCursor";
};

// ---------------------------------------------------------------------------
// Work item DTO (25 §21.3), grouped by what kind of truth each field is
// ---------------------------------------------------------------------------

/** Stable per-row Work identity (UUID). Not an authorization token. */
export type WorkId = string;

/** Closed value vocabularies of a Work row (25 §5, §6.2, §7, §21.3). */
export const WORK_CARRIERS = ["task"] as const;
export const WORK_STATES = ["open", "done"] as const;
export const WORK_VALIDITIES = ["valid", "incomplete"] as const;
export const WORK_INVALID_REASONS = ["missing_title"] as const;
export const WORK_DUE_PRECISIONS = ["day", "instant", "unknown"] as const;

export type WorkState = (typeof WORK_STATES)[number];

/**
 * The full frozen due-precision vocabulary (25 §7). W-A emits only
 * `unknown`; `day` / `instant` become reachable with G-1 and keep their
 * contracted meaning. A consumer never interprets the precision itself —
 * `overdue` / `dueToday` in `derived` already carry the consequence.
 */
export type WorkDuePrecision = (typeof WORK_DUE_PRECISIONS)[number];

/** The current holder. `displayName` is for display only — never identity. */
export type WorkHolder = {
  salesId: number;
  displayName: string | null;
};

/**
 * CRM context as stored on the carrier. `null` means "this Work item HAS no
 * such context" (25 §14.2) — never "not loaded", never "resolve it yourself".
 * There is deliberately no Vorgang/deal field (25 §14.3, gate G-2).
 */
export type WorkContext = {
  /** Historical customer context of the task (25 §14.1), not the contact's live customer. */
  customerId: number | null;
  contactId: number | null;
};

/**
 * Server-derived read state (25 §16.1). Evaluated by the server
 * (Europe/Berlin, per-call business day) and never stored — and never
 * recomputed by a consumer.
 */
export type WorkDerivedState = {
  actionable: boolean;
  overdue: boolean;
  dueToday: boolean;
  isMine: boolean;
  isUnassigned: boolean;
};

/**
 * Row validity (25 §5). An incomplete row is still Work the authority
 * returned: it stays in the page, carries no title and is not actionable.
 */
export type WorkRowValidity =
  | { validity: "valid"; title: string; invalidReason: null }
  | { validity: "incomplete"; title: null; invalidReason: "missing_title" };

export type WorkItem = {
  workId: WorkId;
  /** The Work carrier; `task` is the only carrier in Work v1 (25 §4.2). */
  carrier: "task";
  /** Open classification string, not a closed set (25 §21.3). */
  workType: string | null;
  state: WorkState;
  holder: WorkHolder | null;
  /**
   * The server's timestamptz rendering, verbatim. `null` = no due date set
   * (valid). It is NOT guaranteed to be parseable by a JS `Date`: Postgres
   * may render `infinity`, five-digit years or `BC` dates. Never re-derive
   * `overdue` / `dueToday` from it.
   */
  dueAt: string | null;
  duePrecision: WorkDuePrecision;
  context: WorkContext;
  derived: WorkDerivedState;
} & WorkRowValidity;

export type WorkItemsPage = {
  /** In the authority's order (`due_at ASC NULLS LAST, work_id ASC`) — never re-sort. */
  items: WorkItem[];
  scope: WorkScope;
  stateScope: WorkStateScope;
  /** The page size the authority actually applied. */
  pageSize: number;
  /** `null` exactly when there is no further page. */
  nextCursor: WorkItemsCursor | null;
};

// ---------------------------------------------------------------------------
// Input, port, error
// ---------------------------------------------------------------------------

/**
 * Everything a caller may say. There is no actor field and there never will
 * be one (25 §10.1): the actor is the authenticated session, server-side.
 */
export type GetWorkItemsInput = {
  scope: WorkScope;
  /** Defaults to `open` (25 §17.1). */
  stateScope?: WorkStateScope;
  /** Positive integer. The authority applies its own upper bound and reports the applied size. */
  pageSize?: number;
  /** A `nextCursor` from a previous page of the SAME scope and state scope. */
  cursor?: WorkItemsCursor | null;
};

/** The fully resolved request a reader receives. */
export type WorkItemsRequest = {
  scope: WorkScope;
  stateScope: WorkStateScope;
  pageSize: number | null;
  cursor: WorkItemsCursor | null;
};

/**
 * The port. Implemented by the data providers (Supabase: the W-A RPC
 * adapter; FakeRest: an explicit `unavailable` refusal). A reader either
 * resolves with a page or rejects with a WorkQueryError.
 *
 * Consumers (UI, a future MCP binding) call `getWorkItems`, never a reader
 * directly: only `getWorkItems` validates untyped input and refuses fields
 * outside the contract.
 */
export type WorkItemsReader = {
  getWorkItems(request: WorkItemsRequest): Promise<WorkItemsPage>;
};

/**
 * Closed failure vocabulary of the Work read. Branch on `reason` (and on
 * `code` where present) — never on `message`.
 *
 * - `invalid_request`     the input was refused before anything was asked
 * - `permission_denied`   the session cannot read Work (no resolvable
 *                         employee, dead or missing session, RLS)
 * - `unavailable`         the active data provider has no authoritative Work
 *                         query (demo/FakeRest) — not an empty result
 * - `malformed_response`  the authority answered outside the contracted shape
 * - `failed`              any other transport/server failure; `normalized`
 *                         keeps the transport class (network, service, …)
 */
export type WorkQueryFailureReason =
  | "invalid_request"
  | "permission_denied"
  | "unavailable"
  | "malformed_response"
  | "failed";

export class WorkQueryError extends Error {
  readonly reason: WorkQueryFailureReason;
  /**
   * The canonical Nora code the authority itself sent (its `DETAIL`), or
   * `null`. Never inferred from status or message text — a generic access
   * refusal without `DETAIL` is `permission_denied` with `code = null`.
   */
  readonly code: NoraErrorCode | null;
  /**
   * The existing transport classification (kind, messageKey, status,
   * technical message) for transport-originated failures; `null` when the
   * failure did not come from the transport.
   */
  readonly normalized: NormalizedCrmError | null;

  constructor(
    reason: WorkQueryFailureReason,
    detail: string,
    options: {
      code?: NoraErrorCode | null;
      normalized?: NormalizedCrmError | null;
      cause?: unknown;
    } = {},
  ) {
    super(
      `work_query.${reason}: ${detail}`,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "WorkQueryError";
    this.reason = reason;
    this.code = options.code ?? null;
    this.normalized = options.normalized ?? null;
  }
}

export const isWorkQueryError = (error: unknown): error is WorkQueryError =>
  error instanceof WorkQueryError;

// ---------------------------------------------------------------------------
// The use case
// ---------------------------------------------------------------------------

const INPUT_KEYS = new Set(["scope", "stateScope", "pageSize", "cursor"]);

const includes = <T extends string>(
  vocabulary: readonly T[],
  value: unknown,
): value is T => typeof value === "string" && vocabulary.includes(value as T);

const invalid = (detail: string): WorkQueryError =>
  new WorkQueryError("invalid_request", detail);

/**
 * Validates the input at runtime as well — a future MCP/automation caller
 * hands in parsed JSON, not a type-checked literal.
 */
export const resolveWorkItemsRequest = (input: unknown): WorkItemsRequest => {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw invalid("input must be an object");
  }
  const record = input as Record<string, unknown>;

  const unexpected = Object.keys(record).filter((key) => !INPUT_KEYS.has(key));
  if (unexpected.length > 0) {
    // Refuse rather than ignore: an ignored `salesId` would let a caller
    // believe it read another employee's Work.
    throw invalid(
      `unsupported input field(s): ${unexpected.sort().join(", ")}`,
    );
  }

  if (!includes(WORK_SCOPES, record.scope)) {
    throw invalid("scope must be one of: mine, team");
  }

  const stateScope = record.stateScope ?? DEFAULT_WORK_STATE_SCOPE;
  if (!includes(WORK_STATE_SCOPES, stateScope)) {
    throw invalid("stateScope must be one of: open, done, all");
  }

  const pageSize = record.pageSize ?? null;
  if (
    pageSize !== null &&
    !(
      typeof pageSize === "number" &&
      Number.isSafeInteger(pageSize) &&
      pageSize >= 1
    )
  ) {
    throw invalid("pageSize must be a positive integer");
  }

  const cursor = record.cursor ?? null;
  if (cursor !== null && (typeof cursor !== "string" || cursor === "")) {
    throw invalid("cursor must be a cursor returned by a previous page");
  }

  return {
    scope: record.scope,
    stateScope,
    pageSize,
    cursor: cursor as WorkItemsCursor | null,
  };
};

/**
 * Reads one page of Work for the authenticated employee.
 *
 * Resolves with exactly what the authority answered, or rejects with a
 * WorkQueryError — never with a substitute, never with a silent `[]`.
 */
export const getWorkItems = async (
  reader: WorkItemsReader,
  input: GetWorkItemsInput,
): Promise<WorkItemsPage> => {
  const request = resolveWorkItemsRequest(input);

  let page: WorkItemsPage;
  try {
    page = await reader.getWorkItems(request);
  } catch (error) {
    if (isWorkQueryError(error)) throw error;
    // A reader must speak WorkQueryError; anything else is a reader defect
    // and still a failure, never a result.
    throw new WorkQueryError("failed", "the Work reader failed", {
      cause: error,
    });
  }

  // The authority must have answered the question that was asked. A page for
  // another scope or state scope is not a smaller answer, it is a wrong one.
  if (
    page?.scope !== request.scope ||
    page?.stateScope !== request.stateScope
  ) {
    throw new WorkQueryError(
      "malformed_response",
      "the answer does not match the requested scope or state scope",
    );
  }

  return page;
};
