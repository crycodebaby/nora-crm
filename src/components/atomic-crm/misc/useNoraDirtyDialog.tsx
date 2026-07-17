import { useCallback, useRef, useState } from "react";
import { useTranslate } from "ra-core";
import { useFormState } from "react-hook-form";

import { Confirm } from "@/components/admin/confirm";

type UseNoraDirtyDialogOptions = {
  onClose: () => void;
  /** When set, overrides react-hook-form dirty detection. */
  isDirty?: boolean;
};

/** Confirms before closing a surface when form state is dirty. */
export const resolveDirtyClose = (
  isDirty: boolean,
  onClose: () => void,
  openConfirm: () => void,
) => {
  if (isDirty) {
    openConfirm();
    return;
  }
  onClose();
};

/** Confirms before closing a surface when form state is dirty. */
export const useNoraDirtyDialog = ({
  onClose,
  isDirty: isDirtyOverride,
}: UseNoraDirtyDialogOptions) => {
  const formState = useFormState();
  const isDirty = isDirtyOverride ?? formState.isDirty;
  const [confirmOpen, setConfirmOpen] = useState(false);

  const requestClose = useCallback(() => {
    resolveDirtyClose(isDirty, onClose, () => setConfirmOpen(true));
  }, [isDirty, onClose]);

  const dirtyConfirmDialog = (
    <Confirm
      isOpen={confirmOpen}
      title="crm.unsaved_changes.title"
      content="crm.unsaved_changes.message"
      confirm="crm.unsaved_changes.discard"
      cancel="crm.unsaved_changes.keep_editing"
      confirmColor="warning"
      onClose={() => setConfirmOpen(false)}
      onConfirm={() => {
        setConfirmOpen(false);
        onClose();
      }}
    />
  );

  return { isDirty, requestClose, dirtyConfirmDialog };
};

/** Stores the element that opened a dialog and restores focus on close. */
export const useDialogFocusReturn = (open: boolean) => {
  const triggerRef = useRef<HTMLElement | null>(null);
  const translate = useTranslate();

  if (open && !triggerRef.current) {
    triggerRef.current = document.activeElement as HTMLElement | null;
  }
  if (!open) {
    triggerRef.current = null;
  }

  const closeButtonLabel = translate("ra.action.close");

  const onCloseAutoFocus = (event: Event) => {
    event.preventDefault();
    triggerRef.current?.focus();
  };

  return { onCloseAutoFocus, closeButtonLabel };
};
