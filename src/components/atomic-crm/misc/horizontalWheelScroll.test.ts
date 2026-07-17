/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

import { handleHorizontalWheelScroll } from "./horizontalWheelScroll";

function createContainer(
  scrollLeft: number,
  scrollWidth: number,
  clientWidth: number,
) {
  return {
    scrollLeft,
    scrollWidth,
    clientWidth,
  } as unknown as HTMLElement;
}

function createWheelEvent(deltaY: number, deltaX = 0) {
  return {
    deltaY,
    deltaX,
    preventDefault: vi.fn(),
  } as unknown as WheelEvent;
}

describe("handleHorizontalWheelScroll", () => {
  it("does nothing without horizontal overflow", () => {
    const container = createContainer(0, 100, 100);
    const event = createWheelEvent(100);
    expect(handleHorizontalWheelScroll(container, event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("scrolls right on wheel down", () => {
    const container = createContainer(0, 500, 200);
    const event = createWheelEvent(50);
    expect(handleHorizontalWheelScroll(container, event)).toBe(true);
    expect(container.scrollLeft).toBe(50);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("does not scroll past the right edge", () => {
    const container = createContainer(299, 500, 200);
    const event = createWheelEvent(50);
    expect(handleHorizontalWheelScroll(container, event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("does not scroll past the left edge", () => {
    const container = createContainer(0, 500, 200);
    const event = createWheelEvent(-50);
    expect(handleHorizontalWheelScroll(container, event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("prefers native horizontal delta on trackpads", () => {
    const container = createContainer(0, 500, 200);
    const event = createWheelEvent(10, 40);
    expect(handleHorizontalWheelScroll(container, event)).toBe(false);
    expect(container.scrollLeft).toBe(0);
  });
});
