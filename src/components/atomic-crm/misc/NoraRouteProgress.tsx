import { useIsFetching, useIsMutating } from "@tanstack/react-query";

/**
 * Global activity hairline at the top of the app shell.
 *
 * Closes the gap the per-page skeletons (NoraPageLoading) cannot cover:
 * navigating between already-cached pages while react-query refetches in the
 * background shows no signal at all. This bar subscribes to the same
 * QueryClient ra-core uses, so every fetch and mutation in the app is
 * reflected — no per-page wiring required.
 *
 * The show-delay lives in CSS (transition-delay on opacity), not in a JS
 * timer: responses faster than the delay never flash the bar, and hiding is
 * immediate. The component itself only toggles a data attribute.
 *
 * Purely decorative — loading semantics for assistive technology stay with
 * the aria-busy page skeletons, so this stays aria-hidden.
 */
export const NoraRouteProgress = () => {
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  const active = fetching + mutating > 0;

  return (
    <div
      className="nora-route-progress"
      data-active={active ? "true" : "false"}
      aria-hidden="true"
      data-testid="nora-route-progress"
    >
      <div className="nora-route-progress-bar" />
    </div>
  );
};
