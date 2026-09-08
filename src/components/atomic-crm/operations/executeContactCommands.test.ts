import { describe, expect, it, vi } from "vitest";

import { createOperationManager } from "./operationManager";
import { NORA_OPERATION_ID_HEADER } from "./operationContext";
import { executeCreateContact } from "./executeCreateContact";
import { executeUpdateContact } from "./executeUpdateContact";
import { NORA_ERROR_CODES } from "../domain/noraErrorCodes";

const freshManager = () => createOperationManager({ recordError: null });

const rpcReturning = (data: unknown, error: unknown = null) => {
  const setHeader = vi.fn().mockResolvedValue({ data, error });
  const rpc = vi.fn().mockReturnValue({ setHeader });
  return { rpc, setHeader };
};

describe("executeCreateContact", () => {
  it("calls create_contact ONCE with the intent, idempotency key and operation-id header; returns the committed row", async () => {
    const { rpc, setHeader } = rpcReturning({
      contact_id: 31,
      contact: { id: 31, first_name: "Träumchen", is_primary: true },
      demoted_contact_id: 29,
      _meta: { disposition: "executed" },
    });
    const manager = freshManager();

    const result = await executeCreateContact(
      {
        contact: { first_name: "Träumchen", company_id: 20 },
        primary: { kind: "make_primary", expectedCurrentPrimaryContactId: 29 },
        idempotencyKey: "0f1e2d3c-0000-4000-8000-000000000001",
      },
      rpc,
      manager,
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("create_contact", {
      p_contact: { first_name: "Träumchen", company_id: 20 },
      p_primary_intent: "make_primary",
      p_expected_primary_contact_id: 29,
      p_idempotency_key: "0f1e2d3c-0000-4000-8000-000000000001",
    });
    expect(setHeader).toHaveBeenCalledWith(
      NORA_OPERATION_ID_HEADER,
      expect.any(String),
    );
    // never a second browser-side set_primary_contact call
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["create_contact"]);

    expect(result).toEqual({
      contact_id: 31,
      contact: { id: 31, first_name: "Träumchen", is_primary: true },
      demoted_contact_id: 29,
    });

    const [record] = manager.getOperations();
    expect(record.operationType).toBe("contact.create");
    expect(record.status).toBe("success");
    expect(record.execution).toBe("executed");
    expect(record.result).toEqual({ contactId: 31, demotedContactId: 29 });
  });

  it("reports a replayed disposition without inventing one for legacy calls", async () => {
    const replayed = rpcReturning({
      contact_id: 31,
      contact: { id: 31 },
      demoted_contact_id: null,
      _meta: { disposition: "replayed" },
    });
    const manager = freshManager();
    await executeCreateContact(
      { contact: {}, primary: { kind: "keep" }, idempotencyKey: "k" },
      replayed.rpc,
      manager,
    );
    expect(manager.getOperations()[0].execution).toBe("replayed");

    const plain = rpcReturning({
      contact_id: 32,
      contact: { id: 32 },
      demoted_contact_id: null,
    });
    const manager2 = freshManager();
    await executeCreateContact(
      { contact: {}, primary: { kind: "keep" } },
      plain.rpc,
      manager2,
    );
    expect(plain.rpc).toHaveBeenCalledWith(
      "create_contact",
      expect.objectContaining({
        p_idempotency_key: null,
        p_primary_intent: "keep",
      }),
    );
    expect(manager2.getOperations()[0].execution).toBeUndefined();
  });

  it("throws the original typed backend error (stale holder) and marks the operation with the stable code", async () => {
    const pgError = {
      code: "P0001",
      message:
        "primary contact of customer 20 changed since the form was loaded",
      details: NORA_ERROR_CODES.PRIMARY_CONTACT_CHANGED,
    };
    const { rpc } = rpcReturning(null, pgError);
    const manager = freshManager();

    await expect(
      executeCreateContact(
        {
          contact: { company_id: 20 },
          primary: {
            kind: "make_primary",
            expectedCurrentPrimaryContactId: 29,
          },
        },
        rpc,
        manager,
      ),
    ).rejects.toBe(pgError);

    const [record] = manager.getOperations();
    expect(record.status).toBe("error");
    expect(record.errorCode).toBe(NORA_ERROR_CODES.PRIMARY_CONTACT_CHANGED);
  });
});

describe("executeUpdateContact", () => {
  it("calls update_contact ONCE with patch + intent and a contact.update operation", async () => {
    const { rpc, setHeader } = rpcReturning({
      contact_id: 29,
      contact: { id: 29, is_primary: true, title: "Chef" },
      demoted_contact_id: 31,
    });
    const manager = freshManager();

    const result = await executeUpdateContact(
      {
        contactId: 29,
        patch: { title: "Chef", company_id: 20 },
        primary: { kind: "make_primary", expectedCurrentPrimaryContactId: 31 },
      },
      rpc,
      manager,
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("update_contact", {
      p_contact_id: 29,
      p_patch: { title: "Chef", company_id: 20 },
      p_primary_intent: "make_primary",
      p_expected_primary_contact_id: 31,
    });
    expect(setHeader).toHaveBeenCalledWith(
      NORA_OPERATION_ID_HEADER,
      expect.any(String),
    );
    expect(result.contact).toEqual({ id: 29, is_primary: true, title: "Chef" });

    const [record] = manager.getOperations();
    expect(record.operationType).toBe("contact.update");
    expect(record.resourceId).toBe(29);
    expect(record.result).toEqual({ contactId: 29, demotedContactId: 31 });
  });

  it("maps clear/keep without an expected holder", async () => {
    const { rpc } = rpcReturning({
      contact_id: 29,
      contact: { id: 29 },
      demoted_contact_id: null,
    });
    await executeUpdateContact(
      { contactId: 29, patch: {}, primary: { kind: "clear" } },
      rpc,
      freshManager(),
    );
    expect(rpc).toHaveBeenCalledWith(
      "update_contact",
      expect.objectContaining({
        p_primary_intent: "clear",
        p_expected_primary_contact_id: null,
      }),
    );
  });

  it("rethrows a permission error unchanged", async () => {
    const pgError = {
      code: "42501",
      message: "insufficient privileges",
      details: NORA_ERROR_CODES.PERMISSION_DENIED,
    };
    const { rpc } = rpcReturning(null, pgError);
    await expect(
      executeUpdateContact(
        { contactId: 1, patch: {}, primary: { kind: "keep" } },
        rpc,
        freshManager(),
      ),
    ).rejects.toBe(pgError);
  });
});
