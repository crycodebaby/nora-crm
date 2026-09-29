import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  BUCKET,
  CONFIRMED_DENIAL_STATUSES,
  EXIT,
  OUTCOME,
  PROBE_CLASS,
  bucketDiff,
  classifyAdminKey,
  classifyExactUrlProbe,
  parseProbeUrl,
  runSetPrivate,
  runSetPublic,
  viteVariablesHolding,
  visibilityUpdate,
} from "./privacy_control.mjs";

/**
 * W8-E Stage C control plane (Alpha Storage 6).
 *
 * The procedure an operator runs against Production, driven here with an
 * in-memory Storage fake. The fake mirrors storage-api v1.77 semantics
 * (an omitted control is left unchanged) unless a test injects a server
 * fault. The same procedure runs against a real local Storage API in
 * supabase/tests/attachment_privacy_verification.mjs.
 */

const URL_BASE = "https://ref.supabase.co";
const KEY = "0a1b2c.txt";
const PROBE_URL = `${URL_BASE}/storage/v1/object/public/attachments/${KEY}`;
const MIME = ["image/png", "application/pdf", "text/plain"];

type Bucket = {
  id: string;
  name: string;
  public: boolean;
  file_size_limit: number | null;
  allowed_mime_types: string[] | null;
  created_at: string;
  updated_at: string;
};
type UpdateBody = {
  public: boolean;
  fileSizeLimit?: number | null;
  allowedMimeTypes?: string[] | null;
};
type Probe = {
  status?: number;
  bytes?: number;
  sha256?: string;
  headers?: Record<string, string>;
  error?: string;
};

const bucket = (id: string, over: Partial<Bucket> = {}): Bucket => ({
  id,
  name: id,
  public: true,
  file_size_limit: id === "branding" ? 5242880 : 52428800,
  allowed_mime_types: id === "branding" ? ["image/png"] : [...MIME],
  created_at: "2026-07-17T22:25:12.203Z",
  updated_at: "2026-07-17T22:25:12.203Z",
  ...over,
});

type World = ReturnType<typeof makeWorld>;

const makeWorld = (
  opts: {
    attachmentsPublic?: boolean;
    /** Server-side behaviour of PUT /bucket; may mutate the stored row. */
    onUpdate?: (
      id: string,
      body: UpdateBody,
      stored: Map<string, Bucket>,
    ) => { error?: { message: string } } | void;
    /** Anonymous callers can list/sign (a widened policy). */
    anonExposed?: boolean;
    /** How many post-flip requests of the exact URL a CDN still answers. */
    cdnStaleResponses?: number;
    /** Reads fail after N successful getBucket calls. */
    readFailsAfter?: number;
    /** A cached error keeps the public URL dark for N requests after going public. */
    cachedErrorResponses?: number;
    /**
     * Scripted answers of the exact URL once the bucket is private, in order
     * (the last one repeats). "throw" makes the probe port itself reject.
     * Overrides `cdnStaleResponses`.
     */
    exactUrlAfterFlip?: (Probe | "throw")[];
  } = {},
) => {
  const stored = new Map<string, Bucket>([
    [BUCKET, bucket(BUCKET, { public: opts.attachmentsPublic ?? true })],
    ["branding", bucket("branding")],
  ]);
  const updates: { id: string; body: UpdateBody }[] = [];
  const probes: { url: string; auth: string }[] = [];
  let reads = 0;
  let cdnStale = opts.cdnStaleResponses ?? 0;
  let cachedErrors = opts.cachedErrorResponses ?? 0;
  const script = [...(opts.exactUrlAfterFlip ?? [])];
  let clock = 0;

  const admin = {
    getBucket: async (id: string) => {
      reads += 1;
      if (opts.readFailsAfter != null && reads > opts.readFailsAfter) {
        return { data: null, error: { message: "network down" } };
      }
      const row = stored.get(id);
      return row
        ? { data: structuredClone(row), error: null }
        : { data: null, error: { message: "Bucket not found" } };
    },
    updateBucket: async (id: string, body: UpdateBody) => {
      updates.push({ id, body: structuredClone(body) });
      const injected = opts.onUpdate?.(id, body, stored);
      if (injected?.error) return { data: null, error: injected.error };
      const row = stored.get(id);
      if (!row) return { data: null, error: { message: "Bucket not found" } };
      row.public = body.public;
      if (body.fileSizeLimit !== undefined) row.file_size_limit = body.fileSizeLimit;
      if (body.allowedMimeTypes !== undefined) {
        row.allowed_mime_types = body.allowedMimeTypes;
      }
      return { data: { message: "Successfully updated" }, error: null };
    },
    from: () => ({
      createSignedUrl: async () => ({
        data: { signedUrl: "https://signed" },
        error: null,
      }),
      list: async () => ({ data: [{ name: KEY }], error: null }),
    }),
  };
  const anon = {
    from: () => ({
      list: async () => ({ data: opts.anonExposed ? [{ name: KEY }] : [], error: null }),
      createSignedUrl: async () =>
        opts.anonExposed
          ? { data: { signedUrl: "https://signed" }, error: null }
          : { data: null, error: { message: "Object not found" } },
    }),
  };
  const ok: Probe = { status: 200, bytes: 12, sha256: "aa", headers: {} };
  const denied: Probe = { status: 400, bytes: 88, sha256: "bb", headers: {} };
  const probe = async (url: string, auth: string): Promise<Probe> => {
    probes.push({ url, auth });
    const isPublic = stored.get(BUCKET)!.public;
    if (url === PROBE_URL) {
      if (isPublic) {
        if (cachedErrors > 0) {
          cachedErrors -= 1;
          return denied;
        }
        return ok;
      }
      if (script.length) {
        const next = script.length > 1 ? script.shift()! : script[0];
        if (next === "throw") throw new Error("fetch failed: ECONNRESET");
        return next;
      }
      if (cdnStale > 0) {
        cdnStale -= 1;
        return { ...ok, headers: { "cf-cache-status": "HIT" } };
      }
      return denied;
    }
    return isPublic || opts.anonExposed ? ok : denied;
  };
  const branding = {
    config: {
      lightModeLogo: `${URL_BASE}/storage/v1/object/public/branding/light.png`,
      darkModeLogo: "./logos/bundled.png",
    } as Record<string, string>,
    companyLogos: [
      { id: 1, logo: { src: `${URL_BASE}/storage/v1/object/public/branding/c.png` } },
    ] as { id: number; logo: { src: string } }[],
  };
  const db = {
    from: (table: string) => {
      if (table === "configuration") {
        return {
          select: async () => ({ data: [{ id: 1, config: branding.config }], error: null }),
        };
      }
      const query = {
        select: () => query,
        not: () => query,
        order: () => query,
        range: async (from: number, to: number) => ({
          data: branding.companyLogos.slice(from, to + 1),
          error: null,
        }),
      };
      return query;
    },
  };
  const io = (apply: boolean) => ({
    admin,
    anon,
    db,
    probe,
    say: () => {},
    sleep: async (ms: number) => {
      clock += ms;
    },
    now: () => clock,
    supabaseUrl: URL_BASE,
    probeUrl: PROBE_URL,
    probeKey: KEY,
    apply,
    cdnWindowS: 60,
    cdnIntervalS: 10,
  });
  return { stored, updates, probes, branding, io };
};

