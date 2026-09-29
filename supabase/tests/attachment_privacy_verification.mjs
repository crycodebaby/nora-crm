#!/usr/bin/env node
/**
 * Nora W8-E — attachment privacy: Storage API verification.
 *
 * Drives the whole W8-E compatibility matrix against a REAL Storage API with
 * REAL GoTrue sessions, by flipping the local bucket between public and
 * private and asserting each state:
 *
 *   STATE PUBLIC   (Stage A/B)  the pre-flip state the new runtime must also
 *                               support: derived signed URLs already work,
 *                               and the legacy public URL still resolves.
 *   STATE PRIVATE  (Stage C)    the target: a known object key returns NO
 *                               bytes to anyone without a session, by any
 *                               route, while active employees still open it
 *                               through a signed URL.
 *   ROLLBACK                    public again, immediately and completely.
 *
 * Plus the branding bucket in every state: public read without a session,
 * write restricted to an active writer, and never a home for note content.
 *
 * Alpha Storage 4 (remediation) adds two things:
 *
 *   M-2  the REPRESENTATION a private upload persists — `path` = the key,
 *        `src` = the canonical public URL of exactly that key, derived by the
 *        same supabase-js helper the app uses — is accepted by the S3B
 *        grammar through a REAL note write, while every near-miss `src` is
 *        still rejected; the canonical `src` yields bytes while public, NO
 *        bytes while private, and bytes again after the rollback, and the
 *        persisted JSON survives the flips unchanged. Set
 *        NORA_W8E_REPRESENTATION_OUT=<file> to export the persisted
 *        attachment JSON for the old-runtime rollback proof.
 *   L-2  Stage C and the rollback run through the REAL operator scripts in
 *        supabase/maintenance/attachment_privacy/, and their per-bucket
 *        verdicts are asserted: attachments PRIVATE = expected, branding
 *        PUBLIC = expected by design, and a still-public attachments bucket
 *        is a hard error, not a line of text.
 *
 * Alpha Storage 5 (production-readiness hardening) adds:
 *
 *   U-6  Stage C refuses, BEFORE mutating, when a foreign policy exists on
 *        `storage.objects` (an injected permissive policy; the bucket must
 *        stay public and the policy untouched), and the preflight says STOP.
 *   U-7  the rollback verifies its own result: with the flip back to public
 *        forced to fail by an injected trigger, it is a hard error in every
 *        runner shape (psql + ON_ERROR_STOP, psql without it, one message,
 *        one message showing only the last result) and never reports
 *        `PUBLIC —`; a missing bucket is a hard error too.
 *   U-1  Stage C's branding postcondition is asserted on its own, so
 *        deleting it fails this suite.
 *   U-9  every mutation of shared local state (bucket flags, injected
 *        policy/trigger) is undone in `finally`, and a failed cleanup is
 *        reported next to the primary failure instead of hiding it. The
 *        "deactivated identity" read check now really presents that
 *        identity's JWT, so it can fail independently of the anonymous one.
 *
 * Alpha Storage 6 (CDN-safe release procedure) changes how Stage C runs:
 *
 *   F-2  the flip is no longer SQL. Stage C and the canonical rollback run
 *        through the REAL operator tool `10_set_attachments_privacy.mjs`
 *        against the REAL local Storage API (child process, publishable key
 *        for anonymous probes, the local secret key as the operator-only
 *        admin credential). Asserted: its outcome line, its exit code, the
 *        bucket state in the database, the untouched bucket controls, the
 *        key never appearing in its output, and its refusal of an
 *        already-private bucket (the Storage API never purges from there).
 *   §10  compensation, by triggers injected on `storage.buckets`: an API
 *        refusal is STOP / NO MUTATION; a dropped MIME allowlist, a flip
 *        that does not take, or a branding bucket knocked private are
 *        PUBLIC / COMPENSATED with the original controls; a compensation
 *        that is refused too is EMERGENCY.
 *   F-3  a same-named but widened `attachments_select_active_user` makes the
 *        preflight STOP (definition, not name), and the tool refuses before
 *        mutating because anonymous LIST works; an authenticated-only
 *        widening is caught by the preflight alone.
 *   F-32 / F-33  RLS disabled on `storage.objects` (local superuser) and any
 *        policy on `storage.buckets` make the preflight STOP.
 *   F-6  `00_preflight.sql` and `30_verify_attachments_private.sql` end on
 *        their verdict row in every runner shape, including last-result-only.
 *   F-34 the SQL rollback fallback refuses to report PUBLIC when a deferred
 *        constraint trigger reverts the flip at commit.
 *   F-1  branding is checked by its exact public bytes, anonymously.
 *   The SQL rollback fallback `20_set_attachments_public.sql` keeps its U-7
 *   runner-shape matrix. Every injection, policy change and bucket control is
 *   restored in the exit handler, however the run ends.
 *
 * THE ASSERTION THAT CHANGED. `attachment_storage_policy_verification.mjs`
 * records anonymous readability of a known key as RESIDUAL T1 — expected, not
 * a failure, because the bucket was public by design. Here, in the private
 * state, the identical observation is a BLOCKING failure. That inversion is
 * the whole point of W8-E and is deliberately expressed as two separate
 * verifiers rather than one with a loosened assertion.
 *
 * Local only — refuses any non-localhost URL. MUTATES the local bucket's
 * `public` flag and restores it at the end; never run against Production.
 *
 *   npx supabase db reset --local
 *   node supabase/tests/attachment_privacy_verification.mjs
 *
 * ENVIRONMENT PREREQUISITE — a stack whose DB VOLUME matches the pinned CLI.
 *
 * `storage.objects` is migrated by the storage-api container, not by Nora. A
 * database volume left over from an OLDER Supabase CLI can end up with a
 * storage schema that the current storage-api boots against but does not
 * match: every upload then fails with `42P10 infer_arbiter_indexes`, because
 * the container issues `ON CONFLICT (name, bucket_id)` while the migrated
 * schema carries only PARTIAL unique indexes on `(bucket_id, name)`, which
 * PostgreSQL cannot infer as an arbiter.
 *
 * This is NOT a Nora defect and needs no schema change. `npx supabase db
 * reset` does NOT fix it — the volume is the problem, not the data. Recreate
 * the volume:
 *
 *   npx supabase stop --no-backup   # drops the volumes
 *   npm run signing-keys:ensure
 *   npx supabase start
 *
 * Verified on a volume created by the pinned CLI (2.118.0): uploads work with
 * NO index workaround and every assertion of this suite passes (the count is
 * printed at the end of each run; it grows with the suite, so it is not
 * repeated here). Never add a unique index to `storage.objects` to work
 * around a stale volume — that encodes a local artefact as product schema.
 *
 * Exit 0 = all assertions passed · 1 = assertion failure · 2 = prerequisites.
 */

import { createClient } from "@supabase/supabase-js";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ATTACHMENTS = "attachments";
const BRANDING = "branding";
const DB_CONTAINER =
  process.env.NORA_DB_CONTAINER || "supabase_db_atomic-crm-demo";

const readLocalKeys = () => {
  const raw = execFileSync("npx", ["supabase", "status", "-o", "json"], {
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const status = JSON.parse(raw.slice(raw.indexOf("{")));
  return {
    url: process.env.SUPABASE_URL || status.API_URL || "http://127.0.0.1:54321",
    // The new-format keys are what Nora itself ships (VITE_SB_PUBLISHABLE_KEY).
    anon: status.PUBLISHABLE_KEY || status.ANON_KEY,
    service: status.SECRET_KEY || status.SERVICE_ROLE_KEY,
  };
};

let config;
try {
  config = readLocalKeys();
} catch (error) {
  console.error("[w8e] local Supabase stack unavailable:", error.message);
  process.exit(2);
}
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(config.url)) {
  console.error(`[w8e] refusing non-local Supabase URL ${config.url}`);
  process.exit(2);
}

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false },
};
const service = createClient(config.url, config.service, clientOptions);
const anon = createClient(config.url, config.anon, clientOptions);

