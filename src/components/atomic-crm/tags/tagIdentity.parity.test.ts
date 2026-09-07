import { createDataProvider } from "../providers/fakerest";
import { createCrmDb } from "@/test/StoryWrapper";
import { NORA_ERROR_CODES } from "../domain/noraErrorCodes";
import { normalizeCrmError } from "../misc/normalizeCrmError";
import { ensureTag } from "../application/commands/ensureTag";
import type { CrmDataProvider } from "../providers/types";

/**
 * FakeRest parity for the three database rules installed by
 * 20260907140000_nora_tag_identity.sql. Demo mode and the browser tests must
 * fail the way Production fails, or a wave gets "proven" against semantics
 * that only exist in the demo (03-data-model-guardrails.md, Falle 33).
 *
 * The Postgres side of each rule is proven separately against a real database
 * — see the RC report's migration evidence.
 */
const build = (
  overrides: Parameters<typeof createCrmDb>[0] = {},
): CrmDataProvider =>
  createDataProvider({
    db: createCrmDb(overrides),
    latency: 0,
    silent: true,
  }) as unknown as CrmDataProvider;

const listTags = async (dp: CrmDataProvider) => {
  const { data } = await dp.getList("tags", {
    filter: {},
    pagination: { page: 1, perPage: 100 },
    sort: { field: "id", order: "ASC" },
  });
  return data;
};

describe("FakeRest parity — uq__tags__normalized_name", () => {
  it("rejects an exact duplicate name", async () => {
    const dp = build({
      tags: [{ id: 1, name: "Privatperson", color: "#99c1de" }],
    });

    await expect(
      dp.create("tags", { data: { name: "Privatperson", color: "#eddcd2" } }),
    ).rejects.toThrow(/uq__tags__normalized_name/);
  });

  it.each(["privatperson", "  Privatperson  ", "PRIVATPERSON"])(
    "rejects the case/whitespace variant %j",
    async (variant) => {
      const dp = build({
        tags: [{ id: 1, name: "Privatperson", color: "#99c1de" }],
      });

      await expect(
        dp.create("tags", { data: { name: variant, color: "#eddcd2" } }),
      ).rejects.toThrow(/uq__tags__normalized_name/);
    },
  );

  it("keeps a spelling difference distinct — 'Privatperso' is allowed next to 'Privatperson'", async () => {
    const dp = build({
      tags: [{ id: 1, name: "Privatperson", color: "#99c1de" }],
    });

    await expect(
      dp.create("tags", { data: { name: "Privatperso", color: "#99c1de" } }),
    ).resolves.toBeTruthy();
  });

  it("raises a violation the error contract recognises as TAG_ALREADY_EXISTS", async () => {
    const dp = build({
      tags: [{ id: 1, name: "Privatperson", color: "#99c1de" }],
    });

    const error = await dp
      .create("tags", { data: { name: "privatperson", color: "#eddcd2" } })
      .catch((e: unknown) => e);

    expect(normalizeCrmError(error).code).toBe(
      NORA_ERROR_CODES.TAG_ALREADY_EXISTS,
    );
  });

  it("refuses a rename onto an existing name but allows a pure recolour", async () => {
    const dp = build({
      tags: [
        { id: 1, name: "Privatperson", color: "#99c1de" },
        { id: 2, name: "Kunde AE", color: "#f0efeb" },
      ],
    });

    await expect(
      dp.update("tags", {
        id: 2,
        data: { name: "PRIVATPERSON", color: "#f0efeb" },
        previousData: { id: 2, name: "Kunde AE", color: "#f0efeb" },
      }),
    ).rejects.toThrow(/uq__tags__normalized_name/);

    await expect(
      dp.update("tags", {
        id: 2,
        data: { name: "Kunde AE", color: "#eddcd2" },
        previousData: { id: 2, name: "Kunde AE", color: "#f0efeb" },
      }),
    ).resolves.toBeTruthy();
  });
});

describe("FakeRest parity — nora_private.normalize_tag_name", () => {
  it("stores the name trimmed", async () => {
    const dp = build();
    const { data } = await dp.create("tags", {
      data: { name: "  Privatperson  ", color: "#99c1de" },
    });
    expect(data.name).toBe("Privatperson");
  });

  it.each(["", "   "])("rejects the blank name %j", async (blank) => {
    const dp = build();
    const error = await dp
      .create("tags", { data: { name: blank, color: "#99c1de" } })
      .catch((e: unknown) => e);
    expect(normalizeCrmError(error).code).toBe(
      NORA_ERROR_CODES.TAG_NAME_REQUIRED,
    );
  });
});

describe("FakeRest parity — nora_private.normalize_contact_tags", () => {
  it("de-duplicates repeated tag ids on update", async () => {
    const dp = build({
      tags: [{ id: 1, name: "Privatperson", color: "#99c1de" }],
      contacts: [{ id: 1, first_name: "A", last_name: "B", tags: [] } as never],
    });

    const { data } = await dp.update("contacts", {
      id: 1,
      data: { tags: [1, 1, 1] },
      previousData: { id: 1, tags: [] },
    });

    expect(data.tags).toEqual([1]);
  });

  it("turns a NULL tags array into an empty one", async () => {
    const dp = build({
      contacts: [{ id: 1, first_name: "A", last_name: "B" } as never],
    });

    const { data } = await dp.update("contacts", {
      id: 1,
      data: { tags: null },
      previousData: { id: 1 },
    });

    expect(data.tags).toEqual([]);
  });

  it("gives a newly created contact an empty array, never NULL", async () => {
    const dp = build();
    const { data } = await dp.create("contacts", {
      data: { first_name: "A", last_name: "B" },
    });
    expect(data.tags).toEqual([]);
  });
});

describe("FakeRest parity — nora_private.guard_tag_delete", () => {
  it("refuses to delete a Markierung that is still attached", async () => {
    const dp = build({
      tags: [{ id: 1, name: "Privatperson", color: "#99c1de" }],
      contacts: [
        { id: 1, first_name: "A", last_name: "B", tags: [1] } as never,
      ],
    });

    const error = await dp
      .delete("tags", { id: 1, previousData: { id: 1 } })
      .catch((e: unknown) => e);

    expect(normalizeCrmError(error).code).toBe(NORA_ERROR_CODES.TAG_IN_USE);
  });

  it("allows deleting an unused Markierung", async () => {
    const dp = build({
      tags: [{ id: 1, name: "Privatperson", color: "#99c1de" }],
      contacts: [{ id: 1, first_name: "A", last_name: "B", tags: [] } as never],
    });

    await expect(
      dp.delete("tags", { id: 1, previousData: { id: 1 } }),
    ).resolves.toBeTruthy();
    expect(await listTags(dp)).toHaveLength(0);
  });
});

describe("EnsureTag against the FakeRest provider", () => {
  it("converges two concurrent creates of the same name onto one row", async () => {
    const dp = build();

    const [a, b] = await Promise.all([
      ensureTag(dp, { name: "Privatperson", color: "#99c1de" }),
      ensureTag(dp, { name: "privatperson", color: "#eddcd2" }),
    ]);

    expect(await listTags(dp)).toHaveLength(1);
    expect(a.tag.id).toBe(b.tag.id);
  });
});
