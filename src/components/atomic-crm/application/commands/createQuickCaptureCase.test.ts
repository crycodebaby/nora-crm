/**
 * @vitest-environment node
 *
 * Error Contract regression (Pre-Production Hardening Patch): the RPC layer
 * may raise arbitrary free-text Postgres exceptions, but createQuickCaptureCase
 * must never let that raw text leak into the i18n key the UI builds
 * (`crm.quick_capture.errors.${error.message}`) — every rejection must
 * normalize to one of a small finite set of stable codes.
 */
import { describe, expect, it } from "vitest";

import {
  createQuickCaptureCase,
  QuickCaptureSubmitError,
} from "./createQuickCaptureCase";
import type { CrmDataProvider } from "../../providers/types";

const baseInput = {
  customer: { mode: "existing" as const, companyId: 1 },
  contact: { mode: "none" as const },
  dealTitle: "Fenstergriff defekt",
  dealCategory: "fensterservice",
  dealDescription: "",
  sourceChannel: "phone" as const,
  sourceLabel: "Telefon",
  followUpDate: "2026-08-27",
  taskType: "" as const,
  salesId: 1,
};

const buildDataProvider = (
  createQuickCaptureCaseImpl: () => Promise<unknown>,
): CrmDataProvider =>
  ({
    createQuickCaptureCase: createQuickCaptureCaseImpl,
  }) as unknown as CrmDataProvider;

describe("createQuickCaptureCase — Error Contract", () => {
  it("maps a raw 'effective contact context' RPC rejection to the stable contact_not_in_customer_context code, not the raw text", async () => {
    const dataProvider = buildDataProvider(() =>
      Promise.reject(
        new Error(
          "contact 7 is not part of the effective contact context of company 3",
        ),
      ),
    );

    await expect(
      createQuickCaptureCase(dataProvider, baseInput),
    ).rejects.toMatchObject({
      message: "contact_not_in_customer_context",
    });
  });

  it("maps an unrecognized/free-text RPC error to the generic case_create_failed code, never the raw exception text", async () => {
    const dataProvider = buildDataProvider(() =>
      Promise.reject(
        new Error(
          'duplicate key value violates unique constraint "companies_pkey"',
        ),
      ),
    );

    let caught: unknown;
    try {
      await createQuickCaptureCase(dataProvider, baseInput);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(QuickCaptureSubmitError);
    expect((caught as QuickCaptureSubmitError).message).toBe(
      "case_create_failed",
    );
    // The raw DB text must never become the message used to build the i18n key.
    expect((caught as QuickCaptureSubmitError).message).not.toMatch(
      /unique constraint/,
    );
  });

  it("resolves normally when the RPC succeeds", async () => {
    const dataProvider = buildDataProvider(() =>
      Promise.resolve({ company_id: 1, contact_id: null, deal_id: 9 }),
    );

    const result = await createQuickCaptureCase(dataProvider, baseInput);
    expect(result).toEqual({
      dealId: 9,
      companyId: 1,
      contactId: null,
      taskFailed: false,
    });
  });
});
