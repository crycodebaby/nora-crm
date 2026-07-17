import { describe, expect, it } from "vitest";

import { formatAuthPreflightFailure } from "./authPreflight";

describe("formatAuthPreflightFailure", () => {
  it("includes the failing step, resource, and Supabase diagnostics", () => {
    const result = formatAuthPreflightFailure(
      "D",
      "public.sales (authenticated)",
      {
        code: "PGRST116",
        message: "The result contains 0 rows",
        details: "Results contain 0 rows",
        hint: "Check the self-select policy",
      },
    );

    expect(result).toContain('"step":"D"');
    expect(result).toContain('"resource":"public.sales (authenticated)"');
    expect(result).toContain('"code":"PGRST116"');
    expect(result).toContain("The result contains 0 rows");
    expect(result).toContain("Check the self-select policy");
  });

  it("redacts passwords, keys, authorization values, and JWTs", () => {
    const password = "correct-horse-battery-staple";
    const serviceRoleKey = "service-role-secret-value";
    const result = formatAuthPreflightFailure(
      "C",
      "auth.sessions",
      {
        code: "AUTH_FAILED",
        message: `password=${password} Authorization: Bearer eyJabc.def.ghi`,
        details: `service_role_key=${serviceRoleKey} apikey=publishable-value`,
        hint: `Bearer eyJheader.payload.signature ${password}`,
      },
      [password, serviceRoleKey, "publishable-value"],
    );

    expect(result).not.toContain(password);
    expect(result).not.toContain(serviceRoleKey);
    expect(result).not.toContain("publishable-value");
    expect(result).not.toContain("eyJabc.def.ghi");
    expect(result).not.toContain("eyJheader.payload.signature");
    expect(result).toContain("[REDACTED]");
  });
});
