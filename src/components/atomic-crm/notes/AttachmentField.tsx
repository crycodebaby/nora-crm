import { useFieldValue, useRecordContext, useTranslate } from "ra-core";
import type { FileFieldProps } from "@/components/admin";
import { cn } from "@/lib/utils";
import { useAttachmentUrl } from "../attachments/useAttachmentUrl";

/**
 * Displays a preview for a single attachment record.
 *
 * This component is inspired by react-admin's `ImageField` and is intended for
 * usage inside a `<FileInput>`, where the current attachment is provided through
 * the record context.
 *
 * W8-E: the URL is derived through `useAttachmentUrl`, which owns the whole
 * policy — the stable storage key wins over any persisted `src`, a private
 * object is reached through a short-lived signed URL, and a stored value that
 * is not a safe navigable URL yields no `href` at all (it is still shown,
 * just never clickable). The local `blob:` preview of a file picked in this
 * session stays the one narrow exemption; it is not stored data.
 *
 * @param props - FileFieldProps provided by react-admin file inputs.
 * @returns An image preview for image attachments, or a regular link for other files.
 */
export const AttachmentField = (props: FileFieldProps) => {
  const {
    className,
    empty,
    title,
    target,
    download,
    defaultValue,
    source,
    record: _recordProp,
    ...rest
  } = props;
  const record = useRecordContext();
  const sourceValue = useFieldValue({ defaultValue, source, record });
  const titleValue =
    useFieldValue({
      ...props,
      // @ts-expect-error We ignore here because title might be a custom label or undefined instead of a field name
      source: title,
    })?.toString() ?? title;
  const translate = useTranslate();
  // Hooks may not sit behind the early return below, so access is derived for
  // every render. `useAttachmentUrl` is a no-op for a null/!private value.
  const access = useAttachmentUrl(
    record == null
      ? null
      : {
          src: sourceValue == null ? null : sourceValue.toString(),
          path: record.path,
          rawFile: record.rawFile,
        },
  );

  if (sourceValue == null) {
    if (!empty) {
      return null;
    }

    return (
      <div className={cn("inline-block", className)} {...rest}>
        {typeof empty === "string" ? translate(empty, { _: empty }) : empty}
      </div>
    );
  }

  const type = record?.type ?? record?.rawFile?.type;
  const isImage = isImageMimeType(type);
  const href = access.href;

  const preview =
    isImage && access.previewUrl ? (
      <img
        alt={titleValue}
        title={titleValue}
        src={access.previewUrl}
        onError={access.refresh}
        className="w-[200px] h-[100px] object-cover cursor-pointer object-left border border-border"
      />
    ) : (
      titleValue
    );

  // No navigable URL: either the URL authority rejected the stored value (a
  // `javascript:` value would otherwise execute in the signed-in user's
  // context on click), or access could not be derived. Keep the attachment
  // visible but never clickable, so nothing silently disappears from the UI.
  if (href == null) {
    return (
      <div className={cn("inline-block", className)} {...rest}>
        {isImage && access.previewUrl ? (
          preview
        ) : (
          <span title={titleValue}>{titleValue}</span>
        )}
      </div>
    );
  }

  return (
    <div className={cn("inline-block", className)} {...rest}>
      <a
        href={href}
        title={titleValue}
        target={target}
        rel="noopener noreferrer"
        download={download}
        // useful to prevent click bubbling in a DataTable with rowClick
        onClick={(e) => e.stopPropagation()}
      >
        {preview}
      </a>
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
