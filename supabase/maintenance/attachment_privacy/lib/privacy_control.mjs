/**
 * W8-E Stage C control plane — the procedure behind
 * `../10_set_attachments_privacy.mjs`. NOT an entry point.
 *
 * Everything here is pure orchestration over injected ports, so the exact
 * decision logic an operator runs against Production is the logic the unit
 * tests (`privacy_control.test.ts`) drive with fakes, and the privacy
 * verifier drives against a real local Storage API:
 *
 *   admin   Storage client holding the operator-only privileged key
 *           (`getBucket`, `updateBucket`, `from(b).list/createSignedUrl`)
 *   anon    Storage client holding ONLY the publishable key
 *   db      PostgREST client with the admin key — used for ONE read-only
 *           check (branding references), never for a write
 *   probe   (url, auth) -> one anonymous GET from a fresh process
 *   say     line output (the CLI redacts it)
 *   sleep   ms -> promise;  now  () -> epoch ms
 *
 * The contract, the reasons and the outcome vocabulary are documented in the
 * CLI header. This module never exits the process and never prints the key:
 * it returns `{ outcome, exitCode, details, guidance }`.
 */

export const BUCKET = "attachments";
export const BRANDING = "branding";

/** Bucket fields a flip may change. Every other field must be identical. */
export const MAY_CHANGE = new Set(["public", "updated_at"]);

export const EXIT = {
  ok: 0,
  stop: 1,
  compensated: 2,
  emergency: 3,
  pending: 4,
  usage: 64,
};

export const OUTCOME = {
  dryRun: "DRY-RUN / NO MUTATION",
  stop: "STOP / NO MUTATION",
  privateVerified: "PRIVATE / VERIFIED",
  privateCdnPending: "PRIVATE / VERIFIED — CDN PROOF PENDING",
  compensated: "PUBLIC / COMPENSATED",
  emergency: "EMERGENCY / STATE REQUIRES MANUAL RECOVERY",
  publicVerified: "PUBLIC / VERIFIED",
  publicReadPending: "PUBLIC / VERIFIED — PUBLIC READ PENDING",
  stillPrivate: "STOP / STILL PRIVATE",
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** What an admin credential is — or why it is refused. Never echoes it. */
export const classifyAdminKey = (key, publishableKey) => {
  if (!key) return { refused: "it is empty" };
  if (key === publishableKey) return { refused: "it is the publishable key" };
  if (key.startsWith("sb_publishable_")) {
    return { refused: "it is a publishable key" };
  }
  if (key.startsWith("sb_secret_")) return { kind: "secret key" };
  const parts = key.split(".");
  if (parts.length === 3) {
    try {
      const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const payload = JSON.parse(atob(base64));
      if (payload.role === "service_role") return { kind: "service_role JWT" };
      return { refused: `it is a JWT for role "${payload.role}"` };
    } catch {
      return { refused: "it is not a readable JWT" };
    }
  }
  return { refused: "unrecognised credential shape" };
};

/** Names of `VITE_*` variables that carry the privileged key (must be none). */
export const viteVariablesHolding = (env, key) =>
  Object.keys(env).filter(
    (name) => name.startsWith("VITE_") && key && env[name] === key,
  );

/**
 * The object key named by the EXACT public URL of an `attachments` object on
 * the target — or an error. No query string, no fragment, root objects only.
 */
export const parseProbeUrl = (supabaseUrl, probeUrl) => {
  const prefix = `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${BUCKET}/`;
  if (!probeUrl) {
    return {
      error:
        "--probe-url is required: the EXACT current public URL of one existing, non-sensitive attachment",
    };
  }
  if (!probeUrl.startsWith(prefix) || /[?#]/.test(probeUrl)) {
    return {
      error: `--probe-url must be ${prefix}<key> with no query string or fragment (the exact URL the old runtime used)`,
    };
  }
  let key;
  try {
    key = decodeURIComponent(probeUrl.slice(prefix.length));
  } catch {
    return { error: "--probe-url carries an undecodable key" };
  }
  if (!key || key.includes("/")) {
    return { error: "--probe-url must name one object at the bucket root" };
  }
  return { key };
};

/** Fields (other than `allowed`) whose values differ between two bucket rows. */
export const bucketDiff = (before, after, allowed) =>
  [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])]
    .filter((field) => !allowed.has(field))
    .filter(
      (field) =>
        JSON.stringify(before?.[field] ?? null) !==
        JSON.stringify(after?.[field] ?? null),
    )
    .map(
      (field) =>
        `${field}: ${JSON.stringify(before?.[field] ?? null)} -> ${JSON.stringify(after?.[field] ?? null)}`,
    );

