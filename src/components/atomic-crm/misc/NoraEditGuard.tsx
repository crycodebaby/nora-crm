import { useEffect } from "react";
import { useCanAccess, useRedirect, useRecordContext } from "ra-core";

import { getAccessRedirectTarget } from "./noraAccessGuardUtils";

type NoraAccessGuardProps = {
  resource: string;
  action?: string;
  /** Where to send users without access when a record exists. */
  redirectTarget?: "show" | "list";
  /** Fixed path redirect (e.g. `/` for settings/import). */
  fallbackPath?: string;
  children: React.ReactNode;
};

/**
 * Redirects users without write access away from edit/create surfaces.
 * Viewers are sent to the read-only show view (or list if no record id).
 */
export const NoraAccessGuard = ({
  resource,
  action = "edit",
  redirectTarget = "show",
  fallbackPath,
  children,
}: NoraAccessGuardProps) => {
  const record = useRecordContext();
  const redirect = useRedirect();
  const { canAccess, isPending } = useCanAccess({ resource, action });

  useEffect(() => {
    const target = getAccessRedirectTarget({
      canAccess: !!canAccess,
      isPending,
      recordId: record?.id,
      resource,
      redirectTarget,
      fallbackPath,
    });

    if (target.type === "none") return;

    if (target.type === "fallback") {
      redirect(target.path);
      return;
    }

    if (target.action === "list") {
      redirect("list", target.resource);
      return;
    }

    redirect("show", target.resource, target.id);
  }, [
    canAccess,
    fallbackPath,
    isPending,
    record?.id,
    redirect,
    redirectTarget,
    resource,
  ]);

  if (isPending || !canAccess) return null;

  return <>{children}</>;
};

/** @deprecated Use NoraAccessGuard */
export const NoraEditGuard = NoraAccessGuard;
