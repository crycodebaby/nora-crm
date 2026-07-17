import { AlertCircle, RefreshCw } from "lucide-react";
import { useTranslate } from "ra-core";
import { useCallback } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { normalizeCrmError } from "./normalizeCrmError";

type NoraQueryErrorProps = {
  error: unknown;
  onRetry?: () => void | Promise<unknown>;
  className?: string;
};

export const NoraQueryError = ({
  error,
  onRetry,
  className,
}: NoraQueryErrorProps) => {
  const translate = useTranslate();
  const normalized = normalizeCrmError(error);

  const handleRetry = useCallback(async () => {
    if (!onRetry) return;
    await onRetry();
  }, [onRetry]);

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-6 text-center",
        className,
      )}
    >
      <AlertCircle className="size-8 text-destructive/80" aria-hidden />
      <div className="space-y-1 max-w-md">
        <p className="font-medium">{translate(normalized.messageKey)}</p>
        {normalized.kind === "network" ||
        normalized.kind === "service_unavailable" ? (
          <p className="text-sm text-muted-foreground">
            {translate("crm.errors.retry_hint")}
          </p>
        ) : null}
      </div>
      {onRetry ? (
        <Button
          type="button"
          variant="outline"
          className="gap-2"
          onClick={handleRetry}
        >
          <RefreshCw className="size-4" />
          {translate("crm.errors.retry")}
        </Button>
      ) : null}
    </div>
  );
};
