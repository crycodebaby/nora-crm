import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

/**
 * The REAL command-line entry point of Stage C (Alpha Storage 3D LOW-2C and
 * LOW-1 end to end): `10_set_attachments_privacy.mjs` is spawned as the
 * operator would run it, against a local fake of the Storage API and
 * PostgREST. The fake mirrors the storage-api request shapes storage-js
 * 2.x sends; it is NOT a Supabase stack (the privacy verifier covers that).
 *
 * The probe children are observed through a `--import` recorder: the CLI
 * hands its own Node flags to every probe process it spawns, so the recorder
 * sees the environment each child ACTUALLY received.
 */

const CLI = fileURLToPath(new URL("../10_set_attachments_privacy.mjs", import.meta.url));
const CANARY = `sb_secret_CANARY${randomBytes(12).toString("hex")}`;
const ANON = "sb_publishable_cli_test_anon";
const KEY = "probe.txt";
const OBJECT_BYTES = "exact public object bytes";

type Seen = { method: string; path: string; headers: IncomingMessage["headers"] };
type Step = number | "reset";

const bucketRow = (id: string, isPublic: boolean) => ({
  id,
  name: id,
  owner: "",
  public: isPublic,
  type: "STANDARD",
  file_size_limit: id === "branding" ? 5242880 : 52428800,
  allowed_mime_types:
    id === "branding" ? ["image/png"] : ["image/png", "application/pdf", "text/plain"],
  created_at: "2026-07-17T22:25:12.203Z",
  updated_at: "2026-07-17T22:25:12.203Z",
});

/** A fake Storage API + PostgREST. `reflect` makes it echo the credentials it
 * received inside error messages — the worst case for output redaction. */
const fakeSupabase = (opts: { exactAfterFlip?: Step[]; reflect?: boolean } = {}) => {
  const buckets = new Map([
    ["attachments", bucketRow("attachments", true)],
    ["branding", bucketRow("branding", true)],
  ]);
  const seen: Seen[] = [];
  const script = [...(opts.exactAfterFlip ?? [400])];
  const echo = (req: IncomingMessage) =>
    `credentials received: apikey=${req.headers.apikey} authorization=${req.headers.authorization}`;

  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const path = (req.url ?? "").split("?")[0];
      seen.push({ method: req.method ?? "", path, headers: req.headers });
      const admin = req.headers.apikey === CANARY;
      const json = (status: number, value: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(value));
      };
      const denied = () => json(400, { statusCode: "404", error: "not_found", message: "Object not found" });

      const bucket = path.match(/^\/storage\/v1\/bucket\/([^/]+)$/);
      if (bucket && req.method === "GET") {
        if (opts.reflect && bucket[1] === "branding") {
          return json(400, { statusCode: "400", error: "reflect", message: echo(req) });
        }
        const row = buckets.get(bucket[1]);
        return row ? json(200, row) : json(404, { message: "Bucket not found" });
      }
      if (bucket && req.method === "PUT" && admin) {
        const row = buckets.get(bucket[1])!;
        const update = JSON.parse(body);
        row.public = update.public;
        if (update.file_size_limit !== undefined) row.file_size_limit = update.file_size_limit;
        if (update.allowed_mime_types !== undefined) row.allowed_mime_types = update.allowed_mime_types;
        row.updated_at = new Date().toISOString();
        return json(200, { message: "Successfully updated" });
      }
      if (path === "/storage/v1/object/list/attachments") {
        return json(200, admin ? [{ name: KEY, id: "1", metadata: {} }] : []);
      }
      if (path === `/storage/v1/object/sign/attachments/${KEY}`) {
        return admin
          ? json(200, { signedURL: `/object/sign/attachments/${KEY}?token=t` })
          : denied();
      }
      if (path.startsWith("/rest/v1/")) {
        if (opts.reflect && path === "/rest/v1/configuration") {
          return json(401, { message: echo(req) });
        }
        return json(200, []);
      }
      if (path === `/storage/v1/object/public/attachments/${KEY}`) {
        if (buckets.get("attachments")!.public) {
          res.writeHead(200, { "content-type": "text/plain" });
          return res.end(OBJECT_BYTES);
        }
        const step = script.length > 1 ? script.shift()! : script[0];
        if (step === "reset") return req.socket.destroy();
        if (step >= 200 && step < 300) {
          res.writeHead(step, { "content-type": "text/plain" });
          return res.end(OBJECT_BYTES);
        }
        return json(step, { statusCode: String(step), error: "e", message: "m" });
      }
      if (path.startsWith("/storage/v1/object/")) return denied();
      return json(404, { message: "no route" });
    });
  });
  return { server, seen, buckets };
};

