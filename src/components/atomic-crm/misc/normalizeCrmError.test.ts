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

/**
 * Atomic Contact Primary Intent (2026-09-08): two distinct, stable codes —
 * "another primary currently exists" (legacy raw write / residual constraint
 * hit) vs. "the primary changed since the form was loaded" (stale-UI
 * protection of the atomic command). Neither may fall through to the
 * generic load_failed, and the legacy constraint anchor must stay narrow.
 */
describe("normalizeCrmError — Atomic Contact Primary Intent", () => {
  it("maps a raw 23505 on uq_contacts_one_primary_per_company to PRIMARY_CONTACT_ALREADY_EXISTS (never load_failed)", () => {
    const normalized = normalizeCrmError({
      code: "23505",
      message:
        'duplicate key value violates unique constraint "uq_contacts_one_primary_per_company"',
      details: "Key (company_id)=(20) already exists.",
      hint: null,
      status: 409,
    });
    expect(normalized.code).toBe(
      NORA_ERROR_CODES.PRIMARY_CONTACT_ALREADY_EXISTS,
    );
    expect(normalized.messageKey).toBe(
      "crm.errors.primary_contact_already_exists",
    );
    expect(normalized.messageKey).not.toBe("crm.errors.load_failed");
  });

  it("maps DETAIL = NORA_PRIMARY_CONTACT_ALREADY_EXISTS from the atomic command regardless of wording", () => {
    const normalized = normalizeCrmError({
      code: "23505",
      message: "customer 20 already has a primary contact",
      details: NORA_ERROR_CODES.PRIMARY_CONTACT_ALREADY_EXISTS,
    });
    expect(normalized.code).toBe(
      NORA_ERROR_CODES.PRIMARY_CONTACT_ALREADY_EXISTS,
    );
    expect(normalized.messageKey).toBe(
      "crm.errors.primary_contact_already_exists",
    );
  });

  it("maps DETAIL = NORA_PRIMARY_CONTACT_CHANGED to its own stable key — never conflated with 'already exists'", () => {
    const normalized = normalizeCrmError({
      code: "P0001",
      message:
        "primary contact of customer 20 changed since the form was loaded",
      details: NORA_ERROR_CODES.PRIMARY_CONTACT_CHANGED,
      status: 400,
    });
    expect(normalized.code).toBe(NORA_ERROR_CODES.PRIMARY_CONTACT_CHANGED);
    expect(normalized.messageKey).toBe("crm.errors.primary_contact_changed");
    expect(normalized.messageKey).not.toBe(
      "crm.errors.primary_contact_already_exists",
    );
  });

  it("keeps permission denied as permission denied on the contact commands", () => {
    const normalized = normalizeCrmError({
      code: "42501",
      message: "insufficient privileges",
      details: NORA_ERROR_CODES.PERMISSION_DENIED,
      status: 403,
    });
    expect(normalized.code).toBe(NORA_ERROR_CODES.PERMISSION_DENIED);
    expect(normalized.messageKey).toBe("crm.errors.permission_denied");
  });

  it("does not map an unrelated unique violation to the primary-contact code (no broad duplicate-key matching)", () => {
    const other = normalizeCrmError({
      code: "23505",
      message:
        'duplicate key value violates unique constraint "uq__sales__email"',
      details: "Key (email)=(x@y.de) already exists.",
    });
    expect(other.code).not.toBe(
      NORA_ERROR_CODES.PRIMARY_CONTACT_ALREADY_EXISTS,
    );
    expect(other.messageKey).not.toBe(
      "crm.errors.primary_contact_already_exists",
    );

    const privat = normalizeCrmError({
      code: "23505",
      message:
        'duplicate key value violates unique constraint "uq_companies_self_contact_individual"',
    });
    expect(privat.code).toBe(NORA_ERROR_CODES.PRIVATE_CUSTOMER_ALREADY_EXISTS);
  });
});
