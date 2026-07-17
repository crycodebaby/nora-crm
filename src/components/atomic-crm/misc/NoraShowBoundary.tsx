import type { ReactNode } from "react";
import { useShowContext, useTranslate } from "ra-core";

import { NoraPageLoading } from "./NoraPageLoading";
import { NoraQueryError } from "./NoraQueryError";

type NoraShowBoundaryProps = {
  children: ReactNode;
};

/** Unified loading and error states for ShowBase detail views. */
export const NoraShowBoundary = ({ children }: NoraShowBoundaryProps) => {
  const { isPending, error, refetch } = useShowContext();

  if (isPending) {
    return <NoraPageLoading variant="inline" className="py-12" />;
  }

  if (error) {
    return (
      <NoraQueryError
        error={error}
        onRetry={() => refetch?.()}
        className="my-8"
      />
    );
  }

  return <>{children}</>;
};

/** Read-only placeholder when no show view exists for a resource. */
export const NoraReadOnlyFallback = () => {
  const translate = useTranslate();
  return (
    <p className="text-sm text-muted-foreground py-8 text-center" role="status">
      {translate("crm.access.read_only_hint")}
    </p>
  );
};
