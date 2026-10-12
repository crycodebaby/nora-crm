#!/usr/bin/env node
/**
 * W8-E Stage C — set the visibility of the `attachments` bucket THROUGH THE
 * STORAGE API. MUTATES when run with `--apply`. OPERATOR-ONLY.
 *
 * This file is the ONE authority for the Stage C privacy flip (and the
 * canonical rollback). There is deliberately no SQL file that flips the
 * bucket to private any more. The decision logic lives in
 * `lib/privacy_control.mjs` (driven by unit tests with fakes and by the
 * privacy verifier against a real local Storage API); this file only wires
 * arguments, the credential boundary, real clients and the probe process.
 *
 * WHY THE STORAGE API AND NOT SQL (Alpha Storage 3C F-2)
 *   storage-api purges the bucket's CDN cache when — and only when — a bucket
 *   goes from public to private through its own `updateBucket` path (upstream
 *   supabase/storage PR #1273; storage.ts: `data.public === false &&
 *   previous.public === true` -> PurgeCdnCache). A direct
 *   `update storage.buckets set public = false` changes Postgres and never
 *   reaches that code, so on Pro and above (Smart CDN) an object that was
 *   fetched publicly before Stage C can stay anonymously available from an
 *   edge cache. The purge is dispatched ASYNCHRONOUSLY (a queued job with
 *   retries) and a failed dispatch is only logged server-side — the API still
 *   answers "Successfully updated". The only evidence that invalidation
 *   reached the edge is therefore the anonymous exact-URL probe this tool
 *   runs after the flip (below). It proves the PoP the operator's client hits;
 *   it does not prove every edge location worldwide.
 *
 *   Consequence: if the bucket is ALREADY private when this tool starts
 *   (e.g. someone ran a direct SQL update), the API sees `previous.public =
 *   false` and never purges. The tool refuses that state instead of calling it
 *   done.
 *
 * WHAT `private --apply` WRITES
 *   exactly one bucket row, through `PUT /storage/v1/bucket/attachments`:
 *   `public: false`, with `file_size_limit` and `allowed_mime_types` echoed
 *   verbatim from the configuration read immediately before. Nothing else:
 *   no policy, no object, no branding, no `public.attachments`, no note JSON.
 *
 * WHAT IT PROVES, IN ORDER
 *   1. target, credential shape, bucket existence and state (read); no
 *      branding reference still points into `attachments` (read-only
 *      PostgREST query — Stage A complete);
 *   2. BEFORE mutating, anonymously with the publishable key: LIST of
 *      `attachments` returns nothing and signing is refused (RLS), with a
 *      positive control that the probe object exists — a failure is a STOP
 *      with no mutation;
 *   3. primes the EXACT public URL of one representative object anonymously
 *      (200, sha256, length, cache headers) — deliberately warming the CDN;
 *   4. flips through the Storage API;
 *   5. IMMEDIATE postconditions: `attachments` private; every other field of
 *      the bucket identical to step 1 (only `public` and `updated_at` may
 *      change); `branding` unchanged and public; anonymous LIST / signing /
 *      `/object/authenticated` (publishable key) / `/object/<bucket>/<key>`
 *      yield nothing. Any failure -> COMPENSATION (below);
 *   6. CDN proof: the EXACT primed URL — same path, no query string — from a
 *      FRESH process per attempt, polled until it answers HTTP 400 or 404 or
 *      the propagation window ends. ONLY 400/404 is proof (Alpha Storage 3D
 *      LOW-1): a 2xx is a still-served copy, and a transport error, 3xx, 401,
 *      403, 429, 5xx or any other answer is INCONCLUSIVE — both end in
 *      `CDN PROOF PENDING` (exit 4), never in `PRIVATE / VERIFIED`.
 *
 * COMPENSATION (Alpha Storage 3C F-7 / brief §10)
 *   The API mutation is not in a transaction with anything else. If it took
 *   effect but a critical postcondition fails, the tool puts the bucket back
 *   to `public: true` with the ORIGINAL controls through the same API,
 *   verifies that, and reports BOTH the original failure and the
 *   compensation. There are exactly three end states after a mutation:
 *
 *     PRIVATE / VERIFIED                          exit 0 (4 if the CDN proof is pending)
 *     PUBLIC / COMPENSATED                        exit 2
 *     EMERGENCY / STATE REQUIRES MANUAL RECOVERY  exit 3
 *
 *   and one before it: STOP / NO MUTATION (exit 1). A failed CDN proof is NOT
 *   compensated: the bucket is verifiably private, and making it public again
 *   would expose every object instead of one cached copy.
 *
 * CREDENTIAL BOUNDARY
 *   `NORA_STORAGE_ADMIN_KEY` is a privileged Storage admin credential (a
 *   secret key `sb_secret_…` or a legacy `service_role` JWT). It exists ONLY
 *   in the operator's shell for the duration of this command. It never goes
 *   into a Vite env, a bundle, a browser, an Edge Function, a database row, a
 *   log or a document. This tool refuses a publishable/anon credential,
 *   refuses a key that also sits in a `VITE_*` variable, never prints the key
 *   (every line is redacted), and never passes it to its probe processes —
 *   those are anonymous by construction.
 *
 * USAGE (runbook: docs/nora/21-agent-runbooks.md Section 17)
 *   SUPABASE_URL=https://<ref>.supabase.co     target project
 *   SUPABASE_ANON_KEY=<publishable key>        anonymous probes only
 *   NORA_STORAGE_ADMIN_KEY=<secret key>        operator-only, never persisted
 *
 *   node 10_set_attachments_privacy.mjs private --target=<host> --probe-url=<exact public URL>            # dry run
 *   node 10_set_attachments_privacy.mjs private --target=<host> --probe-url=<exact public URL> --apply    # Stage C
 *   node 10_set_attachments_privacy.mjs public  --target=<host> --probe-url=<exact public URL> --apply    # rollback
 *   node 10_set_attachments_privacy.mjs probe   --url=<url> [--auth=publishable]                           # one anonymous GET
 *
 *   --target must equal the host of SUPABASE_URL (e.g. `<ref>.supabase.co`):
 *   a typed confirmation that the shell points where the operator thinks.
 *   --cdn-window-seconds (default 300) / --cdn-interval-seconds (default 10)
 *   bound the propagation wait.
 *
 * The LAST line of every run is machine-readable:
 *   NORA_W8E_RESULT {"outcome": "...", ...}
 *
 * Exit 0 success · 1 STOP / NO MUTATION · 2 PUBLIC / COMPENSATED ·
 * 3 EMERGENCY · 4 verified state, anonymous URL proof pending · 64 usage.
 */

