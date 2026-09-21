#!/usr/bin/env node
/**
 * Nora W-A — Universal Work Model v1: two-real-session Work Query verification.
 *
 * docs/nora/25 §10.3 and §22 criterion 4 demand the Zwei-Akteure-Test in its
 * strict reading: the SAME Application Query, executed under TWO SEPARATELY
 * AUTHENTICATED sessions of two real employees. Setting different JWT GUCs
 * inside one SQL session does NOT satisfy it — that is the "one session, two
 * actor_id values" reading the freeze explicitly rejects. This harness
 * therefore goes through GoTrue and PostgREST with two genuine logins:
 *
 *   1. two real signInWithPassword logins -> two distinct access tokens
 *   2. Mine(A) and Mine(B) from the same RPC are each exactly that employee's
 *      open work, and they are disjoint
 *   3. is_mine is actor-relative: the same Work row is is_mine for its holder
 *      and not for the other employee
 *   4. Team(A) and Team(B) are the same row set (25 §15 / D-38: no per-employee
 *      scoping in v1), carrying different is_mine values
 *   5. no actor can be supplied: an actor-ish argument makes PostgREST refuse
 *      the call because the signature has no such parameter
 *   6. anon is denied, and so is a token whose session was revoked (sign-out),
 *      although the JWT itself is still cryptographically valid
 *   7. an unknown scope is a 22023 client error through the real API
 *
 * Local only — refuses any non-localhost URL, and is never pointed at
 * Production. Needs Docker and a running local stack with migration
 * 20260922120000 applied:
 *
 *   npx supabase db reset --local
 *   node supabase/tests/work_read_model_session_verification.mjs
 *
 * Keys come from SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY or, when unset,
 * from `npx supabase status -o json`. Role fixtures are applied through
 * `nora_private.apply_sales_role_change` via `docker exec … psql` (container
 * from NORA_DB_CONTAINER, default supabase_db_atomic-crm-demo) — the same
 * fixture path the SQL suites use.
 *
 * Side effects: every company / contact / task this run creates is deleted
 * again. The three auth users (wa-*-<run>@nora.test) stay — since W6-B accounts
 * cannot be hard-deleted without a ticket. Run on a disposable stack; a
 * `db reset` removes them.
 *
 * Exit 0 = all assertions passed · 1 = assertion failure · 2 = prerequisites.
 */

import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const DB_CONTAINER =
  process.env.NORA_DB_CONTAINER || "supabase_db_atomic-crm-demo";

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
  console.error("[w-a] local Supabase stack unavailable:", error.message);
  process.exit(2);
}
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(config.url)) {
  console.error(`[w-a] refusing non-local Supabase URL ${config.url}`);
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
const password = `Wa-${randomUUID()}`;

const results = [];
const assert = (label, condition, detail) => {
  results.push({ label, ok: Boolean(condition) });
  console.log(`${condition ? "OK  " : "FAIL"} ${label}${condition || detail === undefined ? "" : ` — ${detail}`}`);
  if (!condition) process.exitCode = 1;
};
const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
};

const createEmployee = async (label, role) => {
  const email = `wa-${label}-${run}@nora.test`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: "W-A", last_name: label },
  });
  if (error) fail(`createUser ${label}: ${error.message}`);
  const userId = data.user.id;
  const salesId = psql(`
    select nora_private.apply_sales_role_change(
      (select id from public.sales where user_id = '${userId}'), '${role}', false);
    select id from public.sales where user_id = '${userId}';
  `)
    .split("\n")
    .filter((line) => line.trim() !== "")
    .pop();
  return { label, email, userId, salesId: Number(salesId) };
};

const signIn = async (employee) => {
  const client = createClient(config.url, config.anon, clientOptions);
  const { data, error } = await client.auth.signInWithPassword({
    email: employee.email,
    password,
  });
  if (error) fail(`signIn ${employee.label}: ${error.message}`);
  if (!data.session?.access_token) fail(`signIn ${employee.label}: no access token`);
  return { ...employee, client, accessToken: data.session.access_token };
};

const work = async (session, args = {}) => {
  const { data, error } = await session.client.rpc("get_work_items", args);
  return { data, error };
};

const ids = (envelope) => (envelope?.data ?? []).map((item) => item.work_id);
const sorted = (list) => [...list].sort();
const sameSet = (a, b) =>
  a.length === b.length && sorted(a).every((value, index) => value === sorted(b)[index]);

