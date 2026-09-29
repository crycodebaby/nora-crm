# `supabase/maintenance/` — operator scripts that may COMMIT

This directory is **not** `supabase/tests/`. The difference is the blast radius,
and it is the only reason the directory exists.

| | `supabase/tests/` | `supabase/maintenance/` |
|---|---|---|
| Purpose | prove a contract | perform one-off operational work |
| Data | disposable fixtures | **real rows** |
| Transaction | rollback-safe / scratch-only | **commits** |
| Target | a local stack | a local stack **or Production** |
| Runner | any engineer, any time | an operator, under an approved runbook step |

Rules for anything placed here:

- A file that mutates says so in its **name**, in its **first line**, and in a
  header block that states exactly what it writes and what it never touches.
- A file that only reads says that just as plainly, and must be safe to run
  against Production at any moment.
- **"Read-only" is not one property, and this directory never blurs the two.**
  *No durable or business-data mutation* is what makes a file safe against
  Production. *Strict SQL read-only* is the narrower claim that it also runs
  inside `BEGIN TRANSACTION READ ONLY` — or is one single plain `select` with
  no DML, DDL, temp object, user-defined function call or transaction control
  (which is how a file keeps its verdict as the LAST result in a runner that
  shows only the last one). A file that creates even a session-local
  `pg_temp` object satisfies the first and **not** the second, and must say so
  where an operator reads it.
- A file that mutates must return **its own** result in the **same invocation**.
  An operator may not be asked to reconstruct what happened from a later query,
  a later session, or a `NOTICE`.
- **Pure SQL only — no psql meta-commands** (`\set`, `\echo`, `\i`). These files
  must be executable verbatim through Supabase MCP `execute_sql` as well as
  through `psql -v ON_ERROR_STOP=1`.
- No hard-coded production identifiers: no project ref, no note id, no storage
  key, no secret.
- Never move a test in here to "run it for real", and never move one of these
  into `supabase/tests/` to make it look harmless.

## `attachment_backfill/` — W8-C S4

Projects the attachment arrays of **historical** notes into `public.attachments`
through the existing S3B reconcile core, one note per transaction. Read the
numbered files in order; each one carries its own contract.

| File | Writes? | Classification |
|---|---|---|
| `00_preflight.sql` | no | **STRICT READ-ONLY** — GO / STOP gate; runs inside `BEGIN TRANSACTION READ ONLY` |
| `10_backfill_one_note.sql` | **YES — commits one note per invocation** | business-data mutating |
| `20_report.sql` | no | **STRICT READ-ONLY** — progress counters; no session prerequisite |

The canonical consistency verifier lives at
`supabase/tests/attachment_backfill_consistency_verification.sql`. There is
exactly one implementation of "note JSON and `public.attachments` agree", and
`00_preflight.sql` **requires** it in the same session. Its classification is
deliberately **not** "read-only":

| Property | Verifier |
|---|---|
| durable or business-data mutation | **no** — this is what makes it Production-safe |
| creates a session-local `pg_temp` function | **yes** |
| requires `TEMP` privilege on the database | **yes** |
| strict SQL read-only | **no** — `CREATE FUNCTION` is DDL |
| runs inside `BEGIN TRANSACTION READ ONLY` | **no** — PostgreSQL refuses it there |
| survives disconnect | **no** |
| returns one row per class, all sixteen, every time | **yes — and `00_preflight.sql` asserts it** |

The `pg_temp` function is not a convenience. `note_attachment_reference_rows`
raises on an array outside grammar v1, so classifying such a note instead of
aborting the whole query needs per-note `exception` isolation that pure SQL
cannot express — the only pure-SQL alternative would be a second grammar
parser. Keep the mechanism; state it accurately.

### Operator sequence

1. **Preflight** — send the verifier and `00_preflight.sql` as **one payload,
   verifier first**. A session that never ran the verifier fails closed with a
   `55000` naming the missing helper; it never produces a false GO. Neither
   does a session whose classifier answered but answered short: the preflight
   asserts the full sixteen-class census before it counts anything, and a
   census that is not the contract raises `55000`
   `NORA_S4_CLASSIFICATION_CENSUS_INVALID` rather than reading "nothing was
   classified" as "nothing is wrong".
2. **Backfill** — send `10_backfill_one_note.sql` as one payload, once per note,
   and read the row **that call returns** (`outcome`, `note_table`, `note_id`,
   `row_count`). No second query, no second session, no `NOTICE` parsing.
   Repeat after a successful row; stop on any SQL error; stop at
   `NO_CANDIDATE`. `20_report.sql` may be run at any time for progress.
3. **Verification** — run the verifier again. **S5 stays blocked** until its
   verdict is `GREEN`.

## `attachment_privacy/` and `branding_migration/` — W8-E

The W8-E release tools. **The procedure, its order and its rollback live in
`docs/nora/21-agent-runbooks.md` Section 17** — never run these from this
table alone. The one rule behind the order: *old runtime + private
`attachments` bucket* is unsupported, so the bucket flip is an operator step,
not a migration.

**The flip to private is never SQL.** storage-api purges the bucket's CDN
cache only when it performs a public -> private change itself; a direct
`update storage.buckets set public = false` bypasses that and can leave
publicly fetched objects on the Smart CDN edge (Alpha Storage 3C F-2). The
only tool that changes the visibility of `attachments` is
`attachment_privacy/10_set_attachments_privacy.mjs`, through the Storage API.

| File | Writes? | Classification |
|---|---|---|
| `branding_migration/relocate_branding_objects.mjs` | only with `--apply` — copies branding objects into `branding`, rewrites the logo references | business-data mutating (Stage A); dry run by default; signs in as an active admin, **no** `service_role` |
| `attachment_privacy/00_preflight.sql` | no | **STRICT READ-ONLY** — ONE `select`, GO / STOP gate for Stage C; verdict is the last row in every runner |
| `attachment_privacy/10_set_attachments_privacy.mjs` | **YES**, only with `--apply` — `private` or `public` for `attachments`, through `PUT /storage/v1/bucket/attachments`, controls echoed verbatim | configuration mutating (Stage C and canonical rollback); **operator-only privileged key** from the environment; verifies its own result, compensates a failed flip, never leaves an ambiguous state; logic in `lib/privacy_control.mjs` (unit-tested in CI) |
| `attachment_privacy/20_set_attachments_public.sql` | **YES** — `storage.buckets.public = true` for `attachments` | configuration mutating — rollback **fallback** only when the Storage API path is unavailable; verifies its own result (in-block + independent postcondition, `set constraints all immediate`) |
| `attachment_privacy/30_verify_attachments_private.sql` | no | **STRICT READ-ONLY** — ONE `select`, VERIFIED / STOP after Stage C |

SQL runner: the whole file verbatim as ONE Supabase MCP `execute_sql` call,
the Dashboard SQL editor, or `psql -v ON_ERROR_STOP=1 -f <file>`. Never `psql`
without `ON_ERROR_STOP` — it carries on past an error and exits 0.

**The privileged Storage admin key** (`NORA_STORAGE_ADMIN_KEY`, a secret key or
the legacy `service_role` key) exists only in the operator's shell for the
duration of the command. Never in a file, a `.env*`, a `VITE_*` variable, a
bundle, an Edge Function, a database row, a log, a chat or a document — the
tool refuses a publishable key and a key it also finds in a `VITE_*`
variable, and never prints it.
