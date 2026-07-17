import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type NoraPageLoadingProps = {
  variant?: "list" | "cards" | "kanban" | "inline";
  className?: string;
  rows?: number;
};

export const NoraPageLoading = ({
  variant = "list",
  className,
  rows = 4,
}: NoraPageLoadingProps) => {
  if (variant === "inline") {
    return (
      <div className={cn("flex items-center gap-2 py-2", className)} aria-busy>
        <Skeleton className="h-4 w-4 rounded-full" />
        <Skeleton className="h-4 w-32" />
      </div>
    );
  }

  if (variant === "kanban") {
    return (
      <div
        className={cn("flex gap-4 overflow-hidden min-h-[18rem]", className)}
        aria-busy
      >
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="flex flex-col gap-2 w-64 shrink-0">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        ))}
      </div>
    );
  }

  if (variant === "cards") {
    return (
      <div
        className={cn(
          "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4",
          className,
        )}
        aria-busy
      >
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className="h-28 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)} aria-busy>
      <Skeleton className="h-8 w-48" />
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-14 w-full rounded-md" />
      ))}
    </div>
  );
};
