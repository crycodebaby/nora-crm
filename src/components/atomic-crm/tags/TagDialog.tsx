import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { Tag } from "../types";
import { TagForm } from "./TagForm";

type TagDialogProps = {
  open: boolean;
  tag?: Pick<Tag, "name" | "color">;
  title: string;
  description?: string;
  existingTags?: Tag[];
  currentTagId?: Tag["id"];
  onSubmit(tag: Pick<Tag, "name" | "color">): Promise<void>;
  onClose(): void;
};

export function TagDialog({
  open,
  tag,
  title,
  description,
  existingTags,
  currentTagId,
  onClose,
  onSubmit,
}: TagDialogProps) {
  const handleClose = (isOpen = false) => {
    if (!isOpen) {
      onClose();
    }
  };

  // The dialog closes on success ONLY. A rejected onSubmit propagates into
  // TagForm, which keeps the dialog open and shows the reason — the office
  // user must never be left guessing whether Speichern worked.
  const handleSubmit = async (data: Pick<Tag, "name" | "color">) => {
    await onSubmit(data);
    handleClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <TagForm
          open={open}
          tag={tag}
          existingTags={existingTags}
          currentTagId={currentTagId}
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}
