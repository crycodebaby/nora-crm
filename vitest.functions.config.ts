import path from "node:path";
import { defineConfig } from "vitest/config";

// Separate config for Supabase Edge Function tests.
// These files are written for Deno and use JSR imports (jsr:@supabase/supabase-js@2)
// that Vite cannot resolve. We alias jsr: imports to their npm equivalents so
// Vitest can run the tests in a Node environment without a Deno runtime.
//
// It also runs the unit tests of the operator tools under supabase/maintenance/
// (W8-E Stage C control plane): they are Node code, like the functions, and
// must run in CI rather than only in a local verifier.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "supabase/functions/**/*.test.ts",
      "supabase/maintenance/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", ".supabase-e2e/**"],
  },
  resolve: {
    alias: {
      // Map the Deno imports to the installed npm packages
      "jsr:@supabase/supabase-js@2": path.resolve(
        __dirname,
        "node_modules/@supabase/supabase-js",
      ),
      "npm:tldts": path.resolve(__dirname, "node_modules/tldts"),
      "npm:pgsql-ast-parser@^12": "pgsql-ast-parser",
    },
  },
});
