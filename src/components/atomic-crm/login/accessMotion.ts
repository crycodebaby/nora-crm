/**
 * Motion constants of the employee access surface (V1B). Presentation only:
 * none of these values decides which step is shown, only how long a change
 * is allowed to look like a change.
 */

/** How long the step fold needs before the leaving step may be unmounted. */
export const ACCESS_STEP_FOLD_MS = 420;

/** How long the completion choreography runs before everything is static. */
export const COMPLETION_SETTLE_MS = 1020;

/** Reduced motion: the text still fades in as one group, then focus moves. */
export const COMPLETION_SETTLE_REDUCED_MS = 300;

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
