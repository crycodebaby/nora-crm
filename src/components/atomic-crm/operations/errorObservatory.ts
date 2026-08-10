/**
 * Nora Application Backbone – Error Observatory client (Foundation Wave 3).
 *
 * Best-effort persistence for failed Manager operations.
 * Never part of the failed business transaction; never replaces business errors.
 */

import { normalizeCrmError } from "../misc/normalizeCrmError";
import type {
  OperationResourceType,
  OperationType,
} from "./operationContext";
import { getNoraFrontendVersion } from "./frontendVersion";

export type OperationErrorPersistInput = {
  operationId: string;
  operationType: OperationType;
  resourceType: OperationResourceType;
  resourceId?: string | number | null;
  safeErrorCode?: string;
  error?: unknown;
  source?: "frontend" | "edge_function" | "system";
  frontendVersion?: string;
};

export type OperationErrorPersistResult = {
  errorId: string;
  publicRef: string;
};

export type OperationErrorRecorder = (
  input: OperationErrorPersistInput,
) => Promise<OperationErrorPersistResult | null>;

export type ReportOperationErrorInput = {
  errorId?: string;
  publicRef?: string;
};

export type ReportOperationErrorResult = {
  errorId: string;
  publicRef: string;
  reportedByUserAt: string;
  alreadyReported: boolean;
};

/** Client-side allowlist mirror of nora_private.sanitize_operation_error_context. */
export const TECHNICAL_CONTEXT_ALLOWLIST = [
  "http_status",
  "postgrest_code",
  "sqlstate",
  "edge_function",
] as const;

export type TechnicalContextKey = (typeof TECHNICAL_CONTEXT_ALLOWLIST)[number];

const SECRETISH = /(bearer|authorization|password|refresh_token|service_role|eyJ)/i;

const extractTechnicalErrorCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string") return undefined;
  const trimmed = code.trim().slice(0, 64);
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(trimmed)) return undefined;
  if (SECRETISH.test(trimmed)) return undefined;
  return trimmed;
};

const extractSqlstate = (error: unknown): string | undefined => {
  if (!error || typeof error !== "object") return undefined;
  const details = (error as { details?: unknown }).details;
  const hint = (error as { hint?: unknown }).hint;
  for (const candidate of [details, hint]) {
    if (typeof candidate === "string") {
      const match = candidate.match(/\b([0-9A-Z]{5})\b/);
      if (match) return match[1];
    }
  }
  return undefined;
};

/**
 * Build allowlisted technical_context from a CRM/PostgREST error.
 * Never includes messages, bodies, headers, or tokens.
 */
export const buildTechnicalContext = (
  error: unknown,
): Record<string, string | number> => {
  const normalized = normalizeCrmError(error);
  const ctx: Record<string, string | number> = {};
  if (typeof normalized.status === "number") {
    ctx.http_status = normalized.status;
  }
  const pgCode = extractTechnicalErrorCode(error);
  if (pgCode && /^[A-Z0-9_]{2,32}$/i.test(pgCode)) {
    ctx.postgrest_code = pgCode.toUpperCase();
  }
  const sqlstate = extractSqlstate(error);
  if (sqlstate) {
    ctx.sqlstate = sqlstate;
  }
  return ctx;
};

type RpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

export const createSupabaseOperationErrorRecorder = (
  getClient: () => RpcClient,
): OperationErrorRecorder => {
  return async (input) => {
    try {
      const client = getClient();
      const technicalContext = buildTechnicalContext(input.error);
      const { data, error } = await client.rpc("record_operation_error", {
        p_operation_type: input.operationType,
        p_operation_id: input.operationId,
        p_resource_type: input.resourceType,
        p_resource_id:
          input.resourceId == null || input.resourceId === ""
            ? null
            : String(input.resourceId).slice(0, 64),
        p_source: input.source ?? "frontend",
        p_safe_error_code: input.safeErrorCode ?? null,
        p_technical_error_code: extractTechnicalErrorCode(input.error) ?? null,
        p_technical_context: technicalContext,
        p_frontend_version:
          input.frontendVersion ?? getNoraFrontendVersion(),
      });

      if (error || !data || typeof data !== "object") {
        if (import.meta.env.DEV) {
          console.warn(
            "[Nora Error Observatory] record_operation_error failed",
            error && typeof error === "object" && "message" in error
              ? (error as { message?: string }).message
              : "unknown",
          );
        }
        return null;
      }

      const row = data as { error_id?: unknown; public_ref?: unknown };
      if (
        typeof row.error_id !== "string" ||
        typeof row.public_ref !== "string"
      ) {
        return null;
      }
      return { errorId: row.error_id, publicRef: row.public_ref };
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn(
          "[Nora Error Observatory] record threw",
          err instanceof Error ? err.message : "unknown",
        );
      }
      return null;
    }
  };
};

export const reportOperationErrorWithClient = async (
  getClient: () => RpcClient,
  input: ReportOperationErrorInput,
): Promise<ReportOperationErrorResult> => {
  const { data, error } = await getClient().rpc("report_operation_error", {
    p_error_id: input.errorId ?? null,
    p_public_ref: input.publicRef ?? null,
  });
  if (error) {
    throw error;
  }
  const row = data as {
    error_id?: unknown;
    public_ref?: unknown;
    reported_by_user_at?: unknown;
    already_reported?: unknown;
  };
  if (
    typeof row.error_id !== "string" ||
    typeof row.public_ref !== "string" ||
    typeof row.reported_by_user_at !== "string"
  ) {
    throw new Error("crm.errors.load_failed");
  }
  return {
    errorId: row.error_id,
    publicRef: row.public_ref,
    reportedByUserAt: row.reported_by_user_at,
    alreadyReported: Boolean(row.already_reported),
  };
};

/** Process-wide recorder used by the default Operation Manager. */
let defaultRecorder: OperationErrorRecorder | null = null;

export const getDefaultOperationErrorRecorder =
  (): OperationErrorRecorder | null => defaultRecorder;

export const setDefaultOperationErrorRecorder = (
  recorder: OperationErrorRecorder | null,
): void => {
  defaultRecorder = recorder;
};

/**
 * Best-effort record. Never throws. Returns null on any failure.
 */
export const recordOperationErrorBestEffort = async (
  input: OperationErrorPersistInput,
  recorder: OperationErrorRecorder | null = getDefaultOperationErrorRecorder(),
): Promise<OperationErrorPersistResult | null> => {
  if (!recorder) return null;
  try {
    return await recorder(input);
  } catch {
    return null;
  }
};
