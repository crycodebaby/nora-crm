// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";

import { createPkcePair, sha256Hex } from "./pkce.ts";

describe("pkce", () => {
  it("creates verifier/challenge pair", async () => {
    const { verifier, challenge } = await createPkcePair();
    expect(verifier.length).toBeGreaterThan(40);
    expect(challenge.length).toBeGreaterThan(20);
    expect(challenge).not.toContain("+");
    expect(challenge).not.toContain("/");
  });

  it("hashes state deterministically", async () => {
    const hash = await sha256Hex("state-value");
    expect(hash).toHaveLength(64);
    expect(await sha256Hex("state-value")).toBe(hash);
  });
});

describe("readGoogleCalendarEnv", () => {
  afterEach(() => {
    for (const key of [
      "GOOGLE_CALENDAR_CLIENT_ID",
      "GOOGLE_CALENDAR_CLIENT_SECRET",
      "GOOGLE_CALENDAR_ALLOWED_ID",
      "GOOGLE_CALENDAR_OAUTH_REDIRECT_URI",
      "GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY",
      "GOOGLE_CALENDAR_TOKEN_KEY_VERSION",
    ]) {
      delete process.env[key];
    }
  });

  it("requires encryption key env", async () => {
    const { readGoogleCalendarEnv } = await import("./config.ts");
    process.env.GOOGLE_CALENDAR_CLIENT_ID = "id";
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "secret";
    process.env.GOOGLE_CALENDAR_ALLOWED_ID = "cal@test";
    process.env.GOOGLE_CALENDAR_OAUTH_REDIRECT_URI = "https://example.test/cb";
    process.env.GOOGLE_CALENDAR_TOKEN_KEY_VERSION = "v1";
    const status = readGoogleCalendarEnv();
    expect(status.configured).toBe(false);
  });
});
