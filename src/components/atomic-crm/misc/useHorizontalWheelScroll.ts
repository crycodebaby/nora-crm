import { useEffect, useRef } from "react";

import { handleHorizontalWheelScroll } from "./horizontalWheelScroll";

export function useHorizontalWheelScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const onWheel = (event: WheelEvent) => {
      handleHorizontalWheelScroll(element, event);
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  return ref;
}
