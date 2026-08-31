import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

const SCROLL_EDGE_TOLERANCE = 2;

type HorizontalScrollGeometry = Pick<
  HTMLElement,
  "clientWidth" | "scrollLeft" | "scrollWidth"
>;

export type HorizontalScrollState = {
  canScrollLeft: boolean;
  canScrollRight: boolean;
  hasOverflow: boolean;
};

export type HorizontalScrollMetrics = HorizontalScrollState & {
  clientWidth: number;
  maxScrollLeft: number;
  scrollLeft: number;
  scrollWidth: number;
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

export function getHorizontalScrollMetrics({
  clientWidth,
  scrollLeft,
  scrollWidth,
}: HorizontalScrollGeometry): HorizontalScrollMetrics {
  const maxScrollLeft = Math.max(0, scrollWidth - clientWidth);
  const normalizedScrollLeft = clamp(scrollLeft, 0, maxScrollLeft);

  return {
    clientWidth,
    maxScrollLeft,
    scrollLeft: normalizedScrollLeft,
    scrollWidth,
    hasOverflow: maxScrollLeft > SCROLL_EDGE_TOLERANCE,
    canScrollLeft: normalizedScrollLeft > SCROLL_EDGE_TOLERANCE,
    canScrollRight:
      maxScrollLeft > SCROLL_EDGE_TOLERANCE &&
      normalizedScrollLeft < maxScrollLeft - SCROLL_EDGE_TOLERANCE,
  };
}

export function getHorizontalScrollState({
  clientWidth,
  scrollLeft,
  scrollWidth,
}: HorizontalScrollGeometry): HorizontalScrollState {
  const { canScrollLeft, canScrollRight, hasOverflow } =
    getHorizontalScrollMetrics({ clientWidth, scrollLeft, scrollWidth });

  return {
    canScrollLeft,
    canScrollRight,
    hasOverflow,
  };
}

const EMPTY_SCROLL_STATE: HorizontalScrollState = {
  canScrollLeft: false,
  canScrollRight: false,
  hasOverflow: false,
};

type PanSession = {
  pointerId: number;
  startClientX: number;
  startScrollLeft: number;
};

const isSameScrollState = (
  first: HorizontalScrollState,
  second: HorizontalScrollState,
) =>
  first.canScrollLeft === second.canScrollLeft &&
  first.canScrollRight === second.canScrollRight &&
  first.hasOverflow === second.hasOverflow;

const prefersReducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export const getKanbanScrollBehavior = (
  reducedMotion: boolean,
): ScrollBehavior => (reducedMotion ? "auto" : "smooth");

export const getColumnScrollStep = (element: HTMLElement) => {
  const board = element.querySelector<HTMLElement>(".nora-kanban-board");
  const column = element.querySelector<HTMLElement>(".nora-kanban-column");

  if (!board || !column) {
    return Math.max(280, element.clientWidth * 0.75);
  }

  const columnGap = Number.parseFloat(getComputedStyle(board).columnGap) || 0;
  return column.getBoundingClientRect().width + columnGap;
};

const canStartMousePan = (event: ReactPointerEvent<HTMLElement>) => {
  if (event.pointerType !== "mouse" || event.button !== 0) {
    return false;
  }

  const target = event.target;
  if (!(target instanceof Element)) {
    return false;
  }

  const isOnPanSurface = target.closest("[data-kanban-pan-surface]");
  const isOnInteractiveContent = target.closest(
    [
      "a",
      "button",
      "input",
      "select",
      "textarea",
      "[contenteditable='true']",
      "[data-rfd-draggable-id]",
      ".nora-kanban-column-header",
    ].join(","),
  );

  return Boolean(isOnPanSurface && !isOnInteractiveContent);
};

/**
 * Horizontal navigation controller for the wide deals board.
 *
 * Native touch and trackpad scrolling remain untouched. Mouse panning starts
 * only on explicitly marked free board surfaces, never on cards or controls.
 */
export function useKanbanScrollNavigation<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null);
  const [scrollState, setScrollState] =
    useState<HorizontalScrollState>(EMPTY_SCROLL_STATE);
  const animationFrameRef = useRef<number | null>(null);
  const panSessionRef = useRef<PanSession | null>(null);

  const ref = useCallback((node: T | null) => {
    setElement(node);
  }, []);

  const updateScrollState = useCallback(() => {
    if (!element || animationFrameRef.current !== null) {
      return;
    }

    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      const nextState = getHorizontalScrollState(element);
      setScrollState((currentState) =>
        isSameScrollState(currentState, nextState) ? currentState : nextState,
      );
    });
  }, [element]);

  const finishPan = useCallback(() => {
    if (!element) {
      panSessionRef.current = null;
      return;
    }

    const pointerId = panSessionRef.current?.pointerId;
    panSessionRef.current = null;
    delete element.dataset.kanbanPanning;

    if (pointerId != null && element.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
  }, [element]);

  useEffect(() => {
    if (!element) {
      return;
    }

    const onScroll = () => updateScrollState();
    element.addEventListener("scroll", onScroll, { passive: true });

    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(element);
    if (element.firstElementChild) {
      resizeObserver.observe(element.firstElementChild);
    }

    const mutationObserver = new MutationObserver(updateScrollState);
    mutationObserver.observe(element, { childList: true, subtree: true });
    updateScrollState();

    return () => {
      element.removeEventListener("scroll", onScroll);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      finishPan();
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [element, finishPan, updateScrollState]);

  const scrollBy = useCallback(
    (direction: -1 | 1, distance = element?.clientWidth ?? 0) => {
      if (!element) {
        return;
      }

      element.scrollBy({
        left: direction * distance,
        behavior: getKanbanScrollBehavior(prefersReducedMotion()),
      });
    },
    [element],
  );

  const scrollByColumn = useCallback(
    (direction: -1 | 1) => {
      if (!element) {
        return;
      }
      scrollBy(direction, getColumnScrollStep(element));
    },
    [element, scrollBy],
  );

  const scrollByViewport = useCallback(
    (direction: -1 | 1) => {
      if (!element) {
        return;
      }
      scrollBy(direction, Math.max(280, element.clientWidth * 0.8));
    },
    [element, scrollBy],
  );

  const scrollToEdge = useCallback(
    (edge: "start" | "end") => {
      if (!element) {
        return;
      }
      element.scrollTo({
        left: edge === "start" ? 0 : element.scrollWidth,
        behavior: getKanbanScrollBehavior(prefersReducedMotion()),
      });
    },
    [element],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<T>) => {
      if (!element || event.target !== event.currentTarget) {
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        scrollByColumn(event.key === "ArrowLeft" ? -1 : 1);
        return;
      }

      if (event.key === "PageUp" || event.key === "PageDown") {
        event.preventDefault();
        scrollByViewport(event.key === "PageUp" ? -1 : 1);
        return;
      }

      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        scrollToEdge(event.key === "Home" ? "start" : "end");
      }
    },
    [element, scrollByColumn, scrollByViewport, scrollToEdge],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<T>) => {
      if (!element || !canStartMousePan(event)) {
        return;
      }

      panSessionRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startScrollLeft: element.scrollLeft,
      };
      element.dataset.kanbanPanning = "true";
      element.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [element],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<T>) => {
      const panSession = panSessionRef.current;
      if (!element || !panSession || panSession.pointerId !== event.pointerId) {
        return;
      }

      element.scrollLeft =
        panSession.startScrollLeft - (event.clientX - panSession.startClientX);
      event.preventDefault();
    },
    [element],
  );

  const onPointerEnd = useCallback(
    (event: ReactPointerEvent<T>) => {
      if (panSessionRef.current?.pointerId === event.pointerId) {
        finishPan();
      }
    },
    [finishPan],
  );

  return {
    ...scrollState,
    element,
    ref,
    scrollByColumn,
    scrollByViewport,
    scrollToEdge,
    scrollerProps: {
      onKeyDown,
      onLostPointerCapture: finishPan,
      onPointerCancel: onPointerEnd,
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
    },
  };
}
