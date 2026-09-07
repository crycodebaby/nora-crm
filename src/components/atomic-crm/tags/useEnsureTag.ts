import { useCallback } from "react";
import { useDataProvider } from "ra-core";

import {
  ensureTag,
  type EnsureTagInput,
  type EnsureTagResult,
} from "../application/commands/ensureTag";
import type { CrmDataProvider } from "../providers/types";

/**
 * React binding for the EnsureTag command. Every UI that can bring a
 * Markierung into existence uses this and nothing else, so "create" means the
 * same thing on a contact, in bulk mode and during a CSV import.
 */
export function useEnsureTag() {
  const dataProvider = useDataProvider<CrmDataProvider>();

  return useCallback(
    (input: EnsureTagInput): Promise<EnsureTagResult> =>
      ensureTag(dataProvider, input),
    [dataProvider],
  );
}
