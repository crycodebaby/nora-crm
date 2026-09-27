// @vitest-environment node
import { describe, it, expect } from "vitest";
import { validateReadOnly, validateWrite } from "./validateSql";

describe("validateReadOnly", () => {
  it.each([
    ["simple SELECT", "SELECT * FROM contacts"],
    [
      "SELECT with WHERE",
      "SELECT id, name FROM contacts WHERE created_at > NOW() - INTERVAL '30 days'",
    ],
    [
      "SELECT with JOIN",
      "SELECT c.name, co.name FROM contacts c JOIN companies co ON c.company_id = co.id",
    ],
    [
      "SELECT with subquery",
      "SELECT * FROM contacts WHERE company_id IN (SELECT id FROM companies WHERE sector = 'Tech')",
    ],
    [
      "read-only CTE",
      "WITH recent AS (SELECT * FROM contacts WHERE created_at > NOW() - INTERVAL '7 days') SELECT * FROM recent",
    ],
    [
      "aggregate query",
      "SELECT COUNT(*) as total, type FROM tasks GROUP BY type",
    ],
    [
      "DELETE in string literal",
      "SELECT * FROM contacts WHERE status = 'DELETE'",
    ],
    [
      "DROP in string literal",
      "SELECT * FROM logs WHERE message = 'DROP TABLE failed'",
    ],
    [
      "UPDATE in string literal",
      "SELECT * FROM contacts WHERE note = 'Please UPDATE your info'",
    ],
    [
      "DROP in block comment",
      "SELECT /* DROP TABLE contacts */ * FROM contacts",
    ],
    ["DROP in line comment", "SELECT * FROM contacts -- DROP TABLE contacts"],
  ])("allows %s", (_label, sql) => {
    expect(validateReadOnly(sql)).toBeNull();
  });

  it.each([
    ["INSERT", "INSERT INTO contacts (name) VALUES ('test')"],
    ["UPDATE", "UPDATE contacts SET name = 'test'"],
    ["DELETE", "DELETE FROM contacts WHERE id = 1"],
    [
      "writable CTE (DELETE)",
      "WITH d AS (DELETE FROM contacts RETURNING *) SELECT * FROM d",
    ],
    [
      "writable CTE (UPDATE)",
      "WITH u AS (UPDATE contacts SET name = 'x' RETURNING *) SELECT * FROM u",
    ],
    [
      "writable CTE (INSERT)",
      "WITH i AS (INSERT INTO contacts (name) VALUES ('x') RETURNING *) SELECT * FROM i",
    ],
    ["DROP TABLE", "DROP TABLE contacts"],
    ["CREATE TABLE", "CREATE TABLE evil (id int)"],
    ["ALTER TABLE", "ALTER TABLE contacts ADD COLUMN x int"],
    ["TRUNCATE", "TRUNCATE contacts"],
    ["SET", "SET LOCAL role = 'postgres'"],
    ["DO block", "DO $$ BEGIN END $$"],
    ["multi-statement (SELECT; DROP)", "SELECT 1; DROP TABLE contacts"],
    ["multi-statement (SELECT; SET)", "SELECT 1; SET LOCAL role = 'postgres'"],
    ["multi-statement (two SELECTs)", "SELECT 1; SELECT 2"],
    ["unparseable SQL", "NOT VALID SQL %%%"],
  ])("rejects %s", (_label, sql) => {
    expect(validateReadOnly(sql)).not.toBeNull();
  });
});

describe("validateWrite", () => {
  it.each([
    [
      "INSERT",
      "INSERT INTO contacts (first_name, last_name) VALUES ('John', 'Doe')",
    ],
    ["UPDATE", "UPDATE contacts SET name = 'test' WHERE id = 1"],
    ["DELETE", "DELETE FROM contacts WHERE id = 1"],
    [
      "INSERT with RETURNING",
      "INSERT INTO contacts (name) VALUES ('test') RETURNING id",
    ],
    [
      "UPDATE with subquery",
      "UPDATE contacts SET company_id = (SELECT id FROM companies WHERE name = 'Acme') WHERE id = 1",
    ],
    [
      "writable CTE with INSERT",
      "WITH d AS (DELETE FROM old_contacts RETURNING *) INSERT INTO archive SELECT * FROM d",
    ],
  ])("allows %s", (_label, sql) => {
    expect(validateWrite(sql)).toBeNull();
  });

  it.each([
    ["standalone SELECT", "SELECT * FROM contacts"],
    ["DROP TABLE", "DROP TABLE contacts"],
    ["CREATE TABLE", "CREATE TABLE evil (id int)"],
    ["TRUNCATE", "TRUNCATE contacts"],
    ["SET", "SET LOCAL role = 'postgres'"],
    [
      "multi-statement (DELETE; DROP)",
      "DELETE FROM contacts; DROP TABLE contacts",
    ],
    [
      "multi-statement (DELETE; SET)",
      "DELETE FROM contacts; SET LOCAL role = 'postgres'",
    ],
    ["unparseable SQL", "NOT VALID SQL %%%"],
  ])("rejects %s", (_label, sql) => {
    expect(validateWrite(sql)).not.toBeNull();
  });
});

