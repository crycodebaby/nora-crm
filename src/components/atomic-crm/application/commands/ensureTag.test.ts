/**
 * @vitest-environment node
 *
 * EnsureTag is the single authoritative creation path for Markierungen
 * (Markierungen Identity Wave, 2026-09-07). These tests pin the two
 * properties the Production incident depended on: the same logical name never
 * produces a second row, and the loser of a race recovers instead of throwing
 * a constraint violation at an office user.
 */
import { describe, expect, it, vi } from "vitest";

import {
  ensureTag,
  findTagByName,
  hasTag,
  normalizeTagName,
  withTag,
  withoutTag,
} from "./ensureTag";
import type { CrmDataProvider } from "../../providers/types";
import type { Tag } from "../../types";
import { NORA_ERROR_CODES } from "../../domain/noraErrorCodes";
import { normalizeCrmError } from "../../misc/normalizeCrmError";

/** In-memory stand-in that enforces the same unique index the database has. */
const buildTagStore = (initial: Tag[] = []) => {
  const rows = [...initial];
  let nextId = rows.reduce((max, tag) => Math.max(max, Number(tag.id)), 0) + 1;
  const createSpy = vi.fn(
    async (_resource: string, { data }: { data: Partial<Tag> }) => {
      const name = String(data.name ?? "").trim();
      if (
        rows.some(
          (row) => normalizeTagName(row.name) === normalizeTagName(name),
        )
      ) {
        throw new Error(
          `duplicate key value violates unique constraint "uq__tags__normalized_name"`,
        );
      }
      const tag = { id: nextId++, name, color: data.color as string };
      rows.push(tag);
      return { data: tag };
    },
  );

  const dataProvider = {
    getList: async () => ({ data: [...rows], total: rows.length }),
    create: createSpy,
  } as unknown as CrmDataProvider;

  return { dataProvider, rows, createSpy };
};

describe("normalizeTagName", () => {
  it("treats surrounding whitespace and case as insignificant", () => {
    expect(normalizeTagName("  Privatperson ")).toBe("privatperson");
    expect(normalizeTagName("PRIVATPERSON")).toBe("privatperson");
  });

  it("keeps a spelling difference significant — 'Privatperso' is NOT 'Privatperson'", () => {
    expect(normalizeTagName("Privatperso")).not.toBe(
      normalizeTagName("Privatperson"),
    );
  });
});

