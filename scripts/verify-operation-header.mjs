#!/usr/bin/env node
/**
 * Local HTTP diagnostic: prove x-nora-operation-id reaches PostgreSQL
 * via PostgREST and lands in audit_events.request_id.
 *
 * Prerequisites (local only — never production):
 *   1. Docker Desktop running
 *   2. npx supabase start
 *   3. Migration 20260810160000 applied (db reset)
 *   4. Env: SUPABASE_URL, SUPABASE_ANON_KEY, and a test user session
 *      or SUPABASE_SERVICE_ROLE_KEY for a controlled probe
 *
 * Usage:
 *   node scripts/verify-operation-header.mjs
 *
 * Exit 0 = header correlation verified (+ no-header NULL path).
 * Exit 2 = local stack unavailable / prerequisites missing.
 */

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const anon =
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SB_PUBLISHABLE_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || (!anon && !service)) {
  console.error(
    "[verify-operation-header] Missing SUPABASE_URL and anon/service key.",
  );
  console.error(
    "Start local Supabase first, then re-run. This script must not target production.",
  );
  process.exit(2);
}

if (String(url).includes("kixxroxtfzbcbzctohex")) {
  console.error(
    "[verify-operation-header] Refusing production project URL. Local only.",
  );
  process.exit(2);
}

const HEADER = "x-nora-operation-id";
const operationId = randomUUID();

const client = createClient(url, service || anon, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  // Probe helper via RPC is intentionally not exposed; use a deal PATCH with header.
  const { data: deals, error: listError } = await client
    .from("deals")
    .select("id")
    .is("archived_at", null)
    .limit(1);

  if (listError) {
    console.error(
      "[verify-operation-header] list deals failed:",
      listError.message,
    );
    process.exit(2);
  }
  if (!deals?.length) {
    console.error("[verify-operation-header] No deal row available for probe.");
    process.exit(2);
  }

  const dealId = deals[0].id;
  const marker = `opcorr-probe-${operationId.slice(0, 8)}`;

  const { error: updateError } = await client
    .from("deals")
    .update({ description: marker })
    .eq("id", dealId)
    .setHeader(HEADER, operationId);

  if (updateError) {
    console.error(
      "[verify-operation-header] update with header failed:",
      updateError.message,
    );
    process.exit(1);
  }

  // Admin/service can read audit_events directly; authenticated office cannot.
  const { data: events, error: auditError } = await client
    .from("audit_events")
    .select("id, request_id, event_type, deal_id")
    .eq("deal_id", dealId)
    .eq("request_id", operationId)
    .order("created_at", { ascending: false })
    .limit(5);

  if (auditError) {
    console.error(
      "[verify-operation-header] audit read failed (need admin/service):",
      auditError.message,
    );
    process.exit(2);
  }

  if (!events?.length) {
    console.error(
      "[verify-operation-header] FAIL: no audit_events.request_id match for",
      operationId,
    );
    console.error(
      "Header may not reach PostgREST/Postgres, or writer not deployed.",
    );
    process.exit(1);
  }

  console.log(
    "[verify-operation-header] OK — header reached PostgreSQL audit request_id:",
    operationId,
  );
  console.log(JSON.stringify(events[0], null, 2));

  // -----------------------------------------------------------------------
  // No-header path: business write succeeds; newest deal.updated has NULL
  // request_id (soft correlation; old frontend compatible).
  // -----------------------------------------------------------------------
  const noHeaderMarker = `opcorr-nohdr-${operationId.slice(0, 8)}`;
  const beforeNoHeader = new Date().toISOString();
  const { error: noHeaderError } = await client
    .from("deals")
    .update({ description: noHeaderMarker })
    .eq("id", dealId);

  if (noHeaderError) {
    console.error(
      "[verify-operation-header] update WITHOUT header failed:",
      noHeaderError.message,
    );
    process.exit(1);
  }

  const { data: noHeaderEvents, error: noHeaderAuditError } = await client
    .from("audit_events")
    .select("id, request_id, event_type, deal_id, created_at")
    .eq("deal_id", dealId)
    .eq("event_type", "deal.updated")
    .gte("created_at", beforeNoHeader)
    .order("created_at", { ascending: false })
    .limit(3);

  if (noHeaderAuditError) {
    console.error(
      "[verify-operation-header] no-header audit read failed:",
      noHeaderAuditError.message,
    );
    process.exit(2);
  }

  const latest = noHeaderEvents?.[0];
  if (!latest) {
    console.error(
      "[verify-operation-header] FAIL: no deal.updated audit row after no-header write",
    );
    process.exit(1);
  }
  if (latest.request_id != null) {
    console.error(
      "[verify-operation-header] FAIL: expected NULL request_id without header, got",
      latest.request_id,
    );
    process.exit(1);
  }

  console.log(
    "[verify-operation-header] OK — update without header left request_id NULL",
  );
}

main().catch((err) => {
  console.error("[verify-operation-header] unexpected error", err);
  process.exit(1);
});
