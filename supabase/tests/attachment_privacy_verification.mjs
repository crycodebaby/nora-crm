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
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

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

/** The part of an operator script from the line holding `marker` to its end. */
const scriptFrom = (script, marker) => {
  const at = script.indexOf(marker);
  if (at < 0) throw new Error(`operator script has no section "${marker}"`);
  return script.slice(script.lastIndexOf("\n", at) + 1);
};

const verdictOf = (rows, bucket) =>
  rows.find((row) => row[0] === bucket)?.[3] ?? "<missing>";

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
// `finally` whatever happens (U-9).
const INJECTED_POLICY = `w8e_verify_${run}_foreign_read`;
const INJECTED_TRIGGER = `w8e_verify_${run}_keep_private`;
const INJECTED_FUNCTION = `public.w8e_verify_${run}_keep_private`;

/** Makes every UPDATE of the attachments bucket row keep it PRIVATE. */
const injectKeepPrivate = () =>
  psql(`create function ${INJECTED_FUNCTION}() returns trigger
          language plpgsql as $f$
        begin
            if new.id = 'attachments' then
                new.public := false;
            end if;
            return new;
        end;
        $f$;
        create trigger ${INJECTED_TRIGGER}
            before update on storage.buckets
            for each row execute function ${INJECTED_FUNCTION}();`);

const removeInjections = () =>
  psql(`drop trigger if exists ${INJECTED_TRIGGER} on storage.buckets;
        drop function if exists ${INJECTED_FUNCTION}();
        drop policy if exists ${INJECTED_POLICY} on storage.objects;`);

const bucketPublic = (bucket) =>
  psql(`select public from storage.buckets where id = '${bucket}';`);

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
  step("remove injected policy/trigger/function", () => {
    removeInjections();
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
      console.error(`[w8e] unexpected grammar error: ${error}`);
      process.exitCode = 1;
    }
    return false;
  }
  return rows[0]?.[1] === "1";
};