const psql = (sql, stdio = undefined) =>
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      DB_CONTAINER,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
    ],
    { input: sql, encoding: "utf8", stdio },
  ).trim();

const run = randomUUID().slice(0, 8);
const password = `W8e-${randomUUID()}`;
const results = [];
/** Checks that could not run here — reported next to the pass count (F-18). */
const skipped = [];

const check = (label, actual, expected) => {
  const ok = actual === expected;
  results.push({ label, ok });
  console.log(
    `${ok ? "OK  " : "FAIL"} ${label} :: got ${actual}, expected ${expected}`,
  );
  if (!ok) process.exitCode = 1;
};

const createEmployee = async (label, role) => {
  const email = `w8e-${label}-${run}@nora.test`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: "W8E", last_name: label },
  });
  if (error) throw new Error(`createUser ${label}: ${error.message}`);
  psql(`select nora_private.apply_sales_role_change(
          (select id from public.sales where user_id = '${data.user.id}'), '${role}', false);`);
  const client = createClient(config.url, config.anon, clientOptions);
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) throw new Error(`signIn ${label}: ${signInError.message}`);
  return { label, userId: data.user.id, client };
};

const setPublic = (bucket, value) => {
  psql(`update storage.buckets set public = ${value} where id = '${bucket}';`);
  return psql(`select public from storage.buckets where id = '${bucket}';`);
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const noteKey = `w8e-note-${run}.txt`;
const noteBody = `note-secret-${run}`;
const brandKey = `w8e-brand-${run}.png`;
// A one-pixel PNG, so the branding bucket's MIME allowlist is exercised for
// real rather than bypassed with text/plain.
const PNG_BYTES = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

{
  const a = await service.storage
    .from(ATTACHMENTS)
    .upload(noteKey, new Blob([noteBody], { type: "text/plain" }));
  if (a.error) {
    console.error(
      `[w8e] could not seed the attachments fixture: ${a.error.message}`,
    );
    if (/42P10|infer_arbiter/i.test(a.error.message)) {
      console.error(
        "[w8e] stale DB volume — see this file's ENVIRONMENT PREREQUISITE header:",
      );
      console.error(
        "[w8e]   npx supabase stop --no-backup && npm run signing-keys:ensure && npx supabase start",
      );
    }
    process.exit(2);
  }
  const b = await service.storage
    .from(BRANDING)
    .upload(brandKey, new Blob([PNG_BYTES], { type: "image/png" }));
  if (b.error) {
    console.error(
      `[w8e] could not seed the branding fixture: ${b.error.message}`,
    );
    process.exit(2);
  }
}

// admin FIRST: guard_last_active_admin() refuses to demote the bootstrap admin
const admin = await createEmployee("admin", "admin");
const viewer = await createEmployee("viewer", "viewer");
const office = await createEmployee("office", "office");
const disabled = await createEmployee("disabled", "office");

const publicUrl = (bucket, key) =>
  `${config.url}/storage/v1/object/public/${bucket}/${key}`;
const authedUrl = (bucket, key) =>
  `${config.url}/storage/v1/object/authenticated/${bucket}/${key}`;

/** True when the URL really returns the fixture bytes. */
const yieldsBytes = async (url, expected, headers = {}) => {
  const response = await fetch(url, { headers });
  if (!response.ok) return false;
  return (await response.text()) === expected;
};

const canSign = async (client, bucket, key) => {
  const { data, error } = await client.storage
    .from(bucket)
    .createSignedUrl(key, 60);
  return !error && Boolean(data?.signedUrl);
};

const signedYieldsBytes = async (client, bucket, key, expected) => {
  const { data, error } = await client.storage
    .from(bucket)
    .createSignedUrl(key, 60);
  if (error || !data?.signedUrl) return false;
  const url = new URL(data.signedUrl);
  return yieldsBytes(`${config.url}${url.pathname}${url.search}`, expected);
};

// ---------------------------------------------------------------------------
// Operator scripts — Stage C and its rollback run as the REAL files
// ---------------------------------------------------------------------------
const operatorScript = (name) =>
  readFileSync(
    new URL(`../maintenance/attachment_privacy/${name}`, import.meta.url),
    "utf8",
  ).replace(/\r\n/g, "\n");

/** Runs SQL; returns `{ rows }` on success or `{ error }` with psql's stderr. */
const psqlTry = (sql) => {
  try {
    return {
      rows: psql(sql, ["pipe", "pipe", "pipe"])
        .split("\n")
        .filter((line) => line.includes("|"))
        .map((line) => line.split("|")),
    };
  } catch (error) {
    return { error: String(error.stderr ?? error.message) };
  }
};

/**
 * Alpha Storage 5 U-7 — the runner shapes an operator (or an agent) may use.
 * Each returns exit code, stdout and stderr; none throws, because what a
 * runner does AFTER an error is exactly what is under test.
 */
const RUNNER_SHAPES = {
  "psql stdin + ON_ERROR_STOP": (sql) => ({
    args: ["-v", "ON_ERROR_STOP=1", "-At"],
    input: sql,
  }),
  "psql stdin without ON_ERROR_STOP": (sql) => ({ args: ["-At"], input: sql }),
  "one message (psql -c)": (sql) => ({ args: ["-At", "-c", sql] }),
  "one message, last result only (MCP-like)": (sql) => ({
    args: ["-At", "-v", "SHOW_ALL_RESULTS=off", "-c", sql],
  }),
};
const psqlShape = (shape, sql) => {
  const { args, input } = RUNNER_SHAPES[shape](sql);
  const result = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      DB_CONTAINER,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      ...args,
    ],
    { input: input ?? "", encoding: "utf8" },
  );
  return {
    code: result.status,
    out: result.stdout ?? "",
    err: result.stderr ?? "",
  };
};

// Names of the objects this run may inject. Unique per run, and removed in
// the exit handler whatever happens (U-9).
const INJECTED_POLICY = `w8e_verify_${run}_foreign_read`;
const INJECTED_BUCKET_POLICY = `w8e_verify_${run}_buckets_rw`;

/**
 * Fault injections on `storage.buckets`. BEFORE triggers rewrite or refuse
 * the row the Storage API (or SQL) writes; the AFTER and the DEFERRED ones
 * change state behind the writer's back. SECURITY DEFINER so they behave the
 * same whichever role storage-api uses for the update.
 */