let envDir: string;
let recorder: string;
let servers: Server[] = [];

beforeAll(() => {
  envDir = mkdtempSync(join(tmpdir(), "w8e-cli-"));
  recorder = join(envDir, "record-probe-env.mjs");
  writeFileSync(
    recorder,
    [
      'import { writeFileSync } from "node:fs";',
      'import { join } from "node:path";',
      'if (process.argv[2] === "probe" && process.env.NORA_TEST_ENV_DIR) {',
      "  writeFileSync(",
      "    join(process.env.NORA_TEST_ENV_DIR, `probe-${process.pid}-${Date.now()}.json`),",
      "    JSON.stringify({ argv: process.argv.slice(2), env: process.env }),",
      "  );",
      "}",
      "",
    ].join("\n"),
  );
});

afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
  servers = [];
  for (const name of readdirSync(envDir)) {
    if (name.startsWith("probe-")) rmSync(join(envDir, name));
  }
});

afterAll(() => rmSync(envDir, { recursive: true, force: true }));

const listen = async (server: Server) => {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

/** Runs the CLI exactly as an operator would, with a controlled environment. */
const runCli = (args: string[], env: Record<string, string>) =>
  new Promise<{ code: number | null; out: string; result: Record<string, unknown> }>(
    (resolve, reject) => {
      const base = Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) => !/^(VITE_|NORA_|SUPABASE_)/.test(name),
        ),
      );
      const child = spawn(
        process.execPath,
        [`--import=${pathToFileURL(recorder).href}`, CLI, ...args],
        { env: { ...base, NORA_TEST_ENV_DIR: envDir, ...env } },
      );
      let out = "";
      child.stdout.on("data", (chunk) => (out += chunk));
      child.stderr.on("data", (chunk) => (out += chunk));
      child.on("error", reject);
      child.on("close", (code) => {
        const line = out.split("\n").findLast((l) => l.startsWith("NORA_W8E_RESULT "));
        resolve({
          code,
          out,
          result: line ? JSON.parse(line.slice("NORA_W8E_RESULT ".length)) : {},
        });
      });
    },
  );

const credentials = (url: string) => ({
  SUPABASE_URL: url,
  SUPABASE_ANON_KEY: ANON,
  NORA_STORAGE_ADMIN_KEY: CANARY,
});
const stageArgs = (url: string, ...extra: string[]) => [
  "private",
  `--target=${new URL(url).host}`,
  `--probe-url=${url}/storage/v1/object/public/attachments/${KEY}`,
  "--cdn-window-seconds=2",
  "--cdn-interval-seconds=1",
  ...extra,
];
const recordedProbeChildren = () =>
  readdirSync(envDir)
    .filter((name) => name.startsWith("probe-"))
    .map(
      (name) =>
        JSON.parse(readFileSync(join(envDir, name), "utf8")) as {
          argv: string[];
          env: Record<string, string>;
        },
    );

const TIMEOUT = 60_000;

