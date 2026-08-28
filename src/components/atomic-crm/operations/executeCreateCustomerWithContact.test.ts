import { describe, expect, it, vi } from "vitest";

import { createOperationManager } from "./operationManager";
import { NORA_OPERATION_ID_HEADER } from "./operationContext";
import { executeCreateCustomerWithContact } from "./executeCreateCustomerWithContact";
import { executeSetPrimaryContact } from "./executeSetPrimaryContact";

const freshManager = () => createOperationManager({ recordError: null });

describe("executeCreateCustomerWithContact", () => {
  it("calls create_customer_with_contact with an operation-id header and returns the RPC payload", async () => {
    const setHeader = vi.fn().mockResolvedValue({
      data: { company_id: 42, contact_id: 7 },
      error: null,
    });
    const rpc = vi.fn().mockReturnValue({ setHeader });

    const result = await executeCreateCustomerWithContact(
      {
        company: { name: "Metaphor GmbH" },
        contact: { first_name: "Max", last_name: "Mustermann" },
        existingContactId: null,
      },
      rpc as any,
      freshManager(),
    );

    expect(rpc).toHaveBeenCalledWith("create_customer_with_contact", {
      p_company: { name: "Metaphor GmbH" },
      p_contact: { first_name: "Max", last_name: "Mustermann" },
      p_existing_contact_id: null,
      p_self_contact_id: null,
      p_mark_self: false,
    });
    expect(setHeader).toHaveBeenCalledWith(
      NORA_OPERATION_ID_HEADER,
      expect.any(String),
    );
    expect(result).toEqual({ company_id: 42, contact_id: 7 });
  });

  it("throws the original PostgREST error and does not swallow it (no half-created state hidden from the caller)", async () => {
    const pgError = { message: "insufficient_privilege", code: "42501" };
    const setHeader = vi.fn().mockResolvedValue({ data: null, error: pgError });
    const rpc = vi.fn().mockReturnValue({ setHeader });

    await expect(
      executeCreateCustomerWithContact(
        { company: { name: "Test" } },
        rpc as any,
        freshManager(),
      ),
    ).rejects.toBe(pgError);
  });

  it("passes existingContactId through as p_existing_contact_id and omits p_contact", async () => {
    const setHeader = vi.fn().mockResolvedValue({
      data: { company_id: 1, contact_id: 9 },
      error: null,
    });
    const rpc = vi.fn().mockReturnValue({ setHeader });

    await executeCreateCustomerWithContact(
      { company: { name: "WEG Königsallee 12" }, existingContactId: 9 },
      rpc as any,
      freshManager(),
    );

    expect(rpc).toHaveBeenCalledWith(
      "create_customer_with_contact",
      expect.objectContaining({ p_contact: null, p_existing_contact_id: 9 }),
    );
  });
});

describe("executeSetPrimaryContact", () => {
  it("calls set_primary_contact with the contact id and an operation-id header", async () => {
    const setHeader = vi.fn().mockResolvedValue({ data: null, error: null });
    const rpc = vi.fn().mockReturnValue({ setHeader });

    await executeSetPrimaryContact(9, rpc as any, freshManager());

    expect(rpc).toHaveBeenCalledWith("set_primary_contact", {
      p_contact_id: 9,
    });
    expect(setHeader).toHaveBeenCalledWith(
      NORA_OPERATION_ID_HEADER,
      expect.any(String),
    );
  });

  it("rethrows on RPC error", async () => {
    const pgError = { message: "contact not found" };
    const setHeader = vi.fn().mockResolvedValue({ data: null, error: pgError });
    const rpc = vi.fn().mockReturnValue({ setHeader });

    await expect(
      executeSetPrimaryContact(999, rpc as any, freshManager()),
    ).rejects.toBe(pgError);
  });
});
