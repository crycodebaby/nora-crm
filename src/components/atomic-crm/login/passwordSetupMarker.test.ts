import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPasswordSetMark,
  hasPasswordBeenSet,
  markPasswordSet,
  PASSWORD_MARKER_TTL_MS,
} from "./passwordSetupMarker";

const USER = "user-abc";
const T0 = 1_800_000_000_000;

describe("passwordSetupMarker", () => {
  beforeEach(() => {
    clearPasswordSetMark();
  });

  it("reports nothing before the password step succeeds", () => {
    expect(hasPasswordBeenSet(USER, T0)).toBe(false);
  });

  it("remembers a successful password step for the same user", () => {
    markPasswordSet(USER, T0);
    expect(hasPasswordBeenSet(USER, T0 + 1000)).toBe(true);
  });

  it("never leaks across users", () => {
    markPasswordSet(USER, T0);
    expect(hasPasswordBeenSet("someone-else", T0 + 1000)).toBe(false);
  });

  it("expires, so a later password link starts at welcome again", () => {
    markPasswordSet(USER, T0);
    expect(hasPasswordBeenSet(USER, T0 + PASSWORD_MARKER_TTL_MS - 1)).toBe(
      true,
    );
    expect(hasPasswordBeenSet(USER, T0 + PASSWORD_MARKER_TTL_MS)).toBe(false);
  });

  it("is cleared when the run finishes", () => {
    markPasswordSet(USER, T0);
    clearPasswordSetMark();
    expect(hasPasswordBeenSet(USER, T0 + 1000)).toBe(false);
  });

  it("treats corrupted storage as absent", () => {
    localStorage.setItem("nora.onboarding.password_set", "not json");
    expect(hasPasswordBeenSet(USER, T0)).toBe(false);
    localStorage.setItem(
      "nora.onboarding.password_set",
      JSON.stringify({ foo: 1 }),
    );
    expect(hasPasswordBeenSet(USER, T0)).toBe(false);
  });

  it("ignores an empty user id", () => {
    markPasswordSet("", T0);
    expect(hasPasswordBeenSet("", T0)).toBe(false);
    expect(hasPasswordBeenSet(null, T0)).toBe(false);
  });
});
