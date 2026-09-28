import { useEffect, useState } from "react";
import {
  EditBase,
  Form,
  useNotify,
  useRecordContext,
  useRedirect,
  useTranslate,
} from "ra-core";
import { useFormContext, useFormState } from "react-hook-form";
import { Link } from "react-router";
import { isNoraRecordId, noraCreatePath } from "../routing/noraRoutes";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogTitle } from "@/components/ui/dialog";

import { FormToolbar } from "../layout/FormToolbar";
import type { Deal } from "../types";
import { BusinessNumber } from "../misc/BusinessNumber";
import { NoraAccessGuard } from "../misc/NoraEditGuard";
import { NoraDeleteButton } from "../misc/NoraAccessActions";
import { NoraDialogContent } from "../misc/NoraDialogContent";
import { OPERATION_CATALOG } from "../operations/operationCatalog";
import { DealInputs } from "./DealInputs";

export const DealEdit = ({ open, id }: { open: boolean; id?: string }) => {
  const redirect = useRedirect();
  const notify = useNotify();
  const canLoad = open && isNoraRecordId(id);

  const handleClose = () => {
    redirect(
      noraCreatePath({ resource: "deals", type: "list" }),
      undefined,
      undefined,
      undefined,
      { _scrollToTop: false },
    );
  };

  return (
    <Dialog open={open && canLoad}>
      {canLoad ? (
        <EditBase
          id={id}
          mutationMode="pessimistic"
          mutationOptions={{
            onSuccess: () => {
              // Existing notify restored; copy from Operation Catalog (no Feedback UI yet).
              notify(OPERATION_CATALOG["deal.update"].successMessage, {
                type: "info",
              });
              redirect(
                noraCreatePath({
                  resource: "deals",
                  type: "show",
                  id,
                }),
                undefined,
                undefined,
                undefined,
                { _scrollToTop: false },
              );
            },
          }}
        >
          <DealEditDialog onClose={handleClose} />
        </EditBase>
      ) : null}
    </Dialog>
  );
};

const DealEditDialog = ({ onClose }: { onClose: () => void }) => {
  return (
    <NoraAccessGuard resource="deals" action="edit">
      <DealEditDialogBody onClose={onClose} />
    </NoraAccessGuard>
  );
};

/**
 * Stabilization Gate 2: Form must live INSIDE the Radix Dialog portal.
 * Previously Form wrapped NoraDialogContent with className="contents", so the
 * visible SaveButton (type=submit) had no HTML form owner and native submit
 * never ran — while RHF still tracked isDirty across the portal.
 */
const DealEditDialogBody = ({ onClose }: { onClose: () => void }) => {
  const translate = useTranslate();
  const [isDirty, setIsDirty] = useState(false);

  return (
    <NoraDialogContent
      open
      isDirty={isDirty}
      onRequestClose={onClose}
      className="nora-deal-form-dialog sm:max-w-3xl p-0 overflow-y-auto max-h-9/10 top-1/20 translate-y-0"
    >
      <DialogTitle className="sr-only">
        {translate("resources.deals.action.edit", {
          _: "Vorgang bearbeiten",
        })}
      </DialogTitle>
      <DialogDescription className="sr-only">
        {translate("resources.deals.edit_dialog.description", {
          _: "Vorgangsdaten bearbeiten und speichern.",
        })}
      </DialogDescription>
      <Form className="flex flex-col">
        <FormDirtyBridge onDirtyChange={setIsDirty} />
        <EditHeader />
        <div className="nora-deal-form-body">
          <DealInputs />
        </div>
        <FormToolbar className="nora-deal-form-toolbar" />
      </Form>
    </NoraDialogContent>
  );
};

/** Syncs RHF dirty state to NoraDialogContent (outside Form context). */
const FormDirtyBridge = ({
  onDirtyChange,
}: {
  onDirtyChange: (isDirty: boolean) => void;
}) => {
  const { isDirty, errors, isValid } = useFormState();
  const { getValues } = useFormContext();
  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);
  useEffect(() => {
    if (import.meta.env.MODE === "test") {
      (
        window as unknown as {
          __noraDealEditForm?: () => unknown;
        }
      ).__noraDealEditForm = () => ({
        values: getValues(),
        errors,
        isValid,
        isDirty,
      });
    }
  });
  return null;
};

function EditHeader() {
  const translate = useTranslate();
  const deal = useRecordContext<Deal>();
  if (!deal) {
    return null;
  }

  return (
    <header className="nora-deal-form-head">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <BusinessNumber
              value={deal.case_number}
              kind="case"
              size="sm"
              variant="badge"
            />
            <span className="nora-t-eyebrow">
              {translate("resources.deals.action.edit", {
                _: "Vorgang bearbeiten",
              })}
            </span>
          </div>
          <h2 className="nora-t-title min-w-0 truncate">{deal.name}</h2>
        </div>
        <div className="flex gap-2 pr-10 shrink-0">
          <NoraDeleteButton resource="deals" />
          <Button asChild variant="outline" className="h-9">
            <Link
              to={noraCreatePath({
                resource: "deals",
                type: "show",
                id: deal.id,
              })}
            >
              {translate("resources.deals.action.back_to_deal")}
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
