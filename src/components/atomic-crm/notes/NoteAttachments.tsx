import { Paperclip } from "lucide-react";
import { useTranslate } from "ra-core";

import { useAttachmentUrl } from "../attachments/useAttachmentUrl";
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
 * W8-E: the URL is DERIVED from the attachment's stable storage key through
 * `useAttachmentUrl`, never read from the persisted `src`. This component
 * constructs no Storage URL and knows no bucket.
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
            <VerifiedImageAttachment
              key={attachment.path ?? index}
              attachment={attachment}
            />
          ))}
        </div>
      )}
      {otherAttachments.length > 0 &&
        otherAttachments.map((attachment: AttachmentNote, index: number) => (
          <VerifiedFileAttachment
            key={attachment.path ?? index}
            attachment={attachment}
          />
        ))}
    </div>
  );
};

const VerifiedImageAttachment = ({
  attachment,
}: {
  attachment: AttachmentNote;
}) => {
  const access = useAttachmentUrl(attachment);
  const translate = useTranslate();

  if (access.status !== "ready" || !access.previewUrl) {
    return (
      <div className="w-[200px] h-[100px] border border-border bg-muted/40 flex items-center justify-center text-xs text-muted-foreground">
        {access.status === "loading"
          ? translate("resources.notes.attachments_access.loading", {
              _: "Loading…",
            })
          : translate("resources.notes.attachments_access.unavailable", {
              _: "Not available",
            })}
      </div>
    );
  }

  const preview = (
    <img
      src={access.previewUrl}
      alt={attachment.title}
      // A capability that expired while the tab sat open yields a broken
      // image; re-deriving once is the whole recovery path.
      onError={access.refresh}
      className="w-[200px] h-[100px] object-cover cursor-pointer object-left border border-border"
    />
  );

  return (
    <div>
      {access.href == null ? (
        preview
      ) : (
        <a
          href={access.href}
          title={attachment.title}
          target="_blank"
          rel="noopener noreferrer"
          className="block"
          onClick={(e) => e.stopPropagation()}
        >
          {preview}
        </a>
      )}
    </div>
  );
};

const VerifiedFileAttachment = ({
  attachment,
}: {
  attachment: AttachmentNote;
}) => {
  const access = useAttachmentUrl(attachment);

  return (
    <div className="flex items-center gap-2">
      <Paperclip className="w-4 h-4" />
      {access.href == null ? (
        <span>{attachment.title}</span>
      ) : (
        <a
          href={access.href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:no-underline"
          onClick={(e) => e.stopPropagation()}
        >
          {attachment.title}
        </a>
      )}
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