/**
 * The ONE request body this tool ever sends: the requested visibility, and
 * the bucket's current controls echoed verbatim so nothing but `public` can
 * change — whatever a server does with an omitted field.
 */
export const visibilityUpdate = (before, makePublic) => ({
  public: makePublic,
  fileSizeLimit: before.file_size_limit,
  allowedMimeTypes: before.allowed_mime_types,
});

export const describeBucket = (bucket) =>
  `public=${bucket.public} file_size_limit=${JSON.stringify(bucket.file_size_limit)} allowed_mime_types=${JSON.stringify(bucket.allowed_mime_types)}`;

const is2xx = (result) => result?.status >= 200 && result?.status < 300;

const showProbe = (say, label, result) =>
  say(
    `[w8e-c]   ${label}: ${result.error ? `ERROR ${result.error}` : `HTTP ${result.status}, ${result.bytes} bytes, sha256 ${String(result.sha256).slice(0, 16)}…`}${result.headers && Object.keys(result.headers).length ? ` ${JSON.stringify(result.headers)}` : ""}`,
  );

const errorText = (error) =>
  error ? String(error.message ?? error) : null;

const readBucket = async (admin, id) => {
  try {
    const { data, error } = await admin.getBucket(id);
    if (error || !data) return { error: errorText(error) ?? "no data" };
    return { bucket: data };
  } catch (error) {
    return { error: errorText(error) };
  }
};

const update = async (admin, id, body) => {
  try {
    const { data, error } = await admin.updateBucket(id, body);
    return { data, error: errorText(error) };
  } catch (error) {
    return { error: errorText(error) };
  }
};

