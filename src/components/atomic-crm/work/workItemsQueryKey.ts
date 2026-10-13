import type { Identifier } from "ra-core";

import type { WorkScope } from "../application/queries/getWorkItems";

/** Page size of every Arbeitskorb request (docs/nora/26 §5.1). */
export const WORK_ITEMS_PAGE_SIZE = 50;

/**
 * The cache prefix of everything the Arbeitskorb caches for one signed-in
 * employee. The identity only partitions the cache — it is never handed to
 * `getWorkItems`; the actor is the server session (docs/nora/25 §10.1).
 */
export const workItemsIdentityPrefix = (identityPartition: Identifier) =>
  ["work", "items", identityPartition] as const;

/** `["work", "items", <identity>, <scope>, "open", 50]` (docs/nora/26 §5.2). */
export const workItemsQueryKey = (
  identityPartition: Identifier,
  scope: WorkScope,
) =>
  [
    ...workItemsIdentityPrefix(identityPartition),
    scope,
    "open",
    WORK_ITEMS_PAGE_SIZE,
  ] as const;