describe("CLI credential boundary (Alpha Storage 3D LOW-2C)", () => {
  it(
    "refuses a privileged key that also sits in a VITE_* variable — before any request",
    async () => {
      const fake = fakeSupabase();
      const url = await listen(fake.server);
      const run = await runCli(stageArgs(url, "--apply"), {
        ...credentials(url),
        VITE_SUPABASE_SERVICE_KEY: CANARY,
      });
      expect(run.code).toBe(64);
      expect(run.result.outcome).toBe("STOP / NO MUTATION");
      expect(run.out).toMatch(/also present in VITE_SUPABASE_SERVICE_KEY/);
      expect(fake.seen).toEqual([]); // not one request, let alone a mutation
      expect(fake.buckets.get("attachments")!.public).toBe(true);
      expect(run.out).not.toContain(CANARY);
    },
    TIMEOUT,
  );

  it(
    "never prints the privileged key, even when the server reflects it into errors",
    async () => {
      const fake = fakeSupabase({ reflect: true });
      const url = await listen(fake.server);
      const run = await runCli(stageArgs(url), credentials(url));
      // the reflection really reached the output — as <redacted>
      expect(run.out).toMatch(/credentials received: apikey=<redacted>/);
      expect(JSON.stringify(run.result)).toMatch(/apikey=<redacted>/);
      expect(run.out).not.toContain(CANARY);
      expect(run.code).toBe(1);
      expect(run.result.outcome).toBe("STOP / NO MUTATION");
      expect(fake.seen.some((r) => r.method === "PUT")).toBe(false);
    },
    TIMEOUT,
  );

  it(
    "every probe child receives no privileged credential and sends none",
    async () => {
      const fake = fakeSupabase({ exactAfterFlip: [400] });
      const url = await listen(fake.server);
      const run = await runCli(stageArgs(url, "--apply"), credentials(url));
      expect(run.code).toBe(0);
      expect(run.result.outcome).toBe("PRIVATE / VERIFIED");

      const children = recordedProbeChildren();
      // 2 primes + /object/authenticated + /object/<bucket>/<key> + 1 CDN proof
      expect(children).toHaveLength(5);
      expect(children.some((c) => c.argv.includes("--auth=publishable"))).toBe(true);
      for (const child of children) {
        expect(child.env).not.toHaveProperty("NORA_STORAGE_ADMIN_KEY");
        const holding = Object.entries(child.env)
          .filter(([, value]) => String(value).includes(CANARY))
          .map(([name]) => name);
        expect(holding).toEqual([]);
      }
      const probeRequests = fake.seen.filter(
        (r) => r.method === "GET" && r.path.startsWith("/storage/v1/object/"),
      );
      expect(probeRequests.length).toBeGreaterThanOrEqual(5);
      for (const request of probeRequests) {
        expect(JSON.stringify(request.headers)).not.toContain(CANARY);
      }
      expect(run.out).not.toContain(CANARY);
    },
    TIMEOUT,
  );
});

describe("CLI exit codes for the CDN exact-URL proof (Alpha Storage 3D LOW-1, end to end)", () => {
  it.each([
    [400, 0, "PRIVATE / VERIFIED", "denied"],
    [404, 0, "PRIVATE / VERIFIED", "denied"],
    [503, 4, "PRIVATE / VERIFIED — CDN PROOF PENDING", "inconclusive"],
    [429, 4, "PRIVATE / VERIFIED — CDN PROOF PENDING", "inconclusive"],
    [302, 4, "PRIVATE / VERIFIED — CDN PROOF PENDING", "inconclusive"],
    [200, 4, "PRIVATE / VERIFIED — CDN PROOF PENDING", "accessible"],
    ["reset", 4, "PRIVATE / VERIFIED — CDN PROOF PENDING", "inconclusive"],
  ] as [Step, number, string, string][])(
    "exact URL answering %s after the flip → exit %i %s",
    async (step, code, outcome, proof) => {
      const fake = fakeSupabase({ exactAfterFlip: [step] });
      const url = await listen(fake.server);
      const run = await runCli(stageArgs(url, "--apply"), credentials(url));
      expect(run.code).toBe(code);
      expect(run.result.outcome).toBe(outcome);
      expect(run.result.proof).toBe(proof);
      // CDN uncertainty never re-opens the bucket
      expect(fake.seen.filter((r) => r.method === "PUT")).toHaveLength(1);
      expect(fake.buckets.get("attachments")!.public).toBe(false);
    },
    TIMEOUT,
  );

  it(
    "the standalone `probe` follow-up classifies its answer",
    async () => {
      const fake = fakeSupabase({ exactAfterFlip: [503] });
      fake.buckets.get("attachments")!.public = false;
      const url = await listen(fake.server);
      const probed = await runCli(
        ["probe", `--url=${url}/storage/v1/object/public/attachments/${KEY}`],
        {},
      );
      expect(probed.code).toBe(0);
      expect(JSON.parse(probed.out.trim().split("\n").at(-1)!)).toMatchObject({
        status: 503,
        classification: "inconclusive",
      });
    },
    TIMEOUT,
  );
});
