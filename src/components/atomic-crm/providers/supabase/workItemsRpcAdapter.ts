/**
 * Infrastructure adapter: the W-A Work query `public.get_work_items(...)`
 * (Alpha Work 2, 2026-09-29).
 *
 * The ONLY place that knows the RPC name, its `p_*` arguments, its jsonb
 * envelope and its keyset cursor. It maps the transport answer onto the
 * Application DTO (application/queries/getWorkItems.ts) and transport
 * failures onto WorkQueryError. It holds no Work rule of its own:
 *
 * - no second query: one RPC call, never a raw `tasks` read, never a
 *   fallback of any kind;
 * - no classification: `validity`, `actionable`, `overdue`, `due_today`,
 *   `is_mine`, `is_unassigned`, holder and context are copied, never
 *   evaluated — the business day is the server's (Europe/Berlin), not the
 *   browser's;
 * - no re-ordering: items keep the server's total order;
 * - no deal/case context and no heuristic that could produce one.
 *
 * Tolerance rule (DB-first releases, docs/nora/07): a field the contract
 * does not know is ignored and never propagated, so a newer database never
 * breaks this runtime by ADDING something. A missing field, a wrong type or
 * a value outside a closed vocabulary is a malformed answer and fails the
 * whole page closed — an item is never dropped or repaired to save a page.
 *
 * The generated Supabase types do not exist in this repository (the client
 * is untyped); the transport shape below is therefore validated at runtime,
 * by hand, in the style of the other fail-closed read-model mappers.
 */
import {
  NORA_ERROR_CODES,
  extractNoraErrorCode,
} from "../../domain/noraErrorCodes";
import { normalizeCrmError } from "../../misc/normalizeCrmError";
import {
  WORK_CARRIERS,
  WORK_DUE_PRECISIONS,
  WORK_INVALID_REASONS,
  WORK_SCOPES,
  WORK_STATES,
  WORK_STATE_SCOPES,
  WORK_VALIDITIES,
  WorkQueryError,
  type WorkHolder,
  type WorkItem,
  type WorkItemsCursor,
  type WorkItemsPage,
  type WorkItemsRequest,
  type WorkRowValidity,
  type WorkScope,
  type WorkStateScope,
} from "../../application/queries/getWorkItems";

export const GET_WORK_ITEMS_RPC = "get_work_items";

/** Named arguments of `public.get_work_items(text, text, integer, timestamptz, uuid)`. */
export type GetWorkItemsRpcArgs = {
  p_scope: WorkScope;
  p_state_scope: WorkStateScope;
  p_limit: number | null;
  p_cursor_due_at: string | null;
  p_cursor_work_id: string | null;
};

/** The narrow slice of the Supabase RPC call this adapter needs. */
/** `p_limit` is a Postgres `integer`; larger values are a transport error, not a page size. */
const PG_INTEGER_MAX = 2_147_483_647;

export type GetWorkItemsRpc = (
  fn: typeof GET_WORK_ITEMS_RPC,
  args: GetWorkItemsRpcArgs,
) => PromiseLike<{ data: unknown; error: unknown; status?: number }>;

// ---------------------------------------------------------------------------
// Cursor — the keyset position (due_at, work_id), opaque to everyone else
// ---------------------------------------------------------------------------

const CURSOR_PREFIX = "wc1.";