/**
 * Security closure 2026-09-27 — identity integrity.
 *
 * The MCP tools run user SQL on a pooled connection whose request identity is
 * carried in GUCs (`request.jwt.claim.sub` and friends). A statement that may
 * call `set_config` can hand itself another employee's identity, and — with
 * `is_local = false` — leave that identity behind for the next caller on the
 * same pooled connection. Every form below was executed against the live local
 * MCP function before the fix and every one of them succeeded.
 */
describe("identity integrity", () => {
  const ADMIN = "00000000-1111-2222-3333-444444444444";

  it.each([
    [
      "bare set_config",
      `SELECT set_config('request.jwt.claim.sub','${ADMIN}',true)`,
    ],
    [
      "schema-qualified",
      `SELECT pg_catalog.set_config('request.jwt.claim.sub','${ADMIN}',true)`,
    ],
    [
      "uppercase + comments",
      `SELECT /*x*/ PG_CATALOG.SET_CONFIG /*x*/ ('request.jwt.claim.sub','${ADMIN}',true)`,
    ],
    [
      "inside a CTE binding",
      `WITH p AS (SELECT set_config('request.jwt.claim.sub','${ADMIN}',true) AS v) SELECT * FROM p`,
    ],
    [
      "nested sub-select",
      `SELECT (SELECT set_config('request.jwt.claim.sub','${ADMIN}',true)) AS p`,
    ],
    [
      "from-clause function",
      `SELECT * FROM set_config('request.jwt.claim.sub','${ADMIN}',true) AS t(v)`,
    ],
    [
      "hidden in a WHERE clause",
      `SELECT 1 WHERE set_config('role','postgres',true) IS NOT NULL`,
    ],
    [
      "aliased column",
      `SELECT set_config('role','postgres',true) AS harmless_looking_name`,
    ],
    ["role escalation", "SELECT set_config('role','postgres',true)"],
    [
      "session-scoped (poisons the next caller)",
      `SELECT set_config('request.jwt.claim.sub','${ADMIN}',false)`,
    ],
    [
      "session_id forgery (W6-A session binding)",
      "SELECT set_config('request.jwt.claim.session_id','00000000-0000-0000-0000-000000000000',true)",
    ],
    [
      "claims JSON wholesale",
      `SELECT set_config('request.jwt.claims','{"sub":"${ADMIN}","role":"authenticated"}',true)`,
    ],
  ])("query tool rejects %s", (_label, sql) => {
    expect(validateReadOnly(sql)).toMatch(/set_config is not allowed/);
  });

  it.each([
    [
      "bare set_config",
      `SELECT set_config('request.jwt.claim.sub','${ADMIN}',true)`,
    ],
    [
      "smuggled into a write",
      `UPDATE tasks SET text = set_config('role','postgres',true) WHERE id = 1`,
    ],
    [
      "smuggled into an insert",
      `INSERT INTO tags (name, color) VALUES (set_config('role','postgres',true), '#fff')`,
    ],
    [
      "inside a writable CTE",
      `WITH p AS (SELECT set_config('role','postgres',true) AS v) UPDATE tasks SET text = (SELECT v FROM p) WHERE id = 1`,
    ],
  ])("mutate tool rejects %s", (_label, sql) => {
    expect(validateWrite(sql)).toMatch(/set_config is not allowed/);
  });

  it("does not reject reading configuration, only changing it", () => {
    expect(
      validateReadOnly("SELECT current_setting('request.jwt.claim.sub', true)"),
    ).toBeNull();
  });

  it("does not reject a column or table that merely resembles the name", () => {
    expect(validateReadOnly("SELECT set_config FROM audit_events")).toBeNull();
    expect(
      validateReadOnly("SELECT * FROM contacts WHERE note = 'set_config(x)'"),
    ).toBeNull();
  });
});

/**
 * A `WITH` statement runs its body, not only its bindings. Collecting the
 * outer type and the bindings but not the body reported `{with, select}` for
 * the statement below and let it through the READ-ONLY query tool — which,
 * against the live local stack before the fix, inserted a row and committed it.
 */
describe("WITH body is a statement position", () => {
  it.each([
    [
      "INSERT in the body",
      "WITH c AS (SELECT 1) INSERT INTO tags (name, color) VALUES ('x','#fff')",
    ],
    [
      "UPDATE in the body",
      "WITH c AS (SELECT 1) UPDATE tasks SET text = 'x' WHERE id = 1",
    ],
    [
      "DELETE in the body",
      "WITH c AS (SELECT 1) DELETE FROM tasks WHERE id = 1",
    ],
  ])("query tool rejects %s", (_label, sql) => {
    expect(validateReadOnly(sql)).not.toBeNull();
  });

  it("still allows a read-only WITH", () => {
    expect(
      validateReadOnly("WITH t AS (SELECT id FROM tasks) SELECT * FROM t"),
    ).toBeNull();
  });
});