// ---------------------------------------------------------------------------
// STATE PUBLIC — Stage A / Stage B
// ---------------------------------------------------------------------------
console.log(
  `\n=== STATE PUBLIC (attachments.public=${setPublic(ATTACHMENTS, true)}) — Stage A/B ===`,
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

// --- L-2: the Stage C verdict logic, observed while attachments is PUBLIC ---
// Simulates "the flip did not take effect": the postcondition must be a hard
// error and the report must call it a failure — for attachments only.
{
  const script = operatorScript("10_set_attachments_private.sql");
  const post = psqlTry(scriptFrom(script, "-- POSTCONDITION"));
  check(
    "L-2 Stage C postcondition is a HARD error while attachments is still public",
    /NORA_W8E_ATTACHMENTS_STILL_PUBLIC/.test(post.error ?? ""),
    true,
  );
  const report = psqlTry(
    scriptFrom(script, "-- The invocation returns its own result."),
  );
  check(
    "L-2 Stage C report calls a still-public attachments bucket a FAILURE",
    verdictOf(report.rows ?? [], "attachments").startsWith("FAILURE"),
    true,
  );
  check(
    "L-2 Stage C report calls public branding EXPECTED BY DESIGN",
    verdictOf(report.rows ?? [], "branding").startsWith(
      "PUBLIC — expected by design",
    ),
    true,
  );
}

// --- U-6: Stage C itself refuses a foreign policy, before any mutation -----
// A permissive policy is OR-ed with the W8-B ones: with it installed, a
// "private" bucket stays readable through the API. The gate must live in the
// mutating script, not only in the preflight an operator may skip.
console.log(
  "\n--- U-6 unknown storage.objects policy (attachments PUBLIC) ---",
);
{
  check(
    "U-6 precondition: no foreign policy on storage.objects",
    unknownPolicyCount(),
    "0",
  );
  psql(`create policy ${INJECTED_POLICY} on storage.objects
          for select to anon using (bucket_id = 'attachments');`);
  const preflight = psqlTry(operatorScript("00_preflight.sql"));
  check(
    "U-6 preflight verdict is STOP while a foreign policy exists",
    (preflight.rows ?? []).some(
      (row) => row[0] === "== VERDICT ==" && row[1] === "STOP",
    ),
    true,
  );
  const refused = psqlTry(operatorScript("10_set_attachments_private.sql"));
  check(
    "U-6 Stage C REFUSES with NORA_W8E_UNKNOWN_STORAGE_POLICY",
    /NORA_W8E_UNKNOWN_STORAGE_POLICY/.test(refused.error ?? ""),
    true,
  );
  check(
    "U-6 Stage C refusal names the foreign policy",
    (refused.error ?? "").includes(INJECTED_POLICY),
    true,
  );
  check(
    "U-6 attachments.public is UNCHANGED after the refusal",
    bucketPublic(ATTACHMENTS),
    "t",
  );
  check(
    "U-6 the foreign policy was neither dropped nor altered by Stage C",
    psql(`select count(*) from pg_policies
           where schemaname = 'storage' and tablename = 'objects'
             and policyname = '${INJECTED_POLICY}' and cmd = 'SELECT'
             and roles = '{anon}';`),
    "1",
  );
  removeInjections();
  check(
    "U-6 cleanup: the injected policy is gone again",
    unknownPolicyCount(),
    "0",
  );
}

// --- U-7: the rollback refuses a missing bucket -----------------------------
// Run on a session-local stand-in for storage.buckets with NO attachments row,
// so the real bucket is never touched.
{
  const onTempTable = operatorScript("20_set_attachments_public.sql").replace(
    /storage\.buckets/g,
    "pg_temp.w8e_buckets",
  );
  const setup =
    "create temp table w8e_buckets (id text primary key, public boolean not null);\n";
  const stop = psqlShape("psql stdin + ON_ERROR_STOP", setup + onTempTable);
  check(
    "U-7 rollback: a missing attachments bucket is a HARD error (NORA_W8E_ATTACHMENTS_BUCKET_MISSING)",
    stop.code !== 0 && /NORA_W8E_ATTACHMENTS_BUCKET_MISSING/.test(stop.err),
    true,
  );
  const lax = psqlShape(
    "psql stdin without ON_ERROR_STOP",
    setup + onTempTable,
  );
  check(
    "U-7 rollback: a missing bucket never reports PUBLIC, even to a runner that ignores errors",
    /NORA_W8E_ATTACHMENTS_BUCKET_MISSING/.test(lax.err) &&
      !lax.out.includes("PUBLIC —"),
    true,
  );
}

// ---------------------------------------------------------------------------
// STATE PRIVATE — Stage C, the target
// ---------------------------------------------------------------------------
// Stage C runs as the REAL operator script, gates and all.
const stageC = psqlTry(operatorScript("10_set_attachments_private.sql"));
if (stageC.error) {
  console.error(`[w8e] Stage C operator script refused: ${stageC.error}`);
  process.exit(2);
}
console.log(
  `\n=== STATE PRIVATE (attachments.public=${psql(
    "select public from storage.buckets where id = 'attachments';",
  )}) — Stage C ===`,
);
check(
  "L-2 Stage C reports attachments PRIVATE as the expected target state",
  verdictOf(stageC.rows, "attachments").startsWith(
    "PRIVATE — expected target state",
  ),
  true,
);
check(
  "L-2 Stage C reports branding PUBLIC as expected by design",
  verdictOf(stageC.rows, "branding").startsWith("PUBLIC — expected by design"),
  true,
);
check(
  "L-2 Stage C output never says STILL PUBLIC for a correct end state",
  stageC.rows.some((row) => row.join("|").includes("STILL PUBLIC")),
  false,
);

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

// --- branding is unaffected by the flip, which is the point of splitting it
console.log("\n--- branding bucket, attachments still PRIVATE ---");
const brandBytes = async (url) => {
  const response = await fetch(url);
  if (!response.ok) return false;
  return (
    new Uint8Array(await response.arrayBuffer()).length === PNG_BYTES.length
  );
};
check(
  "C branding is readable with NO session at all (pre-auth logo)",
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

// --- U-1: Stage C's branding postcondition, on its own ----------------------
// Gate 1 already refuses a non-public branding bucket BEFORE the flip, so the
// full script can never reach this branch on a sane stack. Asserting the
// section directly is what makes deleting it fail this suite.
{
  const script = operatorScript("10_set_attachments_private.sql");
  setPublic(BRANDING, false);
  try {
    const post = psqlTry(scriptFrom(script, "-- POSTCONDITION"));
    check(
      "U-1 Stage C postcondition is a HARD error when branding is not public",
      /NORA_W8E_BRANDING_NOT_PUBLIC/.test(post.error ?? ""),
      true,
    );
    const report = psqlTry(
      scriptFrom(script, "-- The invocation returns its own result."),
    );
    check(
      "U-1 Stage C report calls a non-public branding bucket a FAILURE",
      verdictOf(report.rows ?? [], "branding").startsWith("FAILURE"),
      true,
    );
  } finally {
    setPublic(BRANDING, true);
  }
  check(
    "U-1 branding is public again after the postcondition probe",
    bucketPublic(BRANDING),
    "t",
  );
}

// --- U-7: a rollback that does not take effect is a failure in EVERY runner --
// An injected trigger keeps the bucket private whatever the UPDATE says. The
// rollback must then never look like success: not in the exit code where the
// runner honours errors, and never as a `PUBLIC —` row where it does not.
console.log("\n--- U-7 rollback postcondition across runner shapes ---");
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
      "U-7 [psql stdin without ON_ERROR_STOP] both postconditions fire",
      (lax.err.match(/NORA_W8E_ATTACHMENTS_STILL_PRIVATE/g) ?? []).length,
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

// ---------------------------------------------------------------------------
// ROLLBACK — public again
// ---------------------------------------------------------------------------
const rollback = psqlTry(operatorScript("20_set_attachments_public.sql"));
if (rollback.error) {
  console.error(`[w8e] rollback operator script failed: ${rollback.error}`);
  process.exit(2);
}
console.log(
  `\n=== ROLLBACK (attachments.public=${psql(
    "select public from storage.buckets where id = 'attachments';",
  )}) ===`,
);
check(
  "rollback operator script reports PUBLIC",
  (rollback.rows.find((row) => row[0] === "attachments")?.[2] ?? "").startsWith(
    "PUBLIC —",
  ),
  true,
);
check(
  "rollback end state really is public (not just reported)",
  bucketPublic(ATTACHMENTS),
  "t",
);
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
  "rollback leaves branding untouched and still public",
  await brandBytes(publicUrl(BRANDING, brandKey)),
  true,
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
console.log(
  `\n=== ${results.length - failed.length}/${results.length} PASS ===`,
);
if (failed.length) {
  console.log("failed:");
  for (const f of failed) console.log(`  - ${f.label}`);
}
process.exit(failed.length ? 1 : 0);
