import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type NoraFormGroupProps = {
  title: string;
  /** One line that says what belongs in this group. */
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
};

/**
 * A semantically grouped block of form fields with its own heading.
 *
 * A real `fieldset`/`legend` pair: the legend names the group for assistive
 * technology without turning the group into a labelled *control* (an
 * `aria-labelledby` group would collide with a field of the same name).
 * Groups are separated by a hairline, not by whitespace alone, so the eye
 * finds "Auftraggeber" or "Einsatzort" before reading any label.
 */
export const NoraFormGroup = ({
  title,
  hint,
  children,
  className,
}: NoraFormGroupProps) => (
  <fieldset className={cn("nora-form-group", className)}>
    <legend className="nora-form-group-legend nora-t-section">{title}</legend>
    {hint ? <p className="nora-t-helper nora-form-group-hint">{hint}</p> : null}
    {children}
  </fieldset>
);

type NoraFormRowProps = {
  /** How the fields share the row from `sm` upwards. */
  cols?: "1" | "2" | "3" | "wide-narrow";
  children: ReactNode;
  className?: string;
};

/** Fields that may share one row on wider screens. */
export const NoraFormRow = ({
  cols = "2",
  children,
  className,
}: NoraFormRowProps) => (
  <div className={cn("nora-form-row", className)} data-cols={cols}>
    {children}
  </div>
);
