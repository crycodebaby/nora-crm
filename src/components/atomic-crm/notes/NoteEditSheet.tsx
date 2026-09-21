import { EllipsisVertical, Trash2 } from "lucide-react";
import {
  type Identifier,
  useCreatePath,
  useDeleteController,
  useGetRecordRepresentation,
  useRecordContext,
  useTranslate,
} from "ra-core";
import { ReferenceField } from "@/components/admin";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { EditSheet } from "../misc/EditSheet";
import { foreignKeyMapping } from "./foreignKeyMapping";
import { NoteAttachmentsRecovery } from "./NoteAttachmentsRecovery";
import { NoteInputsMobile } from "./NoteInputsMobile";
import { recoveryAttachments } from "../providers/commons/noteAttachmentReadModel";
import type { ContactNote } from "../types";

export interface NoteEditSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noteId: Identifier;
}

export const NoteEditSheet = ({
  open,
  onOpenChange,
  noteId,
}: NoteEditSheetProps) => {
  const createPath = useCreatePath();
  const translate = useTranslate();
  const getRedirectTo = (record: any) => {
    return createPath({
      resource: "contacts",
      type: "show",
      id: record ? record[foreignKeyMapping["contacts"]] : undefined,
    });
  };
  const getContactRepresentation = useGetRecordRepresentation("contacts");

  return (
    <EditSheet
      resource="contact_notes"
      id={noteId}
      // W8-C S5: an attachment-changing note write must be refused before it
      // is optimistically shown as done — the shared undoable default of
      // EditSheet stays untouched for every other resource.
      mutationMode="pessimistic"
      title={
        <ReferenceField
          source={foreignKeyMapping["contacts"]}
          reference="contacts"
          render={({ referenceRecord }) => (
            <span className="text-xl font-semibold truncate">
              {referenceRecord
                ? translate("resources.notes.sheet.edit_for", {
                    name: getContactRepresentation(referenceRecord),
                  })
                : translate("resources.notes.sheet.edit")}
            </span>
          )}
        />
      }
      redirect={(_resource, _id, record) => getRedirectTo(record)}
      open={open}
      onOpenChange={onOpenChange}
      headerActions={
        <NoteEditMenuButton
          onOpenChange={onOpenChange}
          getRedirectTo={getRedirectTo}
        />
      }
    >
      <NoteEditAttachmentsGate />
    </EditSheet>
  );
};

/**
 * W8-C S5. `NoteInputsMobile` is shared verbatim by the create sheet and this
 * edit sheet, so the host has to say which one it is. An existing note is
 * editable only when `public.attachments` vouched for it; a record that is
 * still loading is `undefined` here and therefore fail-closed — create is
 * never inferred from an absent record.
 */
const NoteEditAttachmentsGate = () => {
  const record = useRecordContext<ContactNote>();
  const attachmentsEditable = record?.attachments_state === "ok";

  return (
    <>
      <NoteInputsMobile attachmentsEditable={attachmentsEditable} />
      {!attachmentsEditable && (
        <NoteAttachmentsRecovery attachments={recoveryAttachments(record)} />
      )}
    </>
  );
};

const NoteEditMenuButton = ({
  onOpenChange,
  getRedirectTo,
}: {
  onOpenChange: (open: boolean) => void;
  getRedirectTo: (record: any) => string;
}) => {
  const translate = useTranslate();
  const record = useRecordContext();
  const { handleDelete } = useDeleteController({
    record,
    resource: "contact_notes",
    redirect: getRedirectTo(record),
    mutationMode: "undoable",
  });

  const onDelete = () => {
    onOpenChange(false);
    handleDelete();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="opacity-70 transition-opacity hover:opacity-100 rounded-xs"
        >
          <EllipsisVertical className="size-6" />
          <span className="sr-only">
            {translate("ra.action.open_menu", { _: "More" })}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          variant="destructive"
          className="h-12 md:h-8 px-4 md:px-2 text-base md:text-sm"
          onSelect={onDelete}
        >
          <Trash2 />
          {translate("ra.action.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
