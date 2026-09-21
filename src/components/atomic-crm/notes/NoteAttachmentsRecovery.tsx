import { Paperclip, TriangleAlert } from "lucide-react";
import { useTranslate } from "ra-core";

import type { AttachmentNote } from "../types";

/**
 * Read-only recovery view for QUARANTINED note attachments (W8-C S5).
 *
 * It is shown when `public.attachments` could not vouch for a note's legacy
 * JSON array — either the two disagree (`drift`) or the read carried no
 * relational rows at all (`unverified`). The data it renders is explicitly
 * NOT verified, so it deliberately offers no inline preview, no input and no
 * way back into the form:
 *
 * - no `<img>` and no image branch — an unverified key must not be rendered
 *   as trusted content
 * - no `FileInput` / `AttachmentField`, no remove controls
 * - no react-hook-form registration, never `setValue("attachments")`
 *
 * It only tells the user that historical attachment content exists and lets
 * them open it.
 */
export const NoteAttachmentsRecovery = ({
  attachments,
}: {
  attachments: AttachmentNote[];
}) => {
  const translate = useTranslate();

  if (!attachments || attachments.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3">
      <div className="flex items-start gap-2 text-sm text-muted-foreground">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <span>
          {translate("resources.notes.attachments_recovery.unverified_hint", {
            _: "These attachments could not be verified. They are shown read-only and cannot be changed right now.",
          })}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {attachments.map((attachment, index) => (
          <li
            key={attachment.path ?? attachment.src ?? index}
            className="flex items-center gap-2 text-sm"
          >
            <Paperclip className="size-4 shrink-0" />
            {attachment.src ? (
              <a
                href={attachment.src}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:no-underline"
                onClick={(e) => e.stopPropagation()}
              >
                {attachment.title}
              </a>
            ) : (
              <span>{attachment.title}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};
