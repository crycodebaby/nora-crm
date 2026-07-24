import { describe, expect, it, beforeEach } from "vitest";
import {
  CURRENT_SALE_CACHE_KEY,
  clearCurrentSaleCache,
  setCurrentSaleCache,
  syncCurrentSaleCacheIfSelf,
} from "./authProvider";

describe("current sale identity cache", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("writes and clears only RaStore.auth.current_sale", () => {
    localStorage.setItem("RaStore.auth.is_initialized", "true");
    localStorage.setItem("unrelated", "keep");

    setCurrentSaleCache({
      id: 7,
      first_name: "Pending",
      last_name: "Pending",
      role: "admin",
      administrator: true,
      disabled: false,
    });

    expect(localStorage.getItem(CURRENT_SALE_CACHE_KEY)).toContain("Pending");

    setCurrentSaleCache({
      id: 7,
      first_name: "Max",
      last_name: "Mustermann",
      role: "admin",
      administrator: true,
      disabled: false,
      avatar: { src: "https://example.com/a.png" },
    });

    const cached = JSON.parse(
      localStorage.getItem(CURRENT_SALE_CACHE_KEY) ?? "{}",
    );
    expect(cached.first_name).toBe("Max");
    expect(cached.last_name).toBe("Mustermann");
    expect(cached.avatar).toEqual({ src: "https://example.com/a.png" });

    clearCurrentSaleCache();
    expect(localStorage.getItem(CURRENT_SALE_CACHE_KEY)).toBeNull();
    expect(localStorage.getItem("RaStore.auth.is_initialized")).toBe("true");
    expect(localStorage.getItem("unrelated")).toBe("keep");
  });

  it("syncCurrentSaleCacheIfSelf updates only the signed-in sale", () => {
    setCurrentSaleCache({
      id: 1,
      first_name: "Pending",
      last_name: "Pending",
      role: "admin",
    });

    syncCurrentSaleCacheIfSelf(
      {
        id: 2,
        first_name: "Other",
        last_name: "User",
        role: "office",
      },
      1,
    );

    expect(
      JSON.parse(localStorage.getItem(CURRENT_SALE_CACHE_KEY) ?? "{}")
        .first_name,
    ).toBe("Pending");

    syncCurrentSaleCacheIfSelf(
      {
        id: 1,
        first_name: "Max",
        last_name: "Mustermann",
        role: "admin",
      },
      1,
    );

    const self = JSON.parse(
      localStorage.getItem(CURRENT_SALE_CACHE_KEY) ?? "{}",
    );
    expect(self.first_name).toBe("Max");
    expect(self.last_name).toBe("Mustermann");
  });
});
