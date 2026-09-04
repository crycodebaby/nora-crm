import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPasswordSetMark,
  hasPasswordBeenSet,
  linkFingerprint,
  markPasswordSet,
  PASSWORD_MARKER_TTL_MS,
} from "./passwordSetupMarker";

const USER = "user-abc";
const T0 = 1_800_000_000_000;
const LINK = linkFingerprint("access-token-of-this-run");

describe("passwordSetupMarker", () => {
  beforeEach(() => {
    clearPasswordSetMark();
  });

  it("reports nothing before the password step succeeds", () => {
    expect(hasPasswordBeenSet(USER, LINK, T0)).toBe(false);
  });

  it("remembers a successful password step for the same user", () => {
    markPasswordSet(USER, LINK, T0);
    expect(hasPasswordBeenSet(USER, LINK, T0 + 1000)).toBe(true);
  });

  it("never leaks across users", () => {
    markPasswordSet(USER, LINK, T0);
    expect(hasPasswordBeenSet("someone-else", LINK, T0 + 1000)).toBe(false);
  });

  it("expires, so a later password link starts at welcome again", () => {
    markPasswordSet(USER, LINK, T0);
    expect(
      hasPasswordBeenSet(USER, LINK, T0 + PASSWORD_MARKER_TTL_MS - 1),
    ).toBe(true);
    expect(hasPasswordBeenSet(USER, LINK, T0 + PASSWORD_MARKER_TTL_MS)).toBe(
      false,
    );
  });

  it("is cleared when the run finishes", () => {
    markPasswordSet(USER, LINK, T0);
    clearPasswordSetMark();
    expect(hasPasswordBeenSet(USER, LINK, T0 + 1000)).toBe(false);
  });

  it("treats corrupted storage as absent", () => {
    localStorage.setItem("nora.onboarding.password_set", "not json");
    expect(hasPasswordBeenSet(USER, LINK, T0)).toBe(false);
    localStorage.setItem(
      "nora.onboarding.password_set",
      JSON.stringify({ foo: 1 }),
    );
    expect(hasPasswordBeenSet(USER, LINK, T0)).toBe(false);
  });

  it("ignores an empty user id", () => {
    markPasswordSet("", LINK, T0);
    expect(hasPasswordBeenSet("", LINK, T0)).toBe(false);
    expect(hasPasswordBeenSet(null, LINK, T0)).toBe(false);
  });

  it("ignores the marker for a genuinely new link, even inside the TTL", () => {
    markPasswordSet(USER, LINK, T0);
    const newLink = linkFingerprint("a-completely-different-access-token");
    // A fresh setup/recovery link must show the password step again.
    expect(hasPasswordBeenSet(USER, newLink, T0 + 60_000)).toBe(false);
    // ...while a reload of the same run still resumes.
    expect(hasPasswordBeenSet(USER, LINK, T0 + 60_000)).toBe(true);
  });

  it("fingerprints are stable, token-specific and not the token itself", () => {
    const token = "eyJhbGciOiJIUzI1NiJ9.payload.signature";
    expect(linkFingerprint(token)).toBe(linkFingerprint(token));
    expect(linkFingerprint(token)).not.toBe(linkFingerprint(token + "x"));
    expect(String(linkFingerprint(token))).not.toContain("eyJ");
    expect(typeof linkFingerprint(null)).toBe("number");
  });
});
