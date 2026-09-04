/**
 * Employee Onboarding Flow (Nora Employee Onboarding & Access V1A).
 *
 * A pure, framework-free state machine so the later premium-UX wave can skin
 * the flow without re-deriving any auth semantics. Two invariants matter and
 * are enforced here rather than in the view:
 *
 *   1. WELCOME never claims the password is set — it only precedes the setup.
 *   2. COMPLETE is only reachable through a genuinely successful password
 *      update (see SUCCESS_PRECONDITIONS below); no other transition enters it.
 *
 * Animation must never drive these transitions: the view may delay *rendering*
 * a step, but the step itself changes only on the events below.
 */

export type OnboardingStep =
  | "checking"
  | "invalid"
  | "welcome"
  | "password"
  | "profile"
  | "blocked"
  | "complete";

export type OnboardingState = {
  step: OnboardingStep;
  /** True while a submit is in flight. Buttons disable on this, nothing else. */
  submitting: boolean;
  /** Last calm German error for the current step, or null. */
  error: string | null;
};

export type OnboardingEvent =
  /** Bootstrap finished and a usable invitation/recovery context exists. */
  | { type: "sessionResolved" }
  /** Bootstrap finished and there is no usable link/session. */
  | { type: "sessionMissing" }
  /** The employee exists but their Nora access is disabled. */
  | { type: "accessBlocked" }
  /** WELCOME → PASSWORD. The only way out of welcome. */
  | { type: "onContinue" }
  | { type: "onPasswordSubmit" }
  | { type: "passwordFailed"; error: string }
  /** Password genuinely updated AND the employee mapping re-verified. */
  | { type: "passwordSucceeded" }
  | { type: "onProfileSubmit" }
  | { type: "profileFailed"; error: string }
  | { type: "profileSucceeded" };

export const INITIAL_ONBOARDING_STATE: OnboardingState = {
  step: "checking",
  submitting: false,
  error: null,
};

/**
 * Technical truths that must ALL hold before "passwordSucceeded" may be
 * dispatched. Documented here so the designer phase cannot weaken them by
 * moving the success animation earlier.
 */
export const SUCCESS_PRECONDITIONS = [
  "authenticated_session",
  "password_update_returned_success",
  "employee_mapping_valid",
  "access_not_disabled",
] as const;

export function onboardingReducer(
  state: OnboardingState,
  event: OnboardingEvent,
): OnboardingState {
  switch (event.type) {
    case "sessionResolved":
      // Only meaningful while bootstrapping — never re-enters welcome later.
      return state.step === "checking"
        ? { step: "welcome", submitting: false, error: null }
        : state;

    case "sessionMissing":
      return state.step === "checking"
        ? { step: "invalid", submitting: false, error: null }
        : state;

    case "accessBlocked":
      // A disabled employee can never reach completion, from any step.
      return { step: "blocked", submitting: false, error: null };

    case "onContinue":
      return state.step === "welcome"
        ? { step: "password", submitting: false, error: null }
        : state;

    case "onPasswordSubmit":
      return state.step === "password"
        ? { ...state, submitting: true, error: null }
        : state;

    case "passwordFailed":
      // Failure keeps the employee in the password step — never advances.
      return state.step === "password"
        ? { step: "password", submitting: false, error: event.error }
        : state;

    case "passwordSucceeded":
      return state.step === "password"
        ? { step: "profile", submitting: false, error: null }
        : state;

    case "onProfileSubmit":
      return state.step === "profile"
        ? { ...state, submitting: true, error: null }
        : state;

    case "profileFailed":
      return state.step === "profile"
        ? { step: "profile", submitting: false, error: event.error }
        : state;

    case "profileSucceeded":
      return state.step === "profile"
        ? { step: "complete", submitting: false, error: null }
        : state;

    default:
      return state;
  }
}

/** The single flag the view (and later the designer) reads for the success UI. */
export function isComplete(state: OnboardingState): boolean {
  return state.step === "complete";
}

/** Step order used for the progress indicator. "blocked"/"invalid" are off-path. */
export const ONBOARDING_PROGRESS_STEPS = [
  "welcome",
  "password",
  "profile",
  "complete",
] as const satisfies readonly OnboardingStep[];

export function progressIndexOf(step: OnboardingStep): number {
  const index = (
    ONBOARDING_PROGRESS_STEPS as readonly OnboardingStep[]
  ).indexOf(step);
  return index === -1 ? 0 : index;
}
