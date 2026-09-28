import type { ReactNode } from "react";
import { Link } from "react-router";

import { cn } from "@/lib/utils";

type NoraIdentityRowProps = {
  name: ReactNode;
  /** Navigates on the name; the name stays the single link target. */
  to?: string;
  /** One quiet context line: job title, customer, address. */
  context?: ReactNode;
  /** A deliberately labelled role in this relation (e.g. "Auftraggeber").
   * Rendered only when passed — never inferred. */
  role?: ReactNode;
  /** Avatar, logo or icon. */
  visual?: ReactNode;
  trailing?: ReactNode;
  size?: "sm" | "md";
  className?: string;
};

/**
 * Compact identity presentation for a customer, contact or employee.
 *
 * Stable anatomy: visual → name (link) → context line; an optional role
 * label sits beside the name so a future, persisted relation role can be
 * shown without changing the component's shape.
 */
export const NoraIdentityRow = ({
  name,
  to,
  context,
  role,
  visual,
  trailing,
  size = "md",
  className,
}: NoraIdentityRowProps) => (
  <div className={cn("nora-identity-row", className)} data-size={size}>
    {visual ? <div className="nora-identity-visual">{visual}</div> : null}
    <div className="nora-identity-body">
      <div className="flex min-w-0 items-center gap-2">
        {to ? (
          <Link to={to} className="nora-identity-name">
            {name}
          </Link>
        ) : (
          <span className="nora-identity-name">{name}</span>
        )}
        {role ? (
          <span className="nora-status-pill" data-tone="accent">
            {role}
          </span>
        ) : null}
      </div>
      {context ? (
        <span className="nora-identity-context">{context}</span>
      ) : null}
    </div>
    {trailing ? <div className="ml-auto shrink-0">{trailing}</div> : null}
  </div>
);
