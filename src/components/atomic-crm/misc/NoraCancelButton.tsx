import { useState } from "react";
import { useFormState } from "react-hook-form";
import { useNavigate } from "react-router";

import { Confirm } from "@/components/admin/confirm";
import { Button } from "@/components/ui/button";
import { CircleX } from "lucide-react";
import { Translate } from "ra-core";

/**
 * Cancel button that confirms when the surrounding react-hook-form is dirty.
 */
export const NoraCancelButton = (props: React.ComponentProps<"button">) => {
  const navigate = useNavigate();
  const { isDirty } = useFormState();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleCancel = () => {
    if (isDirty) {
      setConfirmOpen(true);
      return;
    }
    navigate(-1);
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        onClick={handleCancel}
        className="cursor-pointer"
        {...props}
      >
        <CircleX />
        <Translate i18nKey="ra.action.cancel">Cancel</Translate>
      </Button>
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
          navigate(-1);
        }}
      />
    </>
  );
};
