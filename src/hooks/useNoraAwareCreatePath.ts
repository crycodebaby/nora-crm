import { useCreatePath, type CreatePathParams } from "ra-core";
import { useCallback } from "react";
import {
  isNoraRoutableResource,
  noraCreatePath,
  type NoraPathType,
} from "@/components/atomic-crm/routing/noraRoutes";

/** Routes Nora resources through German URL paths; other resources use react-admin defaults. */
export const useNoraAwareCreatePath = () => {
  const createPath = useCreatePath();
  return useCallback(
    (params: CreatePathParams) => {
      const { resource } = params;
      if (resource && isNoraRoutableResource(resource)) {
        return noraCreatePath({
          resource,
          type: params.type as NoraPathType,
          id: params.id,
        });
      }
      return createPath(params);
    },
    [createPath],
  );
};
