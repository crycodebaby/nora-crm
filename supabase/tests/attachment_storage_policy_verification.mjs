#!/usr/bin/env node
/**
 * Nora W8-B — attachment storage hardening: Storage API verification.
 *
 * Proves the storage contract of bucket `attachments` through the real
 * Storage API with real GoTrue sessions (not only SQL-level RLS):
 *
 *   1. role matrix         anon / inactive / viewer / office / admin
 *                          LIST, signed URL (SELECT) · download (T1 residual)
 *                          · upload (INSERT)
 *                          · update, upsert, move (UPDATE) · remove (DELETE)
 *   2. T10                 an office employee signs in, uploads successfully,
 *                          is deactivated (sales.disabled = true, session left
 *                          alive) and can no longer list, sign URLs or upload
 *                          with the still valid JWT (download() of a public bucket
 *                          is the T1 residual, see below)
 *   3. residual T1         public object URLs stay readable without login —
 *                          expected W8-B residual risk, NOT a test failure
 *   4. legacy key          a `0.<digits>.<ext>` object stays readable
 *   5. MIME allowlist      allowed and rejected content types, enforced by the
 *                          bucket (not the UI)
 *   6. size limit          just below 50 MiB accepted, just above rejected
 *   7. service_role        unaffected by RLS (seeding + cleanup path)
 *
 * Local only — refuses any non-localhost URL. Needs Docker and a running
 * local stack with migration 20260915120000 applied:
 *
 *   npx supabase db reset --local
 *   node supabase/tests/attachment_storage_policy_verification.mjs
 *
 * Keys come from SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY or, when unset,
 * from `npx supabase status -o json`. Role fixtures are set through
 * `nora_private.apply_sales_role_change` via `docker exec … psql` (container
 * from NORA_DB_CONTAINER, default supabase_db_atomic-crm-demo), the same
 * fixture path the SQL suites use.
 *
 * Side effects: all storage objects created by the run are removed again via
 * service_role. The four auth users (w8b-*-<run>@nora.test) stay — since W6-B
 * accounts cannot be hard-deleted without a ticket. Run on a disposable stack.
 *
 * Exit 0 = all assertions passed · 1 = assertion failure · 2 = prerequisites.
 */

import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const BUCKET = "attachments";
const MAX_BYTES = 50 * 1024 * 1024;
const DB_CONTAINER =
  process.env.NORA_DB_CONTAINER || "supabase_db_atomic-crm-demo";

const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
};

const readLocalKeys = () => {
  if (process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      url: process.env.SUPABASE_URL || "http://127.0.0.1:54321",
      anon: process.env.SUPABASE_ANON_KEY,
      service: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
  }
  const raw = execFileSync("npx", ["supabase", "status", "-o", "json"], {
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const status = JSON.parse(raw.slice(raw.indexOf("{")));
  return {
    url: process.env.SUPABASE_URL || status.API_URL || "http://127.0.0.1:54321",
    anon: status.ANON_KEY,
    service: status.SERVICE_ROLE_KEY,
  };
};

let config;
try {
  config = readLocalKeys();
} catch (error) {
  console.error("[w8b] local Supabase stack unavailable:", error.message);
  process.exit(2);
}
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(config.url)) {
  console.error(`[w8b] refusing non-local Supabase URL ${config.url}`);
  process.exit(2);
}

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false },
};
const service = createClient(config.url, config.service, clientOptions);
const anon = createClient(config.url, config.anon, clientOptions);

const psql = (sql) =>
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
    { input: sql, encoding: "utf8" },
  ).trim();

const run = randomUUID().slice(0, 8);
const prefix = `w8b-verify-${run}`;
const createdKeys = new Set();
const password = `W8b-${randomUUID()}`;

const textBlob = (content, type = "text/plain") =>
  new Blob([content], { type });

