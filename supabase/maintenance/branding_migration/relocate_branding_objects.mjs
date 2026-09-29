#!/usr/bin/env node
/**
 * W8-E Stage A — relocate the approved BRANDING objects out of `attachments`
 * into the public `branding` bucket. MUTATES when run with `--apply`.
 *
 * WHAT THIS WRITES
 *   * new objects in the `branding` bucket (copies);
 *   * `public.configuration.config.lightModeLogo` / `.darkModeLogo`;
 *   * `public.companies.logo` (`src` and `path`).
 *
 * WHAT THIS NEVER TOUCHES
 *   * the source objects — nothing is deleted or moved. Physical cleanup of
 *     the now-unreferenced originals stays S2B. The originals stay where they
 *     are: publicly readable through Stages A and B, and after Stage C only
 *     through a signed URL for an active user — nothing references them any
 *     more by then, and a rollback makes them public again;
 *   * `public.attachments`, the deletion queue, the liveness resolver, note
 *     JSON, the S5 read gate;
 *   * `storage.buckets.public` for `attachments` — that is Stage C, a
 *     separate step with its own script;
 *   * any object that is a NOTE attachment. Every key present in
 *     `public.attachments` is read once at start-up, and each candidate is
 *     checked against that census immediately before it is copied.
 *
 * KNOWN LIMIT — census size. The census is ONE PostgREST read, so it sees at
 * most the API's `max_rows` (1000 by default). Production holds a few dozen
 * attachment rows, far below that; with 1000 or more rows the census would be
 * incomplete and this tool must not be used until it paginates (tracked in
 * docs/nora/17 H.1).
 *
 * AUTHORIZATION — no `service_role`, deliberately.
 *   The tool signs in as a real Nora administrator and does everything through
 *   the ordinary authenticated API, so every write passes the same RLS the
 *   application passes:
 *     read source object   `attachments_select_active_user`
 *     write branding copy  `branding_insert_writer`  (office/admin, active)
 *     update companies     the normal companies write policy
 *     update configuration the normal admin configuration path
 *   Using the service key would bypass exactly the rules this wave is about,
 *   and would prove nothing about whether the app can still do this.
 *
 * IDEMPOTENT. A reference that already points at the branding bucket is
 * reported as `already-relocated` and skipped. Re-running after a partial run
 * is safe and is the intended recovery.
 *
 * FAIL-CLOSED. Any unexpected shape, any failed byte comparison, any failed
 * public read-back aborts that candidate without touching its reference. A
 * reference is only ever updated AFTER the new public URL has been fetched
 * anonymously and proven byte-identical to the source.
 *
 * USAGE
 *   SUPABASE_URL=...            project URL
 *   SUPABASE_ANON_KEY=...       publishable key
 *   NORA_ADMIN_EMAIL=...        an active Nora administrator
 *   NORA_ADMIN_PASSWORD=...
 *
 *   node relocate_branding_objects.mjs              # DRY RUN (default)
 *   node relocate_branding_objects.mjs --apply      # commits
 *
 * Exit 0 = success (or a clean dry run) · 1 = at least one candidate failed
 * · 2 = prerequisites missing.
 */

import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const SOURCE_BUCKET = process.env.NORA_ATTACHMENTS_BUCKET || "attachments";
const TARGET_BUCKET = process.env.NORA_BRANDING_BUCKET || "branding";

const env = (name) => {
  const value = process.env[name];
  if (!value) {
    console.error(`[w8e] missing required environment variable ${name}`);
    process.exit(2);
  }
  return value;
};