const TRIGGERS = {
  keep_private: `if new.id = 'attachments' then new.public := false; end if; return new;`,
  refuse_private: `if new.id = 'attachments' and new.public = false then
                       raise exception 'w8e verify: refusing the flip'; end if; return new;`,
  drop_mime: `if new.id = 'attachments' and new.public = false then
                  new.allowed_mime_types := null; end if; return new;`,
  keep_public: `if new.id = 'attachments' then new.public := true; end if; return new;`,
  refuse_public: `if new.id = 'attachments' and new.public = true then
                      raise exception 'w8e verify: refusing public'; end if; return new;`,
  flip_branding: `if new.id = 'attachments' and new.public = false and pg_trigger_depth() = 1 then
                      update storage.buckets set public = false where id = 'branding'; end if; return null;`,
  deferred_revert: `if new.id = 'attachments' and new.public is true and pg_trigger_depth() = 1 then
                        update storage.buckets set public = false where id = 'attachments'; end if; return null;`,
};
const TRIGGER_TIMING = {
  flip_branding: "after update on storage.buckets",
  deferred_revert:
    "after update on storage.buckets deferrable initially deferred",
};
const injectTrigger = (kind) => {
  const name = `w8e_verify_${run}_${kind}`;
  const timing = TRIGGER_TIMING[kind] ?? "before update on storage.buckets";
  psql(`create function public.${name}() returns trigger
          language plpgsql security definer set search_path = '' as $f$
        begin ${TRIGGERS[kind]} end; $f$;
        create ${kind === "deferred_revert" ? "constraint " : ""}trigger ${name}
            ${timing}
            for each row execute function public.${name}();`);
};
/** Makes every UPDATE of the attachments bucket row keep it PRIVATE. */
const injectKeepPrivate = () => injectTrigger("keep_private");

// The W8-B definition of the one policy the F-3 probes widen.
const CANONICAL_SELECT_POLICY = `alter policy attachments_select_active_user on storage.objects
    to authenticated using (bucket_id = 'attachments' and nora_private.is_active_user());`;

const removeInjections = () =>
  psql(`${Object.keys(TRIGGERS)
    .map(
      (
        kind,
      ) => `drop trigger if exists w8e_verify_${run}_${kind} on storage.buckets;
        drop function if exists public.w8e_verify_${run}_${kind}();`,
    )
    .join("\n")}
        drop policy if exists ${INJECTED_POLICY} on storage.objects;
        drop policy if exists ${INJECTED_BUCKET_POLICY} on storage.buckets;
        ${CANONICAL_SELECT_POLICY}`);

