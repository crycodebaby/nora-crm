import type { OnboardingStep } from "./employeeOnboardingFlow";
import {
  ONBOARDING_HUMAN_STEPS,
  humanStepIndex,
  progressSentence,
} from "./onboardingSteps";

/**
 * Quiet progress line: three dots and "Schritt n von 3 · Name" (V1B).
 *
 * Purely informational: no links, no buttons, nothing focusable. The dots
 * are decorative; the sentence carries the meaning for every reader. Renders
 * nothing for completion and for the off-path states.
 */
export const OnboardingProgress = ({
  current,
}: {
  current: OnboardingStep;
}) => {
  const currentIndex = humanStepIndex(current);
  const sentence = progressSentence(current);
  if (currentIndex === -1 || !sentence) return null;

  return (
    <p className="nora-access-progress" data-testid="onboarding-progress">
      <span className="nora-access-progress-dots" aria-hidden="true">
        {ONBOARDING_HUMAN_STEPS.map((entry, index) => (
          <span
            key={entry.step}
            className="nora-access-progress-dot"
            data-state={
              index < currentIndex
                ? "done"
                : index === currentIndex
                  ? "current"
                  : "upcoming"
            }
          />
        ))}
      </span>
      <span>{sentence}</span>
    </p>
  );
};
