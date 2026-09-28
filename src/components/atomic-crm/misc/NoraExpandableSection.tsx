import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

type NoraExpandableSectionProps = {
  title: string;
  children: ReactNode;
  /** Quiet summary shown in the head, e.g. "12 Einträge". */
  summary?: ReactNode;
  defaultOpen?: boolean;
  /** Controlled mode. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Keep children mounted while collapsed (default: unmount, so that
   * expensive content only loads on demand). */
  keepMounted?: boolean;
  className?: string;
  /** Accessible name of the toggle when the title alone is ambiguous. */
  toggleLabel?: string;
};

/**
 * A section card whose entire head is one deliberate open/close control.
 *
 * Collapsed by default; the body is not mounted until first opened unless
 * `keepMounted` is set, so a section can defer its data fetching to the
 * moment a user actually asks for it. `aria-expanded` / `aria-controls`
 * describe the relation; the chevron is decoration only.
 */
export const NoraExpandableSection = ({
  title,
  children,
  summary,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  keepMounted = false,
  className,
  toggleLabel,
}: NoraExpandableSectionProps) => {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isControlled = controlledOpen != null;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const headingId = useId();
  const bodyId = useId();

  const toggle = () => {
    const next = !open;
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  return (
    <section
      className={cn("nora-section-card", className)}
      aria-labelledby={headingId}
      data-state={open ? "open" : "closed"}
    >
      <h3 id={headingId} className="nora-section-title mb-0">
        <button
          type="button"
          className="nora-expandable-trigger"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={toggleLabel}
          onClick={toggle}
        >
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="min-w-0">{title}</span>
            {summary ? (
              <span className="nora-t-meta font-normal">{summary}</span>
            ) : null}
          </span>
          <ChevronDown className="nora-expandable-chevron" aria-hidden />
        </button>
      </h3>
      {open || keepMounted ? (
        <div
          id={bodyId}
          className={cn(
            "nora-section-body nora-expandable-body",
            !open && "hidden",
          )}
          hidden={!open}
        >
          {children}
        </div>
      ) : null}
    </section>
  );
};
