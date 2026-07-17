import type { ReactNode } from "react";
import { useTranslate } from "ra-core";

import { cn } from "@/lib/utils";

type NoraEmptyStateProps = {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  imageSrc?: string;
};

export const NoraEmptyState = ({
  title,
  description,
  action,
  className,
  imageSrc = "./img/empty.svg",
}: NoraEmptyStateProps) => {
  const translate = useTranslate();

  return (
    <div
      className={cn(
        "flex flex-col justify-center items-center gap-3 py-8 text-center",
        className,
      )}
    >
      <img src={imageSrc} alt="" className="max-w-[10rem] opacity-90" />
      <div className="flex flex-col gap-1 items-center max-w-md">
        <h6 className="text-lg font-semibold">{title}</h6>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex flex-wrap gap-2 justify-center">{action}</div> : null}
      <span className="sr-only">{translate("crm.common.empty_state")}</span>
    </div>
  );
};
