import { useCallback } from "react";
import {
  noraCreatePath,
  type NoraCreatePathParams,
} from "@/components/atomic-crm/routing/noraRoutes";

export const useNoraCreatePath = () =>
  useCallback(
    (params: NoraCreatePathParams) => noraCreatePath(params),
    [],
  );
