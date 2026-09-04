import type { OnboardingStep } from "./employeeOnboardingFlow";

/**
 * The three human steps of employee onboarding (V1B): Zugang → Passwort →
 * Profil. Completion is the success state after them, not a fourth task — it
 * has no entry here, and neither do the off-path states (checking, invalid,
 * blocked). This is a display mapping over the V1A reducer steps; it never
 * changes what the reducer does.
 */
export const ONBOARDING_HUMAN_STEPS = [
  { step: "welcome", label: "Zugang" },
  { step: "password", label: "Passwort" },
  { step: "profile", label: "Profil" },
] as const satisfies readonly { step: OnboardingStep; label: string }[];

export function humanStepIndex(step: OnboardingStep): number {
  return ONBOARDING_HUMAN_STEPS.findIndex((entry) => entry.step === step);
}

/** "Schritt 2 von 3 · Passwort", or null for steps that show no progress. */
export function progressSentence(step: OnboardingStep): string | null {
  const index = humanStepIndex(step);
  if (index === -1) return null;
  return `Schritt ${index + 1} von ${ONBOARDING_HUMAN_STEPS.length} · ${ONBOARDING_HUMAN_STEPS[index].label}`;
}

/** "Hallo {Vorname}" from the trusted identity; the fallback never guesses. */
export function greetingFor(identity: { firstName: string }): string {
  return identity.firstName
    ? `Hallo ${identity.firstName}`
    : "Willkommen bei Nora";
}
