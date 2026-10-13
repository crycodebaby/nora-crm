import { useCallback, useEffect } from "react";
import { useSearchParams } from "react-router";

import type { WorkScope } from "../application/queries/getWorkItems";
import { parseSicht, withSicht } from "./workSicht";

/**
 * Reads and writes the URL-backed view. Every write is a `replace`
 * (docs/nora/26 §4): "Zurück" leaves the Arbeitskorb to where the user came
 * from, while the current view stays restorable from the URL.
 */
export const useArbeitskorbSicht = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { scope, needsNormalization } = parseSicht(searchParams);

  useEffect(() => {
    if (needsNormalization) {
      setSearchParams((current) => withSicht(current, "mine"), {
        replace: true,
      });
    }
  }, [needsNormalization, setSearchParams]);

  const setScope = useCallback(
    (next: WorkScope) => {
      setSearchParams((current) => withSicht(current, next), {
        replace: true,
      });
    },
    [setSearchParams],
  );

  return { scope, setScope };
};
