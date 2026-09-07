import { useDataProvider, useTranslate, useUpdate } from "ra-core";

import {
  findTagByName,
  normalizeTagName,
} from "../application/commands/ensureTag";
import { NORA_ERROR_CODES, throwNoraError } from "../domain/noraErrorCodes";
import type { CrmDataProvider } from "../providers/types";
import type { Tag } from "../types";
import { TagDialog } from "./TagDialog";
import { useTags } from "./useTags";

type TagEditModalProps = {
  tag: Tag;
  open: boolean;
  onClose(): void;
  onSuccess?(tag: Tag): Promise<void>;
};

export function TagEditModal({
  tag,
  open,
  onClose,
  onSuccess,
}: TagEditModalProps) {
  const [update] = useUpdate<Tag>(undefined, undefined, {
    returnPromise: true,
  });
  const dataProvider = useDataProvider<CrmDataProvider>();
  const translate = useTranslate();
  const { data: existingTags } = useTags({ enabled: open });

  const handleEditTag = async (data: Pick<Tag, "name" | "color">) => {
    // Renaming onto another Markierung's name is REFUSED, never silently
    // merged: two logical labels becoming one is a decision about meaning,
    // and the user has to make it deliberately (see docs/nora/06-decision-log.md,
    // "Markierungen Identity Wave"). The database enforces the same rule via
    // uq__tags__normalized_name; this pre-check only makes the message exact.
    if (normalizeTagName(data.name) !== normalizeTagName(tag.name)) {
      const clash = await findTagByName(dataProvider, data.name);
      if (clash && clash.id !== tag.id) {
        throwNoraError(
          `Markierung "${clash.name}" existiert bereits.`,
          NORA_ERROR_CODES.TAG_ALREADY_EXISTS,
        );
      }
    }

    const updated = await update("tags", {
      id: tag.id,
      data,
      previousData: tag,
    });

    await onSuccess?.(updated ?? { ...tag, ...data });
  };

  return (
    <TagDialog
      open={open}
      title={translate("resources.tags.dialog.edit_title")}
      onClose={onClose}
      onSubmit={handleEditTag}
      existingTags={existingTags}
      currentTagId={tag.id}
      tag={tag}
    />
  );
}
