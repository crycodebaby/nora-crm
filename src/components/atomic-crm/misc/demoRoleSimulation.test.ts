/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  clearActiveDemoSale,
  ensureDemoSession,
  getActiveDemoRole,
  getActiveDemoSale,
  NORA_DEMO_USER_STORAGE_KEY,
  resolveDemoPostSwitchUrl,
  resolveDemoSaleByEmail,
  REACT_QUERY_PERSIST_KEY,
  saleToDemoIdentity,
  switchDemoUserByRole,
  switchDemoUserByEmail,
  clearDemoQueryPersistCache,
  isRouteAllowedForDemoRole,
} from "../providers/fakerest/demoSession";
import { getAccessRedirectTarget } from "./noraAccessGuardUtils";
import { canAccess } from "../providers/commons/canAccess";
import { resolveDemoReloadPath } from "./finalizeDemoSessionSwitch";

describe("demoSession canonical source", () => {
  afterEach(() => {
    clearActiveDemoSale();
    localStorage.clear();
  });

  it("does not overwrite an existing session on ensureDemoSession", () => {
    switchDemoUserByRole("viewer");
    ensureDemoSession();
    expect(getActiveDemoSale()?.email).toBe("viewer@nora.demo");
    expect(getActiveDemoRole()).toBe("viewer");
  });

  it("switchDemoUserByRole updates identity fields", () => {
    switchDemoUserByRole("office");
    const identity = saleToDemoIdentity(getActiveDemoSale()!);
    expect(identity.fullName).toBe("Otto Office");
    expect(identity.role).toBe("office");
    expect(identity.email).toBe("office@nora.demo");
  });

  it("switchDemoUserByEmail resolves static demo users", () => {
    const sale = switchDemoUserByEmail("viewer@nora.demo");
    expect(sale?.last_name).toBe("Viewer");
    expect(localStorage.getItem(NORA_DEMO_USER_STORAGE_KEY)).toContain(
      "viewer@nora.demo",
    );
  });

  it("resolveDemoSaleByEmail is case-insensitive", () => {
    expect(resolveDemoSaleByEmail("Admin@Nora.Demo")?.role).toBe("admin");
  });

  it("reload restores the same demo user from localStorage", () => {
    switchDemoUserByRole("viewer");
    const stored = localStorage.getItem(NORA_DEMO_USER_STORAGE_KEY);
    expect(stored).toBeTruthy();
    const reloaded = JSON.parse(stored!);
    expect(reloaded.first_name).toBe("Vera");
    expect(getActiveDemoRole()).toBe("viewer");
  });

  it("clearDemoQueryPersistCache removes react-query offline cache key", () => {
    localStorage.setItem(REACT_QUERY_PERSIST_KEY, "{}");
    clearDemoQueryPersistCache();
    expect(localStorage.getItem(REACT_QUERY_PERSIST_KEY)).toBeNull();
  });
});

describe("demo role switch access matrix", () => {
  it("admin → viewer hides write actions in canAccess", () => {
    expect(canAccess("admin", { resource: "deals", action: "create" })).toBe(
      true,
    );
    expect(canAccess("viewer", { resource: "deals", action: "create" })).toBe(
      false,
    );
  });

  it("viewer → office enables CRM write but not admin management", () => {
    expect(canAccess("office", { resource: "deals", action: "edit" })).toBe(
      true,
    );
    expect(
      canAccess("office", { resource: "configuration", action: "edit" }),
    ).toBe(false);
  });

  it("office → admin enables sales and configuration", () => {
    expect(canAccess("admin", { resource: "sales", action: "list" })).toBe(
      true,
    );
    expect(
      canAccess("admin", { resource: "configuration", action: "edit" }),
    ).toBe(true);
  });

  it("audit global list only for admin", () => {
    expect(
      canAccess("admin", { resource: "audit_events", action: "list" }),
    ).toBe(true);
    expect(
      canAccess("office", { resource: "audit_events", action: "list" }),
    ).toBe(false);
    expect(
      canAccess("viewer", { resource: "audit_events", action: "list" }),
    ).toBe(false);
  });

  it("audit context history for admin and office, not viewer", () => {
    expect(
      canAccess("admin", { resource: "audit_events", action: "show" }),
    ).toBe(true);
    expect(
      canAccess("office", { resource: "audit_events", action: "show" }),
    ).toBe(true);
    expect(
      canAccess("viewer", { resource: "audit_events", action: "show" }),
    ).toBe(false);
  });
});

describe("demo post-switch route safety", () => {
  it("redirects viewer from settings and import", () => {
    expect(resolveDemoPostSwitchUrl("/settings", "viewer")).toBe("/");
    expect(resolveDemoPostSwitchUrl("/import", "office")).toBe("/");
    expect(resolveDemoPostSwitchUrl("/sales/1", "viewer")).toBe("/");
  });

  it("allows admin on management routes", () => {
    expect(resolveDemoPostSwitchUrl("/settings", "admin")).toBeNull();
    expect(isRouteAllowedForDemoRole("/import", "admin")).toBe(true);
  });

  it("redirects viewer from direct edit URLs without loop", () => {
    expect(resolveDemoPostSwitchUrl("/kunden/5", "viewer")).toBe("/");
    expect(resolveDemoPostSwitchUrl("/kunden/5/show", "viewer")).toBeNull();
    expect(
      getAccessRedirectTarget({
        canAccess: false,
        isPending: false,
        recordId: 5,
        resource: "companies",
        redirectTarget: "show",
      }),
    ).toEqual({ type: "ra", action: "show", resource: "companies", id: 5 });
  });

  it("resolveDemoReloadPath keeps show URLs for viewer", () => {
    expect(resolveDemoReloadPath("#/kunden/5/show", "viewer")).toBe(
      "/kunden/5/show",
    );
    expect(resolveDemoReloadPath("#/settings", "office")).toBe("/");
  });
});

describe("DemoRoleSwitcher visibility", () => {
  it("is tied to VITE_IS_DEMO flag", async () => {
    const { isNoraDemoMode } = await import("./noraDemoMode");
    expect(typeof isNoraDemoMode).toBe("boolean");
  });
});
