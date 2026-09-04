import { useId } from "react";

/**
 * The completion mark of employee onboarding (V1B): a 64 px ring that draws
 * itself clockwise from twelve, a soft success fill, a drawn check and one
 * restrained halo. Pure CSS animation on stroke and opacity; no overshoot,
 * nothing loops, and once the sequence has run the mark is a static drawing.
 *
 * It renders only inside the COMPLETE step, which the reducer enters solely
 * on a genuinely successful profile save after a genuinely successful
 * password update. The mark therefore cannot appear before success exists —
 * the animation only decides how success looks, never whether it happened.
 *
 * `aria-hidden`: the heading next to it already says everything.
 */
export const OnboardingSuccessMark = () => {
  const gradientId = useId();

  return (
    <svg
      className="nora-access-success-mark"
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      data-testid="onboarding-success-mark"
    >
      <defs>
        <radialGradient id={gradientId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--nora-success)" stopOpacity="0.1" />
          <stop
            offset="35%"
            stopColor="var(--nora-success)"
            stopOpacity="0.07"
          />
          <stop
            offset="60%"
            stopColor="var(--nora-success)"
            stopOpacity="0.035"
          />
          <stop
            offset="82%"
            stopColor="var(--nora-success)"
            stopOpacity="0.012"
          />
          <stop offset="100%" stopColor="var(--nora-success)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle
        className="nora-access-mark-halo"
        cx="32"
        cy="32"
        r="40"
        fill={`url(#${gradientId})`}
      />
      <circle className="nora-access-mark-fill" cx="32" cy="32" r="30" />
      <circle
        className="nora-access-mark-ring"
        cx="32"
        cy="32"
        r="30"
        pathLength={1}
      />
      <path
        className="nora-access-mark-check"
        d="M20 33 L28 41 L44 24"
        pathLength={1}
      />
    </svg>
  );
};
