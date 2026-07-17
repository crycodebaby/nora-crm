import { CancelButton } from "@/components/admin/cancel-button";
import { SaveButton } from "@/components/admin/form";
import { NoraCancelButton } from "../misc/NoraCancelButton";
import { useFormState } from "react-hook-form";

export const FormToolbar = () => {
  const { isDirty } = useFormState();
  const Cancel = isDirty ? NoraCancelButton : CancelButton;

  return (
    <div
      role="toolbar"
      className="sticky flex pt-4 pb-4 md:pb-0 bottom-0 bg-linear-to-b from-transparent to-card to-10% flex-row justify-end gap-2"
    >
      <Cancel />
      <SaveButton />
    </div>
  );
};
