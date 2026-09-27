#!/usr/bin/env node
/**
 * Narrow secret scan over GIT-TRACKED files.
 *
 * Deliberately small. This is not a general-purpose scanner and does not try
 * to be: a noisy check that everyone learns to skip protects nothing. It looks
 * for the handful of shapes that would actually be a leak in THIS repository,
 * and it is the automated control that stops `supabase/signing_keys.json`
 * (F-03) from being re-committed by hand.
 *
 * Scope: files git knows about. Untracked local files — a generated
 * `signing_keys.json`, a personal `.env.local` — are not the repository's
 * problem and are not scanned.
 *
 * Two git-tracked `.env` files are expected to exist and to hold local
 * placeholders: `.env.e2e` and `supabase/functions/.env`. Both are read by the
 * local stack and by CI, both carry a loud "local values only" banner, and
 * both are checked here for REAL secret shapes rather than being exempted
 * wholesale.
 *
 * Usage: node scripts/scan-secrets.mjs
 * Exit code 1 on a finding.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const RULES = [
  {
    id: "private-key-pem",
    description: "PEM private key block",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/,
  },
  {
    id: "jwk-private-key",
    description:
      'private JWK (an "alg"/"kty" key object carrying the private scalar "d")',
    // A public JWK has x/y but no d. Requiring both a key-ish marker and d
    // keeps ordinary JSON with a "d" field from matching.
    pattern:
      /"(?:kty|alg)"\s*:\s*"[^"]+"[^}]{0,200}?"d"\s*:\s*"[A-Za-z0-9_-]{20,}"/,
  },
  {
    id: "supabase-secret-key",
    description: "Supabase secret (service-role) API key",
    pattern: /\bsb_secret_[A-Za-z0-9_-]{16,}/,
  },
  {
    id: "aws-access-key-id",
    description: "AWS access key id",
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    id: "google-oauth-client-secret",
    description: "Google OAuth client secret",
    pattern: /\bGOCSPX-[A-Za-z0-9_-]{20,}/,
  },
  {
    id: "postmark-server-token",
    description: "Postmark server token",
    pattern: /\bPOSTMARK_(?:SERVER|API)_TOKEN\s*=\s*[0-9a-f]{8}-[0-9a-f]{4}-/i,
  },
  {
    id: "brevo-api-key",
    description: "Brevo API key",
    pattern: /\bxkeysib-[A-Za-z0-9]{32,}/,
  },
];

/**
 * Paths whose CONTENT is documentation about secrets rather than a secret.
 * Kept to an explicit, reviewable list — never a wildcard.
 */
const ALLOWLIST = new Set([
  "scripts/scan-secrets.mjs",
  "scripts/ensure-signing-keys.mjs",
]);

/**
 * Exact literals that LOOK like a credential but are fixed, world-readable
 * constants of the Supabase CLI's local stack — the same strings every
 * `supabase start` prints on every machine, for a database bound to 127.0.0.1.
 *
 * Verified to be CLI-wide rather than project-derived: two local projects with
 * different `project_id`s print byte-identical values, and they survive both a
 * signing-key regeneration and `supabase db reset`.
 *
 * This is a VALUE allowlist on purpose, not a path allowlist. Any other
 * `sb_secret_...` — in any file, including the two git-tracked local `.env`
 * files — is still a finding, so pasting a real project's secret key into
 * `.env.e2e` fails the scan exactly as it should.
 */
const LOCAL_CLI_CONSTANTS = new Set([
  "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz",
]);

const SKIP_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".pdf",
  ".zip",
  ".gz",
]);

const MAX_BYTES = 2 * 1024 * 1024;

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

const findings = [];

for (const file of trackedFiles()) {
  if (ALLOWLIST.has(file)) continue;
  const dot = file.lastIndexOf(".");
  if (dot !== -1 && SKIP_EXTENSIONS.has(file.slice(dot).toLowerCase()))
    continue;

  let content;
  try {
    if (statSync(file).size > MAX_BYTES) continue;
    content = readFileSync(file, "utf8");
  } catch {
    continue; // unreadable or binary; nothing to assert
  }
  if (content.includes("\0")) continue;

  for (const rule of RULES) {
    // Every occurrence, not just the first: one allowlisted CLI constant in a
    // file must never hide a real credential further down the same file.
    const pattern = new RegExp(rule.pattern.source, `${rule.pattern.flags}g`);
    for (const match of content.matchAll(pattern)) {
      if (LOCAL_CLI_CONSTANTS.has(match[0])) continue;
      const line = content.slice(0, match.index).split("\n").length;
      findings.push({ file, line, rule });
    }
  }
}

if (findings.length === 0) {
  console.log("[scan-secrets] no tracked secret material found.");
  process.exit(0);
}

console.error("[scan-secrets] tracked secret material found:\n");
for (const { file, line, rule } of findings) {
  console.error(`  ${file}:${line}  ${rule.id} — ${rule.description}`);
}
console.error(
  "\nA secret must not be committed. Remove it from the working tree, add the" +
    "\npath to .gitignore, and rotate the credential if it ever reached a remote." +
    "\nFor the local Supabase signing key run: npm run signing-keys:ensure",
);
process.exit(1);