const main = async () => {
  // ---- fixtures ---------------------------------------------------------
  // An admin first so the two office employees can be downgraded from the
  // first-signup role without tripping guard_last_active_admin on an empty
  // database.
  await createEmployee("admin", "admin");
  const one = await createEmployee("one", "office");
  const two = await createEmployee("two", "office");

  const marker = `WA-SESSION-${run}`;
  psql(`
    do $$
    declare
        v_company bigint;
        v_contact bigint;
        v_task bigint;
    begin
        insert into public.companies (name, customer_kind)
        values ('${marker} Kunde', 'business') returning id into v_company;
        insert into public.contacts (first_name, last_name, company_id)
        values ('${marker}', 'Kontakt', v_company) returning id into v_contact;

        -- two open items for employee one, one of them undated
        insert into public.tasks (company_id, contact_id, type, text, due_date, sales_id)
        values (v_company, v_contact, 'Anruf', '${marker} eins A', now() - interval '2 days', ${one.salesId});
        insert into public.tasks (company_id, type, text, due_date, sales_id)
        values (v_company, 'Anruf', '${marker} eins B', null, ${one.salesId});
        -- one open item for employee two
        insert into public.tasks (company_id, type, text, due_date, sales_id)
        values (v_company, 'Anruf', '${marker} zwei A', now() + interval '1 day', ${two.salesId});
        -- one completed item for employee one (must stay out of the default)
        insert into public.tasks (company_id, type, text, due_date, sales_id, done_date)
        values (v_company, 'Anruf', '${marker} eins erledigt', now(), ${one.salesId}, now());
        -- one free item (created held, then released — set_sales_id_default()
        -- is never changed for this, 25 §9.1)
        insert into public.tasks (company_id, type, text, due_date, sales_id)
        values (v_company, 'Anruf', '${marker} frei', null, ${one.salesId})
        returning id into v_task;
        update public.tasks set sales_id = null where id = v_task;
    end;
    $$;
  `);

  // ---- 1. two real, separate logins -------------------------------------
  const sessionOne = await signIn(one);
  const sessionTwo = await signIn(two);
  assert("1. two real GoTrue logins produced two access tokens", Boolean(sessionOne.accessToken && sessionTwo.accessToken));
  assert(
    "1. the two access tokens are distinct",
    sessionOne.accessToken !== sessionTwo.accessToken,
  );
  assert("1. the two employees are distinct sales rows", one.salesId !== two.salesId);

  const expected = (salesId) =>
    psql(`
      select coalesce(string_agg(w, ',' order by w), '') from (
        select public.nora_entity_uuid('task', t.id)::text as w
        from public.tasks t
        where t.done_date is null and t.sales_id = ${salesId}
      ) s;
    `)
      .split(",")
      .filter((value) => value !== "");

  // ---- 2. Mine is per-actor and disjoint --------------------------------
  const mineOne = await work(sessionOne, { p_scope: "mine" });
  const mineTwo = await work(sessionTwo, { p_scope: "mine" });
  assert("2. Mine(one) succeeded", !mineOne.error, mineOne.error?.message);
  assert("2. Mine(two) succeeded", !mineTwo.error, mineTwo.error?.message);
  assert(
    "2. Mine(one) is exactly employee one's open work",
    sameSet(ids(mineOne.data), expected(one.salesId)),
    `${ids(mineOne.data).length} vs ${expected(one.salesId).length}`,
  );
  assert(
    "2. Mine(two) is exactly employee two's open work",
    sameSet(ids(mineTwo.data), expected(two.salesId)),
    `${ids(mineTwo.data).length} vs ${expected(two.salesId).length}`,
  );
  assert(
    "2. the two Mine sets are disjoint",
    !ids(mineOne.data).some((id) => ids(mineTwo.data).includes(id)),
  );
  assert(
    "2. every Mine row reports is_mine = true",
    mineOne.data.data.every((item) => item.is_mine === true) &&
      mineTwo.data.data.every((item) => item.is_mine === true),
  );
  assert(
    "2. completed work stays out of the default basket",
    mineOne.data.data.every((item) => item.state === "open"),
  );

  // ---- 3./4. Team is one set with actor-relative is_mine -----------------
  const teamOne = await work(sessionOne, { p_scope: "team" });
  const teamTwo = await work(sessionTwo, { p_scope: "team" });
  assert("3. Team(one) succeeded", !teamOne.error, teamOne.error?.message);
  assert("3. Team(two) succeeded", !teamTwo.error, teamTwo.error?.message);
  assert(
    "4. Team(one) and Team(two) are the same row set",
    sameSet(ids(teamOne.data), ids(teamTwo.data)),
  );
  const probe = ids(mineTwo.data)[0];
  const seenByOne = teamOne.data.data.find((item) => item.work_id === probe);
  const seenByTwo = teamTwo.data.data.find((item) => item.work_id === probe);
  assert("3. the same Work row is visible to both employees", Boolean(seenByOne && seenByTwo));
  assert(
    "3. is_mine is actor-relative on that very row",
    seenByOne?.is_mine === false && seenByTwo?.is_mine === true,
  );
  assert(
    "3. the holder identity is the same for both actors",
    seenByOne?.holder?.sales_id === two.salesId &&
      seenByTwo?.holder?.sales_id === two.salesId,
  );
  assert(
    "4. free work appears in Team for both and in neither Mine",
    teamOne.data.data.some((item) => item.is_unassigned === true) &&
      teamTwo.data.data.some((item) => item.is_unassigned === true) &&
      !mineOne.data.data.some((item) => item.is_unassigned === true) &&
      !mineTwo.data.data.some((item) => item.is_unassigned === true),
  );

  // ---- 5. no actor can be supplied --------------------------------------
  for (const spoof of [
    { p_scope: "mine", p_actor_sales_id: two.salesId },
    { p_scope: "mine", p_sales_id: two.salesId },
    { p_scope: "mine", p_actor_id: two.userId },
  ]) {
    const attempt = await work(sessionOne, spoof);
    const key = Object.keys(spoof).find((name) => name !== "p_scope");
    assert(
      `5. ${key} is not part of the signature — the call is refused`,
      Boolean(attempt.error),
      JSON.stringify(attempt.data),
    );
  }
  // and the legitimate call still returns employee one's own work only
  const afterSpoof = await work(sessionOne, { p_scope: "mine" });
  assert(
    "5. after the spoofing attempts Mine(one) is unchanged",
    sameSet(ids(afterSpoof.data), expected(one.salesId)),
  );

  // ---- 6. anon and a revoked session ------------------------------------
  const anonAttempt = await anon.rpc("get_work_items", { p_scope: "team" });
  assert("6. anon is denied", Boolean(anonAttempt.error), JSON.stringify(anonAttempt.data));

  const revoked = createClient(config.url, config.anon, {
    ...clientOptions,
    global: { headers: { Authorization: `Bearer ${sessionTwo.accessToken}` } },
  });
  const beforeSignOut = await revoked.rpc("get_work_items", { p_scope: "mine" });
  assert("6. the raw bearer token works while the session is live", !beforeSignOut.error, beforeSignOut.error?.message);
  await sessionTwo.client.auth.signOut();
  const afterSignOut = await revoked.rpc("get_work_items", { p_scope: "mine" });
  assert(
    "6. the same token is refused once the session is revoked (session binding)",
    Boolean(afterSignOut.error) && afterSignOut.error.code === "42501",
    afterSignOut.error ? afterSignOut.error.code : JSON.stringify(afterSignOut.data),
  );

  // ---- 7. client errors through the real API ----------------------------
  const badScope = await work(sessionOne, { p_scope: "everything" });
  assert(
    "7. an unknown scope is a 22023 client error",
    badScope.error?.code === "22023",
    badScope.error ? badScope.error.code : JSON.stringify(badScope.data),
  );
  const halfCursor = await work(sessionOne, {
    p_scope: "team",
    p_cursor_due_at: new Date().toISOString(),
  });
  assert(
    "7. a cursor without work_id is a 22023 client error",
    halfCursor.error?.code === "22023",
    halfCursor.error ? halfCursor.error.code : JSON.stringify(halfCursor.data),
  );
};

const cleanup = () => {
  try {
    psql(`
      delete from public.tasks where text like 'WA-SESSION-${run}%';
      delete from public.contacts where first_name = 'WA-SESSION-${run}';
      delete from public.companies where name = 'WA-SESSION-${run} Kunde';
    `);
  } catch (error) {
    console.error(`cleanup failed: ${error.message}`);
  }
};

try {
  await main();
} catch (error) {
  console.error(error);
  results.push({ label: `aborted: ${error.message}`, ok: false });
  process.exitCode = 1;
} finally {
  cleanup();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`=== ${results.length - failed} passed, ${failed} failed ===`);
}
