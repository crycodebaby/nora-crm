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
