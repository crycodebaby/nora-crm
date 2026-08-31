import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { ChevronLeft, ChevronRight, GripHorizontal } from "lucide-react";
import { useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";

import {
  getHorizontalScrollMetrics,
  getKanbanScrollBehavior,
  type HorizontalScrollMetrics,
} from "./useKanbanScrollNavigation";

const EMPTY_METRICS: HorizontalScrollMetrics = {
  canScrollLeft: false,
  canScrollRight: false,
  clientWidth: 0,
  hasOverflow: false,
  maxScrollLeft: 0,
  scrollLeft: 0,
  scrollWidth: 0,
};

type ColumnMarker = {
  label: string;
  positionPercent: number;
};

type RailThumbGeometry = {
  offset: number;
  size: number;
  travel: number;
};

type ThumbDragSession = {
  maxScrollLeft: number;
  pointerId: number;
  startClientX: number;
  startScrollLeft: number;
  thumb: HTMLElement;
  thumbTravel: number;
};

type KanbanNavigationRailProps = {
  onScrollByColumn: (direction: -1 | 1) => void;
  onScrollByViewport: (direction: -1 | 1) => void;
  onScrollToEdge: (edge: "start" | "end") => void;
  scrollElement: HTMLElement | null;
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

const MIN_RAIL_THUMB_SIZE = 44;

export const getRailThumbGeometry = (
  metrics: Pick<
    HorizontalScrollMetrics,
    "clientWidth" | "maxScrollLeft" | "scrollLeft" | "scrollWidth"
  >,
  trackWidth: number,
): RailThumbGeometry => {
  if (trackWidth <= 0 || metrics.scrollWidth <= 0) {
    return { offset: 0, size: 0, travel: 0 };
  }

  const size = clamp(
    trackWidth * (metrics.clientWidth / metrics.scrollWidth),
    Math.min(MIN_RAIL_THUMB_SIZE, trackWidth),
    trackWidth,
  );
  const travel = Math.max(0, trackWidth - size);
  const offset =
    metrics.maxScrollLeft > 0
      ? travel * (metrics.scrollLeft / metrics.maxScrollLeft)
      : 0;

  return { offset, size, travel };
};

export const getScrollLeftFromThumbDrag = ({
  deltaX,
  maxScrollLeft,
  startScrollLeft,
  thumbTravel,
}: {
  deltaX: number;
  maxScrollLeft: number;
  startScrollLeft: number;
  thumbTravel: number;
}) => {
  if (thumbTravel <= 0 || maxScrollLeft <= 0) {
    return 0;
  }

  return clamp(
    startScrollLeft + deltaX * (maxScrollLeft / thumbTravel),
    0,
    maxScrollLeft,
  );
};

export const getScrollLeftFromTrackClick = ({
  clientWidth,
  pointerClientX,
  scrollWidth,
  trackLeft,
  trackWidth,
}: {
  clientWidth: number;
  pointerClientX: number;
  scrollWidth: number;
  trackLeft: number;
  trackWidth: number;
}) => {
  const maxScrollLeft = Math.max(0, scrollWidth - clientWidth);
  if (trackWidth <= 0 || maxScrollLeft <= 0) {
    return 0;
  }

  const trackRatio = clamp((pointerClientX - trackLeft) / trackWidth, 0, 1);
  return clamp(trackRatio * scrollWidth - clientWidth / 2, 0, maxScrollLeft);
};

const sameMetrics = (
  current: HorizontalScrollMetrics,
  next: HorizontalScrollMetrics,
) =>
  current.canScrollLeft === next.canScrollLeft &&
  current.canScrollRight === next.canScrollRight &&
  current.clientWidth === next.clientWidth &&
  current.hasOverflow === next.hasOverflow &&
  current.maxScrollLeft === next.maxScrollLeft &&
  current.scrollLeft === next.scrollLeft &&
  current.scrollWidth === next.scrollWidth;

const sameMarkers = (current: ColumnMarker[], next: ColumnMarker[]) =>
  current.length === next.length &&
  current.every(
    (marker, index) =>
      marker.label === next[index]?.label &&
      marker.positionPercent === next[index]?.positionPercent,
  );

const getColumnMarkers = (element: HTMLElement): ColumnMarker[] => {
  if (element.scrollWidth <= 0) {
    return [];
  }

  return Array.from(
    element.querySelectorAll<HTMLElement>(".nora-kanban-column"),
  ).map((column) => ({
    label:
      column
        .querySelector<HTMLElement>(".nora-kanban-column-title")
        ?.textContent?.trim() ?? "",
    positionPercent:
      ((column.offsetLeft + column.offsetWidth / 2) / element.scrollWidth) *
      100,
  }));
};

const prefersReducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export const KanbanNavigationRail = ({
  onScrollByColumn,
  onScrollByViewport,
  onScrollToEdge,
  scrollElement,
}: KanbanNavigationRailProps) => {
  const translate = useTranslate();
  const [metrics, setMetrics] =
    useState<HorizontalScrollMetrics>(EMPTY_METRICS);
  const [columnMarkers, setColumnMarkers] = useState<ColumnMarker[]>([]);
  const [trackWidth, setTrackWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const animationFrameRef = useRef<number | null>(null);
  const dragSessionRef = useRef<ThumbDragSession | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const updateGeometry = useCallback(() => {
    if (!scrollElement) {
      setMetrics(EMPTY_METRICS);
      setColumnMarkers([]);
      setTrackWidth(0);
      return;
    }

    const nextMetrics = getHorizontalScrollMetrics(scrollElement);
    const nextMarkers = getColumnMarkers(scrollElement);
    const nextTrackWidth = trackRef.current?.clientWidth ?? 0;

    setMetrics((current) =>
      sameMetrics(current, nextMetrics) ? current : nextMetrics,
    );
    setColumnMarkers((current) =>
      sameMarkers(current, nextMarkers) ? current : nextMarkers,
    );
    setTrackWidth((current) =>
      current === nextTrackWidth ? current : nextTrackWidth,
    );
  }, [scrollElement]);

  const scheduleGeometryUpdate = useCallback(() => {
    if (animationFrameRef.current !== null) {
      return;
    }

    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      updateGeometry();
    });
  }, [updateGeometry]);

  const cleanupThumbDrag = useCallback((updateState = true) => {
    const session = dragSessionRef.current;
    dragSessionRef.current = null;

    if (session?.thumb.hasPointerCapture(session.pointerId)) {
      session.thumb.releasePointerCapture(session.pointerId);
    }
    if (updateState) {
      setIsDragging(false);
    }
  }, []);

  useEffect(() => {
    if (!scrollElement) {
      updateGeometry();
      return;
    }

    scrollElement.addEventListener("scroll", scheduleGeometryUpdate, {
      passive: true,
    });

    const resizeObserver = new ResizeObserver(scheduleGeometryUpdate);
    resizeObserver.observe(scrollElement);
    if (scrollElement.firstElementChild) {
      resizeObserver.observe(scrollElement.firstElementChild);
    }
    if (trackRef.current) {
      resizeObserver.observe(trackRef.current);
    }

    const mutationObserver = new MutationObserver(scheduleGeometryUpdate);
    mutationObserver.observe(scrollElement, {
      childList: true,
      subtree: true,
    });
    scheduleGeometryUpdate();

    return () => {
      scrollElement.removeEventListener("scroll", scheduleGeometryUpdate);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      cleanupThumbDrag(false);
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [cleanupThumbDrag, scheduleGeometryUpdate, scrollElement, updateGeometry]);

  useEffect(() => {
    if (!isDragging) {
      return;
    }

    const onWindowPointerEnd = (event: Event) => {
      const pointerId = (event as Event & { pointerId?: number }).pointerId;
      if (
        pointerId == null ||
        dragSessionRef.current?.pointerId === pointerId
      ) {
        cleanupThumbDrag();
      }
    };
    const onWindowMouseEnd = () => cleanupThumbDrag();

    window.addEventListener("pointerup", onWindowPointerEnd, true);
    window.addEventListener("pointercancel", onWindowPointerEnd, true);
    window.addEventListener("mouseup", onWindowMouseEnd, true);
    window.addEventListener("blur", onWindowMouseEnd);

    return () => {
      window.removeEventListener("pointerup", onWindowPointerEnd, true);
      window.removeEventListener("pointercancel", onWindowPointerEnd, true);
      window.removeEventListener("mouseup", onWindowMouseEnd, true);
      window.removeEventListener("blur", onWindowMouseEnd);
    };
  }, [cleanupThumbDrag, isDragging]);

  const thumbGeometry = getRailThumbGeometry(metrics, trackWidth);

  const onThumbPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!scrollElement || event.button !== 0 || thumbGeometry.travel <= 0) {
      return;
    }

    dragSessionRef.current = {
      maxScrollLeft: metrics.maxScrollLeft,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startScrollLeft: scrollElement.scrollLeft,
      thumb: event.currentTarget,
      thumbTravel: thumbGeometry.travel,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
    event.preventDefault();
    event.stopPropagation();
  };

  const onThumbPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const session = dragSessionRef.current;
    if (!scrollElement || !session || session.pointerId !== event.pointerId) {
      return;
    }

    scrollElement.scrollLeft = getScrollLeftFromThumbDrag({
      deltaX: event.clientX - session.startClientX,
      maxScrollLeft: session.maxScrollLeft,
      startScrollLeft: session.startScrollLeft,
      thumbTravel: session.thumbTravel,
    });
    event.preventDefault();
  };

  const onThumbPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (dragSessionRef.current?.pointerId === event.pointerId) {
      cleanupThumbDrag();
    }
  };

  const onTrackClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!scrollElement || event.target !== event.currentTarget) {
      return;
    }

    const trackRect = event.currentTarget.getBoundingClientRect();
    scrollElement.scrollTo({
      left: getScrollLeftFromTrackClick({
        clientWidth: metrics.clientWidth,
        pointerClientX: event.clientX,
        scrollWidth: metrics.scrollWidth,
        trackLeft: trackRect.left,
        trackWidth: trackRect.width,
      }),
      behavior: getKanbanScrollBehavior(prefersReducedMotion()),
    });
  };

  const onThumbKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      onScrollByColumn(event.key === "ArrowLeft" ? -1 : 1);
      return;
    }
    if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      onScrollByViewport(event.key === "PageUp" ? -1 : 1);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      onScrollToEdge(event.key === "Home" ? "start" : "end");
    }
  };

  const leftLabel = translate("resources.deals.kanban.scroll_left");
  const rightLabel = translate("resources.deals.kanban.scroll_right");

  return (
    <div className="nora-kanban-rail-dock">
      <nav
        className="nora-kanban-navigation-rail"
        data-testid="nora-kanban-navigation-rail"
        data-visible={metrics.hasOverflow}
        data-dragging={isDragging}
        aria-hidden={!metrics.hasOverflow}
        aria-label={translate("resources.deals.kanban.scroll_controls_label")}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="nora-kanban-rail-button nora-touch-target"
          onClick={() => onScrollByColumn(-1)}
          disabled={!metrics.canScrollLeft}
          aria-label={leftLabel}
          title={leftLabel}
          aria-controls="nora-deals-kanban"
          data-testid="nora-kanban-rail-left"
        >
          <ChevronLeft aria-hidden />
        </Button>

        <div
          ref={trackRef}
          className="nora-kanban-rail-track"
          data-testid="nora-kanban-rail-track"
          onClick={onTrackClick}
        >
          <div className="nora-kanban-rail-markers" aria-hidden>
            {columnMarkers.map((marker, index) => (
              <span
                key={`${marker.label}-${index}`}
                className="nora-kanban-rail-marker"
                style={{ left: `${marker.positionPercent}%` }}
              />
            ))}
          </div>
          <div
            className="nora-kanban-rail-thumb"
            data-testid="nora-kanban-rail-thumb"
            role="scrollbar"
            tabIndex={metrics.hasOverflow ? 0 : -1}
            aria-label={translate("resources.deals.kanban.scroll_thumb")}
            aria-controls="nora-deals-kanban"
            aria-orientation="horizontal"
            aria-valuemin={0}
            aria-valuemax={Math.round(metrics.maxScrollLeft)}
            aria-valuenow={Math.round(metrics.scrollLeft)}
            style={{
              width: `${thumbGeometry.size}px`,
              transform: `translate3d(${thumbGeometry.offset}px, -50%, 0)`,
            }}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={onThumbKeyDown}
            onLostPointerCapture={() => cleanupThumbDrag()}
            onPointerCancel={onThumbPointerEnd}
            onPointerDown={onThumbPointerDown}
            onPointerMove={onThumbPointerMove}
            onPointerUp={onThumbPointerEnd}
          >
            <span className="nora-kanban-rail-thumb-visual" aria-hidden>
              <GripHorizontal />
            </span>
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="nora-kanban-rail-button nora-touch-target"
          onClick={() => onScrollByColumn(1)}
          disabled={!metrics.canScrollRight}
          aria-label={rightLabel}
          title={rightLabel}
          aria-controls="nora-deals-kanban"
          data-testid="nora-kanban-rail-right"
        >
          <ChevronRight aria-hidden />
        </Button>
      </nav>
    </div>
  );
};