/** The local superuser — needed only for the RLS-disabled probe (F-32). */
const superuserPsql = (sql) =>
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "-e",
      `PGPASSWORD=${process.env.NORA_DB_SUPERUSER_PASSWORD || "postgres"}`,
      DB_CONTAINER,
      "psql",
      "-U",
      "supabase_admin",
      "-h",
      "127.0.0.1",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
    ],
    { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();

const bucketPublic = (bucket) =>
  psql(`select public from storage.buckets where id = '${bucket}';`);

/** The attachments controls at start — restored verbatim however the run ends. */
const bucketControls = (bucket) =>
  psql(`select file_size_limit || '|' || allowed_mime_types::text
          from storage.buckets where id = '${bucket}';`);
const ATTACHMENTS_CONTROLS = bucketControls(ATTACHMENTS);
const restoreAttachmentsControls = () => {
  const [limit, mime] = ATTACHMENTS_CONTROLS.split("|");
  psql(`update storage.buckets set file_size_limit = ${Number(limit)},
          allowed_mime_types = '${mime.replace(/'/g, "''")}'::text[]
         where id = 'attachments';`);
};

const unknownPolicyCount = () =>
  psql(`select count(*) from pg_policies
         where schemaname = 'storage' and tablename = 'objects'
           and policyname not in ('attachments_select_active_user', 'attachments_insert_writer',
                                  'branding_select_active_user', 'branding_insert_writer');`);

// ---------------------------------------------------------------------------
// U-9 — shared local state is put back however this process ends
// ---------------------------------------------------------------------------
// Success, a failed check, a prerequisite abort (`process.exit(2)`) or an
// unexpected exception all end in the 'exit' event, and every restore step is
// a synchronous psql call, so one listener covers them all without wrapping
// the suite. It never replaces the primary result: that has been printed by
// the time it runs, and a cleanup failure is printed NEXT to it and turns a
// passing exit code into a failing one.
process.on("exit", (code) => {
  const problems = [];
  const restored = [];
  const step = (label, action) => {
    try {
      const note = action();
      if (note) restored.push(note);
    } catch (error) {
      problems.push(
        `${label}: ${String(error.stderr ?? error.message).trim()}`,
      );
    }
  };
  step(
    "remove injected policies/triggers/functions, restore the W8-B policy",
    () => {
      removeInjections();
    },
  );
  step("row level security on storage.objects", () => {
    if (
      psql(
        "select relrowsecurity from pg_class where oid = 'storage.objects'::regclass;",
      ) === "t"
    ) {
      return null;
    }
    superuserPsql("alter table storage.objects enable row level security;");
    return "RLS on storage.objects had been left DISABLED — re-enabled";
  });
  step("restore attachments controls", () => {
    if (bucketControls(ATTACHMENTS) === ATTACHMENTS_CONTROLS) return null;
    restoreAttachmentsControls();
    return "attachments controls had drifted — restored";
  });
  for (const bucket of [ATTACHMENTS, BRANDING]) {
    step(`restore ${bucket}.public = true`, () => {
      if (bucketPublic(bucket) === "t") return null;
      if (setPublic(bucket, true) !== "t") throw new Error("still not public");
      return `${bucket} had been left PRIVATE — restored to public`;
    });
  }
  for (const note of restored) console.error(`[w8e] CLEANUP: ${note}`);
  if (problems.length) {
    console.error(
      `[w8e] CLEANUP FAILED (primary result above, exit code ${code}):`,
    );
    for (const problem of problems) console.error(`[w8e]   - ${problem}`);
    if (code === 0) process.exitCode = 1;
  }
});

// ---------------------------------------------------------------------------
// M-2 — the S3B grammar, asked directly (it has no API grant; postgres only)
// ---------------------------------------------------------------------------
// The grammar's allowlist (migration 20260918120000) knows exactly one local
// origin. A stack on other ports still proves every REJECTION below, but the
// app-derived src of such a stack is `unknown` to the grammar by design, so
// the real-write acceptance needs the default local origin.
const GRAMMAR_LOCAL_ORIGIN = "http://127.0.0.1:54321";
const grammarAccepts = (element) => {
  const tag = `j${run}`;
  const { rows, error } = psqlTry(
    `select 'n|' || count(*) from nora_private.note_attachment_reference_rows(
       array[$${tag}$${JSON.stringify(element)}$${tag}$::jsonb]);`,
  );
  if (error) {
    if (!error.includes("NORA_ATTACHMENT_REFERENCE_INVALID")) {
      // An unexpected SQL error is a FAILURE, never a counted rejection
      // (Alpha Storage 3C F-17): it lands in the summary like any check.
      results.push({
        label: `grammar raised an unexpected error: ${error.split("\n")[0]}`,
        ok: false,
      });
      console.error(`FAIL unexpected grammar error: ${error}`);
    }
    return false;
  }
  return rows[0]?.[1] === "1";
};

// ---------------------------------------------------------------------------
// STATE PUBLIC — Stage A / Stage B
// ---------------------------------------------------------------------------
// Start-state precondition: the stack must be exactly the pre-Stage-C target
// (the preflight says GO). A stack left private or drifted by an interrupted
// run is reported, not silently "repaired" into a pass.
{
  const start = psqlTry(operatorScript("00_preflight.sql"));
  const verdict = (start.rows ?? []).at(-1);
  if (verdict?.[1] !== "== VERDICT ==" || verdict?.[2] !== "GO") {
    console.error(
      "[w8e] start state is not the pre-Stage-C target (00_preflight.sql did not say GO):",
    );
    for (const row of start.rows ?? [])
      console.error(`[w8e]   ${row.join("|")}`);
    if (start.error) console.error(`[w8e]   ${start.error}`);
    process.exit(2);
  }
}
console.log(
  `\n=== STATE PUBLIC (attachments.public=${bucketPublic(ATTACHMENTS)}) — Stage A/B ===`,
);

check(
  "A/B active office can derive a signed URL that yields bytes",
  await signedYieldsBytes(office.client, ATTACHMENTS, noteKey, noteBody),
  true,
);
check(
  "A/B active viewer can derive a signed URL that yields bytes",
  await signedYieldsBytes(viewer.client, ATTACHMENTS, noteKey, noteBody),
  true,
);
// RESIDUAL T1 while public. Recorded, not celebrated: this is the exposure
// W8-E exists to close, and it is asserted as a FAILURE in the private state.
check(
  "A/B legacy public URL still yields bytes anonymously [RESIDUAL T1]",
  await yieldsBytes(publicUrl(ATTACHMENTS, noteKey), noteBody),
  true,
);

// --- M-2: the representation a Stage B private upload persists -------------
console.log("\n--- M-2 private upload representation (Stage B, public) ---");
// Uploaded by an ordinary active employee under an app-shaped key, exactly as
// `uploadToBucket(fi, "private")` does it.
const repKey = `${randomUUID()}.txt`;
const repBody = `rep-secret-${run}`;
{
  const { error } = await office.client.storage
    .from(ATTACHMENTS)
    .upload(repKey, new Blob([repBody], { type: "text/plain" }));
  if (error) {
    console.error(`[w8e] could not upload the M-2 fixture: ${error.message}`);
    process.exit(2);
  }
}
// The SAME helper the app calls — not a hand-built string.
const canonicalSrc = office.client.storage
  .from(ATTACHMENTS)
  .getPublicUrl(repKey).data.publicUrl;
const representation = {
  path: repKey,
  src: canonicalSrc,
  title: "angebot.txt",
  type: "text/plain",
};

check(
  "M-2 supabase-js getPublicUrl yields the canonical public URL of exactly that key",
  canonicalSrc,
  publicUrl(ATTACHMENTS, repKey),
);

// Grammar, element level. The accepted form is built on the allowlisted local
// origin so the check means the same thing on every local stack.
const grammarCanonical = `${GRAMMAR_LOCAL_ORIGIN}/storage/v1/object/public/attachments/${repKey}`;
const signedForRep = (
  await office.client.storage.from(ATTACHMENTS).createSignedUrl(repKey, 60)
).data?.signedUrl;
check(
  "M-2 grammar ACCEPTS path + canonical public URL of that same path",
  grammarAccepts({ ...representation, src: grammarCanonical }),
  true,
);
check(
  "M-2 grammar ACCEPTS path with no src (path-only stays valid)",
  grammarAccepts({ path: repKey, title: "a.txt", type: "text/plain" }),
  true,
);
for (const [label, src] of [
  [
    "canonical URL of ANOTHER key",
    `${GRAMMAR_LOCAL_ORIGIN}/storage/v1/object/public/attachments/other-${repKey}`,
  ],
  [
    "canonical-shaped URL of ANOTHER bucket",
    `${GRAMMAR_LOCAL_ORIGIN}/storage/v1/object/public/branding/${repKey}`,
  ],
  ["a real Signed URL of that key", signedForRep ?? "<no signed url>"],
  [
    "attacker host",
    `https://attacker.example/storage/v1/object/public/attachments/${repKey}`,
  ],
  [
    "modified object path (double slash)",
    `${GRAMMAR_LOCAL_ORIGIN}/storage/v1/object/public/attachments//${repKey}`,
  ],
  [
    "modified object path (authenticated route)",
    `${GRAMMAR_LOCAL_ORIGIN}/storage/v1/object/authenticated/attachments/${repKey}`,
  ],
  [
    "modified object path (render route)",
    `${GRAMMAR_LOCAL_ORIGIN}/storage/v1/render/image/public/attachments/${repKey}`,
  ],
  ["query-bearing capability URL", `${grammarCanonical}?token=abc.def`],
  ["fragment", `${grammarCanonical}#x`],
  ["padding", ` ${grammarCanonical}`],
  ["javascript:", "javascript:alert(1)"],
  ["data:", "data:text/plain,x"],
]) {
  check(
    `M-2 grammar REJECTS src = ${label}`,
    grammarAccepts({ ...representation, src }),
    false,
  );
}

// Grammar, through a REAL note write (PostgREST -> AFTER trigger projection).
const onAllowlistedOrigin = config.url === GRAMMAR_LOCAL_ORIGIN;
let repNoteId = null;
if (onAllowlistedOrigin) {
  const contact = await office.client
    .from("contacts")
    .insert({ first_name: "W8E", last_name: `rep-${run}` })
    .select("id")
    .single();
  if (contact.error) {
    console.error(`[w8e] could not create a contact: ${contact.error.message}`);
    process.exit(2);
  }
  const accepted = await office.client
    .from("contact_notes")
    .insert({
      contact_id: contact.data.id,
      text: `w8e rep ${run}`,
      attachments: [representation],
    })
    .select("id")
    .single();
  repNoteId = accepted.data?.id ?? null;
  check(
    "M-2 a REAL note write with the app-derived canonical src is accepted",
    accepted.error?.message ?? "accepted",
    "accepted",
  );
  check(
    "M-2 the projection indexed the element by its key",
    psql(
      `select count(*) from public.attachments where storage_key = '${repKey}';`,
    ),
    "1",
  );
  const mismatched = await office.client.from("contact_notes").insert({
    contact_id: contact.data.id,
    text: `w8e mismatch ${run}`,
    attachments: [
      {
        ...representation,
        src: `${GRAMMAR_LOCAL_ORIGIN}/storage/v1/object/public/attachments/other-${repKey}`,
      },
    ],
  });
  check(
    "M-2 a REAL note write whose src names another key is rejected",
    mismatched.error?.details ?? "accepted",
    "NORA_ATTACHMENT_REFERENCE_INVALID",
  );
} else {
  skipped.push(
    "M-2 real note writes (stack is not on the grammar's allowlisted origin)",
  );
  console.log(
    `SKIP M-2 real note writes: ${config.url} is not the grammar's allowlisted local origin ${GRAMMAR_LOCAL_ORIGIN}`,
  );
}

check(
  "M-2 [Stage B] the canonical src yields bytes anonymously while public [RESIDUAL T1]",
  await yieldsBytes(canonicalSrc, repBody),
  true,
);
check(
  "M-2 [Stage B] the W8-E runtime path (key -> signed URL) yields bytes",
  await signedYieldsBytes(office.client, ATTACHMENTS, repKey, repBody),
  true,
);

// ---------------------------------------------------------------------------
// Alpha Storage 6 — the Stage C control plane, run as the REAL tool
// ---------------------------------------------------------------------------
const STAGE_TOOL = fileURLToPath(
  new URL(
    "../maintenance/attachment_privacy/10_set_attachments_privacy.mjs",
    import.meta.url,
  ),
);
const targetHost = new URL(config.url).host;
const PROBE_URL = publicUrl(ATTACHMENTS, noteKey);

/**
 * Runs the operator tool in a child process exactly as an operator would —
 * same Node flags (so a local fetch shim reaches it and its probe processes),
 * publishable key for the anonymous probes, the local secret key as the
 * operator-only admin credential. Short CDN window: there is no CDN locally.
 */
const runStageTool = (command, { apply = true } = {}) => {
  const args = [
    ...process.execArgv,
    STAGE_TOOL,
    command,
    `--target=${targetHost}`,
    `--probe-url=${PROBE_URL}`,
    "--cdn-window-seconds=5",
    "--cdn-interval-seconds=1",
  ];
  if (apply) args.push("--apply");
  const child = spawnSync(process.execPath, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      SUPABASE_URL: config.url,
      SUPABASE_ANON_KEY: config.anon,
      NORA_STORAGE_ADMIN_KEY: config.service,
    },
  });
  const out = child.stdout ?? "";
  const last = out.trim().split("\n").at(-1) ?? "";
  let result = { outcome: "<no result line>" };
  if (last.startsWith("NORA_W8E_RESULT ")) {
    try {
      result = JSON.parse(last.slice("NORA_W8E_RESULT ".length));
    } catch {
      result = { outcome: "<unparseable result line>" };
    }
  }
  return {
    code: child.status,
    result,
    out,
    leaked: `${out}${child.stderr ?? ""}`.includes(config.service),
  };
};

