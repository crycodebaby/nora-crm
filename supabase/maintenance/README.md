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
  inside `BEGIN TRANSACTION READ ONLY`. A file that creates even a session-local
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
