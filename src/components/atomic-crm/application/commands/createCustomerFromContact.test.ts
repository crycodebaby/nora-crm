/**
 * @vitest-environment node
 *
 * Error Contract Wave (2026-08-28): the client-side pre-check
 * (findExistingPrivateCustomerRecord) is the common path, but a concurrent
 * request can create the private customer record between the check and the
 * write — the DB's uq_companies_self_contact_individual backstop then
 * rejects with NORA_PRIVATE_CUSTOMER_ALREADY_EXISTS. This must resolve to
 * the exact same ExistingPrivateCustomerRecordError the normal pre-check
 * path throws, so the dialog needs no race-specific branch.
 */
import { describe, expect, it, vi } from "vitest";

import {
  createCustomerFromContact,
  ExistingPrivateCustomerRecordError,
} from "./createCustomerFromContact";
import { NORA_ERROR_CODES } from "../../domain/noraErrorCodes";
import type { CrmDataProvider } from "../../providers/types";

describe("createCustomerFromContact — Error Contract", () => {
  it("resolves normally when the RPC succeeds", async () => {
    const dataProvider = {
      getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      createCustomerFromContact: vi
        .fn()
        .mockResolvedValue({ company_id: 5, contact_id: 10 }),
    } as unknown as CrmDataProvider;

    const result = await createCustomerFromContact(dataProvider, {
      contactId: 10,
      customerKind: "business",
      company: { name: "Test GmbH" },
    });

    expect(result).toEqual({ companyId: 5, contactId: 10 });
  });

  it("throws ExistingPrivateCustomerRecordError when the pre-check finds an existing record (common path)", async () => {
    const dataProvider = {
      getList: vi.fn().mockResolvedValue({ data: [{ id: 42 }], total: 1 }),
      createCustomerFromContact: vi.fn(),
    } as unknown as CrmDataProvider;

    await expect(
      createCustomerFromContact(dataProvider, {
        contactId: 10,
        customerKind: "individual",
        company: {},
      }),
    ).rejects.toMatchObject({ companyId: 42 });
    expect(dataProvider.createCustomerFromContact).not.toHaveBeenCalled();
  });

  it("re-resolves and throws the SAME ExistingPrivateCustomerRecordError on a DB-race NORA_PRIVATE_CUSTOMER_ALREADY_EXISTS rejection (pre-check missed a concurrent write)", async () => {
    const getList = vi
      .fn()
      // Pre-check (before the write): nothing found yet.
      .mockResolvedValueOnce({ data: [], total: 0 })
      // Re-resolve after the race is detected: the concurrent write is now visible.
      .mockResolvedValueOnce({ data: [{ id: 99 }], total: 1 });

    const raceError = new Error(
      "Für diese Person existiert bereits eine Privatkundenakte",
    );
    (raceError as Error & { details: string }).details =
      NORA_ERROR_CODES.PRIVATE_CUSTOMER_ALREADY_EXISTS;

    const dataProvider = {
      getList,
      createCustomerFromContact: vi.fn().mockRejectedValue(raceError),
    } as unknown as CrmDataProvider;

    let caught: unknown;
    try {
      await createCustomerFromContact(dataProvider, {
        contactId: 10,
        customerKind: "individual",
        company: {},
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ExistingPrivateCustomerRecordError);
    expect((caught as ExistingPrivateCustomerRecordError).companyId).toBe(99);
  });

  it("re-throws the original error when a NORA_PRIVATE_CUSTOMER_ALREADY_EXISTS rejection cannot be re-resolved to an existing record", async () => {
    const raceError = new Error(
      "Für diese Person existiert bereits eine Privatkundenakte",
    );
    (raceError as Error & { details: string }).details =
      NORA_ERROR_CODES.PRIVATE_CUSTOMER_ALREADY_EXISTS;

    const dataProvider = {
      getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      createCustomerFromContact: vi.fn().mockRejectedValue(raceError),
    } as unknown as CrmDataProvider;

    await expect(
      createCustomerFromContact(dataProvider, {
        contactId: 10,
        customerKind: "individual",
        company: {},
      }),
    ).rejects.toBe(raceError);
  });

  it("Idempotency Hardening (2026-08-29) — with an idempotencyKey, skips the pre-check so a lost-response retry reaches the idempotent RPC's replay path instead of ExistingPrivateCustomerRecordError", async () => {
    const getList = vi.fn().mockResolvedValue({ data: [{ id: 42 }], total: 1 });
    const createCustomerFromContactRpc = vi
      .fn()
      .mockResolvedValue({ company_id: 42, contact_id: 10 });
    const dataProvider = {
      getList,
      createCustomerFromContact: createCustomerFromContactRpc,
    } as unknown as CrmDataProvider;

    const result = await createCustomerFromContact(dataProvider, {
      contactId: 10,
      customerKind: "individual",
      company: { name: "Max Mustermann" },
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    });

    expect(result).toEqual({ companyId: 42, contactId: 10 });
    expect(getList).not.toHaveBeenCalled();
    expect(createCustomerFromContactRpc).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
      }),
    );
  });

  it("Idempotency Hardening (2026-08-29) — with an idempotencyKey, a genuinely distinct intent hitting an existing private customer record still resolves to ExistingPrivateCustomerRecordError via the DB backstop, not a silent duplicate", async () => {
    const getList = vi
      // Re-resolve after the RPC's NORA_PRIVATE_CUSTOMER_ALREADY_EXISTS rejection.
      .fn()
      .mockResolvedValueOnce({ data: [{ id: 99 }], total: 1 });

    const raceError = new Error(
      "Für diese Person existiert bereits eine Privatkundenakte",
    );
    (raceError as Error & { details: string }).details =
      NORA_ERROR_CODES.PRIVATE_CUSTOMER_ALREADY_EXISTS;

    const dataProvider = {
      getList,
      createCustomerFromContact: vi.fn().mockRejectedValue(raceError),
    } as unknown as CrmDataProvider;

    let caught: unknown;
    try {
      await createCustomerFromContact(dataProvider, {
        contactId: 10,
        customerKind: "individual",
        company: {},
        idempotencyKey: "22222222-2222-4222-8222-222222222222",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ExistingPrivateCustomerRecordError);
    expect((caught as ExistingPrivateCustomerRecordError).companyId).toBe(99);
    expect(getList).toHaveBeenCalledTimes(1);
  });

  it("Idempotency Hardening (2026-08-29) — same idempotencyKey with a changed payload propagates NORA_IDEMPOTENCY_CONFLICT unchanged, never as ExistingPrivateCustomerRecordError", async () => {
    const conflictError = new Error(
      "idempotency key reused for a different request",
    );
    (conflictError as Error & { details: string }).details =
      NORA_ERROR_CODES.IDEMPOTENCY_CONFLICT;

    const getList = vi.fn();
    const dataProvider = {
      getList,
      createCustomerFromContact: vi.fn().mockRejectedValue(conflictError),
    } as unknown as CrmDataProvider;

    await expect(
      createCustomerFromContact(dataProvider, {
        contactId: 10,
        customerKind: "individual",
        company: { name: "Erika Mustermann" },
        idempotencyKey: "33333333-3333-4333-8333-333333333333",
      }),
    ).rejects.toBe(conflictError);
    expect(getList).not.toHaveBeenCalled();
  });

  it("re-throws an unrelated RPC error unchanged (never mistranslated into ExistingPrivateCustomerRecordError)", async () => {
    const otherError = new Error("insufficient privileges");
    (otherError as Error & { details: string }).details =
      NORA_ERROR_CODES.PERMISSION_DENIED;

    const dataProvider = {
      getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      createCustomerFromContact: vi.fn().mockRejectedValue(otherError),
    } as unknown as CrmDataProvider;

    await expect(
      createCustomerFromContact(dataProvider, {
        contactId: 10,
        customerKind: "business",
        company: { name: "Test GmbH" },
      }),
    ).rejects.toBe(otherError);
  });
});
