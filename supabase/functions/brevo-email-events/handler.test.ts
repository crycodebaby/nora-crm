import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  handleBrevoWebhook,
  MAX_EVENTS_PER_REQUEST,
  type IngestEvent,
} from "./handler";
import type { NormalisedEmailEvent } from "./eventContract";
import { readBearerToken, secureEquals } from "./webhookAuth";

const TOKEN = "test-webhook-token-value";

const deliveredPayload = {
  event: "delivered",
  email: "employee@example.test",
  "message-id": "<msg-1@smtp-relay.example>",
  id: 111,
  ts_event: 1788523200,
  subject: "Einladung zu Nora",
};

function request(
  body: unknown,
  init: { token?: string | null; method?: string } = {},
): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = init.token === undefined ? TOKEN : init.token;
  if (token !== null) headers.Authorization = `Bearer ${token}`;

  const method = init.method ?? "POST";
  return new Request("https://example.test/brevo-email-events", {
    method,
    headers,
    // GET/HEAD requests cannot carry a body — the method check must fire first
    // regardless, which is exactly what this lets us assert.
    body:
      method === "GET" || method === "HEAD"
        ? undefined
        : typeof body === "string"
          ? body
          : JSON.stringify(body),
  });
}

/** Stand-in for the ingest RPC, with a real duplicate-suppressing store. */
function createIngestSpy() {
  const stored = new Map<string, NormalisedEmailEvent>();
  const calls: NormalisedEmailEvent[] = [];

  const ingest: IngestEvent = async (event) => {
    calls.push(event);
    if (stored.has(event.dedupeKey)) return { stored: false };
    stored.set(event.dedupeKey, event);
    return { stored: true };
  };

  return { ingest, calls, stored };
}

