/**
 * Operation Status Contract v1 (2026-08-29): reads the optional
 * `_meta.disposition` ("executed" | "replayed") a Postgres RPC may attach to
 * its jsonb result — see 20260829150000_operation_status_disposition.sql.
 * `_meta` is transport metadata only, never a business field: this helper
 * strips it from the returned data so callers keep working with exactly the
 * business shape they had before this wave.
 */

import type { OperationExecutionDisposition } from "./operationModel";

const isDisposition = (
  value: unknown,
): value is OperationExecutionDisposition =>
  value === "executed" || value === "replayed";

export const extractRpcDisposition = <T>(
  data: unknown,
): { business: T; disposition?: OperationExecutionDisposition } => {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const { _meta, ...rest } = data as Record<string, unknown> & {
      _meta?: unknown;
    };
    if (_meta && typeof _meta === "object") {
      const disposition = (_meta as { disposition?: unknown }).disposition;
      if (isDisposition(disposition)) {
        return { business: rest as T, disposition };
      }
    }
    return { business: rest as T };
  }
  return { business: data as T };
};