import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  EXIT,
  OUTCOME,
  classifyAdminKey,
  classifyExactUrlProbe,
  parseProbeUrl,
  runSetPrivate,
  runSetPublic,
  viteVariablesHolding,
} from "./lib/privacy_control.mjs";

const [command, ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(
  rest
    .filter((arg) => arg.startsWith("--"))
    .map((arg) => {
      const [name, ...value] = arg.slice(2).split("=");
      return [name, value.length ? value.join("=") : true];
    }),
);

// ---------------------------------------------------------------------------
// `probe` — ONE anonymous GET in THIS (fresh) process. It never holds the
// admin key: the parent strips it from the environment before spawning. No
// cache-busting header, no query string: it asks exactly what a browser of
// the old runtime asked.
// ---------------------------------------------------------------------------
if (command === "probe") {
  const url = typeof flags.url === "string" ? flags.url : "";
  const headers = {};
  if (flags.auth === "publishable") {
    const key = process.env.SUPABASE_ANON_KEY ?? "";
    headers.apikey = key;
    headers.Authorization = `Bearer ${key}`;
  }
  const probed = {
    url,
    auth: flags.auth === "publishable" ? "publishable" : "none",
  };
  try {
    const response = await fetch(url, { headers, redirect: "manual" });
    const body = new Uint8Array(await response.arrayBuffer());
    probed.status = response.status;
    probed.bytes = body.length;
    probed.sha256 = createHash("sha256").update(body).digest("hex");
    probed.headers = Object.fromEntries(
      [
        "cf-cache-status",
        "age",
        "cache-control",
        "cf-ray",
        "etag",
        "last-modified",
        "content-type",
        "content-length",
      ]
        .map((name) => [name, response.headers.get(name)])
        .filter(([, value]) => value != null),
    );
  } catch (error) {
    probed.error = String(error?.message ?? error);
  }
  // For a Stage C follow-up of the exact URL only `denied` (HTTP 400/404) is
  // proof; `inconclusive` is never privacy (docs/nora/21 Section 17).
  probed.classification = classifyExactUrlProbe(probed);
  console.log(JSON.stringify(probed));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Output — every line is redacted; the machine-readable result line is last
// ---------------------------------------------------------------------------
const ADMIN_KEY = process.env.NORA_STORAGE_ADMIN_KEY ?? "";
const redact = (text) =>
  ADMIN_KEY ? String(text).split(ADMIN_KEY).join("<redacted>") : String(text);
const say = (line = "") => console.log(redact(line));

const finish = ({ outcome, exitCode, details = {}, guidance = [] }) => {
  say("");
  say("=".repeat(72));
  say(`RESULT: ${outcome}`);
  for (const line of guidance) say(`  ${line}`);
  say("=".repeat(72));
  say(`NORA_W8E_RESULT ${JSON.stringify({ outcome, exitCode, ...details })}`);
  process.exit(exitCode);
};

const usage = (message) => {
  say(`[w8e-c] ${message}`);
  say(
    "[w8e-c] usage: 10_set_attachments_privacy.mjs <private|public> --target=<host> --probe-url=<exact public URL> [--apply]",
  );
  finish({
    outcome: OUTCOME.stop,
    exitCode: EXIT.usage,
    details: { reason: message },
  });
};

if (command !== "private" && command !== "public") {
  usage(`unknown command "${command ?? ""}"`);
}

// ---------------------------------------------------------------------------
// Target and credential boundary
// ---------------------------------------------------------------------------
const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";
if (!SUPABASE_URL) usage("missing SUPABASE_URL");
if (!ANON_KEY) usage("missing SUPABASE_ANON_KEY (publishable key)");
if (!ADMIN_KEY) usage("missing NORA_STORAGE_ADMIN_KEY (operator-only)");

let targetHost;
try {
  targetHost = new URL(SUPABASE_URL).host;
} catch {
  usage("SUPABASE_URL is not a URL");
}
if (flags.target !== targetHost) {
  usage(
    `--target must equal the host of SUPABASE_URL (${targetHost}); got "${typeof flags.target === "string" ? flags.target : ""}"`,
  );
}
const credential = classifyAdminKey(ADMIN_KEY, ANON_KEY);
if (credential.refused) {
  usage(
    `NORA_STORAGE_ADMIN_KEY refused: ${credential.refused}. A privileged Storage admin credential is required.`,
  );
}
const leaked = viteVariablesHolding(process.env, ADMIN_KEY);
if (leaked.length) {
  usage(
    `the privileged key is also present in ${leaked.join(", ")} — a privileged credential must never be in a Vite env`,
  );
}

const probeUrl =
  typeof flags["probe-url"] === "string" ? flags["probe-url"] : "";
const parsed = parseProbeUrl(SUPABASE_URL, probeUrl);
if (parsed.error) usage(parsed.error);

const seconds = (name, fallback) => {
  const value = Number(flags[name] ?? fallback);
  if (!Number.isFinite(value) || value < 0) usage(`--${name} must be a number`);
  return value;
};

say(`[w8e-c] target ${targetHost} · credential: ${credential.kind} (redacted)`);

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------
const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false },
};

