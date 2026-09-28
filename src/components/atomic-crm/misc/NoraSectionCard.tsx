import { useId, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type NoraSectionCardProps = {
  title: string;
  children: ReactNode;
  className?: string;
  /** One quiet line under the title — what this section is for. */
  description?: ReactNode;
  /** Right-aligned controls that belong to the whole section. */
  actions?: ReactNode;
  /** A reliable count shown next to the title (never a guess). */
  count?: number | null;
  /** Tighter padding for sections that hold rows rather than prose. */
  dense?: boolean;
  /** Extra padding-less content, e.g. a list that draws its own rows. */
  bodyClassName?: string;
};

/**
 * A titled information section on an entity surface.
 *
 * The head row carries title, optional count and optional actions so that
 * repeated information sits at a predictable position; the body stays a
 * neutral container. `aria-labelledby` ties the region to its heading.
 */
export const NoraSectionCard = ({
  title,
  children,
  className,
  description,
  actions,
  count,
  dense,
  bodyClassName,
}: NoraSectionCardProps) => {
  const headingId = useId();
  const hasCount = typeof count === "number" && Number.isFinite(count);

  return (
    <section
      className={cn("nora-section-card", className)}
      aria-labelledby={headingId}
      data-dense={dense ? "true" : undefined}
    >
      <div className="nora-section-head">
        <div className="nora-section-head-text">
          <h3
            id={headingId}
            className="nora-section-title mb-0 flex items-center gap-2"
          >
            <span className="min-w-0">{title}</span>
            {hasCount ? (
              <span className="nora-section-count" aria-hidden>
                {count}
              </span>
            ) : null}
          </h3>
          {description ? <p className="nora-t-helper">{description}</p> : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
      <div className={cn("nora-section-body", bodyClassName)}>{children}</div>
    </section>
  );
};
