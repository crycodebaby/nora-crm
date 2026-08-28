/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import type { DataProvider } from "ra-core";

import { isEffectiveContactOfCompany } from "./taskContextCheck";
import { effectiveContactContractCases } from "../../../domain/effectiveContactContext.contractCases";

const buildDataProvider = (
  contacts: Array<{ id: number; company_id: number | null }>,
  companies: Array<{ id: number; self_contact_id: number | null }>,
): DataProvider =>
  ({
    getOne: async (resource: string, params: { id: unknown }) => {
      const list = resource === "contacts" ? contacts : companies;
      const record = list.find((r) => String(r.id) === String(params.id));
      if (!record) {
        throw new Error(`not found: ${resource}/${String(params.id)}`);
      }
      return { data: record };
    },
  }) as unknown as DataProvider;

describe("FakeRest isEffectiveContactOfCompany (contract matrix, parity with SQL + TS domain)", () => {
  it.each(effectiveContactContractCases)(
    "$name: $description",
    async ({ contact, company, expected }) => {
      const dataProvider = buildDataProvider(
        contact ? [contact] : [],
        company ? [company] : [],
      );
      const result = await isEffectiveContactOfCompany(
        contact?.id ?? null,
        company?.id ?? null,
        dataProvider,
      );
      expect(result).toBe(expected);
    },
  );
});