type CursorPayload = {
  /** scope the position belongs to */
  s: WorkScope;
  /** state scope the position belongs to */
  t: WorkStateScope;
  /** due_at of the last emitted row, verbatim; null inside the NULLS LAST tail */
  d: string | null;
  /** work_id of the last emitted row */
  w: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toBase64Url = (text: string): string =>
  btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const fromBase64Url = (text: string): string => {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  return atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
};

/**
 * `due_at` travels as the server's own string — never through a JS `Date`.
 * A `Date` keeps milliseconds only; `timestamptz` keeps microseconds, and a
 * truncated cursor would re-deliver the row it points at.
 */
export const encodeWorkItemsCursor = (
  payload: CursorPayload,
): WorkItemsCursor =>
  `${CURSOR_PREFIX}${toBase64Url(JSON.stringify(payload))}` as WorkItemsCursor;

const cursorRejected = (): WorkQueryError =>
  new WorkQueryError(
    "invalid_request",
    "cursor is not a Work cursor issued by this reader",
  );

export const decodeWorkItemsCursor = (
  cursor: WorkItemsCursor,
  request: Pick<WorkItemsRequest, "scope" | "stateScope">,
): { dueAt: string | null; workId: string } => {
  if (typeof cursor !== "string" || !cursor.startsWith(CURSOR_PREFIX)) {
    throw cursorRejected();
  }
  let payload: unknown;
  try {
    payload = JSON.parse(fromBase64Url(cursor.slice(CURSOR_PREFIX.length)));
  } catch {
    throw cursorRejected();
  }
  if (!isRecord(payload)) throw cursorRejected();
  const { s, t, d, w } = payload;
  if (
    typeof w !== "string" ||
    !UUID_PATTERN.test(w) ||
    !(d === null || isServerTimestamp(d))
  ) {
    throw cursorRejected();
  }
  // A position is only meaningful inside the row set it was taken from.
  if (s !== request.scope || t !== request.stateScope) {
    throw new WorkQueryError(
      "invalid_request",
      "cursor belongs to a different scope or state scope",
    );
  }
  return { dueAt: d, workId: w };
};

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

export const readWorkItemsViaRpc = async (
  request: WorkItemsRequest,
  rpc: GetWorkItemsRpc,
): Promise<WorkItemsPage> => {
  const position =
    request.cursor === null
      ? null
      : decodeWorkItemsCursor(request.cursor, request);
  if (request.pageSize !== null && request.pageSize > PG_INTEGER_MAX) {
    throw new WorkQueryError(
      "invalid_request",
      "pageSize exceeds what the Work query accepts",
    );
  }

  let result: Awaited<ReturnType<GetWorkItemsRpc>>;
  try {
    result = await rpc(GET_WORK_ITEMS_RPC, {
      p_scope: request.scope,
      p_state_scope: request.stateScope,
      p_limit: request.pageSize,
      p_cursor_due_at: position?.dueAt ?? null,
      p_cursor_work_id: position?.workId ?? null,
    });
  } catch (error) {
    throw fromTransportError(error, undefined);
  }

  if (!isRecord(result)) {
    throw malformed("the transport returned no response object");
  }
  if (result.error != null) {
    throw fromTransportError(result.error, result.status);
  }
  return mapEnvelope(result.data);
};

/**
 * One mapping point for transport failures: the existing normalizeCrmError
 * decides the transport class (docs/nora/03 §6). The HTTP status travels
 * along so an expired/absent session (401) is recognized as such; the
 * original error is kept as `cause` for diagnostics.
 *
 * `code` is only what the authority itself sent as `DETAIL` — never the
 * generic permission normalization — so a consumer can tell the W-A actor
 * refusal (`NORA_PERMISSION_DENIED`) from any other access refusal.
 * `permission_denied` means exactly: that code, or an access refusal the
 * transport reports (401/403, RLS). A free-text "disabled" match is not one.
 */
const fromTransportError = (
  error: unknown,
  status: number | undefined,
): WorkQueryError => {
  const diagnostic = isRecord(error)
    ? { ...error, ...(typeof status === "number" ? { status } : {}) }
    : error;
  const normalized = normalizeCrmError(diagnostic);
  const code = extractNoraErrorCode(error);
  const denied =
    code === NORA_ERROR_CODES.PERMISSION_DENIED ||
    normalized.kind === "permission_denied";
  return new WorkQueryError(
    denied ? "permission_denied" : "failed",
    denied
      ? "the session may not read Work"
      : `the Work query did not answer (${normalized.kind})`,
    { code, normalized, cause: error },
  );
};

// ---------------------------------------------------------------------------
// Transport → DTO
// ---------------------------------------------------------------------------

class MalformedWorkAnswer extends Error {}

const malformed = (detail: string, cause?: unknown): WorkQueryError =>
  new WorkQueryError("malformed_response", detail, { cause });

// A declaration (not a const arrow) so control flow treats it as `never`.
function fail(path: string, expectation: string): never {
  throw new MalformedWorkAnswer(`${path} ${expectation}`);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * A server timestamp is taken as the authority rendered it and never
 * interpreted: Postgres legitimately renders `infinity`, five-digit years,
 * `BC` dates and second-precision offsets, none of which a JS `Date`
 * parses. Refusing them here would fail a valid page — and, because such a
 * row sorts before the NULLS LAST tail, every page after it.
 */
const isServerTimestamp = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

/** A field must be PRESENT — an explicit `null` is an answer, a missing key is not. */
const field = (
  record: Record<string, unknown>,
  key: string,
  path: string,
): unknown => {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    fail(`${path}.${key}`, "is missing");
  }
  return record[key];
};

const record = (value: unknown, path: string): Record<string, unknown> =>
  isRecord(value) ? value : fail(path, "is not an object");

const bool = (value: unknown, path: string): boolean =>
  typeof value === "boolean" ? value : fail(path, "is not a boolean");

const text = (value: unknown, path: string): string =>
  typeof value === "string" ? value : fail(path, "is not a string");

const nullableText = (value: unknown, path: string): string | null =>
  value === null ? null : text(value, path);

const id = (value: unknown, path: string): number =>
  typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : fail(path, "is not a safe integer id");

const nullableId = (value: unknown, path: string): number | null =>
  value === null ? null : id(value, path);

const oneOf = <T extends string>(
  vocabulary: readonly T[],
  value: unknown,
  path: string,
): T =>
  typeof value === "string" && vocabulary.includes(value as T)
    ? (value as T)
    : fail(path, `is not one of: ${vocabulary.join(", ")}`);

const mapHolder = (value: unknown, path: string): WorkHolder | null => {
  if (value === null) return null;
  const holder = record(value, path);
  return {
    salesId: id(field(holder, "sales_id", path), `${path}.sales_id`),
    displayName: nullableText(
      field(holder, "display_name", path),
      `${path}.display_name`,
    ),
  };
};

const mapWorkItem = (value: unknown, path: string): WorkItem => {
  const row = record(value, path);
  const at = (key: string) => field(row, key, path);

  const workId = text(at("work_id"), `${path}.work_id`);
  if (!UUID_PATTERN.test(workId)) fail(`${path}.work_id`, "is not a UUID");

  const carrier = oneOf(WORK_CARRIERS, at("carrier"), `${path}.carrier`);

  const dueAt = at("due_at");
  if (!(dueAt === null || isServerTimestamp(dueAt))) {
    fail(`${path}.due_at`, "is neither null nor a timestamp string");
  }

  const context = record(at("context"), `${path}.context`);
  const validity = oneOf(WORK_VALIDITIES, at("validity"), `${path}.validity`);
  const title = nullableText(at("title"), `${path}.title`);
  const invalidReason = at("invalid_reason");

  // Row validity is one tagged fact (25 §5.2 / §21.3: title is null exactly
  // when the row is incomplete, and only then is there a reason). The shape
  // is checked; the classification itself is the server's and is not redone.
  let rowValidity: WorkRowValidity;
  if (validity === "valid") {
    if (title === null || invalidReason !== null) {
      fail(path, "is valid but carries no title or an invalid_reason");
    }
    rowValidity = { validity, title, invalidReason: null };
  } else {
    if (title !== null) fail(path, "is incomplete but carries a title");
    rowValidity = {
      validity,
      title: null,
      invalidReason: oneOf(
        WORK_INVALID_REASONS,
        invalidReason,
        `${path}.invalid_reason`,
      ),
    };
  }

  return {
    workId,
    carrier,
    ...rowValidity,
    workType: nullableText(at("work_type"), `${path}.work_type`),
    state: oneOf(WORK_STATES, at("state"), `${path}.state`),
    holder: mapHolder(at("holder"), `${path}.holder`),
    dueAt: dueAt as string | null,
    duePrecision: oneOf(
      WORK_DUE_PRECISIONS,
      at("due_precision"),
      `${path}.due_precision`,
    ),
    context: {
      customerId: nullableId(
        field(context, "customer", `${path}.context`),
        `${path}.context.customer`,
      ),
      contactId: nullableId(
        field(context, "contact", `${path}.context`),
        `${path}.context.contact`,
      ),
    },
    derived: {
      actionable: bool(at("actionable"), `${path}.actionable`),
      overdue: bool(at("overdue"), `${path}.overdue`),
      dueToday: bool(at("due_today"), `${path}.due_today`),
      isMine: bool(at("is_mine"), `${path}.is_mine`),
      isUnassigned: bool(at("is_unassigned"), `${path}.is_unassigned`),
    },
  };
};

const mapEnvelope = (value: unknown): WorkItemsPage => {
  try {
    const envelope = record(value, "envelope");
    const at = (key: string) => field(envelope, key, "envelope");

    const rows = at("data");
    if (!Array.isArray(rows)) fail("envelope.data", "is not an array");
    const items = (rows as unknown[]).map((row, index) =>
      mapWorkItem(row, `envelope.data[${index}]`),
    );

    const pageSize = at("limit");
    if (
      !(
        typeof pageSize === "number" &&
        Number.isSafeInteger(pageSize) &&
        pageSize >= 1
      )
    ) {
      fail("envelope.limit", "is not a positive integer");
    }
    if (items.length > (pageSize as number)) {
      fail("envelope.data", "holds more items than the applied limit");
    }

    const scope = oneOf(WORK_SCOPES, at("scope"), "envelope.scope");
    const stateScope = oneOf(
      WORK_STATE_SCOPES,
      at("state_scope"),
      "envelope.state_scope",
    );

    const rawCursor = at("next_cursor");
    let nextCursor: WorkItemsCursor | null = null;
    if (rawCursor !== null) {
      const cursor = record(rawCursor, "envelope.next_cursor");
      const dueAt = field(cursor, "due_at", "envelope.next_cursor");
      const workId = field(cursor, "work_id", "envelope.next_cursor");
      const last = items[items.length - 1];
      // The keyset position is the last emitted row (25 §21.4). Anything
      // else — a cursor onto an empty page, or components that disagree with
      // that row — would skip or repeat Work, so it is refused.
      if (last === undefined) {
        fail("envelope.next_cursor", "is set on an empty page");
      }
      if (workId !== last.workId || dueAt !== last.dueAt) {
        fail("envelope.next_cursor", "does not point at the last item");
      }
      nextCursor = encodeWorkItemsCursor({
        s: scope,
        t: stateScope,
        d: last.dueAt,
        w: last.workId,
      });
    }

    return {
      items,
      scope,
      stateScope,
      pageSize: pageSize as number,
      nextCursor,
    };
  } catch (error) {
    if (error instanceof MalformedWorkAnswer) {
      throw malformed(error.message);
    }
    throw malformed("the answer could not be read", error);
  }
};
