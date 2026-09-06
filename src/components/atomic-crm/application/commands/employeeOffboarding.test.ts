import { describe, expect, it, vi } from "vitest";

import {
  EmployeeAccessActionNotApplicableError,
  offboardEmployee,
} from "./employeeAccess";
import { createOperationManager } from "../../operations/operationManager";
import type { CrmDataProvider } from "../../providers/types";
import {
  EMPTY_DEPENDENCY_PREVIEW,
  type EmployeeAccessRecord,
  type EmployeeOffboardingResult,
} from "../../sales/employeeAccessContract";

const record = (
  over: Partial<EmployeeAccessRecord> = {},
): EmployeeAccessRecord => ({
  employeeId: 7,
  email: "eva.e@ergart.de",
  accessState: "disabled",
  disabled: true,
  noraDisabled: true,
  accessConsistency: "consistent",
  identityConsistency: "consistent",
  invitedAt: null,
  activatedAt: "2026-09-02T09:00:00.000Z",
  ...over,
});

const result = (): EmployeeOffboardingResult => ({
  record: record(),
  disposition: "executed",
  sessionsRevoked: 2,
  dependencies: { ...EMPTY_DEPENDENCY_PREVIEW, openDeals: 3, openTasks: 5 },
});

const provider = (over: Partial<CrmDataProvider> = {}) =>
  ({
    offboardEmployee: vi.fn(async () => result()),
    ...over,
  }) as unknown as CrmDataProvider;

describe("offboardEmployee (W5)", () => {
  it("runs through the Operation Manager and forwards the operation id", async () => {
    const dp = provider();
    const manager = createOperationManager();
    const out = await offboardEmployee(
      dp,
      { salesId: 7, currentState: "active" },
      manager,
    );
    expect(out.disposition).toBe("executed");
    expect(out.dependencies.openTasks).toBe(5);
    const call = (dp.offboardEmployee as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as { salesId: number; operationId?: string };
    expect(call.salesId).toBe(7);
    expect(call.operationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    const ops = manager.getOperations();
    expect(ops[0]?.operationType).toBe("employee.offboard");
    expect(ops[0]?.status).toBe("success");
  });

  it("refuses locally when the employee is already out or unresolvable", async () => {
    const dp = provider();
    await expect(
      offboardEmployee(dp, { salesId: 7, currentState: "disabled" }),
    ).rejects.toBeInstanceOf(EmployeeAccessActionNotApplicableError);
    await expect(
      offboardEmployee(dp, { salesId: 7, currentState: "unknown" }),
    ).rejects.toBeInstanceOf(EmployeeAccessActionNotApplicableError);
    expect(dp.offboardEmployee).not.toHaveBeenCalled();
  });

  it("passes typed server refusals through unchanged", async () => {
    const dp = provider({
      offboardEmployee: vi.fn(async () => {
        throw new Error("last_active_admin_required");
      }),
    });
    await expect(
      offboardEmployee(
        dp,
        { salesId: 7, currentState: "active" },
        createOperationManager(),
      ),
    ).rejects.toThrow("last_active_admin_required");
  });

  it("maps the server's action_not_applicable to the typed error", async () => {
    const dp = provider({
      offboardEmployee: vi.fn(async () => {
        throw new Error("action_not_applicable");
      }),
    });
    await expect(
      offboardEmployee(dp, { salesId: 7 }, createOperationManager()),
    ).rejects.toBeInstanceOf(EmployeeAccessActionNotApplicableError);
  });
});
