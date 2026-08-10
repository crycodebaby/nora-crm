/**
 * Edge-side helpers for Nora operation correlation (Foundation Wave 1).
 *
 * Validates and extracts x-nora-operation-id. Does not affect auth/RLS.
 */

export const NORA_OPERATION_ID_HEADER = "x-nora-operation-id";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isValidNoraOperationId = (value: unknown): value is string =>
  typeof value === "string" && UUID_PATTERN.test(value.trim());

/**
 * Read operation_id from an incoming Edge Function Request.
 * Returns null for missing/invalid values — never throws.
 */
export const readOperationIdFromRequest = (req: Request): string | null => {
  try {
    const raw =
      req.headers.get(NORA_OPERATION_ID_HEADER) ??
      req.headers.get(NORA_OPERATION_ID_HEADER.toUpperCase());
    if (!raw) return null;
    const trimmed = raw.trim();
    return isValidNoraOperationId(trimmed) ? trimmed.toLowerCase() : null;
  } catch {
    return null;
  }
};

/**
 * Headers to forward on subsequent PostgREST calls from an Edge Function.
 */
export const operationIdForwardHeaders = (
  operationId: string | null | undefined,
  extra?: Record<string, string>,
): Record<string, string> => {
  const headers = { ...(extra ?? {}) };
  if (operationId && isValidNoraOperationId(operationId)) {
    headers[NORA_OPERATION_ID_HEADER] = operationId.trim().toLowerCase();
  }
  return headers;
};
