import { describe, expect, it, vi } from "vitest";

import {
  deleteEmployeeAccount,
  EmployeeAccessActionNotApplicableError,
} from "./employeeAccess";
import { createOperationManager } from "../../operations/operationManager";
import type { CrmDataProvider } from "../../providers/types";
import type {
  EmployeeAccountDeletionResult,
  EmployeeDeletionPreview,
} from "../../sales/employeeAccessContract";

const preview = (
  over: Partial<EmployeeDeletionPreview> = {},
): EmployeeDeletionPreview => ({
  supported: true,
  eligible: true,
  reasons: [],
  role: "office",
  businessHistory: {
    companies: 0,
    contacts: 0,
    deals: 0,
    tasks: 0,
    contactNotes: 0,
    dealNotes: 0,
  },
  provenance: {
    checklistTemplates: 0,
    savedTextSnippets: 0,
    googleCalendarConnections: 0,
    auditEventsAsActor: 0,
  },
  technical: {
    auditEventsAsTarget: 1,
    emailDeliveryEventsAttributable: 0,
    emailDeliveryEventsForeign: 0,
  },
  ...over,
});

const executed: EmployeeAccountDeletionResult = {
  employeeId: 7,
  disposition: "executed",
};

const provider = (over: Partial<CrmDataProvider> = {}) =>
  ({
    deleteEmployeeAccount: vi.fn(async () => executed),
    ...over,
  }) as unknown as CrmDataProvider;

describe("deleteEmployeeAccount (application command, W6-B)", () => {
  it("passes the typed name, the admin confirmation and the operation id to the provider", async () => {
    const dp = provider();
    const manager = createOperationManager();
    const result = await deleteEmployeeAccount(
      dp,
      {
        salesId: 7,
        confirmationName: "Fritz Fake",
        adminTargetConfirmed: false,
        currentState: "disabled",
        deletion: preview(),
      },
      manager,
    );
    expect(result).toEqual(executed);
    expect(dp.deleteEmployeeAccount).toHaveBeenCalledTimes(1);
    const call = (dp.deleteEmployeeAccount as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as {
      salesId: number;
      confirmationName: string;
      adminTargetConfirmed: boolean;
      operationId?: string;
    };
    expect(call.salesId).toBe(7);
    expect(call.confirmationName).toBe("Fritz Fake");
    expect(call.adminTargetConfirmed).toBe(false);
    expect(typeof call.operationId).toBe("string");
    expect(call.operationId).toMatch(/[0-9a-f-]{36}/);
  });

  it("refuses locally when the current state or the server preview says no", async () => {
    const dp = provider();
    await expect(
      deleteEmployeeAccount(dp, {
        salesId: 7,
        confirmationName: "Fritz Fake",
        adminTargetConfirmed: false,
        currentState: "active",
        deletion: preview(),
      }),
    ).rejects.toBeInstanceOf(EmployeeAccessActionNotApplicableError);
    await expect(
      deleteEmployeeAccount(dp, {
        salesId: 7,
        confirmationName: "Fritz Fake",
        adminTargetConfirmed: false,
        currentState: "disabled",
        deletion: preview({
          eligible: false,
          reasons: ["business_history_exists"],
        }),
      }),
    ).rejects.toBeInstanceOf(EmployeeAccessActionNotApplicableError);
    expect(dp.deleteEmployeeAccount).not.toHaveBeenCalled();
  });

  it("lets the server's typed refusal through unchanged (the server is authoritative)", async () => {
    const dp = provider({
      deleteEmployeeAccount: vi.fn(async () => {
        throw new Error("business_history_exists");
      }) as never,
    });
    await expect(
      deleteEmployeeAccount(
        dp,
        {
          salesId: 7,
          confirmationName: "Fritz Fake",
          adminTargetConfirmed: false,
          currentState: "disabled",
          deletion: preview(),
        },
        createOperationManager(),
      ),
    ).rejects.toThrow("business_history_exists");
  });

  it("carries already_deleted as a verified disposition", async () => {
    const dp = provider({
      deleteEmployeeAccount: vi.fn(async () => ({
        employeeId: 7,
        disposition: "already_deleted" as const,
      })) as never,
    });
    const result = await deleteEmployeeAccount(
      dp,
      {
        salesId: 7,
        confirmationName: "Fritz Fake",
        adminTargetConfirmed: false,
      },
      createOperationManager(),
    );
    expect(result.disposition).toBe("already_deleted");
  });
});
