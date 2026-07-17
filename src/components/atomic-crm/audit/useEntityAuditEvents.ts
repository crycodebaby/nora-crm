import { useInfiniteQuery } from "@tanstack/react-query";
import { useDataProvider } from "ra-core";

import type { CrmDataProvider } from "../providers/types";
import type {
  EntityAuditEntityType,
  GetEntityAuditEventsResult,
} from "./auditTypes";

const DEFAULT_LIMIT = 20;

export const useEntityAuditEvents = (
  entityType: EntityAuditEntityType,
  entityId: number,
  options?: { limit?: number; enabled?: boolean },
) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const enabled = options?.enabled !== false && Number.isFinite(entityId);

  return useInfiniteQuery<GetEntityAuditEventsResult>({
    queryKey: ["entityAuditEvents", entityType, entityId, limit],
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      dataProvider.getEntityAuditEvents({
        entityType,
        entityId,
        limit,
        before: pageParam as string | undefined,
      }),
    getNextPageParam: (lastPage) => {
      if (lastPage.data.length < lastPage.limit) {
        return undefined;
      }
      const lastEvent = lastPage.data[lastPage.data.length - 1];
      return lastEvent?.created_at;
    },
  });
};
