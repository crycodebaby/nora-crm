import type { ReactNode } from "react";
import { useState, useCallback } from "react";
import { XIcon } from "lucide-react";

import { Confirm } from "@/components/admin/confirm";
import { DialogContent } from "@/components/ui/dialog";

import { useDialogFocusReturn } from "./useNoraDirtyDialog";

type NoraDialogContentProps = React.ComponentProps<typeof DialogContent> & {
  open: boolean;
  isDirty?: boolean;
  onRequestClose: () => void;
  preventOutsideClose?: boolean;
  children: ReactNode;
};

/**
 * Dialog surface with dirty-close confirmation, blocked outside-click dismiss,
 * and focus return to the triggering element.
 */
export const NoraDialogContent = ({
  open,
  isDirty = false,
  onRequestClose,
  preventOutsideClose = true,
  children,
  className,
  ...props
}: NoraDialogContentProps) => {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { onCloseAutoFocus, closeButtonLabel } = useDialogFocusReturn(open);

  const tryClose = useCallback(() => {
    if (isDirty) {
      setConfirmOpen(true);
      return;
    }
    onRequestClose();
  }, [isDirty, onRequestClose]);

  return (
    <>
      <DialogContent
        className={className}
        showClose={false}
        preventOutsideClose={preventOutsideClose}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          tryClose();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
        {...props}
      >
        {children}
        <button
          type="button"
          className="ring-offset-background focus:ring-ring absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden"
          onClick={tryClose}
          aria-label={closeButtonLabel}
        >
          <XIcon className="size-4" />
        </button>
      </DialogContent>
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
          onRequestClose();
        }}
      />
    </>
  );
};