/** Runs a read-only gate file and returns its final (verdict) row. */
const verdictRow = (file) => {
  const { rows, error } = psqlTry(operatorScript(file));
  return { last: (rows ?? []).at(-1) ?? [], rows: rows ?? [], error };
};
const failedGates = (row) => row?.[3] ?? "";

// --- F-6: the read-only gates end on their verdict in every runner shape ---
console.log(
  "\n--- F-6 read-only gates across runner shapes (attachments PUBLIC) ---",
);
for (const [file, expected] of [
  ["00_preflight.sql", "GO"],
  ["30_verify_attachments_private.sql", "STOP"],
]) {
  for (const shape of Object.keys(RUNNER_SHAPES)) {
    if (shape === "psql stdin without ON_ERROR_STOP") continue; // same output as with
    const ran = psqlShape(shape, operatorScript(file));
    const lastLine = ran.out.trim().split("\n").at(-1) ?? "";
    check(
      `F-6 [${shape}] ${file}: the LAST visible row is its verdict (${expected})`,
      lastLine.startsWith(`99|== VERDICT ==|${expected}|`),
      true,
    );
  }
}

// --- F-3 / U-6 / F-32 / F-33: the preflight judges definitions, not names ---
console.log("\n--- preflight gates (attachments PUBLIC) ---");
{
  check(
    "preflight precondition: GO on the pristine stack",
    verdictRow("00_preflight.sql").last[2],
    "GO",
  );

  // U-6: a foreign permissive policy
  psql(`create policy ${INJECTED_POLICY} on storage.objects
          for select to anon using (bucket_id = 'attachments');`);
  const foreign = verdictRow("00_preflight.sql");
  check("U-6 preflight STOPs on a foreign policy", foreign.last[2], "STOP");
  check(
    "U-6 preflight names the foreign policy",
    foreign.rows.some(
      (row) => row[0] === "8" && row.join("|").includes(INJECTED_POLICY),
    ),
    true,
  );
  const refusedForeign = runStageTool("private");
  check(
    "U-6 Stage C tool refuses BEFORE mutating (anonymous LIST works)",
    `${refusedForeign.code} ${refusedForeign.result.outcome}`,
    "1 STOP / NO MUTATION",
  );
  check(
    "U-6 attachments.public is UNCHANGED after the refusal",
    bucketPublic(ATTACHMENTS),
    "t",
  );
  check(
    "U-6 the foreign policy was neither dropped nor altered",
    psql(`select count(*) from pg_policies
           where schemaname = 'storage' and tablename = 'objects'
             and policyname = '${INJECTED_POLICY}' and cmd = 'SELECT' and roles = '{anon}';`),
    "1",
  );
  removeInjections();

  // F-3 (a): same name, widened to anon, predicate weakened
  psql(`alter policy attachments_select_active_user on storage.objects
          to anon, authenticated using (bucket_id = 'attachments');`);
  const widened = verdictRow("00_preflight.sql");
  check(
    "F-3 preflight STOPs on a same-named widened policy",
    widened.last[2],
    "STOP",
  );
  check(
    "F-3 the failed gate is the DEFINITION gate (6), with the drifted definition shown",
    failedGates(widened.last) === "failed gate(s): 6" &&
      widened.rows.some(
        (row) =>
          row[0] === "6" && row.join("|").includes("{anon,authenticated}"),
      ),
    true,
  );
  const refusedWidened = runStageTool("private");
  check(
    "F-3 Stage C tool refuses BEFORE mutating (anonymous LIST works)",
    `${refusedWidened.code} ${refusedWidened.result.outcome}`,
    "1 STOP / NO MUTATION",
  );
  check("F-3 attachments.public is UNCHANGED", bucketPublic(ATTACHMENTS), "t");
  psql(CANONICAL_SELECT_POLICY);

  // F-3 (b): same name, same role, the active-user predicate dropped — only
  // the definition gate can see this; anonymous probes cannot.
  psql(`alter policy attachments_select_active_user on storage.objects
          to authenticated using (bucket_id = 'attachments');`);
  check(
    "F-3 preflight STOPs when is_active_user() is dropped from the definition",
    `${verdictRow("00_preflight.sql").last[2]} ${failedGates(verdictRow("00_preflight.sql").last)}`,
    "STOP failed gate(s): 6",
  );
  psql(CANONICAL_SELECT_POLICY);
  check(
    "F-3 canonical definition restored: preflight GO again",
    verdictRow("00_preflight.sql").last[2],
    "GO",
  );

  // F-33: any policy on storage.buckets
  psql(`create policy ${INJECTED_BUCKET_POLICY} on storage.buckets
          for all to authenticated using (true) with check (true);`);
  check(
    "F-33 preflight STOPs on a policy on storage.buckets (gate 9)",
    `${verdictRow("00_preflight.sql").last[2]} ${failedGates(verdictRow("00_preflight.sql").last)}`,
    "STOP failed gate(s): 9",
  );
  removeInjections();

  // F-32: RLS disabled on storage.objects (platform-owner roles only)
  let superuser = true;
  try {
    superuserPsql("alter table storage.objects disable row level security;");
  } catch (error) {
    superuser = false;
    skipped.push("F-32 RLS-disabled probe (local superuser unavailable)");
    console.log(
      `SKIP F-32 RLS-disabled probe: local superuser unavailable (${String(error.message).split("\n")[0]})`,
    );
  }
  if (superuser) {
    try {
      check(
        "F-32 preflight STOPs when RLS is disabled on storage.objects (gate 5)",
        `${verdictRow("00_preflight.sql").last[2]} ${failedGates(verdictRow("00_preflight.sql").last)}`,
        "STOP failed gate(s): 5",
      );
    } finally {
      superuserPsql("alter table storage.objects enable row level security;");
    }
  }
  // Stage A not complete: a branding reference still points into attachments.
  // The tool enforces this itself (read-only through PostgREST), not only the
  // preflight.
  const configBefore = psql(
    "select coalesce((select config::text from public.configuration where id = 1), '<none>');",
  );
  psql(`insert into public.configuration (id, config) values (1, '{}'::jsonb)
          on conflict (id) do nothing;
        update public.configuration
           set config = config || jsonb_build_object('darkModeLogo', '${publicUrl(ATTACHMENTS, noteKey)}')
         where id = 1;`);
  try {
    check(
      "Stage A gate: preflight STOPs while a branding reference points into attachments (gate 10)",
      `${verdictRow("00_preflight.sql").last[2]} ${failedGates(verdictRow("00_preflight.sql").last)}`,
      "STOP failed gate(s): 10",
    );
    const stale = runStageTool("private");
    check(
      "Stage A gate: the tool itself refuses BEFORE mutating",
      `${stale.code} ${stale.result.outcome} ${(stale.result.stops ?? []).some((s) => s.includes("configuration#1.darkModeLogo"))}`,
      "1 STOP / NO MUTATION true",
    );
    check(
      "Stage A gate: attachments.public is UNCHANGED",
      bucketPublic(ATTACHMENTS),
      "t",
    );
  } finally {
    psql(
      configBefore === "<none>"
        ? "delete from public.configuration where id = 1;"
        : `update public.configuration set config = $cfg$${configBefore}$cfg$::jsonb where id = 1;`,
    );
  }
  check(
    "preflight GO again after every probe was undone",
    verdictRow("00_preflight.sql").last[2],
    "GO",
  );
}

