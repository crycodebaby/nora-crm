import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { ACCESS_STEP_FOLD_MS, prefersReducedMotion } from "./accessMotion";

type Scene = {
  /** The step currently on screen — always rendered from live `children`. */
  currentKey: string;
  /** A frozen snapshot of the previous step while it folds away. */
  leaving: { key: string; node: ReactNode } | null;
  /** "prepared": entering fold is collapsed; "running": both folds transition. */
  phase: "idle" | "prepared" | "running";
};

/**
 * Step transition for the employee access card (V1B).
 *
 * One DOM tree, no page swap: when `stepKey` changes, the previous step is
 * kept mounted as a snapshot and folds away (grid rows 1fr → 0fr) while the
 * new step grows in (0fr → 1fr). The height of the card therefore glides
 * between two natural heights without any height tween — the same fold the
 * PWA system event already proved. Content inside a step (errors, the
 * submitting label) updates in place without any transition.
 *
 * Focus moves to the new heading after the fold (immediately under reduced
 * motion), so keyboard and screen-reader users always land on the sentence
 * that names the step. The heading opts in with `data-access-focus`.
 *
 * This is presentation only: it never decides which step is shown. The
 * reducer does; this component only decides how the change looks.
 */
export const AccessStepFold = ({
  stepKey,
  children,
}: {
  stepKey: string;
  children: ReactNode;
}) => {
  const [scene, setScene] = useState<Scene>({
    currentKey: stepKey,
    leaving: null,
    phase: "idle",
  });
  const lastRenderedRef = useRef<{ key: string; node: ReactNode }>({
    key: stepKey,
    node: children,
  });
  const enteringRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Snapshot what is on screen before the key changes — never after.
  if (lastRenderedRef.current.key === stepKey) {
    lastRenderedRef.current = { key: stepKey, node: children };
  }

  useLayoutEffect(() => {
    if (scene.currentKey === stepKey) return;
    const previous = lastRenderedRef.current;
    lastRenderedRef.current = { key: stepKey, node: children };
    setScene({
      currentKey: stepKey,
      leaving: previous.key === stepKey ? null : previous,
      phase: "prepared",
    });
    // `children` is intentionally not a dependency: a step re-rendering in
    // place must never restart its own transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey, scene.currentKey]);

  useEffect(() => {
    if (scene.phase !== "prepared") return;
    // Flush the collapsed style once so the browser has a "from" state.
    void enteringRef.current?.getBoundingClientRect();
    const frame = window.requestAnimationFrame(() => {
      setScene((current) =>
        current.phase === "prepared"
          ? { ...current, phase: "running" }
          : current,
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scene.phase]);

  useEffect(() => {
    if (scene.phase !== "running") return;
    const wait = prefersReducedMotion() ? 0 : ACCESS_STEP_FOLD_MS;
    const timer = window.setTimeout(() => {
      setScene((current) =>
        current.phase === "running"
          ? { ...current, leaving: null, phase: "idle" }
          : current,
      );
      // Query the entering fold only: the leaving snapshot carries the same
      // marker and still sits first in DOM order when this timer fires.
      const heading = enteringRef.current?.querySelector<HTMLElement>(
        "[data-access-focus]",
      );
      heading?.focus({ preventScroll: true });
    }, wait);
    return () => window.clearTimeout(timer);
  }, [scene.phase]);

  const entering = scene.phase !== "idle";

  return (
    <div className="nora-access-steps" ref={containerRef}>
      {scene.leaving ? (
        <div
          key={`leaving-${scene.leaving.key}`}
          className="nora-access-fold"
          data-direction="out"
          data-open={scene.phase === "prepared" ? "true" : "false"}
          aria-hidden="true"
        >
          <div className="nora-access-fold-inner">{scene.leaving.node}</div>
        </div>
      ) : null}
      <div
        key={`current-${scene.currentKey}`}
        ref={enteringRef}
        className="nora-access-fold"
        data-direction="in"
        data-open={entering && scene.phase === "prepared" ? "false" : "true"}
        data-step={scene.currentKey}
      >
        <div className="nora-access-fold-inner">
          {scene.currentKey === stepKey
            ? children
            : lastRenderedRef.current.node}
        </div>
      </div>
    </div>
  );
};
