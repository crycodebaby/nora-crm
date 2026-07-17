import { Eye } from "lucide-react";
import { useTranslate } from "ra-core";

import { cn } from "@/lib/utils";

import { useNoraRole } from "./useNoraRole";

type NoraReadOnlyBannerProps = {
  className?: string;
};

/** Subtle viewer hint — shown once per page layout, not on every card. */
export const NoraReadOnlyBanner = ({ className }: NoraReadOnlyBannerProps) => {
  const translate = useTranslate();
  const { isViewer, isPending } = useNoraRole();

  if (isPending || !isViewer) return null;

  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-2 rounded-md border border-border/80 bg-muted/40 px-3 py-1.5 text-xs sm:text-sm text-muted-foreground",
        className,
      )}
    >
      <Eye className="size-3.5 sm:size-4 shrink-0" aria-hidden />
      <p className="font-medium text-foreground/90 leading-snug">
        {translate("crm.access.read_only_mode")}
        <span className="hidden sm:inline font-normal text-muted-foreground">
          {" — "}
          {translate("crm.access.read_only_hint")}
        </span>
      </p>
    </div>
  );
};
