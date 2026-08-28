import { describe, expect, it } from "vitest";

import { normalizeCrmError } from "./normalizeCrmError";
import { NORA_ERROR_CODES } from "../domain/noraErrorCodes";

/**
 * Error Contract Wave (2026-08-28): machine-code-first normalization.
 * A recognized NoraErrorCode (from `.details`, mirroring PostgrestError) is
 * authoritative regardless of MESSAGE wording; an unrecognized details
 * string is never accepted as a Nora code; absent `.details`, the legacy
 * regex ladder still resolves the same handful of pre-existing business
 * rejections (backward compatibility, no big-bang removal).
 */
describe("normalizeCrmError — Error Contract Wave", () => {
  it("classifies a recognized NoraErrorCode from .details regardless of MESSAGE wording (Human Message Independence)", () => {
    const a = normalizeCrmError({
      code: "42501",
      message:
        "contact 7 is not part of the effective contact context of company 3",
      details: NORA_ERROR_CODES.CONTACT_NOT_IN_CUSTOMER_CONTEXT,
      hint: "",
    });
    const b = normalizeCrmError({
      code: "23514",
      message:
        "tasks.company_id (3) does not match the effective contact context of contact 7 (1)",
      details: NORA_ERROR_CODES.CONTACT_NOT_IN_CUSTOMER_CONTEXT,
      hint: "",
    });

    expect(a.code).toBe(NORA_ERROR_CODES.CONTACT_NOT_IN_CUSTOMER_CONTEXT);
    expect(b.code).toBe(NORA_ERROR_CODES.CONTACT_NOT_IN_CUSTOMER_CONTEXT);
    expect(a.messageKey).toBe(b.messageKey);
    expect(a.messageKey).toBe("crm.errors.contact_not_in_customer_context");
  });

  it("recognizes a NoraErrorCode carried on a plain thrown Error's .details (FakeRest shape)", () => {
    const error = new Error(
      "Privatkundenakte benoetigt einen Vor- oder Nachnamen des repraesentierenden Kontakts",
    );
    (error as Error & { details: string }).details =
      NORA_ERROR_CODES.INDIVIDUAL_NAME_REQUIRED;

    const normalized = normalizeCrmError(error);
    expect(normalized.code).toBe(NORA_ERROR_CODES.INDIVIDUAL_NAME_REQUIRED);
    expect(normalized.messageKey).toBe("crm.errors.individual_name_required");
  });

  it("never accepts an unrecognized details string as a Nora code (no startsWith('NORA_') guess)", () => {
    const normalized = normalizeCrmError({
      code: "23505",
      message: "duplicate key value violates unique constraint",
      details: "NORA_SOMETHING_MADE_UP",
    });
    expect(normalized.code).toBeUndefined();
    // Falls through to legacy detection — no pattern matches this generic
    // text either, so it lands in the unknown bucket, never the fabricated
    // code's meaning.
    expect(normalized.kind).toBe("unknown");
  });

  it("legacy fallback: private customer conflict detected by constraint name when no DETAIL is present", () => {
    const normalized = normalizeCrmError({
      message:
        'duplicate key value violates unique constraint "uq_companies_self_contact_individual"',
    });
    expect(normalized.code).toBe(
      NORA_ERROR_CODES.PRIVATE_CUSTOMER_ALREADY_EXISTS,
    );
    expect(normalized.messageKey).toBe(
      "crm.errors.private_customer_already_exists",
    );
  });

  it("legacy fallback: individual name required detected by shared message substring when no DETAIL is present", () => {
    const normalized = normalizeCrmError({
      message:
        "Privatkundenakte benoetigt einen Vor- oder Nachnamen (companies.name darf nicht leer werden)",
    });
    expect(normalized.code).toBe(NORA_ERROR_CODES.INDIVIDUAL_NAME_REQUIRED);
  });

  it("still classifies network errors as network (unaffected by the machine-code check)", () => {
    const normalized = normalizeCrmError(new Error("Failed to fetch"));
    expect(normalized.kind).toBe("network");
    expect(normalized.code).toBeUndefined();
  });

  it("still classifies service-unavailable errors correctly", () => {
    const normalized = normalizeCrmError({
      status: 503,
      message: "service unavailable",
    });
    expect(normalized.kind).toBe("service_unavailable");
  });

  it("still falls back to unknown/load_failed for a genuinely unrecognized technical error", () => {
    const normalized = normalizeCrmError(
      new Error("something totally unexpected"),
    );
    expect(normalized.kind).toBe("unknown");
    expect(normalized.messageKey).toBe("crm.errors.load_failed");
    expect(normalized.code).toBeUndefined();
  });

  it("classifies NORA_PERMISSION_DENIED via .details distinctly from generic RLS text matching", () => {
    const normalized = normalizeCrmError({
      code: "42501",
      message: "insufficient privileges",
      details: NORA_ERROR_CODES.PERMISSION_DENIED,
    });
    expect(normalized.code).toBe(NORA_ERROR_CODES.PERMISSION_DENIED);
    expect(normalized.kind).toBe("permission_denied");
  });
});