// --- §10: every failure after the API mutation ends in a named state -------
console.log("\n--- §10 Stage C failure compensation (attachments PUBLIC) ---");
const withTrigger = (kind, action) => {
  injectTrigger(kind);
  try {
    return action();
  } finally {
    removeInjections();
  }
};
{
  const refused = withTrigger("refuse_private", () => runStageTool("private"));
  check(
    "§10 an API refusal is STOP / NO MUTATION (exit 1)",
    `${refused.code} ${refused.result.outcome}`,
    "1 STOP / NO MUTATION",
  );
  check(
    "§10 … and the bucket is verifiably still public",
    bucketPublic(ATTACHMENTS),
    "t",
  );

  const dropped = withTrigger("drop_mime", () => runStageTool("private"));
  check(
    "§10 a dropped MIME allowlist is PUBLIC / COMPENSATED (exit 2)",
    `${dropped.code} ${dropped.result.outcome}`,
    "2 PUBLIC / COMPENSATED",
  );
  check(
    "§10 … reporting the original failure",
    (dropped.result.originalFailures ?? [])
      .join(" ")
      .includes("allowed_mime_types"),
    true,
  );
  check(
    "§10 … and the database holds public + the ORIGINAL controls",
    `${bucketPublic(ATTACHMENTS)} ${bucketControls(ATTACHMENTS) === ATTACHMENTS_CONTROLS}`,
    "t true",
  );

  const noEffect = withTrigger("keep_public", () => runStageTool("private"));
  check(
    "§10 a flip that does not take effect is PUBLIC / COMPENSATED, never PRIVATE",
    `${noEffect.code} ${noEffect.result.outcome}`,
    "2 PUBLIC / COMPENSATED",
  );

  const branding = withTrigger("flip_branding", () => runStageTool("private"));
  check(
    "§10 branding knocked private by the flip is PUBLIC / COMPENSATED",
    `${branding.code} ${branding.result.outcome}`,
    "2 PUBLIC / COMPENSATED",
  );
  check(
    "§10 … the original failure names the branding bucket",
    (branding.result.originalFailures ?? [])
      .join(" ")
      .includes('"branding" is not public'),
    true,
  );
  check(
    "§10 … attachments verifiably public again",
    bucketPublic(ATTACHMENTS),
    "t",
  );
  setPublic(BRANDING, true);

  injectTrigger("drop_mime");
  injectTrigger("refuse_public");
  let emergency;
  try {
    emergency = runStageTool("private");
  } finally {
    removeInjections();
  }
  check(
    "§10 a refused compensation is EMERGENCY / STATE REQUIRES MANUAL RECOVERY (exit 3)",
    `${emergency.code} ${emergency.result.outcome}`,
    "3 EMERGENCY / STATE REQUIRES MANUAL RECOVERY",
  );
  check(
    "§10 … keeping BOTH the original failure and the compensation error",
    (emergency.result.originalFailures ?? [])
      .join(" ")
      .includes("allowed_mime_types") &&
      // storage-api surfaces the injected trigger's RAISE as its SQLSTATE
      String(emergency.result.compensationError ?? "").includes("P0001"),
    true,
  );
  check(
    "§10 … and telling the operator not to revert the runtime",
    emergency.out.includes("Do NOT revert the runtime"),
    true,
  );
  // manual recovery of the emergency the probe created
  setPublic(ATTACHMENTS, true);
  restoreAttachmentsControls();
  check(
    "§10 recovered: preflight GO",
    verdictRow("00_preflight.sql").last[2],
    "GO",
  );
  for (const [label, runResult] of [
    ["refusal", refused],
    ["compensation", dropped],
    ["emergency", emergency],
  ]) {
    check(
      `§10 the admin key never appears in the tool output (${label})`,
      runResult.leaked,
      false,
    );
  }
}

// ---------------------------------------------------------------------------
// STATE PRIVATE — Stage C, the target, through the Storage API
// ---------------------------------------------------------------------------
const dryRun = runStageTool("private", { apply: false });
check(
  "F-2 dry run: DRY-RUN / NO MUTATION, bucket still public",
  `${dryRun.code} ${dryRun.result.outcome} ${bucketPublic(ATTACHMENTS)}`,
  "0 DRY-RUN / NO MUTATION t",
);
const stageC = runStageTool("private");
if (stageC.result.outcome !== "PRIVATE / VERIFIED") {
  console.error(`[w8e] Stage C tool did not verify PRIVATE:\n${stageC.out}`);
  process.exit(2);
}
console.log(
  `\n=== STATE PRIVATE (attachments.public=${bucketPublic(ATTACHMENTS)}) — Stage C ===`,
);
check(
  "F-2 Stage C tool exits 0 with PRIVATE / VERIFIED",
  `${stageC.code} ${stageC.result.outcome}`,
  "0 PRIVATE / VERIFIED",
);
check(
  "F-2 the database says PRIVATE (not just the report)",
  bucketPublic(ATTACHMENTS),
  "f",
);
check(
  "F-2 file_size_limit and allowed_mime_types are byte-identical to before",
  bucketControls(ATTACHMENTS),
  ATTACHMENTS_CONTROLS,
);
check("F-2 branding untouched and public", bucketPublic(BRANDING), "t");
check(
  "F-2 the primed exact URL was re-probed and Storage denies it (HTTP 400/404 only — 3D LOW-1)",
  `${[400, 404].includes(stageC.result.attempts?.at(-1)?.status)} ${stageC.result.proof}`,
  "true denied",
);
check(
  "F-2 the admin key never appears in the tool output",
  stageC.leaked,
  false,
);
check(
  "F-2 read-only post-check 30_verify_attachments_private.sql says VERIFIED",
  verdictRow("30_verify_attachments_private.sql").last[2],
  "VERIFIED",
);
check(
  "F-2 the preflight now says STOP (flip already done)",
  verdictRow("00_preflight.sql").last[2],
  "STOP",
);
{
  const again = runStageTool("private");
  check(
    "F-2 an ALREADY private bucket is refused (the API would not purge): STOP / NO MUTATION",
    `${again.code} ${again.result.outcome}`,
    "1 STOP / NO MUTATION",
  );
}
for (const shape of Object.keys(RUNNER_SHAPES)) {
  if (shape === "psql stdin without ON_ERROR_STOP") continue;
  const lastLine =
    psqlShape(shape, operatorScript("30_verify_attachments_private.sql"))
      .out.trim()
      .split("\n")
      .at(-1) ?? "";
  check(
    `F-6 [${shape}] 30_verify_attachments_private.sql ends on VERIFIED while private`,
    lastLine.startsWith("99|== VERDICT ==|VERIFIED|"),
    true,
  );
}