const createEmployee = async (label, role) => {
  const email = `w8b-${label}-${run}@nora.test`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: "W8B", last_name: label },
  });
  if (error) fail(`createUser ${label}: ${error.message}`);
  const userId = data.user.id;
  psql(`
    select nora_private.apply_sales_role_change(
      (select id from public.sales where user_id = '${userId}'), '${role}', false);
  `);
  const client = createClient(config.url, config.anon, clientOptions);
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) fail(`signIn ${label}: ${signInError.message}`);
  return { label, userId, client };
};

const serviceExists = async (key) => {
  const folder = key.includes("/") ? key.slice(0, key.lastIndexOf("/")) : "";
  const name = key.slice(key.lastIndexOf("/") + 1);
  const { data, error } = await service.storage
    .from(BUCKET)
    .list(folder, { search: name, limit: 100 });
  if (error) fail(`service list ${key}: ${error.message}`);
  return data.some((entry) => entry.name === name);
};

const serviceText = async (key) => {
  const { data, error } = await service.storage.from(BUCKET).download(key);
  if (error) fail(`service download ${key}: ${error.message}`);
  return data.text();
};

const seed = async (key, content = "seed", type = "text/plain") => {
  const { error } = await service.storage
    .from(BUCKET)
    .upload(key, textBlob(content, type));
  if (error) fail(`service seed ${key}: ${error.message}`);
  createdKeys.add(key);
};

const results = [];
const check = (label, actual, expected) => {
  const ok = actual === expected;
  results.push({ label, actual, expected, ok });
  console.log(
    `${ok ? "OK  " : "FAIL"} ${label}: ${actual ? "allowed" : "denied"} (expected ${expected ? "allowed" : "denied"})`,
  );
  if (!ok) process.exitCode = 1;
};
const assert = (label, condition) => {
  results.push({ label, ok: condition });
  console.log(`${condition ? "OK  " : "FAIL"} ${label}`);
  if (!condition) process.exitCode = 1;
};

/** Returns true when the operation took effect for this client. */
const probe = {
  list: async (client) => {
    const { data, error } = await client.storage
      .from(BUCKET)
      .list(prefix, { limit: 100 });
    return !error && Array.isArray(data) && data.length > 0;
  },
  download: async (client, key) => {
    const { data, error } = await client.storage.from(BUCKET).download(key);
    return !error && data != null;
  },
  signedUrl: async (client, key) => {
    const { data, error } = await client.storage
      .from(BUCKET)
      .createSignedUrl(key, 60);
    return !error && Boolean(data?.signedUrl);
  },
  insert: async (client, label) => {
    const key = `${prefix}/${label}-insert-${randomUUID()}.txt`;
    const { error } = await client.storage
      .from(BUCKET)
      .upload(key, textBlob(`insert by ${label}`));
    if (!error) createdKeys.add(key);
    return !error && (await serviceExists(key));
  },
  update: async (client, key, label) => {
    const before = await serviceText(key);
    await client.storage
      .from(BUCKET)
      .update(key, textBlob(`update by ${label}`));
    return (await serviceText(key)) !== before;
  },
  upsert: async (client, key, label) => {
    const before = await serviceText(key);
    await client.storage
      .from(BUCKET)
      .upload(key, textBlob(`upsert by ${label}`), { upsert: true });
    return (await serviceText(key)) !== before;
  },
  move: async (client, key, label) => {
    const target = `${prefix}/${label}-moved-${randomUUID()}.txt`;
    const { error } = await client.storage.from(BUCKET).move(key, target);
    const moved = !error && !(await serviceExists(key));
    if (moved) {
      createdKeys.add(target);
      // restore the fixture for the next probe
      await service.storage.from(BUCKET).move(target, key);
    }
    return moved;
  },
  remove: async (client, key) => {
    await client.storage.from(BUCKET).remove([key]);
    const removed = !(await serviceExists(key));
    if (removed) await seed(key);
    return removed;
  },
};

const expectations = {
  anon: { select: false, insert: false },
  inactive: { select: false, insert: false },
  viewer: { select: true, insert: false },
  office: { select: true, insert: true },
  admin: { select: true, insert: true },
};

