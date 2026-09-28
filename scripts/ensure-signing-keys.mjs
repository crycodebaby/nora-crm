#!/usr/bin/env node
/**
 * Generates the local Supabase Auth signing key if it does not exist yet.
 *
 * `supabase/signing_keys.json` holds the ES256 PRIVATE key the local GoTrue
 * signs development tokens with (`signing_keys_path` in supabase/config.toml
 * and config.e2e.toml). It used to be committed. A private key is not source
 * code: anyone with read access to the repository — including every fork,
 * clone, CI log and mirror — could mint a valid token for any local or
 * CI stack, and a committed key is exactly the artifact that later gets copied
 * into a real environment by accident.
 *
 * Production does NOT use this key. Verified read-only against the live
 * project on 2026-09-27: production's JWKS advertises kid
 * 030ac5e8-77f8-4515-811d-5086482abe01 while the previously tracked file held
 * kid b33d4696-c075-4a37-89da-5aac9f60d31c, with a different public point. No
 * production credential rotation is implied or required by untracking it.
 *
 * The file is now generated instead of committed: each machine and each CI run
 * gets its own throwaway key, and the repository carries no secret. The key is
 * written once and then reused, so a local stack keeps working across restarts
 * and existing local sessions stay valid.
 */
import { webcrypto } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(here, "..", "supabase", "signing_keys.json");

async function isUsable(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      typeof parsed[0]?.d === "string" &&
      parsed[0]?.alg === "ES256" &&
      // An entry generated before key_ops was added would start GoTrue-less;
      // treat it as unusable so it is regenerated rather than silently kept.
      Array.isArray(parsed[0]?.key_ops) &&
      parsed[0].key_ops.includes("sign")
    );
  } catch {
    return false;
  }
}

if (await isUsable(target)) {
  console.log(`[signing-keys] reusing existing local key: ${target}`);
  process.exit(0);
}

const { privateKey } = await webcrypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);
const jwk = await webcrypto.subtle.exportKey("jwk", privateKey);

// Shape GoTrue expects, matching the previously tracked file field for field.
// `key_ops` is load-bearing, not decoration: without "sign" in it GoTrue does
// not recognise the entry as a signing key and the auth container dies at
// startup with `Failed to load configuration: no signing key found`.
const key = {
  kty: jwk.kty,
  kid: webcrypto.randomUUID(),
  use: "sig",
  key_ops: ["sign", "verify"],
  alg: "ES256",
  ext: true,
  d: jwk.d,
  crv: jwk.crv,
  x: jwk.x,
  y: jwk.y,
};

await mkdir(dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify([key], null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
console.log(`[signing-keys] generated a new local key (kid ${key.kid})`);
console.log("[signing-keys] local-only and git-ignored; never used in production.");
