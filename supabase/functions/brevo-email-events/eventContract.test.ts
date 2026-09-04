import { describe, expect, it } from "vitest";

import {
  buildDedupeKey,
  classifyMailKind,
  classifyProviderEvent,
  deriveDeliveryOutcome,
  extractEventPayloads,
  normaliseProviderEvent,
  outcomeForEvent,
  type NoraEmailEventType,
} from "./eventContract";

const BASE_EVENT = {
  event: "delivered",
  email: "employee@example.test",
  "message-id": "<202609041200.123@smtp-relay.example>",
  id: 987654,
  ts_event: 1788523200, // 2026-09-04T12:00:00Z
  subject: "Einladung zu Nora",
};

describe("classifyProviderEvent", () => {
  /**
   * The values Brevo actually puts in the payload's `event` field. These are
   * snake_case and differ from the camelCase names used when *subscribing* to
   * the webhook — matching on the subscription spelling alone would drop every
   * bounce silently, so the payload spelling is what the contract is proven
   * against.
   */
  const payloadSpellings: Array<[string, NoraEmailEventType]> = [
    ["request", "EMAIL_ACCEPTED"],
    ["delivered", "EMAIL_DELIVERED"],
    ["deferred", "EMAIL_DEFERRED"],
    ["soft_bounce", "EMAIL_SOFT_BOUNCED"],
    ["hard_bounce", "EMAIL_HARD_BOUNCED"],
    ["blocked", "EMAIL_BLOCKED"],
    ["invalid_email", "EMAIL_INVALID"],
    ["spam", "EMAIL_SPAM_REPORTED"],
  ];

  /** The subscription enum, accepted as well so neither vocabulary can break us. */
  const subscriptionSpellings: Array<[string, NoraEmailEventType]> = [
    ["sent", "EMAIL_ACCEPTED"],
    ["softBounce", "EMAIL_SOFT_BOUNCED"],
    ["hardBounce", "EMAIL_HARD_BOUNCED"],
    ["invalid", "EMAIL_INVALID"],
  ];

  it.each(payloadSpellings)(
    "maps the real payload value %s to the Nora contract",
    (providerEvent, expected) => {
      expect(classifyProviderEvent(providerEvent)).toEqual({
        kind: "supported",
        eventType: expected,
      });
    },
  );

  it.each(subscriptionSpellings)(
    "also accepts the subscription spelling %s",
    (providerEvent, expected) => {
      expect(classifyProviderEvent(providerEvent)).toEqual({
        kind: "supported",
        eventType: expected,
      });
    },
  );

  it("is case and whitespace insensitive", () => {
    expect(classifyProviderEvent("  HARDBOUNCE ")).toEqual({
      kind: "supported",
      eventType: "EMAIL_HARD_BOUNCED",
    });
  });

  it.each(["opened", "unique_opened", "uniqueOpened", "click", "proxy_open"])(
    "classifies the tracking event %s as ignored",
    (trackingEvent) => {
      expect(classifyProviderEvent(trackingEvent)).toEqual({
        kind: "tracking_ignored",
      });
    },
  );

  it("treats an unknown future event as ignorable, not as an error", () => {
    expect(classifyProviderEvent("quantumBounce")).toEqual({
      kind: "unsupported_ignored",
    });
  });

  it("treats a non-string event as ignorable", () => {
    expect(classifyProviderEvent(42)).toEqual({ kind: "unsupported_ignored" });
  });
});