const roleMatrix = async (label, client) => {
  const expected = expectations[label];
  const fixture = `${prefix}/fixture-${label}.txt`;
  await seed(fixture, `fixture for ${label}`);

  check(`${label} LIST`, await probe.list(client), expected.select);
  // RESIDUAL T1: for a PUBLIC bucket storage-api's GET /object/<bucket>/<key>
  // resolves the object asSuperUser (routes/object/getObject.js) — RLS is not
  // consulted, exactly like /object/public/. Allowed for every caller until W8-E.
  check(
    `${label} download() on public bucket [RESIDUAL T1, not RLS]`,
    await probe.download(client, fixture),
    true,
  );
  check(
    `${label} SELECT signed URL`,
    await probe.signedUrl(client, fixture),
    expected.select,
  );
  check(
    `${label} INSERT upload`,
    await probe.insert(client, label),
    expected.insert,
  );
  check(
    `${label} UPDATE update()`,
    await probe.update(client, fixture, label),
    false,
  );
  check(
    `${label} UPDATE upload(upsert)`,
    await probe.upsert(client, fixture, label),
    false,
  );
  check(
    `${label} UPDATE move()`,
    await probe.move(client, fixture, label),
    false,
  );
  check(`${label} DELETE remove()`, await probe.remove(client, fixture), false);
};

const uploadAs = async (client, key, body, options) => {
  const { error } = await client.storage
    .from(BUCKET)
    .upload(key, body, options);
  if (!error) createdKeys.add(key);
  return { accepted: !error, error };
};

