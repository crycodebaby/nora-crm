/**
 * AC-01 / AC-06 (level S): the Arbeitskorb reads Work only through the
 * Application query `getWorkItems` and owns no Work truth.
 *
 * Scans every runtime source file under `work/` (tests and the test kit
 * excluded) as raw text, so a later file cannot quietly bypass the boundary.
 */
const sources = import.meta.glob<string>(
  [
    "./**/*.ts",
    "./**/*.tsx",
    "!./**/*.test.ts",
    "!./**/*.test.tsx",
    "!./testing/**",
  ],
  { query: "?raw", import: "default", eager: true },
);

const files = Object.entries(sources);

const offenders = (pattern: RegExp, except: string[] = []) =>
  files
    .filter(([path]) => !except.some((name) => path.endsWith(name)))
    .filter(([, text]) => pattern.test(text))
    .map(([path]) => path);

describe("Arbeitskorb authority boundary (docs/nora/26 §2.1, AC-01)", () => {
  it("scans the runtime files of the surface", () => {
    expect(files.length).toBeGreaterThan(3);
    expect(files.map(([path]) => path)).toContain("./useWorkItems.ts");
  });

  it("never names the Work RPC, its p_* arguments or any rpc call", () => {
    expect(offenders(/get_work_items/)).toEqual([]);
    expect(offenders(/\bp_[a-z_]+/)).toEqual([]);
    expect(offenders(/\brpc\s*\(/)).toEqual([]);
  });

  it("never names the raw tasks resource (the /tasks tab suffix is allowed)", () => {
    expect(offenders(/["'`]tasks["'`]/)).toEqual([]);
  });

  it("never calls a provider's getWorkItems member — only the imported Application function", () => {
    expect(offenders(/\.getWorkItems\s*\(/)).toEqual([]);
    const hook = sources["./useWorkItems.ts"];
    expect(hook).toMatch(
      /import\s*\{[^}]*\bgetWorkItems\b[^}]*\}\s*from\s*["']\.\.\/application\/queries\/getWorkItems["']/,
    );
    expect(offenders(/\bgetWorkItems\s*\(/, ["useWorkItems.ts"])).toEqual([]);
  });

  it("sends exactly scope, stateScope open, pageSize and cursor — no actor", () => {
    const hook = sources["./useWorkItems.ts"];
    const call = hook.match(/getWorkItems\(dataProvider,\s*\{([^}]*)\}\)/);
    expect(call).not.toBeNull();
    const keys = call![1]
      .split(",")
      .map((part) => part.split(":")[0].trim())
      .filter(Boolean);
    expect(keys).toEqual(["scope", "stateScope", "pageSize", "cursor"]);
    expect(call![1]).toMatch(/stateScope:\s*"open"/);
    expect(offenders(/["']done["']|["']all["']/)).toEqual([]);
  });

  it("hands the identity only to the query-key builder", () => {
    expect(offenders(/useGetIdentity/, ["useWorkItems.ts"])).toEqual([]);
    const hook = sources["./useWorkItems.ts"];
    const uses = [...hook.matchAll(/identityPartition/g)].length;
    const keyUses = [
      ...hook.matchAll(
        /work(ItemsQueryKey|ItemsIdentityPrefix)\(\s*identityPartition/g,
      ),
    ].length;
    // Declaration, the `enabled` / null guards, and the key builders.
    expect(keyUses).toBeGreaterThanOrEqual(2);
    expect(hook).not.toMatch(/getWorkItems\([^)]*identity/);
    expect(uses).toBeLessThan(12);
  });

  it("imports no legacy due-state logic", () => {
    expect(
      offenders(/tasksPredicate|NoraUrgencyBadge|getFollowUpStatus/),
    ).toEqual([]);
  });

  it("reads dueAt only as === null / !== null outside the formatter, and never parses dates", () => {
    // Only the one due-date formatter may build a Date (from its own grammar).
    expect(
      offenders(/new Date\(|Date\.parse\(/, ["formatWorkDueDate.ts"]),
    ).toEqual([]);
    expect(sources["./formatWorkDueDate.ts"]).not.toMatch(/Date\.parse\(/);
    for (const [path, text] of files) {
      if (path.endsWith("formatWorkDueDate.ts")) continue;
      const loose = [...text.matchAll(/\.dueAt\b(?!\s*[!=]==\s*null)/g)].filter(
        (match) => {
          const before = text.slice(
            Math.max(0, match.index! - 40),
            match.index,
          );
          return !/formatWorkDueDate\(\s*[\w.]*$/.test(before);
        },
      );
      expect({ path, loose: loose.length }).toEqual({ path, loose: 0 });
    }
  });

  it("keeps no Work or cursor in browser storage and no cross-view placeholder", () => {
    expect(offenders(/localStorage|sessionStorage|indexedDB/)).toEqual([]);
    // The Work query never shows another view's rows as placeholder. (The
    // name enrichment may keep previous *names* while a grown ID set loads.)
    expect(sources["./useWorkItems.ts"]).not.toMatch(
      /placeholderData|keepPreviousData/,
    );
    expect(
      offenders(/placeholderData|keepPreviousData/, ["useWorkContextNames.ts"]),
    ).toEqual([]);
    expect(offenders(/refetchInterval/)).toEqual([]);
  });

  it("derives no Work facts in the browser", () => {
    // isMine/isUnassigned never from holder identity comparisons.
    expect(offenders(/salesId\s*[!=]==|[!=]==\s*[\w.]*salesId/)).toEqual([]);
    // No client sorting of Work rows.
    expect(offenders(/\.sort\(|\.toSorted\(/)).toEqual([]);
  });
});

const entryFiles = import.meta.glob<string>(
  [
    "../root/CRM.tsx",
    "../layout/Header.tsx",
    "../dashboard/MobileDashboard.tsx",
  ],
  { query: "?raw", import: "default", eager: true },
);

describe("Arbeitskorb entry files (docs/nora/26 §4, §14, AC-29)", () => {
  it("import nothing from work/ statically except the path constant", () => {
    expect(Object.keys(entryFiles)).toHaveLength(3);
    for (const [path, text] of Object.entries(entryFiles)) {
      const staticWorkImports = [
        ...text.matchAll(/^import[^;]*from\s*["']\.\.\/work\/([^"']+)["']/gm),
      ].map((match) => match[1]);
      expect({ path, staticWorkImports }).toEqual({
        path,
        staticWorkImports: ["arbeitskorbPath"],
      });
    }
  });

  it("registers both pages as route-wise lazy chunks in both Admin trees", () => {
    const crm = entryFiles["../root/CRM.tsx"];
    expect(crm).toMatch(
      /lazy\(\(\) => import\("\.\.\/work\/ArbeitskorbPage"\)\)/,
    );
    expect(crm).toMatch(/import\("\.\.\/work\/ArbeitskorbPageMobile"\)/);
    expect(
      crm.match(
        /<Route path=\{ARBEITSKORB_PATH\} element=\{<ArbeitskorbPage \/>\} \/>/g,
      ),
    ).toHaveLength(1);
    expect(
      crm.match(
        /<Route path=\{ARBEITSKORB_PATH\} element=\{<ArbeitskorbPageMobile \/>\} \/>/g,
      ),
    ).toHaveLength(1);
    // No Work resource, no alias-map entry, no noLayout route.
    expect(crm).not.toMatch(/<Resource[^>]*name=["']work/);
    expect(crm).not.toMatch(
      /arbeitskorb[^\n]*noLayout|noLayout[^\n]*arbeitskorb/i,
    );
  });
});
