/**
 * Application Command: EnsureTag (Markierungen Identity Wave, 2026-09-07).
 *
 * The single authoritative way to turn "the user typed this Markierung name"
 * into "this tags row exists". Every creation flow — single contact, bulk
 * tagging, CSV import — goes through here, so all of them share one
 * definition of when two names are the same thing and one recovery path when
 * somebody else won the race.
 *
 * Contract
 * --------
 * - The canonical identity of a name is `lower(trim(name))`, mirroring
 *   nora_private.tag_name_key() in the database.
 * - The DATABASE is authoritative, never this file: uq__tags__normalized_name
 *   is what actually guarantees uniqueness. The lookup below is a courtesy
 *   that avoids a pointless failing INSERT and makes the common path one
 *   round trip cheaper — it is explicitly allowed to be wrong under
 *   concurrency, because the 23505 recovery path re-resolves the winner.
 *   That is also why a client/server disagreement about Unicode lowercasing
 *   can never produce a duplicate row: it can only cost one extra round trip.
 * - `created` tells the caller which sentence to show the user. It is the
 *   only reason this command reports anything beyond the tag itself.
 */
import type { Identifier } from "ra-core";

import type { Tag } from "../../types";
import type { CrmDataProvider } from "../../providers/types";
import { NORA_ERROR_CODES, throwNoraError } from "../../domain/noraErrorCodes";
import { normalizeCrmError } from "../../misc/normalizeCrmError";

/** Matches nora_private.tag_name_key(): surrounding whitespace and case are insignificant, nothing else is. */
export const normalizeTagName = (name: string): string =>
  name.trim().toLowerCase();

/** The name as it gets stored and displayed — trimmed, but the user's casing is theirs to keep. */
export const toDisplayTagName = (name: string): string => name.trim();

/**
 * Tags are a small, human-curated vocabulary (Production holds a handful), so
 * resolving a name client-side over the full list is both correct and cheaper
 * than a per-name filtered request — and it avoids escaping user text into a
 * PostgREST filter.
 */
const TAG_LOOKUP_PAGE_SIZE = 1000;

export type EnsureTagInput = {
  name: string;
  color: string;
};

export type EnsureTagResult = {
  tag: Tag;
  /** false when an existing Markierung with the same canonical name was reused. */
  created: boolean;
};

export const findTagByName = async (
  dataProvider: CrmDataProvider,
  name: string,
): Promise<Tag | null> => {
  const key = normalizeTagName(name);
  if (key === "") return null;

  const { data } = await dataProvider.getList<Tag>("tags", {
    filter: {},
    pagination: { page: 1, perPage: TAG_LOOKUP_PAGE_SIZE },
    sort: { field: "name", order: "ASC" },
  });

  return data.find((tag) => normalizeTagName(tag.name) === key) ?? null;
};

export const ensureTag = async (
  dataProvider: CrmDataProvider,
  input: EnsureTagInput,
): Promise<EnsureTagResult> => {
  const name = toDisplayTagName(input.name);
  if (name === "") {
    throwNoraError(
      "Der Name der Markierung darf nicht leer sein.",
      NORA_ERROR_CODES.TAG_NAME_REQUIRED,
    );
  }

  const existing = await findTagByName(dataProvider, name);
  if (existing) {
    return { tag: existing, created: false };
  }

  try {
    const { data } = await dataProvider.create<Tag>("tags", {
      data: { name, color: input.color },
    });
    return { tag: data, created: true };
  } catch (error) {
    // Somebody committed the same logical name between the lookup and this
    // INSERT — a second tab, a bulk action, a retried request. The unique
    // index did its job; converge on the winner instead of showing the office
    // user a constraint violation they can do nothing about.
    if (normalizeCrmError(error).code === NORA_ERROR_CODES.TAG_ALREADY_EXISTS) {
      const winner = await findTagByName(dataProvider, name);
      if (winner) {
        return { tag: winner, created: false };
      }
    }
    throw error;
  }
};

/**
 * Attaching a Markierung to a record that carries a tag id array.
 *
 * This is the fix for the Production incident at its source: contacts.tags was
 * nullable, and the old create flow spread it unguarded
 * (`[...record.tags, id]`), which threw on any contact that had never been
 * tagged — after the tags row had already been written. Null-safety and
 * de-duplication belong together in one place that every caller uses.
 */
export const withTag = <T extends Identifier>(
  tags: T[] | null | undefined,
  id: T,
): T[] => {
  const current = tags ?? [];
  return current.includes(id) ? [...current] : [...current, id];
};

/** Removing a Markierung from a record, equally null-safe. */
export const withoutTag = <T extends Identifier>(
  tags: T[] | null | undefined,
  id: T,
): T[] => (tags ?? []).filter((tagId) => tagId !== id);

/** True when this record already carries the Markierung. */
export const hasTag = <T extends Identifier>(
  tags: T[] | null | undefined,
  id: T,
): boolean => (tags ?? []).includes(id);