const main = async () => {
  console.log(`=== W8-B attachment storage verification (run ${run}) ===`);

  const bucketRow = psql(
    `select public, file_size_limit, array_to_string(allowed_mime_types, ',') from storage.buckets where id = '${BUCKET}'`,
  );
  console.log(`bucket: ${bucketRow}`);
  assert(
    "bucket attachments is still public (W8-B keeps public read)",
    bucketRow.startsWith("t|"),
  );
  assert(
    "bucket file_size_limit = 52428800",
    bucketRow.split("|")[1] === String(MAX_BYTES),
  );

  // Fixtures. Admin first: on an empty stack the first sign-up is admin anyway.
  const admin = await createEmployee("admin", "admin");
  const office = await createEmployee("office", "office");
  const viewer = await createEmployee("viewer", "viewer");
  const inactive = await createEmployee("inactive", "office");

  // --- 2. T10 precondition: the later-deactivated employee could write ------
  await seed(`${prefix}/t10-fixture.txt`, "t10");
  check(
    "T10 precondition: active office LIST",
    await probe.list(inactive.client),
    true,
  );
  check(
    "T10 precondition: active office INSERT",
    await probe.insert(inactive.client, "t10-pre"),
    true,
  );

  psql(`
    select nora_private.apply_sales_role_change(
      (select id from public.sales where user_id = '${inactive.userId}'), 'office', true);
  `);
  const liveSessions = psql(
    `select count(*) from auth.sessions where user_id = '${inactive.userId}'`,
  );
  assert(
    "T10: deactivated employee still has a live auth session (JWT still valid)",
    Number(liveSessions) > 0,
  );
  const { data: jwtUser } = await inactive.client.auth.getUser();
  assert(
    "T10: GoTrue still accepts the deactivated employee's JWT",
    jwtUser?.user?.id === inactive.userId,
  );

  // --- 1. role matrix -----------------------------------------------------
  await roleMatrix("anon", anon);
  await roleMatrix("inactive", inactive.client);
  await roleMatrix("viewer", viewer.client);
  await roleMatrix("office", office.client);
  await roleMatrix("admin", admin.client);

  // an office/admin cannot delete even the object it uploaded itself
  const ownKey = `${prefix}/office-own-${randomUUID()}.txt`;
  const own = await uploadAs(office.client, ownKey, textBlob("own"));
  assert("office uploads own object", own.accepted);
  await office.client.storage.from(BUCKET).remove([ownKey]);
  assert(
    "office cannot DELETE its own uploaded object",
    await serviceExists(ownKey),
  );

  // --- 3. residual T1: public URL read without login ------------------------
  const publicKey = `${prefix}/public-residual.txt`;
  await seed(publicKey, "public residual");
  const { data: publicUrl } = service.storage
    .from(BUCKET)
    .getPublicUrl(publicKey);
  const publicResponse = await fetch(publicUrl.publicUrl);
  assert(
    "RESIDUAL T1 (expected): public object URL readable without any credentials",
    publicResponse.status === 200 &&
      (await publicResponse.text()) === "public residual",
  );
  check(
    "RESIDUAL T1 (expected): anon download() of the same object",
    await probe.download(anon, publicKey),
    true,
  );
  // The "authenticated" route does not require a login for a public bucket
  // either (the public anon key suffices): RLS protects LIST/signing/mutations,
  // not known-object reads.
  const authenticatedRouteResponse = await fetch(
    `${config.url}/storage/v1/object/authenticated/${BUCKET}/${publicKey}`,
    { headers: { apikey: config.anon } },
  );
  assert(
    "RESIDUAL T1 (expected): /object/authenticated/ readable with only the public anon key (no login)",
    authenticatedRouteResponse.status === 200 &&
      (await authenticatedRouteResponse.text()) === "public residual",
  );
  check("anon LIST of the same prefix (RLS-bound)", await probe.list(anon), false);
  check(
    "anon signed URL for the same object (RLS-bound)",
    await probe.signedUrl(anon, publicKey),
    false,
  );

  // --- 4. legacy key ------------------------------------------------------
  // shape of the pre-W8-B keys (`${Math.random()}${ext}`), e.g. 0.8262106278726917.png
  const legacyKey = `0.${parseInt(randomUUID().replace(/-/g, "").slice(0, 13), 16)}.png`;
  await seed(legacyKey, "legacy", "image/png");
  check(
    "viewer reads legacy 0.<digits>.png via Storage API",
    await probe.download(viewer.client, legacyKey),
    true,
  );
  check(
    "viewer signed URL for legacy key",
    await probe.signedUrl(viewer.client, legacyKey),
    true,
  );

  // --- 4b. logo flow shape ----------------------------------------------------
  // Company logo (office/admin) and branding logo (admin) go through
  // ImageEditorField: the cropper yields a PNG data URL, uploadToBucket fetches
  // it into a Blob and uploads that Blob (multipart part type image/png).
  const pngDataUrl =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  for (const [label, client] of [
    ["office company logo", office.client],
    ["admin branding logo", admin.client],
  ]) {
    const logoBlob = await (await fetch(pngDataUrl)).blob();
    const { accepted } = await uploadAs(
      client,
      `${prefix}/${randomUUID()}.png`,
      logoBlob,
    );
    check(
      `${label} (cropper data URL → Blob ${logoBlob.type})`,
      accepted,
      true,
    );
  }
  const viewerLogo = await uploadAs(
    viewer.client,
    `${prefix}/${randomUUID()}.png`,
    await (await fetch(pngDataUrl)).blob(),
  );
  check("viewer logo upload", viewerLogo.accepted, false);

  // --- 5. MIME allowlist (enforced by the bucket, uploaded as office) --------
  const allowed = [
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
    ["image/gif", "gif"],
    ["application/pdf", "pdf"],
    [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "docx",
    ],
    [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "xlsx",
    ],
    ["text/plain", "txt"],
    ["text/csv", "csv"],
  ];
  const rejected = [
    ["image/svg+xml", "svg"],
    ["text/html", "html"],
    ["application/xhtml+xml", "xhtml"],
    ["application/xml", "xml"],
    ["text/xml", "xml"],
    ["application/javascript", "js"],
    ["text/javascript", "js"],
    ["application/vnd.ms-excel", "xls"],
    ["application/vnd.ms-excel.sheet.macroEnabled.12", "xlsm"],
    ["application/vnd.ms-word.document.macroEnabled.12", "docm"],
    ["image/heic", "heic"],
    ["application/octet-stream", "bin"],
    ["", "untyped"],
  ];
  for (const [type, ext] of allowed) {
    const { accepted } = await uploadAs(
      office.client,
      `${prefix}/mime-${randomUUID()}.${ext}`,
      textBlob("x", type),
    );
    check(`MIME ${type}`, accepted, true);
  }
  for (const [type, ext] of rejected) {
    const { accepted } = await uploadAs(
      office.client,
      `${prefix}/mime-${randomUUID()}.${ext}`,
      textBlob("x", type),
    );
    check(`MIME ${type || "(empty Blob type)"}`, accepted, false);
  }
  // service_role is bound by bucket controls as well (they are not RLS)
  const serviceSvg = await uploadAs(
    service,
    `${prefix}/service-${randomUUID()}.svg`,
    textBlob("<svg/>", "image/svg+xml"),
  );
  check(
    "service_role MIME image/svg+xml (bucket control, not RLS)",
    serviceSvg.accepted,
    false,
  );
  // Postmark path shape (supabase/functions/postmark/extractAndUploadAttachments.ts):
  // an ArrayBuffer body without contentType goes out as storage-js' default
  // text/plain;charset=UTF-8 and is rejected — hence the explicit contentType there.
  const pdfBytes = () => new TextEncoder().encode("%PDF-1.4").buffer;
  const postmarkDefault = await uploadAs(
    service,
    `${prefix}/postmark-default-${randomUUID()}.pdf`,
    pdfBytes(),
  );
  check(
    "postmark shape without contentType (text/plain;charset=UTF-8)",
    postmarkDefault.accepted,
    false,
  );
  const postmarkTyped = await uploadAs(
    service,
    `${prefix}/postmark-typed-${randomUUID()}.pdf`,
    pdfBytes(),
    {
      contentType: "application/pdf",
    },
  );
  check(
    "postmark shape with contentType application/pdf",
    postmarkTyped.accepted,
    true,
  );

  // --- 6. size limit ------------------------------------------------------
  const below = await uploadAs(
    office.client,
    `${prefix}/size-below-${randomUUID()}.pdf`,
    new Blob([new Uint8Array(MAX_BYTES - 1024)], { type: "application/pdf" }),
  );
  check("size 50 MiB - 1 KiB", below.accepted, true);
  const above = await uploadAs(
    office.client,
    `${prefix}/size-above-${randomUUID()}.pdf`,
    new Blob([new Uint8Array(MAX_BYTES + 1)], { type: "application/pdf" }),
  );
  check("size 50 MiB + 1 byte", above.accepted, false);

  // --- 7. service_role unaffected by RLS -----------------------------------
  const serviceKey = `${prefix}/service-${randomUUID()}.txt`;
  await seed(serviceKey, "service");
  const { error: serviceRemoveError } = await service.storage
    .from(BUCKET)
    .remove([serviceKey]);
  assert(
    "service_role can remove (cleanup path unchanged)",
    !serviceRemoveError && !(await serviceExists(serviceKey)),
  );
  createdKeys.delete(serviceKey);
};

const cleanup = async () => {
  const keys = [...createdKeys];
  for (let i = 0; i < keys.length; i += 100) {
    const { error } = await service.storage
      .from(BUCKET)
      .remove(keys.slice(i, i + 100));
    if (error) console.error(`cleanup failed: ${error.message}`);
  }
  const { data: leftovers } = await service.storage
    .from(BUCKET)
    .list(prefix, { limit: 1000 });
  if (leftovers?.length) {
    await service.storage
      .from(BUCKET)
      .remove(leftovers.map((entry) => `${prefix}/${entry.name}`));
  }
};

try {
  await main();
} catch (error) {
  console.error(error);
  results.push({ label: `aborted: ${error.message}`, ok: false });
  process.exitCode = 1;
} finally {
  await cleanup();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`=== ${results.length - failed} passed, ${failed} failed ===`);
}
