// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";

import {
  assertAllowedCalendarId,
  GOOGLE_OAUTH_SCOPES,
  readGoogleCalendarEnv,
} from "./config.ts";

const KEY_B64 = Buffer.from(Uint8Array.from({ length: 32 }, (_, i) => i + 1)).toString(
  "base64",
);

const ENV_KEYS = [
  "GOOGLE_CALENDAR_CLIENT_ID",
  "GOOGLE_CALENDAR_CLIENT_SECRET",
  "GOOGLE_CALENDAR_ALLOWED_ID",
  "GOOGLE_CALENDAR_OAUTH_REDIRECT_URI",
  "GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY",
  "GOOGLE_CALENDAR_TOKEN_KEY_VERSION",
] as const;

describe("readGoogleCalendarEnv", () => {
  afterEach(() => {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
  });

  it("reports missing keys when env is empty", () => {
    const status = readGoogleCalendarEnv();
    expect(status.configured).toBe(false);
    if (!status.configured) {
      expect(status.missing.length).toBeGreaterThan(0);
    }
  });

  it("returns configured env when all keys are set", () => {
    process.env.GOOGLE_CALENDAR_CLIENT_ID = "client-id";
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "client-secret";
    process.env.GOOGLE_CALENDAR_ALLOWED_ID = "test@group.calendar.google.com";
    process.env.GOOGLE_CALENDAR_OAUTH_REDIRECT_URI =
      "https://example.test/callback";
    process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY = KEY_B64;
    process.env.GOOGLE_CALENDAR_TOKEN_KEY_VERSION = "v1";

    const status = readGoogleCalendarEnv();
    expect(status.configured).toBe(true);
    if (status.configured) {
      expect(status.env.allowedCalendarId).toBe(
        "test@group.calendar.google.com",
      );
      expect(status.env.tokenKeyVersion).toBe("v1");
    }
  });
});

describe("assertAllowedCalendarId", () => {
  it("accepts the configured allowlist id", () => {
    expect(() =>
      assertAllowedCalendarId("allowed@group.calendar.google.com", {
        clientId: "x",
        clientSecret: "y",
        allowedCalendarId: "allowed@group.calendar.google.com",
        redirectUri: "https://example.test/callback",
        tokenEncryptionKey: new Uint8Array(32),
        tokenKeyVersion: "v1",
        adminReturnUrl: "https://example.test/admin",
      }),
    ).not.toThrow();
  });
});

describe("GOOGLE_OAUTH_SCOPES", () => {
  it("includes read-only calendar scopes only", () => {
    expect(GOOGLE_OAUTH_SCOPES.join(" ")).not.toMatch(/calendar\.events(?!\.owned\.readonly)/);
    expect(GOOGLE_OAUTH_SCOPES.some((s) => s.includes("calendarlist.readonly"))).toBe(
      true,
    );
  });
});
