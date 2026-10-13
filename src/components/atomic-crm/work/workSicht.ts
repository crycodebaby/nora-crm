/**
 * The Arbeitskorb view ("Sicht") lives only in the URL (docs/nora/26 §4):
 * `?sicht=mine` | `?sicht=team`. No actor, no cursor, no state scope in the
 * URL, and no browser storage.
 */
import type { WorkScope } from "../application/queries/getWorkItems";

export const SICHT_PARAM = "sicht";
export const DEFAULT_SICHT: WorkScope = "mine";

export type ParsedSicht = {
  scope: WorkScope;
  /**
   * `true` when the URL carries an invalid or repeated `sicht` and must be
   * rewritten (by replace) to `sicht=mine`. A missing `sicht` is valid and
   * leaves the URL untouched.
   */
  needsNormalization: boolean;
};

export const parseSicht = (searchParams: URLSearchParams): ParsedSicht => {
  const values = searchParams.getAll(SICHT_PARAM);
  if (values.length === 0) {
    return { scope: DEFAULT_SICHT, needsNormalization: false };
  }
  if (values.length === 1 && (values[0] === "mine" || values[0] === "team")) {
    return { scope: values[0], needsNormalization: false };
  }
  return { scope: DEFAULT_SICHT, needsNormalization: true };
};

/** Same params with exactly one `sicht`; every other param is kept. */
export const withSicht = (
  searchParams: URLSearchParams,
  scope: WorkScope,
): URLSearchParams => {
  const next = new URLSearchParams(searchParams);
  next.delete(SICHT_PARAM);
  next.set(SICHT_PARAM, scope);
  return next;
};