describe("normaliseProviderEvent", () => {
  it("normalises a supported event into the Nora contract", () => {
    const result = normaliseProviderEvent(BASE_EVENT);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    expect(result.event).toMatchObject({
      providerEvent: "delivered",
      eventType: "EMAIL_DELIVERED",
      recipient: "employee@example.test",
      eventAt: "2026-09-04T12:00:00.000Z",
      providerMessageId: "<202609041200.123@smtp-relay.example>",
      providerEventId: "987654",
      mailKind: "employee_invite",
      providerReason: null,
    });
  });

  it("keeps a bounded provider reason", () => {
    const result = normaliseProviderEvent({
      ...BASE_EVENT,
      event: "hard_bounce",
      reason: "550 5.1.1 <employee@example.test>: Recipient address rejected",
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.event.eventType).toBe("EMAIL_HARD_BOUNCED");
    expect(result.event.providerReason).toBe(
      "550 5.1.1 <employee@example.test>: Recipient address rejected",
    );
  });

  it("truncates an oversized provider reason", () => {
    const result = normaliseProviderEvent({
      ...BASE_EVENT,
      event: "soft_bounce",
      reason: "x".repeat(900),
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.event.providerReason).toHaveLength(500);
  });

  it("never carries an email body, link or token into the contract", () => {
    const result = normaliseProviderEvent({
      ...BASE_EVENT,
      body: "<html>Ihr Zugang zu Nora</html>",
      link: "https://nora.ergart.de/auth-callback.html#access_token=secret",
      token: "one-time-token",
      "X-Mailin-custom": "whatever",
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    const serialised = JSON.stringify(result.event);
    expect(serialised).not.toContain("Ihr Zugang zu Nora");
    expect(serialised).not.toContain("access_token");
    expect(serialised).not.toContain("one-time-token");
    expect(Object.keys(result.event).sort()).toEqual([
      "dedupeKey",
      "eventAt",
      "eventType",
      "mailKind",
      "providerEvent",
      "providerEventId",
      "providerMessageId",
      "providerReason",
      "recipient",
    ]);
  });

  it("ignores a tracking event instead of normalising it", () => {
    expect(normaliseProviderEvent({ ...BASE_EVENT, event: "opened" })).toEqual({
      status: "ignored",
      providerEvent: "opened",
      why: "tracking",
    });
  });

  it("ignores an unknown event", () => {
    expect(
      normaliseProviderEvent({ ...BASE_EVENT, event: "listAddition" }),
    ).toEqual({
      status: "ignored",
      providerEvent: "listaddition",
      why: "unsupported",
    });
  });

  it.each([
    [null, "not_an_object"],
    ["delivered", "not_an_object"],
    [[], "not_an_object"],
  ])("rejects %s as malformed", (payload, why) => {
    expect(normaliseProviderEvent(payload)).toEqual({
      status: "malformed",
      why,
    });
  });

  it("rejects a payload without an event name", () => {
    expect(normaliseProviderEvent({ email: "a@b.test" })).toEqual({
      status: "malformed",
      why: "missing_event",
    });
  });

  it("rejects a supported event without a usable recipient", () => {
    expect(
      normaliseProviderEvent({ ...BASE_EVENT, email: "not-an-address" }),
    ).toEqual({ status: "malformed", why: "missing_recipient" });
  });

  it("rejects a supported event without a usable timestamp", () => {
    const { ts_event: _dropped, ...withoutTimestamp } = BASE_EVENT;
    expect(normaliseProviderEvent(withoutTimestamp)).toEqual({
      status: "malformed",
      why: "missing_event_timestamp",
    });
  });

  it("accepts a millisecond epoch without shifting the event into the future", () => {
    const { ts_event: _dropped, ...rest } = BASE_EVENT;
    const result = normaliseProviderEvent({
      ...rest,
      ts_epoch: 1788523200000,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.event.eventAt).toBe("2026-09-04T12:00:00.000Z");
  });

  it("falls back to the date field when no epoch is present", () => {
    const { ts_event: _dropped, ...rest } = BASE_EVENT;
    const result = normaliseProviderEvent({
      ...rest,
      date: "2026-09-04 14:00:00+02:00",
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.event.eventAt).toBe("2026-09-04T12:00:00.000Z");
  });

  it("classifies an unrelated subject as an unknown mail kind", () => {
    const result = normaliseProviderEvent({
      ...BASE_EVENT,
      subject: "Newsletter September",
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.event.mailKind).toBe("unknown");
  });
});

describe("classifyMailKind", () => {
  it("recognises the invitation subject", () => {
    expect(classifyMailKind("Einladung zu Nora")).toBe("employee_invite");
  });

  it("recognises the password setup subject", () => {
    expect(classifyMailKind("Persönliches Passwort für Nora einrichten")).toBe(
      "employee_password_setup",
    );
  });

  it("answers unknown rather than guessing", () => {
    expect(classifyMailKind("Rechnung 2026-09")).toBe("unknown");
    expect(classifyMailKind(undefined)).toBe("unknown");
    expect(classifyMailKind("   ")).toBe("unknown");
  });
});

describe("buildDedupeKey", () => {
  it("is stable for a repeated delivery of the same event", () => {
    const parts = {
      providerMessageId: "<msg-1>",
      providerEventId: "1",
      providerEvent: "delivered",
      recipient: "Employee@Example.test",
      eventAt: "2026-09-04T12:00:00.000Z",
    };
    expect(buildDedupeKey(parts)).toBe(
      buildDedupeKey({ ...parts, recipient: "employee@example.TEST" }),
    );
  });

  it("separates different events on the same message", () => {
    const base = {
      providerMessageId: "<msg-1>",
      providerEventId: null,
      recipient: "employee@example.test",
      eventAt: "2026-09-04T12:00:00.000Z",
    };
    expect(buildDedupeKey({ ...base, providerEvent: "request" })).not.toBe(
      buildDedupeKey({ ...base, providerEvent: "delivered" }),
    );
  });

  it("separates two messages that share an event name and timestamp", () => {
    const base = {
      providerEventId: null,
      providerEvent: "delivered",
      recipient: "employee@example.test",
      eventAt: "2026-09-04T12:00:00.000Z",
    };
    expect(buildDedupeKey({ ...base, providerMessageId: "<a>" })).not.toBe(
      buildDedupeKey({ ...base, providerMessageId: "<b>" }),
    );
  });
});

describe("extractEventPayloads", () => {
  it("accepts a single event object", () => {
    expect(extractEventPayloads(BASE_EVENT)).toEqual([BASE_EVENT]);
  });

  it("accepts a bare array", () => {
    expect(extractEventPayloads([BASE_EVENT])).toEqual([BASE_EVENT]);
  });

  it("accepts the batched wrapper", () => {
    expect(extractEventPayloads({ items: [BASE_EVENT] })).toEqual([BASE_EVENT]);
  });

  it("rejects a non-object body", () => {
    expect(extractEventPayloads("delivered")).toBeNull();
    expect(extractEventPayloads(null)).toBeNull();
  });
});

describe("deriveDeliveryOutcome", () => {
  const at = (iso: string, eventType: NoraEmailEventType) => ({
    eventType,
    eventAt: iso,
  });

  it("returns null without events", () => {
    expect(deriveDeliveryOutcome([])).toBeNull();
  });

  it("does not depend on arrival order", () => {
    const events = [
      at("2026-09-04T12:00:00Z", "EMAIL_ACCEPTED"),
      at("2026-09-04T12:00:30Z", "EMAIL_DELIVERED"),
    ];
    expect(deriveDeliveryOutcome(events)).toBe("delivered");
    expect(deriveDeliveryOutcome([...events].reverse())).toBe("delivered");
  });

  it("reads a soft bounce followed by a successful retry as delivered", () => {
    expect(
      deriveDeliveryOutcome([
        at("2026-09-04T12:05:00Z", "EMAIL_SOFT_BOUNCED"),
        at("2026-09-04T12:40:00Z", "EMAIL_DELIVERED"),
      ]),
    ).toBe("delivered");
  });

  it("reads a hard bounce after acceptance as undeliverable", () => {
    expect(
      deriveDeliveryOutcome([
        at("2026-09-04T12:00:00Z", "EMAIL_ACCEPTED"),
        at("2026-09-04T12:01:00Z", "EMAIL_HARD_BOUNCED"),
      ]),
    ).toBe("undeliverable");
  });

  it("breaks an identical-timestamp tie by severity", () => {
    expect(
      deriveDeliveryOutcome([
        at("2026-09-04T12:00:00Z", "EMAIL_DELIVERED"),
        at("2026-09-04T12:00:00Z", "EMAIL_ACCEPTED"),
      ]),
    ).toBe("delivered");
  });

  it("ignores events with an unparseable timestamp", () => {
    expect(
      deriveDeliveryOutcome([
        at("not-a-date", "EMAIL_HARD_BOUNCED"),
        at("2026-09-04T12:00:00Z", "EMAIL_DELIVERED"),
      ]),
    ).toBe("delivered");
  });

  it("never reports anything stronger than delivered", () => {
    // Guards the product truth boundary: there is no outcome in this contract
    // that means "the employee read it" or "onboarding is complete".
    const outcomes = (
      [
        "EMAIL_ACCEPTED",
        "EMAIL_DELIVERED",
        "EMAIL_DEFERRED",
        "EMAIL_SOFT_BOUNCED",
        "EMAIL_HARD_BOUNCED",
        "EMAIL_BLOCKED",
        "EMAIL_INVALID",
        "EMAIL_SPAM_REPORTED",
      ] as NoraEmailEventType[]
    ).map(outcomeForEvent);

    expect(new Set(outcomes)).toEqual(
      new Set([
        "accepted",
        "delivered",
        "delayed",
        "undeliverable",
        "spam_reported",
      ]),
    );
  });
});
