import { useCallback, useState } from "react";

const STORAGE_KEY = "nora-deals-show-all-stages";

function readShowAllDealStages(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(STORAGE_KEY) === "true";
}

export function useShowAllDealStages() {
  const [showAllStages, setShowAllStages] = useState(readShowAllDealStages);

  const toggleShowAllStages = useCallback(() => {
    setShowAllStages((prev) => {
      const next = !prev;
      window.localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  return { showAllStages, toggleShowAllStages };
}
