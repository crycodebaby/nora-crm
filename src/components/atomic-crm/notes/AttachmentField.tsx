import { useFieldValue, useRecordContext, useTranslate } from "ra-core";
import type { FileFieldProps } from "@/components/admin";
import { safeHref } from "@/lib/safeHref";
import { cn } from "@/lib/utils";

/**
 * Displays a preview for a single attachment record.
 *
 * This component is inspired by react-admin's `ImageField` and is intended for
 * usage inside a `<FileInput>`, where the current attachment is provided through
 * the record context.
 *
 * Every stored `src` goes through `safeHref` before it can become a clickable
 * `href`; one that is not a safe navigable URL is still shown, but without an
 * anchor. The only exception is the local `blob:` preview of a file picked in
 * this session, which is not stored data — see below.
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
  const srcValue = sourceValue.toString();
  const isImage = isImageMimeType(type);

  // A file the user just picked in THIS session is not part of the stored-XSS
  // surface: `FileInput.transformFile` / `NoteInputsMobile.handleFileChange`
  // put the real `File` on `rawFile` and a locally minted `blob:` object URL on
  // `src`. Both halves have to hold — a value deserialized from note JSON can
  // never be a `File` instance, and `URL.createObjectURL` only ever yields a
  // `blob:` URL — so this cannot be reached by stored data. Everything else,
  // which is every persisted and therefore attacker-influenceable `src`, goes
  // through `safeHref` below.
  const isLocalPreview =
    record?.rawFile instanceof File && srcValue.startsWith("blob:");
  const href = isLocalPreview ? srcValue : safeHref(srcValue);

  const preview = isImage ? (
    <img
      alt={titleValue}
      title={titleValue}
      src={srcValue}
      className="w-[200px] h-[100px] object-cover cursor-pointer object-left border border-border"
    />
  ) : (
    titleValue
  );

  // Rejected by the URL authority (a `javascript:` value would otherwise
  // execute in the signed-in user's context on click). Keep the attachment
  // visible but never clickable — the degradation `NoteAttachments` applies
  // too (W8-C S5), so nothing silently disappears from the UI.
  if (href == null) {
    return (
      <div className={cn("inline-block", className)} {...rest}>
        {isImage ? preview : <span title={titleValue}>{titleValue}</span>}
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
