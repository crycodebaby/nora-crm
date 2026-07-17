import { Navigate } from "ra-core";
import { useParams } from "react-router";

import { NORA_RESOURCE_PATHS, type NoraRoutableResource } from "./noraRoutes";

export const LegacyPathRedirect = ({
  from,
}: {
  from: NoraRoutableResource;
}) => {
  const params = useParams();
  const splat = params["*"];
  const target = splat
    ? `/${NORA_RESOURCE_PATHS[from]}/${splat}`
    : `/${NORA_RESOURCE_PATHS[from]}`;

  return <Navigate to={target} replace />;
};
