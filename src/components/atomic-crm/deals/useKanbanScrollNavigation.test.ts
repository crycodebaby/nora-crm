/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import {
  getHorizontalScrollMetrics,
  getHorizontalScrollState,
  getKanbanScrollBehavior,
} from "./useKanbanScrollNavigation";
import {
  getRailThumbGeometry,
  getScrollLeftFromThumbDrag,
  getScrollLeftFromTrackClick,
} from "./KanbanNavigationRail";

describe("getHorizontalScrollState", () => {
  it("shows only the right affordance at the beginning", () => {
    expect(
      getHorizontalScrollState({
        clientWidth: 1000,
        scrollLeft: 0,
        scrollWidth: 4000,
      } as HTMLElement),
    ).toEqual({
      canScrollLeft: false,
      canScrollRight: true,
      hasOverflow: true,
    });
  });

  it("shows both affordances in the middle", () => {
    expect(
      getHorizontalScrollState({
        clientWidth: 1000,
        scrollLeft: 1200,
        scrollWidth: 4000,
      } as HTMLElement),
    ).toEqual({
      canScrollLeft: true,
      canScrollRight: true,
      hasOverflow: true,
    });
  });

  it("shows only the left affordance at the end", () => {
    expect(
      getHorizontalScrollState({
        clientWidth: 1000,
        scrollLeft: 3000,
        scrollWidth: 4000,
      } as HTMLElement),
    ).toEqual({
      canScrollLeft: true,
      canScrollRight: false,
      hasOverflow: true,
    });
  });

  it("hides navigation when all columns fit", () => {
    expect(
      getHorizontalScrollState({
        clientWidth: 1000,
        scrollLeft: 0,
        scrollWidth: 1000,
      } as HTMLElement),
    ).toEqual({
      canScrollLeft: false,
      canScrollRight: false,
      hasOverflow: false,
    });
  });

  it("disables smooth motion when reduced motion is requested", () => {
    expect(getKanbanScrollBehavior(true)).toBe("auto");
    expect(getKanbanScrollBehavior(false)).toBe("smooth");
  });

  it("normalizes out-of-range geometry after resize or content mutation", () => {
    expect(
      getHorizontalScrollMetrics({
        clientWidth: 1400,
        scrollLeft: 3000,
        scrollWidth: 3600,
      } as HTMLElement),
    ).toMatchObject({
      maxScrollLeft: 2200,
      scrollLeft: 2200,
      canScrollLeft: true,
      canScrollRight: false,
    });
  });
});

describe("Kanban navigation rail geometry", () => {
  const metrics = getHorizontalScrollMetrics({
    clientWidth: 1200,
    scrollLeft: 1400,
    scrollWidth: 4000,
  } as HTMLElement);

  it("sizes the viewport thumb from the real visible-to-total ratio", () => {
    expect(getRailThumbGeometry(metrics, 1000)).toEqual({
      size: 300,
      offset: 350,
      travel: 700,
    });
  });

  it("keeps a very small proportional thumb touch-grabbable", () => {
    expect(
      getRailThumbGeometry(
        {
          clientWidth: 390,
          maxScrollLeft: 3670,
          scrollLeft: 1835,
          scrollWidth: 4060,
        },
        250,
      ),
    ).toEqual({
      size: 44,
      offset: 103,
      travel: 206,
    });
  });

  it("keeps thumb and native scrollLeft proportional during a direct drag", () => {
    expect(
      getScrollLeftFromThumbDrag({
        deltaX: 100,
        maxScrollLeft: 2800,
        startScrollLeft: 1400,
        thumbTravel: 700,
      }),
    ).toBe(1800);
  });

  it("clamps thumb dragging cleanly at beginning and end", () => {
    expect(
      getScrollLeftFromThumbDrag({
        deltaX: -1000,
        maxScrollLeft: 2800,
        startScrollLeft: 1400,
        thumbTravel: 700,
      }),
    ).toBe(0);
    expect(
      getScrollLeftFromThumbDrag({
        deltaX: 1000,
        maxScrollLeft: 2800,
        startScrollLeft: 1400,
        thumbTravel: 700,
      }),
    ).toBe(2800);
  });

  it("centers the viewport around a clicked real track position", () => {
    expect(
      getScrollLeftFromTrackClick({
        clientWidth: 1200,
        pointerClientX: 750,
        scrollWidth: 4000,
        trackLeft: 0,
        trackWidth: 1000,
      }),
    ).toBe(2400);
  });
});
