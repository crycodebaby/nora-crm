import type { ComponentType, SVGProps } from "react";
import {
  CircleCheckIcon,
  CircleHelpIcon,
  CircleIcon,
  CircleMinusIcon,
} from "lucide-react";

import {
  EMPLOYEE_ACCESS_STATE_HINT,
  EMPLOYEE_ACCESS_STATE_LABEL,
  type EmployeeAccessState,
} from "./employeeAccessContract";

const STATE_GLYPH: Record<
  EmployeeAccessState,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  invited: CircleIcon,
  active: CircleCheckIcon,
  disabled: CircleMinusIcon,
  unknown: CircleHelpIcon,
};

/**
 * Nora-Zugang status pill (V1B). Glyph + word + restrained colour, never
 * colour alone: an administrator reads the state in one glance, a screen
 * reader hears the same word. Labels come from the V1A contract unchanged.
 */
export const EmployeeAccessStatus = ({
  state,
  showHint = false,
  className,
  ...rest
}: {
  state: EmployeeAccessState;
  showHint?: boolean;
  className?: string;
  "data-testid"?: string;
}) => {
  const Glyph = STATE_GLYPH[state];
  const hint = showHint ? EMPLOYEE_ACCESS_STATE_HINT[state] : undefined;

  return (
    <span className={className}>
      <span className="nora-access-pill" data-state={state} {...rest}>
        <Glyph aria-hidden="true" />
        <span>{EMPLOYEE_ACCESS_STATE_LABEL[state]}</span>
      </span>
      {hint ? <span className="nora-access-pill-hint">{hint}</span> : null}
    </span>
  );
};
