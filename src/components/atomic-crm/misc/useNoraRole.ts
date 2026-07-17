import { useGetIdentity } from "ra-core";

import { type NoraRole, resolveNoraRole } from "../providers/commons/canAccess";

export type NoraIdentity = {
  id?: string | number;
  fullName?: string;
  avatar?: string;
  role?: NoraRole;
};

export const useNoraRole = () => {
  const { data: identity, isPending } = useGetIdentity();

  const noraIdentity = identity as NoraIdentity | undefined;
  const role: NoraRole = noraIdentity?.role
    ? resolveNoraRole({ role: noraIdentity.role })
    : "viewer";

  return {
    role,
    isPending,
    isViewer: role === "viewer",
    isOffice: role === "office",
    isAdmin: role === "admin",
    canWrite: role === "admin" || role === "office",
    canDelete: role === "admin",
  };
};