/**
 * One anonymous request from a FRESH node process; never sees the admin key.
 * The child gets this process's Node flags (normally none) so it resolves the
 * target exactly as this process does.
 */
const probe = (url, auth = "none") => {
  const env = { ...process.env };
  delete env.NORA_STORAGE_ADMIN_KEY;
  const args = [
    ...process.execArgv,
    fileURLToPath(import.meta.url),
    "probe",
    `--url=${url}`,
  ];
  if (auth === "publishable") args.push("--auth=publishable");
  const child = spawnSync(process.execPath, args, { env, encoding: "utf8" });
  const line = (child.stdout ?? "").trim().split("\n").at(-1) ?? "";
  try {
    return JSON.parse(line);
  } catch {
    return {
      url,
      error: `probe process failed: ${(child.stderr ?? "").trim()}`,
    };
  }
};

const adminClient = createClient(SUPABASE_URL, ADMIN_KEY, clientOptions);
const io = {
  admin: adminClient.storage,
  anon: createClient(SUPABASE_URL, ANON_KEY, clientOptions).storage,
  db: adminClient,
  probe,
  say,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  supabaseUrl: SUPABASE_URL,
  probeUrl,
  probeKey: parsed.key,
  apply: flags.apply === true,
  cdnWindowS: seconds("cdn-window-seconds", 300),
  cdnIntervalS: Math.max(1, seconds("cdn-interval-seconds", 10)),
};

finish(command === "public" ? await runSetPublic(io) : await runSetPrivate(io));