const SUPABASE_URL = env("SUPABASE_URL");
const client = createClient(SUPABASE_URL, env("SUPABASE_ANON_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const publicUrl = (bucket, key) =>
  `${SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/${key}`;

const isInBucket = (value, bucket) =>
  typeof value === "string" &&
  value.startsWith(
    `${SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/`,
  );

/** The storage key a public URL of `bucket` refers to, or null. */
const keyFromPublicUrl = (value, bucket) => {
  if (!isInBucket(value, bucket)) return null;
  const key = value.slice(
    `${SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/`
      .length,
  );
  // Same character set the S3B grammar and the liveness resolver accept.
  return /^[A-Za-z0-9._-]{1,512}$/.test(key) && key !== "." && key !== ".."
    ? key
    : null;
};

const report = [];
const record = (row) => {
  report.push(row);
  const status = row.outcome.toUpperCase().padEnd(18);
  console.log(
    `${status} ${row.kind} ${row.ref} :: ${row.sourceKey ?? "-"} -> ${row.targetKey ?? "-"}${row.detail ? `  (${row.detail})` : ""}`,
  );
};

// ---------------------------------------------------------------------------
// Sign in as an administrator
// ---------------------------------------------------------------------------
{
  const { error } = await client.auth.signInWithPassword({
    email: env("NORA_ADMIN_EMAIL"),
    password: env("NORA_ADMIN_PASSWORD"),
  });
  if (error) {
    console.error(`[w8e] administrator sign-in failed: ${error.message}`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// Guard: the target bucket must exist and the note attachments must be known
// ---------------------------------------------------------------------------
const noteKeys = new Set();
{
  const { data, error } = await client
    .from("attachments")
    .select("storage_key")
    .limit(100000);
  if (error) {
    console.error(`[w8e] could not read public.attachments: ${error.message}`);
    console.error(
      "[w8e] refusing to continue: without the note-attachment census this tool cannot prove a candidate is branding.",
    );
    process.exit(2);
  }
  for (const row of data) noteKeys.add(row.storage_key);
  console.log(
    `[w8e] note attachments known to be OFF LIMITS: ${noteKeys.size}`,
  );
}

console.log(
  `[w8e] mode: ${APPLY ? "APPLY (writes)" : "DRY RUN (no writes)"} · ${SOURCE_BUCKET} -> ${TARGET_BUCKET}\n`,
);

/**
 * Copies one object into the branding bucket and proves the copy is good.
 * Returns the new key, or null when the candidate must be skipped.
 */
const copyObject = async (sourceKey, kind, ref) => {
  if (noteKeys.has(sourceKey)) {
    record({
      kind,
      ref,
      sourceKey,
      targetKey: null,
      outcome: "refused",
      detail: "key is a NOTE attachment — never branding",
    });
    return null;
  }

  const { data: blob, error: downloadError } = await client.storage
    .from(SOURCE_BUCKET)
    .download(sourceKey);
  if (downloadError || !blob) {
    record({
      kind,
      ref,
      sourceKey,
      targetKey: null,
      outcome: "failed",
      detail: `download: ${downloadError?.message ?? "empty"}`,
    });
    return null;
  }

  // The key is preserved on purpose: it keeps source and copy trivially
  // correlatable for an auditor, and the key carries no meaning of its own.
  const targetKey = sourceKey;
  const sourceBytes = new Uint8Array(await blob.arrayBuffer());

  if (!APPLY) {
    record({
      kind,
      ref,
      sourceKey,
      targetKey,
      outcome: "would-relocate",
      detail: `${sourceBytes.byteLength} bytes, ${blob.type || "unknown type"}`,
    });
    return null;
  }

  const { error: uploadError } = await client.storage
    .from(TARGET_BUCKET)
    .upload(targetKey, blob, {
      contentType: blob.type || "application/octet-stream",
      upsert: false,
    });
  // An existing copy is not an error: a previous run may have been
  // interrupted between the upload and the reference update.
  if (uploadError && !/exists/i.test(uploadError.message)) {
    record({
      kind,
      ref,
      sourceKey,
      targetKey,
      outcome: "failed",
      detail: `upload: ${uploadError.message}`,
    });
    return null;
  }

  // Prove the copy really is publicly readable AND identical, anonymously —
  // no session, exactly as the login page will fetch it.
  const response = await fetch(publicUrl(TARGET_BUCKET, targetKey));
  if (!response.ok) {
    record({
      kind,
      ref,
      sourceKey,
      targetKey,
      outcome: "failed",
      detail: `public read-back: HTTP ${response.status}`,
    });
    return null;
  }
  const copiedBytes = new Uint8Array(await response.arrayBuffer());
  if (
    copiedBytes.byteLength !== sourceBytes.byteLength ||
    !copiedBytes.every((byte, index) => byte === sourceBytes[index])
  ) {
    record({
      kind,
      ref,
      sourceKey,
      targetKey,
      outcome: "failed",
      detail: "public read-back is not byte-identical",
    });
    return null;
  }

  return targetKey;
};

// ---------------------------------------------------------------------------
// 1. Configuration branding logos (URL-only strings)
// ---------------------------------------------------------------------------
{
  const { data: rows, error } = await client
    .from("configuration")
    .select("id, config");
  if (error) {
    console.error(`[w8e] could not read configuration: ${error.message}`);
    process.exit(1);
  }

  for (const row of rows) {
    const config = { ...(row.config ?? {}) };
    let changed = false;

    for (const field of ["lightModeLogo", "darkModeLogo"]) {
      const value = config[field];
      const ref = `configuration#${row.id}.${field}`;

      if (isInBucket(value, TARGET_BUCKET)) {
        record({
          kind: "config-logo",
          ref,
          sourceKey: null,
          targetKey: keyFromPublicUrl(value, TARGET_BUCKET),
          outcome: "already-relocated",
        });
        continue;
      }

      const sourceKey = keyFromPublicUrl(value, SOURCE_BUCKET);
      if (sourceKey == null) {
        // A bundled asset path or an unrecognised value. Out of scope by
        // definition: this tool only ever relocates what it can identify.
        record({
          kind: "config-logo",
          ref,
          sourceKey: null,
          targetKey: null,
          outcome: "skipped",
          detail:
            typeof value === "string" && value.length > 0
              ? "not an attachments-bucket URL"
              : "empty",
        });
        continue;
      }

      const targetKey = await copyObject(sourceKey, "config-logo", ref);
      if (targetKey == null) continue;

      config[field] = publicUrl(TARGET_BUCKET, targetKey);
      changed = true;
      record({
        kind: "config-logo",
        ref,
        sourceKey,
        targetKey,
        outcome: "relocated",
      });
    }

    if (changed && APPLY) {
      const { error: updateError } = await client
        .from("configuration")
        .update({ config })
        .eq("id", row.id);
      if (updateError) {
        record({
          kind: "config-logo",
          ref: `configuration#${row.id}`,
          sourceKey: null,
          targetKey: null,
          outcome: "failed",
          detail: `reference update: ${updateError.message}`,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Company logos (file-value JSON)
// ---------------------------------------------------------------------------
{
  const { data: rows, error } = await client
    .from("companies")
    .select("id, logo")
    .not("logo", "is", null)
    .limit(100000);
  if (error) {
    console.error(`[w8e] could not read companies: ${error.message}`);
    process.exit(1);
  }

  for (const row of rows) {
    const logo = row.logo;
    const ref = `companies#${row.id}.logo`;

    if (logo == null || typeof logo !== "object") {
      record({
        kind: "company-logo",
        ref,
        sourceKey: null,
        targetKey: null,
        outcome: "skipped",
        detail: "not a file value",
      });
      continue;
    }

    if (isInBucket(logo.src, TARGET_BUCKET)) {
      record({
        kind: "company-logo",
        ref,
        sourceKey: null,
        targetKey: keyFromPublicUrl(logo.src, TARGET_BUCKET),
        outcome: "already-relocated",
      });
      continue;
    }

    // `path` is the authoritative key when present; the URL is only a
    // fallback for a value that never carried one.
    const sourceKey =
      typeof logo.path === "string" && logo.path.length > 0
        ? logo.path
        : keyFromPublicUrl(logo.src, SOURCE_BUCKET);

    if (sourceKey == null) {
      // e.g. an external favicon URL. It is not in our storage at all, so the
      // privacy flip cannot affect it and there is nothing to relocate.
      record({
        kind: "company-logo",
        ref,
        sourceKey: null,
        targetKey: null,
        outcome: "skipped",
        detail: "external or unrecognised logo value",
      });
      continue;
    }

    const targetKey = await copyObject(sourceKey, "company-logo", ref);
    if (targetKey == null) continue;

    if (APPLY) {
      const { error: updateError } = await client
        .from("companies")
        .update({
          logo: {
            ...logo,
            path: targetKey,
            src: publicUrl(TARGET_BUCKET, targetKey),
          },
        })
        .eq("id", row.id);
      if (updateError) {
        record({
          kind: "company-logo",
          ref,
          sourceKey,
          targetKey,
          outcome: "failed",
          detail: `reference update: ${updateError.message}`,
        });
        continue;
      }
    }

    record({
      kind: "company-logo",
      ref,
      sourceKey,
      targetKey,
      outcome: "relocated",
    });
  }
}

// ---------------------------------------------------------------------------
// Summary — this invocation reports its own result
// ---------------------------------------------------------------------------
const tally = report.reduce((acc, row) => {
  acc[row.outcome] = (acc[row.outcome] ?? 0) + 1;
  return acc;
}, {});

console.log("\n[w8e] summary");
for (const [outcome, count] of Object.entries(tally).sort()) {
  console.log(`  ${outcome.padEnd(18)} ${count}`);
}

const failed = report.filter(
  (row) => row.outcome === "failed" || row.outcome === "refused",
).length;
if (failed > 0) {
  console.error(
    `\n[w8e] ${failed} candidate(s) did NOT complete. Nothing was deleted; re-run after resolving them.`,
  );
  process.exit(1);
}
if (!APPLY) {
  console.log("\n[w8e] DRY RUN — nothing was written. Re-run with --apply.");
}
process.exit(0);
