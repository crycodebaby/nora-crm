import {
  EditBase,
  Form,
  useEditContext,
  useRecordContext,
  useRedirect,
  useTranslate,
} from "ra-core";
import { Link } from "react-router";
import { noraCreatePath } from "../routing/noraRoutes";
import { ReferenceField } from "@/components/admin/reference-field";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

import { FormToolbar } from "../layout/FormToolbar";
import { CompanyAvatar } from "../companies/CompanyAvatar";
import type { Deal } from "../types";
import { BusinessNumber } from "../misc/BusinessNumber";
import { NoraAccessGuard } from "../misc/NoraEditGuard";
import { NoraDeleteButton } from "../misc/NoraAccessActions";
import { NoraDialogContent } from "../misc/NoraDialogContent";
import { useNoraDirtyDialog } from "../misc/useNoraDirtyDialog";
import { DealInputs } from "./DealInputs";

export const DealEdit = ({ open, id }: { open: boolean; id?: string }) => {
  const redirect = useRedirect();

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
    <Dialog open={open}>
      {id ? (
        <EditBase
          id={id}
          mutationMode="pessimistic"
          mutationOptions={{
            onSuccess: () => {
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
      <Form className="contents">
        <DealEditDialogBody onClose={onClose} />
      </Form>
    </NoraAccessGuard>
  );
};

const DealEditDialogBody = ({ onClose }: { onClose: () => void }) => {
  const { requestClose, dirtyConfirmDialog } = useNoraDirtyDialog({ onClose });

  return (
    <>
      <NoraDialogContent
        open
        onRequestClose={requestClose}
        className="lg:max-w-4xl p-4 overflow-y-auto max-h-9/10 top-1/20 translate-y-0"
      >
        <EditHeader />
        <DealInputs />
        <FormToolbar />
      </NoraDialogContent>
      {dirtyConfirmDialog}
    </>
  );
};

function EditHeader() {
  const translate = useTranslate();
  const { defaultTitle } = useEditContext<Deal>();
  const deal = useRecordContext<Deal>();
  if (!deal) {
    return null;
  }

  return (
    <div className="pb-0 mb-8">
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-4 min-w-0">
          <ReferenceField source="company_id" reference="companies" link="show">
            <CompanyAvatar />
          </ReferenceField>
          <h2 className="text-2xl font-semibold truncate">{defaultTitle}</h2>
          <BusinessNumber value={deal.case_number} />
        </div>
        <div className="flex gap-2 pr-12 shrink-0">
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
    </div>
  );
}
