import { Paperclip } from "lucide-react";

import type { AttachmentNote } from "../types";

/**
 * Displays VERIFIED note attachments in note show/list views.
 *
 * W8-C S5: this renderer deliberately accepts only already-verified
 * presentation data — never a whole note record. Deciding whether a note is
 * trusted is the host's job (`verifiedAttachments(note)`); a raw note
 * resource is not type-compatible with this component, so unverified legacy
 * data cannot reach the inline image renderer below. Quarantined data goes to
 * `NoteAttachmentsRecovery` instead.
 *
 * @param props.attachments - Verified attachments to render.
 * @returns `null` when there are no attachments, otherwise attachment previews and links.
 */
export const NoteAttachments = ({
  attachments,
}: {
  attachments: AttachmentNote[];
}) => {
  if (!attachments || attachments.length === 0) {
    return null;
  }

  const imageAttachments = attachments.filter((attachment: AttachmentNote) =>
    isImageMimeType(attachment.type),
  );
  const otherAttachments = attachments.filter(
    (attachment: AttachmentNote) => !isImageMimeType(attachment.type),
  );

  return (
    <div className="mt-2 flex flex-col gap-2">
      {imageAttachments.length > 0 && (
        <div className="grid grid-cols-4 gap-8">
          {imageAttachments.map((attachment: AttachmentNote, index: number) => (
            <div key={index}>
              <a
                href={attachment.src}
                title={attachment.title}
                target="_blank"
                rel="noopener noreferrer"
                className="block"
                onClick={(e) => e.stopPropagation()}
              >
                <img
                  src={attachment.src}
                  alt={attachment.title}
                  className="w-[200px] h-[100px] object-cover cursor-pointer object-left border border-border"
                />
              </a>
            </div>
          ))}
        </div>
      )}
      {otherAttachments.length > 0 &&
        otherAttachments.map((attachment: AttachmentNote, index: number) => (
          <div key={index} className="flex items-center gap-2">
            <Paperclip className="w-4 h-4" />
            <a
              href={attachment.src}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:no-underline"
              onClick={(e) => e.stopPropagation()}
            >
              {attachment.title}
            </a>
          </div>
        ))}
    </div>
  );
};

/**
 * Checks whether a mime type corresponds to an image.
 *
 * @param mimeType - The attachment mime type.
 * @returns `true` when the mime type starts with `image/`.
 */
const isImageMimeType = (mimeType?: string): boolean => {
  if (!mimeType) {
    return false;
  }
  return mimeType.startsWith("image/");
};
