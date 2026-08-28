import { Plus } from "lucide-react";
import {
  CreateBase,
  Form,
  useDataProvider,
  useGetIdentity,
  useGetRecordRepresentation,
  useNotify,
  useRecordContext,
  useTranslate,
  useUpdate,
  type Identifier,
} from "ra-core";
import { useState } from "react";
import { SaveButton } from "@/components/admin/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { TaskFormContent } from "./TaskFormContent";

export const AddTask = ({
  selectContact,
  display = "chip",
  contactId,
  companyId,
  companyName,
  defaultTaskType,
  defaultTaskText,
}: {
  selectContact?: boolean;
  display?: "chip" | "icon";
  contactId?: Identifier;
  /** Creates a task scoped to this customer. Shows an optional contact
   * picker limited to the customer's own contacts instead of taking the
   * contact from record context (record context here would be the company,
   * not a contact). */
  companyId?: Identifier;
  companyName?: string;
  defaultTaskType?: string;
  defaultTaskText?: string;
}) => {
  const { identity } = useGetIdentity();
  const dataProvider = useDataProvider();
  const [update] = useUpdate();
  const notify = useNotify();
  const translate = useTranslate();
  const contact = useRecordContext();
  // In company-scoped mode, never fall back to ambient record context for a
  // contact id — that context is the company record, not a contact.
  const resolvedContactId =
    companyId != null ? contactId : (contactId ?? contact?.id);
  const [open, setOpen] = useState(false);
  const handleOpen = () => {
    setOpen(true);
  };
  const getContactRepresentation = useGetRecordRepresentation("contacts");

  const handleSuccess = async (data: any) => {
    setOpen(false);

    if (data.contact_id != null) {
      const contact = await dataProvider.getOne("contacts", {
        id: data.contact_id,
      });
      if (contact.data) {
        await update("contacts", {
          id: contact.data.id,
          data: { last_seen: new Date().toISOString() },
          previousData: contact.data,
        });
      }
    }

    notify("resources.tasks.added");
  };

  if (!identity) return null;

  return (
    <>
      {display === "icon" ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="p-2 cursor-pointer"
                onClick={handleOpen}
              >
                <Plus className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {translate("resources.tasks.action.create")}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <div className="my-2">
          <Button
            variant="outline"
            className="h-9 px-3 cursor-pointer text-sm"
            onClick={handleOpen}
            size="sm"
          >
            <Plus className="w-4 h-4" />
            {defaultTaskText ?? translate("resources.tasks.action.add")}
          </Button>
        </div>
      )}

      <CreateBase
        resource="tasks"
        record={{
          type: defaultTaskType ?? "rueckruf",
          text: defaultTaskText ?? "",
          contact_id: resolvedContactId,
          company_id: companyId,
          due_date: new Date().toISOString(),
          sales_id: identity.id,
        }}
        mutationOptions={{ onSuccess: handleSuccess }}
      >
        <Dialog open={open} onOpenChange={() => setOpen(false)}>
          <DialogContent className="lg:max-w-xl overflow-y-auto max-h-9/10 top-1/20 translate-y-0">
            <Form className="flex flex-col gap-4">
              <DialogHeader>
                <DialogTitle>
                  {defaultTaskText
                    ? translate("resources.tasks.dialog.create_type", {
                        type: defaultTaskText,
                      })
                    : companyId != null
                      ? companyName
                        ? translate("resources.tasks.dialog.create_for", {
                            name: companyName,
                          })
                        : translate("resources.tasks.dialog.create")
                      : contact && !selectContact
                        ? translate("resources.tasks.dialog.create_for", {
                            name: getContactRepresentation(contact),
                          })
                        : translate("resources.tasks.dialog.create")}
                </DialogTitle>
              </DialogHeader>
              <TaskFormContent
                selectContact={selectContact && resolvedContactId == null}
                companyId={companyId}
                defaultTaskType={defaultTaskType}
              />
              <DialogFooter className="w-full justify-end">
                <SaveButton />
              </DialogFooter>
            </Form>
          </DialogContent>
        </Dialog>
      </CreateBase>
    </>
  );
};
