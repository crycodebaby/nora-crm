/**
 * Mobile read-only sheet of one Arbeitskorb row (docs/nora/26 §9).
 *
 * It shows only the already loaded Work row plus optional display names —
 * no Work detail query, no task route, no editor, no Work action. It is bound
 * to a `workId` and always shows that row of the CURRENT snapshot; only when
 * the row is gone after a revalidation it shows the last seen state with a
 * notice. Its customer action never promises tasks: the mobile customer
 * record shows none.
 */
import { useTranslate } from "ra-core";
import { useRef } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { WorkContextNames } from "./useWorkContextNames";
import { IncompleteMark } from "./WorkRowParts";
import {
  contactPath,
  contextLabel,
  customerPath,
  holderText,
  spokenDue,
} from "./workRowText";
import type { WorkRowView } from "./workRowView";

export const WorkSheet = ({
  row: requestedRow,
  keepOnClose,
  vanished,
  names,
  onClose,
  onCloseAutoFocus,
}: {
  /** The row to show, or `null` when the sheet is closed. */
  row: WorkRowView | null;
  /**
   * Keep the last row rendered while the sheet animates out. `false` after a
   * refusal: then nothing of the old snapshot may stay visible (§5.4).
   */
  keepOnClose: boolean;
  /** The row is no longer in the current snapshot. */
  vanished: boolean;
  names: WorkContextNames;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) => {
  const translate = useTranslate();
  const lastRow = useRef<WorkRowView | null>(null);
  if (requestedRow) lastRow.current = requestedRow;
  else if (!keepOnClose) lastRow.current = null;
  const row = requestedRow ?? lastRow.current;
  return (
    <Sheet
      open={requestedRow !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {row ? (
        <SheetContent
          side="bottom"
          showClose={false}
          data-arbeitskorb-sheet=""
          onCloseAutoFocus={onCloseAutoFocus}
          className="max-h-[85svh] gap-0 overflow-y-auto rounded-t-xl pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <SheetHeader className="gap-1 pb-2">
            <SheetTitle className="text-lg leading-snug">
              {row.incomplete || row.title === null ? (
                <span className="inline-flex flex-wrap items-center gap-x-2">
                  <span className="italic text-[var(--nora-text-muted)]">
                    {translate("crm.work.title_missing")}
                  </span>
                  <IncompleteMark />
                </span>
              ) : (
                row.title
              )}
            </SheetTitle>
            <SheetDescription>{spokenDue(translate, row)}</SheetDescription>
          </SheetHeader>

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-4 text-sm">
            {row.workType !== null ? (
              <>
                <dt className="text-[var(--nora-text-muted)]">
                  {translate("crm.work.sheet.type")}
                </dt>
                <dd>{row.workType}</dd>
              </>
            ) : null}
            <dt className="text-[var(--nora-text-muted)]">
              {translate("crm.work.sheet.due")}
            </dt>
            <dd>{spokenDue(translate, row)}</dd>
            {row.holder ? (
              <>
                <dt className="text-[var(--nora-text-muted)]">
                  {translate("crm.work.holder.prefix")}
                </dt>
                <dd>{holderText(translate, row.holder)}</dd>
              </>
            ) : null}
          </dl>

          {vanished ? (
            <p className="mx-4 mt-3 rounded-md border border-border px-3 py-2 text-sm">
              {translate("crm.work.sheet.vanished")}
            </p>
          ) : null}

          <div className="flex flex-col gap-2 p-4">
            {row.contactId != null ? (
              <SheetAction
                to={contactPath(row.contactId)}
                action={translate("crm.work.sheet.open_contact")}
                name={
                  contextLabel(
                    translate,
                    "contact",
                    names.contactName(row.contactId),
                  ).visible
                }
                onNavigate={onClose}
              />
            ) : null}
            {row.customerId != null ? (
              <SheetAction
                to={customerPath(row.customerId)}
                action={translate("crm.work.sheet.open_customer")}
                name={
                  contextLabel(
                    translate,
                    "customer",
                    names.customerName(row.customerId),
                  ).visible
                }
                onNavigate={onClose}
                secondary={row.contactId != null}
              />
            ) : null}
            {row.contactId == null ? (
              <p className="text-sm text-[var(--nora-text-muted)]">
                {translate("crm.work.sheet.no_contact_hint")}
              </p>
            ) : null}
            <SheetClose asChild>
              <Button type="button" variant="outline" className="mt-1 min-h-12">
                {translate("crm.work.sheet.close")}
              </Button>
            </SheetClose>
          </div>
        </SheetContent>
      ) : null}
    </Sheet>
  );
};

const SheetAction = ({
  to,
  action,
  name,
  onNavigate,
  secondary = false,
}: {
  to: string;
  action: string;
  name: string;
  onNavigate: () => void;
  secondary?: boolean;
}) => (
  <Button
    asChild
    variant={secondary ? "outline" : "default"}
    className="h-auto min-h-12 flex-col items-start gap-0 py-2 text-left"
  >
    <Link to={to} onClick={onNavigate}>
      <span className="font-semibold">{action}</span>
      <span className="text-sm font-normal opacity-90">{name}</span>
    </Link>
  </Button>
);
