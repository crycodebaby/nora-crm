/**
 * Translates vertical wheel movement into horizontal scroll when the container
 * has horizontal overflow. Returns true when the event was handled.
 */
export function handleHorizontalWheelScroll(
  container: HTMLElement,
  event: WheelEvent,
): boolean {
  const maxScroll = container.scrollWidth - container.clientWidth;
  if (maxScroll <= 0) {
    return false;
  }

  const deltaX = event.deltaX;
  const deltaY = event.deltaY;

  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    return false;
  }

  if (deltaY === 0) {
    return false;
  }

  const atLeft = container.scrollLeft <= 0;
  const atRight = container.scrollLeft >= maxScroll - 1;
  const scrollingLeft = deltaY < 0;
  const scrollingRight = deltaY > 0;

  if (scrollingLeft && atLeft) {
    return false;
  }

  if (scrollingRight && atRight) {
    return false;
  }

  container.scrollLeft += deltaY;
  event.preventDefault();
  return true;
}
