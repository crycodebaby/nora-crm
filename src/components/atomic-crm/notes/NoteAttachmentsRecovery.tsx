import { Paperclip, TriangleAlert } from "lucide-react";
import { useTranslate } from "ra-core";

import type { AttachmentNote } from "../types";

/**
 * Read-only recovery view for QUARANTINED note attachments (W8-C S5, W8-E).
 *
 * It is shown when `public.attachments` could not vouch for a note's legacy
 * JSON array — either the two disagree (`drift`) or the read carried no
 * relational rows at all (`unverified`).
 *
 * W8-E tightened this from "read-only" to "metadata-only". A degraded
 * attachment reference no longer mints ANY content capability:
 *
 * - no `<img>` and no image branch — unchanged from S5;
 * - **no signed URL**: `useAttachmentUrl` is deliberately not imported here,
 *   so there is no code path from a degraded record to private bucket
 *   content. Degradation means "we cannot vouch that this belongs to this
 *   note"; deriving access from it anyway would make the gate decorative;
 * - **no anchor at all**: before W8-E the legacy public `src` was still
 *   clickable. Once the bucket is private that URL is dead, and keeping it as
 *   a link would be both broken and an alternate escape hatch around the
 *   gate. The affordance is intentionally gone (approved product decision);
 * - no `FileInput` / `AttachmentField`, no remove controls, no react-hook-form
 *   registration, never `setValue("attachments")`.
 *
 * What remains is exactly what recovery needs: the evidence that historical
 * attachment content exists, and its file name.
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
            _: "These attachments could not be verified. They are listed read-only and cannot be opened or changed right now.",
          })}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {attachments.map((attachment, index) => (
          <li
            key={attachment.path ?? attachment.src ?? index}
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <Paperclip className="size-4 shrink-0" />
            <span>{attachment.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};
