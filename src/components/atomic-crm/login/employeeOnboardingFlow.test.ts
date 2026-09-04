import { describe, expect, it } from "vitest";
import {
  INITIAL_ONBOARDING_STATE,
  isComplete,
  onboardingReducer,
  progressIndexOf,
  type OnboardingEvent,
  type OnboardingState,
} from "./employeeOnboardingFlow";

const run = (
  events: OnboardingEvent[],
  from: OnboardingState = INITIAL_ONBOARDING_STATE,
) => events.reduce(onboardingReducer, from);

describe("employee onboarding flow", () => {
  it("starts in the checking step and claims nothing", () => {
    expect(INITIAL_ONBOARDING_STATE).toEqual({
      step: "checking",
      submitting: false,
      error: null,
    });
    expect(isComplete(INITIAL_ONBOARDING_STATE)).toBe(false);
  });

  it("enters welcome once the invitation context resolves", () => {
    expect(run([{ type: "sessionResolved" }]).step).toBe("welcome");
  });

  it("welcome does not imply success", () => {
    const state = run([{ type: "sessionResolved" }]);
    expect(state.step).toBe("welcome");
    expect(isComplete(state)).toBe(false);
  });

  it("shows the invalid state when no link or session is usable", () => {
    expect(run([{ type: "sessionMissing" }]).step).toBe("invalid");
  });

  it("advances welcome → password only via onContinue", () => {
    expect(
      run([{ type: "sessionResolved" }, { type: "onContinue" }]).step,
    ).toBe("password");
  });

  it("cannot skip the password step to reach completion", () => {
    const state = run([
      { type: "sessionResolved" },
      { type: "onContinue" },
      { type: "profileSucceeded" },
    ]);
    expect(state.step).toBe("password");
    expect(isComplete(state)).toBe(false);
  });

  it("cannot reach completion from welcome", () => {
    const state = run([
      { type: "sessionResolved" },
      { type: "passwordSucceeded" },
      { type: "profileSucceeded" },
    ]);
    expect(state.step).toBe("welcome");
  });

  it("marks submitting while the password is in flight", () => {
    const state = run([
      { type: "sessionResolved" },
      { type: "onContinue" },
      { type: "onPasswordSubmit" },
    ]);
    expect(state).toEqual({ step: "password", submitting: true, error: null });
  });

  it("keeps a failed password attempt in the password step and surfaces the error", () => {
    const state = run([
      { type: "sessionResolved" },
      { type: "onContinue" },
      { type: "onPasswordSubmit" },
      { type: "passwordFailed", error: "Dieser Link ist nicht mehr gültig." },
    ]);
    expect(state.step).toBe("password");
    expect(state.submitting).toBe(false);
    expect(state.error).toBe("Dieser Link ist nicht mehr gültig.");
    expect(isComplete(state)).toBe(false);
  });

  it("clears a previous error on the next submit", () => {
    const state = run([
      { type: "sessionResolved" },
      { type: "onContinue" },
      { type: "onPasswordSubmit" },
      { type: "passwordFailed", error: "zu kurz" },
      { type: "onPasswordSubmit" },
    ]);
    expect(state.error).toBeNull();
    expect(state.submitting).toBe(true);
  });

  it("reaches completion only through a successful password update", () => {
    const state = run([
      { type: "sessionResolved" },
      { type: "onContinue" },
      { type: "onPasswordSubmit" },
      { type: "passwordSucceeded" },
      { type: "onProfileSubmit" },
      { type: "profileSucceeded" },
    ]);
    expect(state.step).toBe("complete");
    expect(isComplete(state)).toBe(true);
  });

  it("keeps a failed profile save in the profile step", () => {
    const state = run([
      { type: "sessionResolved" },
      { type: "onContinue" },
      { type: "onPasswordSubmit" },
      { type: "passwordSucceeded" },
      { type: "onProfileSubmit" },
      { type: "profileFailed", error: "Profil nicht gespeichert" },
    ]);
    expect(state.step).toBe("profile");
    expect(state.error).toBe("Profil nicht gespeichert");
  });

  it("blocks a disabled employee from any step and never completes", () => {
    const midway = run([
      { type: "sessionResolved" },
      { type: "onContinue" },
      { type: "onPasswordSubmit" },
      { type: "passwordSucceeded" },
    ]);
    const blocked = onboardingReducer(midway, { type: "accessBlocked" });
    expect(blocked.step).toBe("blocked");

    const after = run([{ type: "profileSucceeded" }], blocked);
    expect(after.step).toBe("blocked");
    expect(isComplete(after)).toBe(false);
  });

  it("does not fall back into welcome once the flow has advanced", () => {
    const state = run([
      { type: "sessionResolved" },
      { type: "onContinue" },
      { type: "sessionResolved" },
    ]);
    expect(state.step).toBe("password");
  });

  it("orders the progress steps for the indicator", () => {
    expect(progressIndexOf("welcome")).toBe(0);
    expect(progressIndexOf("password")).toBe(1);
    expect(progressIndexOf("profile")).toBe(2);
    expect(progressIndexOf("complete")).toBe(3);
    expect(progressIndexOf("invalid")).toBe(0);
  });
});
