import type { Identifier } from "ra-core";

import {
  EMPLOYEE_MAIL_DELIVERY_HEADING,
  formatEmployeeMailDeliveryLine,
} from "./emailDeliveryContract";
import { useEmployeeMailDeliveryStatus } from "./useEmployeeMailDeliveryStatus";

/**
 * Delivery status of the last access mail sent to this employee (V1C-B).
 *
 * Deliberately subordinate to the Nora-Zugang state above it: the access state
 * is what an administrator acts on, delivery is operational detail that
 * explains why an invited employee may not have appeared yet. It is therefore
 * plain muted text, not a second status pill.
 *
 * Three rules this component exists to keep:
 *
 *  1. No history → nothing is rendered. An employee with no delivery events is
 *     not "unknown" or "pending"; Nora simply has nothing to report, and an
 *     empty-state sentence would read as a finding.
 *  2. No claim about a *specific* mail. Correlation is by recipient address
 *     only, so the heading says "Letzte E-Mail-Zustellung" and the mail kind
 *     is never named.
 *  3. No opening, reading or clicking. Nora neither subscribes to nor stores
 *     those events, and no wording here may suggest otherwise.
 */
export function EmployeeMailDeliveryStatus({
  salesId,
}: {
  salesId: Identifier;
}) {
  const { summary } = useEmployeeMailDeliveryStatus(salesId);

  // Covers "still loading", "not permitted", "read failed" and "no history"
  // alike — in every one of them Nora has nothing it can truthfully show.
  if (!summary) return null;

  const line = formatEmployeeMailDeliveryLine(summary);

  return (
    <div
      className="text-sm text-muted-foreground"
      data-testid="employee-mail-delivery"
    >
      <p className="text-xs uppercase tracking-wide">
        {EMPLOYEE_MAIL_DELIVERY_HEADING}
      </p>
      <p className="text-foreground" data-testid="employee-mail-delivery-line">
        {line.text}
      </p>
      {line.action ? <p>{line.action}</p> : null}
    </div>
  );
}