describe("handleBrevoWebhook — authentication", () => {
  let ingestSpy: ReturnType<typeof createIngestSpy>;

  beforeEach(() => {
    ingestSpy = createIngestSpy();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("rejects an unauthenticated request", async () => {
    const response = await handleBrevoWebhook(
      request(deliveredPayload, { token: null }),
      { expectedToken: TOKEN, ingest: ingestSpy.ingest },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(ingestSpy.calls).toHaveLength(0);
  });

  it("rejects a wrong bearer token", async () => {
    const response = await handleBrevoWebhook(
      request(deliveredPayload, { token: "not-the-token" }),
      { expectedToken: TOKEN, ingest: ingestSpy.ingest },
    );

    expect(response.status).toBe(401);
    expect(ingestSpy.calls).toHaveLength(0);
  });

  it("rejects a token that is only a prefix of the real one", async () => {
    const response = await handleBrevoWebhook(
      request(deliveredPayload, { token: TOKEN.slice(0, -1) }),
      { expectedToken: TOKEN, ingest: ingestSpy.ingest },
    );

    expect(response.status).toBe(401);
  });

  it("does not reveal whether the token was missing or wrong", async () => {
    const missing = await handleBrevoWebhook(
      request(deliveredPayload, { token: null }),
      { expectedToken: TOKEN, ingest: ingestSpy.ingest },
    );
    const wrong = await handleBrevoWebhook(
      request(deliveredPayload, { token: "wrong" }),
      { expectedToken: TOKEN, ingest: ingestSpy.ingest },
    );

    expect(missing.status).toBe(wrong.status);
    await expect(missing.json()).resolves.toEqual(await wrong.json());
  });

  it("accepts a valid bearer token", async () => {
    const response = await handleBrevoWebhook(request(deliveredPayload), {
      expectedToken: TOKEN,
      ingest: ingestSpy.ingest,
    });

    expect(response.status).toBe(200);
    expect(ingestSpy.calls).toHaveLength(1);
  });

  it("refuses a non-POST method before touching the body", async () => {
    const response = await handleBrevoWebhook(
      request(deliveredPayload, { method: "GET" }),
      { expectedToken: TOKEN, ingest: ingestSpy.ingest },
    );

    expect(response.status).toBe(405);
    expect(ingestSpy.calls).toHaveLength(0);
  });
});

describe("secureEquals / readBearerToken", () => {
  it("matches identical values and rejects differing ones", async () => {
    await expect(secureEquals(TOKEN, TOKEN)).resolves.toBe(true);
    await expect(secureEquals(TOKEN, `${TOKEN}x`)).resolves.toBe(false);
    await expect(secureEquals("", TOKEN)).resolves.toBe(false);
  });

  it("reads a bearer token case-insensitively and ignores anything else", () => {
    expect(readBearerToken("bearer abc")).toBe("abc");
    expect(readBearerToken("Bearer  abc ")).toBe("abc");
    expect(readBearerToken("Basic abc")).toBeNull();
    expect(readBearerToken("Bearer ")).toBeNull();
    expect(readBearerToken(null)).toBeNull();
  });
});

describe("handleBrevoWebhook — event contract", () => {
  let ingestSpy: ReturnType<typeof createIngestSpy>;

  beforeEach(() => {
    ingestSpy = createIngestSpy();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  /**
   * Representative payloads in the shape Brevo actually posts, including the
   * snake_case `event` values (which differ from the camelCase names used when
   * subscribing to the webhook) and the fields that only appear on failures.
   */
  const realPayloads: Array<[string, Record<string, unknown>, string]> = [
    [
      "request",
      {
        event: "request",
        email: "employee@example.test",
        id: 1000,
        date: "2026-09-04 14:00:00",
        ts: 1788523200,
        "message-id": "<202609041200.1@smtp-relay.brevo.com>",
        ts_event: 1788523200,
        subject: "Einladung zu Nora",
        "X-Mailin-custom": "",
        sending_ip: "1.2.3.4",
        ts_epoch: 1788523200000,
        tags: [],
      },
      "EMAIL_ACCEPTED",
    ],
    [
      "delivered",
      {
        event: "delivered",
        email: "employee@example.test",
        id: 1001,
        ts_event: 1788523230,
        "message-id": "<202609041200.1@smtp-relay.brevo.com>",
        subject: "Einladung zu Nora",
      },
      "EMAIL_DELIVERED",
    ],
    [
      "deferred",
      {
        event: "deferred",
        email: "employee@example.test",
        id: 1002,
        ts_event: 1788523260,
        "message-id": "<202609041200.1@smtp-relay.brevo.com>",
        reason: "4.2.1 mailbox temporarily unavailable",
      },
      "EMAIL_DEFERRED",
    ],
    [
      "soft_bounce",
      {
        event: "soft_bounce",
        email: "employee@example.test",
        id: 1003,
        ts_event: 1788523290,
        "message-id": "<202609041200.1@smtp-relay.brevo.com>",
        reason: "452 4.2.2 Mailbox full",
      },
      "EMAIL_SOFT_BOUNCED",
    ],
    [
      "hard_bounce",
      {
        event: "hard_bounce",
        email: "employee@example.test",
        id: 1004,
        ts_event: 1788523320,
        "message-id": "<202609041200.2@smtp-relay.brevo.com>",
        reason: "550 5.1.1 Recipient address rejected: User unknown",
      },
      "EMAIL_HARD_BOUNCED",
    ],
    [
      "blocked",
      {
        event: "blocked",
        email: "employee@example.test",
        id: 1005,
        ts_event: 1788523350,
        "message-id": "<202609041200.3@smtp-relay.brevo.com>",
      },
      "EMAIL_BLOCKED",
    ],
    [
      "invalid_email",
      {
        event: "invalid_email",
        email: "employee@example.test",
        id: 1006,
        ts_event: 1788523380,
        "message-id": "<202609041200.4@smtp-relay.brevo.com>",
      },
      "EMAIL_INVALID",
    ],
    [
      "spam",
      {
        event: "spam",
        email: "employee@example.test",
        id: 1007,
        ts_event: 1788523410,
        "message-id": "<202609041200.5@smtp-relay.brevo.com>",
      },
      "EMAIL_SPAM_REPORTED",
    ],
  ];

  it.each(realPayloads)(
    "stores the real %s payload as %s",
    async (_name, payload, expectedEventType) => {
      const response = await handleBrevoWebhook(request(payload), {
        expectedToken: TOKEN,
        ingest: ingestSpy.ingest,
      });

      expect(response.status).toBe(200);
      expect(ingestSpy.calls.at(-1)?.eventType).toBe(expectedEventType);
    },
  );

  it("carries the provider failure reason through for actionable events", async () => {
    await handleBrevoWebhook(
      request({
        event: "hard_bounce",
        email: "employee@example.test",
        id: 2001,
        ts_event: 1788523320,
        "message-id": "<202609041200.9@smtp-relay.brevo.com>",
        reason: "550 5.1.1 Recipient address rejected: User unknown",
      }),
      { expectedToken: TOKEN, ingest: ingestSpy.ingest },
    );

    expect(ingestSpy.calls[0].providerReason).toBe(
      "550 5.1.1 Recipient address rejected: User unknown",
    );
  });

  it("also accepts the camelCase subscription spellings", async () => {
    const subscriptionSpellings: Array<[string, string]> = [
      ["sent", "EMAIL_ACCEPTED"],
      ["softBounce", "EMAIL_SOFT_BOUNCED"],
      ["hardBounce", "EMAIL_HARD_BOUNCED"],
      ["invalid", "EMAIL_INVALID"],
    ];

    for (const [providerEvent, expectedEventType] of subscriptionSpellings) {
      const response = await handleBrevoWebhook(
        request({
          ...deliveredPayload,
          event: providerEvent,
          id: providerEvent,
        }),
        { expectedToken: TOKEN, ingest: ingestSpy.ingest },
      );
      expect(response.status).toBe(200);
      expect(ingestSpy.calls.at(-1)?.eventType).toBe(expectedEventType);
    }
  });

  it.each(["opened", "unique_opened", "uniqueOpened", "click"])(
    "accepts but never stores the tracking event %s",
    async (trackingEvent) => {
      const response = await handleBrevoWebhook(
        request({ ...deliveredPayload, event: trackingEvent }),
        { expectedToken: TOKEN, ingest: ingestSpy.ingest },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        summary: { ignored: 1, stored: 0 },
      });
      expect(ingestSpy.calls).toHaveLength(0);
    },
  );

  it("accepts but never stores an unknown future event", async () => {
    const response = await handleBrevoWebhook(
      request({ ...deliveredPayload, event: "quantumBounce" }),
      { expectedToken: TOKEN, ingest: ingestSpy.ingest },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      summary: { ignored: 1, stored: 0 },
    });
    expect(ingestSpy.calls).toHaveLength(0);
  });

  it("persists no email body, subject, link or token", async () => {
    await handleBrevoWebhook(
      request({
        ...deliveredPayload,
        body: "<html>Zugang</html>",
        link: "https://nora.ergart.de/auth-callback.html#access_token=secret",
        "X-Mailin-custom": "custom",
      }),
      { expectedToken: TOKEN, ingest: ingestSpy.ingest },
    );

    const persisted = JSON.stringify(ingestSpy.calls[0]);
    expect(persisted).not.toContain("access_token");
    expect(persisted).not.toContain("<html>");
    expect(persisted).not.toContain("Einladung zu Nora");
    // The subject itself is not stored — only the kind derived from it.
    expect(ingestSpy.calls[0].mailKind).toBe("employee_invite");
  });
});

describe("handleBrevoWebhook — idempotency and ordering", () => {
  let ingestSpy: ReturnType<typeof createIngestSpy>;

  beforeEach(() => {
    ingestSpy = createIngestSpy();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("stores a redelivered identical event only once", async () => {
    const first = await handleBrevoWebhook(request(deliveredPayload), {
      expectedToken: TOKEN,
      ingest: ingestSpy.ingest,
    });
    const second = await handleBrevoWebhook(request(deliveredPayload), {
      expectedToken: TOKEN,
      ingest: ingestSpy.ingest,
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      summary: { stored: 1, duplicate: 0 },
    });
    await expect(second.json()).resolves.toMatchObject({
      summary: { stored: 0, duplicate: 1 },
    });
    expect(ingestSpy.stored.size).toBe(1);
  });

  it("keeps a duplicate inside one batch from being stored twice", async () => {
    const response = await handleBrevoWebhook(
      request({ items: [deliveredPayload, deliveredPayload] }),
      { expectedToken: TOKEN, ingest: ingestSpy.ingest },
    );

    await expect(response.json()).resolves.toMatchObject({
      summary: { received: 2, stored: 1, duplicate: 1 },
    });
  });

  it("stores out-of-order events for one message as distinct events", async () => {
    // "delivered" arriving before "request" is normal and must not be lost or
    // collapsed: both are real events with their own provider timestamps.
    await handleBrevoWebhook(
      request({
        items: [
          {
            ...deliveredPayload,
            event: "delivered",
            id: 2,
            ts_event: 1788523230,
          },
          {
            ...deliveredPayload,
            event: "request",
            id: 1,
            ts_event: 1788523200,
          },
        ],
      }),
      { expectedToken: TOKEN, ingest: ingestSpy.ingest },
    );

    expect(ingestSpy.stored.size).toBe(2);
    expect(ingestSpy.calls.map((call) => call.eventType)).toEqual([
      "EMAIL_DELIVERED",
      "EMAIL_ACCEPTED",
    ]);
    expect(ingestSpy.calls[0].eventAt).toBe("2026-09-04T12:00:30.000Z");
    expect(ingestSpy.calls[1].eventAt).toBe("2026-09-04T12:00:00.000Z");
  });
});

describe("handleBrevoWebhook — malformed input", () => {
  let ingestSpy: ReturnType<typeof createIngestSpy>;

  beforeEach(() => {
    ingestSpy = createIngestSpy();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("rejects a body that is not JSON", async () => {
    const response = await handleBrevoWebhook(request("{not json"), {
      expectedToken: TOKEN,
      ingest: ingestSpy.ingest,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_payload",
    });
  });

  it("rejects a JSON body that carries no event object", async () => {
    const response = await handleBrevoWebhook(request(JSON.stringify(42)), {
      expectedToken: TOKEN,
      ingest: ingestSpy.ingest,
    });

    expect(response.status).toBe(400);
  });

  it("rejects an oversized batch instead of truncating it", async () => {
    const items = Array.from(
      { length: MAX_EVENTS_PER_REQUEST + 1 },
      (_, i) => ({
        ...deliveredPayload,
        id: i,
      }),
    );

    const response = await handleBrevoWebhook(request({ items }), {
      expectedToken: TOKEN,
      ingest: ingestSpy.ingest,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "batch_too_large",
    });
    expect(ingestSpy.calls).toHaveLength(0);
  });

  it("keeps the good events of a partly malformed batch", async () => {
    const response = await handleBrevoWebhook(
      request({
        items: [
          deliveredPayload,
          { event: "delivered" },
          { ...deliveredPayload, event: "opened" },
        ],
      }),
      { expectedToken: TOKEN, ingest: ingestSpy.ingest },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      summary: { received: 3, stored: 1, malformed: 1, ignored: 1 },
    });
  });

  it("asks for a retry when persistence fails", async () => {
    const failing: IngestEvent = async () => {
      throw new Error("db down");
    };

    const response = await handleBrevoWebhook(request(deliveredPayload), {
      expectedToken: TOKEN,
      ingest: failing,
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: "ingest_failed",
    });
  });
});

describe("product truth boundary", () => {
  it("a delivered event says nothing about onboarding completion", async () => {
    const ingestSpy = createIngestSpy();
    vi.spyOn(console, "error").mockImplementation(() => {});

    await handleBrevoWebhook(request(deliveredPayload), {
      expectedToken: TOKEN,
      ingest: ingestSpy.ingest,
    });

    const event = ingestSpy.calls[0];
    // The whole vocabulary this wave can produce is about the message, not the
    // person: nothing here may be read as "activated", "opened" or "onboarded".
    expect(Object.keys(event)).not.toContain("accessState");
    expect(Object.keys(event)).not.toContain("activatedAt");
    expect(event.eventType).toBe("EMAIL_DELIVERED");
  });
});
