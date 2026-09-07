import { useTranslate } from "ra-core";

import type { Tag } from "../types";
import { TagDialog } from "./TagDialog";
import { useEnsureTag } from "./useEnsureTag";
import { useTags } from "./useTags";

type TagCreateModalProps = {
  open: boolean;
  onClose(): void;
  /**
   * Runs INSIDE the submit, before the dialog closes: if attaching the tag
   * fails, the whole submit fails and the dialog stays open with an error.
   * `created` is false when an existing Markierung with the same canonical
   * name was reused instead of a second row being written.
   */
  onSuccess?(tag: Tag, created: boolean): Promise<void>;
};

export function TagCreateModal({
  open,
  onClose,
  onSuccess,
}: TagCreateModalProps) {
  const ensureTag = useEnsureTag();
  const translate = useTranslate();
  const { data: existingTags } = useTags({ enabled: open });

  const handleCreateTag = async (data: Pick<Tag, "name" | "color">) => {
    const { tag, created } = await ensureTag(data);
    await onSuccess?.(tag, created);
  };

  return (
    <TagDialog
      open={open}
      title={translate("resources.tags.dialog.create_title")}
      description={translate("resources.tags.dialog.create_description")}
      existingTags={existingTags}
      onClose={onClose}
      onSubmit={handleCreateTag}
    />
  );
}