// --- the closure itself: no anonymous route returns the bytes
check(
  "C anonymous former public URL yields NO bytes [T1 CLOSED]",
  await yieldsBytes(publicUrl(ATTACHMENTS, noteKey), noteBody),
  false,
);
check(
  "C /object/authenticated with the publishable key yields NO bytes",
  await yieldsBytes(authedUrl(ATTACHMENTS, noteKey), noteBody, {
    apikey: config.anon,
    Authorization: `Bearer ${config.anon}`,
  }),
  false,
);
check(
  "C /object/authenticated with no credentials yields NO bytes",
  await yieldsBytes(authedUrl(ATTACHMENTS, noteKey), noteBody),
  false,
);
check(
  "C anonymous client cannot derive a signed URL",
  await canSign(anon, ATTACHMENTS, noteKey),
  false,
);
check(
  "C anonymous client lists nothing",
  ((await anon.storage.from(ATTACHMENTS).list("", { limit: 5 })).data ?? [])
    .length,
  0,
);
check(
  "M-2 [Stage C] the persisted canonical src yields NO bytes anonymously",
  await yieldsBytes(canonicalSrc, repBody),
  false,
);
check(
  "M-2 [Stage C] the W8-E runtime path (key -> signed URL) still yields bytes",
  await signedYieldsBytes(viewer.client, ATTACHMENTS, repKey, repBody),
  true,
);

// --- the app must still work for everyone who is entitled to the content
check(
  "C active viewer still opens the attachment through a signed URL",
  await signedYieldsBytes(viewer.client, ATTACHMENTS, noteKey, noteBody),
  true,
);
check(
  "C active office still opens the attachment through a signed URL",
  await signedYieldsBytes(office.client, ATTACHMENTS, noteKey, noteBody),
  true,
);
check(
  "C active admin still opens the attachment through a signed URL",
  await signedYieldsBytes(admin.client, ATTACHMENTS, noteKey, noteBody),
  true,
);
check(
  "C active office can still upload",
  await (async () => {
    const key = `w8e-upload-${randomUUID()}.txt`;
    const { error } = await office.client.storage
      .from(ATTACHMENTS)
      .upload(key, new Blob(["x"], { type: "text/plain" }));
    return !error;
  })(),
  true,
);

// --- a deactivated identity holding a still-valid JWT
psql(`select nora_private.apply_sales_role_change(
        (select id from public.sales where user_id = '${disabled.userId}'), 'office', true);`);
check(
  "C deactivated identity with a live JWT cannot derive a fresh signed URL",
  await canSign(disabled.client, ATTACHMENTS, noteKey),
  false,
);
// U-9: these two present the deactivated identity's OWN still-valid JWT, so
// they test that identity — not a repeat of the anonymous checks above. The
// /object/authenticated route is decided by the `is_active_user()` policy
// alone and fails independently if that check ever regresses.
const disabledToken = (await disabled.client.auth.getSession()).data.session
  ?.access_token;
const asDisabled = {
  apikey: config.anon,
  Authorization: `Bearer ${disabledToken}`,
};
check(
  "C deactivated identity still holds a live JWT (precondition of the next checks)",
  typeof disabledToken === "string" && disabledToken.length > 0,
  true,
);
check(
  "C deactivated identity with a live JWT cannot read the public route either",
  await yieldsBytes(publicUrl(ATTACHMENTS, noteKey), noteBody, asDisabled),
  false,
);
check(
  "C deactivated identity with a live JWT cannot read /object/authenticated",
  await yieldsBytes(authedUrl(ATTACHMENTS, noteKey), noteBody, asDisabled),
  false,
);

// --- capability lifetime, stated honestly
{
  const { data } = await office.client.storage
    .from(ATTACHMENTS)
    .createSignedUrl(noteKey, 1);
  const url = new URL(data.signedUrl);
  const target = `${config.url}${url.pathname}${url.search}`;
  check(
    "C a freshly issued signed URL yields bytes",
    await yieldsBytes(target, noteBody),
    true,
  );
  await new Promise((resolve) => setTimeout(resolve, 2500));
  check(
    "C the same signed URL yields NO bytes once expired",
    await yieldsBytes(target, noteBody),
    false,
  );
}
// F-35: the expiry is the SIGNER's choice. Nora asks for 900 s; an actor the
// policy allows to sign may ask the Storage API for far more. Recorded so the
// documentation can never again claim a platform-wide 900 s bound.
{
  const { data, error } = await office.client.storage
    .from(ATTACHMENTS)
    .createSignedUrl(noteKey, 60 * 60 * 24 * 365);
  const token = data?.signedUrl
    ? new URL(data.signedUrl).searchParams.get("token")
    : null;
  const claims = token
    ? JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"))
    : {};
  check(
    "F-35 an authorized signer can choose a one-year expiry directly (residual, documented)",
    !error && claims.exp - claims.iat === 60 * 60 * 24 * 365,
    true,
  );
}

// --- branding is unaffected by the flip, which is the point of splitting it
console.log("\n--- branding bucket, attachments still PRIVATE ---");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const PNG_SHA256 = sha256(PNG_BYTES);
/** F-1: the exact public branding bytes, anonymously — no session, no key. */
const brandBytes = async (url) => {
  const response = await fetch(url);
  if (!response.ok) return false;
  return sha256(new Uint8Array(await response.arrayBuffer())) === PNG_SHA256;
};
check(
  "C branding: the exact public URL returns the exact bytes with NO session and NO key",
  await brandBytes(publicUrl(BRANDING, brandKey)),
  true,
);
check(
  "C anonymous client cannot WRITE to branding",
  await (async () => {
    const { error } = await anon.storage
      .from(BRANDING)
      .upload(
        `w8e-anon-${randomUUID()}.png`,
        new Blob([PNG_BYTES], { type: "image/png" }),
      );
    return !error;
  })(),
  false,
);
check(
  "C viewer cannot WRITE to branding",
  await (async () => {
    const { error } = await viewer.client.storage
      .from(BRANDING)
      .upload(
        `w8e-viewer-${randomUUID()}.png`,
        new Blob([PNG_BYTES], { type: "image/png" }),
      );
    return !error;
  })(),
  false,
);
check(
  "C active office CAN write to branding (admin logo upload keeps working)",
  await (async () => {
    const { error } = await office.client.storage
      .from(BRANDING)
      .upload(
        `w8e-office-${randomUUID()}.png`,
        new Blob([PNG_BYTES], { type: "image/png" }),
      );
    return !error;
  })(),
  true,
);
check(
  "C deactivated identity cannot write to branding",
  await (async () => {
    const { error } = await disabled.client.storage
      .from(BRANDING)
      .upload(
        `w8e-gone-${randomUUID()}.png`,
        new Blob([PNG_BYTES], { type: "image/png" }),
      );
    return !error;
  })(),
  false,
);
// The branding bucket is for brand marks, not documents. Its MIME allowlist is
// what stops it becoming a public drop box for business content.
check(
  "C a PDF cannot be uploaded to branding (it is not a brand mark)",
  await (async () => {
    const { error } = await office.client.storage
      .from(BRANDING)
      .upload(
        `w8e-doc-${randomUUID()}.pdf`,
        new Blob(["%PDF-1.4"], { type: "application/pdf" }),
      );
    return !error;
  })(),
  false,
);
check(
  "C an SVG cannot be uploaded to branding (active document on a public origin)",
  await (async () => {
    const { error } = await office.client.storage
      .from(BRANDING)
      .upload(
        `w8e-x-${randomUUID()}.svg`,
        new Blob(["<svg/>"], { type: "image/svg+xml" }),
      );
    return !error;
  })(),
  false,
);

