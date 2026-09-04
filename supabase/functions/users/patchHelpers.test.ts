import { describe, expect, it } from "vitest";
import {
  buildPatchPlan,
  mapPostgresError,
  needsAuthAdminUpdate,
  resolveExplicitRole,
} from "./patchHelpers";

describe("users patchHelpers", () => {
  it("never defaults missing role to viewer", () => {
    expect(resolveExplicitRole(undefined)).toBeNull();
    expect(resolveExplicitRole("viewer")).toBe("viewer");
    expect(resolveExplicitRole("admin")).toBe("admin");
    expect(resolveExplicitRole("nope")).toBeNull();
  });

  it("builds a role-only plan without auth admin needs", () => {
    const plan = buildPatchPlan({ sales_id: 12, role: "admin" });
    expect("error" in plan).toBe(false);
    if ("error" in plan) return;
    expect(plan.wantsRole).toBe(true);
    expect(plan.role).toBe("admin");
    expect(plan.wantsDisabled).toBe(false);
    expect(plan.wantsName).toBe(false);
    expect(needsAuthAdminUpdate(plan)).toBe(false);
  });

  it("rejects empty payload and invalid role", () => {
    expect(buildPatchPlan({ sales_id: 1 })).toEqual({
      error: "invalid_payload",
    });
    expect(buildPatchPlan({ sales_id: 1, role: "superuser" })).toEqual({
      error: "invalid_role",
    });
  });

  it("maps SQLSTATE 42501 to HTTP 403", () => {
    expect(mapPostgresError({ code: "42501", message: "forbidden" })).toEqual({
      status: 403,
      error: "role_update_forbidden",
      message: "Not authorized to change user roles",
    });
  });

  it("maps unexpected errors to HTTP 500", () => {
    expect(mapPostgresError({ code: "XX000", message: "boom" }).status).toBe(
      500,
    );
  });

  it("disabled-only plan does not require auth admin for role fallback", () => {
    const plan = buildPatchPlan({ sales_id: 3, disabled: true });
    expect("error" in plan).toBe(false);
    if ("error" in plan) return;
    expect(plan.wantsDisabled).toBe(true);
    expect(plan.wantsRole).toBe(false);
    expect(plan.role).toBeNull();
    expect(needsAuthAdminUpdate(plan)).toBe(true);
  });

  it("rejects missing disabled when only empty strings sent", () => {
    expect(
      buildPatchPlan({ sales_id: 1, first_name: "   ", last_name: "  " }),
    ).toEqual({ error: "invalid_payload" });
  });
});

describe("disabled changes must always reach Supabase Auth", () => {
  /**
   * Regression guard for the activate defect found in the V1A production
   * review: clearing sales.disabled without lifting the Auth ban left an
   * "activated" employee still unable to sign in. Both authoritative facts
   * must move together, so a disabled-only patch counts as needing an Auth
   * Admin update even though it changes no profile field.
   */
  it("flags a disabled-only patch as needing an Auth Admin update", () => {
    const plan = buildPatchPlan({ sales_id: 7, disabled: true });
    expect("error" in plan).toBe(false);
    if ("error" in plan) return;

    expect(plan.wantsDisabled).toBe(true);
    expect(plan.wantsName).toBe(false);
    expect(plan.wantsEmail).toBe(false);
    expect(needsAuthAdminUpdate(plan)).toBe(true);
  });

  it("flags re-enabling the same way", () => {
    const plan = buildPatchPlan({ sales_id: 7, disabled: false });
    if ("error" in plan) throw new Error("unexpected");
    expect(plan.disabled).toBe(false);
    expect(needsAuthAdminUpdate(plan)).toBe(true);
  });

  it("still exempts a pure role change from Auth Admin", () => {
    const plan = buildPatchPlan({ sales_id: 7, role: "office" });
    if ("error" in plan) throw new Error("unexpected");
    expect(plan.wantsRole).toBe(true);
    expect(plan.wantsDisabled).toBe(false);
    expect(needsAuthAdminUpdate(plan)).toBe(false);
  });
});
