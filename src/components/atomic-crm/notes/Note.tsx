import { CircleX, Edit, Save, Trash2 } from "lucide-react";
import {
  Form,
  useDelete,
  useGetIdentity,
  useNotify,
  useResourceContext,
  useTranslate,
  useUpdate,
} from "ra-core";
import { useEffect, useRef, useState } from "react";
import type { FieldValues, SubmitHandler } from "react-hook-form";
import { ReferenceField } from "@/components/admin/reference-field";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { Markdown } from "../misc/Markdown";
import { RelativeDate } from "../misc/RelativeDate";
import { Status } from "../misc/Status";
import type { ContactNote, DealNote } from "../types";
import { NoteAttachments } from "./NoteAttachments";
import { NoteAttachmentsRecovery } from "./NoteAttachmentsRecovery";
import { NoteInputs } from "./NoteInputs";
import {
  recoveryAttachments,
  verifiedAttachments,
} from "../providers/commons/noteAttachmentReadModel";
import { useGetSalesName } from "../sales/useGetSalesName";

export const Note = ({
  showStatus,
  note,
}: {
  showStatus?: boolean;
  note: DealNote | ContactNote;
  isLast: boolean;
}) => {
  const [isEditing, setEditing] = useState(false);
  const [isExpanded, setExpanded] = useState(false);
  const [isTruncated, setTruncated] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const resource = useResourceContext();
  const notify = useNotify();
  const translate = useTranslate();
  const { identity } = useGetIdentity();
  const isCurrentUser = note.sales_id === identity?.id;
  const salesName = useGetSalesName(note.sales_id, {
    enabled: !isCurrentUser,
  });

  // Detect if content is truncated
  useEffect(() => {
    const el = contentRef.current;
    if (el) {
      setTruncated(el.scrollHeight > el.clientHeight);
    }
  }, [note.text]);

  const [update, { isPending }] = useUpdate();

  // W8-C S5: the host — never the renderer — decides whether this note is
  // trusted. `null` means nothing is vouched for, so the verified renderer is
  // not called at all and the read-only recovery view takes over.
  const verified = verifiedAttachments(note);
  const recovery = recoveryAttachments(note);
  const attachmentsEditable = note.attachments_state === "ok";

  const [deleteNote] = useDelete(resource, undefined, {
    mutationMode: "undoable",
    onSuccess: () => {
      notify("resources.notes.deleted", {
        type: "info",
        undoable: true,
        messageArgs: {
          _: "Note deleted",
        },
      });
    },
  });

  const handleDelete = () => {
    deleteNote(resource, { id: note.id, previousData: note });
  };

  const handleEnterEditMode = () => {
    setEditing(!isEditing);
  };

  const handleCancelEdit = () => {
    setEditing(false);
  };

  const handleNoteUpdate: SubmitHandler<FieldValues> = (values) => {
    update(
      resource,
      { id: note.id, data: values, previousData: note },
      {
        onSuccess: () => {
          setEditing(false);
        },
      },
    );
  };

  const content = (
    <div className="nora-note">
      <div className="nora-note-head">
        <span className="nora-note-meta inline-flex min-w-0 flex-wrap items-center gap-x-1">
          <ReferenceField
            source="company_id"
            reference="companies"
            link="show"
          />
          {" · "}
          {translate(
            isCurrentUser
              ? "resources.notes.you_added"
              : "resources.notes.author_added",
            { name: salesName },
          )}{" "}
          {showStatus && note.status && (
            <Status className="ml-2" status={note.status} />
          )}
        </span>
        <span className="nora-note-date text-[13px] text-[var(--nora-text-muted)] shrink-0">
          <RelativeDate date={note.date} />
        </span>
        <span className="nora-note-actions">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleEnterEditMode}
                  className="nora-touch-target p-2 h-auto cursor-pointer"
                >
                  <Edit className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{translate("resources.notes.action.edit")}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDelete}
                  className="nora-touch-target p-2 h-auto cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{translate("resources.notes.action.delete")}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </span>
      </div>
      {isEditing ? (
        <Form onSubmit={handleNoteUpdate} record={note} className="mt-1">
          <NoteInputs
            showStatus={showStatus}
            attachmentsEditable={attachmentsEditable}
          />
          {!attachmentsEditable && (
            <NoteAttachmentsRecovery attachments={recovery} />
          )}
          <div className="flex justify-end mt-2 space-x-4">
            <Button
              variant="ghost"
              onClick={handleCancelEdit}
              type="button"
              className="cursor-pointer"
            >
              <CircleX className="w-4 h-4" />
              {translate("ra.action.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="flex items-center gap-2 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              {translate("resources.notes.action.update")}
            </Button>
          </div>
        </Form>
      ) : (
        <div className="nora-note-body">
          {note.text && (
            <div
              ref={contentRef}
              className={cn(
                "overflow-hidden transition-[max-height] duration-300 ease-in-out",
                isExpanded ? "max-h-[5000px]" : "max-h-46",
              )}
            >
              <Markdown>{note.text}</Markdown>
            </div>
          )}
          {isTruncated && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(!isExpanded);
              }}
              className="nora-longtext-toggle cursor-pointer"
              aria-expanded={isExpanded}
            >
              {isExpanded
                ? translate("crm.common.show_less")
                : translate("crm.common.read_more")}
            </button>
          )}

          {verified ? (
            <NoteAttachments attachments={verified} />
          ) : (
            <NoteAttachmentsRecovery attachments={recovery} />
          )}
        </div>
      )}
    </div>
  );

  return content;
};
