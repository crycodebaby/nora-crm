import { describe, expect, it, vi } from "vitest";
import { createQuickCaptureCase } from "./createQuickCaptureCase";
import type { CrmDataProvider } from "../../providers/types";

describe("Quick Capture site address boundary", () => {
  it("sends no hidden site fields when the form has no site address inputs", async () => {
    const createCase = vi
      .fn()
      .mockResolvedValue({ company_id: 7, contact_id: null, deal_id: 12 });
    const provider = {
      createQuickCaptureCase: createCase,
    } as unknown as CrmDataProvider;
    await createQuickCaptureCase(provider, {
      customer: { mode: "existing", companyId: 7 },
      contact: { mode: "none" },
      dealTitle: "Fenster",
      dealCategory: "fensterservice",
      dealDescription: "",
      sourceChannel: "phone",
      sourceLabel: "Telefon",
      followUpDate: "2026-09-26",
      taskType: "",
      salesId: 3,
    });
    const payload = createCase.mock.calls[0]?.[0];
    expect(payload).toBeDefined();
    expect(payload.deal).not.toHaveProperty("site_street");
    expect(payload.deal).not.toHaveProperty("site_city");
    expect(payload.deal).not.toHaveProperty("site_floor");
    expect(payload.deal).not.toHaveProperty("site_tenant_name");
  });
});