// --- U-7: the SQL rollback FALLBACK never reports a rollback that did not happen
console.log("\n--- U-7 SQL rollback fallback across runner shapes ---");
{
  const script = operatorScript("20_set_attachments_public.sql");
  injectKeepPrivate();
  try {
    const shapes = Object.fromEntries(
      Object.keys(RUNNER_SHAPES).map((shape) => [
        shape,
        psqlShape(shape, script),
      ]),
    );
    for (const [shape, result] of Object.entries(shapes)) {
      check(
        `U-7 [${shape}] reports NORA_W8E_ATTACHMENTS_STILL_PRIVATE`,
        /NORA_W8E_ATTACHMENTS_STILL_PRIVATE/.test(result.err),
        true,
      );
      check(
        `U-7 [${shape}] never reports PUBLIC —`,
        result.out.includes("PUBLIC —"),
        false,
      );
    }
    const stop = shapes["psql stdin + ON_ERROR_STOP"];
    check(
      "U-7 [psql stdin + ON_ERROR_STOP] exits non-zero at the IN-BLOCK postcondition",
      stop.code !== 0 && /still not public after the update/.test(stop.err),
      true,
    );
    // A runner that ignores errors exits 0 — which is why the runbook forbids
    // it. Even there both postconditions fire and the last row says FAILURE.
    const lax = shapes["psql stdin without ON_ERROR_STOP"];
    check(
      "U-7 [psql stdin without ON_ERROR_STOP] both postconditions fire as ERRORs",
      (
        lax.err.match(
          /ERROR:[^\n]*\n(?:[^\n]*\n)*?DETAIL:\s+NORA_W8E_ATTACHMENTS_STILL_PRIVATE/g,
        ) ?? []
      ).length,
      2,
    );
    check(
      "U-7 [psql stdin without ON_ERROR_STOP] last row is an explicit FAILURE verdict",
      /^attachments\|f\|FAILURE — /m.test(lax.out.trim().split("\n").at(-1)),
      true,
    );
    for (const shape of [
      "one message (psql -c)",
      "one message, last result only (MCP-like)",
    ]) {
      check(
        `U-7 [${shape}] returns an error and no result row at all`,
        shapes[shape].code !== 0 && !shapes[shape].out.includes("|"),
        true,
      );
    }
    check(
      "U-7 the bucket is still PRIVATE — nothing claimed a rollback that did not happen",
      bucketPublic(ATTACHMENTS),
      "f",
    );
  } finally {
    removeInjections();
  }
}

// --- F-34: a deferred constraint trigger cannot fake a PUBLIC verdict ------
console.log("\n--- F-34 SQL rollback fallback vs a deferred revert ---");
{
  const script = operatorScript("20_set_attachments_public.sql");
  injectTrigger("deferred_revert");
  try {
    for (const shape of Object.keys(RUNNER_SHAPES)) {
      if (shape === "psql stdin without ON_ERROR_STOP") continue;
      const result = psqlShape(shape, script);
      check(
        `F-34 [${shape}] a revert at COMMIT is reported STILL_PRIVATE, never PUBLIC —`,
        /NORA_W8E_ATTACHMENTS_STILL_PRIVATE/.test(result.err) &&
          !result.out.includes("PUBLIC —") &&
          result.code !== 0,
        true,
      );
      check(
        `F-34 [${shape}] … and the bucket is still private`,
        bucketPublic(ATTACHMENTS),
        "f",
      );
    }
  } finally {
    removeInjections();
  }
}

// ---------------------------------------------------------------------------
// ROLLBACK A — the SQL fallback (Storage API unavailable)
// ---------------------------------------------------------------------------
const rollback = psqlTry(operatorScript("20_set_attachments_public.sql"));
if (rollback.error) {
  console.error(`[w8e] rollback fallback failed: ${rollback.error}`);
  process.exit(2);
}
console.log(
  `\n=== ROLLBACK A: SQL fallback (attachments.public=${bucketPublic(ATTACHMENTS)}) ===`,
);
check(
  "rollback fallback reports PUBLIC",
  (rollback.rows.find((row) => row[0] === "attachments")?.[2] ?? "").startsWith(
    "PUBLIC —",
  ),
  true,
);
check(
  "rollback fallback end state really is public (not just reported)",
  bucketPublic(ATTACHMENTS),
  "t",
);
check(
  "rollback fallback leaves the controls untouched",
  bucketControls(ATTACHMENTS),
  ATTACHMENTS_CONTROLS,
);

// ---------------------------------------------------------------------------
// ROLLBACK B — the canonical path: the Storage API tool
// ---------------------------------------------------------------------------
{
  const reflip = runStageTool("private");
  check(
    "F-2 a second Stage C after a rollback is again PRIVATE / VERIFIED (the API path purges again)",
    `${reflip.code} ${reflip.result.outcome}`,
    "0 PRIVATE / VERIFIED",
  );
  const back = runStageTool("public");
  console.log(
    `\n=== ROLLBACK B: Storage API (attachments.public=${bucketPublic(ATTACHMENTS)}) ===`,
  );
  check(
    "rollback via the tool is PUBLIC / VERIFIED (exit 0)",
    `${back.code} ${back.result.outcome}`,
    "0 PUBLIC / VERIFIED",
  );
  check(
    "rollback via the tool: the database says public",
    bucketPublic(ATTACHMENTS),
    "t",
  );
  check(
    "rollback via the tool: the probe URL served bytes before it said so",
    back.result.probe?.status,
    200,
  );
  check(
    "rollback via the tool leaves the controls untouched",
    bucketControls(ATTACHMENTS),
    ATTACHMENTS_CONTROLS,
  );
  const idempotent = runStageTool("public");
  check(
    "rollback via the tool on an already public bucket changes nothing and says so",
    `${idempotent.code} ${idempotent.result.outcome} ${idempotent.result.mutation}`,
    "0 PUBLIC / VERIFIED none — already public",
  );
  check(
    "rollback: the admin key never appears in the tool output",
    back.leaked || reflip.leaked,
    false,
  );
}

check(
  "M-2 [rollback] the persisted canonical src yields bytes again (old runtime route)",
  await yieldsBytes(canonicalSrc, repBody),
  true,
);
if (repNoteId != null) {
  // The flips never touch data: what the old runtime will read back is
  // exactly what the W8-E runtime wrote.
  const readBack = await office.client
    .from("contact_notes")
    .select("attachments")
    .eq("id", repNoteId)
    .single();
  const element = readBack.data?.attachments?.[0] ?? {};
  check(
    "M-2 [rollback] the persisted element is unchanged: path = key",
    element.path,
    repKey,
  );
  check(
    "M-2 [rollback] the persisted element is unchanged: src = canonical URL",
    element.src,
    canonicalSrc,
  );
  if (process.env.NORA_W8E_REPRESENTATION_OUT) {
    writeFileSync(
      process.env.NORA_W8E_REPRESENTATION_OUT,
      JSON.stringify(
        { attachments: readBack.data.attachments, body: repBody },
        null,
        2,
      ),
    );
    console.log(
      `[w8e] persisted representation written to ${process.env.NORA_W8E_REPRESENTATION_OUT}`,
    );
  }
}
check(
  "rollback restores the pre-W8-E public read path for the old runtime",
  await yieldsBytes(publicUrl(ATTACHMENTS, noteKey), noteBody),
  true,
);
check(
  "rollback leaves branding untouched and still public (exact bytes)",
  await brandBytes(publicUrl(BRANDING, brandKey)),
  true,
);
check(
  "the preflight is GO again after the rollback (the stack is back at the pre-C target)",
  verdictRow("00_preflight.sql").last[2],
  "GO",
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
console.log(
  `\n=== ${results.length - failed.length}/${results.length} PASS${skipped.length ? `, ${skipped.length} SKIPPED — not a full run` : ""} ===`,
);
for (const skip of skipped) console.log(`  skipped: ${skip}`);
if (failed.length) {
  console.log("failed:");
  for (const f of failed) console.log(`  - ${f.label}`);
}
process.exit(failed.length ? 1 : 0);