describe("ensureTag", () => {
  it("creates a Markierung when the name is new", async () => {
    const { dataProvider, rows } = buildTagStore();

    const result = await ensureTag(dataProvider, {
      name: "Privatperson",
      color: "#99c1de",
    });

    expect(result.created).toBe(true);
    expect(result.tag.name).toBe("Privatperson");
    expect(rows).toHaveLength(1);
  });

  it("stores the name trimmed", async () => {
    const { dataProvider } = buildTagStore();
    const result = await ensureTag(dataProvider, {
      name: "  Privatperson  ",
      color: "#99c1de",
    });
    expect(result.tag.name).toBe("Privatperson");
  });

  it("reuses an existing Markierung instead of creating a second row", async () => {
    const existing = { id: 3, name: "Privatperson", color: "#99c1de" };
    const { dataProvider, rows, createSpy } = buildTagStore([existing]);

    const result = await ensureTag(dataProvider, {
      name: "Privatperson",
      color: "#eddcd2",
    });

    expect(result.created).toBe(false);
    expect(result.tag).toEqual(existing);
    expect(createSpy).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
  });

  it.each([
    ["different case", "privatperson"],
    ["surrounding whitespace", "  Privatperson  "],
    ["both", "  PRIVATPERSON "],
  ])("reuses the existing Markierung for %s", async (_label, typed) => {
    const { dataProvider, rows } = buildTagStore([
      { id: 3, name: "Privatperson", color: "#99c1de" },
    ]);

    const result = await ensureTag(dataProvider, {
      name: typed,
      color: "#eddcd2",
    });

    expect(result.created).toBe(false);
    expect(result.tag.id).toBe(3);
    expect(rows).toHaveLength(1);
  });

  it("rejects a blank name with the stable NORA_TAG_NAME_REQUIRED code", async () => {
    const { dataProvider } = buildTagStore();

    await expect(
      ensureTag(dataProvider, { name: "   ", color: "#99c1de" }),
    ).rejects.toMatchObject({ details: NORA_ERROR_CODES.TAG_NAME_REQUIRED });
  });

  it("converges on ONE Markierung when two concurrent attempts race", async () => {
    const { dataProvider, rows } = buildTagStore();

    const [first, second] = await Promise.all([
      ensureTag(dataProvider, { name: "Privatperson", color: "#99c1de" }),
      ensureTag(dataProvider, { name: "Privatperson", color: "#99c1de" }),
    ]);

    // Exactly one row exists and both callers hold the same tag.
    expect(rows).toHaveLength(1);
    expect(first.tag.id).toBe(second.tag.id);
    expect([first.created, second.created].filter(Boolean)).toHaveLength(1);
  });

  it("recovers from a unique violation rather than surfacing a raw constraint error", async () => {
    const winner = { id: 9, name: "Privatperson", color: "#99c1de" };
    let rows: Tag[] = [];
    const dataProvider = {
      // Empty on the pre-check, populated by the time the recovery lookup runs.
      getList: async () => ({ data: [...rows], total: rows.length }),
      create: async (_resource: string) => {
        void _resource;
        rows = [winner];
        throw new Error(
          `duplicate key value violates unique constraint "uq__tags__normalized_name"`,
        );
      },
    } as unknown as CrmDataProvider;

    const result = await ensureTag(dataProvider, {
      name: "Privatperson",
      color: "#99c1de",
    });

    expect(result).toEqual({ tag: winner, created: false });
  });

  it("re-throws an unrelated failure instead of swallowing it", async () => {
    const dataProvider = {
      getList: async () => ({ data: [], total: 0 }),
      create: async (_resource: string) => {
        void _resource;
        throw new Error("Failed to fetch");
      },
    } as unknown as CrmDataProvider;

    await expect(
      ensureTag(dataProvider, { name: "Privatperson", color: "#99c1de" }),
    ).rejects.toThrow(/Failed to fetch/);
  });
});

describe("unique-violation classification", () => {
  it("maps the uq__tags__normalized_name violation to the stable conflict code", () => {
    const normalized = normalizeCrmError(
      new Error(
        `duplicate key value violates unique constraint "uq__tags__normalized_name"`,
      ),
    );
    expect(normalized.code).toBe(NORA_ERROR_CODES.TAG_ALREADY_EXISTS);
    expect(normalized.messageKey).toBe("crm.errors.tag_already_exists");
  });

  it("does not misclassify an unrelated unique violation", () => {
    const normalized = normalizeCrmError(
      new Error(
        `duplicate key value violates unique constraint "uq__sales__email"`,
      ),
    );
    expect(normalized.code).not.toBe(NORA_ERROR_CODES.TAG_ALREADY_EXISTS);
  });
});

describe("findTagByName", () => {
  it("returns null for a blank query instead of matching an arbitrary row", async () => {
    const { dataProvider } = buildTagStore([
      { id: 1, name: "Kunde AE", color: "#99c1de" },
    ]);
    await expect(findTagByName(dataProvider, "   ")).resolves.toBeNull();
  });
});

describe("tag array helpers (contact attachment safety)", () => {
  it("attaches to a NULL array — the exact Production failure", () => {
    expect(withTag(null, 7)).toEqual([7]);
    expect(withTag(undefined, 7)).toEqual([7]);
  });

  it("attaching the same Markierung twice keeps ONE id", () => {
    expect(withTag(withTag([1], 7), 7)).toEqual([1, 7]);
  });

  it("preserves order and does not mutate the input", () => {
    const original = [3, 1];
    expect(withTag(original, 2)).toEqual([3, 1, 2]);
    expect(original).toEqual([3, 1]);
  });

  it("removes null-safely", () => {
    expect(withoutTag(null, 7)).toEqual([]);
    expect(withoutTag([1, 7], 7)).toEqual([1]);
  });

  it("reports membership null-safely", () => {
    expect(hasTag(null, 7)).toBe(false);
    expect(hasTag([7], 7)).toBe(true);
  });
});
