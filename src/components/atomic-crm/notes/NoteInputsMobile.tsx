import { useEffect, useRef } from "react";
import { Paperclip } from "lucide-react";
import {
  required,
  useInput,
  useTranslate,
  ValidationError,
  RecordContextProvider,
} from "ra-core";
import { AutocompleteInput, ReferenceInput } from "@/components/admin";
import { FileInputPreview } from "@/components/admin/file-input";
import { useFormContext, useWatch } from "react-hook-form";

import { contactOptionText } from "../misc/ContactOption";
import { AttachmentField } from "./AttachmentField";
import { foreignKeyMapping } from "./foreignKeyMapping";
import { validateNoteOrAttachmentRequired } from "./noteModel";
import {
  type RejectedAttachment,
  useAttachmentRejectionNotify,
} from "./useAttachmentRejectionNotify";
import {
  ATTACHMENT_ACCEPT_ATTRIBUTE,
  getAttachmentFileRejection,
} from "../providers/commons/attachments";
import type { ContactNote } from "../types";

export const NoteInputsMobile = ({
  selectContact,
  attachmentsEditable,
}: {
  selectContact?: boolean;
  /**
   * W8-C S5. Presentation never inspects `attachments_state` itself — the
   * host decides: `true` on CREATE, `attachments_state === "ok"` on an
   * existing note. This component is shared by the create sheet and the edit
   * sheet, so the prop is the only thing that tells them apart.
   */
  attachmentsEditable: boolean;
}) => {
  const translate = useTranslate();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const { field, fieldState } = useInput({
    source: "text",
    validate: validateNoteOrAttachmentRequired,
  });

  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    requestAnimationFrame(() => {
      node.focus();
      // move cursor to end of text
      node.setSelectionRange(node.value.length, node.value.length);
    });
  }, []);

  return (
    <div className="flex flex-col flex-1 -m-4">
      <div className="flex-1 flex flex-col">
        <textarea
          {...field}
          ref={(node) => {
            field.ref(node);
            textareaRef.current = node;
          }}
          placeholder={translate("resources.notes.inputs.add_note")}
          className="flex-1 min-h-0 resize-none bg-background p-4 outline-none text-base"
        />
        {fieldState.error && (
          <p className="px-4 text-sm text-destructive">
            <ValidationError error={fieldState.error.message ?? ""} />
          </p>
        )}
      </div>
      {selectContact && (
        <div className="px-4 py-4">
          <ReferenceInput
            source={foreignKeyMapping["contacts"]}
            reference="contacts"
          >
            <AutocompleteInput
              label="resources.notes.fields.contact_id"
              optionText={contactOptionText}
              helperText={false}
              validate={required()}
              modal
            />
          </ReferenceInput>
        </div>
      )}
      {attachmentsEditable && (
        <div className="px-4">
          <AttachmentPreviewsMobile />
          <AttachButton />
        </div>
      )}
    </div>
  );
};

const AttachButton = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const { getValues, setValue } = useFormContext();
  const translate = useTranslate();
  const notifyRejectedAttachments = useAttachmentRejectionNotify();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const newFiles: { rawFile: File; src: string; title: string }[] = [];
    const rejected: RejectedAttachment[] = [];
    for (const file of Array.from(fileList)) {
      const reason = getAttachmentFileRejection(file);
      if (reason) {
        rejected.push({ name: file.name, reason });
      } else {
        newFiles.push({
          rawFile: file,
          src: URL.createObjectURL(file),
          title: file.name,
        });
      }
    }
    notifyRejectedAttachments(rejected);

    e.target.value = "";
    if (newFiles.length === 0) return;

    const existing = getValues("attachments") || [];
    const currentFiles = Array.isArray(existing) ? existing : [existing];
    setValue("attachments", [...currentFiles, ...newFiles], {
      shouldDirty: true,
    });
  };

  return (
    <>
      <button
        type="button"
        className="flex items-center gap-2 py-3 text-sm text-muted-foreground"
        onClick={() => inputRef.current?.click()}
      >
        <Paperclip className="size-4" />
        {translate("resources.notes.actions.attach_document", {
          _: "Attach document",
        })}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT_ATTRIBUTE}
        className="hidden"
        onChange={handleFileChange}
      />
    </>
  );
};

const AttachmentPreviewsMobile = () => {
  const { control, setValue } = useFormContext();
  const attachments = useWatch({ control, name: "attachments" }) as
    | ContactNote["attachments"]
    | undefined;

  if (!Array.isArray(attachments) || attachments.length === 0) return null;

  const onRemove = (index: number) => {
    const updated = attachments.filter((_: unknown, i: number) => i !== index);
    setValue("attachments", updated, { shouldDirty: true });
  };

  return (
    <div className="flex flex-col gap-1">
      {attachments.map((file, index: number) => (
        <FileInputPreview
          key={file.src}
          file={file}
          onRemove={() => onRemove(index)}
        >
          <RecordContextProvider value={file}>
            <AttachmentField source="src" title="title" target="_blank" />
          </RecordContextProvider>
        </FileInputPreview>
      ))}
    </div>
  );
};