const originalControls = {
  fileSizeLimit: 52428800,
  allowedMimeTypes: MIME,
};

const expectOnlyAttachmentsUpdates = (world: World) =>
  expect(world.updates.every((call) => call.id === "attachments")).toBe(true);

describe("Stage C: public -> private through the Storage API", () => {
  it("flips ONLY `attachments`, echoing its controls, and verifies PRIVATE", async () => {
    const world = makeWorld();
    const result = await runSetPrivate(world.io(true));

    expect(result.outcome).toBe(OUTCOME.privateVerified);
    expect(result.exitCode).toBe(EXIT.ok);
    expect(world.updates).toEqual([
      { id: "attachments", body: { public: false, ...originalControls } },
    ]);
    expect(world.stored.get("attachments")).toMatchObject({
      public: false,
      file_size_limit: 52428800,
      allowed_mime_types: MIME,
    });
    expect(world.stored.get("branding")).toEqual(bucket("branding"));
  });

  it("primes the exact public URL BEFORE the flip and re-probes the same URL after it", async () => {
    const world = makeWorld();
    await runSetPrivate(world.io(true));
    const exact = world.probes.filter((p) => p.url === PROBE_URL);
    expect(exact.length).toBeGreaterThanOrEqual(3); // 2 primes + ≥1 proof
    expect(exact.every((p) => p.auth === "none")).toBe(true);
    // no cache-busting variant of the URL is ever requested
    expect(world.probes.some((p) => /[?#]/.test(p.url))).toBe(false);
  });

  it("checks the anonymous origin routes after the flip", async () => {
    const world = makeWorld();
    await runSetPrivate(world.io(true));
    const urls = world.probes.map((p) => `${p.auth} ${p.url}`);
    expect(urls).toContain(
      `publishable ${URL_BASE}/storage/v1/object/authenticated/attachments/${KEY}`,
    );
    expect(urls).toContain(`none ${URL_BASE}/storage/v1/object/attachments/${KEY}`);
  });

  it("a dry run mutates nothing", async () => {
    const world = makeWorld();
    const result = await runSetPrivate(world.io(false));
    expect(result.outcome).toBe(OUTCOME.dryRun);
    expect(world.updates).toEqual([]);
  });

  it("refuses an ALREADY private bucket: the API never purges from that state", async () => {
    const world = makeWorld({ attachmentsPublic: false });
    const result = await runSetPrivate(world.io(true));
    expect(result.outcome).toBe(OUTCOME.stop);
    expect(result.exitCode).toBe(EXIT.stop);
    expect(world.updates).toEqual([]);
    expect(result.details.stops.join(" ")).toMatch(/already PRIVATE/);
  });

  it("refuses BEFORE mutating when anonymous callers can list or sign (widened policy)", async () => {
    const world = makeWorld({ anonExposed: true });
    const result = await runSetPrivate(world.io(true));
    expect(result.outcome).toBe(OUTCOME.stop);
    expect(world.updates).toEqual([]);
    expect(result.details.stops.join(" ")).toMatch(/RLS exposure BEFORE the flip/);
  });

  it("refuses while a branding reference still points into `attachments` (Stage A incomplete)", async () => {
    const world = makeWorld();
    world.branding.config.darkModeLogo = `${URL_BASE}/storage/v1/object/public/attachments/old.png`;
    world.branding.companyLogos.push({
      id: 2,
      logo: { src: `http://other.host/storage/v1/object/public/attachments/x.png` },
    });
    const result = await runSetPrivate(world.io(true));
    expect(result.outcome).toBe(OUTCOME.stop);
    expect(world.updates).toEqual([]);
    expect(result.details.stops.join(" ")).toMatch(
      /2 branding reference\(s\).*configuration#1\.darkModeLogo, companies#2\.logo/,
    );
  });

  it("reads every page of company logos", async () => {
    const world = makeWorld();
    for (let id = 2; id <= 1200; id += 1) {
      world.branding.companyLogos.push({
        id,
        logo: { src: `${URL_BASE}/storage/v1/object/public/branding/${id}.png` },
      });
    }
    world.branding.companyLogos.push({
      id: 1201,
      logo: { src: `${URL_BASE}/storage/v1/object/public/attachments/late.png` },
    });
    const result = await runSetPrivate(world.io(true));
    expect(result.outcome).toBe(OUTCOME.stop);
    expect(result.details.stops.join(" ")).toMatch(/companies#1201\.logo/);
  });

  it("refuses when branding is not public", async () => {
    const world = makeWorld();
    world.stored.get("branding")!.public = false;
    const result = await runSetPrivate(world.io(true));
    expect(result.outcome).toBe(OUTCOME.stop);
    expect(world.updates).toEqual([]);
  });

  it("an API refusal with the state verified unchanged is STOP / NO MUTATION", async () => {
    const world = makeWorld({
      onUpdate: () => ({ error: { message: "trigger said no" } }),
    });
    const result = await runSetPrivate(world.io(true));
    expect(result.outcome).toBe(OUTCOME.stop);
    expect(result.details.apiError).toBe("trigger said no");
    expect(world.stored.get("attachments")!.public).toBe(true);
  });

  it("a server that drops the MIME allowlist is caught and COMPENSATED with the original controls", async () => {
    const world = makeWorld();
    const io = world.io(true);
    const result = await runSetPrivate({
      ...io,
      admin: {
        ...io.admin,
        updateBucket: async (id: string, body: UpdateBody) => {
          const answer = await io.admin.updateBucket(id, body);
          if (body.public === false) world.stored.get(id)!.allowed_mime_types = null;
          return answer;
        },
      },
    });
    expect(result.outcome).toBe(OUTCOME.compensated);
    expect(result.exitCode).toBe(EXIT.compensated);
    expect(result.details.originalFailures.join(" ")).toMatch(
      /allowed_mime_types/,
    );
    expect(world.updates.at(-1)).toEqual({
      id: "attachments",
      body: { public: true, ...originalControls },
    });
    expect(world.stored.get("attachments")).toMatchObject({
      public: true,
      allowed_mime_types: MIME,
    });
  });

  it("a server that drops the file size limit is caught and COMPENSATED", async () => {
    const world = makeWorld();
    const io = world.io(true);
    const result = await runSetPrivate({
      ...io,
      admin: {
        ...io.admin,
        updateBucket: async (id: string, body: UpdateBody) => {
          const answer = await io.admin.updateBucket(id, body);
          if (body.public === false) world.stored.get(id)!.file_size_limit = null;
          return answer;
        },
      },
    });
    expect(result.outcome).toBe(OUTCOME.compensated);
    expect(result.details.originalFailures.join(" ")).toMatch(/file_size_limit/);
    expect(world.stored.get("attachments")!.file_size_limit).toBe(52428800);
  });

  it("a flip that did not take effect is caught and reported COMPENSATED (verified public)", async () => {
    const world = makeWorld();
    const io = world.io(true);
    const result = await runSetPrivate({
      ...io,
      admin: {
        ...io.admin,
        updateBucket: async (id: string, body: UpdateBody) => {
          const answer = await io.admin.updateBucket(id, body);
          world.stored.get(id)!.public = true; // a keep-public trigger
          return answer;
        },
      },
    });
    expect(result.outcome).toBe(OUTCOME.compensated);
    expect(result.details.originalFailures.join(" ")).toMatch(/not private/);
  });

  it("branding changed by the flip is a critical failure", async () => {
    const world = makeWorld();
    const io = world.io(true);
    const result = await runSetPrivate({
      ...io,
      admin: {
        ...io.admin,
        updateBucket: async (id: string, body: UpdateBody) => {
          const answer = await io.admin.updateBucket(id, body);
          if (body.public === false) world.stored.get("branding")!.public = false;
          return answer;
        },
      },
    });
    expect(result.outcome).toBe(OUTCOME.compensated);
    expect(result.details.originalFailures.join(" ")).toMatch(/"branding" is not public/);
    expectOnlyAttachmentsUpdates(world);
  });

  it("anonymous exposure after the flip is compensated", async () => {
    const world = makeWorld();
    const io = world.io(true);
    let flipped = false;
    const result = await runSetPrivate({
      ...io,
      admin: {
        ...io.admin,
        updateBucket: async (id: string, body: UpdateBody) => {
          flipped = true;
          return io.admin.updateBucket(id, body);
        },
      },
      anon: {
        from: () => ({
          list: async () => ({ data: flipped ? [{ name: KEY }] : [], error: null }),
          createSignedUrl: async () => ({ data: null, error: { message: "no" } }),
        }),
      },
    });
    expect(result.outcome).toBe(OUTCOME.compensated);
    expect(result.details.originalFailures.join(" ")).toMatch(/RLS exposure after the flip/);
  });

  it("a failed compensation is an EMERGENCY that keeps the original failure", async () => {
    const world = makeWorld();
    const io = world.io(true);
    const result = await runSetPrivate({
      ...io,
      admin: {
        ...io.admin,
        updateBucket: async (id: string, body: UpdateBody) => {
          if (body.public === true) {
            return { data: null, error: { message: "compensation refused" } };
          }
          const answer = await io.admin.updateBucket(id, body);
          world.stored.get(id)!.allowed_mime_types = null;
          return answer;
        },
      },
    });
    expect(result.outcome).toBe(OUTCOME.emergency);
    expect(result.exitCode).toBe(EXIT.emergency);
    expect(result.details.originalFailures.join(" ")).toMatch(/allowed_mime_types/);
    expect(result.details.compensationError).toBe("compensation refused");
    expect(result.guidance.join(" ")).toMatch(/Do NOT revert the runtime/);
  });

  it("an unreadable state after the mutation is an EMERGENCY, never success", async () => {
    const world = makeWorld({ readFailsAfter: 2 });
    const result = await runSetPrivate(world.io(true));
    expect(result.outcome).toBe(OUTCOME.emergency);
    expect(world.updates).toHaveLength(1);
  });

  it("a CDN still serving the primed URL within the window: waits, then VERIFIED", async () => {
    const world = makeWorld({ cdnStaleResponses: 3 });
    const result = await runSetPrivate(world.io(true));
    expect(result.outcome).toBe(OUTCOME.privateVerified);
    expect(result.details.attempts.map((a: { status: number }) => a.status)).toEqual([
      200, 200, 200, 400,
    ]);
  });

  it("a CDN still serving after the window is PENDING and is NOT compensated", async () => {
    const world = makeWorld({ cdnStaleResponses: 1000 });
    const result = await runSetPrivate(world.io(true));
    expect(result.outcome).toBe(OUTCOME.privateCdnPending);
    expect(result.exitCode).toBe(EXIT.pending);
    expect(world.updates).toHaveLength(1); // no public:true compensation
    expect(world.stored.get("attachments")!.public).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Alpha Storage 3D LOW-1 — the CDN exact-URL proof accepts ONLY a confirmed
// Storage denial (HTTP 400/404). Everything else is a still-served copy or an
// inconclusive answer, and neither may ever become PRIVATE / VERIFIED.
// ---------------------------------------------------------------------------
const answer = (status: number, bytes = 12): Probe => ({
  status,
  bytes,
  sha256: status < 300 ? "aa" : "bb",
  headers: {},
});
const OBJECT = answer(200); // the original public bytes
const DENIED_400 = answer(400, 88); // the hosted Production denial shape
const transportError: Probe = { error: "fetch failed: getaddrinfo ENOTFOUND" };
type Attempt = { status: number | null; proof: string; error: string | null };
const attemptsOf = (result: { details: { attempts: Attempt[] } }) =>
  result.details.attempts;
const statusesOf = (result: { details: { attempts: Attempt[] } }) =>
  attemptsOf(result).map((attempt) => attempt.status);
const proofsOf = (result: { details: { attempts: Attempt[] } }) =>
  attemptsOf(result).map((attempt) => attempt.proof);
/** cdnWindowS 60 / cdnIntervalS 10: t = 0, 10, …, 60 */
const FULL_WINDOW_ATTEMPTS = 7;

describe("CDN exact-URL proof: only HTTP 400/404 is proof (Alpha Storage 3D LOW-1)", () => {
  describe("classification of one answer", () => {
    it("the accepted denial set is exactly {400, 404}", () => {
      expect([...CONFIRMED_DENIAL_STATUSES].sort()).toEqual([400, 404]);
    });

    it.each([400, 404])("HTTP %i is a confirmed denial", (status) => {
      expect(classifyExactUrlProbe(answer(status, 88))).toBe(
        PROBE_CLASS.denied,
      );
    });

    it.each([200, 203, 204, 206])(
      "HTTP %i is still accessible, never a denial",
      (status) => {
        expect(classifyExactUrlProbe(answer(status))).toBe(
          PROBE_CLASS.accessible,
        );
      },
    );

    it.each([
      301, 302, 304, 307, 401, 403, 405, 408, 409, 410, 425, 429, 500, 502, 503,
      504,
    ])("HTTP %i is inconclusive", (status) => {
      expect(classifyExactUrlProbe(answer(status, 0))).toBe(
        PROBE_CLASS.inconclusive,
      );
    });

    it.each([
      ["a transport error", transportError],
      [
        "a transport error that still carries a status",
        { status: 400, error: "reset" },
      ],
      ["no status", {}],
      ["a string status", { status: "400" }],
      ["a fractional status", { status: 400.5 }],
      ["no result at all", undefined],
    ])("%s is inconclusive", (_, probed) => {
      expect(classifyExactUrlProbe(probed as Probe)).toBe(
        PROBE_CLASS.inconclusive,
      );
    });
  });

  describe("through the real Stage C procedure", () => {
    it.each([400, 404])(
      "HTTP %i right after the flip is PRIVATE / VERIFIED, exit 0",
      async (status) => {
        const world = makeWorld({ exactUrlAfterFlip: [answer(status, 88)] });
        const result = await runSetPrivate(world.io(true));
        expect(result.outcome).toBe(OUTCOME.privateVerified);
        expect(result.exitCode).toBe(EXIT.ok);
        expect(result.details.proof).toBe(PROBE_CLASS.denied);
        expect(statusesOf(result)).toEqual([status]);
      },
    );

    it.each([200, 203, 206])(
      "HTTP %i with the object bytes for the whole window is PENDING (still accessible), not compensated",
      async (status) => {
        const world = makeWorld({ exactUrlAfterFlip: [answer(status)] });
        const result = await runSetPrivate(world.io(true));
        expect(result.outcome).toBe(OUTCOME.privateCdnPending);
        expect(result.exitCode).toBe(EXIT.pending);
        expect(result.details.proof).toBe(PROBE_CLASS.accessible);
        expect(attemptsOf(result)).toHaveLength(FULL_WINDOW_ATTEMPTS);
        expect(result.guidance.join(" ")).toMatch(/STILL returns HTTP/);
        expect(world.updates).toHaveLength(1);
        expect(world.stored.get("attachments")!.public).toBe(false);
      },
    );

    const inconclusive: [string, Probe | "throw"][] = [
      ["a transport error (fetch threw in the probe process)", transportError],
      ["a probe port that rejects", "throw"],
      ["an answer without a status", {}],
      ["HTTP 301", answer(301, 0)],
      ["HTTP 302", answer(302, 0)],
      ["HTTP 401", answer(401, 40)],
      ["HTTP 403", answer(403, 40)],
      ["HTTP 429", answer(429, 20)],
      ["HTTP 500", answer(500, 20)],
      ["HTTP 503", answer(503, 20)],
    ];
    it.each(inconclusive)(
      "%s for the whole window can never be PRIVATE / VERIFIED: PENDING, exit 4, not compensated",
      async (_, response) => {
        const world = makeWorld({ exactUrlAfterFlip: [response] });
        const result = await runSetPrivate(world.io(true));
        expect(result.outcome).not.toBe(OUTCOME.privateVerified);
        expect(result.exitCode).not.toBe(EXIT.ok);
        expect(result.outcome).toBe(OUTCOME.privateCdnPending);
        expect(result.exitCode).toBe(EXIT.pending);
        expect(result.details.proof).toBe(PROBE_CLASS.inconclusive);
        expect(result.guidance.join(" ")).toMatch(
          /INCONCLUSIVE — that is not proof of denial/,
        );
        // kept polling for the whole bounded window, the same URL every time
        expect(attemptsOf(result)).toHaveLength(FULL_WINDOW_ATTEMPTS);
        expect(world.probes.filter((p) => p.url === PROBE_URL)).toHaveLength(
          2 + FULL_WINDOW_ATTEMPTS,
        );
        // uncertainty about one edge copy never re-opens the whole bucket
        expect(world.updates).toHaveLength(1);
        expect(world.stored.get("attachments")!.public).toBe(false);
      },
    );
  });

  describe("mixed sequences — the state machine, not single branches", () => {
    it("A: 200 → 503 → 400 is VERIFIED only at the 400", async () => {
      const world = makeWorld({
        exactUrlAfterFlip: [OBJECT, answer(503, 20), DENIED_400],
      });
      const result = await runSetPrivate(world.io(true));
      expect(result.outcome).toBe(OUTCOME.privateVerified);
      expect(result.exitCode).toBe(EXIT.ok);
      expect(statusesOf(result)).toEqual([200, 503, 400]);
      expect(proofsOf(result)).toEqual([
        "accessible",
        "inconclusive",
        "denied",
      ]);
    });

    it("B: 200 → transport error → 404 is VERIFIED only at the 404", async () => {
      const world = makeWorld({
        exactUrlAfterFlip: [OBJECT, transportError, answer(404, 60)],
      });
      const result = await runSetPrivate(world.io(true));
      expect(result.outcome).toBe(OUTCOME.privateVerified);
      expect(result.exitCode).toBe(EXIT.ok);
      expect(statusesOf(result)).toEqual([200, null, 404]);
      expect(proofsOf(result)).toEqual([
        "accessible",
        "inconclusive",
        "denied",
      ]);
      expect(attemptsOf(result)[1].error).toMatch(/ENOTFOUND/);
    });

    it("C: 503 → 503 → deadline is PENDING, not VERIFIED", async () => {
      const world = makeWorld({
        exactUrlAfterFlip: [answer(503, 20), answer(503, 20)],
      });
      const result = await runSetPrivate(world.io(true));
      expect(result.outcome).toBe(OUTCOME.privateCdnPending);
      expect(result.exitCode).toBe(EXIT.pending);
      expect(statusesOf(result)).toEqual(Array(FULL_WINDOW_ATTEMPTS).fill(503));
      expect(result.details.proof).toBe(PROBE_CLASS.inconclusive);
    });

    it("D: 429 → 200 → deadline is PENDING and reported as still accessible", async () => {
      const world = makeWorld({ exactUrlAfterFlip: [answer(429, 20), OBJECT] });
      const result = await runSetPrivate(world.io(true));
      expect(result.outcome).toBe(OUTCOME.privateCdnPending);
      expect(result.exitCode).toBe(EXIT.pending);
      expect(statusesOf(result)).toEqual([
        429,
        ...Array(FULL_WINDOW_ATTEMPTS - 1).fill(200),
      ]);
      expect(result.details.proof).toBe(PROBE_CLASS.accessible);
      expect(result.guidance.join(" ")).toMatch(
        /cached public copy is being served/,
      );
    });

    it("E: 400 immediately is VERIFIED after one attempt", async () => {
      const world = makeWorld({ exactUrlAfterFlip: [DENIED_400] });
      const result = await runSetPrivate(world.io(true));
      expect(result.outcome).toBe(OUTCOME.privateVerified);
      expect(result.exitCode).toBe(EXIT.ok);
      expect(statusesOf(result)).toEqual([400]);
    });

    it("200 … 200 → 503 as the LAST observation is PENDING (inconclusive), not VERIFIED", async () => {
      const world = makeWorld({
        exactUrlAfterFlip: [
          ...Array(FULL_WINDOW_ATTEMPTS - 1).fill(OBJECT),
          answer(503, 20),
        ],
      });
      const result = await runSetPrivate(world.io(true));
      expect(result.outcome).toBe(OUTCOME.privateCdnPending);
      expect(result.exitCode).toBe(EXIT.pending);
      expect(result.details.proof).toBe(PROBE_CLASS.inconclusive);
      expect(statusesOf(result).at(-1)).toBe(503);
    });
  });
});

// ---------------------------------------------------------------------------
// Alpha Storage 3D LOW-2A / LOW-2B — release-critical postconditions in CI
// ---------------------------------------------------------------------------
describe("a compensation that leaves a control drifted is an EMERGENCY (3D LOW-2A)", () => {
  it("public again, but the allowlist the flip dropped is still missing → EMERGENCY, not COMPENSATED", async () => {
    const world = makeWorld();
    const io = world.io(true);
    const result = await runSetPrivate({
      ...io,
      admin: {
        ...io.admin,
        updateBucket: async (id: string, body: UpdateBody) => {
          world.updates.push({ id, body: structuredClone(body) });
          const row = world.stored.get(id)!;
          row.public = body.public;
          // the flip drops the MIME allowlist; the compensation restores
          // `public` but ignores the echoed controls
          if (body.public === false) row.allowed_mime_types = null;
          return { data: { message: "Successfully updated" }, error: null };
        },
      },
    });
    expect(result.outcome).not.toBe(OUTCOME.compensated);
    expect(result.outcome).toBe(OUTCOME.emergency);
    expect(result.exitCode).toBe(EXIT.emergency);
    expect(world.updates.map((call) => call.body.public)).toEqual([
      false,
      true,
    ]);
    expect(world.stored.get("attachments")).toMatchObject({
      public: true,
      allowed_mime_types: null,
    });
    expect(result.details.originalFailures.join(" ")).toMatch(
      /allowed_mime_types/,
    );
    expect(result.details.bucket).toMatchObject({
      public: true,
      allowed_mime_types: null,
    });
    expect(result.guidance.join(" ")).toMatch(/Do NOT revert the runtime/);
  });

  it("an unrelated failure whose compensation drifts file_size_limit → EMERGENCY, not COMPENSATED", async () => {
    const world = makeWorld();
    const io = world.io(true);
    let flipped = false;
    const result = await runSetPrivate({
      ...io,
      admin: {
        ...io.admin,
        updateBucket: async (id: string, body: UpdateBody) => {
          const answer = await io.admin.updateBucket(id, body);
          if (body.public === false) flipped = true;
          if (body.public === true) world.stored.get(id)!.file_size_limit = 1;
          return answer;
        },
      },
      anon: {
        from: () => ({
          list: async () => ({
            data: flipped ? [{ name: KEY }] : [],
            error: null,
          }),
          createSignedUrl: async () => ({
            data: null,
            error: { message: "no" },
          }),
        }),
      },
    });
    expect(result.outcome).toBe(OUTCOME.emergency);
    expect(result.exitCode).toBe(EXIT.emergency);
    expect(result.details.originalFailures.join(" ")).toMatch(
      /RLS exposure after the flip/,
    );
    expect(result.details.bucket).toMatchObject({
      public: true,
      file_size_limit: 1,
    });
  });
});

describe("/object/authenticated after the flip (3D LOW-2B)", () => {
  const authenticatedUrl = `${URL_BASE}/storage/v1/object/authenticated/attachments/${KEY}`;

  it("the publishable key retrieving the object via /object/authenticated is a critical failure → COMPENSATED", async () => {
    const world = makeWorld();
    const io = world.io(true);
    const served: string[] = [];
    const result = await runSetPrivate({
      ...io,
      probe: async (url: string, auth: string) => {
        if (url === authenticatedUrl && auth === "publishable") {
          served.push(auth);
          return { status: 200, bytes: 12, sha256: "aa", headers: {} };
        }
        return io.probe(url, auth);
      },
    });
    expect(served).toEqual(["publishable"]);
    expect(result.outcome).toBe(OUTCOME.compensated);
    expect(result.exitCode).toBe(EXIT.compensated);
    expect(result.details.originalFailures).toEqual([
      "/object/authenticated served the object to the publishable key",
    ]);
    expect(world.updates.map((call) => call.body.public)).toEqual([
      false,
      true,
    ]);
    expect(world.stored.get("attachments")!.public).toBe(true);
  });

  it("a denied /object/authenticated read with the publishable key passes that postcondition", async () => {
    const world = makeWorld();
    const result = await runSetPrivate(world.io(true));
    expect(
      world.probes.some(
        (p) => p.url === authenticatedUrl && p.auth === "publishable",
      ),
    ).toBe(true);
    expect(result.outcome).toBe(OUTCOME.privateVerified);
    expect(world.updates).toHaveLength(1);
  });
});
describe("Rollback: private -> public through the Storage API", () => {
  it("restores PUBLIC with the original controls and requires the probe URL to serve bytes", async () => {
    const world = makeWorld({ attachmentsPublic: false });
    const result = await runSetPublic(world.io(true));
    expect(result.outcome).toBe(OUTCOME.publicVerified);
    expect(world.updates).toEqual([
      { id: "attachments", body: { public: true, ...originalControls } },
    ]);
  });

  it("an already public bucket is not touched", async () => {
    const world = makeWorld();
    const result = await runSetPublic(world.io(true));
    expect(result.outcome).toBe(OUTCOME.publicVerified);
    expect(world.updates).toEqual([]);
  });

  it("a rollback that did not take effect says STILL PRIVATE — never PUBLIC", async () => {
    const world = makeWorld({
      attachmentsPublic: false,
      onUpdate: () => ({ error: { message: "keep-private trigger" } }),
    });
    const result = await runSetPublic(world.io(true));
    expect(result.outcome).toBe(OUTCOME.stillPrivate);
    expect(result.guidance.join(" ")).toMatch(/Do NOT revert the runtime/);
  });

  it("a cached error on the public URL keeps the runtime revert gated", async () => {
    const world = makeWorld({ attachmentsPublic: false, cachedErrorResponses: 1000 });
    const result = await runSetPublic(world.io(true));
    expect(result.outcome).toBe(OUTCOME.publicReadPending);
    expect(result.exitCode).toBe(EXIT.pending);
  });
});

describe("pure helpers", () => {
  it("the request echoes the controls verbatim", () => {
    expect(visibilityUpdate(bucket("attachments"), false)).toEqual({
      public: false,
      ...originalControls,
    });
  });

  it("bucketDiff sees every field except the allowed ones", () => {
    const before = bucket("attachments");
    expect(bucketDiff(before, { ...before, public: false }, new Set(["public"]))).toEqual([]);
    expect(
      bucketDiff(before, { ...before, allowed_mime_types: null }, new Set(["public"])),
    ).toHaveLength(1);
    expect(
      bucketDiff(before, { ...before, new_field: 1 } as Bucket, new Set(["public"])),
    ).toHaveLength(1);
  });

  it("refuses anything but a privileged credential", () => {
    const jwt = (role: string) =>
      `x.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.y`;
    expect(classifyAdminKey("sb_secret_abc", "sb_publishable_x").kind).toBe("secret key");
    expect(classifyAdminKey(jwt("service_role"), "p").kind).toBe("service_role JWT");
    expect(classifyAdminKey(jwt("anon"), "p").refused).toMatch(/anon/);
    expect(classifyAdminKey("sb_publishable_x", "other").refused).toBeDefined();
    expect(classifyAdminKey("same", "same").refused).toMatch(/publishable/);
    expect(classifyAdminKey("", "p").refused).toBeDefined();
  });

  it("finds a privileged key sitting in a VITE_* variable", () => {
    expect(viteVariablesHolding({ VITE_X: "k", OTHER: "k" }, "k")).toEqual(["VITE_X"]);
    expect(viteVariablesHolding({ VITE_X: "other" }, "k")).toEqual([]);
  });

  it("accepts only the exact public URL of an attachments object on the target", () => {
    expect(parseProbeUrl(URL_BASE, PROBE_URL)).toEqual({ key: KEY });
    for (const bad of [
      `${PROBE_URL}?v=1`,
      `${PROBE_URL}#x`,
      `${URL_BASE}/storage/v1/object/public/branding/${KEY}`,
      `https://other.supabase.co/storage/v1/object/public/attachments/${KEY}`,
      `${URL_BASE}/storage/v1/object/public/attachments/a/b.txt`,
      "",
    ]) {
      expect(parseProbeUrl(URL_BASE, bad).error).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Release contract guards — the repository must not offer a second flip, and
// the runbook must not regress to the defects Alpha Storage 3C found.
// ---------------------------------------------------------------------------
const repo = (path: string) => new URL(`../../../../${path}`, import.meta.url);
const read = (path: string) => readFileSync(repo(path), "utf8").replace(/\r\n/g, "\n");
const privacyDir = "supabase/maintenance/attachment_privacy";
const withoutSqlComments = (sql: string) => sql.replace(/--[^\n]*/g, "");
const withoutSqlLiterals = (sql: string) => sql.replace(/'(?:[^']|'')*'/g, "''");

describe("release contract guards", () => {
  it("no SQL anywhere under supabase/maintenance flips a bucket to private (F-2)", () => {
    const sqlFiles = readdirSync(repo("supabase/maintenance"), {
      recursive: true,
    })
      .map(String)
      .filter((name) => name.endsWith(".sql"));
    expect(sqlFiles.length).toBeGreaterThan(0);
    for (const name of sqlFiles) {
      const sql = withoutSqlComments(read(`supabase/maintenance/${name.replace(/\\/g, "/")}`));
      expect(sql, name).not.toMatch(/public\s*=\s*false/i);
    }
  });

  it("the former SQL flip is gone and the Stage C entry point uses the control module", () => {
    expect(readdirSync(repo(privacyDir))).not.toContain("10_set_attachments_private.sql");
    const cli = read(`${privacyDir}/10_set_attachments_privacy.mjs`);
    const code = cli.slice(cli.indexOf("*/") + 2); // past the header comment
    expect(code).toMatch(/from "\.\/lib\/privacy_control\.mjs"/);
    expect(code).not.toMatch(/storage\.buckets/);
    expect(code).not.toMatch(/updateBucket\(/); // only the module mutates
  });

  it("the control module only READS through PostgREST, and mutates only the attachments bucket", () => {
    const lib = read(`${privacyDir}/lib/privacy_control.mjs`);
    expect(lib).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
    const mutations = lib.match(/update\(admin, [^,]+, /g) ?? [];
    expect(mutations.length).toBeGreaterThan(0);
    expect(mutations.every((call) => call === "update(admin, BUCKET, ")).toBe(true);
    expect(lib).toMatch(/export const BUCKET = "attachments";/);
  });

  it("00 and 30 are ONE read-only statement whose last row is the verdict (F-6)", () => {
    for (const file of ["00_preflight.sql", "30_verify_attachments_private.sql"]) {
      const sql = withoutSqlComments(read(`${privacyDir}/${file}`)).trim();
      const code = withoutSqlLiterals(sql);
      expect(code.split(";").filter((part) => part.trim()).length, file).toBe(1);
      expect(code, file).not.toMatch(/\b(begin|commit|rollback|start\s+transaction)\b/i);
      expect(code, file).not.toMatch(/\b(insert|update|delete|create|drop|alter|set)\s/i);
      expect(sql, file).toMatch(/select 99, '== VERDICT =='[\s\S]*order by seq;$/);
    }
  });

  it("00 and 30 pin the SAME canonical policy definitions, not names (F-3)", () => {
    const block = (file: string) =>
      read(`${privacyDir}/${file}`).match(/with expected_policy[\s\S]*?\n\),/)?.[0];
    const preflight = block("00_preflight.sql");
    expect(preflight).toBeDefined();
    expect(block("30_verify_attachments_private.sql")).toBe(preflight);
    expect(preflight).toMatch(/nora_private\.is_active_user\(\)/);
    expect(preflight).toMatch(/nora_private\.can_write\(\)/);
    expect(preflight).toMatch(/PERMISSIVE\|\{authenticated\}/);
  });

  it("00 and 30 differ ONLY in gate 1 and the verdict — and compare DEFINITIONS (F-3)", () => {
    const body = (file: string) =>
      withoutSqlComments(read(`${privacyDir}/${file}`))
        .trim()
        .replace(
          /select 1, '[^']*',\n\s*coalesce\(\(select (not )?public from bucket where id = 'attachments'\), false\),/,
          "<GATE 1>",
        )
        .replace(/then '(GO|VERIFIED)' else 'STOP' end,/, "<VERDICT>")
        .replace(/then 'all gates PASS[^']*'/, "<PASS TEXT>");
    const preflight = body("00_preflight.sql");
    expect(preflight).toContain("<GATE 1>");
    expect(preflight).toContain("<VERDICT>");
    expect(body("30_verify_attachments_private.sql")).toBe(preflight);
    expect(preflight).toMatch(/a\.fingerprint is not distinct from e\.fingerprint as ok/);
    expect(preflight).toMatch(/left join actual_policy a using \(policyname\)/);
  });

  it("the rollback fallback forces deferred constraints to fire in-statement (F-34)", () => {
    const sql = withoutSqlComments(read(`${privacyDir}/20_set_attachments_public.sql`));
    expect(sql.trim()).toMatch(/^set constraints all immediate;/);
  });

  describe("runbook docs/nora/21 Section 17", () => {
    const runbook = read("docs/nora/21-agent-runbooks.md");
    const section = runbook.slice(runbook.indexOf("## 17. W8-E Release"));

    it("routes Stage C and the rollback through the Storage API tool", () => {
      expect(section).toMatch(/10_set_attachments_privacy\.mjs private/);
      expect(section).toMatch(/10_set_attachments_privacy\.mjs public/);
      expect(section).not.toMatch(/10_set_attachments_private\.sql/);
    });

    it("never asks the login page to prove the relocated branding (F-1)", () => {
      expect(section).not.toMatch(/Login-Seite[^\n]*branding/i);
      expect(section).not.toMatch(/Login-Logo/i);
    });

    it("proves the relocated branding anonymously and on the authenticated Settings surface", () => {
      const between = (from: string, to: string) =>
        section.slice(section.indexOf(from), section.indexOf(to));
      const stageA = between("### Stage A", "### Stage B");
      const postC = between("### Nach Stage C", "### Rollback nach Stage C");
      for (const [stage, text] of [
        ["Stage A", stageA],
        ["post-C", postC],
      ]) {
        const anonymousBrandingProbe = text
          .split("\n")
          .some(
            (line) =>
              /Branding/.test(line) && /probe/.test(line) && /anonym/.test(line),
          );
        expect(anonymousBrandingProbe, stage).toBe(true);
        expect(text, stage).toMatch(/#\/settings/);
      }
    });

    it("requires the exact-URL CDN proof and names all three post-mutation states", () => {
      expect(section).toMatch(/PRIVATE \/ VERIFIED/);
      expect(section).toMatch(/PUBLIC \/ COMPENSATED/);
      expect(section).toMatch(/EMERGENCY \/ STATE REQUIRES MANUAL RECOVERY/);
      expect(section).toMatch(/exakt[^\n]*URL/i);
    });

    it("accepts ONLY HTTP 400/404 as the CDN proof — never 'not 200' (3D LOW-1)", () => {
      expect(section).toMatch(
        /\*\*nur\*\* dann erbracht, wenn der \*\*letzte\*\* Abruf mit \*\*HTTP 400 oder HTTP 404\*\*/,
      );
      for (const inconclusive of ["Transportfehler", "429", "5xx", "3xx"]) {
        expect(section).toContain(inconclusive);
      }
      expect(section).toMatch(/nicht aussagekräftig/);
      expect(section).not.toMatch(/weiterhin kein HTTP 200/);
      expect(section).not.toMatch(/exakte URL liefert nichts/);
    });
  });
});
