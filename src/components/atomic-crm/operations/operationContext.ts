/**
 * Nora Application Backbone – Operation Correlation (Foundation Wave 1).
 *
 * operationId is a correlation ID only. It must never be used for
 * authentication, authorization, RLS, or role decisions.
 *
 * Ownership gold standard:
 * - Mint once at the outermost application entry of a business operation.
 * - Pass the same UUID through dataProvider / RPC / Edge / audit.
 * - Nested transport helpers must never mint a replacement ID.
 */

export const NORA_OPERATION_ID_HEADER = "x-nora-operation-id";

/** Accept any RFC-4122 UUID shape (PostgREST / Postgres uuid cast). */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OperationResourceType =
  | "companies"
  | "contacts"
  | "deals"
  | "tasks"
  | "notes"
  | "sales"
  | "checklists"
  | "calendar"
  | "imports"
  | "system";

export type OperationType =
  | "deal.update"
  | "deal.create"
  | "deal.archive"
  | "deal.restore"
  | "deal.assign"
  | "customer.update"
  | "customer.archive"
  | "customer.restore"
  | "customer.createWithContact"
  | "contact.update"
  | "contact.archive"
  | "contact.restore"
  | "contact.setPrimary"
  | "contact.convertToCustomer"
  | "quickCapture.createCase"
  | "quickCapture.createTask"
  | "task.create"
  | "task.update"
  | "task.archive"
  | "contacts.import"
  | "contacts.export"
  // User Lifecycle W4. Lower-case on purpose: record_operation_error only
  // accepts ^[a-z][a-z0-9_.]*$ as operation_type.
  | "employee.change_login_email"
  | "employee.offboard"
  | "employee.delete_account";

export type OperationContext = {
  /** Full UUID – technical correlation key. */
  operationId: string;
  operationType: OperationType;
  resourceType: OperationResourceType;
  resourceId?: string | number | null;
  startedAt: string;
};

export const createOperationId = (): string => {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  // Deterministic-enough fallback for non-browser test hosts without crypto.
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const isValidOperationId = (value: unknown): value is string =>
  typeof value === "string" && UUID_PATTERN.test(value.trim());

/**
 * Normalize a candidate operation id.
 * Invalid / missing values return null — never used as auth/security.
 */
export const normalizeOperationId = (value: unknown): string | null => {
  if (!isValidOperationId(value)) {
    return null;
  }
  return value.trim().toLowerCase();
};

/**
 * Short display form for later UI only (e.g. OP-7A31-C92F).
 * Never store or transmit this instead of the full UUID.
 */
export const formatOperationIdShort = (operationId: string): string => {
  const compact = operationId.replace(/-/g, "").toUpperCase();
  if (compact.length < 8) {
    return `OP-${compact}`;
  }
  return `OP-${compact.slice(0, 4)}-${compact.slice(4, 8)}`;
};

/**
 * Create an OperationContext at a business-operation entry.
 *
 * - No / invalid `operationId` → mint a new UUID (soft; never throws).
 * - Valid `operationId` → reuse exactly (lowercased), no remint.
 */
export const createOperationContext = (input: {
  operationType: OperationType;
  resourceType: OperationResourceType;
  resourceId?: string | number | null;
  operationId?: string;
}): OperationContext => {
  const reused = normalizeOperationId(input.operationId);
  const operationId = reused ?? createOperationId();
  return {
    operationId,
    operationType: input.operationType,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    startedAt: new Date().toISOString(),
  };
};
