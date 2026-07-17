import type { ReactNode } from "react";
import { useListContext } from "ra-core";

import { NoraPageLoading } from "./NoraPageLoading";
import { NoraQueryError } from "./NoraQueryError";

type NoraListBoundaryProps = {
  children: ReactNode;
};

/** Unified loading and error states for List pages. */
export const NoraListBoundary = ({ children }: NoraListBoundaryProps) => {
  const { isPending, error, refetch } = useListContext();

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