/** A stored branding URL that still points into the `attachments` bucket. */
const STALE_BRANDING = /^https?:\/\/[^/?#\s]+\/storage\/v1\/object\/public\/attachments\//;

/**
 * Stage A completion, read through PostgREST with the admin credential
 * (read-only; `service_role` holds SELECT on both tables by the Wave-1
 * matrix). Same rule as gate 10 of `00_preflight.sql`, enforced here too so
 * the flip never rests on the preflight having been run.
 */
export const staleBrandingReferences = async (db) => {
  const stale = [];
  const config = await db.from("configuration").select("id, config");
  if (config.error) return { error: errorText(config.error) };
  for (const row of config.data ?? []) {
    for (const field of ["lightModeLogo", "darkModeLogo"]) {
      if (STALE_BRANDING.test(String(row.config?.[field] ?? ""))) {
        stale.push(`configuration#${row.id}.${field}`);
      }
    }
  }
  const PAGE = 500;
  for (let from = 0; ; from += PAGE) {
    const page = await db
      .from("companies")
      .select("id, logo")
      .not("logo", "is", null)
      .order("id")
      .range(from, from + PAGE - 1);
    if (page.error) return { error: errorText(page.error) };
    for (const row of page.data ?? []) {
      if (STALE_BRANDING.test(String(row.logo?.src ?? ""))) {
        stale.push(`companies#${row.id}.logo`);
      }
    }
    if ((page.data ?? []).length < PAGE) break;
  }
  return { stale };
};

/** Anonymous Storage API surface (publishable key): must expose nothing. */
const anonymousApiExposure = async (anon, probeKey) => {
  const exposures = [];
  const listed = await anon.from(BUCKET).list("", { limit: 5 });
  if ((listed?.data ?? []).length > 0) {
    exposures.push(
      `anonymous LIST of "${BUCKET}" returned ${listed.data.length} entr${listed.data.length === 1 ? "y" : "ies"}`,
    );
  }
  const signed = await anon.from(BUCKET).createSignedUrl(probeKey, 60);
  if (signed?.data?.signedUrl) {
    exposures.push("anonymous client could sign a URL for the probe object");
  }
  return exposures;
};

const result = (outcome, exitCode, details = {}, guidance = []) => ({
  outcome,
  exitCode,
  details,
  guidance,
});

// ---------------------------------------------------------------------------
// Stage C: public -> private
// ---------------------------------------------------------------------------
export async function runSetPrivate(io) {
  const {
    admin,
    anon,
    db,
    probe,
    say,
    sleep,
    now,
    supabaseUrl,
    probeUrl,
    probeKey,
    apply,
    cdnWindowS,
    cdnIntervalS,
  } = io;
  const base = supabaseUrl.replace(/\/+$/, "");

  say(`[w8e-c] STAGE C: ${BUCKET} -> PRIVATE · ${apply ? "APPLY" : "DRY RUN"}`);
  const beforeRead = await readBucket(admin, BUCKET);
  if (beforeRead.error) {
    return result(OUTCOME.stop, EXIT.stop, {
      reason: `cannot read bucket "${BUCKET}": ${beforeRead.error}`,
    });
  }
  const before = beforeRead.bucket;
  say(`[w8e-c] ${BUCKET} before: ${describeBucket(before)}`);
  const brandingRead = await readBucket(admin, BRANDING);
  const brandingBefore = brandingRead.bucket;
  say(
    `[w8e-c] ${BRANDING} before: ${brandingBefore ? describeBucket(brandingBefore) : `UNREADABLE (${brandingRead.error})`}`,
  );

  // --- preconditions: nothing below mutates ------------------------------
  const stops = [];
  if (before.public !== true) {
    stops.push(
      `"${BUCKET}" is already PRIVATE. The Storage API purges the CDN only on a public -> private transition it performs itself, so the purge state of this bucket is UNKNOWN (a direct SQL flip never purges). Do not treat this as done: see docs/nora/21 Section 17 (CDN recovery).`,
    );
  }
  if (!brandingBefore) {
    stops.push(`bucket "${BRANDING}" is missing or unreadable (Stage A not done?)`);
  } else if (brandingBefore.public !== true) {
    stops.push(`bucket "${BRANDING}" is not public`);
  }
  const branding = await staleBrandingReferences(db);
  if (branding.error) {
    stops.push(`cannot read the branding references: ${branding.error}`);
  } else if (branding.stale.length) {
    stops.push(
      `${branding.stale.length} branding reference(s) still point into "${BUCKET}" (Stage A not complete): ${branding.stale.join(", ")}`,
    );
  }
  const exists = await admin.from(BUCKET).createSignedUrl(probeKey, 60);
  if (!exists?.data?.signedUrl) {
    stops.push(
      `the probe object does not exist or cannot be signed by the admin credential: ${errorText(exists?.error) ?? "no URL"}`,
    );
  }
  const control = await admin.from(BUCKET).list("", { limit: 1 });
  if (!(control?.data ?? []).length) {
    stops.push(
      "positive control failed: the admin credential lists no object in the bucket, so the anonymous LIST check would prove nothing",
    );
  }
  for (const exposure of await anonymousApiExposure(anon, probeKey)) {
    stops.push(
      `RLS exposure BEFORE the flip: ${exposure} — a policy lets anonymous callers in; making the bucket private would not close it`,
    );
  }

  say("[w8e-c] priming the exact public URL anonymously (fresh process per request)");
  const primed = await probe(probeUrl, "none");
  showProbe(say, "prime #1", primed);
  const primedAgain = await probe(probeUrl, "none");
  showProbe(say, "prime #2", primedAgain);
  if (!is2xx(primed) || !primed.bytes) {
    stops.push(
      `the probe URL does not serve bytes anonymously before the flip (HTTP ${primed.status ?? primed.error})`,
    );
  }
  const cdnHeaderSeen = [primed, primedAgain].some(
    (probed) => probed.headers?.["cf-cache-status"] != null,
  );
  say(
    `[w8e-c]   CDN cache header ${cdnHeaderSeen ? `observed (cf-cache-status: ${primed.headers?.["cf-cache-status"]} -> ${primedAgain.headers?.["cf-cache-status"]})` : "NOT observed — no CDN in front of this target; the proof below covers the origin path only"}`,
  );

  if (stops.length) {
    return result(OUTCOME.stop, EXIT.stop, { stops, bucket: before }, [
      ...stops,
      "Nothing was changed.",
    ]);
  }
  const request = visibilityUpdate(before, false);
  if (!apply) {
    return result(
      OUTCOME.dryRun,
      EXIT.ok,
      { would: request, bucket: before, primed },
      [
        `All preconditions hold. Would send ${JSON.stringify(request)} for "${BUCKET}".`,
        "Re-run with --apply.",
      ],
    );
  }

  // --- the mutation: the Storage API, the one and only flip ---------------
  say(`[w8e-c] PUT /storage/v1/bucket/${BUCKET} public=false (controls echoed)`);
  const flip = await update(admin, BUCKET, request);
  say(`[w8e-c]   API answer: ${flip.error ? `ERROR ${flip.error}` : JSON.stringify(flip.data)}`);

  const afterRead = await readBucket(admin, BUCKET);
  if (afterRead.error) {
    return result(
      OUTCOME.emergency,
      EXIT.emergency,
      { apiError: flip.error, readError: afterRead.error },
      [
        "The bucket could not be read back after the mutation request: its state is UNKNOWN.",
        "Do NOT revert the runtime. Read storage.buckets read-only; if attachments is private and must be public,",
        "use 20_set_attachments_public.sql (SQL fallback) and confirm with `probe` that the public URL serves bytes.",
      ],
    );
  }
  const after = afterRead.bucket;
  if (
    flip.error &&
    after.public === true &&
    bucketDiff(before, after, MAY_CHANGE).length === 0
  ) {
    return result(
      OUTCOME.stop,
      EXIT.stop,
      { apiError: flip.error, bucket: after },
      [
        `The Storage API refused the update; "${BUCKET}" is verified unchanged (public).`,
        "Nothing was changed.",
      ],
    );
  }

  // --- immediate postconditions: critical, any failure is compensated -----
  const failures = [];
  if (flip.error) {
    failures.push(`the API reported an error although state changed: ${flip.error}`);
  }
  if (after.public !== false) {
    failures.push(`"${BUCKET}" is not private after the update`);
  }
  for (const drift of bucketDiff(before, after, MAY_CHANGE)) {
    failures.push(`"${BUCKET}" control changed: ${drift}`);
  }
  const brandingAfterRead = await readBucket(admin, BRANDING);
  if (brandingAfterRead.error) {
    failures.push(`"${BRANDING}" unreadable after the flip: ${brandingAfterRead.error}`);
  } else {
    if (brandingAfterRead.bucket.public !== true) {
      failures.push(`"${BRANDING}" is not public after the flip`);
    }
    for (const drift of bucketDiff(brandingBefore, brandingAfterRead.bucket, new Set())) {
      failures.push(`"${BRANDING}" changed: ${drift}`);
    }
  }
  if (after.public === false) {
    for (const exposure of await anonymousApiExposure(anon, probeKey)) {
      failures.push(`RLS exposure after the flip: ${exposure}`);
    }
    const encoded = encodeURIComponent(probeKey);
    const authed = await probe(
      `${base}/storage/v1/object/authenticated/${BUCKET}/${encoded}`,
      "publishable",
    );
    showProbe(say, "/object/authenticated with the publishable key", authed);
    if (is2xx(authed)) {
      failures.push("/object/authenticated served the object to the publishable key");
    }
    const direct = await probe(`${base}/storage/v1/object/${BUCKET}/${encoded}`, "none");
    showProbe(say, "/object/<bucket>/<key> without credentials", direct);
    if (is2xx(direct)) {
      failures.push("/object/<bucket>/<key> served the object without credentials");
    }
  }

  if (failures.length) {
    say("[w8e-c] CRITICAL POSTCONDITION FAILED — compensating back to PUBLIC");
    for (const failure of failures) say(`[w8e-c]   - ${failure}`);
    const compensation = await update(admin, BUCKET, visibilityUpdate(before, true));
    const restoredRead = await readBucket(admin, BUCKET);
    const restored = restoredRead.bucket;
    const restoredOk =
      restored != null &&
      restored.public === true &&
      bucketDiff(before, restored, MAY_CHANGE).length === 0;
    if (restoredOk) {
      return result(
        OUTCOME.compensated,
        EXIT.compensated,
        {
          originalFailures: failures,
          compensationError: compensation.error,
          bucket: restored,
        },
        [
          "Stage C did NOT complete. The original failure:",
          ...failures.map((failure) => `  - ${failure}`),
          `Compensation: "${BUCKET}" is verified PUBLIC again with its original controls (supported state: W8-E runtime + public).`,
          "STOP. Investigate the failure above before any new attempt. Do not revert the runtime for this.",
        ],
      );
    }
    return result(
      OUTCOME.emergency,
      EXIT.emergency,
      {
        originalFailures: failures,
        compensationError: compensation.error,
        compensationReadError: restoredRead.error ?? null,
        bucket: restored ?? null,
      },
      [
        "RELEASE EMERGENCY. Stage C failed AND the compensation could not be verified.",
        "Original failure:",
        ...failures.map((failure) => `  - ${failure}`),
        `Compensation: ${compensation.error ?? "request accepted"}; read-back: ${restored ? describeBucket(restored) : restoredRead.error}`,
        "Do NOT revert the runtime until attachments is verified PUBLIC.",
        "Restore with 20_set_attachments_public.sql (SQL fallback), restore the original controls, then `probe`.",
      ],
    );
  }

  // --- CDN proof: the EXACT primed URL, a fresh process per attempt -------
  say(
    `[w8e-c] ${BUCKET} is PRIVATE with unchanged controls. CDN proof: re-requesting the exact primed URL (window ${cdnWindowS}s, every ${cdnIntervalS}s)`,
  );
  const attempts = [];
  const started = now();
  const record = (probed) =>
    attempts.push({
      t: Math.round((now() - started) / 1000),
      status: probed.status ?? null,
      cf: probed.headers?.["cf-cache-status"] ?? null,
      ray: probed.headers?.["cf-ray"] ?? null,
    });
  let latest = await probe(probeUrl, "none");
  record(latest);
  showProbe(say, "exact URL", latest);
  while (is2xx(latest) && now() - started < cdnWindowS * 1000) {
    await sleep(cdnIntervalS * 1000);
    latest = await probe(probeUrl, "none");
    record(latest);
    showProbe(say, `exact URL +${attempts.at(-1).t}s`, latest);
  }
  const proofScope = cdnHeaderSeen
    ? "CDN edge reached by this client"
    : "origin only (no CDN observed)";
  if (is2xx(latest)) {
    // Deliberately NOT compensated: the bucket is verifiably private, and
    // making it public again would expose every object, not one cached copy.
    return result(
      OUTCOME.privateCdnPending,
      EXIT.pending,
      { bucket: after, primed, attempts, proofScope },
      [
        `"${BUCKET}" is verifiably PRIVATE with unchanged controls — do NOT compensate or roll back for this.`,
        `The exact primed URL STILL returns bytes after ${cdnWindowS}s: a cached public copy is being served.`,
        "Stage C is NOT complete. Re-run `probe` on the same URL later. If it persists, this is a PO decision:",
        "re-trigger the purge by a controlled public -> private cycle through this tool, or ask Supabase to purge.",
      ],
    );
  }
  return result(
    OUTCOME.privateVerified,
    EXIT.ok,
    { bucket: after, primed, attempts, proofScope },
    [
      `"${BUCKET}" is PRIVATE; file_size_limit and allowed_mime_types unchanged; "${BRANDING}" unchanged and public.`,
      "Anonymous LIST, signing, /object/authenticated and /object/<bucket>/<key> yield nothing.",
      `The exact primed URL no longer serves bytes (after ~${attempts.at(-1).t}s; scope: ${proofScope}).`,
      "Continue with 30_verify_attachments_private.sql and the post-Stage-C checks (docs/nora/21 Section 17).",
    ],
  );
}

// ---------------------------------------------------------------------------
// Rollback: private -> public
// ---------------------------------------------------------------------------
export async function runSetPublic(io) {
  const { admin, probe, say, sleep, now, probeUrl, apply, cdnWindowS, cdnIntervalS } = io;
  const revertGate =
    "Only after PUBLIC is verified AND the probe URL serves bytes may the runtime be reverted.";

  say(`[w8e-c] ROLLBACK: ${BUCKET} -> PUBLIC · ${apply ? "APPLY" : "DRY RUN"}`);
  const beforeRead = await readBucket(admin, BUCKET);
  if (beforeRead.error) {
    return result(
      OUTCOME.stop,
      EXIT.stop,
      { reason: `cannot read bucket "${BUCKET}": ${beforeRead.error}` },
      ["Do NOT revert the runtime. Use the SQL fallback 20_set_attachments_public.sql if the Storage API is unavailable."],
    );
  }
  const before = beforeRead.bucket;
  say(`[w8e-c] ${BUCKET} before: ${describeBucket(before)}`);

  const awaitPublicRead = async () => {
    const started = now();
    let served = await probe(probeUrl, "none");
    showProbe(say, "anonymous public URL", served);
    while (!is2xx(served) && now() - started < cdnWindowS * 1000) {
      await sleep(cdnIntervalS * 1000);
      served = await probe(probeUrl, "none");
      showProbe(say, "anonymous public URL (retry)", served);
    }
    return served;
  };
  const readPending = (bucket, served) =>
    result(OUTCOME.publicReadPending, EXIT.pending, { bucket, probe: served }, [
      "The bucket is public, but the probe URL does not serve bytes yet (possibly a cached error response).",
      "Do NOT revert the runtime yet; re-run `probe` until it returns HTTP 200.",
    ]);

  if (before.public === true) {
    const served = await awaitPublicRead();
    if (!is2xx(served)) return readPending(before, served);
    return result(
      OUTCOME.publicVerified,
      EXIT.ok,
      { mutation: "none — already public", bucket: before, probe: served },
      ["Nothing was changed: the bucket was already public.", revertGate],
    );
  }
  const request = visibilityUpdate(before, true);
  if (!apply) {
    return result(OUTCOME.dryRun, EXIT.ok, { would: request, bucket: before }, [
      `Would send ${JSON.stringify(request)} for "${BUCKET}".`,
      "Re-run with --apply.",
    ]);
  }

  const flip = await update(admin, BUCKET, request);
  const afterRead = await readBucket(admin, BUCKET);
  if (afterRead.error) {
    return result(
      OUTCOME.emergency,
      EXIT.emergency,
      { apiError: flip.error, readError: afterRead.error },
      [
        "The bucket state could not be read back after the rollback request.",
        "Do NOT revert the runtime. Use the SQL fallback 20_set_attachments_public.sql, then `probe`.",
      ],
    );
  }
  const after = afterRead.bucket;
  if (after.public !== true) {
    return result(
      OUTCOME.stillPrivate,
      EXIT.stop,
      { apiError: flip.error, bucket: after },
      [
        `"${BUCKET}" is still PRIVATE. Do NOT revert the runtime.`,
        "Retry, or use the SQL fallback 20_set_attachments_public.sql if the Storage API is unavailable.",
      ],
    );
  }
  const drift = bucketDiff(before, after, MAY_CHANGE);
  if (drift.length) {
    return result(
      OUTCOME.emergency,
      EXIT.emergency,
      { bucket: after, drift },
      [
        `"${BUCKET}" is PUBLIC (reads work for the old runtime), but its controls drifted:`,
        ...drift,
        "Restore the controls before accepting uploads; the public read path itself is restored.",
      ],
    );
  }
  const served = await awaitPublicRead();
  if (!is2xx(served)) return readPending(after, served);
  return result(
    OUTCOME.publicVerified,
    EXIT.ok,
    { bucket: after, probe: served },
    [
      `"${BUCKET}" is public again with unchanged controls; the probe URL serves bytes.`,
      revertGate,
    ],
  );
}
