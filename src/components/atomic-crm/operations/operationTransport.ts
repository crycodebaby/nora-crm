import type { OperationContext } from "./operationContext";
import {
  NORA_OPERATION_ID_HEADER,
  normalizeOperationId,
} from "./operationContext";

type MetaWithHeaders = {
  headers?: Record<string, string>;
  [key: string]: unknown;
};

/**
 * Merge operation_id into React Admin mutation/query `meta.headers`
 * for ra-data-postgrest / ra-supabase-core.
 *
 * Ownership rules (transport must never mint a new operation):
 * - Missing header → set from context.operationId
 * - Existing valid header → keep it (no silent swap to another UUID)
 * - Existing invalid header → replace with context.operationId
 * - Other meta keys / other headers are preserved
 */
export const withOperationMeta = (
  meta: MetaWithHeaders | undefined,
  context: OperationContext,
): MetaWithHeaders & { headers: Record<string, string> } => {
  const base = meta ?? {};
  const existingHeaders = base.headers ?? {};
  const existingId = normalizeOperationId(
    existingHeaders[NORA_OPERATION_ID_HEADER],
  );
  return {
    ...base,
    headers: {
      ...existingHeaders,
      [NORA_OPERATION_ID_HEADER]: existingId ?? context.operationId,
    },
  };
};

/**
 * Params helper for dataProvider.create / update / delete.
 * Does not create operation IDs — only attaches / preserves them.
 */
export const withOperationIdParams = <
  T extends { meta?: MetaWithHeaders; [key: string]: unknown },
>(
  params: T,
  context: OperationContext,
): T & { meta: MetaWithHeaders & { headers: Record<string, string> } } => ({
  ...params,
  meta: withOperationMeta(params.meta, context),
});

/**
 * Headers object for supabase.functions.invoke(..., { headers }).
 * Does not mint IDs. An existing valid header in `extra` wins.
 */
export const operationIdInvokeHeaders = (
  context: OperationContext,
  extra?: Record<string, string>,
): Record<string, string> => {
  const headers = { ...(extra ?? {}) };
  const existingId = normalizeOperationId(headers[NORA_OPERATION_ID_HEADER]);
  headers[NORA_OPERATION_ID_HEADER] = existingId ?? context.operationId;
  return headers;
};

/**
 * Apply setHeader on a PostgREST/RPC builder that supports it.
 * Keeps a narrow structural type so callers stay decoupled from supabase-js.
 * Does not mint IDs — always uses context.operationId.
 */
export const applyOperationIdRpcHeader = <
  T extends { setHeader: (name: string, value: string) => T },
>(
  builder: T,
  context: OperationContext,
): T => builder.setHeader(NORA_OPERATION_ID_HEADER, context.operationId);

/**
 * Resolve an inbound operation id from mutation meta (Application Service
 * already owns the operation). Invalid / missing → null (caller may mint).
 */
export const readOperationIdFromMeta = (
  meta: MetaWithHeaders | undefined,
): string | null =>
  normalizeOperationId(meta?.headers?.[NORA_OPERATION_ID_HEADER]);
