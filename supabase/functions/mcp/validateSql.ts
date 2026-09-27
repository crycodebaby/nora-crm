import { parse, type Statement } from "npm:pgsql-ast-parser@^12";

const ALLOWED_READ_TYPES = new Set(["select", "with"]);
const ALLOWED_WRITE_TYPES = new Set(["insert", "update", "delete", "with"]);

/**
 * Functions user SQL may never call, whatever schema it qualifies them with.
 *
 * `set_config` is the only SQL-reachable way to change a GUC, and the GUCs that
 * carry request identity are exactly the ones Nora's RLS reads:
 * `request.jwt.claim.sub` (nora_private.safe_auth_uid), `request.jwt.claim.role`
 * (safe_auth_role), `request.jwt.claim.session_id` (jwt_session_claim, W6-A),
 * `request.jwt.claim.iss`, `request.jwt.claims` and `role` itself. The database
 * security model is written on the assumption — stated verbatim in migration
 * 20260906210000 — that "nothing a client sends can set request.jwt.* other
 * than through its verified JWT". An MCP caller that may call `set_config`
 * breaks that assumption and can hand itself another employee's identity, so
 * the call is refused before the statement ever reaches Postgres.
 *
 * This is one of three independent layers, deliberately not the only one:
 *   1. this AST check (refuses the statement),
 *   2. the identity pin + post-execution re-read in index.ts (refuses the
 *      RESULT if any pinned GUC moved, whatever the parser thought),
 *   3. `DISCARD ALL` before the pooled connection is reused (no residue).
 * Layer 2 is what makes a parser gap non-exploitable rather than merely
 * unlikely.
 */
const FORBIDDEN_FUNCTIONS = new Set(["set_config"]);

/**
 * Reads a function name off any AST node that carries one.
 *
 * Deliberately shape-agnostic: `pgsql-ast-parser` represents an expression call
 * (`SELECT set_config(...)`), a from-clause function (`FROM set_config(...) t`)
 * and a qualified call (`pg_catalog.set_config(...)`) with different node types
 * but all of them hang the callee off a `function` property. Matching on that
 * property instead of on a node type means a form we did not enumerate is still
 * caught.
 */
function functionNameOf(node: Record<string, unknown>): string | null {
  const fn = node.function;
  if (typeof fn === "string") return fn;
  if (fn && typeof fn === "object") {
    const name = (fn as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return null;
}

/**
 * Walks the whole parsed tree and returns the forbidden function names it
 * calls, in any position: plain call, schema-qualified call, inside a CTE, a
 * sub-select, a WHERE clause, a from-clause function or a cast argument.
 */
function findForbiddenCalls(root: unknown): string[] {
  const hits = new Set<string>();
  const seen = new Set<object>();
  const stack: unknown[] = [root];

  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== "object") continue;
    if (seen.has(node as object)) continue;
    seen.add(node as object);

    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }

    const record = node as Record<string, unknown>;
    const name = functionNameOf(record);
    if (name && FORBIDDEN_FUNCTIONS.has(name.toLowerCase())) {
      hits.add(name.toLowerCase());
    }

    for (const value of Object.values(record)) stack.push(value);
  }

  return [...hits];
}

/**
 * Collects statement types, following every statement position a `WITH` opens:
 * each CTE binding AND the body the WITH applies to, recursively.
 *
 * Visiting the body matters. `WITH c AS (SELECT 1) INSERT INTO tasks ...` is a
 * single statement whose top-level type is `with`; its DML sits in the body,
 * not in a binding. Collecting only the outer type and the bindings would have
 * reported `{with, select}` and let that write through the read-only `query`
 * tool.
 */
function collectStatementTypes(stmts: Statement[]): Set<string> {
  const types = new Set<string>();
  const seen = new Set<object>();

  const visit = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    if (seen.has(node as object)) return;
    seen.add(node as object);

    const record = node as Record<string, unknown>;
    if (typeof record.type === "string") types.add(record.type);

    if (record.type === "with") {
      if (Array.isArray(record.bind)) {
        for (const cte of record.bind) {
          visit((cte as { statement?: unknown } | null)?.statement);
        }
      }
      // The statement the WITH actually runs.
      visit(record.in);
    }
  };

  for (const stmt of stmts) visit(stmt);
  return types;
}

function parseSingle(sql: string): { stmts: Statement[] } | { error: string } {
  let stmts: Statement[];
  try {
    stmts = parse(sql);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    // pgsql-ast-parser appends a parse-table dump that is useless to the
    // LLM and consumes many tokens; keep the diagnostic prefix only.
    const message = raw.split("Here is the state of my parse table")[0].trim();
    return { error: `Failed to parse SQL: ${message}` };
  }
  if (stmts.length === 0) {
    return { error: "Empty query." };
  }
  if (stmts.length > 1) {
    return { error: "Only a single statement is allowed." };
  }
  return { stmts };
}

/**
 * Refuses any statement that would let the caller choose its own identity.
 *
 * Shared by the read and the write path: impersonation is not more acceptable
 * in a mutation than in a query.
 */
function validateIdentityIntegrity(stmts: Statement[]): string | null {
  const forbidden = findForbiddenCalls(stmts);
  if (forbidden.length > 0) {
    return `Calling ${forbidden.join(", ")} is not allowed: request identity is taken from the verified JWT and cannot be changed by a query.`;
  }
  return null;
}

export function validateReadOnly(sql: string): string | null {
  const parsed = parseSingle(sql);
  if ("error" in parsed) return parsed.error;

  const identityError = validateIdentityIntegrity(parsed.stmts);
  if (identityError) return identityError;

  const types = collectStatementTypes(parsed.stmts);
  for (const type of types) {
    if (!ALLOWED_READ_TYPES.has(type)) {
      return `Statement type "${type}" is not allowed in read-only queries. Use the mutate tool for data modifications.`;
    }
  }
  return null;
}

export function validateWrite(sql: string): string | null {
  const parsed = parseSingle(sql);
  if ("error" in parsed) return parsed.error;

  const identityError = validateIdentityIntegrity(parsed.stmts);
  if (identityError) return identityError;

  const types = collectStatementTypes(parsed.stmts);
  for (const type of types) {
    if (!ALLOWED_WRITE_TYPES.has(type)) {
      return `Statement type "${type}" is not allowed. Only INSERT, UPDATE, and DELETE statements are supported.`;
    }
  }
  return null;
}
